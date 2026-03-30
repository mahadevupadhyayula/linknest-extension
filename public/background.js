import {
  applyDeltaSync,
  getTargetsCacheState,
  normalizeLinkedInProfileUrl,
  replaceAllTargets,
  upsertLocalTarget
} from "./lib/stores/targetsStore.js";
import { runDeltaSync as runSyncManager } from "./lib/sync/syncManager.js";

const MENU_IDS = {
  SHADOW_ME: "ln_shadow_me",
  SUGGEST_RESPONSE: "ln_suggest_response",
  ADD_TARGET: "ln_add_target",
  ANALYZE_PROFILE_MATCH: "ln_analyze_profile_match"
};

const STORE_KEYS = {
  EVENTS: "ln_events",
  SETTINGS: "ln_settings",
  SESSION: "ln_shadow_session",
  SYNC_META: "ln_sync_meta",
  BACKEND_STATUS: "ln_backend_status",
  UNREAD_COUNT: "ln_unread_count",
  RECENT_FINGERPRINTS: "ln_recent_fingerprints",
  RECENT_TARGET_ADD: "ln_recent_target_add",
  TARGET_WRITE_QUEUE: "ln_target_write_queue",
  INTERACTION_WRITE_QUEUE: "ln_interaction_write_queue",
  SUGGEST_TELEMETRY: "ln_suggest_telemetry"
};

const ALARM_IDS = {
  REMINDERS: "ln_poll_reminders",
  TARGET_SYNC: "ln_targets_delta_sync",
  WRITE_FLUSH: "ln_write_flush"
};

const CACHE_LIMITS = {
  EVENTS: 100,
  RECENT_FINGERPRINTS: 500,
  RECENT_TARGET_ADD: 200
};

const CACHE_TTL_MS = {
  RECENT_FINGERPRINTS: 5 * 60 * 1000,
  RECENT_TARGET_ADD: 30 * 1000,
  TARGET_CACHE_STALE: 5 * 60 * 1000
};

const WRITE_BACKOFF_MS = [5_000, 30_000, 2 * 60_000, 10 * 60_000];
const INTERACTION_BATCH_SIZE = 25;

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaultSettings();
  await registerContextMenus();
  await recalculateUnreadCount();
  scheduleBackgroundSync();
  await flushWriteQueues();
});

chrome.runtime.onStartup.addListener(() => {
  void recalculateUnreadCount();
  scheduleBackgroundSync();
  void flushWriteQueues();
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await refreshMenusForTab(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    await refreshMenusForTab(tabId);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !tab.url) return;
  const ctx = getPageContext(tab.url);

  if (info.menuItemId === MENU_IDS.SHADOW_ME) {
    await startShadowSession(tab.id);
    return;
  }

  if (info.menuItemId === MENU_IDS.SUGGEST_RESPONSE) {
    await requestSuggestion(tab.id);
    return;
  }

  if (info.menuItemId === MENU_IDS.ADD_TARGET && ctx === "profile") {
    await addTargetFromProfile(tab.id);
    return;
  }

  if (info.menuItemId === MENU_IDS.ANALYZE_PROFILE_MATCH && ctx === "profile") {
    await enqueueEvent({ type: "analysis_future", message: "Profile match analysis is planned for a future release." });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    if (message?.type === "LN_TARGET_DETECTED") {
      await handleTargetDetected(message.payload);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "LN_INTERACTION_LOG") {
      const settings = await getSettings();
      if (!settings.passiveLoggingEnabled) {
        sendResponse({ ok: true, skipped: true, reason: "passive_logging_disabled" });
        return;
      }

      await enqueueInteractionWrite(message.payload);
      sendResponse({ ok: true, skipped: false });
      return;
    }

    if (message?.type === "LN_REQUEST_POPUP_EVENTS") {
      const events = await getEvents();
      sendResponse({ ok: true, events });
      return;
    }

    if (message?.type === "LN_POPUP_GET_STATE") {
      const [events, data] = await Promise.all([
        getEvents(),
        chrome.storage.local.get([
          STORE_KEYS.SETTINGS,
          STORE_KEYS.SESSION,
          STORE_KEYS.SYNC_META,
          STORE_KEYS.BACKEND_STATUS,
          STORE_KEYS.UNREAD_COUNT,
          STORE_KEYS.SUGGEST_TELEMETRY,
          STORE_KEYS.INTERACTION_WRITE_QUEUE
        ])
      ]);
      sendResponse({
        ok: true,
        events,
        settings: data[STORE_KEYS.SETTINGS] ?? {},
        session: data[STORE_KEYS.SESSION] ?? null,
        syncMeta: data[STORE_KEYS.SYNC_META] ?? { lastSyncAt: null },
        backendStatus: data[STORE_KEYS.BACKEND_STATUS] ?? {},
        unreadCount: data[STORE_KEYS.UNREAD_COUNT] ?? 0,
        suggestTelemetry: data[STORE_KEYS.SUGGEST_TELEMETRY] ?? { requests: 0, success: 0, errors: 0 },
        interactionQueue: (data[STORE_KEYS.INTERACTION_WRITE_QUEUE] ?? []).map((entry) => ({
          id: entry.id,
          attemptCount: entry.attemptCount ?? 0,
          queuedAt: entry.queuedAt ?? null,
          nextRetryAt: entry.nextRetryAt ?? null,
          payload: entry.payload
        }))
      });
      return;
    }

    if (message?.type === "LN_POPUP_MARK_EVENT_READ") {
      const next = await markEventRead(message?.payload?.eventId);
      sendResponse({ ok: true, events: next });
      return;
    }

    if (message?.type === "LN_POPUP_DISMISS_EVENT") {
      const next = await dismissEvent(message?.payload?.eventId);
      sendResponse({ ok: true, events: next });
      return;
    }

    if (message?.type === "LN_POPUP_CLEAR_EVENTS") {
      const next = await clearEvents();
      sendResponse({ ok: true, events: next });
      return;
    }

    if (message?.type === "LN_POPUP_REFRESH_TARGETS") {
      await runTargetSync("manual_popup_refresh");
      const metaData = await chrome.storage.local.get([STORE_KEYS.SYNC_META, STORE_KEYS.BACKEND_STATUS]);
      sendResponse({
        ok: true,
        syncMeta: metaData[STORE_KEYS.SYNC_META] ?? { lastSyncAt: null },
        backendStatus: metaData[STORE_KEYS.BACKEND_STATUS] ?? {}
      });
      return;
    }

    if (message?.type === "LN_POPUP_REQUEST_SUGGESTION") {
      const result = await requestSuggestionFromActiveTab("popup_button");
      sendResponse({ ok: result.ok, error: result.error ?? null });
      return;
    }

    if (message?.type === "LN_POPUP_CLEAR_INTERACTION_QUEUE") {
      await chrome.storage.local.set({ [STORE_KEYS.INTERACTION_WRITE_QUEUE]: [] });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "LN_TARGETS_GET_SWR") {
      const cache = await getTargetsWithStaleWhileRevalidate();
      sendResponse({ ok: true, ...cache });
      return;
    }

    sendResponse({ ok: false });
  })();

  return true;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_IDS.REMINDERS) {
    const reminders = await fetchFollowupReminders({ limit: 5 });
    for (const reminder of reminders.reminders ?? []) {
      await enqueueEvent({
        type: "followup_due",
        message: reminder.message,
        payload: reminder
      });
      await notify("LinkNest reminder", reminder.message);
    }
  }

  if (alarm.name === ALARM_IDS.TARGET_SYNC) {
    await runTargetSync("alarm");
  }

  if (alarm.name === ALARM_IDS.WRITE_FLUSH) {
    await flushWriteQueues();
  }
});

async function ensureDefaultSettings() {
  const data = await chrome.storage.local.get(STORE_KEYS.SETTINGS);
  if (data[STORE_KEYS.SETTINGS]) return;

  await chrome.storage.local.set({
    [STORE_KEYS.SETTINGS]: {
      quietMode: false,
      passiveLoggingEnabled: false,
      shadowScanIntervalMs: 1000,
      shadowSessionTimeoutMin: 30
    }
  });
}

async function registerContextMenus() {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: MENU_IDS.SHADOW_ME,
    title: "LinkNest: Shadow Me",
    contexts: ["page"],
    documentUrlPatterns: ["https://www.linkedin.com/feed/*"]
  });

  chrome.contextMenus.create({
    id: MENU_IDS.SUGGEST_RESPONSE,
    title: "LinkNest: Suggest a Response",
    contexts: ["selection", "page"],
    documentUrlPatterns: ["https://www.linkedin.com/feed/*"]
  });

  chrome.contextMenus.create({
    id: MENU_IDS.ADD_TARGET,
    title: "LinkNest: Add to Target List",
    contexts: ["page"],
    documentUrlPatterns: ["https://www.linkedin.com/in/*"]
  });

  chrome.contextMenus.create({
    id: MENU_IDS.ANALYZE_PROFILE_MATCH,
    title: "LinkNest: Analyze Profile Match (Future)",
    contexts: ["page"],
    documentUrlPatterns: ["https://www.linkedin.com/in/*"]
  });
}

async function refreshMenusForTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab?.url?.includes("linkedin.com")) return;
  await applyUnreadBadge();
}

function getPageContext(url) {
  if (/linkedin\.com\/feed/.test(url)) return "feed";
  if (/linkedin\.com\/in\//.test(url)) return "profile";
  return "none";
}

async function startShadowSession(tabId) {
  const session = {
    startedAt: new Date().toISOString(),
    mode: "name_only",
    active: true,
    tabId
  };

  await chrome.storage.local.set({ [STORE_KEYS.SESSION]: session });
  await enqueueEvent({ type: "shadow_started", message: "Shadow mode started (name-only safe mode)." });
  await notify("LinkNest", "Shadow mode started.");

  await chrome.tabs.sendMessage(tabId, { type: "LN_START_SHADOW", payload: { mode: "name_only" } });
  await startShadowSessionApi({ started_at: session.startedAt, mode: session.mode });
}

async function requestSuggestion(tabId) {
  await recordSuggestTelemetry("requests");

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "LN_CAPTURE_SUGGESTION_CONTEXT" });
    const text = response?.text ?? "";
    const textMeta = response?.textMeta ?? {};

    if (!text) {
      throw new Error("Select text first, then try Suggest Response.");
    }

    const suggestion = await generateResponseSuggestion({
      context_type: "post",
      text,
      tone: "professional"
    });

    await enqueueEvent({
      type: "suggestion_ready",
      message: "Suggestion generated.",
      payload: {
        bestSuggestion: suggestion.best_suggestion ?? "",
        confidence: suggestion.confidence ?? null,
        contextType: suggestion.contextEcho ?? "post",
        contextSummary: {
          selectedChars: textMeta.selectedChars ?? text.length,
          capturedChars: textMeta.capturedChars ?? text.length,
          wasTrimmed: Boolean(textMeta.wasTrimmed)
        }
      }
    });

    await recordSuggestTelemetry("success");
    await notify("LinkNest", "Suggestion is ready in popup.");
    return { ok: true };
  } catch (error) {
    await enqueueEvent({
      type: "suggestion_failed",
      message: error instanceof Error ? error.message : "Suggestion generation failed.",
      payload: { reason: "suggestion_request_error" }
    });
    await recordSuggestTelemetry("errors");
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function requestSuggestionFromActiveTab(source) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.includes("linkedin.com")) {
    await enqueueEvent({
      type: "suggestion_failed",
      message: "Open a LinkedIn tab to generate suggestions.",
      payload: { reason: "no_active_linkedin_tab", source }
    });
    return { ok: false, error: "No active LinkedIn tab found." };
  }

  return requestSuggestion(tab.id);
}

async function addTargetFromProfile(tabId) {
  const profile = await chrome.tabs.sendMessage(tabId, { type: "LN_EXTRACT_PROFILE_MINIMAL" });
  const normalized = normalizeLinkedInProfileUrl(profile?.profileUrl);
  if (!normalized) {
    await enqueueEvent({
      type: "target_added_failed",
      message: "Could not add target: invalid LinkedIn profile URL.",
      payload: { reason: "invalid_profile_url", rawProfileUrl: profile?.profileUrl ?? null }
    });
    await notify("LinkNest", "Could not extract profile details.");
    return;
  }

  if (await isRecentTargetAdd(normalized.profileSlug)) {
    return;
  }

  try {
    const apiResult = await enqueueTargetWrite({
      profile_url: normalized.profileUrl,
      display_name: profile?.displayName,
      headline: profile?.headline,
      source: "linkedin_profile",
      captured_at: new Date().toISOString()
    });

    const { target, isNew } = await upsertLocalTarget({
      targetId: apiResult.target_id,
      profileUrl: normalized.profileUrl,
      displayName: profile?.displayName,
      headline: profile?.headline,
      source: "linkedin_profile",
      status: "active",
      capturedAt: new Date().toISOString()
    });

    await markRecentTargetAdd(normalized.profileSlug);

    const message = isNew
      ? `${target.displayName} added to target list.`
      : `${target.displayName} is already in your target list.`;

    await enqueueEvent({
      type: "target_added_success",
      message,
      payload: {
        targetId: target.targetId,
        profileUrl: target.profileUrl,
        profileSlug: target.profileSlug,
        deduped: !isNew
      }
    });

    await notify("LinkNest", message);
  } catch (error) {
    await enqueueEvent({
      type: "target_added_failed",
      message: "Could not add target due to an unexpected error.",
      payload: {
        reason: "exception",
        profileUrl: normalized.profileUrl,
        error: error instanceof Error ? error.message : String(error)
      }
    });
    await notify("LinkNest", "Could not add target. Check popup for details.");
  }
}

async function handleTargetDetected(payload) {
  const recent = await getRecentDetectionFingerprint(payload?.fingerprint);
  if (recent) return;

  await markRecentDetectionFingerprint(payload?.fingerprint);
  await enqueueEvent({
    type: "target_detected",
    message: `${payload?.displayName ?? "Target"} appeared in your feed.`,
    payload
  });
  await notify("LinkNest", `${payload?.displayName ?? "Target"} appeared in your feed.`);
  await logTargetDetection(payload);
}

async function scheduleBackgroundSync() {
  chrome.alarms.create(ALARM_IDS.REMINDERS, { periodInMinutes: 20 });
  chrome.alarms.create(ALARM_IDS.TARGET_SYNC, { periodInMinutes: 10 });
  chrome.alarms.create(ALARM_IDS.WRITE_FLUSH, { periodInMinutes: 1 });
}

async function getEvents() {
  const data = await chrome.storage.local.get(STORE_KEYS.EVENTS);
  return data[STORE_KEYS.EVENTS] ?? [];
}

async function enqueueEvent(event) {
  const events = await getEvents();
  const next = [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...event }, ...events].slice(
    0,
    CACHE_LIMITS.EVENTS
  );
  await chrome.storage.local.set({ [STORE_KEYS.EVENTS]: next });
  await recalculateUnreadCount(next);
}

async function markEventRead(eventId) {
  if (!eventId) return getEvents();
  const events = await getEvents();
  const next = events.map((event) =>
    event.id === eventId
      ? {
          ...event,
          readAt: event.readAt ?? new Date().toISOString()
        }
      : event
  );
  await chrome.storage.local.set({ [STORE_KEYS.EVENTS]: next });
  await recalculateUnreadCount(next);
  return next;
}

async function dismissEvent(eventId) {
  if (!eventId) return getEvents();
  const events = await getEvents();
  const next = events.filter((event) => event.id !== eventId);
  await chrome.storage.local.set({ [STORE_KEYS.EVENTS]: next });
  await recalculateUnreadCount(next);
  return next;
}

async function clearEvents() {
  const next = [];
  await chrome.storage.local.set({ [STORE_KEYS.EVENTS]: next });
  await recalculateUnreadCount(next);
  return next;
}

async function recalculateUnreadCount(eventsInput) {
  const events = eventsInput ?? (await getEvents());
  const unreadCount = events.filter((event) => !event.readAt).length;
  await chrome.storage.local.set({ [STORE_KEYS.UNREAD_COUNT]: unreadCount });
  await applyUnreadBadge(unreadCount);
  return unreadCount;
}

async function applyUnreadBadge(unreadCountInput) {
  const unreadCount =
    unreadCountInput ??
    (await chrome.storage.local.get(STORE_KEYS.UNREAD_COUNT))[STORE_KEYS.UNREAD_COUNT] ??
    0;
  chrome.action.setBadgeBackgroundColor({ color: "#C62828" });
  chrome.action.setBadgeText({ text: unreadCount > 0 ? String(Math.min(unreadCount, 99)) : "" });
}

async function notify(title, message) {
  const data = await chrome.storage.local.get(STORE_KEYS.SETTINGS);
  if (data[STORE_KEYS.SETTINGS]?.quietMode) return;

  chrome.notifications.create({
    type: "basic",
    title,
    message,
    iconUrl: "favicon.svg"
  });
}

async function isRecentTargetAdd(profileSlug) {
  const map = await readAndPruneTimestampCache(STORE_KEYS.RECENT_TARGET_ADD, {
    ttlMs: CACHE_TTL_MS.RECENT_TARGET_ADD,
    maxEntries: CACHE_LIMITS.RECENT_TARGET_ADD
  });
  const ts = map[profileSlug];
  return Boolean(ts && Date.now() - ts < CACHE_TTL_MS.RECENT_TARGET_ADD);
}

async function markRecentTargetAdd(profileSlug) {
  const map = await readAndPruneTimestampCache(STORE_KEYS.RECENT_TARGET_ADD, {
    ttlMs: CACHE_TTL_MS.RECENT_TARGET_ADD,
    maxEntries: CACHE_LIMITS.RECENT_TARGET_ADD
  });
  map[profileSlug] = Date.now();
  await chrome.storage.local.set({
    [STORE_KEYS.RECENT_TARGET_ADD]: enforceTimestampCacheLimits(map, {
      ttlMs: CACHE_TTL_MS.RECENT_TARGET_ADD,
      maxEntries: CACHE_LIMITS.RECENT_TARGET_ADD
    })
  });
}

async function getRecentDetectionFingerprint(fingerprint) {
  if (!fingerprint) return false;
  const map = await readAndPruneTimestampCache(STORE_KEYS.RECENT_FINGERPRINTS, {
    ttlMs: CACHE_TTL_MS.RECENT_FINGERPRINTS,
    maxEntries: CACHE_LIMITS.RECENT_FINGERPRINTS
  });
  const ts = map[fingerprint];
  if (!ts) return false;
  return Date.now() - ts < CACHE_TTL_MS.RECENT_FINGERPRINTS;
}

async function markRecentDetectionFingerprint(fingerprint) {
  if (!fingerprint) return;
  const map = await readAndPruneTimestampCache(STORE_KEYS.RECENT_FINGERPRINTS, {
    ttlMs: CACHE_TTL_MS.RECENT_FINGERPRINTS,
    maxEntries: CACHE_LIMITS.RECENT_FINGERPRINTS
  });
  map[fingerprint] = Date.now();
  await chrome.storage.local.set({
    [STORE_KEYS.RECENT_FINGERPRINTS]: enforceTimestampCacheLimits(map, {
      ttlMs: CACHE_TTL_MS.RECENT_FINGERPRINTS,
      maxEntries: CACHE_LIMITS.RECENT_FINGERPRINTS
    })
  });
}

async function runTargetSync(trigger = "background") {
  const result = await runSyncManager({
    syncDelta: syncTargetsDeltaApi,
    syncFull: syncTargetsFullApi,
    applyDelta: applyDeltaSync,
    applyFull: replaceAllTargets,
    metaKey: STORE_KEYS.SYNC_META
  });

  if (!result.ok) {
    await enqueueEvent({
      type: "target_sync_failed",
      message: "Target sync failed. Will retry automatically with backoff/fallback.",
      payload: {
        trigger,
        mode: result.mode,
        failCount: result.meta?.failCount ?? 0,
        error: result.error instanceof Error ? result.error.message : String(result.error)
      }
    });
  }

  return result;
}

async function getTargetsWithStaleWhileRevalidate() {
  const cache = await getTargetsCacheState(CACHE_TTL_MS.TARGET_CACHE_STALE);
  if (cache.stale) {
    void runTargetSync("stale_while_revalidate");
  }

  return cache;
}

async function enqueueTargetWrite(payload) {
  const result = await processWriteWithQueue({
    queueKey: STORE_KEYS.TARGET_WRITE_QUEUE,
    payload,
    executor: upsertTarget
  });

  if (!result.ok && !result.queued) {
    throw result.error ?? new Error("Failed to persist target write.");
  }

  return result.value ?? { target_id: payload.profile_url, status: "queued" };
}

async function enqueueInteractionWrite(event) {
  const normalized = normalizeInteractionEvent(event);
  if (!normalized) {
    return { ok: false, queued: false, error: new Error("Invalid interaction payload.") };
  }

  return processWriteWithQueue({
    queueKey: STORE_KEYS.INTERACTION_WRITE_QUEUE,
    payload: normalized,
    executor: async (eventsOrEvent) =>
      logInteractionBatch({ events: Array.isArray(eventsOrEvent) ? eventsOrEvent : [eventsOrEvent] })
  });
}

async function flushWriteQueues() {
  await flushQueue(STORE_KEYS.TARGET_WRITE_QUEUE, upsertTarget);
  const settings = await getSettings();
  if (settings.passiveLoggingEnabled) {
    await flushQueue(STORE_KEYS.INTERACTION_WRITE_QUEUE, async (events) => logInteractionBatch({ events }), {
      batchSize: INTERACTION_BATCH_SIZE
    });
  }
}

async function processWriteWithQueue({ queueKey, payload, executor }) {
  const queueData = await chrome.storage.local.get(queueKey);
  const queue = queueData[queueKey] ?? [];
  const now = Date.now();
  const firstPending = queue[0];
  const canAttemptNow = !firstPending?.nextRetryAt || firstPending.nextRetryAt <= now;

  if (!canAttemptNow) {
    queue.push(createQueuedWrite(payload));
    await chrome.storage.local.set({ [queueKey]: queue });
    return { ok: false, queued: true, error: new Error("Write deferred due to backoff window.") };
  }

  try {
    const value = await executor(payload);
    if (queue.length) {
      queue.push(createQueuedWrite(payload));
      await chrome.storage.local.set({ [queueKey]: queue });
      await flushQueue(queueKey, executor);
    }
    return { ok: true, queued: false, value };
  } catch (error) {
    queue.push(createQueuedWrite(payload, error));
    await chrome.storage.local.set({ [queueKey]: queue });
    return { ok: false, queued: true, error };
  }
}

async function flushQueue(queueKey, executor, options = {}) {
  const queueData = await chrome.storage.local.get(queueKey);
  const queue = queueData[queueKey] ?? [];
  if (!queue.length) return;

  const batchSize = options.batchSize && options.batchSize > 0 ? options.batchSize : 1;
  const now = Date.now();
  const remaining = [];
  const readyEntries = [];

  for (const entry of queue) {
    if (entry.nextRetryAt && entry.nextRetryAt > now) {
      remaining.push(entry);
      continue;
    }
    readyEntries.push(entry);
  }

  for (let idx = 0; idx < readyEntries.length; idx += batchSize) {
    const chunk = readyEntries.slice(idx, idx + batchSize);
    const chunkPayload = chunk.map((entry) => entry.payload);

    try {
      await executor(batchSize === 1 ? chunkPayload[0] : chunkPayload);
    } catch (error) {
      for (const entry of chunk) {
        remaining.push(createQueuedWrite(entry.payload, error, entry.attemptCount ?? 0));
      }
    }
  }

  await chrome.storage.local.set({ [queueKey]: remaining });
}

async function getSettings() {
  const data = await chrome.storage.local.get(STORE_KEYS.SETTINGS);
  return {
    quietMode: false,
    passiveLoggingEnabled: false,
    shadowScanIntervalMs: 1000,
    shadowSessionTimeoutMin: 30,
    ...(data[STORE_KEYS.SETTINGS] ?? {})
  };
}

function normalizeInteractionEvent(event) {
  if (!event || typeof event !== "object") return null;
  const { type, targetId = null, occurredAt, refId = null } = event;
  if (!type || !occurredAt) return null;
  return {
    type: String(type),
    targetId: targetId ? String(targetId) : null,
    occurredAt: String(occurredAt),
    refId: refId ? String(refId) : null
  };
}

function createQueuedWrite(payload, error = null, priorAttempts = 0) {
  const attemptCount = priorAttempts + 1;
  const backoff = WRITE_BACKOFF_MS[Math.min(attemptCount - 1, WRITE_BACKOFF_MS.length - 1)];
  return {
    id: crypto.randomUUID(),
    payload,
    attemptCount,
    queuedAt: Date.now(),
    nextRetryAt: Date.now() + backoff,
    lastError: error instanceof Error ? error.message : error ? String(error) : null
  };
}

async function readAndPruneTimestampCache(key, options) {
  const data = await chrome.storage.local.get(key);
  const cleaned = enforceTimestampCacheLimits(data[key] ?? {}, options);
  await chrome.storage.local.set({ [key]: cleaned });
  return cleaned;
}

function enforceTimestampCacheLimits(map, { ttlMs, maxEntries }) {
  const now = Date.now();
  const entries = Object.entries(map ?? {}).filter(([, ts]) => Number.isFinite(ts) && now - ts <= ttlMs);
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, maxEntries));
}

/**
 * Placeholder backend call specs.
 */
async function upsertTarget(payload) {
  return withBackendRetry("upsert_target", async () => ({
    status: "added",
    target_id: payload.profile_url,
    message: "Placeholder target upsert success"
  }));
}

async function startShadowSessionApi(payload) {
  return withBackendRetry("start_shadow_session", async () => ({
    session_id: crypto.randomUUID(),
    status: "running",
    ...payload
  }));
}

async function logTargetDetection(payload) {
  return withBackendRetry("log_target_detection", async () => ({ status: "logged", payload }));
}

async function generateResponseSuggestion(payload) {
  return withBackendRetry("generate_response_suggestion", async () => ({
    suggestions: [
      "Great insight—curious how this has changed your strategy in 2026?",
      "Thanks for sharing. What signal do you watch first when prioritizing this?"
    ],
    best_suggestion: "Great insight—curious how this has changed your strategy in 2026?",
    confidence: 0.62,
    contextEcho: payload.context_type
  }));
}

async function fetchFollowupReminders() {
  return withBackendRetry("fetch_followup_reminders", async () => ({
    reminders: []
  }));
}

async function logInteractionBatch(payload) {
  return withBackendRetry("log_interaction_batch", async () => ({
    accepted_count: payload.events?.length ?? 0,
    rejected_count: 0
  }));
}

async function syncTargetsDeltaApi() {
  return withBackendRetry("sync_targets_delta", async () => ({ changes: [] }));
}

async function syncTargetsFullApi() {
  return withBackendRetry("sync_targets_full", async () => ({ targets: [] }));
}

async function withBackendRetry(action, task, attempts = 2) {
  let attempt = 0;
  let lastError = null;

  while (attempt < attempts) {
    attempt += 1;
    try {
      const result = await task();
      await recordBackendStatus({
        action,
        status: "ok",
        retries: attempt - 1,
        lastSuccessAt: new Date().toISOString(),
        lastError: null
      });
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await wait(200);
      }
    }
  }

  await recordBackendStatus({
    action,
    status: "error",
    retries: attempts - 1,
    lastFailureAt: new Date().toISOString(),
    lastError: lastError instanceof Error ? lastError.message : String(lastError)
  });

  throw lastError;
}

async function recordBackendStatus(update) {
  const data = await chrome.storage.local.get(STORE_KEYS.BACKEND_STATUS);
  const current = data[STORE_KEYS.BACKEND_STATUS] ?? {};
  await chrome.storage.local.set({
    [STORE_KEYS.BACKEND_STATUS]: {
      ...current,
      ...update
    }
  });
}

async function recordSuggestTelemetry(counter) {
  const data = await chrome.storage.local.get(STORE_KEYS.SUGGEST_TELEMETRY);
  const current = data[STORE_KEYS.SUGGEST_TELEMETRY] ?? {
    requests: 0,
    success: 0,
    errors: 0
  };

  const next = {
    ...current,
    [counter]: (current[counter] ?? 0) + 1,
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [STORE_KEYS.SUGGEST_TELEMETRY]: next });
  return next;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

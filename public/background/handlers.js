import {
  getTargetsMap,
  normalizeLinkedInProfileUrl,
  removeLocalTarget,
  setTargetRelationshipStage,
  upsertLocalTarget
} from "../lib/stores/targetsStore.js";
import { normalizeInteractionEvent } from "../lib/schema/normalizers.js";
import { CACHE_LIMITS, CACHE_TTL_MS, INTERACTION_BATCH_SIZE, MENU_IDS, STORE_KEYS, WRITE_BACKOFF_MS } from "./constants.js";
import {
  clearEvents,
  dismissEvent,
  enqueueEvent,
  getEvents,
  markEventRead,
  notify,
  recalculateUnreadCount
} from "./notifications.js";
import { getTargetsWithStaleWhileRevalidate, runTargetSync } from "./sync.js";
import {
  validateProfileResponse,
  validateSuggestionContextResponse
} from "./validators.js";

const chrome = globalThis.chrome ?? globalThis.browser;

/**
 * Initialize extension settings once so downstream reads always have defaults.
 */
export async function ensureDefaultSettings() {
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

/**
 * Rebuild all context menus to ensure they match the current extension version.
 */
export async function registerContextMenus() {
  if (!chrome?.contextMenus?.create || !chrome?.contextMenus?.removeAll) return;

  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: MENU_IDS.SHADOW_ME, title: "LinkNest: Shadow Me", contexts: ["page"], documentUrlPatterns: ["https://www.linkedin.com/feed/*"] });
  chrome.contextMenus.create({
    id: MENU_IDS.SUGGEST_RESPONSE,
    title: "LinkNest: Suggest a Response",
    contexts: ["selection", "page"],
    documentUrlPatterns: ["https://www.linkedin.com/feed/*", "https://www.linkedin.com/messaging/*"]
  });
  chrome.contextMenus.create({ id: MENU_IDS.ADD_TARGET, title: "LinkNest: Add to Target List", contexts: ["page"], documentUrlPatterns: ["https://www.linkedin.com/in/*"] });
  chrome.contextMenus.create({ id: MENU_IDS.ANALYZE_PROFILE_MATCH, title: "LinkNest: Analyze Profile Match (Future)", contexts: ["page"], documentUrlPatterns: ["https://www.linkedin.com/in/*"] });
}

/**
 * When the active tab changes, recalculate badge state for LinkedIn tabs only.
 */
export async function refreshMenusForTab(tabId) {
  if (!chrome?.tabs?.get) return;

  const tab = await chrome.tabs.get(tabId);
  if (!tab?.url?.includes("linkedin.com")) return;
  await recalculateUnreadCount();
}

/**
 * Lightweight URL-to-context classifier used by telemetry and future branching logic.
 */
export function getPageContext(url) {
  if (/linkedin\.com\/feed/.test(url)) return "feed";
  if (/linkedin\.com\/in\//.test(url)) return "profile";
  return "none";
}

/**
 * Persist session state, notify the user, and start content-script shadow mode.
 */
export async function startShadowSession(tabId, apis) {
  const session = { startedAt: new Date().toISOString(), mode: "name_only", active: true, tabId };
  await chrome.storage.local.set({ [STORE_KEYS.SESSION]: session });
  await enqueueEvent({ type: "shadow_started", message: "Shadow mode started (name-only safe mode)." });
  await notify("LinkNest", "Shadow mode started.");
  await chrome.tabs.sendMessage(tabId, { type: "LN_START_SHADOW", payload: { mode: "name_only" } });
  await apis.startShadowSessionApi({ started_at: session.startedAt, mode: session.mode });
}

/**
 * Capture selected context from the tab, request a generated response, and emit result events.
 */
export async function requestSuggestion(tabId, apis) {
  await recordSuggestTelemetry("requests");
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "LN_CAPTURE_SUGGESTION_CONTEXT" });
    if (!validateSuggestionContextResponse(response)) throw new Error("Invalid suggestion context payload.");

    let text = response.text ?? "";
    let textMeta = response.textMeta ?? {};
    let resolvedContext = response;

    if (!text) {
      const fallback = await chrome.tabs.sendMessage(tabId, { type: "LN_PROMPT_SUGGESTION_CONTEXT" });
      const fallbackText = typeof fallback?.text === "string" ? fallback.text.trim() : "";
      if (!fallbackText) throw new Error("Select text or add a brief context, then try Suggest Response.");

      text = fallbackText;
      textMeta = {
        selectedChars: 0,
        capturedChars: fallbackText.length,
        wasTrimmed: false
      };
      resolvedContext = {
        ...response,
        contextType: "manual",
        text,
        highlightedText: fallbackText
      };
    }

    const contextType = mapSuggestionContextType(resolvedContext.contextType);
    await maybePromptAndAddAuthorToTargets(tabId, resolvedContext, apis);

    const suggestion = await apis.generateResponseSuggestion({
      context_type: contextType,
      text,
      tone: "professional",
      context: {
        highlightedText: resolvedContext.highlightedText ?? text,
        postText: resolvedContext.postText ?? null,
        commentText: resolvedContext.commentText ?? null,
        postUrl: resolvedContext.postUrl ?? null,
        author: resolvedContext.author ?? null
      }
    });
    await enqueueEvent({
      type: "suggestion_ready",
      message: "Suggestion generated.",
      payload: {
        bestSuggestion: suggestion.best_suggestion ?? "",
        confidence: suggestion.confidence ?? null,
        contextType: suggestion.contextEcho ?? contextType,
        contextSummary: {
          selectedChars: textMeta.selectedChars ?? text.length,
          capturedChars: textMeta.capturedChars ?? text.length,
          wasTrimmed: Boolean(textMeta.wasTrimmed),
          postUrl: resolvedContext.postUrl ?? null,
          authorName: resolvedContext.author?.displayName ?? null
        }
      }
    });
    await recordSuggestTelemetry("success");
    await notify("LinkNest", "Suggestion is ready in popup.");
    return { ok: true };
  } catch (error) {
    await enqueueEvent({ type: "suggestion_failed", message: error instanceof Error ? error.message : "Suggestion generation failed.", payload: { reason: "suggestion_request_error" } });
    await recordSuggestTelemetry("errors");
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function mapSuggestionContextType(rawType) {
  if (rawType === "comment") return "comment_reply";
  if (rawType === "dm") return "dm_reply";
  if (rawType === "manual") return "manual_context";
  return "post";
}

async function maybePromptAndAddAuthorToTargets(tabId, context, apis) {
  if (context?.contextType !== "post") return;

  const author = context.author ?? {};
  const normalized = normalizeLinkedInProfileUrl(author.profileUrl ?? "");
  if (!normalized) return;

  const targetsMap = await getTargetsMap();
  if (targetsMap[normalized.profileSlug]) return;

  const confirmResponse = await chrome.tabs.sendMessage(tabId, {
    type: "LN_CONFIRM_ADD_AUTHOR_TO_TARGETS",
    payload: { displayName: author.displayName ?? "Unknown" }
  });

  if (!confirmResponse?.ok || !confirmResponse.accepted) return;

  const apiResult = await enqueueTargetWrite(
    {
      profile_url: normalized.profileUrl,
      display_name: author.displayName ?? "Unknown",
      source: "feed_post_author",
      captured_at: new Date().toISOString()
    },
    apis
  );

  const { target, isNew } = await upsertLocalTarget({
    targetId: apiResult.target_id,
    profileUrl: normalized.profileUrl,
    displayName: author.displayName ?? "Unknown",
    source: "feed_post_author",
    status: "active",
    capturedAt: new Date().toISOString()
  });

  await enqueueEvent({
    type: "target_added_success",
    message: isNew
      ? `${target.displayName} added to target list from feed suggestion flow.`
      : `${target.displayName} is already in your target list.`,
    payload: {
      targetId: target.targetId,
      profileUrl: target.profileUrl,
      profileSlug: target.profileSlug,
      source: "suggestion_author_prompt"
    }
  });
}

/**
 * Resolve the current active LinkedIn tab and proxy suggestion generation through it.
 */
export async function requestSuggestionFromActiveTab(source, apis) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.includes("linkedin.com")) {
    await enqueueEvent({ type: "suggestion_failed", message: "Open a LinkedIn tab to generate suggestions.", payload: { reason: "no_active_linkedin_tab", source } });
    return { ok: false, error: "No active LinkedIn tab found." };
  }

  return requestSuggestion(tab.id, apis);
}

/**
 * Generate a suggestion from manually provided context when no selection exists.
 */
export async function requestSuggestionFromManualContext(payload, apis) {
  const manualText = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!manualText) {
    return { ok: false, error: "Add context text to generate a suggestion." };
  }

  const manualType = payload?.contextType === "comment" || payload?.contextType === "dm" ? payload.contextType : "post";
  const mappedContextType = mapSuggestionContextType(manualType);

  try {
    await recordSuggestTelemetry("requests");
    const suggestion = await apis.generateResponseSuggestion({
      context_type: mappedContextType,
      text: manualText,
      tone: "professional",
      context: {
        highlightedText: manualText,
        postText: manualType === "post" ? manualText : null,
        commentText: manualType === "comment" ? manualText : null
      }
    });
    await enqueueEvent({
      type: "suggestion_ready",
      message: "Suggestion generated from manual context.",
      payload: {
        bestSuggestion: suggestion.best_suggestion ?? "",
        confidence: suggestion.confidence ?? null,
        contextType: suggestion.contextEcho ?? mappedContextType,
        contextSummary: {
          selectedChars: manualText.length,
          capturedChars: manualText.length,
          wasTrimmed: false,
          source: "manual_popup"
        }
      }
    });
    await recordSuggestTelemetry("success");
    return { ok: true };
  } catch (error) {
    await enqueueEvent({
      type: "suggestion_failed",
      message: error instanceof Error ? error.message : "Suggestion generation failed.",
      payload: { reason: "manual_suggestion_request_error" }
    });
    await recordSuggestTelemetry("errors");
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Extract and normalize profile details from a tab, then upsert both remote and local target records.
 */
export async function addTargetFromProfile(tabId, apis) {
  const profile = await chrome.tabs.sendMessage(tabId, { type: "LN_EXTRACT_PROFILE_MINIMAL" });
  if (!validateProfileResponse(profile)) throw new Error("Invalid profile payload received from content script.");

  const normalized = normalizeLinkedInProfileUrl(profile?.profileUrl);
  if (!normalized) {
    await enqueueEvent({ type: "target_added_failed", message: "Could not add target: invalid LinkedIn profile URL.", payload: { reason: "invalid_profile_url", rawProfileUrl: profile?.profileUrl ?? null } });
    await notify("LinkNest", "Could not extract profile details.");
    return;
  }

  if (await isRecentTargetAdd(normalized.profileSlug)) return;

  try {
    const apiResult = await enqueueTargetWrite({ profile_url: normalized.profileUrl, display_name: profile?.displayName, headline: profile?.headline, source: "linkedin_profile", captured_at: new Date().toISOString() }, apis);

    const { target, isNew } = await upsertLocalTarget({ targetId: apiResult.target_id, profileUrl: normalized.profileUrl, displayName: profile?.displayName, headline: profile?.headline, source: "linkedin_profile", status: "active", capturedAt: new Date().toISOString() });
    await markRecentTargetAdd(normalized.profileSlug);
    const message = isNew ? `${target.displayName} added to target list.` : `${target.displayName} is already in your target list.`;
    await enqueueEvent({ type: "target_added_success", message, payload: { targetId: target.targetId, profileUrl: target.profileUrl, profileSlug: target.profileSlug, deduped: !isNew } });
    await notify("LinkNest", message);
  } catch (error) {
    await enqueueEvent({ type: "target_added_failed", message: "Could not add target due to an unexpected error.", payload: { reason: "exception", profileUrl: normalized.profileUrl, error: error instanceof Error ? error.message : String(error) } });
    await notify("LinkNest", "Could not add target. Check popup for details.");
  }
}

/**
 * Analyze a profile for target-fit and surface a backend recommendation.
 */
export async function analyzeTargetFromProfile(tabId, apis) {
  const profile = await chrome.tabs.sendMessage(tabId, { type: "LN_EXTRACT_PROFILE_MINIMAL" });
  if (!validateProfileResponse(profile)) throw new Error("Invalid profile payload received from content script.");

  const normalized = normalizeLinkedInProfileUrl(profile?.profileUrl);
  if (!normalized) {
    return { ok: false, error: "Could not analyze profile: invalid LinkedIn profile URL." };
  }

  const analysis = await apis.analyzeProfileMatchApi({
    profile_url: normalized.profileUrl,
    display_name: profile?.displayName ?? "Unknown",
    headline: profile?.headline ?? ""
  });

  await enqueueEvent({
    type: "target_analysis_ready",
    message: `${profile?.displayName ?? "Profile"} analysis: ${analysis?.decision === "add_target" ? "Add target" : "Move on"}.`,
    payload: {
      profileUrl: normalized.profileUrl,
      profileSlug: normalized.profileSlug,
      displayName: profile?.displayName ?? "Unknown",
      decision: analysis?.decision ?? "move_on",
      confidence: analysis?.confidence ?? null,
      reason: analysis?.reason ?? null
    }
  });

  return { ok: true, analysis };
}

/**
 * Handle detected-target events with fingerprint dedupe and user-facing notifications.
 */
export async function handleTargetDetected(payload, apis) {
  const recent = await getRecentDetectionFingerprint(payload?.fingerprint);
  if (recent) return;

  await markRecentDetectionFingerprint(payload?.fingerprint);
  await enqueueEvent({ type: "target_detected", message: `${payload?.displayName ?? "Target"} appeared in your feed.`, payload });
  await notify("LinkNest", `${payload?.displayName ?? "Target"} appeared in your feed.`);
  await apis.logTargetDetection(payload);
}

/**
 * Primary runtime message router shared by popup and content scripts.
 */
export async function handleRuntimeMessage(message, apis) {
  if (message.type === "LN_TARGET_DETECTED") {
    await handleTargetDetected(message.payload, apis);
    return { ok: true };
  }

  if (message.type === "LN_INTERACTION_LOG") {
    const settings = await getSettings();
    if (!settings.passiveLoggingEnabled) return { ok: true, skipped: true, reason: "passive_logging_disabled" };

    await enqueueInteractionWrite(message.payload, apis);
    return { ok: true, skipped: false };
  }

  if (message.type === "LN_REQUEST_POPUP_EVENTS") return { ok: true, events: await getEvents() };

  if (message.type === "LN_POPUP_GET_STATE") {
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
    return {
      ok: true,
      events,
      settings: data[STORE_KEYS.SETTINGS] ?? {},
      session: data[STORE_KEYS.SESSION] ?? null,
      syncMeta: data[STORE_KEYS.SYNC_META] ?? { lastSyncAt: null },
      backendStatus: data[STORE_KEYS.BACKEND_STATUS] ?? {},
      unreadCount: data[STORE_KEYS.UNREAD_COUNT] ?? 0,
      suggestTelemetry: data[STORE_KEYS.SUGGEST_TELEMETRY] ?? { requests: 0, success: 0, errors: 0 },
      interactionQueue: (data[STORE_KEYS.INTERACTION_WRITE_QUEUE] ?? []).map((entry) => ({ id: entry.id, attemptCount: entry.attemptCount ?? 0, queuedAt: entry.queuedAt ?? null, nextRetryAt: entry.nextRetryAt ?? null, payload: entry.payload }))
    };
  }

  if (message.type === "LN_POPUP_MARK_EVENT_READ") return { ok: true, events: await markEventRead(message.payload.eventId) };
  if (message.type === "LN_POPUP_DISMISS_EVENT") return { ok: true, events: await dismissEvent(message.payload.eventId) };
  if (message.type === "LN_POPUP_CLEAR_EVENTS") return { ok: true, events: await clearEvents() };

  if (message.type === "LN_POPUP_REFRESH_TARGETS") {
    await runTargetSync(apis, "manual_popup_refresh");
    const metaData = await chrome.storage.local.get([STORE_KEYS.SYNC_META, STORE_KEYS.BACKEND_STATUS]);
    return { ok: true, syncMeta: metaData[STORE_KEYS.SYNC_META] ?? { lastSyncAt: null }, backendStatus: metaData[STORE_KEYS.BACKEND_STATUS] ?? {} };
  }

  if (message.type === "LN_POPUP_REQUEST_SUGGESTION") {
    const result = await requestSuggestionFromActiveTab("popup_button", apis);
    return { ok: result.ok, error: result.error ?? null };
  }

  if (message.type === "LN_POPUP_REQUEST_SUGGESTION_MANUAL") {
    return requestSuggestionFromManualContext(message.payload ?? {}, apis);
  }

  if (message.type === "LN_POPUP_ADD_TARGET_FROM_ACTIVE_PROFILE") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab?.url?.includes("linkedin.com/in/")) {
      return { ok: false, error: "Open a LinkedIn profile page to add a target." };
    }

    await addTargetFromProfile(tab.id, apis);
    return { ok: true };
  }

  if (message.type === "LN_POPUP_ANALYZE_ACTIVE_PROFILE") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab?.url?.includes("linkedin.com/in/")) {
      return { ok: false, error: "Open a LinkedIn profile page to analyze a target." };
    }

    return analyzeTargetFromProfile(tab.id, apis);
  }

  if (message.type === "LN_POPUP_REMOVE_TARGET") {
    const profileSlug = message.payload?.profileSlug;
    const result = await removeLocalTarget(profileSlug);
    if (!result.removed) return { ok: false, error: "Target was not found." };
    await enqueueEvent({
      type: "target_removed",
      message: `${result.target.displayName} removed from target list.`,
      payload: { profileSlug: result.target.profileSlug, profileUrl: result.target.profileUrl }
    });
    return { ok: true };
  }

  if (message.type === "LN_POPUP_SET_TARGET_STAGE") {
    const profileSlug = message.payload?.profileSlug;
    const relationshipStage = message.payload?.relationshipStage;
    const result = await setTargetRelationshipStage(profileSlug, relationshipStage);
    if (!result.updated) return { ok: false, error: "Target was not found." };
    return { ok: true, target: result.target };
  }

  if (message.type === "LN_POPUP_CLEAR_INTERACTION_QUEUE") {
    await chrome.storage.local.set({ [STORE_KEYS.INTERACTION_WRITE_QUEUE]: [] });
    return { ok: true };
  }

  if (message.type === "LN_TARGETS_GET_SWR") return { ok: true, ...(await getTargetsWithStaleWhileRevalidate(apis)) };
  return { ok: false };
}

/**
 * Retry any queued writes that previously failed due to transient backend/network issues.
 */
export async function flushWriteQueues(apis) {
  await flushQueue(STORE_KEYS.TARGET_WRITE_QUEUE, apis.upsertTarget);
  const settings = await getSettings();
  if (settings.passiveLoggingEnabled) {
    await flushQueue(STORE_KEYS.INTERACTION_WRITE_QUEUE, async (events) => apis.logInteractionBatch({ events }), {
      batchSize: INTERACTION_BATCH_SIZE
    });
  }
}

/**
 * Queue-aware write helper for target upserts.
 */
async function enqueueTargetWrite(payload, apis) {
  const result = await processWriteWithQueue({ queueKey: STORE_KEYS.TARGET_WRITE_QUEUE, payload, executor: apis.upsertTarget });
  if (!result.ok && !result.queued) throw result.error ?? new Error("Failed to persist target write.");
  return result.value ?? { target_id: payload.profile_url, status: "queued" };
}

/**
 * Queue-aware write helper for interaction logs (batch-capable API shape).
 */
async function enqueueInteractionWrite(event, apis) {
  const normalized = normalizeInteractionEvent(event);
  if (!normalized) return { ok: false, queued: false, error: new Error("Invalid interaction payload.") };

  return processWriteWithQueue({ queueKey: STORE_KEYS.INTERACTION_WRITE_QUEUE, payload: normalized, executor: async (eventsOrEvent) => apis.logInteractionBatch({ events: Array.isArray(eventsOrEvent) ? eventsOrEvent : [eventsOrEvent] }) });
}

/**
 * Optimistically attempt an immediate write; enqueue and back off on failure.
 */
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

/**
 * Drain queued writes that are eligible to retry, preserving deferred entries.
 */
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

/**
 * Read settings with hardcoded defaults so missing keys never break logic paths.
 */
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

/**
 * Wrap a payload in queue metadata (attempt count, backoff, timing, last error).
 */
function createQueuedWrite(payload, error = null, priorAttempts = 0) {
  const attemptCount = priorAttempts + 1;
  const backoff = WRITE_BACKOFF_MS[Math.min(attemptCount - 1, WRITE_BACKOFF_MS.length - 1)];
  return { id: crypto.randomUUID(), payload, attemptCount, queuedAt: Date.now(), nextRetryAt: Date.now() + backoff, lastError: error instanceof Error ? error.message : error ? String(error) : null };
}

/**
 * Read a timestamp cache map, prune stale entries, and persist the cleaned version.
 */
async function readAndPruneTimestampCache(key, options) {
  const data = await chrome.storage.local.get(key);
  const cleaned = enforceTimestampCacheLimits(data[key] ?? {}, options);
  await chrome.storage.local.set({ [key]: cleaned });
  return cleaned;
}

/**
 * Enforce TTL and max-size constraints on timestamp maps used for dedupe throttling.
 */
function enforceTimestampCacheLimits(map, { ttlMs, maxEntries }) {
  const now = Date.now();
  const entries = Object.entries(map ?? {}).filter(([, ts]) => Number.isFinite(ts) && now - ts <= ttlMs);
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, maxEntries));
}

/**
 * Check whether a profile was recently added, preventing rapid duplicate writes.
 */
async function isRecentTargetAdd(profileSlug) {
  const map = await readAndPruneTimestampCache(STORE_KEYS.RECENT_TARGET_ADD, { ttlMs: CACHE_TTL_MS.RECENT_TARGET_ADD, maxEntries: CACHE_LIMITS.RECENT_TARGET_ADD });
  const ts = map[profileSlug];
  return Boolean(ts && Date.now() - ts < CACHE_TTL_MS.RECENT_TARGET_ADD);
}

/**
 * Mark profile slug as recently added for short-lived duplicate prevention.
 */
async function markRecentTargetAdd(profileSlug) {
  const map = await readAndPruneTimestampCache(STORE_KEYS.RECENT_TARGET_ADD, { ttlMs: CACHE_TTL_MS.RECENT_TARGET_ADD, maxEntries: CACHE_LIMITS.RECENT_TARGET_ADD });
  map[profileSlug] = Date.now();
  await chrome.storage.local.set({ [STORE_KEYS.RECENT_TARGET_ADD]: enforceTimestampCacheLimits(map, { ttlMs: CACHE_TTL_MS.RECENT_TARGET_ADD, maxEntries: CACHE_LIMITS.RECENT_TARGET_ADD }) });
}

/**
 * Check whether a detection fingerprint was recently observed.
 */
async function getRecentDetectionFingerprint(fingerprint) {
  if (!fingerprint) return false;
  const map = await readAndPruneTimestampCache(STORE_KEYS.RECENT_FINGERPRINTS, { ttlMs: CACHE_TTL_MS.RECENT_FINGERPRINTS, maxEntries: CACHE_LIMITS.RECENT_FINGERPRINTS });
  const ts = map[fingerprint];
  return Boolean(ts && Date.now() - ts < CACHE_TTL_MS.RECENT_FINGERPRINTS);
}

/**
 * Record a detection fingerprint with TTL so repeated scans do not spam users.
 */
async function markRecentDetectionFingerprint(fingerprint) {
  if (!fingerprint) return;
  const map = await readAndPruneTimestampCache(STORE_KEYS.RECENT_FINGERPRINTS, { ttlMs: CACHE_TTL_MS.RECENT_FINGERPRINTS, maxEntries: CACHE_LIMITS.RECENT_FINGERPRINTS });
  map[fingerprint] = Date.now();
  await chrome.storage.local.set({ [STORE_KEYS.RECENT_FINGERPRINTS]: enforceTimestampCacheLimits(map, { ttlMs: CACHE_TTL_MS.RECENT_FINGERPRINTS, maxEntries: CACHE_LIMITS.RECENT_FINGERPRINTS }) });
}

/**
 * Increment suggestion request telemetry counters for popup analytics/debugging.
 */
async function recordSuggestTelemetry(counter) {
  const data = await chrome.storage.local.get(STORE_KEYS.SUGGEST_TELEMETRY);
  const current = data[STORE_KEYS.SUGGEST_TELEMETRY] ?? { requests: 0, success: 0, errors: 0 };
  const next = { ...current, [counter]: (current[counter] ?? 0) + 1, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [STORE_KEYS.SUGGEST_TELEMETRY]: next });
  return next;
}

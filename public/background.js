import { applyDeltaSync, normalizeLinkedInProfileUrl, upsertLocalTarget } from "./lib/stores/targetsStore.js";

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
  RECENT_FINGERPRINTS: "ln_recent_fingerprints",
  RECENT_TARGET_ADD: "ln_recent_target_add"
};

const ALARM_IDS = {
  REMINDERS: "ln_poll_reminders",
  TARGET_SYNC: "ln_targets_delta_sync"
};

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaultSettings();
  await registerContextMenus();
  scheduleBackgroundSync();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleBackgroundSync();
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
      await logInteractionBatch({ events: [message.payload] });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "LN_REQUEST_POPUP_EVENTS") {
      const events = await getEvents();
      sendResponse({ ok: true, events });
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
    await syncTargetsDelta();
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

  const context = getPageContext(tab.url);
  chrome.action.setBadgeText({ tabId, text: context === "none" ? "" : "LN" });
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
  const response = await chrome.tabs.sendMessage(tabId, { type: "LN_CAPTURE_SUGGESTION_CONTEXT" });
  const text = response?.text ?? "";

  const suggestion = await generateResponseSuggestion({
    context_type: "post",
    text,
    tone: "professional"
  });

  await enqueueEvent({
    type: "suggestion_ready",
    message: "Suggestion generated.",
    payload: suggestion
  });

  await notify("LinkNest", "Suggestion is ready in popup.");
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
    const apiResult = await upsertTarget({
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
}

async function getEvents() {
  const data = await chrome.storage.local.get(STORE_KEYS.EVENTS);
  return data[STORE_KEYS.EVENTS] ?? [];
}

async function enqueueEvent(event) {
  const events = await getEvents();
  const next = [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...event }, ...events].slice(0, 100);
  await chrome.storage.local.set({ [STORE_KEYS.EVENTS]: next });
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
  const data = await chrome.storage.local.get(STORE_KEYS.RECENT_TARGET_ADD);
  const map = data[STORE_KEYS.RECENT_TARGET_ADD] ?? {};
  const ts = map[profileSlug];
  return Boolean(ts && Date.now() - ts < 30 * 1000);
}

async function markRecentTargetAdd(profileSlug) {
  const data = await chrome.storage.local.get(STORE_KEYS.RECENT_TARGET_ADD);
  const map = data[STORE_KEYS.RECENT_TARGET_ADD] ?? {};
  map[profileSlug] = Date.now();
  await chrome.storage.local.set({ [STORE_KEYS.RECENT_TARGET_ADD]: map });
}

async function getRecentDetectionFingerprint(fingerprint) {
  if (!fingerprint) return false;
  const data = await chrome.storage.local.get(STORE_KEYS.RECENT_FINGERPRINTS);
  const map = data[STORE_KEYS.RECENT_FINGERPRINTS] ?? {};
  const ts = map[fingerprint];
  if (!ts) return false;
  return Date.now() - ts < 5 * 60 * 1000;
}

async function markRecentDetectionFingerprint(fingerprint) {
  if (!fingerprint) return;
  const data = await chrome.storage.local.get(STORE_KEYS.RECENT_FINGERPRINTS);
  const map = data[STORE_KEYS.RECENT_FINGERPRINTS] ?? {};
  map[fingerprint] = Date.now();
  await chrome.storage.local.set({ [STORE_KEYS.RECENT_FINGERPRINTS]: map });
}

async function syncTargetsDelta() {
  const metaData = await chrome.storage.local.get(STORE_KEYS.SYNC_META);
  const meta = metaData[STORE_KEYS.SYNC_META] ?? { lastSyncAt: null };

  const result = await syncTargetsDeltaApi({ updated_since: meta.lastSyncAt });
  if (Array.isArray(result.changes)) {
    await applyDeltaSync(result.changes);
  }

  await chrome.storage.local.set({
    [STORE_KEYS.SYNC_META]: {
      ...meta,
      lastSyncAt: new Date().toISOString()
    }
  });
}

/**
 * Placeholder backend call specs.
 */
async function upsertTarget(payload) {
  return {
    status: "added",
    target_id: payload.profile_url,
    message: "Placeholder target upsert success"
  };
}

async function startShadowSessionApi(payload) {
  return {
    session_id: crypto.randomUUID(),
    status: "running",
    ...payload
  };
}

async function logTargetDetection(payload) {
  return { status: "logged", payload };
}

async function generateResponseSuggestion(payload) {
  return {
    suggestions: [
      "Great insight—curious how this has changed your strategy in 2026?",
      "Thanks for sharing. What signal do you watch first when prioritizing this?"
    ],
    best_suggestion: "Great insight—curious how this has changed your strategy in 2026?",
    confidence: 0.62,
    contextEcho: payload.context_type
  };
}

async function fetchFollowupReminders() {
  return {
    reminders: []
  };
}

async function logInteractionBatch(payload) {
  return { accepted_count: payload.events?.length ?? 0, rejected_count: 0 };
}

async function syncTargetsDeltaApi() {
  return { changes: [] };
}

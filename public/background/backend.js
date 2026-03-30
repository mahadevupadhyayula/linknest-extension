import { STORE_KEYS } from "./constants.js";
const chrome = globalThis.chrome ?? globalThis.browser;

/**
 * Canonical backend routes expected by the extension.
 * NOTE: Current implementations below are mocked placeholders and do not perform network fetches yet.
 */
export const BACKEND_ENDPOINTS = {
  upsertTarget: { method: "POST", path: "/api/targets/upsert" },
  startShadowSessionApi: { method: "POST", path: "/api/shadow/sessions" },
  logTargetDetection: { method: "POST", path: "/api/shadow/detections" },
  generateResponseSuggestion: { method: "POST", path: "/api/suggestions/generate" },
  fetchFollowupReminders: { method: "GET", path: "/api/reminders/followups" },
  logInteractionBatch: { method: "POST", path: "/api/interactions/batch" },
  syncTargetsDeltaApi: { method: "POST", path: "/api/targets/sync/delta" },
  syncTargetsFullApi: { method: "GET", path: "/api/targets/sync/full" }
};

export const backendApis = {
  upsertTarget,
  startShadowSessionApi,
  logTargetDetection,
  generateResponseSuggestion,
  fetchFollowupReminders,
  logInteractionBatch,
  syncTargetsDeltaApi,
  syncTargetsFullApi
};

/**
 * Placeholder for POST /api/targets/upsert
 */
async function upsertTarget(payload) {
  return withBackendRetry("upsert_target", async () => ({ status: "added", target_id: payload.profile_url, message: "Placeholder target upsert success" }));
}

/**
 * Placeholder for POST /api/shadow/sessions
 */
async function startShadowSessionApi(payload) {
  return withBackendRetry("start_shadow_session", async () => ({ session_id: crypto.randomUUID(), status: "running", ...payload }));
}

/**
 * Placeholder for POST /api/shadow/detections
 */
async function logTargetDetection(payload) {
  return withBackendRetry("log_target_detection", async () => ({ status: "logged", payload }));
}

/**
 * Placeholder for POST /api/suggestions/generate
 */
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

/**
 * Placeholder for GET /api/reminders/followups
 */
async function fetchFollowupReminders() {
  return withBackendRetry("fetch_followup_reminders", async () => ({ reminders: [] }));
}

/**
 * Placeholder for POST /api/interactions/batch
 */
async function logInteractionBatch(payload) {
  return withBackendRetry("log_interaction_batch", async () => ({ accepted_count: payload.events?.length ?? 0, rejected_count: 0 }));
}

/**
 * Placeholder for POST /api/targets/sync/delta
 */
async function syncTargetsDeltaApi() {
  return withBackendRetry("sync_targets_delta", async () => ({ changes: [] }));
}

/**
 * Placeholder for GET /api/targets/sync/full
 */
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
      await recordBackendStatus({ action, status: "ok", retries: attempt - 1, lastSuccessAt: new Date().toISOString(), lastError: null });
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(200);
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
  await chrome.storage.local.set({ [STORE_KEYS.BACKEND_STATUS]: { ...current, ...update } });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Placeholder backend client contracts for extension development.
 * Swap mocked bodies with real fetch calls when backend is available.
 */
export const BACKEND_ENDPOINTS = {
  upsertTarget: { method: "POST", path: "/api/targets/upsert" },
  syncTargetsDelta: { method: "POST", path: "/api/targets/sync/delta" },
  startShadowSession: { method: "POST", path: "/api/shadow/sessions" },
  logTargetDetection: { method: "POST", path: "/api/shadow/detections" },
  generateResponseSuggestion: { method: "POST", path: "/api/suggestions/generate" },
  fetchFollowupReminders: { method: "GET", path: "/api/reminders/followups" },
  logInteractionBatch: { method: "POST", path: "/api/interactions/batch" },
  ackNotification: { method: "POST", path: "/api/notifications/ack" }
};

/**
 * Planned backend endpoint: POST /api/targets/upsert
 */
export async function upsertTarget(payload) {
  return {
    status: "added",
    target_id: payload.profile_url,
    message: "Placeholder target upsert success"
  };
}

/**
 * Planned backend endpoint: POST /api/targets/sync/delta
 */
export async function syncTargetsDelta(payload) {
  return {
    updated_since: payload.updated_since ?? null,
    changes: []
  };
}

/**
 * Planned backend endpoint: POST /api/shadow/sessions
 */
export async function startShadowSession(payload) {
  return {
    session_id: crypto.randomUUID(),
    status: "running",
    ...payload
  };
}

/**
 * Planned backend endpoint: POST /api/shadow/detections
 */
export async function logTargetDetection(payload) {
  return {
    status: "logged",
    ...payload
  };
}

/**
 * Planned backend endpoint: POST /api/suggestions/generate
 */
export async function generateResponseSuggestion(payload) {
  return {
    suggestions: [
      "Great point—what metric changed this decision for you?",
      "Thanks for sharing. Curious how this performed in practice?"
    ],
    best_suggestion: "Great point—what metric changed this decision for you?",
    confidence: 0.6,
    context_type: payload.context_type
  };
}

/**
 * Planned backend endpoint: GET /api/reminders/followups
 */
export async function fetchFollowupReminders(payload) {
  return {
    since: payload.since ?? null,
    reminders: []
  };
}

/**
 * Planned backend endpoint: POST /api/interactions/batch
 */
export async function logInteractionBatch(payload) {
  return {
    accepted_count: payload.events?.length ?? 0,
    rejected_count: 0
  };
}

/**
 * Planned backend endpoint: POST /api/notifications/ack
 */
export async function ackNotification(payload) {
  return {
    status: "ok",
    ...payload
  };
}

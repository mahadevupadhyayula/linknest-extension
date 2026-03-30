/**
 * Placeholder backend client contracts for extension development.
 * Swap mocked bodies with real fetch calls when backend is available.
 */

export async function upsertTarget(payload) {
  return {
    status: "added",
    target_id: payload.profile_url,
    message: "Placeholder target upsert success"
  };
}

export async function syncTargetsDelta(payload) {
  return {
    updated_since: payload.updated_since ?? null,
    changes: []
  };
}

export async function startShadowSession(payload) {
  return {
    session_id: crypto.randomUUID(),
    status: "running",
    ...payload
  };
}

export async function logTargetDetection(payload) {
  return {
    status: "logged",
    ...payload
  };
}

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

export async function fetchFollowupReminders(payload) {
  return {
    since: payload.since ?? null,
    reminders: []
  };
}

export async function logInteractionBatch(payload) {
  return {
    accepted_count: payload.events?.length ?? 0,
    rejected_count: 0
  };
}

export async function ackNotification(payload) {
  return {
    status: "ok",
    ...payload
  };
}

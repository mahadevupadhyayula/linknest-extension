const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function validateEventIdPayload(payload) {
  return isObject(payload) && typeof payload.eventId === "string" && payload.eventId.length > 0;
}

const MESSAGE_VALIDATORS = {
  LN_TARGET_DETECTED: (payload) => isObject(payload),
  LN_INTERACTION_LOG: (payload) => isObject(payload),
  LN_REQUEST_POPUP_EVENTS: (payload) => payload == null,
  LN_POPUP_GET_STATE: (payload) => payload == null,
  LN_POPUP_MARK_EVENT_READ: validateEventIdPayload,
  LN_POPUP_DISMISS_EVENT: validateEventIdPayload,
  LN_POPUP_CLEAR_EVENTS: (payload) => payload == null,
  LN_POPUP_REFRESH_TARGETS: (payload) => payload == null,
  LN_POPUP_REQUEST_SUGGESTION: (payload) => payload == null,
  LN_POPUP_CLEAR_INTERACTION_QUEUE: (payload) => payload == null,
  LN_TARGETS_GET_SWR: (payload) => payload == null
};

export function validateInternalMessage(message) {
  if (!isObject(message) || typeof message.type !== "string") {
    return { ok: false, error: "Invalid message envelope." };
  }

  const validator = MESSAGE_VALIDATORS[message.type];
  if (!validator) {
    return { ok: false, error: `Unknown message type: ${message.type}` };
  }

  if (!validator(message.payload)) {
    return { ok: false, error: `Invalid payload for ${message.type}` };
  }

  return { ok: true };
}

export function validateSuggestionContextResponse(response) {
  if (!isObject(response)) return false;
  if (typeof response.text !== "string") return false;
  return response.textMeta == null || isObject(response.textMeta);
}

export function validateProfileResponse(response) {
  if (!isObject(response)) return false;
  return typeof response.profileUrl === "string" || response.profileUrl == null;
}

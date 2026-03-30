export const MENU_IDS = {
  SHADOW_ME: "ln_shadow_me",
  SUGGEST_RESPONSE: "ln_suggest_response",
  ADD_TARGET: "ln_add_target",
  ANALYZE_PROFILE_MATCH: "ln_analyze_profile_match"
};

export const STORE_KEYS = {
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

export const ALARM_IDS = {
  REMINDERS: "ln_poll_reminders",
  TARGET_SYNC: "ln_targets_delta_sync",
  WRITE_FLUSH: "ln_write_flush"
};

export const CACHE_LIMITS = {
  EVENTS: 100,
  RECENT_FINGERPRINTS: 500,
  RECENT_TARGET_ADD: 200
};

export const CACHE_TTL_MS = {
  RECENT_FINGERPRINTS: 5 * 60 * 1000,
  RECENT_TARGET_ADD: 30 * 1000,
  TARGET_CACHE_STALE: 5 * 60 * 1000
};

export const WRITE_BACKOFF_MS = [5_000, 30_000, 2 * 60_000, 10 * 60_000];
export const INTERACTION_BATCH_SIZE = 25;

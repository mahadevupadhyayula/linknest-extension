# chrome.storage.local schema reference

This document describes persisted keys used by LinkNest extension runtime.

## Core keys

| Key | Shape summary |
|---|---|
| `ln_events` | array of event objects `{ id, createdAt, type, message, payload?, readAt? }` |
| `ln_settings` | `{ quietMode, passiveLoggingEnabled, shadowScanIntervalMs, shadowSessionTimeoutMin }` |
| `ln_shadow_session` | `{ startedAt, mode, active, tabId }` |
| `ln_sync_meta` | `{ lastSyncAt, failCount, lastAttemptAt, lastSuccessAt, lastFailureAt, lastMode, lastError }` |
| `ln_backend_status` | last backend action status and error metadata |
| `ln_unread_count` | number |
| `ln_recent_fingerprints` | map fingerprint -> timestamp |
| `ln_recent_target_add` | map profileSlug -> timestamp |
| `ln_target_write_queue` | queue entries for target upsert retries |
| `ln_interaction_write_queue` | queue entries for interaction write retries |
| `ln_suggest_telemetry` | `{ requests, success, errors, updatedAt? }` |
| `ln_targets` | map profileSlug -> canonical target |
| `ln_targets_cache_meta` | `{ lastHydratedAt }` |

## Queue entry shape

```json
{
  "id": "uuid",
  "payload": {},
  "attemptCount": 1,
  "queuedAt": 1711965600000,
  "nextRetryAt": 1711965605000,
  "lastError": "optional error string"
}
```

## Target object shape

```json
{
  "targetId": "tgt_123",
  "profileUrl": "https://www.linkedin.com/in/jane-doe",
  "profileSlug": "jane-doe",
  "displayName": "Jane Doe",
  "headline": "Revenue Operations Leader",
  "source": "linkedin_profile",
  "status": "active",
  "relationshipStage": "cold",
  "capturedAt": "2026-04-01T10:00:00.000Z",
  "createdAt": "2026-04-01T10:00:00.000Z",
  "updatedAt": "2026-04-01T10:00:00.000Z"
}
```

## Migration notes

When changing any persisted shape:
1. Add defensive defaults for missing fields.
2. Keep backward-compat reads for at least one release.
3. Add a one-time migration path in background startup if needed.
4. Document changed keys in `CHANGELOG.md`.

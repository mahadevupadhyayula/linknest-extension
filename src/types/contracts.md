# Placeholder contract specs

## Planned backend endpoints (not wired yet)
- `POST /api/targets/upsert` → upsert target from LinkedIn profile payload.
- `POST /api/targets/sync/delta` → fetch incremental target changes since `updated_since`.
- `GET /api/targets/sync/full` → fetch full target snapshot for recovery sync.
- `POST /api/shadow/sessions` → record shadow mode session start/metadata.
- `POST /api/shadow/detections` → log a target detection event from feed scan.
- `POST /api/suggestions/generate` → generate response suggestions from selected context.
- `GET /api/reminders/followups` → fetch follow-up reminders.
- `POST /api/interactions/batch` → ingest interaction events in batches.
- `POST /api/notifications/ack` → mark reminder/notification delivery as acknowledged.

## Target cache (local canonical shape)
- Keyed by `profileSlug` under `ln_targets`.
- Stored shape:
  - `targetId`
  - `profileUrl` (normalized: `https://www.linkedin.com/in/<slug>`)
  - `profileSlug` (lowercased)
  - `displayName`
  - `headline`
  - `source`
  - `status`
  - `capturedAt`
  - `createdAt`
  - `updatedAt`

## upsertTarget
- Input: `profile_url`, `display_name`, `headline`, `source`, `captured_at`
- Output: `status`, `target_id`, `message`

## syncTargetsDelta
- Input: `updated_since`
- Output: `changes[]` (mapped into canonical local target shape)

## generateResponseSuggestion
- Input: `context_type`, `text`, `tone`, `target_id` (optional)
- Output: `suggestions[]`, `best_suggestion`, `confidence`

## fetchFollowupReminders
- Input: `since`, `limit`
- Output: `reminders[]`

## logInteractionBatch
- Input: `events[]`
- Output: `accepted_count`, `rejected_count`

## Event types (targets)
- `target_added_success`
- `target_added_failed`

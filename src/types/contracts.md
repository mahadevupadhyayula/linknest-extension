# Placeholder contract specs

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

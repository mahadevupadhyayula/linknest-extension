# Placeholder contract specs

## upsertTarget
- Input: profile_url, display_name, headline, source, captured_at
- Output: status, target_id, message

## syncTargetsDelta
- Input: updated_since
- Output: changes[]

## generateResponseSuggestion
- Input: context_type, text, tone, target_id (optional)
- Output: suggestions[], best_suggestion, confidence

## fetchFollowupReminders
- Input: since, limit
- Output: reminders[]

## logInteractionBatch
- Input: events[]
- Output: accepted_count, rejected_count

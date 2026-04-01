# Backend API schema examples (v1)

These examples define the minimum stable contract the extension expects.

## POST /api/targets/upsert

Request:
```json
{
  "profile_url": "https://www.linkedin.com/in/jane-doe",
  "display_name": "Jane Doe",
  "headline": "Revenue Operations Leader",
  "source": "linkedin_profile",
  "captured_at": "2026-04-01T10:00:00.000Z"
}
```

Response:
```json
{
  "status": "added",
  "target_id": "tgt_123",
  "message": "Target upserted"
}
```

## POST /api/targets/sync/delta

Request:
```json
{ "updated_since": "2026-04-01T09:00:00.000Z" }
```

Response:
```json
{ "changes": [] }
```

## GET /api/targets/sync/full

Response:
```json
{ "targets": [] }
```

## POST /api/shadow/sessions

Request:
```json
{ "started_at": "2026-04-01T10:00:00.000Z", "mode": "name_only" }
```

Response:
```json
{ "session_id": "sess_123", "status": "running" }
```

## POST /api/shadow/detections

Request:
```json
{ "displayName": "Jane Doe", "fingerprint": "fp_abc", "detectedAt": "2026-04-01T10:05:00.000Z" }
```

Response:
```json
{ "status": "logged" }
```

## POST /api/suggestions/generate

Request:
```json
{
  "context_type": "post",
  "text": "Interesting take on PLG onboarding...",
  "tone": "professional",
  "context": {
    "highlightedText": "Interesting take on PLG onboarding...",
    "postText": "...",
    "commentText": null,
    "postUrl": "https://www.linkedin.com/feed/update/...",
    "author": { "displayName": "Jane Doe", "profileUrl": "https://www.linkedin.com/in/jane-doe" }
  }
}
```

Response:
```json
{
  "suggestions": ["Great point..."],
  "best_suggestion": "Great point...",
  "confidence": 0.62
}
```

## GET /api/reminders/followups?since=<iso>&limit=<n>

Response:
```json
{ "reminders": [] }
```

## POST /api/interactions/batch

Request:
```json
{ "events": [] }
```

Response:
```json
{ "accepted_count": 10, "rejected_count": 0 }
```

## POST /api/notifications/ack

Request:
```json
{ "notification_id": "notif_123" }
```

Response:
```json
{ "status": "ok" }
```

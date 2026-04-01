# Backend retry and error semantics

This document defines retry behavior and queue semantics for backend calls.

## Current extension behavior references

- Writes are queued with exponential-ish backoff (`WRITE_BACKOFF_MS`).
- Interaction writes are batch-flushed.
- Target sync escalates from delta to full sync after repeated failures.

## Retry matrix

| Condition | Retry? | Notes |
|---|---|---|
| Network error / DNS / offline | Yes | Queue + backoff |
| Timeout | Yes | Queue + backoff |
| HTTP 429 | Yes | Respect `Retry-After` when present |
| HTTP 5xx | Yes | Queue + backoff |
| HTTP 400/404/409/422 | No | Treat as non-retryable validation/state errors |
| HTTP 401/403 | No | Auth remediation required |

## Queue/backoff policy

Use backoff windows from constants:
- 5s, 30s, 2m, 10m (then cap at 10m)

For queued entries store:
- `id`, `payload`, `attemptCount`, `queuedAt`, `nextRetryAt`, `lastError`

## Endpoint-specific guidance

- `POST /api/targets/upsert`: idempotent by profile URL + idempotency key.
- `POST /api/interactions/batch`: idempotent by event IDs; tolerate duplicate deliveries.
- `POST /api/shadow/detections`: dedupe by fingerprint/server window if possible.
- `POST /api/suggestions/generate`: no queueing needed for user-triggered immediate UX failures; return actionable error.
- sync endpoints: use delta normally; fallback to full after repeated delta failures.

## Error response contract

Preferred non-2xx JSON body:

```json
{
  "error": {
    "code": "string_machine_code",
    "message": "human readable",
    "retryable": false
  }
}
```

If `retryable=true`, client may override default matrix and requeue.

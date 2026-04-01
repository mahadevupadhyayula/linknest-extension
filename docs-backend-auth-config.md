# Backend auth and environment configuration

This document defines how the extension should discover backend environment settings and attach auth to API requests.

## Environment model

Recommended environment names:
- `development`
- `staging`
- `production`

Recommended base URLs:
- dev: `http://localhost:3000`
- staging: `https://staging-api.example.com`
- prod: `https://api.example.com`

## Config source of truth

Store runtime backend config in `chrome.storage.local` under a dedicated key (recommended: `ln_backend_config`):

```json
{
  "environment": "staging",
  "baseUrl": "https://staging-api.example.com",
  "auth": {
    "scheme": "Bearer",
    "accessToken": "<short-lived-token>",
    "expiresAt": "2026-04-01T12:00:00.000Z"
  },
  "updatedAt": "2026-04-01T10:00:00.000Z"
}
```

## Request headers

All backend requests should include:
- `Content-Type: application/json` (for JSON bodies)
- `Accept: application/json`
- `Authorization: Bearer <accessToken>`
- `X-LinkNest-Client: extension`
- `X-LinkNest-Version: <manifest.version>`

Optional:
- `Idempotency-Key` for write requests that may be retried.
- `X-Request-ID` for trace correlation.

## Token lifecycle

Recommended behavior:
1. Validate token freshness before each request.
2. If token is expired/near expiry, attempt refresh via backend auth endpoint (or re-auth flow).
3. If refresh fails, mark backend status and surface a user-facing event asking to reconnect.

## Failure behavior

- `401/403`: treat as auth failure (no blind retries); prompt re-auth.
- network/timeout/5xx: retry using the queue/backoff policy.

## Implementation notes

- Keep token material out of logs/events.
- Centralize auth header injection in a single request helper.
- Preserve existing backend status reporting (`ln_backend_status`) for observability.

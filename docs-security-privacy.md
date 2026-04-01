# Security, privacy, and retention notes

This extension handles LinkedIn-derived context and lightweight interaction metadata. Treat it as sensitive user data.

## Data minimization

- Collect only fields required for target tracking and suggestion generation.
- Avoid storing full post/comment bodies when a shorter excerpt is sufficient.
- Keep extraction scoped to explicit user-triggered actions where possible.

## Sensitive data handling

- Do not log access tokens, auth headers, or raw credentials.
- Avoid writing raw PII into error logs.
- Redact identifying fields in telemetry unless strictly required.

## Storage and retention

- Keep queue and dedupe maps bounded (size + TTL).
- Cap event history (`ln_events`) and prune old entries.
- Define backend retention windows for interaction logs and reminders.

## Transport security

- Use HTTPS-only backend URLs in staging/production.
- Reject mixed-content or insecure origins for API base URL.

## User control and safety

- Preserve human-in-the-loop behavior.
- No autonomous like/comment/message/post actions.
- Respect `quietMode` for notifications.

## Incident response baseline

- If data leak is suspected, rotate tokens and disable backend writes.
- Capture minimal diagnostics (`ln_backend_status`, sync metadata) for investigation.
- Publish remediation and changelog notes in the next release.

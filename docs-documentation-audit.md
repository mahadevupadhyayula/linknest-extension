# Documentation completeness audit

Short answer: **core required docs are now present** (with room for iterative improvements).

The project has strong coverage for architecture, event flow, local runbook, and placeholder backend contracts, but it is still missing a few docs that are usually required before production backend wiring and team handoff.

## What is already well documented

- High-level architecture and module responsibilities.
- Primary runtime flows (refresh/suggest/content extraction/shadow session).
- Build/load/runbook basics and MV3 troubleshooting.
- Placeholder backend contracts and endpoint inventory.

## Gaps that should be documented next (recommended)

### 1) Backend auth + environment configuration (required)

Missing details:
- where backend base URL is stored and overridden (dev/staging/prod)
- token lifecycle (acquire/refresh/revoke)
- exact required headers

Why this matters:
- different developers will implement incompatible auth assumptions without this.

### 2) Error and retry behavior per endpoint (required)

Missing details:
- which HTTP codes are retryable/non-retryable
- max retry attempts and backoff policy by endpoint
- queue drop/requeue rules for interaction batches

Why this matters:
- avoids duplicated events and silent data loss.

### 3) Canonical API schema examples (required)

Missing details:
- request/response JSON examples for every endpoint
- field-level constraints (required, nullable, enum values, max length)
- versioning strategy (`v1` pathing or schema version header)

Why this matters:
- prevents drift between extension expectations and backend implementation.

### 4) Storage schema reference (required)

Missing details:
- full `chrome.storage.local` key reference with example payloads
- migration strategy when key shape changes
- TTL/size limits and cleanup behavior

Why this matters:
- critical for debugging and safe upgrades.

### 5) Message contract reference (required)

Missing details:
- all runtime message types (`LN_*`) with payload/response schema
- sender/receiver matrix (popup/content/background)
- validation/failure behavior

Why this matters:
- runtime message mismatches are a common source of extension bugs.

### 6) Security/privacy and data handling policy (required)

Missing details:
- data classification (PII vs non-PII)
- retention/deletion policy
- logging redaction rules

Why this matters:
- needed for compliance and safe telemetry.

### 7) Operator/user guide (nice to have)

Missing details:
- plain-language usage guide for popup/sidepanel actions
- troubleshooting matrix by symptom

### 8) Release/operations runbook (nice to have)

Missing details:
- versioning + changelog process for releases
- rollback steps
- smoke-test checklist before publish

## Minimal "documentation complete" bar for this repo

Treat docs as complete for backend integration once all items below exist:

- [x] Backend auth/environment config doc (`docs-backend-auth-config.md`)
- [x] Endpoint-by-endpoint API schemas with examples (`docs-api-schema-examples.md`)
- [x] Retry/error semantics doc (`docs-retry-error-semantics.md`)
- [x] Runtime message contract catalog (`docs-message-contracts.md`)
- [x] Storage schema + migration notes (`docs-storage-schema.md`)
- [x] Security/privacy + retention note (`docs-security-privacy.md`)
- [x] Release smoke checklist (`docs-release-smoke-checklist.md`)

## Suggested implementation order

1. API schema/examples + auth config
2. Runtime message contract catalog
3. Storage schema/migrations
4. Retry/error semantics
5. Security/privacy note
6. Release checklist + user guide

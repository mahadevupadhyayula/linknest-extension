# Release smoke checklist

Use this checklist before tagging/publishing a new extension build.

## 1) Build integrity

- [ ] Run `npm ci` (or `npm install`) successfully.
- [ ] Run `npm run build` successfully.
- [ ] Run `npm run verify:build` and confirm:
  - `dist/manifest.json` exists
  - `dist/background.js` exists
  - manifest `background.service_worker` points to a valid file

## 2) Automated validation

- [ ] Run unit tests: `npm test -- --runInBand`.
- [ ] Run smoke script: `npm run test:smoke`.
- [ ] Ensure no new failing checks in CI for this commit/tag.

## 3) Extension load + startup

- [ ] Load unpacked extension from `dist/` in `chrome://extensions`.
- [ ] Confirm service worker starts without registration errors.
- [ ] Confirm popup opens and side panel is available on LinkedIn URLs.

## 4) Core user flows

- [ ] **Refresh targets** from popup succeeds and updates UI state.
- [ ] **Generate suggestion** works with selected text.
- [ ] **Generate suggestion** fallback prompt works when no selection exists.
- [ ] **Add target from profile** works on a LinkedIn profile page.
- [ ] **Shadow mode start/stop** works and emits bounded events.

## 5) Data + queue behavior

- [ ] `chrome.storage.local` contains expected keys (e.g., `ln_settings`, `ln_events`, `ln_backend_status`).
- [ ] Interaction write queue flushes without unbounded growth.
- [ ] Event list renders and unread count/badge behavior is sane.

## 6) Safety + policy checks

- [ ] No automation behaviors were introduced (no auto-like/comment/message/post).
- [ ] Human-in-the-loop controls are preserved for externally visible actions.
- [ ] Any new messaging paths validate payload shape before execution.
- [ ] New storage keys are documented and namespaced with `ln_`.

## 7) Release hygiene

- [ ] Update `CHANGELOG.md` for all user-visible/runtime/storage/contract changes.
- [ ] Confirm manifest version bump strategy is applied.
- [ ] Record rollback plan (previous stable tag/build artifact).
- [ ] Attach release notes with known limitations and migration notes.

## 8) Optional backend-connected checks (when API is wired)

- [ ] `POST /api/suggestions/generate` returns expected shape (`best_suggestion`, `confidence`).
- [ ] target sync delta/full fallback behavior is verified.
- [ ] reminders fetch + ack flow works end-to-end.
- [ ] interaction batch ingest is idempotent across retry scenarios.

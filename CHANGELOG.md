# Changelog

All notable extension behavior changes are documented in this file.

The format is loosely based on Keep a Changelog and uses semantic-style version labels.

## [Unreleased]

### Added
- README architecture diagram and explicit event-flow documentation.
- Developer runbook for loading the unpacked extension, simulating flows, and inspecting storage.
- Safe defaults PR-review checklist and known limitations section.
- Browser side panel entry point (`sidepanel.html`) that reuses LinkNest operator controls.

### Changed
- Extension action click now opens the LinkNest side panel.
- Side panel is enabled for LinkedIn tabs and disabled elsewhere.

## [0.8.0] - 2026-03-30

### Added
- Popup controls for target refresh and suggestion generation with status feedback.
- Local suggestion telemetry visibility in popup.
- Local passive interaction queue inspection and clear action in popup.

### Changed
- Background/popup state hydration to include sync metadata, backend status, unread count, and queue telemetry.

## [0.7.0] - 2026-03-29

### Added
- Shadow-mode scaffolding for visible-author scanning (`name_only` mode).
- Internal runtime message validators and normalized interaction smoke checks.

### Safety
- Explicit no-automation guardrails retained (no auto-like/comment/message/post).

## [0.6.0] - 2026-03-28

### Added
- Extension-side backend contract scaffolding and shared normalizers.
- Base event queue persistence and popup event review controls.

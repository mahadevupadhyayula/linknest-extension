# LinkNest Extension (Extension-only Plan Scaffold)

This repository currently implements the Chrome extension side only.
Backend calls are placeholder methods with documented input/output contracts.

## Architecture

- `public/background.js`: service worker orchestration.
  - Context menus by LinkedIn page type.
  - Event queue + notifications.
  - Placeholder backend method calls.
- `public/content.js`: LinkedIn page extraction + safe shadow mode hooks.
- `src/popup/*`: popup event surface and settings.
- `src/lib/*`: extension modules and placeholder backend client contracts.

## Safety defaults

- Human-in-the-loop actions only.
- No auto-like/comment/message/post.
- Shadow mode uses name-only visible-author detection concept.
- Minimal data extraction + rate limiting + dedupe paths.

## Placeholder backend specs

See `src/types/contracts.md` for concise contract shapes.

## Development

```bash
npm install
npm run build
```

Load unpacked extension from the built output directory according to your local browser setup.

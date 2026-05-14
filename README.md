# PR XP

Cross-browser (Chrome + Firefox) MV3 extension that gamifies GitHub code review.

## Development

```bash
npm install
npm run build
```

Build output: `dist/`.

### Load in Chrome
1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked → select `dist/`

### Load in Firefox
1. Open `about:debugging#/runtime/this-firefox`
2. Load Temporary Add-on → select `dist/manifest.json`

### Verify
- Open any PR page on github.com — a "PR XP" panel appears in the right sidebar.
- Open DevTools console — should see `[pr-xp] bg says { ok: true, data: 'pong' }`.

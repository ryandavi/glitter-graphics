# Gesture work — verification TODO

Branch: `masks-and-text`
Context: input/gesture hardening. Code is written but **not verified** — the
machine it was written on had no Node, so no tests, lint, or CSS build ran.

---

## 1. One-time environment setup (other computer)

```bash
# Node.js (macOS)
brew install node            # or: brew install nvm && nvm install --lts && nvm use --lts
node -v && npm -v

# Project deps (eslint, playwright, sass) — from repo root
npm install

# Playwright browser binaries (needed for the touch suite)
npx playwright install chromium webkit     # add firefox too: npx playwright install
```

---

## 2. Verify this session's changes

Run from repo root:

```bash
npm run lint            # eslint js admin/js
npm run test:quick      # node tests/run.js --tag quick   (includes the two new unit suites)
npm test                # full suite, if quick passes
npm run build:css       # only if any .scss changed this branch
npm run cache:bust      # re-stamp index.html ?v= hashes, then re-check git diff
```

Expected: `test:quick` runs `viewport-navigation-unit.js` and
`gesture-manager-unit.js` (both already registered in `tests/run.js`).

If `npm run cache:bust` changes `index.html` beyond the 6 files below, commit
that too — hashes were bumped by hand this session and may have drifted.

---

## 3. What was implemented (needs a real-device sanity pass)

| File | Change | What to check by hand |
|---|---|---|
| `js/classes/ViewportManager.js` | `queuePanBy` / `queueZoomByFactor` + `_flushQueuedInput` — frame-batched wheel input (these were **called but undefined** before, so wheel zoom/pan was throwing). Composed zoom factor clamped to `[0.5, 2]` per frame. `cancelQueuedInput()` wired into `prepareViewChange`, `startPan`, `panBy`, `transformByGesture`. | Mouse wheel pan + Ctrl/Cmd-wheel zoom on the canvas. Trackpad two-finger scroll + pinch. No jump/stutter; zoom stays anchored under the pointer. |
| `js/classes/ViewportManager.js` | `startInertia` bails on `prefers-reduced-motion: reduce`. | With Reduce Motion ON (macOS: System Settings → Accessibility → Display), a touch pan flick should stop dead, no glide. |
| `js/classes/GestureManager.js` | Palm rejection: a 2nd contact with a measured box > `palmRejectionContactPx` (60 CSS px long side, or ≥3× the first contact's area) is ignored instead of starting a pinch. No-op on devices reporting width/height of 0/1. | iPad + Apple Pencil, or any touchscreen: rest a palm while dragging one finger — drag should not flip to pinch/zoom. Normal two-finger pinch still works. |
| `js/classes/MaskEditor.js` | `_handlePointerMove` now iterates `getCoalescedEvents()` and stamps each sub-frame sample; smoothing anchor advances through all of them. Falls back to `[event]` (Safari). Active-layer lookup made null-safe. | Fast brush stroke with a pen or high-Hz mouse — line should be smooth, not faceted. Slow strokes unchanged. |
| `js/core/config.js` | Added `wheelZoomSensitivity: 0.002`, `secondFingerCommitSlopPx: 24`, `palmRejectionContactPx: 60` under `ui.gestures`. | — |
| `tests/gesture-manager-unit.js` | New assertion: broad 2nd contact stays out of the pinch pair. | Should pass in `test:quick`. |
| `tests/viewport-navigation-unit.js` | New assertions: queued pan deltas sum into one frame; composed zoom factors multiply and keep their anchor; reduced-motion suppresses inertia. Tail wrapped in an async IIFE (rAF flush is async in the test's fake timers). | Should pass in `test:quick`. |
| `index.html` | Bumped `?v=` cache hashes for the 6 touched files: `config.js`, `viewport-input.js`, `canvas-gestures.js`, `GestureManager.js`, `ViewportManager.js`, `MaskEditor.js`. | `npm run cache:bust` should be a no-op (or commit its output). |

### Cross-browser smoke (after `npx playwright install`)
- `node tests/touch-smoke.js` and the other `tests/touch-*.js` suites (Chromium touch emulation).
- Manual: wheel + pinch in **Firefox** and **Safari** specifically — neither was
  exercised. Safari trackpad pinch goes through the `gesturestart/change/end`
  fallback path in `js/ui/canvas-gestures.js`.

---

## 4. Deliberately NOT done (revisit later, needs product calls / hardware)

- **Mouse-vs-trackpad classification / per-device sensitivity curves** — browser
  heuristics for this are unreliable; skipped on purpose. `viewport-input.js`
  stays the single normalization boundary.
- **Gesture-preference UI** (zoom sensitivity slider, inertia on/off,
  natural-scroll toggle, double-tap behavior) — would feed
  `CONFIG.ui.gestures` / `PREFERENCES`, but no UI wired yet.
- **Selection-boundary routing polish** — expanded invisible hit area,
  selection-intent affordance, route hysteresis. Design decision.
- **Serialized gesture-completion transaction** — `finishActiveRoute` still
  fires `endGestureInteraction()` without awaiting async text/shape commits.
  Low observed risk; revisit if a fast re-grab during commit misbehaves.
- **Playwright multi-engine CI matrix** (Chromium/Firefox/WebKit desktop +
  Chromium Android + mobile WebKit) — infra task.
- **Physical-device checklist**: Mac trackpad, Windows precision trackpad,
  iPhone, iPad, Android phone/tablet, Windows touchscreen, Apple Pencil,
  hi-res mouse wheel.

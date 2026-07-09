# Touch & Pointer Input — Audit, Target Architecture, Codex Goals

**Date:** 2026-07-03 · **Status:** Audit complete (Fable). Goals TOUCH-1/2/3 ready for Codex dispatch.
**Companion docs:** `docs/UX-PLAN.md`, `docs/TEXT-LAYOUT-SPEC.md` (T-4), `docs/MASK-FEATURE-PLAN.md`, `docs/AUDIT.md`

Ryan's ask: touch works, but doesn't feel like a native design app (zooming the canvas, scaling stickers/text, brush). He invested heavy iteration getting here and fears a rewrite means re-fighting the same bugs. This doc is the mitigation: a full audit of what exists (with the bugs it found), a target architecture, and a **regression harness that lands BEFORE any refactor**. Migration is touch-only at first — the desktop mouse paths that already work are not touched until the end, and only optionally.

Must work on: real iPhone Safari, Chrome DevTools mobile emulation, desktop with mouse. Goals: single sources of truth, code reuse, best practices, future expansion.

---

## 1. Inventory — every input surface today

| Surface | File | Mechanism | Notes |
|---|---|---|---|
| Canvas gestures (zoom/pan/tap) | `ViewportManager.setupTouchGestures` (ViewportManager.js:349) | `TouchGestureHandler` on `previewContainer` | Also routes brush pan/tap to MaskEditor |
| Sticker/text transform (touch) | `LayerTransform.setupTouchGestures` (LayerTransform.js:426) | One `TouchGestureHandler` **per element** | Pan/pinch/rotate; created in StickerManager.js:484 and TextGlitterManager.js:1603 |
| Sticker/text drag (mouse) | `LayerTransform.setupMouseDrag` (LayerTransform.js:295) | mousedown/move/up | Separate code path from touch |
| Transform handles | `LayerTransform.attachHandleListeners` (LayerTransform.js:860) | mousedown only | **Desktop-only**; explicitly skipped on mobile (LayerTransform.js:585) |
| Mask brush (mouse/pen) | `MaskEditor._setupPointerListeners` (MaskEditor.js:321) | **Pointer events** + `setPointerCapture` | The modern pipeline; gates on `pointerType !== 'touch'` (MaskEditor.js:738) |
| Mask brush (touch) | `MaskEditor.handleTouchPan/handleTouchTap` (MaskEditor.js:409/441) | Called by ViewportManager's TouchGestureHandler callbacks | Second pipeline for the same feature |
| Viewport pan (mouse) | ViewportManager.js:52–68 | mousedown/move/up | Third pipeline for viewport |
| Tool click routing | `app.js handlePreviewContainerClick` (app.js:3446) | `pointerdown` + `click` + **mock click** from tap | Tap synthesizes `{type:'click', isSimpleTap:true}` (ViewportManager.js:448–472) |
| Wheel zoom | app.js:2473 | wheel | **Only when ZOOM tool active**; no ctrl+wheel, no trackpad pinch |
| Layer list reorder | `LayerManager.handleLayerTouchStart/Move/End` (LayerManager.js:1288+) | touchstart/move/end on drag handle | Panel UI, not canvas — low risk, out of scope until TOUCH-3 |
| Tooltips/popovers touch | utils.js:159 | `'ontouchstart' in window` | Capability check #2 |
| Mobile layout | MobileManager.js:7 | `innerWidth <= 800` | Capability check #3 — layout ≠ input capability |

**Gesture recognizer:** `js/classes/TouchGestureHandler.js` (427 lines) — touch events only (`touchstart/move/end/cancel`), instantiated **N+1 times** (once for the viewport + once per sticker/text element). Every instance also adds its own `document`-level touchend/touchcancel listeners (TouchGestureHandler.js:41).

## 2. Defects found in this audit (fold into TOUCH-2 unless noted)

1. **Dead callback wiring:** ViewportManager passes `onTouchStart`/`onTouchEnd` (ViewportManager.js:369–381) — TouchGestureHandler never calls either. `isTouchActive` is never set; the 50 ms ghost-click timer there is dead code. LayerTransform passes `preventPropagation: false` (LayerTransform.js:438) — also never read. Evidence the handler and its consumers have drifted apart.
2. **Pinch ignores the centroid:** `onPinchZoom(scale, centerX, centerY)` on layers (LayerTransform.js:499) discards `centerX/centerY` — a sticker scales about its own center, not between your fingers. Viewport pinch does anchor correctly (ViewportManager.js:417).
3. **No two-finger translate on layers:** during a layer pinch, `onTwoPan` is unwired, so the object can't be moved while scaling/rotating — a core native-feel gesture (Canva/Figma all do combined translate+scale+rotate).
4. **Double `saveState` per layer gesture:** `onGestureEnd` saves (LayerTransform.js:554) AND a separate raw `touchend` listener saves again (LayerTransform.js:567). Verify whether HistoryManager dedupes; if not, every touch drag writes two history entries.
5. **`document.elementFromPoint` on every touchmove** (TouchGestureHandler.js:126) — expensive per-move hit test, and only checks `changedTouches[0]`, so the second finger of a pinch is never validated.
6. **Mock-click "passkey":** taps become a fake event routed through the 160-line `handlePreviewContainerClick` type/button filter (app.js:3446–3517), coordinated with `ignoreNextClick` setTimeout flags of 100/100/150 ms (LayerTransform.js:325/408/938). Timing-based ghost-click suppression is exactly the class of bug Ryan kept re-fighting.
7. **Three coordinate-conversion paths:** `viewport.screenToCanvas` (the right one), `deltaX / viewport.currentZoom` (LayerTransform.js:478), and raw `getBoundingClientRect + scaleX` math repeated 4× inside `handlePreviewContainerClick` (app.js:3523+). The rect math is only correct because pan/zoom is applied to the wrapper — it silently breaks the day the transform chain changes.
8. **Three different "is mobile/touch" definitions** (`innerWidth <= 800`, `'ontouchstart' in window`, `pointerType === 'touch'`). Width-based gating of input is why Chrome emulation and real iPhones can behave differently: a narrow desktop window becomes "mobile", a wide iPad isn't. MaskEditor.js:734–738 already documents the correct rule — gate input on `pointerType`, layout on width.
9. **Viewport handler vs. per-element handlers coordinate by string convention:** both attach with `capture: true` and negotiate via `shouldIgnoreTarget` + `.closest('.sticker-element, .text-glitter-element')` + per-tool `pointerEvents` toggling loops (app.js:2593–2604). Any new interactive overlay type has to be threaded through all three places or gestures break.

## 3. Target architecture

**One input pipeline, pointer events, one recognizer, one router.**

```
previewContainer (touch-action: none)
   └─ GestureManager (js/classes/GestureManager.js — ONE instance, pointer events, capture)
        recognizes: tap, double-tap, drag, two-finger (pan+pinch+rotate as one composite)
        └─ routes by target resolved ONCE at gesture start:
             1. .ui-ignore-gestures            → ignore entirely
             2. tool === BRUSH                 → MaskEditor stroke API (existing handleTouchPan/Tap)
             3. two-finger starting on the SELECTED layer's frame → layer transform
                (translate + scale-about-centroid + rotate, one composite update)
             4. two-finger anywhere else       → viewport pinch-zoom + pan
             5. one finger on a layer (SELECT) → layer drag (selects on start, as today)
             6. one finger elsewhere           → viewport pan; release without move = tap
        └─ taps dispatch editor.handleWorkspaceAction(canvasPoint, targetInfo)
           (extracted from handlePreviewContainerClick's switch — shared by mouse click + touch tap;
            no mock events, no isSimpleTap, no ignoreNextClick timers)
```

- **Pointer events only for touch.** iOS Safari has supported them since 13; MaskEditor proves they work in this codebase. `pointerId` tracking replaces the touches Map; `setPointerCapture` on the container replaces the document-level orphan-touch cleanup (TouchGestureHandler.js:316–365) entirely — capture means ends outside the element still arrive.
- **Desktop mouse paths untouched in TOUCH-2.** GestureManager handles `pointerType === 'touch'` only and lets mouse/pen fall through to today's working handlers. Mouse unification is optional TOUCH-4, later, if ever. This is the regression firewall.
- **Hit-testing in canvas space,** not DOM space: `screenToCanvas` + existing `isPointInSticker` / `isPointInText` / `getTopVisibleLayerAtPoint`. Kills `elementFromPoint`-per-move and the per-tool `pointerEvents` toggling for touch.
- **Capability module** (`js/utils.js`): `Input.isCoarse` (`matchMedia('(pointer: coarse)')`), `Input.hasTouch` (`maxTouchPoints > 0`). Rule going forward: **layout decisions use `mobileManager.isMobile` (width); input decisions use `Input.*` / `pointerType`. Never the other way.**
- **One coordinate API:** everything converts through `viewport.screenToCanvas`. The rect math inside `handlePreviewContainerClick` is replaced during the `handleWorkspaceAction` extraction.

### Design decisions (recorded; "best practices, I trust you")

| # | Decision | Rationale |
|---|---|---|
| D1 | **Canva rule for pinch:** two fingers on the *already-selected* layer's frame = transform that layer; two fingers anywhere else = viewport zoom/pan. Pinch no longer auto-selects. | Today a pinch that happens to start over any sticker selects and scales it — accidental scaling while zooming a busy canvas. Requiring prior selection makes zoom predictable; one-finger drag still auto-selects, so selection stays one gesture away. |
| D2 | Layer two-finger gesture is **composite**: translate + scale about pinch centroid + rotate, applied together per frame. | This is the single biggest "native feel" gap (defects 2–3). |
| D3 | Transform handles come to touch (TOUCH-3) with `pointer: coarse` hit targets ≥ 44 px. | Precision path Apple-HIG style; pinch is for coarse adjustment, handles for exact. |
| D4 | Double-tap: canvas → zoom in (anchored, reuse `zoomIn`); double-tap at max-useful (≥ 4×) or second double-tap with no pan since → `zoomToFit`. Double-tap on a text layer → select + focus text input. | Native design-app idiom; text editing on mobile currently has no direct entry. |
| D5 | Tap timing/thresholds live in `CONFIG.gestures` (tapMaxMs 300, tapSlopPx 10 — current values, made configurable; doubleTapMs 300, holdSlopPx per coarse/fine). | Single source of truth; tuning on-device without hunting constants. |
| D6 | Keep `user-scalable=no` meta, add `gesturestart/gesturechange` preventDefault guard on document (iOS Safari fires proprietary gesture events and can still page-zoom from UI chrome). | Belt-and-braces against the app itself zooming under your fingers on real iPhones — a classic emulator-vs-device difference. |
| D7 | Justified rejection: no long-press context menus, no shake-to-undo, no multi-touch shortcuts (3-finger undo) in this round. | Scope control; nothing in the current UX needs them. |
| D8 | `TouchGestureHandler.js` is **deleted** at the end of TOUCH-2, not kept as a fallback. | Two recognizers alive is how the drift in defect 1 happened. The harness is the safety net, not old code. |

## 4. Sequencing

- **Must not run concurrently with T-4** (TEXT-LAYOUT-SPEC) — both edit `LayerTransform` and app.js tool routing. Order: **T-4 → TOUCH-1 → TOUCH-2 → TOUCH-3**. C-1 (canvas size) barely overlaps and can slot anywhere between TOUCH goals if Ryan wants it sooner.
- TOUCH-1 (harness) is test-only and also protects T-4's mobile behavior — dispatch it immediately after T-4 lands.
- Each TOUCH goal ends with the full harness green + Fable review before the next dispatch.

## 5. Device test checklist (Ryan, manual, after each goal)

Chrome emulation catches most logic bugs; these are the things it historically does NOT catch — run on the real iPhone:

1. Pinch-zoom the canvas over a sticker-dense area — page itself must never zoom (D6), and no sticker gets selected/scaled accidentally (D1).
2. Pinch a selected sticker: it should scale between your fingers (centroid), move with them, and rotate — all in one gesture, ending with exactly one undo step.
3. Brush tool: paint with one finger, mid-stroke put a second finger down → stroke cancels, canvas zooms (existing behavior, must survive).
4. Start a drag and slide off the canvas edge / into the Safari toolbar area → no stuck gesture; next touch behaves fresh (pointer capture replaces the old orphan cleanup).
5. Tap a sticker, tap empty canvas to deselect, tap a UI button — no double-fires, no dead taps needing a second try (ghost-click class of bugs).
6. Rotate the phone / trigger the Safari toolbar collapse mid-session → canvas doesn't jump off-center (visualViewport resize path).
7. Text layer: double-tap opens the keyboard focused on the text input (TOUCH-3).
8. In Chrome emulation, also test with "Emulate a focused page" off and device pixel ratio 3 — emulation defaults hide focus/DPR issues.

---

## 6. Goal TOUCH-1 — Touch regression harness (Codex)

Paste-ready `/goal`:

```
/goal Build a Playwright touch-gesture regression harness for the glitter editor that encodes CURRENT touch behavior as executable tests, before any input refactor lands.

CONTEXT
- Vanilla JS app at http://localhost/glitter/ (XAMPP). No build step. Tests are plain Node scripts using Playwright chromium (pattern: previous suites mask-smoke.js / text-ux-smoke.js — check console for errors, count assertions, exit nonzero on failure).
- Touch entry points: TouchGestureHandler (js/classes/TouchGestureHandler.js) instances on the preview container (ViewportManager.js:349) and on each sticker/text element (LayerTransform.js:426). Brush touch routes via MaskEditor.handleTouchPan/handleTouchTap.
- Playwright context must be created with hasTouch: true (and isMobile: true, viewport ~390x844, deviceScaleFactor 3 to mirror iPhone).
- Multi-touch (pinch/rotate) is NOT covered by page.touchscreen — drive it via CDP: session = await context.newCDPSession(page); session.send('Input.dispatchTouchEvent', {type:'touchStart'|'touchMove'|'touchEnd', touchPoints:[...]}) with two touchPoints, moved in ~10 interpolated steps per gesture (single-jump moves don't trigger move handlers reliably).
- Known session gotchas (from prior suites): a welcome modal covers the app on fresh headless loads — remove '.modal-overlay.visible' (or class) before interacting; the visible canvas is editor.previewCanvas, NOT #originalCanvas (display:none); after editor.loadBlankImage(...) you MUST waitForFunction(() => window.editor.originalImage != null) before adding layers; window.editor is the app entry object.

DELIVERABLE
tests/touch-smoke.js (new tests/ dir at repo root is fine) + tests/README.md documenting how to run it and the CDP two-finger helper. Structure the file as: helpers (twoFingerGesture(page, from1, to1, from2, to2, steps), oneFingerDrag, tap, doubleTap stub), then numbered checks. Every check logs PASS/FAIL with a name; process exits 1 if any fail.

BEHAVIORS TO ENCODE (assert via window.editor state, not screenshots):
 1. One-finger drag on empty canvas pans the viewport (viewport.panX/panY change; zoom unchanged).
 2. Two-finger pinch-out on empty canvas zooms in (viewport.currentZoom increases) anchored near the pinch center (a canvas point under the centroid stays within a few px of its screen position — compute via viewport.screenToCanvas before/after).
 3. Two-finger pan moves the viewport.
 4. Tap on empty canvas with SELECT tool deselects (layerManager.activeLayerId === null after a layer was active).
 5. Tap on a sticker with SELECT tool selects it.
 6. One-finger drag on a sticker (SELECT tool) moves it: stickerData.transform.position changes by approximately the drag delta / zoom; exactly ONE new history entry after the gesture (record historyManager index before/after — if this reveals TWO entries per gesture, that is known defect #4 in docs/TOUCH-PLAN.md §2: assert the CURRENT actual count and mark the check with a TODO(TOUCH-2) comment so the refactor flips it to 1).
 7. Two-finger pinch on a sticker scales it (transform.scale changes); record whether it also translates (currently it should NOT — TODO(TOUCH-2) flips this).
 8. Two-finger twist on a sticker rotates it (transform.rotation changes).
 9. Gesture on a sticker while HAND tool is active does NOT move the sticker (pointer-events disabled per tool) but pans the viewport.
10. BRUSH tool (activate via editor.setTool('brush') with a glitter layer active): one-finger drag paints — the layer's paint mask gains nonzero pixels; two-finger gesture while stroking cancels the stroke (mask pixels return to pre-stroke state) and zooms the viewport instead.
11. Tap during/immediately after a pan does NOT fire a selection change (ghost-click guard: pan 100px, lift, assert activeLayerId unchanged).
12. Touch ending outside the viewport container (drag off-edge, dispatch touchEnd with coords outside) leaves the handler reusable: a subsequent normal pan still works.
13. Add a text layer (layerManager.addLayer with LayerType.TEXT_GLITTER): one-finger drag moves it; pinch scales it (same shape as checks 6–7).

CONSTRAINTS
- Do NOT modify any application source in this goal. Tests + README only. If a behavior can't be triggered, document it in the README as a gap instead of changing app code.
- Keep every assertion tolerant (positions within ±3px, scale within ±5%) — these are behavior locks, not pixel tests.
- LF line endings (repo-wide .gitattributes).

ACCEPTANCE
- node tests/touch-smoke.js runs green from a fresh headless session, twice in a row (idempotent).
- README lists each check number with a one-line description and which docs/TOUCH-PLAN.md defect (if any) it locks in place.
```

## 7. Goal TOUCH-2 — Unified pointer pipeline for touch (Codex)

Paste-ready `/goal`:

```
/goal Replace the multi-instance touch-event gesture system in the glitter editor with a single pointer-events GestureManager and a target router, TOUCH ONLY — desktop mouse paths must not change behavior. Read docs/TOUCH-PLAN.md fully first (§2 defect list, §3 architecture, D1–D8 decisions); it is the spec. Run tests/touch-smoke.js (TOUCH-1 harness) before starting to confirm green baseline, and after, updating only the checks explicitly marked TODO(TOUCH-2).

BUILD
1. js/classes/GestureManager.js — new class, ONE instance, constructed by ViewportManager (replacing setupTouchGestures). Listens on previewContainer for pointerdown/move/up/cancel (capture). Processes pointerType 'touch' ONLY; mouse/pen events return immediately untouched. Uses setPointerCapture on the container per pointerId (this replaces TouchGestureHandler's document-level orphan cleanup — delete that concept). Tracks pointers in a Map by pointerId. States: idle → pending(1) → dragging(1) | twoFinger(2). Two-finger emits ONE composite callback per frame: {scale, rotateDeg, translateX, translateY, centroidX, centroidY} derived from the two pointers (same math as TouchGestureHandler.updatePinch but combined). Tap = pointerup while pending within CONFIG.gestures.tapMaxMs and tapSlopPx. Thresholds come from a new CONFIG.gestures block (js/config.js): { tapMaxMs: 300, tapSlopPx: 10, secondFingerGraceMs: 150 } — during the grace period after the first pointerdown, a second finger upgrades pending→twoFinger without emitting a drag first.
2. Routing, resolved ONCE at gesture start (first pointerdown, and re-resolved when upgrading to twoFinger), per docs/TOUCH-PLAN.md §3 order:
   - target.closest('.ui-ignore-gestures') → release capture, ignore gesture entirely (UI scrolls/taps natively).
   - editor.currentTool === ToolType.BRUSH → route drag to maskEditor.handleTouchPan, tap to handleTouchTap, twoFinger upgrade to handleTouchGestureStart('two_finger') then viewport zoom/pan (preserve current brush semantics exactly — harness check 10).
   - twoFinger with BOTH start points inside the SELECTED layer's frame (canvas-space hit test: layerManager.isPointInSticker / textGlitterManager.isPointInText against layerManager.getActiveLayer(); no elementFromPoint) → layer composite transform (D1: pinch never auto-selects).
   - twoFinger otherwise → viewport pinch-zoom anchored at centroid + pan (reuse the existing onPinchZoom/onTwoPan math in ViewportManager, refactored into methods pinchZoomAt(scale,cx,cy) / panBy(dx,dy)).
   - single-finger starting on a layer (canvas-space hit test via layerManager.getTopVisibleLayerAtPoint, honoring per-tool interactivity: only in SELECT tool) → select if needed (existing behavior) + drag via the layer's LayerTransform.
   - else single-finger → viewport panBy; tap → workspace action (below).
3. Layer composite transform (fixes defects 2–4): new method LayerTransform.applyGestureDelta({scale, rotateDeg, translateX, translateY, centroidX, centroidY}) — converts centroid to canvas space via viewport.screenToCanvas, scales transform.scale (clamped 10–500, honoring proportionalScale), adds rotation, and translates position so the point under the centroid stays under the centroid (scale-about-point: position = centroid + (position − centroid) × scaleFactor, then + finger translation / zoom). One saveState per gesture, on gesture end ONLY — remove the extra raw touchend saveState listener at LayerTransform.js:567.
4. Workspace action extraction (kills the mock click): extract the tool switch body of app.js handlePreviewContainerClick (the switch at ~app.js:3519) into editor.handleWorkspaceAction(clientX, clientY, {tool}) that does its own coordinate conversion USING viewport.screenToCanvas exclusively (replace the four getBoundingClientRect+scaleX blocks — canvas pixel coords = screenToCanvas result rounded, since the preview canvas is 1:1 with canvas space). handlePreviewContainerClick keeps its guards (ignore handles/UI/buttons/event-type filtering) and calls it for mouse; GestureManager tap calls it directly for touch. Delete the mock-event/isSimpleTap construction in ViewportManager. Suppress the browser's synthesized post-tap click with ONE mechanism: GestureManager sets a flag on tap dispatch, and a single click listener on previewContainer (capture) swallows the next click within 400ms of a handled tap. Then remove the ignoreNextClick setTimeout flags in LayerTransform (they remain needed ONLY for mouse handle drags — keep those two, remove touch-motivated ones; verify each by reading its call site).
5. iOS guards (D6): add document-level gesturestart/gesturechange preventDefault (feature-detected), keep the viewport meta as is. Ensure previewContainer has touch-action: none (CSS already mostly does; verify computed).
6. Capability module (defect 8): add Input = { isCoarse (matchMedia pointer:coarse, live via addEventListener('change')), hasTouch (navigator.maxTouchPoints > 0) } to js/utils.js. Replace utils.js:159 isTouchDevice with it. Do NOT change MobileManager's width-based isMobile (layout concern) — but grep for any place isMobile gates INPUT behavior and list them in the summary (do not fix unless trivial).

DELETE (D8 — no dual systems left):
- js/classes/TouchGestureHandler.js and its <script> tag in index.html.
- LayerTransform.setupTouchGestures + its call sites (StickerManager.js:484, TextGlitterManager.js:1603) and element._touchHandler cleanup refs.
- ViewportManager.setupTouchGestures + dead onTouchStart/onTouchEnd/isTouchActive wiring (defect 1).
- editor.touchGestureActive stays (LayerManager.js:382 reads it) but is now set by GestureManager gesture start/end.

CONSTRAINTS
- pointerType mouse/pen behavior byte-identical: do not touch setupMouseDrag, transform-handle mouse listeners, ViewportManager mouse pan, MaskEditor's pointer pipeline (it already ignores touch).
- No behavior change to WHAT gestures do beyond docs/TOUCH-PLAN.md D1 (pinch requires prior selection) and defects 2/3/4 (centroid scaling, two-finger translate, single history entry) — those flip their TODO(TOUCH-2) harness checks.
- Preserve the pinching→panning single-finger continuation (lift one finger of a pinch, keep panning with the other — TouchGestureHandler.js:292–309 behavior).
- LF line endings; no build step; match existing code style (tabs in most files, dbg() for debug logging — keep dbg calls sparse, not per-move).

ACCEPTANCE
- tests/touch-smoke.js green with the TODO(TOUCH-2) checks updated: check 6 asserts exactly 1 history entry; check 7 asserts centroid-anchored scale + translation; NEW checks: pinch over an UNSELECTED sticker zooms the viewport and does not select/scale it (D1); two-finger on selected sticker translates+scales+rotates in one gesture.
- Desktop harness sanity: existing text-ux-smoke suites (mouse-driven) still green.
- grep confirms zero references to TouchGestureHandler, isSimpleTap, elementFromPoint in gesture paths.
- node --check on every touched file.
```

## 8. Goal TOUCH-3 — Native-feel layer (Codex)

Paste-ready `/goal` (dispatch only after TOUCH-2 is reviewed):

```
/goal Add native-design-app touch affordances to the glitter editor on top of the TOUCH-2 GestureManager. Read docs/TOUCH-PLAN.md (§3, D3–D5) and docs/UX-PLAN.md design-system constraints first. tests/touch-smoke.js must stay green; add checks for each feature.

SCOPE
1. Touch transform handles (D3): remove the isMobile early-return in LayerTransform.createTransformHandles (LayerTransform.js:585). Migrate handle drag listeners from mousedown/mousemove/mouseup to pointerdown/pointermove/pointerup with setPointerCapture on the handle (one code path serves mouse AND touch — this is the only sanctioned mouse-path change; behavior for mouse must be identical). Under @media (pointer: coarse), handle hit targets become ≥44px (invisible padding wrapper — visual dot size unchanged; wrappers already exist: .transform-handle-wrapper). Handles must not shrink with zoom: size the wrappers with the existing --zoom CSS var (scale 1/var(--zoom)) if not already compensated — verify visually at 0.25x and 4x.
2. Double-tap (D4): GestureManager recognizes double-tap (two taps within CONFIG.gestures.doubleTapMs=300, second within 30px of first). Routing: on canvas/empty → viewport.zoomIn anchored at tap point; if currentZoom >= 4 → zoomToFit instead. On a text-glitter layer (SELECT tool) → select layer + textGlitterManager.focusTextInput(true) (mobile: this must also open the settings drawer path MobileManager.prepareSettings uses — check how desktop focuses vs mobile and route accordingly). On sticker → select (no-op beyond selection).
3. Viewport pan inertia, touch only: on single-finger viewport pan end, if release velocity > threshold, continue panning with exponential decay (~0.92/frame, stop under 0.5px/frame) via rAF. Cancel immediately on any new pointerdown. Config: CONFIG.gestures.inertia = { enabled: true, decay: 0.92 }. Layer drags get NO inertia (objects should stop where fingers stop).
4. Desktop parity (future-expansion item, small): previewContainer wheel handler (app.js:2473) — regardless of tool: ctrl/cmd+wheel = zoom anchored at cursor (this is what Mac trackpad pinch sends); plain wheel = pan vertically, shift+wheel = pan horizontally. The ZOOM-tool-only branch is subsumed. Keep preventDefault scoped to the container.
5. Layer list reorder (LayerManager.js:1288+): migrate touchstart/move/end to pointer events with setPointerCapture for consistency (mechanical change, same logic).
6. visualViewport guard: listen to window.visualViewport resize (feature-detected) and route through the existing viewport.handleWindowResize debounce, so iOS toolbar collapse doesn't leave the canvas mis-centered.

CONSTRAINTS
- All thresholds in CONFIG.gestures. LF endings. No new dependencies.
- Design-system: any visible UI follows existing patterns (btn-icon, checkbox-group etc.) — this goal should add almost no visible chrome.
- Inertia must not fight zoomToFit/resetZoomSmart (cancel rAF on any programmatic viewport set — hook applyTransform callers or expose viewport.cancelInertia()).

ACCEPTANCE
- Harness green + new checks: double-tap zooms anchored; double-tap at 4x fits; handle drag works via dispatched touch pointer events on a coarse-pointer context; ctrl+wheel zooms at cursor with SELECT tool active; inertia pans then stops, and pointerdown mid-inertia halts it.
- Manual device checklist in docs/TOUCH-PLAN.md §5 items 2, 6, 7 pass on iPhone (Ryan).
```

## 9. Future expansion this unlocks

- **New interactive layer types** register a hit-test + a LayerTransform and get full gesture support free — no per-element recognizers, no `shouldIgnoreTarget` threading, no pointerEvents toggling loops.
- **Optional TOUCH-4** (only if desired later): fold desktop mouse drag paths (`setupMouseDrag`, ViewportManager mouse pan) into GestureManager by lifting the `pointerType === 'touch'` gate per route. The router and coordinate paths are already shared; this becomes a small, low-risk diff instead of today's big-bang rewrite.
- Pen/stylus (iPad + Pencil) works through the same pipeline — MaskEditor already accepts pen; GestureManager can later give pen the mouse routing for precision.
- Trackpad pinch on desktop arrives with TOUCH-3 item 4 (ctrl+wheel).

















/goal Finish the remaining TOUCH-3 verification and cleanup in c:\xampp\htdocs\glitter. The product work is mostly landed; this pass is about proving the last behaviors, tightening the regression harness, and leaving the branch in a clean shippable state.

CONTEXT
- TOUCH-1 and TOUCH-2 are already done.
- TOUCH-3 product work is mostly implemented:
  - GestureManager handles double-tap and inertia
  - ctrl/cmd+wheel zoom is wired
  - mobile layer-list reorder was migrated to pointer events
  - touch smoke checks 16–22 were added
- tests/touch-smoke.js was previously green through checks 1–22, but the final pass still needs to be rerun after the latest harness cleanup.
- The only acceptance area that still needs stronger evidence is coarse-pointer transform-handle behavior beyond the move handle:
  - rotation handle
  - corner scale handle
  - fixed-text edge resize handle

REMAINING SCOPE
1. Re-run final verification:
- Run `node tests/touch-smoke.js` and leave checks 1–22 green.
- Run it twice from fresh launches.
- Run `node --check` on every touched JS file.
- Run a final grep for dead touch-only leftovers related to the transition.

2. Prove coarse-pointer transform handle behavior:
- Verify touch/pointer behavior for sticker rotation handle, sticker corner scale handle, and fixed-text edge resize handle.
- Prefer stable automated coverage if it can be made reliable in headless mode.
- If CDP touch emulation is too flaky for tiny handles, keep the main smoke suite at 1–22 and add a small deterministic verification path instead of forcing brittle tests.

3. Keep mouse behavior intact:
- Do not regress existing desktop mouse handle behavior while validating the shared pointer-event handle path.
- Preserve current visible handle styling; coarse-pointer hit targets stay large via wrapper sizing.

4. Final cleanup:
- Remove any temporary probing code that is no longer needed.
- Update test docs only if the final verification approach changes.

ACCEPTANCE
- `node tests/touch-smoke.js` passes twice in a row with checks 1–22.
- `node --check` passes on all touched files.
- Rotation, corner scale, and fixed-text edge resize are explicitly verified.
- No leftover `TouchGestureHandler` / mock-tap dead paths remain in active gesture code.
- Branch is ready for review without reverting unrelated user changes.

CONSTRAINTS
- Use `apply_patch` for edits.
- No new dependencies.
- Preserve existing desktop behavior except where TOUCH-3 intentionally shared the pointer-event handle path.
- Keep the harness deterministic; do not add flaky tests just to increase coverage.
# Touch Smoke Harness

`tests/touch-smoke.js` is the touch regression harness that now covers the TOUCH-2 unified pointer pipeline and the shipped TOUCH-3 touch affordances.

## Run it

1. Make sure the app is available at `http://localhost/glitter/` in XAMPP.
2. Install Playwright if it is not already present in the repo's Node environment, for example `npm install --save-dev playwright`.
3. Run `node tests/touch-smoke.js`.

You can override the target URL with `GLITTER_URL`. In PowerShell that looks like `$env:GLITTER_URL='http://localhost/glitter/'; node tests/touch-smoke.js`.

## Helper structure

The script is intentionally plain Node plus Playwright Chromium and follows the requested harness shape:

- `twoFingerGesture(page, from1, to1, from2, to2, steps)` drives CDP `Input.dispatchTouchEvent` with two active touch points over interpolated move steps.
- `oneFingerDrag(page, from, to, steps)` uses the same CDP path for single-touch drags.
- `tap(page, point)` dispatches a touch start/end pair.
- `doubleTap(page, point)` covers double-tap viewport/text flows.

CDP is used for multi-touch because `page.touchscreen` cannot express pinch/rotate. Every move is split into stepped interpolation because the current touch handlers are unreliable on single-jump coordinate changes.

## Checks

1. One-finger drag on empty canvas pans the viewport.
   Locks current viewport single-pan behavior.
2. Two-finger pinch-out on empty canvas zooms in and keeps the pinch centroid anchored.
   Locks current viewport pinch anchoring behavior.
3. Two-finger pan moves the viewport.
   Locks current viewport two-finger pan behavior.
4. Tap on empty canvas with SELECT tool deselects.
   Runtime note: in the live app this currently switches selection to the base image when the tap lands on bare canvas pixels.
5. Tap on a sticker with SELECT tool selects it.
   TOUCH-2 flips this from a documented gap to a real behavior check.
6. One-finger drag on a sticker moves it and records the current history count.
   Runtime note: current movement reflects the handler's 10px touch slop before drag begins, and the current history delta is 1.
7. Two-finger pinch on a selected sticker scales it and translates with the centroid.
   TOUCH-2 flips this from the old in-place scaling behavior to the new centroid-aware layer transform.
8. Two-finger twist on a sticker rotates it.
   Locks current rotation behavior.
9. HAND tool gesture over sticker pans the viewport without moving the sticker.
   TOUCH-2 flips this from the old headless gap to a real routing check.
10. BRUSH touch headless gap probe stays unpainted and does not enter the zoom-upgrade path.
   Gap probe: the current headless mobile-emulation run is not entering either the one-finger touch brush path or the mid-stroke two-finger upgrade path.
11. Pan does not trigger a post-gesture selection change.
   Locks the current ghost-click guard path after a real viewport move.
12. Touch ending outside the viewport leaves the handler reusable.
   Locks the current document-level orphan touch cleanup behavior.
13. Touch drag and pinch on a selected text layer move and scale it.
   TOUCH-2 extends the unified selected-layer gesture route to text layers, with mobile drawers closed so the preview remains hittable.
14. Pinch over an unselected sticker zooms the viewport and leaves the sticker untouched.
   TOUCH-2 D1 check: pinch no longer auto-selects or scales an unselected sticker.
15. Two-finger gesture on a selected sticker translates, scales, and rotates it in one move.
   TOUCH-2 composite-transform check for the selected-layer route.
16. Double-tap on empty canvas zooms in anchored at the tap point.
   TOUCH-3 double-tap zoom behavior.
17. Double-tap at 4x returns the viewport to fit zoom.
   TOUCH-3 high-zoom double-tap fallback.
18. Touch drag on a transform handle moves the selected sticker.
   TOUCH-3 coarse-pointer handle path sanity check.
19. Ctrl+wheel zooms at the cursor even with SELECT active.
   TOUCH-3 trackpad / desktop parity check.
20. Viewport inertia glides after release, settles, and halts on pointerdown.
   TOUCH-3 touch-only inertia behavior.
21. Double-tap on text opens mobile settings and focuses the text input.
   TOUCH-3 mobile text-edit affordance.
22. Mobile layer reorder uses touch pointer events to move a layer in the list.
   TOUCH-3 pointer-event migration for mobile layer-list reordering.

## Notes

- The suite opens a fresh mobile-touch Playwright context for each numbered check and runs the whole suite twice from fresh browser launches to catch state leakage.
- Assertions are intentionally tolerant: position checks allow a few pixels of drift and scale checks allow about 5 percent variation.
- The harness removes visible modal overlays and closes mobile drawers before interacting, then waits for `window.editor.originalImage` after `editor.loadBlankImage(...)`, matching the app-specific session gotchas from `docs/TOUCH-PLAN.md`.

## Current gaps

- Check 10: one-finger touch brush strokes and the mid-stroke two-finger upgrade path do not reproduce in this harness.

This is a documented headless gap rather than an app-code change.

## Transform-handle verification (`tests/touch-handle-verify.js`)

Check 18 above only exercises the move/bounding-box handle. Rotation, corner-scale, and fixed-text edge-resize handles get their own small deterministic script rather than more numbered checks in the main suite, so `touch-smoke.js` stays anchored at checks 1-22.

Run it the same way: `node tests/touch-handle-verify.js`.

It drives each handle once via touch and once via mouse (six checks total), confirming the shared pointer-event handle path in `LayerTransform.attachHandleListeners` behaves the same for both input types:

1. Touch/mouse drag on the rotation handle rotates the selected sticker.
2. Touch/mouse drag on a corner handle scales the selected sticker.
3. Touch/mouse drag on a fixed-text box's edge handle resizes it.

While building this, touch dragging on these three handle types turned out not to work at all — `GestureManager`'s capture-phase `pointerdown` listener on `previewContainer` claimed every touch (including ones landing on a handle) before `LayerTransform`'s own handle listeners ever saw them, the same class of conflict `MaskEditor.js` already guards against for `.transform-handles`. `GestureManager.handlePointerDown` (`js/classes/GestureManager.js`) now also lets touches on `.transform-handle-wrapper` (corner/edge/rotation handles) fall through untouched, matching how `.ui-ignore-gestures` is already excluded. The move handle's bounding box (`.transform-bounding-box`) is deliberately *not* excluded — two-finger pinch/rotate/translate on a selected layer is routed through GestureManager's own composite-gesture math, and a broader exclusion there breaks that path (see checks 14-15 in the main suite, which sit on top of it).

## Shape-border verification (`tests/shape-border-verify.js`)

Run it the same way: `node tests/shape-border-verify.js`.

It covers the non-touch shape-border regressions that are easy to miss visually:

1. A solid shape border expands the selection/transform frame and stays aligned through select → deselect → reselect.
2. The same alignment holds for a rotated shape with a shadow, proving shadow padding is excluded from the frame while border width is included.
3. Dotted shape borders toggle the spacing UI correctly and still produce a border mask through the shared shape mask pipeline.

## Export parity verification (`tests/export-parity.js`)

Run it the same way: `node tests/export-parity.js`.

It builds one real mixed composition and then checks the exporter’s byte stability:

1. Two back-to-back matte exports of the same composition are byte-identical.
2. Two back-to-back transparent exports of the same composition are byte-identical.
3. Editing the text layer, undoing it, and exporting again produces the exact same matte GIF bytes as the original export.
4. The same edit -> undo round-trip also preserves the transparent export bytes exactly.

The composition intentionally includes a painted glitter-fill layer, an animated sticker layer, a text layer with glitter fill + solid border + glitter shadow + non-identity color adjust, and a shape layer with the same slot spread, then runs that scene through both matte and transparent export modes.

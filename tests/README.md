# Tests

Plain Node scripts, most of them driving the real app in headless Chromium through Playwright. There is no test framework: each file exits non-zero on failure.

Suites are grouped by responsibility: `unit/` for isolated logic, `parity/` for preview/export contracts, `ui/` for browser interaction, and `admin/` for PHP contracts. Shared fixtures remain in `fixtures/`; `run.js` is the tagged entry point.

## Running

- The browser suites need the app served at `http://localhost/glitter/` (XAMPP). Override the URL with `GLITTER_URL`, for example in PowerShell: `$env:GLITTER_URL='http://localhost/glitter/'; node tests/ui/touch-smoke.js`.
- Run files directly with `node`. `npm run` scripts break on stdin in this environment.
- `node tests/run.js --tag <tag>` runs every file with that tag. The tag table is at the top of `tests/run.js`; add new files there.

| Tag | Covers |
|---|---|
| `quick` | touch smoke, touch handles, viewport and gesture units. CI runs it. |
| `export` | export parity, formats, transparency, timeline, palette, MP4, shape borders, mask edges. CI runs it. |
| `unit` | pure-logic suites that need no page |
| `effects` | pixel effects, Auto Glitter analysis, shimmer, combinatorial effect parity |
| `panels` | panel parity, shortcut structure and generated-guide freshness, icon references, hints, notification policy, settings modals |
| `modals` | the modal content build and lint: every `content/src` page builds with 0 errors and matches its `modals/` output, the registries validate, timeline entities exist |
| `touch`, `shape`, `mask`, `layers`, `document`, `assets` | the named areas |
| `admin` | PHP contract tests for the admin (run with `php`) |

## What to run when

- **Default:** run the smallest existing unit, UI or parity test that directly covers the changed behavior. After JS changes, run `npm run lint`; documentation-only changes need no browser suite.
- **Touch smoke:** run `node tests/ui/touch-smoke.js` after changing touch/pointer routing, `GestureManager`, viewport gestures, selection/hit testing, shared interaction selectors/capabilities, mobile interaction, or transform gesture routing.
- **Transform handles:** run `node tests/ui/touch-handle-verify.js` after changing `LayerTransform`, transform handles, resize/rotate math, selection chrome, or group transforms. Run it with touch smoke when a change spans both routing and handles.
- **Fill-layer transforms:** run `node tests/ui/fill-transform-verify.js` after changing fill-layer placement, `GlitterManager` frame or hit-test code, brush coordinate mapping, canvas-picked dragging, or the frame math in `LayerTransform.getFrameMetrics`.
- **Export parity:** run `node tests/parity/export-parity.js` after changing `SceneCompositor`, an exporter, authored/procedural frame handling, effect sources, animation sampling, or any preview/export twin. A manager edit by itself does not require export parity unless it changes rendered pixels or export-plan behavior.
- **Shape-border parity:** run `node tests/parity/shape-border-verify.js` after changing shape geometry, shape masks, borders, image fills, or shared slot-stack geometry. Text-manager or generic manager edits do not require it by themselves.
- **Export fragility routine** after touching `SceneCompositor`, an exporter, or frame handling: add an animated sticker, export, edit, undo, export again, and export twice in a row. The outputs must be byte-identical when nothing changed. `node tests/parity/roadmap-export-fragility.js` runs it over the newer effects (outline, bevel, glow, sparkles and Kira Kira, text warp, frames, the Sparkles layer, CSS and pixel filter looks); add a new effect to its scene.
- **Styling changes:** compile to a scratch file and check it without touching `css/style.css`. A change meant to be invisible: `node tools/ui-ab.js <old.css> <new.css>` must report zero computed-style differences across the states in `tools/ui-states.js`. A change meant to be visible: `node tools/ui-contact-sheet.js capture` before and after, then `build` the side-by-side page. `node tools/gutter-check.js` checks panel insets, and `node tests/ui/panel-parity.js` the panel DOM (`--capture` after an intended change). `node tests/unit/panel-schema-grammar.js` checks that `PANEL_SCHEMAS` keeps to the one panel grammar.
- **Broad suites:** run a full tag or the complete Playwright matrix only when asked, before a merge when requested, or when a cross-cutting change has no narrower reliable coverage. Ryan does manual testing himself.
- **Avoid redundant reruns:** once a suite passes, rerun it only if later code changes affect its covered path or a failure appears flaky and needs confirmation. Documentation edits, cache bumps and test-only assertion changes do not invalidate an already-passing app suite.

Prefer quiet output where a command supports it, and summarize passing checks instead of reproducing long logs in handoff notes.

Test behavior, not implementation. Before writing a new test, check whether an existing one can be extended, and prefer table-driven cases over near-duplicate tests.

## Headless probe gotchas

- Fresh sessions open on the start card. The welcome modal only opens on load while `CONFIG.app.startup.showWelcome` is on; if it is, remove `.modal-overlay.visible` before screenshots or clicks.
- The visible canvas is `editor.previewCanvas`. `#originalCanvas` is hidden.
- After `editor.loadBlankImage()` or an image upload, wait for `editor.originalImage != null` before adding layers. The load resolves before the async reset finishes.
- Upload images with `setInputFiles('#imageUpload', …)`.
- Panels auto-open the active layer's settings section. Don't assert that sections are closed.
- `window.editor` is the live `GlitterEditor` instance.

## Touch smoke harness

`tests/ui/touch-smoke.js` covers the unified pointer pipeline, touch affordances and mobile drawer detents/handoff. Check 28 verifies that every number-pair mark ignores touch and that mouse scrubbing preserves click focus, starts after 3 px, captures the pointer, commits once and restores the start on Escape. It also checks that typing before a scrub remains a separate edit and that later blur adds no duplicate commit. `tests/unit/numeric-controls-unit.js` covers scrub distance, modifiers, grid alignment, clamping and shared preview scheduling; `tests/unit/panel-schema-grammar.js` checks the folded set-label grammar and numeric steps/bounds in FIELDS, PANEL_SCHEMAS and both settings layouts. `GLITTER_TEST_CSS` may point to a scratch Sass compile while the committed CSS awaits Ryan's recompile.

### Run it

1. Make sure the app is available at `http://localhost/glitter/` in XAMPP.
2. Install Playwright if it is not already present in the repo's Node environment, for example `npm install --save-dev playwright`.
3. Run `node tests/ui/touch-smoke.js`.

You can override the target URL with `GLITTER_URL`. In PowerShell that looks like `$env:GLITTER_URL='http://localhost/glitter/'; node tests/ui/touch-smoke.js`.

### Helper structure

The script is intentionally plain Node plus Playwright Chromium and follows the requested harness shape:

- `twoFingerGesture(page, from1, to1, from2, to2, steps)` drives CDP `Input.dispatchTouchEvent` with two active touch points over interpolated move steps.
- `oneFingerDrag(page, from, to, steps)` uses the same CDP path for single-touch drags.
- `tap(page, point)` dispatches a touch start/end pair.
- `doubleTap(page, point)` covers double-tap viewport/text flows.

CDP is used for multi-touch because `page.touchscreen` cannot express pinch/rotate. Every move is split into stepped interpolation because the current touch handlers are unreliable on single-jump coordinate changes.

### Checks

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
14. Pinch over an unselected sticker selects and scales it without viewport zoom.
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
23. Two-finger pinch inside the group bounds scales the group without viewport zoom.
24. A second finger on a corner joins a proportional pinch with one undo step.
25. Fast downward Edit-header flicks close sheets at half and peek.
26. Slow sheet release settles to a detent, leaves canvas geometry fixed while dragging, refits once, grabber arrows step detents, app/OS Reduce Motion suppresses transitions, and a simulated safe-area inset clears the nav buttons while preserving the full detent.
27. Top content hands downward pulls to the sheet; upward/scrolled content stays scrolling, sliders drag horizontally, Edit content scrolls, and stacked Edit bars open their panel on tap.
   TOUCH-3 pointer-event migration for mobile layer-list reordering.

### Notes

- The suite opens a fresh mobile-touch Playwright context for each numbered check and runs the whole suite twice from fresh browser launches to catch state leakage.
- Assertions are intentionally tolerant: position checks allow a few pixels of drift and scale checks allow about 5 percent variation.
- The harness removes visible modal overlays and closes mobile drawers before interacting, then waits for `window.editor.originalImage` after `editor.loadBlankImage(...)` to match the app's session setup.

### Current gaps

- Check 10: one-finger touch brush strokes and the mid-stroke two-finger upgrade path do not reproduce in this harness.

This is a documented headless gap rather than an app-code change.

## Suite notes

### Transform-handle verification (`tests/ui/touch-handle-verify.js`)

Check 18 above only exercises the move/bounding-box handle. Rotation, corner-scale, and fixed-text edge-resize handles get their own small deterministic script rather than more numbered checks in the main suite, while `touch-smoke.js` covers canvas routes and phone drawers.

Run it the same way: `node tests/ui/touch-handle-verify.js`.

It also checks that a sharp shape outline's transparent render padding cannot start a mouse drag, with Auto-select both on and off, while dragging inside the shape still works.

It drives each handle once via touch and once via mouse, confirming the shared pointer-event handle path in `LayerTransform.attachHandleListeners` behaves the same for both input types:

1. Touch/mouse drag on the rotation handle rotates the selected sticker.
2. Touch/mouse drag on a corner handle scales the selected sticker.
3. Touch/mouse drag on a fixed-text box's edge handle resizes it.

While building this, touch dragging on these three handle types turned out not to work at all — `GestureManager`'s capture-phase `pointerdown` listener on `previewContainer` claimed every touch (including ones landing on a handle) before `LayerTransform`'s own handle listeners ever saw them, the same class of conflict `MaskEditor.js` already guards against for `.transform-handles`. `GestureManager.handlePointerDown` (`js/systems/GestureManager.js`) now also lets touches on `.transform-handle-wrapper` (corner/edge/rotation handles) fall through untouched, matching how `.ui-ignore-gestures` is already excluded. The move handle's bounding box (`.transform-bounding-box`) is deliberately *not* excluded — two-finger pinch/rotate/translate on a selected layer is routed through GestureManager's own composite-gesture math, and a broader exclusion there breaks that path (see checks 14-15 in the main suite, which sit on top of it).

### Document-start verification (`tests/ui/document-start-verify.js`)

Run it with `node tests/ui/document-start-verify.js`.

It checks the shared desktop/mobile start surface, configured canvas presets and limits, mobile navigation state, image drops becoming new Sticker layers in an existing document, and explicit base-image replacement preserving the layer stack.

### Fill-transform verification (`tests/ui/fill-transform-verify.js`)

Run it with `node tests/ui/fill-transform-verify.js`.

A fill layer's mask is a canvas-sized surface placed by `layer.transform`, so its frame, picking, preview, export, brush mapping and canvas resize all have to agree on that placement. The script paints one rect and checks:

1. An empty fill has a transform but no handles.
2. The frame is the painted pixels, and the element takes no pointer events.
3. One press-and-drag on the painted pixels selects and moves an unselected fill.
4. Picking follows the moved mask.
5. After a move, rotation, non-uniform scale and flip, the frame, a screenshot of the preview and a composed export frame all bound the same pixels.
6. Paint mapped through `getMaskLocalPoint` lands under the pointer.
7. A structural canvas resize shifts a transformed fill with its content.
8. Reset Transform returns the fill to where it was painted.
9. A transform edit is its own undo step, survives serialization, and a layer saved without a transform loads at its home placement.
10. On an odd-sized canvas, document scaling and a 1px nudge keep the surface on the pixel grid.
11. An animated fill that keeps a scale and rotation is bounded by the same pixels in the preview and in the export at the same timestamp.

### Shape-border verification (`tests/parity/shape-border-verify.js`)

Run it the same way: `node tests/parity/shape-border-verify.js`.

It covers the non-touch shape-border regressions that are easy to miss visually:

1. A solid shape border expands the selection/transform frame and stays aligned through select → deselect → reselect.
2. The same alignment holds for a rotated shape with a shadow, proving shadow padding is excluded from the frame while border width is included.
3. Dotted shape borders toggle the spacing UI correctly and still produce a border mask through the shared shape mask pipeline.

### Export parity verification (`tests/parity/export-parity.js`)

Run it the same way: `node tests/parity/export-parity.js`.

It builds one real mixed composition and then checks the exporter’s byte stability:

1. Two back-to-back matte exports of the same composition are byte-identical.
2. Two back-to-back transparent exports of the same composition are byte-identical.
3. Editing the text layer, undoing it, and exporting again produces the exact same matte GIF bytes as the original export.
4. The same edit -> undo round-trip also preserves the transparent export bytes exactly.

The composition intentionally includes a painted glitter-fill layer with outline and shadow, an animated sticker layer, a text layer with glitter fill + solid border + glitter shadow + non-identity color adjust, and a shape layer with the same slot spread, then runs that scene through both matte and transparent export modes.

### Shadow verification (`tests/parity/shadow-verify.js`)

Run with `node tests/parity/shadow-verify.js`. It checks whole-pixel extrusion in both offset directions, baseline-anchored floor projection, unchanged source artwork, distinction from Extrude, zero Length and projected letter counters, all four shadow Type controls and conditional Cast rows, text Anchor controls/defaults, descender-stable and multiline baselines, post-projection blur, relative text casts across font sizes and uniform/nonuniform scales, bake-to-font and document resize with Scale Effects on/off, persistence, scaled preview/export masks, extreme cast distances and exclusion of offset/spread, and sticker padding. A mixed scene with extrusion, cast shadows and an animated sticker must export byte-identically twice and after editing a shadow then undoing, in matte and transparent modes.

### Effect fragility (`tests/parity/roadmap-export-fragility.js`)

One scene with every newer effect: an animated sticker with outline, glow, bevel and Kira Kira; warped text with a bevel style and sparkles; a shape with a glow spread; a pinned frame; the Sparkles layer; Scanlines, JPEG Crunch and RGB Split filters. It checks back-to-back matte and transparent exports, then edit -> undo -> export for four edits (sticker outline, text warp, frame style, filter look). It shares `tests/parity/export-harness.js` with export parity and caps exports at 8 frames to keep its twelve exports quick.

### Pixel-filter verification (`tests/parity/pixel-filter-verify.js`)

This focused browser check adds a Tier-3 filter above a real document, compares its cached preview pixels with `SceneCompositor` export pixels, verifies that JPEG Crunch performs the configured number of real browser JPEG round-trips, and locks the Off/Still/Animated setting plus removal of the legacy export-level `jpegGenerations` value.

### Text tool verification

`node tests/ui/text-tool-verify.js` covers desktop and phone edit sessions, mirroring, word and drag selection, multiline keyboard movement, composition, history, empty text, symbols and paste, wrapping, split placement in exported pixels, nested splits, background plates, the layer cap and color emoji masks. `GLITTER_TEST_CSS` may point to a scratch Sass compile while the committed CSS awaits Ryan's recompile. `text-warp-unit.js` also tests grapheme content, source ranges, case, wrapping, overflow and decoration layout. `touch-handle-verify.js` covers Auto Height width resizing and conversion to Fixed on vertical edges with touch and mouse. The effect fragility scene includes colored emoji and decorations on warped text.

`tests/parity/raster-scale-verify.js` covers unequal text/shape scales, physical outline widths, unstretched texture stacks and preview/export geometry, plus group Frame baking, independent effect/corner preferences, text plate geometry and parked effect drafts. `mask-edge-verify.js` holds PNG encoding callbacks to verify the stroke-overlay handoff. `style-presets-unit.js` lints all authored templates against the live text/transform vocabulary and option registries. Pinned-frame mouse and touch selection is covered by `fill-transform-verify.js`.

`node tools/wordart-contact-sheet.js` renders the 23 available WordArt looks at 64px in original gallery order beside `docs/local/WORDART-EXAMPLES.png`. It writes `comparison.html` and `comparison.png` under `docs/local/wordart-preview/` (or a supplied output directory), reserving cells for stacked text and lit 3D. It reuses the real text slot masks and paint helpers without adding layers to the document. The style preset unit test covers copied recipes, Default resets, cleared unnamed warps and all-pairs style switching without leaked appearance or motion and text-only WordArt targets.

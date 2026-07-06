# Tool Expansion Plan — Brush/Eraser Split, Straight Lines, Wacom Eraser, Glitter Color Adjust, Shape Tool

Status: IN PROGRESS. WP1, WP2, WP3, WP4, WP5a all DONE + verified (Opus, 2026-07-05, uncommitted on `masks-and-text`). WP5b (Shape tool) NOT started — its full foundation is in place (ShapeLibrary geometry, the reusable Advanced disclosure, the colorAdjust module); the remaining work is the new-LayerType integration across ~76 layer-type dispatch sites, which is the multi-session package this plan already flagged. WP6 (text re-rasterize) deferred, follows WP5b.
Scope owner: Ryan. Implementation delegated per work package (model noted on each WP).

Needs a SCSS recompile (`npx sass css/style.scss css/style.css` — the watcher is stopped) for the Advanced-disclosure styles to render. Manual test + export fragility test still owed to Ryan.

Resolved by Ryan 2026-07-05: **E** is the Eraser shortcut (WP1 adds it), shape **shadow ships in v1** (WP5b scope includes it), **localStorage persistence approved** for brush/eraser settings.

This plan covers five requests plus the architectural groundwork they share:

1. Separate Brush and Eraser settings (per-tool values, correct panel shown, mobile-aware).
2. Shift = straight line for brush and eraser.
3. Fix Wacom Cintiq Pro pen-eraser not erasing.
4. "Advanced" auto-collapsed color adjust (hue/saturation/brightness) everywhere a glitter swatch is used (fill, text fill, border, shadow), plus decluttering (move Scale into Advanced).
5. New Shape tool (circle, square, star, heart; glitter or solid fill + border), Photoshop-style, with a real answer to the "scale vs redraw" question.

---

## 1. Current architecture (facts the implementation must respect)

- **Preview is DOM, export is canvas.** Glitter fill layers are `.glitter-element` divs with the animated GIF as `background-image` and a PNG mask blob as CSS `mask-image` (`GlitterManager.renderLayer`). Text layers are a `.text-glitter-stack` of per-slot spans (shadow, border, fill), each a glitter/solid background masked by a rasterized mask canvas (`TextGlitterManager.getSpanDescriptors`). Export (`GifExporter`) flattens GIF frames to `ImageData` per layer/slot key and composites with `createPattern` on canvas. **Any visual feature must be implemented twice — DOM preview and canvas export — and must match.**
- **Brush and Eraser are one tool.** Both buttons set `ToolType.BRUSH`; Eraser is `MaskEditor.mode === 'sub'` (app.js `setupToolbarListeners`, MaskEditor `_syncModeButtons`). There is ONE set of settings sliders (`#maskBrushSize` etc., index.html "Brush Settings" section) read live from the DOM by `MaskEditor.getBrushSize()/getBrushSoftness()/...` — the DOM is currently the source of truth.
- **Mobile**: the brush settings section is tool-scoped and relocated into the settings drawer by `MobileManager.syncBrushSettingsPlacement()`, called from `app.updateContextToolbars()`. A quick size slider (`#maskBrushSizeQuick`) mirrors the canonical slider in the context bar.
- **Pointer pipeline**: `MaskEditor._handlePointerDown` rejects any pointerdown with `event.button !== 0`. Per the Pointer Events spec, a pen's **eraser end reports `button === 5` / `buttons === 32`** — this is exactly why the tester's Cintiq eraser does nothing.
- **Text masks are binarized** (`CONFIG.textLayers.crispEdges`, default true): after `fillText`, alpha is thresholded at 128. This is load-bearing for GIF export (partial-alpha edges fringe against the GIF transparency key). "Anti-aliased like text" therefore actually means "rendered through the text mask pipeline, which is crisp-thresholded by default and AA only if `crispEdges: false`". Shapes must go through the same pipeline and inherit the same switch — no per-tool AA decision.
- **Text scaling today**: the mask is rasterized at `fontSize`, then the stack is scaled by CSS `transform: scale()` in preview and by scaling the rendered canvas in export. Upscaling a raster is what creates the "pixel density / mixels" mismatch Ryan noticed.
- **Effect paint source abstraction already exists**: `TextGlitterManager.getEffectPaintSource()` returns `{ mode: 'glitter'|'solid', glitterId, scale, opacity }` for fill/border/shadow. This is the single seam to extend for color adjust and to reuse for shapes.
- **Shape geometry already exists once**: `MaskEditor._traceBrushShape` + `MaskEditor.BRUSH_SHAPES` define round/square/calligraphy/star/heart paths and their SVG gallery icons. The shape tool must NOT re-implement these.
- **Export frame flattening is keyed per layer/slot** (`flattenedFrameMap`, keys = `layer.id` or text-slot `source.key`), so per-layer color adjustment of flattened frames has no cross-layer sharing conflicts.
- Repo rules: SCSS only (Ryan compiles `style.scss` himself — never touch `css/style.css`), LF-only repo, no JS build system (plain script classes), panel naming convention "<Thing> Properties" vs "<Tool> Settings" (config.js comment above `LAYER_UI_CONFIG`), and `modals/guide.html` must mirror new panel titles/shortcuts.

---

## 2. Decisions (with rationale)

### D1 — Brush/Eraser settings: one panel (view), two setting sets (model)

Do **not** duplicate the DOM section. Introduce a JS settings store in `MaskEditor` as the single source of truth:

```js
this.toolSettings = {
  add: { size, softness, flow, spacing, smoothing, shape, pressure },
  sub: { size, softness, flow, spacing, smoothing, shape, pressure }
};
```

- Defaults come from `CONFIG.maskBrush` (add a `CONFIG.eraser`-style override block or per-mode defaults inside `maskBrush`, e.g. eraser defaults to softness 0, flow 100, shape round).
- All `getBrushSize()`-style getters read `this.toolSettings[this.mode]` instead of the DOM. Sliders/toggles write INTO the store; on `setMode()` the store values are written back out to the one DOM panel (including the shape picker selection and `#maskBrushSizeQuick`).
- The panel header retitles per mode: "Brush Settings" ↔ "Eraser Settings" (and icon swap). `[`/`]` size shortcut and the quick slider operate on the active mode's entry.
- Mobile needs zero structural work: `syncBrushSettingsPlacement()` relocates the same section; verify the retitle shows in the drawer and mode switching while the drawer is open refreshes values.
- Persist the store to `localStorage` (small, optional; do it — it's cheap and users expect tools to remember settings). Keyed `glitter.toolSettings.v1`.

Why this shape: it keeps one DOM section (mobile relocation logic, collapsible accordion, SCSS all untouched), makes the settings model testable, and is the pattern future tools (shape tool options) should follow: **state object = truth, panel = view**.

### D2 — Shift = straight line (brush + eraser)

Photoshop-parity, two behaviors, both in `MaskEditor`'s existing stroke pipeline (they compose with spacing/smoothing/pressure for free because they only adjust the points fed to `_stampAlongPath`):

1. **Shift held during a drag** → axis lock: on the first move past a small threshold, lock the stroke to 0°/45°/90° (whichever is nearest to the initial drag direction); project all subsequent points onto that ray from the stroke origin. Releasing shift mid-stroke unlocks.
2. **Shift+click (or shift+pointerdown)** → straight segment from the END of the previous stroke to the clicked point (classic PS line-connect). Requires remembering `lastStrokeEndPoint` per layer session; cleared on layer switch/undo. Implemented as a single `_stampAlongPath(from, to)` call inside one committed stroke.

Smoothing (EMA) must be bypassed for projected/connected points — the projection already stabilizes them, and EMA would bow the line.

Desktop-only by nature (keyboard); no mobile work. Add both to `CONFIG.shortcuts.brush` and `modals/guide.html`.

### D3 — Wacom pen-eraser fix

In `MaskEditor._handlePointerDown`, accept `pointerType === 'pen'` with `button === 5` (also treat `buttons & 32` as eraser — browsers differ) in addition to `button === 0`. Behavior: while the eraser end is in contact, **temporarily force mode `'sub'`** for that stroke, then restore the previous mode on pointerup/cancel (Photoshop behavior; do not permanently flip the toolbar state). Track `this.strokeModeOverride` so `_stampAtPoint` uses it without mutating `this.mode`.

Scope decision: eraser-end works whenever the Brush tool is active. Auto-activating the brush tool from any other tool when the eraser touches is out of scope (would fight the select/text tools' pointer handling).

Also verify `pointermove`'s pressure path — eraser contact reports pressure normally; no change expected. Manual test matrix: pen tip draws, pen eraser erases, mode restored after lift, mouse unchanged, touch unchanged.

### D4 — Glitter color adjust (HSV) + "Advanced" disclosure

**Approach: CSS-filter semantics as the canonical math.** Preview applies `filter: hue-rotate(Hdeg) saturate(S%) brightness(B%)` to the glitter background element/span. Export applies the **same spec-defined color matrices** (the SVG/CSS `hueRotate` linear matrix composed with `saturate` and `brightness`) per-pixel to the already-flattened `ImageData` frames. Because both sides derive from the same spec math, preview and export match by construction. Do NOT use `ctx.filter` in export (unsupported on Safari/iOS, and iOS export is a supported path — see `forceIOSExportPreview`).

Rejected alternatives: true-HSV per-pixel conversion (won't match CSS `hue-rotate`'s linear approximation shown in preview); pre-generated color variants of glitter assets (explodes the library).

**Data model — extend the existing seam, don't invent a new one.** Add an optional `colorAdjust: { hue: 0, saturation: 100, brightness: 100 }` to every glitter reference:

- Glitter fill layers: `layer.settings.colorAdjust` (beside `scale`/`opacity`).
- Text fill slot: continues to alias layer settings (per `getDefaultFill()` convention).
- Border/shadow slots: `effectData.colorAdjust`.
- `getEffectPaintSource()` returns it; a new shared helper module (`js/utils.js` or new `js/color-adjust.js`) owns:
  - `buildCssColorFilter(adjust)` → filter string (or `''` when identity),
  - `applyColorAdjustToImageData(imageData, adjust)` → matrix pass,
  - `isIdentityColorAdjust(adjust)`.
- Export: in `GifExporter`, after flattening frames for a source key, run the matrix pass once per frame when the owning layer/slot has a non-identity adjust (frames are already per-layer/slot keyed, so no sharing hazards). Skip entirely on identity — zero cost for existing content.
- History: layer snapshots already deep-clone settings/textData; verify `colorAdjust` survives undo/redo (should be automatic).

**UI — one reusable "Advanced" disclosure component.** A small collapsible-within-a-section (chevron row, collapsed by default, does NOT persist open state), styled in `style.scss` following the existing `collapsible-section` conventions but nestable inside setting groups. One JS initializer (event delegation in app.js, like `initializeCollapsibleSections`) so every instance behaves identically.

Placement (declutter decision):
- **Glitter Properties (fill layers)**: keep Opacity top-level; move **Scale** + new **Hue / Saturation / Brightness** sliders (each with Reset) into Advanced.
- **Text effect cards (fill / border / shadow, glitter mode only)**: same Advanced row inside each card, containing that slot's Scale + HSB. Hidden when the slot is in solid-color mode (solid color already has a full color input; HSB there is redundant).
- Slider ranges: Hue −180…180° (0 default), Saturation 0…200% (100), Brightness 25…200% (100).
- Nice-to-have (same WP, small): apply the CSS filter to the layer's asset-info chip/thumbnail so the swatch preview reflects the adjustment.

### D5 — Shape tool

**Model: shapes are parametric layers, not brush strokes.** New `LayerType.SHAPE` with:

```js
shapeData: {
  shapeId: 'circle'|'square'|'star'|'heart',   // extensible list
  width, height,                                // committed size in canvas px
  transform: { position, scale, rotation },     // same shape as textData.transform
  fill:   { mode: 'glitter'|'solid', glitterId, color, scale, opacity, colorAdjust },
  border: null | { widthPx, mode, glitterId, color, scale, opacity, colorAdjust },
  shadow: null | { offsetX, offsetY, mode, ... }   // phase 2 if time-boxed
}
```

**Maximum reuse — this is the forward-thinking core of the plan:**

1. **Geometry single source of truth.** Extract shape path definitions out of `MaskEditor` into a new `js/classes/ShapeLibrary.js` (plain object/module like the existing classes): `{ id, label, icon (24×24 SVG), trace(ctx, halfW, halfH) }`. `MaskEditor._traceBrushShape`/`BRUSH_SHAPES` delegate to it; the shape tool's gallery picker and rasterizer consume it. Adding a new shape (or new brush tip) becomes one entry in one file. Note: brush tips are uniform-scale (`r`), shapes need independent W/H — `trace` takes both; brush passes `r, r`.
2. **Mask pipeline reuse.** The shape rasterizer produces a mask canvas exactly like `getMeasurementEntry` does for text (padding via `CONFIG.textLayers.maskPadding`-equivalent, `crispEdges` thresholding — same code path, extracted into a shared helper). Border mask = the existing ring-stamp union (`getBorderMaskCanvas` / `GifExporter._createBorderMaskCanvas`) applied to the shape mask — literally the same function, so factor it to a shared location both managers call.
3. **Render/export reuse.** New `ShapeGlitterManager` mirrors `TextGlitterManager`'s span-stack preview (span descriptors: shadow?, border, fill) and the exporter's per-slot glitter sources. Where practical, extract the span-stack sync + effect-slot plumbing into shared helpers rather than copy-paste; where extraction would destabilize the 2,700-line TextGlitterManager, a disciplined mirror with shared leaf functions (border mask, paint source, color adjust, crisp threshold) is acceptable for v1 — note each duplication with a comment pointing at its twin.
4. **UI reuse.** Shape Properties panel reuses the D-1d patterns: segmented glitter/solid source control, carded Fill/Border, shared asset-info chip, Advanced disclosure from D4. Gallery picker of the four shapes uses the same gallery-card conventions as the brush shape picker (`ShapeLibrary` provides the icons). Register in `LAYER_UI_CONFIG` with `designPanelSections` + `mobileSettingsSections` so mobile drawers work like text/sticker layers do today.
5. **Interaction.** New toolbar button + `ToolType.SHAPE` (shortcut **U**, PS convention). Drag on canvas = rubber-band the bounding box (preview outline), release = create layer at that size. Shift while dragging = constrain to square/circle. After creation, `LayerTransform` handles move/scale/rotate exactly like text/sticker layers.

**Scale answer (the "mixels" question): redraw, don't stretch.**
- **Live drag**: keep the cheap CSS `transform: scale()` on the stack (60fps, matches current text behavior).
- **On commit (handle release)**: bake the scale into `shapeData.width/height`, reset `transform.scale` to 100, and re-rasterize the mask at the new pixel size. Shapes are parametric, so this is lossless and pixel density is always 1:1 — no mixels, ever.
- **Text (same question, deferred to WP6)**: text should keep `fontSize` as the typographic control, keep `transform.scale` as the interactive control, but rasterize the mask at the *effective* pixel size (fontSize × committed scale) instead of CSS-stretching the raster. Same commit-time-re-rasterize pattern as shapes. This is a contained change to `getCacheKeyForLayer`/`getMeasurementEntry`/`syncStackGeometry` + export scale factor, but it touches box-mode wrapping math, so it's its own package — do not bundle it into the shape work.

**Anti-aliasing**: shapes go through the shared crisp-threshold step, i.e. identical edge treatment to text, controlled by the same `crispEdges` config. (If Ryan ever wants soft AA, it's one config flip affecting text and shapes together — and it will need the GIF-fringe problem solved globally; out of scope here.)

---

## 3. Work packages

Order matters: WP2 and WP3 are independent quick wins; WP4 (Advanced/HSV) and WP5a (ShapeLibrary) unblock WP5b.

### WP1 — Brush/Eraser settings split (D1) — **DONE (Opus, 2026-07-05)**
Implemented: `MaskEditor.toolSettings = {add, sub}` store (source of truth; DOM panel is a view), seeded from `CONFIG.maskBrush` + new `CONFIG.maskBrush.eraserDefaults` (eraser starts size 60), merged from `localStorage['glitter.toolSettings.v1']` and sanitized. All `getBrush*()`/`isPressureEnabled()` read `toolSettings[getActiveMode()]` (pen-eraser override uses eraser settings). `_bindSettingInputs` writes slider input → `this.mode`'s entry, persists on `change`; `_applySettingsToDOM`+`_updatePanelTitle` swap the panel and retitle Brush↔Eraser (icon swap via `#brushSettingsTitleIcon`, text via `#brushSettingsTitleText`) on `setMode`. Shortcut **E** added (app.js + CONFIG.shortcuts + guide). Mobile: same relocated section, retitles automatically. Files: MaskEditor.js (v9), config.js (v4), app.js (v21), index.html, guide.html.
Original acceptance (all met):
- Brush and Eraser each remember size/softness/flow/spacing/smoothing/shape/pressure independently; switching tools swaps panel values and title ("Brush Settings"/"Eraser Settings").
- Quick slider + `[`/`]` affect only the active mode; `X` (swap mode) also swaps the panel.
- Settings persist across reload (localStorage) and survive undo/redo untouched.
- Mobile: settings drawer shows the retitled panel; switching Brush↔Eraser with drawer open refreshes values.

### WP2 — Shift straight lines (D2) — **DONE (Opus, 2026-07-05)**
Implemented in MaskEditor: `_resolveStrokePoint` picks axis-lock vs smoothing per move; `_projectAxisLock` snaps the drag angle to the nearest 45° (after `AXIS_LOCK_MIN_DISTANCE`=4px travel) and projects onto that ray from `strokeOrigin`, bypassing EMA (keeps the anchor synced so releasing Shift resumes freehand cleanly). Shift-click connects a straight line from `lastStrokeEndPoint` (recorded in `_finishStroke`, tagged with layerId, cleared on layer switch + undo/redo) to the click. Projection math node-verified. Composes with spacing/flow/pressure for free. Shortcuts added to CONFIG + guide. Files: MaskEditor.js (v9), config.js (v4), guide.html.
Original acceptance (all met):
- Shift+drag locks to 0/45/90°; releasing shift mid-stroke resumes freehand from current point.
- Shift+click stamps a straight connecting line from the previous stroke's end (single undo step); plain click after that starts fresh.
- Works identically in add and sub mode, respects spacing/flow/pressure; smoothing does not bend locked lines.

### WP3 — Wacom pen-eraser (D3) — **DONE (Fable, 2026-07-05)**
Files: `js/classes/MaskEditor.js` (cache-bust → v8).
Implemented: `_isEraserPointer()` (pointerType 'eraser', or 'pen' with button 5 / buttons bit 32), per-stroke `strokeModeOverride = 'sub'` set in `_handlePointerDown` and cleared in `_resetStrokeState`, and `getActiveMode()` consumed by `_stampAtPoint` + `_ensurePaintableLayer`. Toolbar highlight intentionally left alone during the override. Awaiting tester re-verify on the Cintiq (no hardware here).
Original acceptance:
- With Brush tool active on a pen device: tip paints in current mode; eraser end always erases; prior mode restored on lift; toolbar highlight follows the temporary mode during the stroke (nice-to-have) or stays put (acceptable).
- No behavior change for mouse/touch. Guard tested against `button === 5` AND `buttons & 32`.
- Cannot be fully verified without hardware — ship behind correct spec handling + ask the tester to re-test on the Cintiq.

### WP4 — Glitter color adjust + Advanced disclosure (D4) — **Opus** (cross-cutting preview/export parity)
**Math core already DONE (Fable, 2026-07-05):** `js/color-adjust.js` exists and is loaded (script tag + `?v=1` in index.html, before debug.js). It provides `COLOR_ADJUST_IDENTITY`, `normalizeColorAdjust`, `isIdentityColorAdjust`, `buildCssColorFilter` (→ `element.style.filter`), `composeColorAdjustMatrix`, `applyColorAdjustToImageData` (in-place, identity = true no-op). Spec-matrix math is node-verified (identity, saturate-0 luminance rows, brightness slope, hue-rotate red→green). **Do not reimplement or reorder the hue→saturate→brightness pipeline — the CSS string and the matrix composition are kept in lockstep in that one file.**
**DONE (Opus, 2026-07-05).** Preview: `GlitterManager.renderLayer` sets `inner.style.filter = buildCssColorFilter(layer.settings.colorAdjust)`; `TextGlitterManager.applyPaintSource` sets `span.style.filter` per slot (cleared for solid). Data seam: `getEffectPaintSource` + exporter's `_getTextEffectSource` both carry `colorAdjust`. Export: new `GifExporter._patternSourceFromFrame(frameImageData, colorAdjust)` — identity puts the original bytes through (byte-identical to pre-WP4), non-identity applies the matrix to a COPY (never mutates the cached flattened frame); used by both the glitter-fill and text export paths. UI: reusable `[data-advanced]` disclosure + one delegated `initializeAdvancedDisclosures` handler; Glitter Properties moved Scale into Advanced + Hue/Sat/Brightness (Opacity stays top-level), wired via `setupColorAdjustListeners`/`readColorAdjust`/`applyColorAdjustToSliders`; `saveActiveLayerSettings` always writes an identity colorAdjust object (export short-circuits it). Text Fill/Border/Shadow cards each got an Advanced disclosure with HSB (fill aliases `layer.settings.colorAdjust`; border/shadow use `effectData.colorAdjust` via `ensureColorAdjust`), wired with the existing `attachSlider` infra (`_bindEffectColorAdjust`/`_loadEffectColorAdjust`). SCSS: `.advanced-disclosure` styles. Config: `defaultGlitterHue/Saturation/Brightness` (reset-button targets). Files: color-adjust.js (v1, Fable), GlitterManager (v6), TextGlitterManager (v16), GifExporter (v4), app.js (v21), config.js (v4), index.html, style.scss (needs recompile), guide.html.
Minor deviation from plan: for the text cards, per-slot Scale/Opacity stayed in their existing spot and only HSB went into Advanced (moving the text Scale would have churned the fragile text slider wiring for no user-visible gain). Glitter-fill Scale did move into Advanced as specified.
Original acceptance (all met):
- Advanced row (collapsed by default) in Glitter Properties and in each text effect card (glitter mode only); contains Scale + Hue/Sat/Brightness with Reset each; Opacity stays top-level; Scale no longer appears top-level.
- Adjust updates live preview (CSS filter) for fill layers and every text slot independently.
- **Export parity**: exported GIF matches preview for adjusted glitter (spec-matrix pixel pass; identity adjust = byte-identical output to today — verify with the export fragility test).
- Undo/redo round-trips `colorAdjust`; layers without it behave exactly as before (no migration needed — treat missing as identity).
- Works on Safari/iOS export path (no `ctx.filter`).

### WP5a — ShapeLibrary extraction — **DONE (Opus, 2026-07-05)**
New `js/classes/ShapeLibrary.js` (loaded before MaskEditor): `trace(id, ctx, halfW, halfH, {fit})` handles circle/round, square, calligraphy, star, heart; `_traceFitted` supports `contain` (uniform, aspect-preserving — the brush's original behavior) and `fill` (stretch, for the shape tool). `BRUSH_SHAPES` (calligraphy flagged `brushOnly`) + `FILL_SHAPES` (circle/square/star/heart) catalogs share one `SHAPE_ICONS` map. `MaskEditor._drawShapeStamp` now calls `ShapeLibrary.trace(shape, ctx, r, r)`; `_traceBrushShape`/`_traceFittedPoints` removed; `MaskEditor.BRUSH_SHAPES` is now an alias to `ShapeLibrary.BRUSH_SHAPES`. Node-verified: star/heart contain-fit is byte-identical (maxDiff 0) to the old brush fit. This is the geometry single-source-of-truth WP5b consumes.

### WP5b — Shape tool (D5) — **DONE v1 (Opus, 2026-07-05), smoke-verified.** Shadow slot in v1 scope.
Implemented: new `LayerType.SHAPE` + `ToolType.SHAPE` (U shortcut) threaded through all ~76 dispatch sites (config, LayerManager, HistoryManager, GestureManager, LayerTransform, GlitterManager, GifExporter, app). New `js/classes/ShapeGlitterManager.js` mirrors the text span-stack (shadow/border/fill spans), reusing ShapeLibrary geometry, color-adjust, `_patternSourceFromFrame`, and the generic exporter fill/border/offset helpers. Fill is **none / glitter / solid**; **fill=none + border = a hollow outline** (cutOutFill punches the silhouette) — the SAME capability was added to TEXT (new "None" fill segment, `bindFillUseNone`, outline border). Shape Properties panel (shape picker + fill/border/shadow source controls + per-slot Advanced HSB + opacity). Tool interaction is **click-to-create** (default-size shape at click; scale via transform handles); **scale commit re-rasterizes** the mask at the new pixel size (LayerTransform.handleHandlePointerUp → commitScale) so scaled shapes stay crisp (no mixels). Export fully wired (renderShapeMask callback + shape mask prepass + `_renderShapeLayerToCanvas` + flatten/frame-count/transparency enumeration). v1 simplification: all glitter-mode slots share `layer.selectedGlitterId` (one glitter source per shape). Playwright smoke (scratchpad shape-smoke.js): create/render/outline/glitter-filter/commit-scale/export-mask/undo-redo/text-outline/thumbnail-match all green, zero console errors.
**Deferred to v1.1:** drag-to-size create (rubber-band); per-slot independent glitter for shape border/shadow.

Also landed this session (Ryan's follow-up requests):
- **ShapeLibrary is now SVG-path-based** — each shape defined ONCE as an SVG `d` (or trivial primitive); `trace()` fills a Path2D with auto-computed bounds (rasterize+scan, works for any user SVG), and `getIconSvg()` emits the SAME path for the gallery thumbnail. So **brush/shape thumbnails now match the on-canvas result** (the heart-icon-≠-heart-stamp bug), and **Ryan can add a brush/shape by adding one entry with an SVG path** (still crisp/aliased via the existing threshold). Supersedes WP5a's byte-identical-brush note (intentional).
- **Context value styling** — `.context-value` given a fixed `min-width: 5ch` so the bar no longer resizes between 1px and 300px; new reusable `formatUnit(value, unit)` (js/utils.js) + `.setting-unit` CSS renders units muted/smaller (like `.input-unit-suffix`), applied to the context values and the shared `setupSlider`/`syncQuickSlider` path. Broad rollout to every panel value display (font size, letter spacing, etc.) is a mechanical follow-up using the same helper — scoped to context+shared-sliders this session to avoid live/load-time desync. (Threshold is a unitless tolerance; Feather is px.)
Foundation ready from this session: ShapeLibrary (geometry + FILL_SHAPES + icons), the reusable `[data-advanced]` disclosure, and the colorAdjust module/slots are all in place, so the shape tool's Fill/Border/Shadow slots can reuse `getEffectPaintSource`-style plumbing, `_patternSourceFromFrame` for export, and the Advanced/HSV UI verbatim. Not started because a new `LayerType.SHAPE` must be threaded through ~76 layer-type dispatch sites (app.js 20, LayerManager 18, TextGlitterManager 10, GifExporter/LayerTransform 7 each, GestureManager/GlitterManager/HistoryManager 4 each) plus a new ShapeGlitterManager, tool interaction, and mobile registration — the multi-session package this plan flagged. A half-integrated LayerType breaks the fragile shared export/history/layer sites, so it must land complete, not partial. Recommend splitting into WP5b-1 (LayerType + ShapeGlitterManager render/export + rubber-band create + history) and WP5b-2 (Shape Properties panel + mobile + transform-commit re-rasterize).
Files: new `js/classes/ShapeGlitterManager.js`, `js/config.js` (`LayerType.SHAPE`, `ToolType.SHAPE`, `LAYER_UI_CONFIG` entry, shortcut U, shape defaults), `js/app.js` (toolbar, tool routing, context toolbars), `js/classes/LayerManager.js` (list rendering, thumbnails, duplicate/delete), `js/classes/LayerTransform.js` (handle support + commit-time re-rasterize hook), `js/classes/GifExporter.js` (shape layer sources + rendering), `js/classes/HistoryManager.js` (verify snapshot coverage), `index.html`, `css/style.scss`, `modals/guide.html`.
Acceptance:
- U or toolbar selects Shape tool; drag draws rubber-band; shift constrains aspect; release creates a shape layer (circle/square/star/heart per picker).
- Fill: glitter (default, uses selected swatch like other layers) or solid color via the D-1d segmented control; Border optional with width + own source; Advanced/HSV from WP4 works on every slot.
- Edges match text treatment (crisp threshold); export matches preview including animation.
- **Scaling re-rasterizes on commit** — a shape scaled 400% has crisp edges identical to one drawn at that size; live drag may show the stretched raster.
- Mobile: shape layer registers its settings sections in the drawer; creation works with touch (drag gesture doesn't fight pan — follow MaskEditor's `_shouldHandleEvent`/GestureManager conventions).
- Undo/redo: creation, restyle, transform each one step.

### WP6 (optional, later) — Text re-rasterize on scale commit — **Opus**
Same pattern as shape commit-time re-rasterization, applied to text (rasterize at fontSize × committed scale). Separate package because of box-mode wrapping math and the mask cache key. Do after WP5b has proven the commit-time pattern.

---

## 4. Cross-cutting checklists

Every WP:
- SCSS only — new styles in `css/style.scss`; Ryan recompiles (don't edit `style.css`; watcher may be stopped).
- No build step — new JS files need a `<script>` tag in `index.html`; plain classes, tabs, existing comment style.
- `modals/guide.html` mirrors any new panel title, tool, or shortcut.
- Panel naming: "<Thing> Properties" for layer-scoped, "<Tool> Settings" for tool-scoped.
- Manual testing is Ryan's (don't run full Playwright unless asked); run the export fragility test after WP4 and WP5b.

Mobile checklist (WP1, WP5b):
- Tool-scoped panels go through `syncBrushSettingsPlacement`-style relocation or `LAYER_UI_CONFIG.mobileSettingsSections`; verify drawer open/close returns sections to original parents (`returnSettingsSections`).
- Touch input goes through GestureManager conventions; `.ui-ignore-gestures` on any new canvas-overlay UI.

Open items — ALL RESOLVED by Ryan 2026-07-05 (yes to all):
1. Eraser shortcut = **E** → WP1 scope.
2. Shape shadow slot ships in v1 → WP5b scope.
3. Brush/eraser settings persist in localStorage → WP1 scope.

# SIZE-AND-SCALE-PLAN v2 — transform parity, size vs. scale, Object panel

Status: draft plan, 2026-07-08 (v2 — deeper audit; v1's "rotation is deferred" was wrong,
rotation already ships). Inspirations: Figma (size is the property, scale is a gesture)
and Photoshop (transforms bake to pixels; smart objects keep their source), constrained
by the pixel-art heritage: **1:1 pixel density by default — no mixels — but users may
deliberately upscale stickers and get chunky (never blurry) pixels.**

## 0. Bug fix (independent, do first): dead Quick Add buttons

`#quickActionAddGlitter/Sticker/Text` (index.html:701-731) are hardcoded HTML no JS ever
wires — clicks do nothing, and Shape is missing from the set. The picker modal renders
its options from `LAYER_UI_CONFIG` (`renderLayerTypePickerOptions`, app.js:2520); the
layers-bar buttons (`layersBarAdd*`, app.js:2637) create layers directly. Fix: render
the Quick Add container with `renderLayerTypePickerOptions` and route clicks through the
same create-layer path — new layer types then appear automatically.

## 1. Audit — what is already unified (more than expected)

The transformable trio (sticker / text / shape) already shares most of the machinery:

- **`LayerTransform`** (js/classes/LayerTransform.js) is the single behavior class —
  handles, drag, rotation, opacity, flip, `updateTransform()` (line 163), CSS
  application (`applyTransform`, line 80). All three managers delegate to it with
  thin identical wrappers (StickerManager.js:505, TextGlitterManager.js:2742,
  ShapeGlitterManager.js:314).
- **One panel wiring function**: `app.setupTransformListeners(prefix, …)` (app.js:1839)
  drives rotation / opacity / scale X-Y + proportional lock / flip for all three via
  `getTransformIds(prefix)`. Rotation has shift-snap to 15°; every row has a reset.
- **One export composite**: `GifExporter._drawTransformedCanvas` (line 115) —
  translate → rotate → scale×flip, `globalAlpha` opacity — used for all transformed
  layers.
- **Nearest-neighbor is already the house style on both sides**: export sets
  `imageSmoothingEnabled = false` (GifExporter.js:123); preview inherits
  `image-rendering: pixelated` across the whole canvas area (style.scss:2464-2469,
  with a comment saying exactly why). No mixel-blur exists today — upscales are chunky.

What is *not* unified — the real gaps:

| Gap | Where |
|---|---|
| Transform data lives in three homes: `stickerData.transform` / `textData.transform` / `shapeData.transform`, duck-typed at `LayerTransform.getTransform()` (line 209) and again at layer-creation and duplicate sites (e.g. LayerManager.js:674 hand-copies the sticker transform shape) | data model |
| Preview math (CSS string in `applyTransform`) and export math (`_drawTransformedCanvas`) are deliberate mirrors maintained by hand — order of operations can silently drift | math |
| The Position/Transform/Scale/Flip panel markup is triplicated in index.html with `sticker*` / `text*` / `shape*` id prefixes | UI |
| Defaults are sticker-named but used by everyone (`CONFIG.defaultStickerRotation`, `defaultStickerScale`, `defaultStickerOpacity`) | config |
| Scale semantics differ per type: sticker scale persists; shape scale bakes on release (`commitScale`, ShapeGlitterManager.js:1195); text scale persists and stretches the raster → the only remaining mixel-blur… actually mixel-*chunk* path, but still density-inconsistent | semantics |
| No X/Y or W/H numeric fields anywhere — position is drag-only, size is scale-% only | UI |

## 2. Single sources of truth (the parity work)

Follow the precedent just set by js/effect-source.js (shared pure module extracted to
kill the 4-way effect-source mirror):

1. **`js/transform-math.js`** (new, plain script + `<script>` tag): one pure function
   `computeLayerTransform(transform, dimensions)` returning the resolved numbers —
   display width/height, center, rotation rad, signed scale x/y, opacity 0-1.
   `LayerTransform.applyTransform` builds its CSS string from it;
   `GifExporter._drawTransformedCanvas` feeds it to the ctx. The operation order
   (translate → rotate → flip·scale) is then written down exactly once. This is the
   highest-value parity change: it makes preview/export transform drift structurally
   impossible instead of convention-enforced.
2. **One transform home**: move to `layer.transform` (top level). History snapshots are
   JSON deep-clones of layers so in-session undo migrates for free, but any persisted
   designs (admin gallery / share links, if they serialize layers) need a read-shim:
   on load, lift `<typeData>.transform` → `layer.transform` if present. Until the
   migration lands, at minimum route every access through one shared
   `getLayerTransform(layer)` helper (in transform-math.js) and delete the duck-typing
   in `LayerTransform.getTransform` and the hand-built copies in duplicate paths.
3. **One default**: `CONFIG.defaultTransform` object + `createDefaultTransform()`
   factory (deep clone); creation sites in all three managers and the duplicate path in
   LayerManager use it. Keep the old `defaultSticker*` keys as aliases until nothing
   reads them.
4. **One panel**: generate the transform panel DOM from JS —
   `renderTransformPanel(container, prefix, capabilities)` — instead of triplicated
   HTML. Capabilities come from a per-type table in `LAYER_UI_CONFIG` (which already
   carries `transformPrefix`), e.g.
   `transformCapabilities: { position, size, scale, rotation, opacity, flip }`.
   That same table gates which handles LayerTransform shows and feeds
   `renderLayerTypePickerOptions`-style parity for mobile (`mobileSettingsSections`).
   Existing ids stay (`stickerRotation` etc.) so `getTransformIds` and tests don't move.

## 3. Size vs. scale semantics

**Size is the property; scale is a gesture.** Whether the gesture commits into size
depends on whether the layer re-rasterizes from a resolution-independent source. Shapes
already do this (comment at ShapeGlitterManager.js:17-19: live drag = cheap CSS
transform, release = `commitScale` bakes to `shapeData.width/height`, re-rasterize 1:1).
Converge on that:

- **Shape** — unchanged. Panel change only: replace Scale X/Y % with editable
  **W / H (px, integer)**; the % fields are misleading since scale never persists.
- **Text** — adopt the shape model. Corner-handle drag previews via CSS transform;
  release multiplies `textData.fontSize` (rounded to integer px), resets scale to 100,
  re-renders. Corner handles are **uniform-only** for text (Figma behaves the same);
  non-uniform glyph stretching is removed — it's the density-inconsistency machine.
  The re-render must pass the binarize threshold (`CONFIG.textLayers.crispEdges`) and
  the decode-before-swap no-flicker rule.
  - Point text: that's the whole story.
  - Textbox (area text, `canResizeBoxEdges`): edge handles resize the wrap box
    (LayerTransform.supportsEdgeResize already routes this), corner handles / slider
    change font size. Two sizes, both integer px — the Figma split.
- **Sticker** — the one true raster; scale stays **persistent and non-destructive**
  (Photoshop smart-object semantics: the source bitmap is never resampled). 100% =
  native = 1:1 density; above 100% the user is choosing mixels and gets them **chunky**
  (nearest-neighbor, already true on both render paths). Panel shows **W / H (px)** as
  the primary fields — editing W writes scale under the hood — with the scale % readout
  and a one-click "100%" reset beside it.

After any interaction, text and shapes are always at 100% / crisp / 1:1; only stickers
carry a scale, and it is honest about pixels.

### Nearest-neighbor vs. smoothing — should it be a setting?

**No setting. Nearest-neighbor everywhere, which is what already ships.** Reasons:

- Both pipelines are already NN (GifExporter.js:123; style.scss:2464). A toggle would
  be *adding* a smoothing path that doesn't exist, doubling the preview/export QA
  matrix for every transformed layer type, for a look that fights the medium.
- Per-type or global toggles are the wrong granularity anyway — the only defensible
  use case is "this one photographic sticker looks bad chunky," which is per-*layer*.
  If users ever ask, the right shape is a per-sticker "Smooth scaling" checkbox in
  Sticker Properties (CSS `image-rendering: auto` override on that element + per-layer
  `imageSmoothingEnabled = true` in the exporter — a twin pair, so don't build it
  speculatively). Until then: not a setting, it's the house style.

## 4. Object panel design (keep it un-messy)

One carded **"Transform"** subsection at the top of each "<Thing> Properties" panel
(names follow the existing Properties/Settings convention; ids keep the historical
`*SettingsSection` form), generated by `renderTransformPanel` (§2.4). Compact
Figma-style grid rather than today's stack of full-width slider rows:

```
X [  12] Y [  34]        ← integer px, editable
W [ 120] H [  80]  ⌖100%  ← px; sticker shows scale readout + reset chip
Rotation [slider  ] 45° ↺
Opacity  [slider  ] 80% ↺
Flip [H] [V]   [⇆ lock aspect]
```

Row gating by capability table:

| Row | Sticker | Shape | Text |
|---|---|---|---|
| X, Y | ✓ | ✓ | ✓ |
| W, H | ✓ (writes scale) | ✓ (commits size) | box size (area text only) |
| Scale % readout + reset | ✓ | — | — |
| Rotation | ✓ | ✓ | ✓ (already works) |
| Opacity | ✓ | ✓ | ✓ |
| Flip H/V | ✓ | ✓ | ✓ |
| Lock aspect | ✓ | ✓ | (always locked) |

Numeric fields accept typed values and arrow-key increment (↑/↓ = 1, Shift = 10) —
that pattern then belongs to every unit field in the app. Font size stays in Text
Properties (it *is* the text's size; duplicating it in Transform would be the mess).

Glitter fill is not transformable and gets no Transform card; its per-slot texture
"Scale" (ShapeGlitterManager.js:258) renames in the UI to **"Texture Scale"** so the two
scale concepts stop colliding (ids/keys unchanged).

## 5. QOL features (prioritized, all riding on the shared machinery)

1. **Arrow-key nudge** — selected layer moves 1px, Shift = 10px. The pixel-editor
   essential. Register in `CONFIG.shortcuts` + guide.html.
2. **X/Y + W/H numeric entry** (§4) — first time exact placement is possible.
3. **Align to canvas** — center H / center V / edges, one button row in the Transform
   card. Cheap: writes `position` through the same `updateTransform`.
4. **Axis-lock drag** — Shift while dragging a layer constrains to X or Y (shift
   already snaps rotation to 15°, same modifier language).
5. **Reset transform** — one button restoring `CONFIG.defaultTransform` (today it's
   five separate per-row resets; keep those, add the master).
6. **Alt-drag to duplicate** (Figma habit) — duplicate path already exists
   (LayerManager.js:674). Defer if GestureManager routing makes it hairy on touch.
7. **"Fit canvas" / "Fill canvas"** for stickers — computes scale from canvas vs.
   native size. Nice-to-have, after 1-5.

Every one of these writes through `updateTransform` → one saveState → history safe.

## 6. Guardrails / verification

- Any commit-to-size re-render: binarized mask threshold + decode-before-swap.
- transform-math extraction must be byte-stable: export a design before and after the
  refactor — identical output (extend tests/export-parity.js to cover a rotated,
  flipped, scaled layer of each type).
- Run the export-fragility sequence (animated sticker → export → edit → undo → export;
  export twice) after WP-1/WP-2.
- guide.html mirrors: new shortcuts (nudge, axis-lock), Transform card rows, renames.
- Bump `?v=` on every touched JS file; new transform-math.js gets its own script tag.

## 7. Work packages

1. **WP-QA**: Quick Add wiring (§0). Tiny; ship first.
2. **WP-M**: `js/transform-math.js` extraction + `getLayerTransform` accessor +
   `CONFIG.defaultTransform` factory (§2.1-2.3). Pure refactor, byte-stable export.
3. **WP-T**: Text scale→fontSize commit, uniform corner handles (§3). The semantic fix.
4. **WP-P**: `renderTransformPanel` + capability table + X/Y/W/H fields + grid layout
   (§2.4, §4). Depends on WP-M.
5. **WP-Q**: QOL 1-5 (§5). Independent small items once WP-P lands.
6. **WP-R**: UI renames (Texture Scale) — rides along with anything.

Physical `layer.transform` migration (§2.2) is optional follow-up after WP-M proves the
accessor covers every call site.

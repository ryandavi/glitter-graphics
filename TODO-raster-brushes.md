# Raster brushes — remaining work

Handoff plan. The decode/import pipeline, the dab-cluster stamp engine, and per-brush
scatter/jitter are **done and working**. What's left: move the tip picker into the real
gallery, tighten the scatter math to match Photoshop, and chase an undo bug.

---

## What already exists (don't rebuild)

| File | Role |
|---|---|
| `tools/abr-lib.js` | Parses Photoshop `.abr` v6.1/v6.2 — 8BIM sections, Action Descriptor, `samp` RLE tip bitmaps. Extracts `Dmtr/Spcn/Angl/Rndn/flipX/flipY` + Scattering (`useScatter`, `scatterDynamics.jitter`, `Cnt `, `countDynamics`) + Shape Dynamics (`useTipDynamics`, `szVr`, `angleDynamics`). Colour Dynamics captured but unused. |
| `tools/abr-import.js` | `.abr` → normalised grey+alpha stamp PNGs in `images/brushes/<pack>/` + a pack entry in `data/brushes.json`. **Curation:** one brush per sampled tip = the preset that uses the most of the brush engine (`dynScore`). Flags: `--all-presets`, `--keep-plain`, `--drop-sample`, `--author/--license/--tags/...`. |
| `tools/rebuild-brushes.sh` | Provenance-as-code: the exact `abr-import.js` invocation + full attribution for every pack. **Re-run after any importer change.** Needs a Node — see "Testing" below. |
| `tools/brush-sources/*.abr` | Committed originals (not served). |
| `data/brushes.json` | 5 packs / 15 brushes. Each brush: `{id,label,order,tags,categories,tip:{src,width,height},dynamics}`. `dynamics` = `{diameter, spacing, angle, roundness, flipX, flipY, scatter, bothAxes, count, countJitter, sizeJitter, angleJitter, smoothing}`. Every pack has an `attribution` block (`author/authorUrl/archivedBy/archiveUrl/license/notes`) — **keep it, this is an archival project.** |
| `js/classes/BrushLibrary.js` | Loads `data/brushes.json`. Surface: `loadManifest()`, `applyManifest()`, `isRaster(id)`, `get(id)`, `defaultDynamics(id)`, `attributionFor(id)`, `creditLine(id)`, `getTipCanvas(id)` / `loadTip(id)` (native-res white-RGB / alpha=coverage canvas, all preloaded at boot), `getCursorMarkup(id)`, plus **`GROUPS`** and **`search(query)`** (both only used by the current in-panel picker — safe to delete once the gallery lands). |
| `js/classes/MaskEditor.js` | Stamp engine. `_stampAtPoint` dispatches to `_stampPlainDab` (vector, neutral dynamics — unchanged legacy path) or `_stampDynamicDabs` → `_drawDab` (scatter/jitter). Per-stroke seeded PRNG `maskMulberry32` (seeded in `_startStrokeFromScreenPoint`). Per-brush store `this.brushDynamics` (localStorage `glitter.brushDynamics.v1`) holds scatter/jitter overrides **and** remembered `size` per raster brush. `setBrushShape` seeds Size from the brush's native `diameter`. Scatter & Jitter panel: `renderDynamicsPanel` / `_syncDynamicsPanel` into `#brushDynamicsHost`; static specs `MaskEditor.DYNAMICS_SLIDERS` / `DYNAMICS_TOGGLES`. Credit line: `_updateAttributionLine` into `#brushAttributionHost`. |
| `js/core/config.js` | `CONFIG.tools.maskBrush.rasterBrushes.manifest`, `CONFIG.tools.maskBrush.dynamics.{defaults,limits}`. Brush panel schema (`PANEL_SCHEMAS.brush`, ~line 1300): the `brushShapePicker` host card + `brushAttributionHost` + `brushDynamicsHost` card. |
| `js/ui/gallery.js` | `createShapeCard()` — has a raster branch (renders `<img>` from `BrushLibrary.get(id).tip.src`). Used by the current picker; keep the vector path (Shape tool uses it). |
| `tests/abr-import-verify.js`, `tests/brush-raster-verify.js` | Pure-Node tests (registered in `tests/run.js`, tag `mask`). |

---

## 1. Move the tip picker into the AssetBrowser gallery  *(large — the main task)*

**Why:** `MaskEditor.renderBrushShapePicker` currently hand-rolls a grouped, collapsible,
filter-boxed picker (`.brush-shape-group` / `.brush-shape-filter` / `.brush-shape-group-toggle`
— none in the design system) that duplicates the search/category/pagination logic
`ContentManager` + `AssetBrowser` already provide for Glitter and Stickers. Brush tips
should be a **third asset library**, browsed the same way.

### 1a. `data/brush-categories.json` — mirror `data/sticker-categories.json`
Shape: `[{id,name,icon,color,description,count}]`. Suggested categories and icons (standalone
SVGs already in `images/svg/`):
- `basic` → `images/svg/Rounded Star.svg` — the vector tips (round/square/star/heart/calligraphy)
- `ornament` → `images/svg/Spiral.svg` — Swirlies, Swirlies II
- `sparkle` → `images/svg/Sparkle.svg` — Sparkles, Stardust
- `heart` → `images/svg/Rounder Heart.svg` — Heart Attack

The imported brushes already carry `categories:["ornament"|"sparkle"|"heart"]` (set in
`rebuild-brushes.sh`). Vector tips get `category:"basic"` in step 1c.

### 1b. `BrushLibrary.assets()` — one method the gallery consumes
Replace `GROUPS` / `search()` with:
```js
assets() // -> [{ id, name, category, thumbnailUrl, tags, searchTerms, attribution, kind }]
```
- Raster tips: `thumbnailUrl` = `BrushLibrary.get(id).tip.src`; `kind:'raster'`.
- Vector tips (from `ShapeLibrary.BRUSH_SHAPES`): `category:'basic'`, `kind:'vector'`,
  `thumbnailUrl` = a `data:image/svg+xml,` URI built from `ShapeLibrary.getIconSvg(id)`
  (so the gallery needs no `<img>`-vs-inline-SVG special case).
- `searchTerms` = tags + pack id + label words.
`BrushLibrary` stays the single source of truth; the gallery is a pure consumer.

### 1c. `js/classes/BrushTipManager.js extends ContentManager`
Lean on the base class for everything (search/filter/facets/pagination). Implement only:
- `setupUI()` — grab DOM refs (search input, filters container, etc. — see how
  `StickerManager.setupUI` does it).
- `loadContent()` — `this.content = BrushLibrary.assets()`.
- `initBrowser()` — `this.browser = new AssetBrowser(this, {…elementIds…}, 'Brush Tips')`
  then `await this.browser.init('data/brush-categories.json')`. Element-id map mirrors
  `StickerManager` (`stickerBrowser`/`stickerBrowserBack`/`…Title`/`…Content`/
  `stickerCategoryGrid`/`stickerSearchResults`/`stickerItemGrid`/`stickerBrowserSentinel`/
  `stickerBrowserEmpty`/`…EmptyText`) → `brushTipBrowser`/`brushTip…`.
- `getLayerType()` → `null`.
- `customizeItemElement(el, item)` — `el.classList.add(item.kind === 'raster' ? 'is-raster' : 'is-vector')`.
- `updateSelection()` — toggle `.active` on the card whose `data-id` === `editor.maskEditor.getBrushShape()`.
- `handleItemClick(item)` — `editor.maskEditor.setBrushShape(item.id)`, then close the
  picker session (see `js/ui/picker-session.js`, `pickerCloseSession` / how the glitter
  fill slot returns to Properties) and re-open the `brushSettings` section.
- `matchesChildFilters` / `setupFilterChips` — optional; a category chip set keyed on
  `categories` is enough (see `StickerManager.setupFilterChips` / `populateCategoryChips`).

### 1d. `index.html` — a third gallery block
Inside `#designGalleryContent` (~line 307), mirror the sticker block (~line 564–615):
- `<div class="asset-options gallery-content" id="brushTipOptions" data-gallery-content="brush-tips">`
  containing `<div class="asset-browser" id="brushTipBrowser">…</div>` (header + back + title
  + content with empty-state / category-grid / search-results / item-grid / sentinel).
- A `<div class="section-content gallery-search-section" data-gallery-search="brush-tips">`
  with a search input (`id="brushTipSearch"`) and a `filters-container` (category chips only
  — brush tips don't need the colour/tone/temperature filters glitter has).
- Add a `<script src="js/classes/BrushTipManager.js?v=…">` tag near the other class scripts
  (after `BrushLibrary.js`, before `MaskEditor.js` is fine — `BrushTipManager` is
  constructed later in `app.js`).

### 1e. Panel-state wiring (the fiddly part — verify with the app running)
- `getPreferredDesignSection` (`js/ui/editor-panels.js`, ~line 176): with the Brush tool
  active it already returns `'brushSettings'`. When the brush-tip **picker session is
  armed**, it must return `'designGallery'` (the `if (this.pickers.active)` branch already
  does this — just make sure `BrushTipManager` is registered so `pickers.active` sees it).
- Which `.gallery-content` shows inside `#designGalleryContent` is driven by the active
  layer's `designPanelSections` list in `LAYER_UI_CONFIG` (`js/core/config.js`, e.g.
  `GLITTER_FILL` ~line 959, `STICKER` ~line 1000 lists `['stickersSearchSection',
  'stickersOptions', 'glitterSearchSection', 'glitterOptions', …]`). Add
  `'brushTipSearchSection'`, `'brushTipOptions'` to the glitter-fill entry (and any other
  layer type the brush can paint on), positioned so they're the visible ones while the
  brush-tip session is armed. Follow exactly how stickers layer their two `*Options` blocks
  over the glitter ones — do **not** invent a new visibility mechanism.
- Register: in `app.js` where the other content managers are constructed (~line 90, inside
  the `GlitterEditor` constructor), add
  `this.brushTipManager = new BrushTipManager(this);` and `await this.brushTipManager.init();`
  in `init()` alongside the others; `this.pickers.register(this.brushTipManager)`.

### 1f. `MaskEditor` — replace the in-panel picker with a launcher
- Delete `renderBrushShapePicker`, `_applyBrushFilter`, and the `.brush-shape-group*`
  branches in the `#brushShapePicker` click/input listeners in `setupUIListeners`
  (~line 128–142). Keep `renderDynamicsPanel`, `_updateAttributionLine`, and the whole
  stamp engine untouched.
- The "Brush Tip" card becomes a **current-tip preview + "Browse tips…" button** that opens
  a picker session on `editor.brushTipManager` (`pickerOpenSession(...)` from
  `js/ui/picker-session.js`, with `reveal: () => revealAssetBrowser(editor, editor.brushTipManager)`).
  Model it on how a text/shape layer's fill slot arms the glitter gallery
  (`ShapeGlitterManager` ~line 476, `pickerOpenSession`).
- `js/core/config.js` `PANEL_SCHEMAS.brush`: swap the `brushShapePicker` host card for the
  preview+button; keep `brushAttributionHost` and `brushDynamicsHost`. Add
  `CONFIG.tools.maskBrush.brushTips = { categories: 'data/brush-categories.json' }`.

### 1g. CSS
Remove `.brush-shape-group`, `.brush-shape-group-toggle`, `.brush-shape-group-count`,
`.brush-shape-filter`, `.brush-shape-group-grid` from `css/panels/_transform.scss` **and**
the hand-mirrored copies in `css/style.css` (search "brush-shape-group"). Keep
`.brush-attribution`, `.brush-dynamic-*`, `.mask-brush-cursor.raster`, and
`.brush-shape-option.is-raster` (still used by the gallery cards). Add a small
current-tip-preview style. Then `npm run build:css` (or hand-mirror if no sass).

### 1h. Tests
- `tests/brush-raster-verify.js`: replace the `GROUPS` / `search()` assertions with
  `BrushLibrary.assets()` shape checks (every record has `id/name/category/thumbnailUrl`;
  `basic` category present; raster records point at real files).
- Keep `attributionFor` / `creditLine` / seeded-PRNG / `isKnownBrushShape` assertions.

---

## 2. Scatter fidelity to Photoshop  *(small, well-scoped)*

Our model is **structurally the same** as Photoshop's Scattering + Shape Dynamics: walk the
path at `Spacing`, drop `Count` dabs per step, offset each perpendicular to the stroke
(`Both Axes` adds the tangent), then per-dab Size/Angle jitter. Differences to fix, all in
`MaskEditor._stampDynamicDabs` (~line 1500–1540):

1. **Size jitter must shrink, never grow.** Photoshop Size Jitter scales each dab *down*
   from 100% toward a minimum; it never exceeds the brush size. Current line
   `const dabSize = Math.max(1, size * (1 + sym() * dyn.sizeJitter))` can go to 200%.
   Change to something like `size * (1 - rand01() * dyn.sizeJitter)` (range
   `[size*(1-jitter), size]`), where `rand01 = () => (sym()+1)/2` or a dedicated
   `rng()` call. Update the `MaskEditor.DYNAMICS_SLIDERS` hint for `sizeJitter`.
2. **Count jitter should be "random between 1 and Count".** Current
   `Math.round(dyn.count * (1 + sym() * dyn.countJitter))` is multiplicative and can exceed
   `Count`. Change to: if `countJitter > 0`, `count = randInt(max(1, round(count*(1-countJitter))), count)`.
3. **Scatter magnitude.** Photoshop Scatter % is relative to the current brush size and
   maxes at 1000%. We store the fraction (`scatter` 0–10) and multiply by `size` — correct.
   Just confirm `CONFIG.tools.maskBrush.dynamics.limits.scatterMax === 1000` and the panel
   slider matches (it does).
4. **Colour Dynamics: nothing to do — and can't be done.** The mask brush paints coverage
   (alpha) only; all colour comes from the glitter-fill layer under the mask. Photoshop's
   foreground/background + HSB jitter has no meaning here. `abr-lib.js` already captures
   `colorDynamics` for reference and `abr-import.js` discards it. Leave it that way; note it
   in the Scatter & Jitter panel help text if anything.

Out of scope (Photoshop has, we deliberately don't): dynamic "Control" sources
(Fade / Pen Pressure / Tilt driving scatter/count/size), Minimum Roundness, Roundness
Jitter, Flip Jitter, Brush Projection, Dual Brush, Texture, Wet Edges, Build-up.

Add/extend a test in `tests/brush-raster-verify.js`: with a fixed seed, assert every dab's
size ≤ brush size and dab count ≤ `Count`.

---

## 3. Undo does nothing after an image-brush stroke  *(needs a live repro)*

**Symptom (user):** paint a stroke with a raster brush → Undo button is enabled and reads
"Undo Paint mask" → clicking it changes nothing on the canvas. Vector-tip strokes undo
fine.

**Investigation done:** drove the app in headless Chrome via CDP, 5 variants (single
stroke, multi-stroke restore-to-content, redo, real vs synthetic strokes). The data path
round-trips correctly every time: `_finishStroke` → `glitterManager.commitPaintState`
(bumps `layer.maskVersion`, stores a paint snapshot) → `editor.saveState('Paint mask')` →
`HistoryManager.undo` → `restoreState` → `glitterManager.restorePaintState` clears/reblits
the mask; `MaskCompositor` cache invalidates by `paint.version`. **Could not reproduce.**

**Leading theory:** before the size-default fix, some raster brushes painted at a tiny/odd
scale, so the stroke — and therefore the undo — was near-invisible. May already be resolved.
If it still repeats:
- Confirm with the user: which brush, how many strokes, does the **canvas visibly change on
  the stroke itself** (if not, it's a paint/size issue, not undo).
- Check `MaskEditor._stampAtPoint`: it `return`s early **without** setting
  `this.strokeChanged = true` when `_stampDynamicDabs` returns `false` (raster tip not
  decoded). Tips are preloaded in `BrushLibrary.loadManifest`, so this shouldn't fire — but
  add a guard: block stroke start until `BrushLibrary.getTipCanvas(id)` is non-null (await
  `loadTip` in `_startStrokeFromScreenPoint`), or mark the stroke pending and re-stamp on
  load.
- Check `GlitterManager.reconcileHistoryVisualCaches` (runs on every restore): it copies
  `previousLayer._maskImageCache` onto the restored layer. If the raster mask's async PNG
  encode is still `pending` at restore, the branch keeps the stale `url` with `key:null`;
  verify a re-render is scheduled after the encode resolves.

Add `tests/mask-undo-verify.js` if a fix lands (drive `GlitterManager` snapshot + restore
with stub canvases; assert `maskVersion` / `maskHasContent` round-trip through undo/redo).

---

## 4. Cleanup / done-criteria

- `npm run cache:bust` after touching `index.html` assets.
- `npm run build:css` (regenerates `css/style.css` from SCSS — the repo commits the compiled
  file; it was hand-mirrored during the raster work, so a real sass build should be a no-op
  diff or a tidy-up).
- `npm run lint` clean (rules: `no-unreachable`, `no-unused-vars` warn, `no-dupe-class-members`,
  `no-fallthrough`, `no-self-assign`).
- `npm test -- --tag mask` green (`abr-import-verify`, `brush-raster-verify`, and
  `mask-undo-verify` if added).
- `.DS_Store` is now git-ignored; the old `images/brushes/bhbrush*png/` folders and the
  `.abr` moves are already staged.

---

## Testing without the normal toolchain

This machine has **no standalone Node / npm / node_modules**. A working Node 22 ships inside
Photoshop:
```
NODE="/Applications/Adobe Photoshop 2025/Adobe Photoshop 2025.app/Contents/MacOS/node"
"$NODE" tests/brush-raster-verify.js
NODE="$NODE" tools/rebuild-brushes.sh
```
For UI verification, headless Chrome is present (`/Applications/Google Chrome.app`), drive
it over CDP with the built-in `WebSocket` in that Node (`--headless=new
--remote-debugging-port=9333`), and serve the repo with `python3 -m http.server`. The app
exposes `window.editor`. Note: in headless the layout can differ enough that synthesised
mouse drags miss the canvas — call `editor.maskEditor` methods directly instead.

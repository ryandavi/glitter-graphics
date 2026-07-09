# PROJECT-SAVE-PLAN — save/load project files, config cleanup, no-layer panel polish

**Written:** 2026-07-08. **Status:** implemented in code on 2026-07-09; Sass compiled, manual visual verification still pending.
**Scope:** (1) save/load the working project as JSON (not the exported GIF), (2) move the default
file name (and friends) out of GifExporter into CONFIG, (3) shared file/format helpers in utils.js,
(4) no-layer panel: Canvas Size rows restyled to the standard settings-row pattern + a new Project
Name field that feeds both the GIF and project-file names.

Read first: CLAUDE.md invariants (paintHistory/maskVersion, no-flicker, binarized masks) and
docs/MASK-FEATURE-PLAN.md §6. HistoryManager.createStateSnapshot() is the closest existing thing
to a serializer — this plan deliberately reuses it rather than inventing a second layer format.

---

### Fable's expansion (2026-07-08)

Split-out note 2026-07-09: the overlap / group-select work now also has its own companion doc,
`docs/GROUP-SELECT-PLAN.md`.

**0.1 is a small standalone fix; 0.2/0.3 is a plan-sized feature of its own** — write it up as
its own doc (GROUP-SELECT-PLAN) when dispatching, don't ride it on the save/load WPs. Neither
changes the project file format (selection is session state; `activeLayerId` already saves).

#### 0.1 Overlap selection defect

The hit-test itself is NOT the bug — `LayerManager.getTopVisibleLayerAtPoint` walks the z-order
top-down and would happily return the other layer. **Root-cause hypothesis (verify first):**
once a layer is selected, its move surface — the `.transform-bounding-box` overlay and/or the
layer's own DOM element, plus GestureManager's single-finger layerDrag route (which only
hit-tests the ACTIVE layer via `isPointInLayer`) — claims pointerdown and starts a move-drag
before any re-hit-test runs. So a click landing on an overlapping neighbor *inside the selected
layer's box* never reaches the selection path.

Fix (Figma rule): **selection follows the topmost hit, not the current selection.**
- Add `LayerManager.getLayersAtPoint(x, y)` returning the full hit stack (generalizes
  `getTopVisibleLayerAtPoint`, same per-type `hitTestMethod` dispatch).
- On pointerdown over the canvas/bounding-box interior: re-hit-test. Topmost hit ≠ active →
  switch selection AND begin the drag on the new layer in the same gesture. The bounding box
  keeps priority only for its handles (corner/edge/rotation) — interior clicks re-hit-test.
- Deep select for true stacks: **Alt+click cycles downward** through the hit stack (wraps).
  Matches the modifier doctrine in QOL-FEATURES ("Alt = alternate action"). Don't use
  double-click (taken by text edit). Add to `CONFIG.shortcuts` + guide.
- Touch: route taps through the same re-hit-test (GestureManager tap route). No Alt on touch —
  the layers list is the deep-select fallback (Canva does the same).

#### 0.2 Multi-select + group transform

- **Model:** `editor.selectedLayerIds: Set` alongside `activeLayerId` (= most recently
  selected; property panels stay single-layer, keyed off it). Shift+click canvas or layer list
  adds/removes; plain click replaces; empty click clears. Movable types only
  (sticker/text/shape) — glitter-fill/base are mask-space and stay single-select.
- **Group box:** union AABB of the selected layers' frames, rendered as ONE bounding box
  reusing the LayerTransform handle DOM (same `.transform-handle-wrapper` classes so the
  GestureManager/MaskEditor capture-phase exclusions keep working).
- **Move** = same dx/dy to every member's `transform.position`. **Scale** (uniform, corners
  only in v1) = scale member positions about the group-box center + multiply each member's own
  scale; on release, run each member's existing commit path (shape `commitScale` re-rasterize;
  text per WP-T bake when that lands). **No group rotation in v1** — it forces orbit math +
  per-type rotation composition; defer.
- **History:** one `saveState()` per group gesture (existing pattern). Nudge/center/delete/
  duplicate iterate the set — group align/distribute becomes nearly free afterwards (QOL list).
- **Panel:** multi-select shows a minimal "N layers selected" state (count + group-capable
  actions); per-type properties render only for single selection. Export path untouched —
  group transform only writes per-layer values it already understands.

#### 0.3 Touch impact

Contained, because GestureManager is already the single router:
- The Canva rule (TOUCH-PLAN D1) generalizes: the **group box counts as "the selected layer"**
  — pinch with both fingers inside the union box = group scale/translate; else viewport zoom.
  The two-finger route's `isPointInLayer` check becomes point-in-union-box when the set > 1.
- One-finger drag inside the union box = group move (same layerDrag route, iterate the set).
- **Adding to a selection has no Shift on touch:** do selection editing in the layers list
  (tap = replace; a small multi-select toggle or checkboxes in the list/mobile drawer =
  add/remove). No long-press canvas gesture in v1 — long-press is undefined today and cheap to
  add later if the list flow feels slow.
- Both touch suites (`tests/touch-smoke.js`, `tests/touch-handle-verify.js`) need new checks:
  overlap tap-through, group pinch vs viewport pinch disambiguation, handle exclusions on the
  group box.


## 1. Project file format

### 1.1 Decisions

- **One self-contained `.json` file**, downloaded like the GIF. No zip container (no build system,
  no new vendored lib), no server storage. Binary payloads ride along as base64 data URLs — the
  base image is capped at `CONFIG.maxFileSizeMB` (10 MB) so worst case is ~13 MB of base64, fine
  for a local file.
- **The file stores the *current* document, not the session**: no undo history, no UI state (open
  sections, zoom, active tool), no derived fields. Loading a project resets history to a single
  baseline snapshot, exactly like `loadImage()` does.
- **Masks: only each glitter layer's current mask, encoded as PNG.** `paintHistory` (all versions)
  stays out of the file — `maskVersion` is a pointer into in-memory history and is meaningless in
  a file. The live `paint.add` / `paint.sub` canvases are PNG-encoded (`canvas.toBlob('image/png')`
  → base64). PNG is lossless (soft brush edges round-trip exactly; the binarize step for text/shape
  masks is unaffected — those masks are *derived* from textData/shapeData and are not stored at
  all) and compresses flat-alpha regions to a few KB vs 640 KB raw per channel at 800×800.
  Layers with `maskVersion === 0` / no content store nothing.
- **Assets are stored by reference, not by copy**: `selectedGlitterId`, `fontId`, sticker
  `stickerSourceId` for built-in stickers. The one exception is **user-uploaded stickers** —
  their blob URLs die with the session, so any `user-upload-*` sticker actually referenced by a
  layer is embedded (original file bytes as data URL, keyed by its upload id so `stickerSourceId`
  pointers survive round-trip). Unreferenced uploads are not saved.
- **Base image**: the original uploaded file bytes (fetched from `originalImage.src` blob URL),
  not the flattened ImageData — this is what preserves animated-GIF base images. For blank
  canvases created in-app, store `{ preset: { width, height, color } }` instead of file bytes and
  recreate via the blank-canvas path.

### 1.2 Shape (format version 1)

```json
{
	"format": "glitter-project",
	"version": 1,
	"savedAt": "2026-07-08T21:14:00Z",
	"name": "birthday-card",
	"canvas": { "width": 800, "height": 800 },
	"baseImage": {
		"mimeType": "image/gif",
		"data": "data:image/gif;base64,...",
		"preset": null
	},
	"layers": [ /* per-type layer records, §1.3 */ ],
	"activeLayerId": 3,
	"masks": {
		"2": { "add": "data:image/png;base64,...", "sub": "data:image/png;base64,..." }
	},
	"customStickers": {
		"user-upload-1720400000000": { "name": "cat", "mimeType": "image/png", "data": "data:..." }
	}
}
```

Field notes (answers to "what else should it have?"):
- `savedAt` — ISO 8601 UTC. Yes to a date; it costs nothing and helps Ryan sort files. Nothing
  else temporal: no "modified" (there's no identity for a downloaded file), no session stats.
- `name` — the Project Name field verbatim (may be empty string; empty = use default file name).
- No `appVersion` / commit hash — the `version` integer is the only compatibility contract; app
  builds that share a format version must read each other's files. No thumbnails, no author, no
  settings echo (CONFIG defaults are the app's business, not the file's).

### 1.3 Layer records — reuse, don't reinvent

`HistoryManager.createStateSnapshot()` already serializes every layer type to plain JSON (sticker
via `StickerManager.serializeSticker`, text/shape via deep-cloned `textData`/`shapeData`, glitter
fill with `selections` + `settings`). **Extract that per-layer mapping into shared functions** —
`serializeLayer(layer, editor)` / `deserializeLayer(data, editor)` (new methods on LayerManager, or
a small `js/layer-serializer.js`) — and have BOTH HistoryManager and the project serializer call
them. One format, one place to update when a layer type grows a field. Project records differ from
history records only in that:
- `maskVersion` is dropped (replaced by the `masks` map);
- runtime nulls (`stickerData.element`, `frames`) are already excluded by `serializeSticker`;
- history's shared-reference tricks (canvas ImageData reuse) don't apply — everything is data.

`selections` arrays serialize as-is (already plain JSON in history snapshots).

### 1.4 Load path

New `ProjectSerializer` class (`js/classes/ProjectSerializer.js`, script tag + `?v=1`):

1. Parse + validate (`format` tag, integer `version`, canvas dims sane, `layers` is array).
   Reject with a friendly `showError` on garbage; **reject `version >` current** with "made with
   a newer version of the editor".
2. Run migrations (§1.5) until `version` === current.
3. If there's an open image with unsaved changes (`!isSaved`), confirm before replacing —
   same stakes as the `beforeunload` guard.
4. Register embedded `customStickers` into `StickerManager.userContent` (new blob URLs from the
   data bytes, **same ids** so `stickerSourceId` resolves).
5. Rebuild the base image through the existing `loadImage` flow (data URL → blob → the same
   `img.onload` pipeline — reuse, don't fork it; factor the current `loadImage` body into a
   `loadImageFromBlob(blob)` that both paths call). Wait for `originalImage != null`.
6. `deserializeLayer` each record (await sticker/font loads — the history restore path shows the
   pattern including `ensureFontLoaded` error reporting).
7. Masks: for each entry, decode both PNGs (`Image` preload — same decode-before-use rule as the
   mask-swap no-flicker rule), draw into `ensurePaintMask(layerId)` canvases, then
   `commitPaintState(layer)` so the mask becomes a **new baseline paintHistory snapshot** with a
   fresh version (never fabricate `maskVersion` numbers by hand — MASK-FEATURE-PLAN §6).
8. `historyManager.reset(createStateSnapshot())`, `isSaved = true`, set Project Name field,
   full UI refresh (renderLayersList, updatePreview, loadActiveLayerSettings, status bar).

Entry points: an "Open Project" button in the welcome section next to "New Blank Canvas", and the
image dropzone accepts `.json` drops (sniff extension/mime before treating a drop as an image).

Save trigger: "Save Project" `btn-icon` next to Export GIF in `.preview-controls-right`
(secondary, not primary). Save sets `isSaved = true` (same flag export uses today). Download via
the shared `downloadBlob` util (§3). Add shortcut `Ctrl+S` → save project in `CONFIG.shortcuts`;
mirror the new buttons + shortcut in `modals/guide.html`.

### 1.5 Versioning and migrations

- `ProjectSerializer.FORMAT_VERSION = 1` and a migration table:
  ```js
  // Each entry upgrades exactly version N → N+1. Pure data-in/data-out.
  static MIGRATIONS = {
  	// 1: (data) => { ...; data.version = 2; return data; },
  };
  ```
  Loader loops `while (data.version < FORMAT_VERSION)`, errors if a step is missing.
- **Rules for future format changes** (write these as a comment block at the top of the class):
  - Adding an optional key with a sensible default does **not** bump the version — the
    deserializer must default every missing key (v1 files stay loadable forever).
  - Renaming, re-typing, or re-meaning a key **does** bump the version and ships a migration.
  - Never repurpose an old key name.
  - Unknown keys in a file are ignored, not errors (forward-tolerance for minor cases).
- Layer `settings` objects ride on the same contract: deserialization merges over per-type
  defaults, so new sliders added later just default on old files — no migration needed.

### 1.6 Parity check

After load, the document must export identically to the session that saved it. Manual check
(matches the CLAUDE.md export fragility test): build a doc with an animated base GIF + painted
glitter fill + text + custom sticker → export → save project → reload page → load project →
export again → outputs byte-identical.

---

## 2. Config moves (GifExporter → CONFIG)

New `CONFIG.export` block in js/config.js:

```js
export: {
	// Base name for every user-facing download (GIF + project file) — promotes the site.
	// Extension is appended per save type; Project Name field overrides the base when set.
	defaultBaseName: 'ryandavi-com_glitter',
	workers: 4,
	quality: 1,
	timing: { forceDelay: 100, maxFrames: 60 },
	watermarkAlphaThreshold: 128,
	// Size-warning thresholds for the export result panel (bytes).
	sizeWarnings: [
		{ message: 'Too big for Discord', limitMB: 10 },
		{ message: 'Too big for Twitter', limitMB: 15 },
		{ message: 'Kind of huge for a typical GIF...', limitMB: 50 },
		{ message: 'Too big for Discord Nitro', limitMB: 500 }
	]
}
```

- GifExporter's constructor seeds `this.config` from `CONFIG.export` (keep `workerScript` and
  `useAdaptiveQuality` in the exporter — implementation details, not tuning knobs).
- `fileName` is **computed, not configured**: `getProjectFileName('gif')` (§3) replaces the three
  uses (`GifExporter.js:10`, `:1774`, `:1960`).
- Project file extension: `.glitter.json` (self-describing, still opens as JSON everywhere).
- Not moving: gif.worker.js path, canvas pool internals, `debug` (already reads CONFIG.debug).

---

## 3. Utils additions (js/utils.js)

- `formatBytes(bytes, decimals)` — lift `GifExporter._formatBytes` verbatim; exporter delegates.
  (It's a formatting util in the same family as the existing `formatUnit`.)
- `downloadBlob(blob, fileName)` — the anchor-click dance currently inline at
  `GifExporter.js:1960`; used by GIF export, project save, and any future download.
- `sanitizeFileName(name)` — strip `\/:*?"<>|`, trim dots/spaces, collapse whitespace to `-`,
  empty result → null. Used by `getProjectFileName`.
- `getProjectFileName(ext)` on the editor (not utils — it reads editor state):
  `(sanitizeFileName(this.projectName) || CONFIG.export.defaultBaseName) + '.' + ext`.
- **Not** moving `gcd`/`lcm` (single caller, exporter-internal math) or canvas helpers (each
  manager's canvas usage is deliberately local). Utils stays small.

---

## 4. No-layer panel (a.k.a. "design gallery" right column, `#noLayerSettingsSection`)

### 4.1 Canvas Size → standard settings rows

Current markup (index.html:714-739) uses bespoke `.canvas-size-fields` / `.canvas-size-field` /
`.setting-label`. The house pattern for labeled W/H number inputs is the New Canvas modal
(index.html:2358-2381): `settings-row` → `settings-row-header` → `settings-row-label-main` +
`settings-row-control` with `input-unit` + `input-unit-suffix` px.

- Convert Width, Height, and the Anchor row to that pattern. **Keep ids**
  (`canvasSizeWidth`, `canvasSizeHeight`, `canvasSizeAnchor`, `canvasSizeApply`,
  `canvasSizeReset`) — `setupCanvasSizeControls()` and `syncCanvasSizeInputs()` are untouched.
- The action buttons row stays as-is (`canvas-size-actions`).
- SCSS: retire `.canvas-size-fields`/`.canvas-size-field` rules in css/style.scss (never touch
  style.css); anchor-grid styles stay. Bump `style.css?v=` in index.html; note for Ryan that SCSS
  needs recompiling.
- Sanity-check the same rows against the SIZE-AND-SCALE-PLAN transform W/H work (not yet
  dispatched) — both should land on the settings-row pattern so we don't create a third variant.

### 4.2 Project Name field

**Placement revised 2026-07-08 (Ryan's "document level" question):** the name is project
identity, not a canvas property — it must not be selection-dependent (a name/save affordance
that vanishes when a layer is selected is wrong by construction). Home = **app header**, the
empty center between `.app-header-left` (logo) and `.app-header-right` (Guide/About): a
Canva/Figma-style inline editable title, `#projectNameInput`,
`placeholder="ryandavi-com_glitter"` (fed from `CONFIG.export.defaultBaseName` in JS so the
string lives in one place), `maxlength="60"`, styled as quiet text that becomes an input on
focus. This also solves mobile for free — the header renders in every state, unlike the
no-layer panel (`NO_LAYER.mobileSettingsSections` is `[]`).

- State: `editor.projectName` (string, default `''`). `input` listener updates it; **not** part
  of history snapshots (typing a name is not undoable document state) but **is** saved in the
  project file (`name`) and restored on load.
- Consumers: `getProjectFileName('gif')` for export, `getProjectFileName('glitter.json')` for
  project save. Blank → default base name, per Ryan's spec.
- Save/Open Project buttons follow the same rule (chrome, not panel): Save next to Export GIF
  in `.preview-controls-right`, Open in the welcome section + dropzone `.json` handling (§1.4).
  An unsaved-changes dot on the title (driven by `isSaved`) is a cheap later add.
- guide.html: mention the field under the export/save docs.

### 4.2b Doctrine: what "no layer selected" means (resolved 2026-07-08)

**Implementation update 2026-07-09:** Ryan preferred the project controls back in the sidebar.
The shipped UI now uses a **Project** card in the no-layer / Canvas panel, with a generic
`"Name..."` placeholder, Open Project there plus in the welcome state, and Save Project there
instead of beside Export GIF.

The no-layer state is the **canvas level**, not a junk drawer for everything project-ish.
Figma's deselect→page-properties pattern is the model, with three sorting rules:
- **Canvas properties** (size, background color, trim-to-content): live HERE. Background color
  could defensibly live on the base-image layer panel instead — one home only, and the
  no-layer panel wins on discoverability.
- **Project identity/workflow** (name, save, open): app chrome (§4.2), never
  selection-dependent panels.
- **"What next" affordances** (Quick Add): the empty state — that's what empty states are for.
Rename the section framing from "No Layer Selected" (an apology) toward "Canvas" (a place);
keep a one-line "Select a layer to edit it" hint. The §4.3 document-info line fits better in
the **status bar** (already shows dimensions, visible in every state) than in this panel.

**Not the design gallery.** The gallery being the app's original only-panel is history, not an
argument: D-1c/D-1d deliberately stripped it down to a pure browse/pick surface with an
explicit picker-session model, its visibility is the most context-dependent in the app (picker
sessions, own mobile drawer/tab, accordion special-cases), and parking document properties in a
panel that opens because you're picking a border glitter re-creates the pre-D-1c muddle.

---

### 4.3 What else belongs in the no-layer panel — ideas (2026-07-08, unreviewed)

The no-layer state is the app's *document level* — the panel should hold everything that is
about the project rather than a layer. Ranked by value-per-effort:

1. ~~Project group becomes the document hub.~~ **Superseded by §4.2/§4.2b** — project
   identity (name, save, open, unsaved dot) moved to app chrome; the no-layer panel keeps only
   canvas-level items.
2. **Autosave + session restore.** The single highest-value companion to save/load, and nearly
   free once ProjectSerializer exists: debounce-serialize to IndexedDB (not localStorage — the
   base-image data URL can exceed the ~5 MB quota) after each `saveState()`, and offer a
   "Restore last session" card in the welcome section when a snapshot exists. Kills the whole
   class of lost-work-on-crash pain that `beforeunload` only warns about. Ship as WP-E after
   WP-D.
3. **Canvas group grows two siblings of Canvas Size:**
   - **Background color** for blank-canvas projects (the New Canvas preset color is currently
     write-once). Recolors `originalImageData` + pushes a history state; hidden when the base
     is an uploaded image.
   - **Replace base image, keep layers** — today a new upload wipes all layers; the machinery
     to survive dimension changes already exists in the Canvas Size path (masks composited to a
     new baseline snapshot, selections offset). Medium effort, real workflow win (recolor the
     photo, keep the glitter).
4. **Document info line** under the Project group: `800×800 · 7/25 layers · ~24 export frames`.
   Dimensions and layer count are free; the frame count from the exporter's LCM/`maxFrames`
   logic is the genuinely useful bit — today you only learn a design explodes to 60 frames
   *after* a slow export. (A pre-export *size* estimate is not feasible — GIF encoding cost
   isn't predictable — so show frames/duration, not MB.)
5. **Trim to content** button next to Canvas Size actions (Photoshop Trim): shrink canvas to
   the union of layer ink + non-transparent base pixels, reusing the Canvas Size resize path
   with a computed rect. Nice-to-have; do after 3.
6. Deliberately **not** here: zoom/fit (preview controls own view state), export settings
   (export flow owns them), tool tips/shortcut hints (guide.html owns discoverability), canvas
   rotate/flip (niche for this app, and it multiplies the mask-resize surface).

Prerequisite regardless: the Quick Add buttons in this panel are currently dead
(`#quickActionAdd*` have no JS wiring — SIZE-AND-SCALE-PLAN WP-QA, in the current Codex batch).
Whatever else lands here, verify that fix arrives, since Quick Add is the panel's main action.

## 5. Work packages

Order matters: WP-A unblocks nothing but is trivial; WP-B is standalone UI; WP-C/WP-D are the
feature and depend on WP-A's helpers.

- **WP-A — config + utils plumbing** (small, completed 2026-07-09): `CONFIG.export` block; GifExporter reads it;
  `formatBytes` / `downloadBlob` / `sanitizeFileName` in utils.js; `getProjectFileName` on the
  editor wired into the three GifExporter fileName uses. Bump `?v=` on config.js, utils.js,
  GifExporter.js, app.js.
- **WP-B — no-layer panel** (small, completed 2026-07-09): §4.1 settings-row conversion + §4.2 Project Name field +
  SCSS retirement + guide.html. Depends on WP-A only for the placeholder constant.
- **WP-C — save** (medium, completed 2026-07-09): shared `serializeLayer`/`deserializeLayer` extraction (HistoryManager
  refactored onto them — behavior-identical, verify undo/redo still passes the export fragility
  test), ProjectSerializer with `serialize()` → blob, mask PNG encoding, custom-sticker embedding,
  Save Project button, `Ctrl+S` in CONFIG.shortcuts + guide.html.
- **WP-D — load** (medium-large, completed 2026-07-09): `loadImageFromBlob` refactor, validation + migration loop,
  unsaved-changes confirm, sticker re-registration, mask decode → `commitPaintState` baseline,
  history reset, welcome-section Open Project button + dropzone `.json` handling.

Verification per WP: `node tests/touch-smoke.js` and `node tests/touch-handle-verify.js` still
pass; WP-C/D additionally run the §1.6 parity check manually (Ryan) — no new Playwright suite
unless asked.

### 5.1 Implementation note (2026-07-09)

- Landed in code: project JSON save/load, shared layer serialization, sidebar Project controls, Save/Open Project entry points, `Ctrl+S`, and the Canvas panel row polish.
- `node -c` syntax checks passed for `js/app.js`, `js/classes/ProjectSerializer.js`, and `js/classes/GifExporter.js`.
- `node tests/touch-handle-verify.js` passed after the change set.
- `node tests/touch-smoke.js` hit a Windows sandbox ACL error in this Codex session and still needs a normal local rerun.
- `css/style.scss` changed; `css/style.css` still needs Ryan's normal Sass compile step before the UI changes are visible in-browser.
- Remaining non-save/load work from this doc is the 0.1-0.3 overlap / group-select feature set, now tracked in `docs/GROUP-SELECT-PLAN.md`.

## 6. Dispatch prompts (Codex)

WP-A + WP-B are one small combined /goal; WP-C and WP-D are separate /goals that must both read
this doc + CLAUDE.md + docs/MASK-FEATURE-PLAN.md §6 before touching mask or history code. Draft
prompts when dispatching — this doc is the spec they point at.

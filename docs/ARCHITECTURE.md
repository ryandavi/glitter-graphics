# Architecture

A map of how the Glitter Graphics editor fits together. Referenced from `AGENTS.md`. It describes the system as it is. Planned changes live in the active plans in `docs/plans/` (local-only), chiefly the architecture audit. Update this file as those changes land.

## Stack

- **Editor:** `index.html` plus plain browser scripts in `js/`. No framework, no bundler, no modules. Every file defines globals (`class Foo {}`, `function bar()`, `const BAZ = …`).
- **Admin:** PHP and MySQL under `admin/`, run on local XAMPP. See `admin/README.md`.
- **Styles:** SCSS partials under `css/`, compiled to `css/style.css` by Ryan.
- **Asset data:** JSON manifests in `data/`, written by the admin export (see "Asset data" below).

## Boot sequence

1. `index.html` loads scripts in dependency order. Roughly: vendor libraries, then `js/core/releases.js`, `js/core/fields.js`, `js/core/config.js`, `js/core/layer-types.js`, `js/ui/panel-schemas.js`, `js/paint/paint-slots.js` and the layer-type definitions in `js/layers/types/` (each calls `registerLayerType`), then the rest of `js/core`, `js/effects`, `js/paint`, `js/transforms` and `js/ui`, followed by the `js/editor` method bags, domain classes in `js/layers`, `js/assets`, `js/export` and `js/systems`, and finally `js/app.js`. **Order matters:** a script can only use globals defined by scripts above it at load time. Put a new script tag after everything it depends on at the top level. Large optional payloads (`mp4-muxer`, the Preservation timeline data and `HtmlSceneExporter`) load on first use through `loadScriptOnce`. `tools/bump-cache.js` adds content hashes to local tags, lazy script URLs, worker URLs and worker `importScripts` dependencies.
2. `js/app.js` mixes the `js/editor/*` method bags (`EDITOR_SETTINGS_METHODS`, `EDITOR_PANEL_METHODS`, …) into `GlitterEditor.prototype` with `Object.assign`.
3. An async IIFE at the bottom of `app.js` loads the shape and brush manifests, then constructs `GlitterEditor`.
4. The constructor renders the sidebar from `PANEL_SCHEMAS` (`renderPanelSections`, then `renderTransformPanels`) and the context toolbars from `CONFIG.ui.contextToolbars`, then constructs the managers and subsystems. Managers may cache panel elements in their constructors, which is why schemas render first.
5. `editor.init()` creates the exporters, then initializes the sticker, glitter, brush-tip and font libraries.
6. `window.editor` is the live instance, which is useful in DevTools and headless probes.

## Who owns what

The `GlitterEditor` instance (`editor`) holds every subsystem. Two kinds of `*Manager` exist; see the `js/` naming notes in `AGENTS.md`.

| Concern | Owner | Notes |
|---|---|---|
| Layer list, selection, ordering, serialization | `LayerManager` (`editor.layerManager`) | `editor.layers` and `editor.activeLayerId` are getters over it. |
| Glitter-fill layers, and the glitter asset library | `GlitterManager` | Code that only needs a glitter asset reads `editor.glitterLibrary` (today the same object). |
| Painted masks and their version history | `PaintMaskStore` (`editor.paintMaskStore`) | Live add/sub canvases per glitter-fill layer plus the versioned snapshots that undo states name through `maskVersion`. |
| Sticker layers and sticker assets | `StickerManager` | |
| Text layers | `TextGlitterManager` | Fonts (manifest and FontFace loading) come from `FontLibrary`; the font picker UI stays in the text panel. |
| Shape layers and shape image fills | `ShapeGlitterManager` | Shape definitions come from `ShapeLibrary`. |
| Canvas background (image, solid, gradient, glitter) | `BaseBackgroundManager` | The base-image layer, including its glitter-mode preview element. |
| Filter layers | `FilterLayerManager` | |
| Undo and redo | `HistoryManager` | |
| Zoom and pan | `ViewportManager` (`editor.viewport`) | |
| Touch and pointer input | `GestureManager` | |
| Transform handles | `LayerTransform` (one per layer), `GroupTransformManager` (multi-select) | Both describe their handles to `SelectionChrome`, which draws them in the screen-space `SelectionOverlay` (`editor.viewport.selectionOverlay`) and hit-tests them. Drag math is shared in `transform-gestures.js`. |
| Brush and eraser mask painting | `MaskEditor`, composed by `MaskCompositor` | |
| Auto Glitter | `AutoGlitterManager` | A session tool that emits glitter-fill layers. |
| Export | `SceneCompositor` (`editor.sceneCompositor`, composes frames for every format); encoders `GifExporter` (`editor.exporter`), `Mp4Exporter`, `StillImageExporter` | See "Export path". |
| Project files | `ProjectSerializer` | `.glitter.json`, with versioned migrations. |
| Modals, mobile drawers | `ModalManager`, `MobileManager` | |
| User feedback | `NotificationCenter` (`editor.notifications`) | See "User feedback". |

## Where state lives

| Kind | Where | Rule |
|---|---|---|
| Static defaults and tunables | `CONFIG` in `js/core/config.js` | Recursively frozen. Never assigned at runtime. Any user-tunable or twice-used value goes here; inline `??` fallbacks that restate a CONFIG default are forbidden. |
| Layer-type definitions | `LayerType` and `registerLayerType` in `js/core/layer-types.js`; one definition per type in `js/layers/types/<type>.js`, collected into `LAYER_UI_CONFIG` | See `docs/LAYER-TYPE-CONTRACT.md`. |
| Sidebar structure | `PANEL_SCHEMAS` in `js/ui/panel-schemas.js` | Rendered by `js/ui/panel-renderer.js`. |
| Editable property specs | `FIELDS` in `js/core/fields.js` | Label, unit, range and default per property. Panel rows stamp them; slot and layer defaults read them. |
| Asset browsers | `ASSET_BROWSERS` in `js/ui/asset-browser-markup.js` | Glitter, sticker and brush-tip search, filters and browser, rendered from two templates. |
| Tools | `TOOLS` in `js/core/tools.js` | One entry per tool: button, icon, shortcut command, availability, canvas cursor and `onCanvasAction`. `ToolType`, `TOOL_GROUPS` and `TOOL_TOUCH_ROUTES` derive from it. |
| Commands and shortcuts | `COMMANDS` in `js/core/commands.js` | Dispatched by `js/ui/keyboard.js`. |
| Runtime user preferences | `PREFERENCES` in `js/core/preferences.js` | `PREFERENCES.get(key)` / `set(key, value)`, persisted to `localStorage`. |
| Export settings | `EXPORT_SETTINGS_SCHEMA` + `SettingsStore` in `js/ui/settings-store.js` | Declares storage key, default and validation per setting. |
| Shared option lists | `OPTION_REGISTRY` in `js/core/options.js` | Canonical values and labels for repeated choices. |
| Export targets | `EXPORT_TARGETS` in `js/core/export-target.js` | Capabilities and exporter dispatch per format. |
| Memory instrumentation | `MemoryLedger` in `js/systems/MemoryLedger.js` | App-owned buffers and every `createAppCanvas` backing store; inspect with `window.glitterMemory()`. |
| Document content | layer objects in `editor.layers` | See "Layer data model". |
| Painted masks | `PaintMaskStore` | Binary buffers, **not** in layer JSON. Layers hold `maskVersion` pointers. |
| Base image pixels | `editor.originalImageData`, `originalAlphaChannel`, `originalCanvas` | Replace-only: never mutate them in place, because history snapshots share them by reference. |

## Layer data model

Every layer has `id`, `type` (a `LayerType` value), `name`, `visible`, `locked` and `opacity` (0–100, the only whole-layer opacity; nothing mirrors it). Movable layers also have `transform`, and optionally `blendMode` and `animation`. Type-specific data lives under one key:

| `LayerType` | Data |
|---|---|
| `base-image` | `background`: the fill slot, plus `pixelEffects` |
| `glitter-fill` | `selections` (color-picked regions), `settings` (threshold, feather, invert, contiguous, multiSelect), `fill`, `maskVersion` |
| `sticker` | `stickerData` (custom serializer in `StickerManager`) |
| `text-glitter` | `textData`: text, font, layout, `fill`, `border`, `shadow`, `textBackground` |
| `shape` | `shapeData`: `shapeId`, size, `fill`, `border`, `shadow` |
| `filter` | `filterData` |

**Paint slots.** `fill`, `border`, `shadow` and the text background's `fill` are "paint slots": a source mode (`none`, `solid`, `gradient`, `glitter`, `image`) plus color, gradient, glitter id, scale, opacity, color adjust and texture offset. Every slot is one self-contained object. Each layer type declares its slots once, back to front, in its `paintSlots` list (key, role, path on the layer, draft path, default glitter, panel id prefix, source modes, editable fields). `js/paint/paint-slots.js` owns the concept:

- `getLayerPaintSlots(layer)` lists a layer's slots with their data and whether each is present and renders. `getLayerFillSlot(layer)` returns the fill slot whatever the type. Preloading, document scaling, the Effects badge, export culling and project-load glitter repair all iterate this list instead of naming slots per type.
- `resolvePaintSlotSource` turns slot data into a render source (through `resolveEffectPaintSource` in `js/paint/effect-source.js`). Preview uses `resolvePaintSlotPreviewSource`, which adds only a live check that the glitter is in the library.
- `buildSlotStack(layer, resolveSource)` returns the slots to draw in paint order. It holds the one ordering rule: a border drawn in front moves after the fill. The preview span stack and the export compositor both read it.
- `applyPaintSourceToElement` is the one DOM painter for a resolved source: text and shape spans, the sticker shadow, the glitter fill and the canvas background.

**Editable fields.** A type's `fields` and its slots' fields are bindings: a data path plus a `FIELDS` spec. One declaration drives the control's range and default, the slot's default value, document rescaling (`documentScale`, read by `js/core/document-scaler.js`) and the panel binding. `bindFieldControls(host)` / `syncFieldControls(host, layer)` in `js/ui/paint-slot-controls.js` bind and sync every declared control by id (`panelPrefix` + suffix for slots): sliders, number fields, source modes, glitter chips, colors, effect toggles, border options, texture position and the gradient editor. The text, shape and sticker managers supply only a host that says how their layer re-renders and records history. `syncSlider` in `js/ui/slider.js` is how any other code shows a programmatically set slider value.

**Canonical state.** A layer is normalized once, where it enters the document: its manager's `createLayer`, `LayerManager.deserializeLayer` (undo/redo, clipboard, project load, cloning) through `LAYER_UI_CONFIG[type].serialization.normalize`. Getters and render paths read the canonical shape and never write defaults. Older data is brought to the current shape by `ProjectSerializer.migrateLayerState`, which runs in the versioned project migrations and on every deserialize (clipboard payloads can come from an older build).

**Transforms.** Movable layers (sticker, text, shape) keep a transform `{ position, rotation, scale, flipX, flipY }`. It lives only at `layer.transform`; `getLayerTransform(layer)` (`js/transforms/transform-math.js`) reads it and returns an unstored identity placement for types without one. Scale writes go through `LayerTransform.updateTransform`, which clamps with `clampLayerScale`.

**Layer frames.** Each movable type declares two layer-local boxes on its `registerLayerType` definition, read through `getLayerFrame` and `getLayerVisualBounds`. The `frame` is the object's body (content, border and background plate, no shadow); handles, click hit-testing (`LayerManager.isPointInLayer`), alignment, snapping and group bounds use it. `visualBounds` adds the shadow and covers every painted pixel; export culling and crop-to-artwork use it.

**Settings modals.** The Export Settings and Settings modals render from `EXPORT_SETTINGS_LAYOUT` and `APP_SETTINGS_LAYOUT` (`js/ui/settings-store.js`) through `js/ui/settings-renderer.js`. Export rows take their label, description and control from their `EXPORT_SETTINGS_SCHEMA` entry. Custom widgets (the type and format controls, the GIF Look preview, the fidelity slider, the HTML Scene group) are `<template>`s in `index.html`.

**Memory.** `getMemoryBudget()` (`js/systems/MemoryLedger.js`) returns this device's byte budgets from `CONFIG.memory` (a smaller set on iOS and devices reporting 4 GB or less). Undo history trims its oldest steps past the history budget, keeping `minHistorySteps`; paint history evicts past its own budget; rebuildable preview caches are `ByteBudgetCache`s that share one LRU budget; an animated GIF export asks first when its estimated peak memory exceeds the export budget.

**Handle gestures.** Handle drags are relative to the grab point: nothing changes until the pointer travels `dragThresholdPx` screen pixels, scale handles follow the pointer's movement from the true frame corner, and rotation adds the pointer's change in angle around the frame center (Shift snaps to 15°). Selection chrome is sized in screen pixels, outside the zoomed canvas.

## Render path (live preview)

Preview is DOM, export is canvas. Every visual feature exists twice, and the two must match.

1. Code that changes what's visible calls `editor.requestPreviewUpdate()`. It coalesces to one `requestAnimationFrame`. Don't call `updatePreview()` directly.
2. `updatePreview()` reuses the processed base-canvas pixels when the background signature is unchanged, then iterates the registered layer managers and calls each one's `renderContent(visibleLayers)`.
3. Managers **reconcile** their DOM under `.canvas-elements-container`; they never clear and rebuild it.
   - Glitter fills: an animated GIF `background-image` plus a CSS `mask-image` blob.
   - Text and shapes: a stack of masked spans, one per paint slot, reconciled by `reconcileSlotStack` from `buildSlotStack`. Each manager's `getSlotMask` supplies the mask for a slot.
   - Stickers: an `img`, plus an optional shadow span.
4. `ViewportManager` zooms and pans by transforming `.preview-wrapper`. Above 100% it applies nearest-neighbor display to the whole stack and commits a compositor repaint after continuous input settles. At 600% and above the optional pixel grid appears. `PixelGridOverlay` draws it on an unscaled canvas beside the wrapper, placing each one-device-pixel line from the viewport transform and `devicePixelRatio`; it hides only during animated view transitions. `will-change` is active only during active viewport movement.
5. Layer animation is sampled by `GlitterAnimation.sampleAt` and applied by `AnimationTicker` to a `.layer-anim-wrapper`. Export samples the same function, so preview and export share one timeline.

## Export path

1. `editor.exportCurrentTarget()` resolves the active `EXPORT_TARGETS` entry, snapshots the settings and dispatches through that target's `exporter` key.
2. `SceneCompositor` prepares masks, fonts and sources, then builds one export plan per layer (`_buildLayerExportPlan`). Text and shape layers share one plan: their manager's `renderSlotMasks(layer)` builds every slot mask with the same functions the preview uses, and `_renderSlotStackToCanvas` composites `buildSlotStack` in order. Every slot, the glitter fill and the canvas background paint through `_paintSourceInto`, and authored sources come from the declared slots (`_getSlotAuthoredSources`).
3. `ExportTimeline` and `AuthoredFrameResolver` decide which frames to render and their timing.
4. `SceneCompositor` renders every frame: `planAnimation` plans an animation (GIF pre-renders its kept frames, MP4 gets a schedule and a renderer for its entries) and `composeFrameAt` composes one still. **All formats use it:** `GifExporter` encodes with `GifEncodingPipeline` and `GifPalette`; `Mp4Exporter` encodes with WebCodecs and the vendored `mp4-muxer`; `StillImageExporter` encodes PNG, JPEG or a still GIF.
5. `ExportResultPresenter` shows the result.

Pixel-level math only: never `ctx.filter`, because iOS Safari doesn't support it. Masks are binarized (`CONFIG.rendering.crispMaskEdges`) so transparent GIF exports don't fringe.

## Undo and redo

- Call `editor.saveState(label)` once per **committed** user edit, not on every slider tick. Slider bindings usually save on commit.
- Repeated small edits share a `coalesceKey`, for example `saveState('Move layer', { coalesceKey: \`nudge:${ids}\` })`.
- A snapshot is `LayerManager.serializeLayer` for every layer, plus canvas size and base-image references. Painted masks are stored separately as versioned binaries; snapshots hold `maskVersion` pointers. Anything that serializes state must account for that.
- Restoring rebuilds the layer objects, so nothing is cached on them. Preview caches live in their manager, keyed by layer id plus a content key (`GlitterManager.maskImages`, `TextGlitterManager.previewMaskUrls`, `ShapeGlitterManager.maskUrlCache`, the `MaskCompositor` caches), so a restored layer reuses them when its content matches.

## User feedback

- Status line: `editor.updateStatus(message)`.
- Errors: `editor.showError(message)`, which queues an accessible toast.
- Confirmation: `await editor.confirmAction({ … })`.

The policy lives in `NOTIFY_POLICY` (`js/ui/notify.js`), and `tests/unit/notification-policy.js` enforces it. Debug output goes through `dbg()` (`js/core/debug.js`), which prints only when `CONFIG.debug.enabled`.

## Asset data

- `data/glitter.json`, `data/stickers.json` and their category files are written by the admin **export** (`admin/includes/assetAPI.php`). The export also writes a lightweight `*.index.json` for browsing and per-asset detail files under `data/glitter/` and `data/stickers/`. The editor loads the index at boot and fetches details on selection.
- `data/fonts.json`, `data/shapes.json` and `data/brushes.json` are edited through the admin manifest pages (`admin/fonts.php`, `shapes.php`, `brushes.php`).
- `data/rendering-rules.json` holds analyzer weights shared by the admin upload path and the analyzer.
- Don't hand-edit generated manifests. Re-export from the admin, or run `node tools/split-manifests.js` to regenerate the index and detail files from a full manifest.
- Attribution (author, source, license) follows one schema across brushes, stickers and fonts: `js/core/attribution.js`.

## Content modals

`modals/*.html` are loaded into document modals at runtime. The guide and the article pages (`guide.html`, `history.html`, `personal-web.html`, and any local-only pages) are generated from `content/src/*.src.html` by `node tools/build-modals.js`; edit the source, never the output. The guide's `{tool:…}`, `{tool-icon:…}`, `{panel:…}` and `{shortcuts}` tokens are filled from the app registries at build time, and `tests/unit/shortcut-coverage.js` fails when the built guide is stale. The article lint (`modal-lint`) doesn't apply to the guide. `docs/local/HISTORY-PAGE-STYLE-GUIDE.md` (local-only) governs the history page's voice and citations.

## Workers

`js/workers/` holds `auto-glitter.worker.js` (palette analysis), `pixel-effects.worker.js` (background pixel effects) and `gif.worker.js` (GIF encoding). Workers load shared code with `importScripts`, so anything they import must be DOM-free. `tools/bump-cache.js` stamps both worker constructor URLs and their `importScripts` dependencies.

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
| Text layers | `TextGlitterManager` | Fonts (manifest and FontFace loading) come from `FontLibrary`; the Text panel shows the current font and the Library's Fonts (`FontBrowserManager`) picks one. |
| Shape layers and shape image fills | `ShapeGlitterManager` | Shape definitions come from `ShapeLibrary`. |
| Canvas background (image, solid, gradient, glitter) | `BaseBackgroundManager` | The base-image layer, including its glitter-mode preview element. |
| Filter layers | `FilterLayerManager` | |
| Undo and redo | `HistoryManager` | |
| Zoom and pan | `ViewportManager` (`editor.viewport`) | |
| Touch and pointer input | `GestureManager` | |
| Transform handles | `LayerTransform` (one per layer), `GroupTransformManager` (multi-select) | Both describe corners, full-edge strips, rotation zones, anchor/radius controls and the feedback badge to `SelectionChrome`, which draws them in the screen-space `SelectionOverlay` (`editor.viewport.selectionOverlay`) and hit-tests them. Drag math is shared in `transform-gestures.js`. |
| Brush and eraser mask painting | `MaskEditor`, composed by `MaskCompositor` | |
| Auto Glitter | `AutoGlitterManager` | A session tool that emits glitter-fill layers. |
| Templates | `TemplateLibrary` + `TemplateManager` | Project templates load through `ProjectSerializer`; overlay templates preview temporary layers, then commit them as ordinary editable layers. |
| Export | `SceneCompositor` (`editor.sceneCompositor`, composes frames for every format); encoders `GifExporter` (`editor.exporter`), `Mp4Exporter`, `StillImageExporter` | See "Export path". |
| Project files | `ProjectSerializer` | `.glitter.json`, with versioned migrations. |
| Modals, mobile drawers | `ModalManager`, `MobileManager` | |
| User feedback | `NotificationCenter` (`editor.notifications`) | See "User feedback". |

Transformable layers keep `transform.position` as the element center and store `transform.anchor` as fractions of the displayed frame after flip and before rotation. `getLayerAnchorPoint` resolves that pivot in canvas space; changing the anchor alone never moves artwork. Rotation, flip, numeric scale and Alt-resize keep it fixed. Pivot animations use the same anchor through `getLayerAnimationOrigin`; orbit motion keeps an independent `orbitCenter` on its animation entry.

## Where state lives

| Kind | Where | Rule |
|---|---|---|
| Static defaults and tunables | `CONFIG` in `js/core/config.js` | Recursively frozen. Never assigned at runtime. Any user-tunable or twice-used value goes here; inline `??` fallbacks that restate a CONFIG default are forbidden. |
| Layer-type definitions | `LayerType` and `registerLayerType` in `js/core/layer-types.js`; one definition per type in `js/layers/types/<type>.js`, collected into `LAYER_UI_CONFIG` | See `docs/LAYER-TYPE-CONTRACT.md`. |
| Sidebar structure | `PANEL_SCHEMAS` in `js/ui/panel-schemas.js` | Rendered by `js/ui/panel-renderer.js`. |
| Add menu | `LAYER_UI_CONFIG[*].addableViaModal` + `ADD_MENU_COMMANDS` | One grouped menu for layer creation and generators. Overlay templates join Generate from the template manifest. |
| Templates | `data/templates.json` + `data/templates/*.glitter.json` | Manifest mode selects `project` (New Canvas) or `overlay` (Add > Generate); both payloads use the project format. |
| Editable property specs | `FIELDS` in `js/core/fields.js` | Label, unit, range and default per property. Panel rows stamp them; slot and layer defaults read them. |
| Preset libraries | `createPresetLibrary` in `js/ui/preset-library.js` | Frozen, searchable entries from one or more sources. Applying an entry copies its plain value; `presetGrid` renders the shared grouped keyboard-navigable picker. |
| Filter operations and looks | `FILTER_OPS` in `js/effects/filter-ops.js`; `FILTERS` in `js/effects/filters.js` | Operations own CSS and pixel painters. A look owns fields and a recipe; its render tier derives from its operations. The Looks grid and selected-look settings render from these entries. |
| Library kinds | `ASSET_BROWSERS` in `js/ui/asset-browser-markup.js` | One entry per pickable asset kind (glitter, stickers, brush tips, shapes, fonts): search, filters, browser `layout` (`folders` or `grouped`), rendered from two templates. Each kind is a `ContentManager` subclass with an `AssetBrowser`; recents and favorites come with the base class and live in `PREFERENCES` (`libraryRecents`, `libraryFavorites`). |
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

Every layer has `id`, `type` (a `LayerType` value), `name`, `visible`, `locked` and `opacity` (0–100, the only whole-layer opacity; nothing mirrors it). Movable layers also have `transform`, and optionally `blendMode` and `animations`. Type-specific data lives under one key:

| `LayerType` | Data |
|---|---|
| `base-image` | `background`: the fill slot |
| `glitter-fill` | `selections` (color-picked regions), `settings` (threshold, feather, invert, contiguous, multiSelect), `fill`, optional `border`/`shadow`, `maskVersion`, `transform` (places the canvas-sized mask surface; the mask, selections and brush strokes stay in that surface's own px) |
| `sticker` | `stickerData` (custom serializer in `StickerManager`) |
| `text-glitter` | `textData`: text, font, layout, `fill`, `border`, `shadow`, `bevel`, `textBackground` |
| `shape` | `shapeData`: `shapeId`, size, `fill`, `border`, `shadow`, `bevel` |
| `filter` | `filterData` |

**Paint slots.** `fill`, `border`, `shadow`, `bevel`, `sparkles` and the text background's `fill` are "paint slots": a source mode (`none`, `solid`, `gradient`, `glitter`, `image`) plus color, gradient, glitter id, scale, opacity, color adjust and texture offset. Every slot is one self-contained object. Each layer type declares its slots once, back to front, in its `paintSlots` list (key, role, path on the layer, draft path, default glitter, panel id prefix, source modes, editable fields). `js/paint/paint-slots.js` owns the concept:

- `getLayerPaintSlots(layer)` lists a layer's slots with their data and whether each is present and renders. `getLayerFillSlot(layer)` returns the fill slot whatever the type. Preloading, document scaling, the Effects badge, export culling and project-load glitter repair all iterate this list instead of naming slots per type.
- `resolvePaintSlotSource` turns slot data into a render source (through `resolveEffectPaintSource` in `js/paint/effect-source.js`). Preview uses `resolvePaintSlotPreviewSource`, which adds only a live check that the glitter is in the library.
- `buildSlotStack(layer, resolveSource)` returns the slots to draw in paint order. It holds the one ordering rule: a border drawn in front moves after the fill. The preview span stack and the export compositor both read it.
- `applyPaintSourceToElement` is the one DOM painter for a resolved source: text and shape spans, the sticker shadow, the glitter fill and the canvas background.

**Editable fields.** A type's `fields` and its slots' fields are bindings: a data path plus a `FIELDS` spec. One declaration drives the control's range and default, the slot's default value, document rescaling (`documentScale`, read by `js/core/document-scaler.js`) and the panel binding. `bindFieldControls(host)` / `syncFieldControls(host, layer)` in `js/ui/paint-slot-controls.js` bind and sync every declared control by id (`panelPrefix` + suffix for slots): sliders, number fields, source modes, glitter chips, colors, effect toggles, border options, texture position and the gradient editor. The text, shape and sticker managers supply only a host that says how their layer re-renders and records history. `syncSlider` in `js/ui/slider.js` is how any other code shows a programmatically set slider value.

The Posterize and Dither filter looks and Auto Glitter share the `paletteColorCount`, `paletteMerge` and `paletteDetail` field specs plus the `analysisPaletteStyle` option registry; `GlitterPixelEffects` and `palette-analysis.js` are the shared engines. The canvas used to carry its own Pixelate/Palette effect (`background.pixelEffects`); project format v5 migrates it into a filter layer directly above the canvas (`ProjectSerializer.migrateCanvasPixelEffects`).

**Layer animation.** Animatable layers store an ordered `animations[]` stack. Each entry is one normalized motion preset with its own timing, easing and parameters. The editor allows up to `CONFIG.tools.animation.maxStackSize` entries (currently 3), while loading keeps extra entries from newer project formats intact. `GlitterAnimation.sampleAt` samples every entry on the shared document clock and composes their affine transforms in stack order, multiplies opacity and adds hue. Preview and export consume that same composed sample. Export registers one timeline source per entry so motions with different periods can be planned without flattening their clocks. Project format v6 migrates the former singular `animation` object into the first stack entry; `migrateLayerState` applies the same conversion to older clipboard/history payloads.

**Sparkles.** `sparkles` is a paint-slot role: a slot scatters small animated glyphs over its host layer (sticker, text, shape, fill layer, frame and the canvas each declare one, and the Sparkles layer type is nothing but one canvas-sized slot, for weather in front of everything). `js/paint/sparkles.js` owns the concept: `SPARKLE_GLYPHS` (the particle shapes), `SPARKLE_PRESETS`, a seeded layout (`computeSparkleLayout`, emitter `inside` scatters over the host's opaque pixels, emitter `edges` follows the host's outline (its box edge when it has no pixels), emitter `highlights` is Kira Kira and puts one star on each highlight that `js/effects/highlight-detect.js` finds), and per-frame sampling (`sampleSparkleFrame`). Particle motion comes from the motion library: every `MOTION_REGISTRY` entry with a `particleLabel` is a sparkle behavior, and each particle does a whole number of cycles per slot cycle, so GIF loops close. Motions marked `wrapY` (`fall`, `rise`) travel one emitter-area height per period, and the sampler wraps them inside the area; they are particle-only (`particleOnly` on their `CONFIG` preset keeps them out of the layer animation picker). A type supplies its pixels through `sparkleHost(editor, layer)` on its definition; layouts and host pixels are cached per content key. Preview reconciles a `.sparkle-layer` of masked spans inside the host element (`reconcileSparkleLayers`) and `AnimationTicker` repaints it through the target's own `paint`; export draws the same layout with `drawSparkleFrame` into the host's surface, and each slot registers one procedural timeline source through its type's `timelineSources`. `buildSlotStack` leaves sparkles out: they are particles, not a masked surface.

**Distance-field effects.** `js/paint/mask-geometry.js` owns the exact Euclidean signed-distance field and round dilation/erosion used by borders, sticker outlines and shadow spread; `createShadowMaskCanvas` also fades a shadow's edge over its Blur px from that field (a soft glow at offset 0), so the fade is identical in preview and export. A transparent GIF can only keep or drop a pixel, so when a layer has a blurred shadow `GifEncodingPipeline` dithers alpha below its cut through a fixed Bayer pattern instead of dropping it (`transparency.ditherSoftEdges`). Hard borders retain four-neighbor morphology. Outline slots can fill enclosed transparent counters by flood-filling edge-connected transparency and adding only the unreachable regions to the outline mask. `js/paint/bevel.js` derives soft inner highlight/shade masks from that same field for the Smooth, Chisel, Pillow, Emboss and Gloss profiles; its scale-aware Sobel normals smooth lighting across raster contour steps without softening the thresholded silhouette. Those soft inner masks are intentionally not binarized, so transparent export edges stay crisp. Text and shape preview/export consume the same manager mask callbacks. Sticker effects rasterize at the displayed box size; animated sticker outlines use the union of all frame alpha by default, and can retain the silhouette interior to act as a backing plate.

**Frames.** The Frame layer type (`js/layers/FrameLayerManager.js`) is a border around the picture. `js/paint/frames.js` owns its registries: `FRAME_KINDS` (`style`, a ring painted with the frame's `fill` slot, or `image`, a frame-category sticker fitted to the box), `FRAME_STYLES` (CSS's border styles as band tables: slices of the ring's thickness with a shade per side, sides meeting at the corner diagonals) and `FRAME_PRESETS`. `buildFrameShadeMasks` splits the ring into one mask per shade, and `shadeFramePaintSource` shades the fill for each (solid and gradient colors directly, glitter through its color adjust brightness), so the preview span stack and the export slot stack (`_buildSlotStackExportPlan` with the frame's `buildStack`) paint the same bands. A pinned frame (the default) derives its box and transform from the canvas on every read (`syncPinnedGeometry`) and is not transformable, so it follows canvas resizes and lets clicks through; unpinned, it keeps its box and bakes resizes into it like a shape.

**Gradient presets.** `js/paint/gradient-presets.js` registers one `GRADIENT_PRESETS` library used by every shared gradient editor. Presets are copied into the paint slot and are not serialized by id. Their thumbnails and rendered layers both pass through `effectGradientToCss` / the shared effect-gradient stop expansion, preserving preview/export parity.

**Text warp.** `textData.warp = { type, bend }` bends where glyphs are placed in the text mask, so every slot drawn from that mask (border, shadow, bevel, sparkles) bends with the text, and preview and export share it through the one mask canvas. `js/paint/text-warp.js` owns `WARP_TYPES` (`none`, `arc`, `arch`, `wave`, `flag`, `bulge`; Arc at 100% is a full circle and a saved `circle` loads as `arc`; each is a DOM-free `layoutGlyphs(glyphs, bend, metrics)` returning a placement per glyph) and the `WARP_PRESETS` grid. `TextGlitterManager.getMeasurementEntry` measures the flat layout first, then, for an active warp, lays glyphs out one by one around the flat block's center and rebuilds the ink, the per-line rects (Text Background) and the frame from the warped glyph boxes; warped point text's body hugs its ink. A warp that changes nothing (`none`, or bend 0) keeps the flat drawing path, so unwarped text keeps its exact pixels. `matchWarpPreset` names the tile a tuned warp belongs to (nearest preset of the same type and direction, flagged `modified`), so the grid and the Warp card header never lose the type.

**Style presets.** `js/paint/style-presets.js` registers one `STYLE_PRESETS` library per target type (text, shape, sticker). An entry is a partial paint-slot bundle keyed by slot key (plus plain `data` field paths, e.g. a text preset's font); a shared look keeps only the slots its target declares. Applying one owns the fill, border, shadow and bevel slots: named slots are switched on and reset to their defaults plus the preset's values, effect slots it leaves out are switched off (parked as drafts), and a left-out fill is kept. It runs through the type's field host as one edit, so one history step. `findStylePresetId` recognizes a layer that still matches a look, for the grid's active tile; anything else reads "Custom" in the Style card header. Text and shape tiles are real renders (`js/ui/style-preset-thumbnails.js`: the look applied to a throwaway sample layer, masks from the manager's `renderSlotMasks`, painted back to front like `SceneCompositor`); sticker tiles stay a CSS sketch.

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
   - Glitter fills: an animated GIF `background-image` plus a CSS `mask-image` blob, in a canvas-sized stack the layer transform places (`GlitterManager.syncElementScale`). Anything that reads a pointer against the mask goes through `GlitterManager.getMaskLocalPoint` first; a color pick samples the base image in document px.
   - Text and shapes: a stack of masked spans, one per paint slot, reconciled by `reconcileSlotStack` from `buildSlotStack`. Each manager's `getSlotMask` supplies the mask for a slot.
   - Stickers: an `img`, plus an optional shadow span.
	- Tier-1 filters: recipe operations from `FILTERS` become CSS backdrop and overlay children through their `FILTER_OPS` painters. Tier-3 filters snapshot the layers below through a dedicated `SceneCompositor`, cache that input separately from the processed output, and show the output canvas at the filter's stack position. A snapshot is shown only while its input signature (the serialized layers below) is current: `FilterLayerManager.syncSnapshot` drops a stale one so the live layers show until the re-render lands, and a pressed-pointer gesture on a layer under a displayed snapshot shows the live layers until release (`liveEditing`). `editor.saveState` calls `noteSceneEdited` so edits that skip a preview update are re-checked. `PREFERENCES.filterPreviewLevel` selects Off, Still or Animated; constrained devices fall back from Animated to Still. `GlitterFilter.renderToCanvas` runs the same pixel recipe for preview and export.
4. `ViewportManager` zooms and pans by transforming `.preview-wrapper`. Above 100% it applies nearest-neighbor display to the whole stack and commits a compositor repaint after continuous input settles. At 600% and above the optional pixel grid appears. `PixelGridOverlay` draws it on an unscaled canvas beside the wrapper, placing each one-device-pixel line from the viewport transform and `devicePixelRatio`; it hides only during animated view transitions. `will-change` is active only during active viewport movement.
5. Layer animation is sampled from `GlitterAnimation.MOTION_REGISTRY` and applied by `AnimationTicker` to a `.layer-anim-wrapper`. Preview and export pass the same sampling context (`canvasW`, `canvasH`, `boxW`, `boxH`, `layerId`, `seed`) to the same sampler, and type definitions provide their ticker and timeline hooks.

## Export path

1. `editor.exportCurrentTarget()` resolves the active `EXPORT_TARGETS` entry, snapshots the settings and dispatches through that target's `exporter` key.
2. `SceneCompositor` prepares masks, fonts and sources, then asks each layer manager for its export plan through `LAYER_UI_CONFIG[type].managerKey`. Text, shape and fill-layer managers share the slot-stack compositing path: their `renderSlotMasks(layer)` builds every slot mask with the same functions the preview uses, and `_renderSlotStackToCanvas` composites `buildSlotStack` in order. Every slot, the glitter fill and the canvas background paint through `_paintSourceInto`, and authored sources come from the declared slots (`_getSlotAuthoredSources`). A prepared composition context can be reused by repeated still snapshots without reloading sources or rebuilding masks.
3. `ExportTimeline` and `AuthoredFrameResolver` decide which frames to render and their timing.
4. `SceneCompositor` renders every frame: `planAnimation` plans an animation (GIF pre-renders its kept frames, MP4 gets a schedule and an async renderer for its entries) and `composeFrameAt` composes one still. Filter plans may await pixel operations such as a real JPEG encode/decode round-trip. **All formats use it:** `GifExporter` encodes with `GifEncodingPipeline` and `GifPalette`; `Mp4Exporter` encodes with WebCodecs and the vendored `mp4-muxer`; `StillImageExporter` encodes PNG, JPEG or a still GIF. JPG Quality remains an encoder setting; authored recompression generations belong to the JPEG Crunch filter look, not export settings.
5. `ExportResultPresenter` shows the result. Its Animation analysis list ends with an Export time row: wall-clock seconds per phase from `createExportPhaseTimer`, which the progress reporters feed.

Long export loops give the main thread back with `yieldForExportProgress` (a message task). Never pace export work with `requestAnimationFrame`: it waits for a screen refresh per yield, runs at half rate in iOS Low Power Mode and stops in a hidden tab.

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

`modals/*.html` are loaded into the modals at runtime. Every one (guide, welcome, about, preservation, history, personal-web, and any local-only pages) is generated from `content/src/*.src.html` by `node tools/build-modals.js`; edit the source, never the output. How to write a page is in [content/AUTHORING.md](../content/AUTHORING.md).

- **Registries.** `content/entities.json` holds every named site, program, organization, work, person and handle, each with a `kind`; `content/sources.json` holds every citation, shared across pages. `tools/content-registry.js` loads and validates both.
- **Rendering.** `{@slug}` renders by kind: sites get an icon on their first mention per section, glosses become a tooltip on the first mention per page, handles and hosted sites get a hover card (`js/ui/tooltip.js`, reading `js/generated/entities-data.js`). `{references}` renders a page's citations in first-citation order.
- **Generated files.** Each build also writes `css/generated/_entity-icons.scss` (icon variables, handle accents and domain rules, used by `css/modals/_entities.scss`), `js/generated/entities-data.js` (names, kinds and relations for the hover cards and the Preservation timeline filter) and `.vscode/content.code-snippets`. `--check` fails when any of them is stale.
- **Lint.** `tools/modal-lint.js` runs token and structure rules on every page, and the prose rules (em dash, bare dates, bare names) on the articles only.
- The guide's `{ui-tool:…}`, `{ui-tool-icon:…}`, `{ui-panel:…}` and `{ui-shortcuts}` tokens are filled from the app registries at build time, and `tests/unit/shortcut-coverage.js` fails when the built guide is stale. `tests/unit/modal-build-unit.js` fails when any built page is stale or a timeline entity is missing from the registry.
- `docs/local/HISTORY-PAGE-STYLE-GUIDE.md` (local-only) governs the articles' voice and citations.

## Workers

`js/workers/` holds `auto-glitter.worker.js` (palette analysis) and `gif.worker.js` (GIF encoding: gif.js 0.2.0 with one local patch, a color cache in `indexPixels`, noted in its header; re-apply it if the file is ever replaced). `js/effects/highlight-detect.js` is worker-safe but runs on the main thread today, on a copy of the host capped at `CONFIG.tools.sparkles.analysisMaxSide`. Workers load shared code with `importScripts`, so anything they import must be DOM-free. `tools/bump-cache.js` stamps both worker constructor URLs and their `importScripts` dependencies.

## Stretchable assets

Sticker assets may carry `slice: {top, right, bottom, left, mode}` in base-image pixels. The admin validates nonnegative integer insets and a nonempty center; modes are `stretch` and `round`. The browse index carries only `sliced`; the full detail and project layer copy carry the insets. Zero insets on one axis describe a three-slice banner.

`js/paint/nine-slice.js` shares source/destination rectangles between reconciled DOM background spans and canvas rendering. Sticker layers copy the metadata and enable Smart Stretch by default; `sliceEnabled` disables it per layer. Protected corners use the smaller scale, or the unsliced axis scale for banners. Pixel-art scale snapping happens in base pixels before variant conversion. Round tiles are bounded by `CONFIG.tools.nineSlice.maxTiles`.

Frame image layers copy slice and variant metadata, default to Smart Stretch when available, and use `frameData.sliceScale` (Border Scale) to size protected borders. Preview, hit alpha, effect masks and exports share sliced geometry. Sticker picking continues to use its existing image-box frame. The library mark/filter, selected asset badge and resize-only guides expose the feature. Source/licensing data for new assets still follows the ordinary sticker authoring workflow.

Export progress uses `ExportProgressPresenter` for the floating card, with cached DOM references and cancellation state on the editor. `EXPORT_PROGRESS_PHASES` and `reportExportProgress` in `SceneCompositor.js` own labels, counts and format ranges for all encoders; `callbacks.progressFormat` selects GIF, MP4 or still ranges. Phase labels also feed the result timing summary.

# Layer Type Contract

How to add a layer type, and the interface every layer manager shares. Referenced from `AGENTS.md`. See `docs/ARCHITECTURE.md` for how layers fit into the render and export paths.

## The target

Adding a new layer type should need four things:

1. A manager class that implements the manager interface below.
2. One `LayerType` constant in `js/core/layer-types.js`, and one definition file `js/layers/types/<type>.js` that calls `registerLayerType(LayerType.X, { … })`. Its `paintSlots` list declares every fill, border, shadow, bevel or background the type paints with.
3. A `buildExportPlan(layer, context)` method on the manager (canvas export for every format).
4. One `PANEL_SCHEMAS` entry composed from the `tpl-*` primitives through `js/ui/panel-renderer.js`, with its title mirrored in `modals/guide.html`.

If a new type needs a branch anywhere else, treat that as an architecture bug: fix the dispatch site so it reads `LAYER_UI_CONFIG`, instead of adding one more `if (layer.type === …)`.

## Manager interface

Each layer manager exposes these members, so shared code can route through `managerKey` instead of hardcoding types:

- `createLayer(options)`: returns the new layer, or `null` when creation is rejected (for example by `LayerManager.canAddLayers()`).
- `renderContent(layers)`: reconciles its preview DOM for the visible layers. Never clear-and-rebuild (see the no-flicker rules in `AGENTS.md`).
- `removeLayerElement(id)`
- `releaseLayerResources(layer)`: safe during deletion. Removes DOM, transforms and any cached resources the layer owns.
- `loadLayerSettings(layer)`: syncs the sidebar controls from the layer.
- `normalizeLayer(layer)`: fills in defaults so a created, restored, history-loaded or project-loaded layer has the canonical runtime shape. Call it only where a layer enters the document (`createLayer` and the `serialization.normalize` hook), never from getters or render paths. Renames and moved fields belong in `ProjectSerializer.migrateLayerState` instead.
- `buildExportPlan(layer, context)`: returns the compositor plan for this layer. Text and shape delegate to the shared slot-stack plan builder.
- `layerElements`: a `Map` of live preview DOM. It is the source of truth for visibility toggles and selection highlighting.
- `layerTransforms`: a `Map` of `LayerTransform` instances, for transformable types only.
- For types drawn as a slot stack (text, shape): `getSlotStack(layer)` and `getSlotMask(…, slot)` for the preview, and `renderSlotMasks(layer)` for export, which returns `{ [slotKey]: maskCanvas, renderWidth, renderHeight }` with shadow offsets baked in. A type whose paint list is not one item per slot (a frame's shade bands) passes `buildStack(resolveSource)` to `_buildSlotStackExportPlan`; its items name the `renderSlotMasks` key they paint through.

Cross-manager logic belongs in the responsibility folders (`js/core`, `js/effects`, `js/transforms`, `js/ui`), with thin delegating methods on the manager. Never use inheritance between layer managers.

## `registerLayerType` fields

Required for an addable type:

- `displayName`: human-readable type label.
- `serialization`: how the layer is saved to history, clipboard and project files. Either `{ dataKey, extraKeys, omit, defaults, defaultName, normalize, hydrate, includeMaskVersion, forceLocked }`, or `{ custom: { serialize, deserialize } }` naming manager methods. See `LayerManager.serializeLayer`.
- `managerKey`: the editor property holding the manager instance.
- `elementClass`: the preview DOM class used by shared selectors.
- `designPanelSections`, `mobileSettingsSections` and `panelMode`: which sidebar sections show and which mobile drawers they map to. This entry is what makes mobile drawers work. Library hosts never go in `designPanelSections`.
- `library`: the Library kind (`ASSET_BROWSERS` prefix: `glitter`, `sticker`, `shape`, …) shown while the layer is selected. An armed picker overrides it; `syncLibraryView` (`js/ui/gallery.js`) is the one place that shows a kind.
- `onActivate(editor, layer)`: runs when the layer becomes active.
- `hasVisibleContent(layer)`: whether the layer has anything to draw (read by `layerHasVisibleContent`).
- `paintSlots`: the type's paint slots, back to front. Each is `{ key, role, path }` plus optional `enabledPath`, `draftPath`, `glitterDefault`, `wholeLayer`, `sourceLabel`, `countsAsEffect`, `framePadding`, `panelPrefix`, `modes` and `fields`. Every slot of a role carries that role's editable fields (`PAINT_SLOT_ROLE_FIELDS`); `fields: { path: 'specKey' }` adds or re-specs one, such as a type-specific border width. The meanings are documented at the top of `js/paint/paint-slots.js`.
- `fields`: bindings of the type's other editable properties onto layer data, `{ path, field, id, factor, geometry, documentScale, minimum }` (see `js/core/fields.js`). A slot or type field's spec, in `FIELDS`, gives its range, unit and default.

Common optional fields:

- `addedStatusMessage`: status text after creation.
- `addableViaModal`: `{ label, icon, description }` for the Add Layer modal card. Omit it if users shouldn't add the type there.
- `goTo`: `'glitter'`, `'sticker'` or `null`, for the layers-list "go to source" action.
- `transformable`, `transformPrefix`, `transformCapabilities`: participation in transform handles and the transform panel's control-id prefix. `transformable` may be a per-layer predicate (a pinned frame has no handles, is not hit-tested and lets pointer events through); `transformCapabilities.edgeResize` declares edge handles. `transformPrefix` is all the transform panel needs: its host is `${prefix}TransformPanelHost` (a `transformHost` schema item), its listeners and handles route through `getMovableLayerContext`, and a manager with `commitScale(layer)` and `syncElementScale(layer, element)` gets them called after a resize gesture and during drags.
- `frame(editor, layer)` and `visualBounds(editor, layer)`: required for transformable types. Each returns a layer-local box `{ width, height, offsetX, offsetY }` in unscaled layer units, offset from the element center (`frameFromCanvasRect` converts a rect in a padded mask canvas). `frame` is the object's body (content, border and background plate, no shadow); handles, hit-testing, alignment, snapping and group bounds use it. `visualBounds` covers every painted pixel, shadow included, for export culling and crop-to-artwork; it defaults to `frame`. Return `null` from `frame` when the layer has nothing to click. Read them through `getLayerFrame` / `getLayerVisualBounds` (`js/transforms/transform-math.js`).
- `hitTest(editor, layer, x, y, tolerance)`: optional canvas picking in document px, used instead of the frame box (and for layers that are not transformable). Frames and fill layers are picked on their painted pixels so a click inside them reaches the layers under them.
- `elementBox(editor, layer)`: `{ width, height }` of the preview element, for a type whose element is not its artwork's own box. A fill layer's element is its canvas-sized mask surface and its `frame` is the painted pixels inside it; `LayerTransform.getDimensions` reads this first, so drags, gestures and group transforms size the element the same way `renderLayer` does.
- `pickedOnCanvas`: the element never takes pointer events (it is far larger than its artwork). The layer is picked through `hitTest`, and a mouse press on its painted pixels selects it and starts its move drag (`startCanvasPickedLayerDrag`, `js/editor/canvas-gestures.js`); touch already routes by `hitTest`.
- `defaultTransform(editor, layer)`: the transform a layer saved without one loads with (`LayerManager.deserializeLayer`). A type that declares it has a home placement: Reset Transform returns the layer's position to it as well.
- `supportsCornerRadius(layer)`: optional capability for a transformable type whose selected geometry exposes the shared on-canvas uniform-radius handles. Return true only while the layer's current geometry supports the existing radius field; the chrome must not branch on layer type.
- `renderSwatch(layer, context)`: optional layers-list thumbnail painter. Types without one use their fill paint slot.
- `animationBox(editor, layer, canvas)`, `timelineSources(layer, context)` and `animate(layer, time, element, context)`: optional export/preview animation hooks. Motion sampling receives `{ canvasW, canvasH, boxW, boxH, layerId, seed }` in both paths. A type with a `sparkles` slot adds `context.compositor._createSparkleTimelineSources(layer)` to its `timelineSources`.
- `sparkleHost(editor, layer)`: required with a `sparkles` paint slot. Returns `{ key, width, height, loadPixels() }`: the host box in the local px its preview and export draw particles in, a content key that changes when its pixels do, and a loader for those pixels (a canvas, image or RGBA pixels; `null` for none). Its manager calls `reconcileSparkleLayers` after reconciling its own preview content, and its export plan draws `_drawLayerSparkles` into the same surface.
- A manager `slotPicker` (a `SlotGlitterPicker`, `js/ui/picker-session.js`): for a type whose paints are all declared slots, routes gallery glitter picks into the armed slot and drives the picker strip. Register it with `editor.pickers`. Frame and Sparkles use it.
- `blendable`: whether the layer has a blend mode.
- `animatable`: whether the layer can carry `animation`.
- `contentScalesWithTransform`: the type's slots scale with its transform (stickers), so document scaling compensates them instead of rescaling them.
- `createOptionsKey`: the option payload key passed through `LayerManager.addLayer(...)`.
- `lockScope: 'position'`: the layer's lock pins only its transform; editing, deleting, duplicating and reordering stay available (`isLayerFullyLocked`, `js/core/layer-types.js`). Without it a lock blocks all of those. `lockedOnCreate`: a new layer of this type starts locked.
- `showDesignGallery`, `autoOpenDesignDrawerOnCreate`, `mobileCreateBehavior`, `mobileCreateDrawer`: gallery and mobile-drawer behavior on create.

## Checklist

1. Create the manager and construct it in the `GlitterEditor` constructor in `js/app.js`. Add its `<script>` tag to `index.html` after its dependencies, then run `node tools/bump-cache.js`.
2. Add the `LayerType` constant and the `js/layers/types/<type>.js` definition, with its script tag after `js/paint/paint-slots.js` in `index.html`.
3. Add the preview implementation (manager `renderContent`) and its export twin (`manager.buildExportPlan`). The two must match; see "Preview is DOM, export is canvas" in `AGENTS.md`.
4. Add the panel schema and mirror its title in `modals/guide.html`.
5. Run `node tests/run.js --tag quick` and `--tag export`, plus the export fragility routine from `AGENTS.md`.

That should be enough for create, delete, visibility, selection, go-to-source, mobile settings routing, undo, clipboard, project save and load, and the Add Layer modal.

# Layer Type Contract

How to add a layer type, and the interface every layer manager shares. Referenced from `AGENTS.md`. See `docs/ARCHITECTURE.md` for how layers fit into the render and export paths.

## The target

Adding a new layer type should need four things:

1. A manager class that implements the manager interface below.
2. One `LayerType` constant and one `LAYER_UI_CONFIG` entry in `js/core/config.js`.
3. One export-plan entry in `GifExporter._buildLayerExportPlan` (canvas export; also used by MP4 and still export).
4. One `PANEL_SCHEMAS` entry composed from the `tpl-*` primitives through `js/ui/panel-renderer.js`, with its title mirrored in `modals/guide.html`.

If a new type needs a branch anywhere else, treat that as an architecture bug: fix the dispatch site so it reads `LAYER_UI_CONFIG`, instead of adding one more `if (layer.type === …)`.

## Where that target is not yet met

As of 2026-09-22, these sites still branch on layer type by hand. A new type must be checked against each one until the planned layer-type registry (architecture audit sections A2, D6 and H1, in `docs/plans/`, local-only) removes them:

- `layerHasVisibleContent`, `layerHasActiveColorAdjust`, `layerHasBorderEffect` and `layerHasShadowEffect` in `js/core/config.js`
- `LayerManager.renderLayerSwatch` (layers-list thumbnail) and the `isPointIn*` hit tests
- `scaleDocumentLayerState` in `js/core/document-scaler.js` (canvas resize with content scaling)
- `GlitterManager.ensureLayersPreviewAssetsReady` (glitter preload before an undo swap)
- `GlitterEditor.updatePreview` and `clearPreview` in `js/app.js` (hardcoded manager list)
- the animatable-type lists in `LayerManager.serializeLayer` and `deserializeLayer`
- `GlitterEditor._layerIntersectsExportCanvas` (export culling)

## Manager interface

Each layer manager exposes these members, so shared code can route through `managerKey` instead of hardcoding types:

- `createLayer(options)`: returns the new layer, or `null` when creation is rejected (for example by `LayerManager.canAddLayers()`).
- `renderContent(layers)`: reconciles its preview DOM for the visible layers. Never clear-and-rebuild (see the no-flicker rules in `AGENTS.md`).
- `removeLayerElement(id)`
- `releaseLayerResources(layer)`: safe during deletion. Removes DOM, transforms and any cached resources the layer owns.
- `loadLayerSettings(layer)`: syncs the sidebar controls from the layer.
- `normalizeLayer(layer)`: fills in defaults so a created, restored, history-loaded or project-loaded layer has the canonical runtime shape. Call it only where a layer enters the document (`createLayer` and the `serialization.normalize` hook), never from getters or render paths. Renames and moved fields belong in `ProjectSerializer.migrateLayerState` instead.
- `layerElements`: a `Map` of live preview DOM. It is the source of truth for visibility toggles and selection highlighting.
- `layerTransforms`: a `Map` of `LayerTransform` instances, for transformable types only.

Cross-manager logic belongs in the responsibility folders (`js/core`, `js/effects`, `js/transforms`, `js/ui`), with thin delegating methods on the manager. Never use inheritance between layer managers.

## `LAYER_UI_CONFIG` fields

Required for an addable type:

- `displayName`: human-readable type label.
- `serialization`: how the layer is saved to history, clipboard and project files. Either `{ dataKey, extraKeys, omit, defaults, defaultName, normalize, hydrate, includeMaskVersion, forceLocked }`, or `{ custom: { serialize, deserialize } }` naming manager methods. See `LayerManager.serializeLayer`.
- `managerKey`: the editor property holding the manager instance.
- `elementClass`: the preview DOM class used by shared selectors.
- `designPanelSections`, `mobileSettingsSections` and `panelMode`: which sidebar sections show and which mobile drawers they map to. This entry is what makes mobile drawers work.
- `onActivate(editor, layer)`: runs when the layer becomes active.

Common optional fields:

- `addedStatusMessage`: status text after creation.
- `addableViaModal`: `{ label, icon, description }` for the Add Layer modal card. Omit it if users shouldn't add the type there.
- `goTo`: `'glitter'`, `'sticker'` or `null`, for the layers-list "go to source" action.
- `transformable`, `transformPrefix`, `transformCapabilities`: participation in transform handles and the transform panel's control-id prefix.
- `hitTestMethod`: the `LayerManager` hit-test method name used for selection.
- `blendable`: whether the layer has a blend mode.
- `createOptionsKey`: the option payload key passed through `LayerManager.addLayer(...)`.
- `showDesignGallery`, `autoOpenDesignDrawerOnCreate`, `mobileCreateBehavior`, `mobileCreateDrawer`: gallery and mobile-drawer behavior on create.

## Checklist

1. Create the manager and construct it in the `GlitterEditor` constructor in `js/app.js`. Add its `<script>` tag to `index.html` after its dependencies, then run `node tools/bump-cache.js`.
2. Add the `LayerType` constant and the `LAYER_UI_CONFIG` entry.
3. Add the preview implementation (manager `renderContent`) and its export twin (the export-plan entry). The two must match; see "Preview is DOM, export is canvas" in `AGENTS.md`.
4. Add the panel schema and mirror its title in `modals/guide.html`.
5. Check the "not yet met" list above.
6. Run `node tests/run.js --tag quick` and `--tag export`, plus the export fragility routine from `AGENTS.md`.

That should be enough for create, delete, visibility, selection, go-to-source, mobile settings routing, undo, clipboard, project save and load, and the Add Layer modal.

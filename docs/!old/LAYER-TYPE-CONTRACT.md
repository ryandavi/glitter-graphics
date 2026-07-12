# Layer Type Contract

Adding a new layer type should require four things, and only four things:

1. A manager class that exposes the same practical interface the current layer managers share.
2. One `LAYER_UI_CONFIG` entry in `js/config.js`.
3. One export delegate/plan entry in `GifExporter` for canvas export.
4. Matching `PANEL_SCHEMAS` + `tpl-*` renderer structure/docs for any new panel or tool surface.

If a new layer type requires touching unrelated type-switch chains outside those places, treat that as an architecture bug and fix the dispatch site instead of baking in one more branch.

## Manager Interface

Each layer manager should expose these members so shared UI code can route through `managerKey` instead of hardcoding layer types:

- `createLayer(options)`
- `renderContent(layers)`
- `removeLayerElement(id)`
- `releaseLayerResources(layer)`
- `loadLayerSettings(layer)`
- `normalizeLayer(layer)`
- `layerElements` `Map`
- `layerTransforms` `Map` for transformable layer types

Behavior notes:

- `createLayer(options)` returns the new layer object or `null` when creation is rejected (for example max-count guards).
- `releaseLayerResources(layer)` should be safe to call during deletion and should remove DOM, transforms, and any cached resources owned by that layer.
- `layerElements` is the source of truth for live preview DOM used by visibility toggles and selection highlighting.
- `normalizeLayer(layer)` should make restored/history-loaded data safe for the current runtime shape.

## `LAYER_UI_CONFIG` Fields

Each addable layer type should define the fields below in `js/config.js`:

- `displayName`: human-readable type label.
- `addedStatusMessage`: status text shown after creation.
- `goTo`: `'glitter'`, `'sticker'`, or `null` for the layer-list "go to source" affordances.
- `addableViaModal`: `{ label, icon, description }` for the Add Layer modal card, or omitted when the type should not be user-addable there.
- `managerKey`: editor property name for the layer manager instance.
- `elementClass`: preview DOM class used by shared selectors.
- `transformable`: whether the layer participates in transform handles.
- `transformPrefix`: control-id prefix for transform inputs when applicable.
- `hitTestMethod`: `LayerManager` hit-test method name for selection.
- `createOptionsKey`: option payload key passed through `LayerManager.addLayer(...)` when the manager accepts structured creation data.
- `designPanelSections`
- `mobileSettingsSections`
- `panelMode`
- `onActivate(editor, layer)`

Optional behavior flags already supported by the shared layer flow:

- `autoOpenDesignDrawerOnCreate`
- `mobileCreateBehavior`

## Add Layer Checklist

When we add a layer type, the expected implementation path is:

1. Create the manager and wire it onto `Editor`.
2. Add the `LayerType` constant and one `LAYER_UI_CONFIG` entry.
3. Add the preview/export implementation pair.
4. Add the panel through `PANEL_SCHEMAS`, the `tpl-*` primitives, and `js/panel-renderer.js`; mirror it in `modals/guide.html`. This supersedes the old copy-static-panel-markup workflow.

That should be enough for create, delete, visibility, selection, layer-list goto, mobile settings routing, and the Add Layer modal to work without any extra per-type branching.

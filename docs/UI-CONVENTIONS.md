# UI conventions

Visual and interaction conventions for the editor UI: sidebar panels, layout names, icons and buttons. Referenced from `AGENTS.md`. Read this before adding or changing any panel, toolbar, modal, button or icon.

## Sidebar panels

- **Naming.** "\<Thing\> Properties" means attributes of the selected layer (Glitter Properties, Sticker Properties, Text Properties). "\<Tool\> Settings" means tool configuration (Mask Settings, Glitter Fill Settings). Section *ids* are historically `*SettingsSection` regardless of title. Don't rename ids.
- **Built from schemas.** Every sidebar section is a `PANEL_SCHEMAS` entry in `js/ui/panel-schemas.js`, composed from the `tpl-*` primitives through `js/ui/panel-renderer.js`. Never copy live sidebar markup into `index.html`.
- **The guide mirrors the UI by generation.** Write guide copy in `content/src/guide.src.html` and build it with `node tools/build-modals.js guide`. Tool headings (`{ui-tool:select}`), tool icons (`{ui-tool-icon:select}`), panel titles (`{ui-panel:textSettingsSection}`) and the full shortcut list (`{ui-shortcuts}`) come from `TOOLS`, `PANEL_SCHEMAS` and `COMMANDS`; use the tokens instead of typing those names. `tests/unit/shortcut-coverage.js` fails when the built guide is stale.
- **The Library holds assets; Properties hold values.** Anything with a file and attribution (glitter, stickers, shapes, brush tips, fonts, later frames and templates) is a Library kind: one `ASSET_BROWSERS` entry plus a `ContentManager` subclass, so it gets search, filters, Recent and Favorites for free. A Properties panel shows the current asset as an `assetInfo` row whose Change opens the Library in picker mode. Presets (gradients, styles, looks, warps) are values and stay as preset grids next to what they change. Never both.
- **Reuse the existing patterns:** gallery cards (font, sticker and brush-shape Library cards), segmented controls, carded effect subsections, paint-slot cards, and the shared `renderGlitterAssetDisplay` asset chips.
- **In-panel pickers** (filter Looks, gradient presets) share one frame: `.property-scrollbox`, a fixed-height scroll box (`--property-scrollbox-height`) with a bottom fade on overflow, and `GlitterPresetLibrary.bindPickerNavigation` for arrow keys. A category filter is a `Category` row in its own `.property-set` above the picker's labelled set. Option layout stays per picker.
- **Preset grids.** Use the `presetGrid` schema primitive with a library from `createPresetLibrary`; managers supply only the active id and apply callback. Keep controls needed to understand or choose the selected preset visible; reserve a disclosure for genuinely optional detail.
- **Gradient presets.** Every shared gradient editor renders the `GRADIENT_PRESETS` library. Add a reusable gradient or stripe flag as one entry in `js/paint/gradient-presets.js`; applying one copies its stops and blend mode while preserving a customized angle.
- **Style presets.** Text, shape and sticker panels lead their Appearance group with a Style card (`createStylePresetCardSpec`), filled from `STYLE_PRESETS` by the shared field binder. Add a look as one entry in `js/paint/style-presets.js` with the layer types it targets. The Style and Warp cards are `collapsible: true, collapsed: true` (a collapsible card that starts closed) with a `titleSummary` naming what is applied, so a closed card still reads. A preset grid whose values were tuned off a tile keeps that tile highlighted as edited (`renderPresetGrid({ modified })`, dashed outline); live edits move the highlight with `setPresetGridActive` instead of rebuilding the grid.
- **Advanced rows.** Set `advanced: true` on a schema row, or on its `FIELDS` entry when every use is advanced. The renderer collects advanced rows within their card under one **More** disclosure. The Show All Controls preference reveals every More/Advanced disclosure globally; managers do not branch on that preference.
- **Add menu.** Layer cards come from each type's `addableViaModal` entry and declare a `group` (`basics`, `decorate`, or `effects`). Non-layer generators live in `ADD_MENU_COMMANDS`; overlay templates are appended to Generate from `data/templates.json`. Quick Add remains a filtered view of the same layer metadata.
- **Color sampling.** Every `input[type="color"]` is decorated by `initializeColorEyedroppers`. Chromium uses the screen EyeDropper API; the fallback arms one canvas tap and samples a still from `SceneCompositor`. Do not add one-off eyedropper buttons in managers.

## Toolbar groups

Every `TOOLS` entry declares `toolbarGroup: 'create' | 'arrange' | 'view'`. `renderToolButtons` inserts separators when that value changes, so group order stays in `TOOL_ORDER` and is never hand-authored in `index.html`.

## Layout chrome names purpose, not position

- `.preview-panel` is the canvas workspace column (formerly `.right-panel`).
- `.design-panel` is the right-side control panel.
- `.layers-panel` is the layers column.

Don't reintroduce positional names.

## Canvas overlay UI

Anything drawn over the canvas needs `.ui-ignore-gestures`. Touch input routes through `GestureManager` (pointer events), and capture-phase handlers must exclude `.transform-handle-wrapper` and `.transform-handles`.

## Icons

All icons are `<use href="#icon-NAME">` against the one SVG sprite in `index.html`. The `modals/*.html` files share it and carry no sprite of their own. Build icons with `createIcon('name')` or `tpl-icon`, or with a schema `icon: 'name'` key (context toolbars, panel section headers, `actionRow` actions, layer type modal config).

- **One line-art family, no exceptions.** Every symbol is `viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`. A few dense glyphs drop to 1.35, and segmented-control glyphs use 1.4. `fill` and `stroke` live on the `<symbol>` so the shared `svg.icon{fill:currentColor}` never fills them. A genuinely filled bit, such as a dot, carries its own `fill="currentColor" stroke="none"`. Draw new icons in this style. Never paste a filled or FontAwesome path.
- **One action, one icon, everywhere.** The toolbar, context bar, sidebar button, modal submit, app menu, empty state and tool hint for the *same* action all use the same key. Before adding a symbol, check the sprite for an existing glyph for that action. A new symbol is justified only when reusing one would overload it.
- **When an icon is required:** tool buttons, icon-only buttons (also give them `title` plus `aria-label` or a hidden `.name`), menu items, section headers, empty states, and spatial segmented-control options.
- **Icon plus visible label** (`btn-text-with-icon icon-wrapper`): card, modal and workspace action buttons, and sidebar `actionRow` actions with an `icon:`. If one button in a row has an icon, all of them do.
- **No icon:** plain text links, body text, confirm and cancel buttons, and word-only segmented options (Low/Med/High).
- **Inputs:** a leading glyph inside the field (`.search-input-icon`) or the right-edge `.property-revert` reset. Never a decorative trailing icon. Reset-to-default is `#icon-reset` (circular arrow), distinct from history's `#icon-undo`.
- **Feature maturity** is a `.feature-badge.feature-badge-beta` pill (schema `section.badge: 'beta'|'alpha'`, or inline), not an icon.

### Icon registry (action → key)

The action → key registry lives in `content/icon-registry.json`; add a row there when an action gets a standard icon. Tool icons live on their `TOOLS` entries (`js/core/tools.js`), which also drive the toolbar, the canvas hint chip and the guide. `tests/unit/icon-references.js` checks every registry key and every icon referenced in markup, schemas, `createIcon` calls and registries against the sprite.

## Buttons

- **`.btn-text-with-icon`** is the one text-button class: a label, an optional leading glyph (`+ icon-wrapper`), and `.primary` (full-strength gloss) or `.secondary`/default (dimmed gloss, via `gloss-button(true)`). All buttons are glossy; there is no flat variant. The box height is `--button-height` (36), owned by `_controls.scss`. Sidebar action rows render it through the panel-renderer `actionRow`. `.btn-icon` is the square icon-only variant.
- **`.btn-simple` is legacy.** It is currently styled identically to `.btn-text-with-icon` and is still used at about 25 modal, gallery and settings call sites; a mass rename isn't worth it. Don't add new `.btn-simple`, and don't repurpose the name for a flat button. If a genuinely flat or quiet button is ever needed, add an explicit `.btn-flat` (or `.is-flat` modifier).

## SCSS

- Nested SCSS with mixins and CSS-variable tokens (`:root` ramps, then semantic variables).
- Tokenize a value when it repeats three or more times, or when it is an app-layer z-index. Stacking inside a component stays literal.
- `css/style.scss` is an import-only entrypoint with no loose selectors. Styles go in the responsibility-based partials under `css/` and `css/panels/`.

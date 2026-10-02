# UI conventions

Visual and interaction conventions for the editor UI: the design system, sidebar panels, modals, lists, icons and buttons. Referenced from `AGENTS.md`. Read this before adding or changing any panel, toolbar, modal, button or icon.

The definition of done for UI work: **adding a setting is one schema line and no new CSS.** "Add Blur to the sticker Shadow" is one item in `PANEL_SCHEMAS`; "add Loop count to Export Settings" is one entry in `EXPORT_SETTINGS_LAYOUT`. If either needs a new rule, the system has a gap; fix the system.

## The system

### Two layers of look

| Layer | What | Look |
|---|---|---|
| **Chrome** | App header, window bars, the tool rail, the context bar, a modal's frame, header and footer | Themed, glossy, loud. The ten themes paint it. `.btn-icon`, `.btn-text-with-icon`. |
| **Content** | Everything inside a panel body, a list or a modal body | Flat and quiet, identical in every theme except for color tokens. `.btn-flat`, flat fields. |

Gloss never appears inside a body. A body button is `.btn-flat`, with `.primary` (accent fill) for the one main action of a form.

### Scales

One scale each, declared in `css/_tokens.scss`. Use the token; a literal is a bug unless it is listed as an exception below.

| Scale | Steps |
|---|---|
| Spacing | `--spacing-2xs` 2, `-xs` 4, `-sm` 6, `-base` 8, `-md` 12, `-lg` 16, `-xl` 24, `-2xl` 32 |
| Type size | `--font-size-xs` 11 (meta, notes), `-sm` 12 (labels, values, body controls), `-title` 13 (section titles, list names), `-base` 14 (window bars, modal titles). `-md` and up are for reading-modal prose and for glyphs sized by `font-size`. |
| Type weight | `--font-weight-normal` 400 and `--font-weight-semibold` 600. Nothing else in the UI. |
| Control height | `--control-height`: every field, select, segmented control, value readout and body button |
| Row height | `--row-height`: a property row, a section title, a chrome button, a tool button |
| List row | `--list-row-height`: a row that leads with a thumbnail |
| Chip | `--chip-height`: tags and pills, derived from the control height |
| Radius | `--radius-lg` 8 (panel), `-md` 6, `-sm` 4 (control), `-xs` 3 (inner). Nested rounded elements step down one. |
| Modal width | `--modal-width-dialog` 480, `--modal-width-form` 720, `--modal-width-reading` 880 |

**Density is one media query.** `@media (pointer: coarse)` at the end of `_tokens.scss` raises the three heights (28/32/40 become 40/44/52). Never restate a height for touch anywhere else, and never size a control from the viewport width.

Literal colors are allowed only where the color must not follow the theme: selection chrome and handles drawn over artwork, swatch and filter illustrations, and the tooltip's era skin.

### One of each

| Primitive | The one | Notes |
|---|---|---|
| Section | `.property-card` | Flat: no border, no background, one hairline under it. See Sidebar panels. |
| Row | `.property-row` | `label \| control \| value \| revert`; `.is-stacked`, `.is-pair`, `.is-toggle` |
| Field | select, number, text, `.property-value` | Flat, 1px border, `--control-height` |
| Segmented control | `.segmented-control` | Sentence case. Defined once in `css/panels/property/_fields.scss`, used everywhere. An option that wraps its own input styles `input:checked + span`. |
| Switch | `.property-switch` / `.property-header-switch` | 30 × 16 track |
| Body button | `.btn-flat`, `.btn-flat.primary`, `.btn-flat.is-icon` | |
| Chrome button | `.btn-text-with-icon`, `.btn-icon` | Gloss; `.primary` or `.secondary` |
| Plain text button | `.btn-text` | A reset or destructive action at the left of a modal footer |
| List row | `.list-row` | Handle, media, name over one meta line, trailing actions. Layers and Auto Glitter matches. |
| Tile | `.action-card` (does something), `.choice-card` (picks a value) | |
| Empty state | `.property-empty` | |
| Disclosure | `.advanced-disclosure` and the section chevron | Chevron points right when closed, down when open. Everywhere. |
| Dialog footer | `.modal-footer` | Actions right-aligned, primary last |

Before adding a class, check this table. A feature hook beside a primitive (`layer-item list-row`) is fine; a second class that restyles the same thing is not.

### Rules worth keeping

- **Spacing is the parent's `gap`**, or an explicit `a + b { margin-top }`. Never a bare margin on a child: it survives when the neighbor is hidden and leaves phantom space.
- **Horizontal inset is owned by rows and titles only** (`--property-gutter`). Bodies, sets and sections never add horizontal padding, so the left edge is one line down the panel. `tools/gutter-check.js` enforces it.
- **A box means an object.** The only boxes in a panel are things you can swap or pick from: the asset chip, a preset scrollbox, the gradient editor. The only line is the hairline under a section.
- **Uppercase is the group label's alone.**
- **A revert sits at the right edge of what it reverts**, in a column that is always reserved, and is drawn only while the value differs from its default.
- **Sliders only for bounded values** (opacity, width, rotation). Position, size and other unbounded values are number fields.
- **Units show only when the value could be misread.** `px` is never shown on position or size; `°` and `%` always are.
- **A module summary is one identifier**, never a value dump: the glitter's name, the font, "Off".
- **Never encode meaning in a border color.** No accent or warning rail on a message, card or row. An icon, a label and the copy carry meaning.

## Sidebar panels

- **Naming.** "\<Thing\> Properties" means attributes of the selected layer (Glitter Properties, Sticker Properties, Text Properties). "\<Tool\> Settings" means tool configuration (Mask Settings, Glitter Fill Settings). Section *ids* are historically `*SettingsSection` regardless of title. Don't rename ids: they are in tests, schemas and managers. Class names may be renamed, in a dedicated pass that recaptures the panel-parity baseline.
- **Built from schemas.** Every sidebar section is a `PANEL_SCHEMAS` entry in `js/ui/panel-schemas.js`, composed from the `tpl-*` primitives through `js/ui/panel-renderer.js`. Never copy live sidebar markup into `index.html`. The Transform section is `tpl-transform-panel`, written in its final shape.
- **Structure.** `.settings-subsection` (the column) > `.property-group` (L1) > `.property-card` (a section: `.property-card-title`, `.property-card-body`) > `.property-set` (a run of rows a manager shows or hides together) > `.property-row`.
- **Actions.** Card action rows are `.property-set.property-actions` inside `.property-card-body`. Group-level actions stay at the group end.
- **Bodies.** Ordinary cards and paint-slot modules share `.property-card-body`, including their Advanced disclosures. The card's collapse state controls the whole body; switched-off modules remain inert when opened.
- **The section.** A title row at `--row-height`, then its rows on one gap (`--property-row-gap`), then `--property-section-pad-bottom` and one hairline. Everything inside a section stacks on that single gap: row to row, title to first row, set to set, rows to a disclosure or an action row. A set draws nothing and adds no space. Tune the feel of a panel with those two tokens, in `css/panels/property/_tokens.scss`.
- **Every titled section collapses.** The title row is the toggle, and it has a hover tint because there is no box to say so. Open state is remembered per `prefix:title` (`glitter.panelCards`); a section with an enable switch follows its switch instead. `collapsed: true` in the schema starts it closed (Style, Warp). A section nested in another (Bevel's Shade) is a labelled set and does not collapse, and a form modal's groups stay open so its search can always show a row. Settings > Reset Panels restores the defaults.
- **A closed section should still say what is inside**: an asset name (`moduleSummary: 'asset'`), a `titleSummary`, or "Off".
- **Group labels.** A group's uppercase label shows only where it names two or more sections (`.has-group-label`, stamped by `buildPanelGroup`); over one section it would repeat that section's title. So a section that stands alone in its group must have a title of its own.
- **Group order.** Layer panels use the same groups in the same order, leaving out any that do not apply: Content (what it is) → Appearance (Style presets, Layer, Fill) → Transform → Effects (Background, Outline, Shadow, Bevel, Sparkles, then Reset Effects) → Motion (Animation) → Actions. Effects and Motion come from the schema's `effects:` and `motion:` keys, never from a hand-built group. The renderer adds Reset Effects only when a panel has two or more effects (`effectsReset`). Presets lead the group they style. The paint slot a layer is made of is called Fill everywhere.
- **No loose rows.** A row always lives in a section. Whole-layer opacity and blend are the Layer section (`createLayerCardSpec`).
- **Optional card controls.** A module is the same `.property-card` with a summary, a swatch or an enable switch; its styles live with the shared card in `_sections.scss`. The switch sits at the right of the title row, where a row's value would be. Off, a module is its one title row.
- **Shared card construction.** Ordinary and paint-slot cards use `buildPropertyCard` and the same `tpl-card`. Header readouts are `.property-card-summary` and `.property-card-swatch`; paint-source layout belongs in `_paint-slot.scss`.
- **The guide mirrors the UI by generation.** Write guide copy in `content/src/guide.src.html` and build it with `node tools/build-modals.js guide`. Tool headings (`{ui-tool:select}`), tool icons (`{ui-tool-icon:select}`), panel titles (`{ui-panel:textSettingsSection}`) and the full shortcut list (`{ui-shortcuts}`) come from `TOOLS`, `PANEL_SCHEMAS` and `COMMANDS`; use the tokens instead of typing those names. `tests/unit/shortcut-coverage.js` fails when the built guide is stale.
- **The Library holds assets; Properties hold values.** Anything with a file and attribution (glitter, stickers, shapes, brush tips, fonts, later frames and templates) is a Library kind: one `ASSET_BROWSERS` entry plus a `ContentManager` subclass, so it gets search, filters, Recent and Favorites for free. A Properties panel shows the current asset as an `assetInfo` row whose Change opens the Library in picker mode. Presets (gradients, styles, looks, warps) are values and stay as preset grids next to what they change. Never both.
- **In-panel pickers** (filter Looks, gradient presets) share one frame: `.property-scrollbox`, a fixed-height scroll box (`--property-scrollbox-height`) with a bottom fade on overflow, and `GlitterPresetLibrary.bindPickerNavigation` for arrow keys. A category filter is a `Category` row in its own `.property-set` above the picker's set. Option layout stays per picker.
- **Preset grids.** Use the `presetGrid` schema primitive with a library from `createPresetLibrary`; managers supply only the active id and apply callback. Keep controls needed to understand or choose the selected preset visible; reserve a disclosure for genuinely optional detail.
- **Gradient presets.** Every shared gradient editor renders the `GRADIENT_PRESETS` library. Add a reusable gradient or stripe flag as one entry in `js/paint/gradient-presets.js`; applying one copies its stops and blend mode while preserving a customized angle.
- **Style presets.** Text, shape and sticker panels lead their Appearance group with a Style section (`createStylePresetCardSpec`), filled from `STYLE_PRESETS` by the shared field binder. Add a look as one entry in `js/paint/style-presets.js` with the layer types it targets. A preset grid whose values were tuned off a tile keeps that tile highlighted as edited (`renderPresetGrid({ modified })`, dashed outline); live edits move the highlight with `setPresetGridActive` instead of rebuilding the grid.
- **Advanced rows.** Set `advanced: true` on a schema row, or on its `FIELDS` entry when every use is advanced. The renderer collects advanced rows within their section under one **More** disclosure. The Show All Controls preference reveals every More/Advanced disclosure globally; managers do not branch on that preference.
- **A set's `label` is not drawn.** It names the run for assistive tech (`role="group"`, `aria-label`). The section title carries the hierarchy.
- **Add menu.** Layer cards come from each type's `addableViaModal` entry and declare a `group` (`basics`, `decorate`, or `effects`). Non-layer generators live in `ADD_MENU_COMMANDS`; overlay templates are appended to Generate from `data/templates.json`. Quick Add remains a filtered view of the same layer metadata.
- **Color sampling.** Every `input[type="color"]` is decorated by `initializeColorEyedroppers`. Chromium uses the screen EyeDropper API; the fallback arms one canvas tap and samples a still from `SceneCompositor`. Do not add one-off eyedropper buttons in managers.

### Scroll regions

Vertical section bodies, layer lists, asset galleries and filters, preset pickers, mobile drawers, modal bodies, document menus and timeline lists opt into `.scroll-region` through the host list in `js/ui/scroll-regions.js`. They share `css/_scroll-regions.scss` and `js/ui/scroll-regions.js`. Native overflow, sizing, keyboard input and touch momentum stay on the original element. Horizontal rails, native inputs and the canvas viewport retain their own treatment. Lazy-loaded content receives the same opt-in. Native bars are hidden only after the helper initializes; one floating, draggable thumb appears on hover or scrolling without reserving width. The thumb does not participate in panel layout, and Auto Glitter keeps its separate fixed header/footer bands. Gallery filters likewise keep the search row and shared two-column action row outside `.filters-container-inner`, which alone scrolls. Width and minimum thumb size are tokens; the idle delay is `CONFIG.ui.scrollbar.hideDelayMs`.

## Layers panel and lists

- A layer row is `.list-row` with layer hooks (`layer-item`, `layer-swatch`, `layer-name`). `LayerManager.renderLayersList` builds it by hand, because it is a sortable list and not a schema.
- No row has a border. Selection is a filled row (`.selected`), and the active layer a stronger fill (`.active`).
- Trailing actions (`.list-row-actions`) show while the row is hovered, focused or selected, and always where there is no hover. A state that is on, such as a locked lock, stays in view.
- The bottom bar puts add actions on the left and edit actions on the right (`.layers-bar-group`).

## Modals

- **Three widths.** A `.modal-content` is form width by default. `.modal-dialog` is the 480px dialog (confirm, alert, sticker upload). `.modal-reading` is the 880px reading frame; Export Ready uses the same width. `.modal-browse` fixes the height so a filter or tab never resizes the frame.
- **Footer.** Actions sit at the right, primary last. A reset or destructive action is a `.btn-text` at the left. The footer is chrome, so its buttons are `.btn-text-with-icon`.
- **Body buttons are `.btn-flat`**: a search's clear button, a table of contents toggle, Cancel on the export progress.
- **A heading over a group of tiles is a `.property-group-label`**, with no box around the group (Add menu, New Canvas presets).
- **The confirmation dialog** takes its content through `editor.confirmAction()` slots (`subject`, `facts`, `details`, `outro`). The subject is the one box.
- **Export Ready** is the preview, one meta line, notes as `.property-note`, and details in `.advanced-disclosure`.
- **Reading modals** (About, History, Guide and the article pages) share the shell: header, nav row and frame. Their prose, timelines and references are content and have their own rules in `content/AUTHORING.md`.

### Form modals

New Canvas, Settings, Export Settings and Commands & Shortcuts are property panels in a wider column. The modal body carries `.modal-form.property-panel` and holds a `.section` host, so groups, sections, rows, switches, segmented controls and notes are the sidebar's, styled by `css/panels/property/`. `.modal-form` in `css/modals/_forms.scss` sets only what the wider column changes.

- **A fixed form** is a `PANEL_SCHEMAS` entry with `section: { id, bare: true }` (New Canvas is `PANEL_SCHEMAS.newCanvas`). Width and height are one `numberPair`, a two-way choice is a `segmented` row (`showLabel: true` keeps the word beside an option's icon), and a color is a `field` of `type: 'color'`, hidden while it does not apply.
- **A settings list** is declared in `EXPORT_SETTINGS_LAYOUT` / `APP_SETTINGS_LAYOUT` and built by `js/ui/settings-renderer.js` from the same primitives: one titled section per group, one `.property-set` per setting, the description as a `.property-note`. `settings-group` (with the group's `data-section`) and `settings-row` are hooks for the search filter and the settings code and carry no layout.
- Never write row markup for these modals by hand. A widget that is not a plain row is a `<template>` using the property classes.
- **Rows a setting governs** (`governed` in a layout: GIF Look, Export fidelity) sit in the panel's Advanced disclosure, labelled Customize. The governing row is the last row of its section and ends on a `.governed-summary` note that states the governed values. The shared `[data-advanced]` handler toggles it and Show All Controls opens it; open it from code with `setAdvancedDisclosureOpen`.
- **Search hides with `.is-filtered-out`, never `hidden`.** `hidden` on a row means it does not apply to the current format, and the filter reads it to decide what is searchable.
- **Resets are the panel's.** A setting that declares a `default` gets the row's `.property-revert`, and reverting fires the control's own change event. A group with a `section` gets the same icon in its title (the section's `reset` option, `.property-card-reset`); it replays the lit reverts of the rows showing in the section and holds no defaults of its own. Neither asks for confirmation. Rows written by a preset (`rowReverts: false`, the GIF Look rail) have no revert: the preset row's restores them together. The footer button is the only reset that confirms, because it also clears state no row shows (Brush and Eraser defaults, panel layout, toolbar position). New Canvas is a one-shot form and has no resets.

## Phone drawer

- A drawer has no window bar. Under the grabber, one row names what the drawer holds as plain text (`.mobile-sheet-bar`), with that surface's real actions as flat icon buttons (Library search, sticker upload, add layer).
- The Edit drawer shows one section at a time, directly on the drawer surface. When it holds two (a fill layer beside its tool settings, a layer beside Mask Settings), the name becomes a two-way switch (`MobileManager.syncEditSections`).
- Group labels are not shown in the drawer, and sizes come from the coarse-pointer density tokens alone.
- A new layer type declares `mobileSettingsSections`; that is all the drawer needs.

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
- **Icon plus visible label:** card, modal and workspace action buttons, and sidebar `actionRow` actions with an `icon:`. If one button in a row has an icon, all of them do.
- **No icon:** plain text links, body text, confirm and cancel buttons, and word-only segmented options (Low/Med/High).
- **Inputs:** a leading glyph inside the field (`.search-input-icon`) or the right-edge `.property-revert` reset. Never a decorative trailing icon. Reset-to-default is `#icon-reset` (circular arrow), distinct from history's `#icon-undo`.
- **Feature maturity** is a `.feature-badge.feature-badge-beta` pill (schema `section.badge: 'beta'|'alpha'`, or inline), not an icon.

### Icon registry (action → key)

The action → key registry lives in `content/icon-registry.json`; add a row there when an action gets a standard icon. Tool icons live on their `TOOLS` entries (`js/core/tools.js`), which also drive the toolbar, the canvas hint chip and the guide. `tests/unit/icon-references.js` checks every registry key and every icon referenced in markup, schemas, `createIcon` calls and registries against the sprite.

## Buttons

- **`.btn-flat`** is the content-layer button: sidebar `actionRow` actions, an asset's Change, any button in a modal body. A field-shaped box at `--control-height`. `.primary` fills it with the accent for the one main action of a form; `.is-icon` is the square glyph-only form beside a field.
- **`.btn-text-with-icon`** is the chrome text button: a modal footer, the start card. Gloss, at `--row-height`; `.primary` is full strength and `.secondary` or default is dimmed. `.btn-icon` is the square chrome icon button (tools, bar actions, a modal's close).
- **`.btn-text`** is a plain text button, for the reset or destructive action at the left of a footer.
- **`.btn-icon-simple`** is a chromeless glyph on a panel surface: list row actions, the layers bottom bar, a stepper.
- **`.action-card`** is the one card-that-is-a-button: media (`.action-card-media`, an icon or preview), `.action-card-title`, `.action-card-detail`. `css/_components.scss` owns its surface, border, hover, focus, pressed and selected (`.active`) states and the text tiers; owners add only grid placement and media sizing. `.is-horizontal` puts the media beside the text (Add menu) and `.is-quiet` drops the surface and border until hover (start card tiles). A card that picks a value is a `.choice-card` instead.
- There is no other button class. Don't add one.

## SCSS

- Nested SCSS with mixins and CSS-variable tokens (`:root` ramps, then semantic variables).
- Tokenize a value when it repeats three or more times, or when it is an app-layer z-index. Stacking inside a component stays literal.
- `css/style.scss` is an import-only entrypoint with no loose selectors. Styles go in the responsibility-based partials:

  | Folder | Holds |
  |---|---|
  | `css/` | Foundation shared with the admin (`_tokens`, `_themes`, `_mixins`, `_base`), app-wide components and controls, `_mobile` |
  | `css/panels/` | One partial per panel surface or feature (layout, Library, layers list, preview bars, effects, paint slots) |
  | `css/panels/property/` | The property vocabulary, one partial per concern; `_tokens.scss` opens with the map. Loaded last of the panel sheets so it wins the cascade |
  | `css/modals/` | `_shell`, `_forms`, then one partial per modal; `_responsive` is last |

- **Each rule is declared once.** `.property-panel` (a whole surface) and `.property-section` (one schema-rendered section) share one token set. A panel-wide class takes no scope; a rule that restyles a global control (select, input) is scoped to `.property-panel` or `.property-section`. Never add a second, more specific copy of a rule to override the first: change the first. **When a change supersedes styling, remove what it supersedes in the same change.**
- **No `:has()`.** State the stylesheet reads is a class the code stamps where that state already changes:

  | Class | Means | Stamped by |
  |---|---|---|
  | `.is-off` | a module's enable switch is off | `syncPanelEffectToggle` |
  | `.is-vacant` | every child of a container is `hidden` | the vacancy observer in `panel-renderer.js` |
  | `.is-unset` | a swatch or asset thumbnail has no value to show | `syncModuleSummary`, `buildAssetInfo` |
  | `.has-group-label` | a group names two or more sections | `buildPanelGroup` |
  | `.is-filtered-out` | a row, group or disclosure has no match for the modal search | `createModalFilter` |
  | `.has-open-menu` | a bar holds an open popover menu | `setupMenuPopover` (`liftHost`) |
  | `.has-active-query`, `.has-filter-summary` | the folded Library search still has something applied | `syncLibrarySearchState` |
  | `.is-edge-hover` | an edge handle is hovered | `SelectionChrome` |

  A control that wraps its own input (flip checkboxes, a radio group, the context-bar toggle) puts its look on the element after the input and styles it with `input:checked + …`, so nothing has to mirror `checked` onto the label.
- A row built by `buildOptionGroup` stacks its control under the label only when the control is not a segmented control or a select. Don't fix a row's layout from CSS.

## Checking a styling change

Both tools drive the real app through the states in `tools/ui-states.js` (every layer panel, every tool, the Library, each modal, the phone drawer). Compile a candidate to a scratch file first: `npx sass css/style.scss <scratch>/b.css --no-source-map`.

- **A change meant to be invisible** (a refactor, a rename, a dead-rule sweep): `node tools/ui-ab.js <a.css> <b.css>` loads both stylesheets on the same DOM and reports every element whose computed style or box differs. It must report zero, or every difference must be listed with its reason in an `--allow` file.
- **A change meant to be visible:** `node tools/ui-contact-sheet.js capture <dir> --css <compiled.css>` before and after, then `build <before> <after> <out.html>` for a page of real screenshots side by side at three widths and two themes. Review the page and the live app; tune by changing token values.
- `node tools/gutter-check.js` checks the gutter rule, and `node tests/ui/panel-parity.js` the panel DOM against its baseline (`--capture` after an intended change).

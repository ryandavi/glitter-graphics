# UI conventions

Visual and interaction conventions for the editor UI: the design system, sidebar panels, modals, lists, icons and buttons. Referenced from `CONTRIBUTING.md`. Read this before adding or changing any panel, toolbar, modal, button or icon.

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
| Row height | `--row-height`: a chrome button, a tool button. Property rows use `--property-row-height` (the control height) and section titles `--property-title-height`, both in `css/panels/property/_tokens.scss` |
| List row | `--list-row-height`: a row that leads with a thumbnail |
| Chip | `--chip-height`: tags and pills, derived from the control height |
| Radius | `--radius-lg` 8 (panel), `-md` 6, `-sm` 4 (control), `-xs` 3 (inner). Nested rounded elements step down one. |
| Modal width | `--modal-width-dialog` 480, `--modal-width-form` 720, `--modal-width-reading` 880 |

**Density is one media query.** `@media (pointer: coarse)` at the end of `_tokens.scss` raises the three heights (28/32/40 become 40/44/52). Never restate a height for touch anywhere else, and never size a control from the viewport width.

Literal colors are allowed only where the color must not follow the theme: selection chrome and handles drawn over artwork, swatch and filter illustrations, and the tooltip's era skin.

### One of each

| Primitive | The one | Notes |
|---|---|---|
| Section | `.property-card` | Flat: no border, no background, no line. See Sidebar panels. |
| Row | `.property-row` | `label \| control \| value \| revert`; `.is-stacked`, `.is-pair`, `.is-toggle` |
| Field | select, number, text, `.property-value` | Flat, 1px border, `--control-height` |
| Segmented control | `.segmented-control` | Sentence case. Defined once in `css/panels/property/_fields.scss`, used everywhere. An option that wraps its own input styles `input:checked + span`. |
| Switch | `.property-switch` / `.property-header-switch` | 30 × 16 track |
| Body button | `.btn-flat`, `.btn-flat.primary`, `.btn-flat.is-icon` | |
| Chrome button | `.btn-text-with-icon`, `.btn-icon` | Gloss; `.primary` or `.secondary` |
| Plain text button | `.btn-text` | A secondary link, reset or destructive action at the left of a modal footer |
| List row | `.list-row` | Handle, media, name over one meta line, trailing actions. Layers and Auto Glitter matches. |
| Tile | `.action-card` (does something), `.choice-card` (picks a value) | |
| Empty state | `.property-empty` | |
| Disclosure | `.advanced-disclosure` and the section chevron | Chevron points right when closed, down when open. Everywhere. |
| Dialog footer | `.modal-footer` | Actions right-aligned, primary last |

Before adding a class, check this table. A feature hook beside a primitive (`layer-item list-row`) is fine; a second class that restyles the same thing is not.

### Rules worth keeping

- **Spacing is the parent's `gap`**, or an explicit `a + b { margin-top }`. Never a bare margin on a child: it survives when the neighbor is hidden and leaves phantom space.
- **Horizontal inset is owned by rows and titles only** (`--property-gutter`). Bodies, sets and sections never add horizontal padding, so the left edge is one line down the panel. `tools/gutter-check.js` enforces it.
- **A box means an object.** The only boxes in a panel are things you can swap or pick from: the asset chip, a preset scrollbox, the gradient editor. The only line is the hairline above a group. The asset chip keeps `--property-set-gap` before the row after it, in whichever set that row sits.
- **Uppercase is the group label's alone.**
- **A revert sits at the right edge of what it reverts**, in a column that is always reserved, and is drawn only while the value differs from its default.
- **Sliders only for bounded values** (opacity, width, rotation). Position, size and other unbounded values are number fields.
- **Units show only when the value could be misread.** `px` is never shown on position or size; `°` and `%` always are.
- **A module summary is one identifier**, never a value dump: the glitter's name, the font, "Off".
- **Never encode meaning in a border color.** No accent or warning rail on a message, card or row. An icon, a label and the copy carry meaning.

## Sidebar panels

- **Naming.** "\<Thing\> Properties" means attributes of the selected layer (Glitter Properties, Sticker Properties, Text Properties). "\<Tool\> Settings" means tool configuration (Mask Settings, Glitter Fill Settings). Section *ids* are historically `*SettingsSection` regardless of title. Don't rename ids: they are in tests, schemas and managers. Class names may be renamed, in a dedicated pass that recaptures the panel-parity baseline.
- **Built from schemas.** Every sidebar section is a `PANEL_SCHEMAS` entry in `js/ui/panel-schemas.js`, composed from the `tpl-*` primitives through `js/ui/panel-renderer.js`. Never copy live sidebar markup into `index.html`. The Transform section is `tpl-transform-panel`, written in its final shape.
- **Structure: five levels, one way to write each.** A panel is `groups`; a group is `{ title, sections, note?, actions? }`; a section is `{ kind: 'section' | 'paintSlot' | 'transform' | 'mount', title, sets, advanced? }`; a set is `{ label?, collapse?, rows }`, or `{ actions }` for a set of buttons; a row is one property (`slider`, `select`, `segmented`, `toggle`, `field`, `numberPair`, `note`, `assetInfo`, `presetGrid`, `host`). Every row sits in a set and every set in a section. The renderer builds exactly what is written and wraps nothing, so a row has one wrapper chain in every panel: `.property-group` > `.property-card` > `.property-card-body` > `.property-set` > `.property-row`, with `.advanced-disclosure` > `.advanced-disclosure-content` between the body and the set for an Advanced row. `tests/unit/panel-schema-grammar.js` fails on anything else.
- **Row vocabulary.** `label` is the visible text; give `ariaLabel` only where the accessible name must differ. A choice control with no `label` fills its set's width. `revert: true` adds a revert to the schema's default; a string names the ids a manager-owned revert restores. A `segmented` with `display: 'select'` shows its options as a dropdown while managers still bind the option buttons. A boolean is a `toggle` row, one per row. Helper text is a `note`, in the set of the row it explains and directly under it. `host` is a control its manager fills (the symbol grid, brush dynamics); it is a row and never carries a structure class.
- **Paint sections.** A `paintSlot` always builds Source, then Opacity directly under it, then its own `sets`; `before` sets (presets) lead it. Its Source row is labelled Source. A section with two paints (Bevel) labels them by what they are (Highlight, Shade), and the second is a set of its own: `{ paint: { … } }`.
- **Order inside a section.** Presets or a picker; identity (the asset chip, or the paint source); opacity; the section's own values in sets, size before position, then choices, then switches; buttons; Advanced. A switch that decides what the rows under it mean (Fit to canvas) leads its set.
- **Sentence case** for everything below the group label: section titles, row labels, options, switches and buttons. One property has one label wherever it appears; slider labels come from `FIELDS`.
- **Actions.** A set of buttons is `{ actions: [...] }`: in a section's `sets` it renders as `.property-set.property-actions` in the body, and in a group's `actions` it ends the group (`.section-actions`), under the group's optional `note`. A group with only actions has no section (Actions). An action that offers a choice before it runs (Split text) takes `menu: true`: the renderer builds the button inside an `.app-menu-popover` root and its owner fills the menu through `setupMenuPopover`. A set of one-click inserts (text symbols) is an inline grid under its field, not a menu.
- **Bodies.** Ordinary and paint sections share `.property-card-body`, which holds sets and at most one disclosure, last. The section's collapse state controls the whole body; switched-off sections remain inert when opened.
- **The section.** A title row at `--property-title-height`, then its sets, then `--property-section-pad-bottom`. A section draws no line. Rows inside a set stack on `--property-row-gap`, so the row pitch is the control plus that gap; sets, and the disclosure or action row that closes a body, stack on the larger `--property-set-gap`, which is what groups rows since a set draws nothing.
- **Every titled section collapses.** The title row is the toggle. Open state is remembered per `prefix:title` (`glitter.panelCards`); a section with an enable switch follows its switch instead. `collapsed: true` in the schema starts it closed (Style, Warp). A section never nests in a section. A form modal's groups stay open so its search can always show a row. Settings > Reset Panels restores the defaults.
- **A closed section should still say what is inside**: `summary: 'asset'` mirrors its asset name, `summary: { id, text }` is a readout its manager writes, and an effect reads "Off".
- **Group labels.** Every group opens with a full-width line and an uppercase label, and never collapses. A line means a group boundary and nothing else: sections inside a group are separated by their title rows and by space. A group and its only section never share a name (the group holding Transform, Size or Align is Layout).
- **Group order.** Layer panels use the same groups in the same order, leaving out any that do not apply: Content (what it is) → Appearance (Style presets, Layer, Fill) → Layout (Transform, Size on Canvas, Align on multi-select) → Effects (Background, Outline, Shadow, Bevel, Sparkles, then Reset effects) → Motion (Animation) → Actions. Effects and Motion come from the schema's `effects:` and `motion:` keys, never from a hand-built group. The renderer adds Reset effects only when a panel has two or more effects (`effectsReset`). Presets lead the group they style. The paint slot a layer is made of is called Fill everywhere.
- **No loose rows.** A row always lives in a section. Whole-layer opacity and blend are the Layer section (`createLayerSectionSpec`).
- **Optional section controls.** An effect is the same `.property-card` with a summary, a swatch or an enable switch; its styles live with the shared section in `_sections.scss`. The switch sits at the right of the title row, where a row's value would be. Off, it is its one title row.
- **Shared section construction.** Ordinary and paint sections use `buildSectionShell` and the same `tpl-card`. Header readouts are `.property-card-summary` and `.property-card-swatch`; paint-source layout belongs in `_paint-slot.scss`.
- **The guide mirrors the UI by generation.** Write guide copy in `content/src/guide.src.html` and build it with `node tools/build-modals.js guide`. Tool headings (`{ui-tool:select}`), tool icons (`{ui-tool-icon:select}`), panel titles (`{ui-panel:textSettingsSection}`) and the full shortcut list (`{ui-shortcuts}`) come from `TOOLS`, `PANEL_SCHEMAS` and `COMMANDS`; use the tokens instead of typing those names. `tests/unit/shortcut-coverage.js` fails when the built guide is stale.
- **The Library holds assets; Properties hold values.** Anything with a file and attribution (glitter, stickers, shapes, brush tips, fonts, later frames and templates) is a Library kind: one `ASSET_BROWSERS` entry plus a `ContentManager` subclass, so it gets search, filters, Recent and Favorites for free. A Properties panel shows the current asset as an `assetInfo` row whose Change opens the Library in picker mode. Presets (gradients, styles, looks, warps) are values and stay as preset grids next to what they change. Never both.
- **In-panel pickers** (filter Looks, gradient presets) share one frame: `.property-scrollbox`, a fixed-height scroll box (`--property-scrollbox-height`) with a bottom fade on overflow, and `GlitterPresetLibrary.bindPickerNavigation` for arrow keys. A category filter is a `Category` row above the picker: in its own `.property-set`, or leading the picker's set when that set collapses. The frame carries no heading of its own. Option layout stays per picker.
- **Collapsible sets.** `collapse: 'open' | 'closed'` on a labelled set makes its name the toggle (`[data-set-toggle]`) and folds its rows; the state is remembered with the sections' (`glitter.panelCards`) and Reset Panels restores it. It is for presets that are a shortcut beside the controls they fill: closed where the controls beside it are the point (gradient), open where the grid is most of what the section shows (sparkles, whose other settings sit in Advanced; frame; warp). A picker that is the content (Looks, frame images) never collapses. It is not a disclosure: Show All Controls leaves it alone.
- **Set names.** A static set name is drawn only in a section with more than one labelled set; a name its manager writes (`label: { id }`) and a collapsible set's name are always drawn.
- **Preset grids.** Use the `presetGrid` schema primitive with a library from `createPresetLibrary`; managers supply only the active id and apply callback. Keep controls needed to understand or choose the selected preset visible; reserve a disclosure for genuinely optional detail.
- **Gradient presets.** Every shared gradient editor renders the `GRADIENT_PRESETS` library. Add a reusable gradient or stripe flag as one entry in `js/paint/gradient-presets.js`; applying one copies its stops and blend mode while preserving a customized angle.
- **Style presets.** Text, shape and sticker panels lead their Appearance group with a Style section (`createStylePresetSectionSpec`), filled from `STYLE_PRESETS` by the shared field binder. Add a look as one entry in `js/paint/style-presets.js` with the layer types it targets. WordArt is a text-only group of ordinary style presets, with geometry still editable in Warp. Selecting any text style resets text styling, fill, effects and motion before applying the recipe; an omitted warp draws flat and an omitted font uses the app default. Content, font size and placement are preserved. With `?debug`, Text's Content actions include Copy style as preset: tune controls live, copy the recipe, then paste it into the registry. A preset grid whose values were tuned off a tile keeps that tile highlighted as edited (`renderPresetGrid({ modified })`, dashed outline); live edits move the highlight with `setPresetGridActive` instead of rebuilding the grid.
- **One disclosure per section, labelled Advanced.** Write it as `advanced: [sets]` on the section; it is the last thing in the body and holds sets as the body does. A paint section's Advanced also carries the sets of whichever source is chosen (glitter color adjust and texture, image placement, gradient smoothing), each hidden for the other sources; the disclosure goes while every set in it is hidden. The Show All Controls preference opens every Advanced globally; managers do not branch on that preference.
- **A set's `label` is not drawn.** It names the run for assistive tech (`role="group"`, `aria-label`). The section title carries the hierarchy, and the gap between sets does the grouping. A set that needs a visible heading inside its section (a look's own settings) takes `title` or a manager-written `titleId`: a quiet sentence-case line, never uppercase.
- **Add menu.** Layer cards come from each type's `addableViaModal` entry and declare a `group` (`basics`, `decorate`, or `effects`). Non-layer generators live in `ADD_MENU_COMMANDS`; overlay templates are appended to Generate from `data/templates.json`. Quick Add remains a filtered view of the same layer metadata.
- **Glitter pickers resolve a slot through its declaration.** Picker code reads a paint slot with `getLayerPaintSlot` / the host's `ensureSlot`, names it with the slot's `label`, and returns focus to `getPaintSlotChipId`; it never indexes a layer's data root with the slot key, which cannot see a nested slot (the bevel paints). `tests/unit/paint-slot-picker-unit.js` walks every declared glitter slot.
- **Numeric controls share one keyboard.** Number fields, sliders and the editable readout beside a slider are stepped by `stepNumericControl` from one delegated listener in `js/ui/slider.js`; never add a `keydown` to a control for arrows. Up and Down step (Left and Right too on a slider), Shift is x10, and a held key is one undo (`currentStepCoalesceKey`, read by `editor.saveState`). The wheel over a focused number field or readout steps it the same way (`CONFIG.ui.numericWheel`); unfocused, the wheel scrolls the panel. An offset is two slider rows, never a pair of number fields. A spec with `typeMin` / `typeMax` (`js/core/fields.js`) lets its readout take a typed value past the track; the thumb rests at the end until the track is used again. A field selects its text on focus, Enter commits and keeps focus, and Escape puts back the last committed value and blurs. A re-sync must not rebuild or blur the control being edited: write values in place.
- **Arrows belong to the focused control if it uses them, otherwise to the layer** (`focusKeyClaim`). A field, select, slider, list or grid keeps its arrows; a button, toggle or segmented option does not, so the layer nudge still works with one focused.
- **Live updates follow the field's cost.** A `FIELDS` entry declares `cost: 'style' | 'raster' | 'compute'` (default `style`), and `bindSlider` runs its `apply` through the scheduler in `js/ui/slider.js`: once per frame, dropping to wait-for-settle when a `raster` or `compute` run goes over its budget (`CONFIG.ui.live`). The readout and revert state update on every tick (`onInput` is the place for a mirror), and releasing the control always applies the final value before `onCommit`. An async `apply` checks its `ticket.isCurrent()` after an await. Never debounce a slider at the call site.
- **Color sampling.** Every `input[type="color"]` is decorated by `initializeColorEyedroppers`. Chromium uses the screen EyeDropper API; the fallback arms one canvas tap and samples a still from `SceneCompositor`. Do not add one-off eyedropper buttons in managers.

### Scroll regions

Vertical section bodies, layer lists, asset galleries and filters, preset pickers, mobile drawers, modal bodies, document menus and timeline lists opt into `.scroll-region` through the host list in `js/ui/scroll-regions.js`. They share `css/_scroll-regions.scss` and `js/ui/scroll-regions.js`. Native overflow, sizing, keyboard input and touch momentum stay on the original element. Horizontal rails, native inputs and the canvas viewport retain their own treatment. Lazy-loaded content receives the same opt-in. Native bars are hidden only after the helper initializes; one floating, draggable thumb appears on hover or scrolling without reserving width. The thumb does not participate in panel layout, and Auto Glitter keeps its separate fixed header/footer bands. Gallery filters likewise keep the search row and shared two-column action row outside `.filters-container-inner`, which alone scrolls. Width and minimum thumb size are tokens; the idle delay is `CONFIG.ui.scrollbar.hideDelayMs`.

## Layers panel and lists

Every Library kind uses one toolbar: a schema-named Style or Browse segment, optional Creator, and Favorites, followed by Up and one tree picker. Home is All styles, All categories or All creators. Styles with sets form optgroups with an All row and child sets; remaining styles share More styles. Flat collections use a flat picker. Native rows read Name (count); desktop customizable selects show thumbnail, name and bare count. Shape picker rows reuse the first shape in category order as a theme-aware SVG; font rows use pre-generated SVG outlines of the representative font's short sample (CJK lettering for CJK faces), so they do not wait for font loading. The same representative supplies the live phrase on a home cover. A font without generated outlines falls back to CSS-generated lettering. Neither SVGs nor fallback sample lettering pollutes native name/count labels. An optional admin-selected representative is unnecessary for this automatic default. Navigation never writes category filters. Any active query or filter hides the toolbar, Quick picks, index lead and category covers, and lists matching assets under category headings with counts. This includes tips inside raster brush packs. The first scrolling title line reads “N results”, adding “for query” when a query is present, and announces updates politely. The search field has a borderless inset clear glyph with its own focus ring; it and Escape clear only the query, retaining any filters. The field and square Filter toggle use `--row-height`. Recents and active filters share a fixed-height scrolling slot with space for chip outlines; recent and search-term labels truncate at 16ch while their full text stays in the title. Filter sheets are generated directly from each Library filter schema using `property-group`, `property-card-body`, `property-set` and `property-row`; shared group separators and the action band draw one hairline at each boundary.

The Library header's View options menu uses the sprite `check` icon consistently for Home shows, Tile size and Quick picks. It remembers Categories or Everything per kind (`libraryHome`), plus shared S/M/L tile size and Quick picks visibility. Defaults are Categories for glitter, stickers and brush tips, Everything for shapes and fonts. Categories home uses navigation `.action-card`s with a preview, readable title and an `.action-card-detail` count such as "104 items" (plain secondary text, not a badge). Covers have a 140px minimum floor, at least 1.5 times the kind's asset floor before tile-size scaling, and a 4:3 preview; clicking one selects its picker entry. Everything lists tiles under category headings; without active search or filters, raster brush packs remain category cards until a pack is opened. Group headings reuse the set header title/count line, with sentence-case titles and a separate count such as "104 items", without an order control. Glitter retains color order within each style. Creator home uses creator covers or headings. Every kind opens on home, with its remembered home presentation. Quick picks is one row above either Style home, project assets before recents when home opens. Picking retains the visible row's order and tiles; new candidates append until home is reopened. A divider separates Quick picks from category navigation. It stays absent from categories, sets, creators, Favorites and narrowed results.

`AssetSetHeader` introduces a selected set or a category with description or credit: name and count, always-visible `Attribution.buildCreditLine`, optional description and note, with no box or disclosure. The Original order toggle remains hidden by CSS, resets on leaving the set and is never persisted. Carried-over glitter tiles follow a set in one grid with origin labels. Favorite and Quick picks updates reconcile tiles, preserving unrelated walls, paging and scroll. Go-to-asset selects its category/set, loads the requested tile and scrolls to it.

Kind-specific cards remain on the shared grid: glitter has a 48px floor, 2px gap and square tiles; stickers retain upload, User Uploads first, animated badges, per-asset pixelation and contained tinted thumbnails; brush tips retain five-across Basic brushes above individual raster pack cards on both Home presentations, with matching Basic brushes and Raster brush sets section headings; Without active search or filters, All Raster brush sets also shows pack cards until a pack is opened. Basic brushes comes first after Home in the picker, followed by All Raster brush sets and its packs, with vector/raster treatment and pack credits; shapes use icon cards; fonts use sample/name cards with a 130px floor, language filters and a Source filter (System/Bundled). Source reads the manifest's existing `system` flag, not a style tag; it combines with language, category and search filters. The phone Library drawer uses the same browser and native picker.


- A layer row is `.list-row` with layer hooks (`layer-item`, `layer-swatch`, `layer-name`). `LayerManager.renderLayersList` builds it by hand, because it is a sortable list and not a schema.
- No row has a border. Selection is a filled row (`.selected`), and the active layer a stronger fill (`.active`).
- Trailing actions (`.list-row-actions`) show while the row is hovered, focused or selected, and always where there is no hover. A state that is on, such as a locked lock, stays in view.
- The bottom bar puts add actions on the left and edit actions on the right (`.layers-bar-group`).

## Modals

- **Stacking.** `ModalManager` owns the ordered open stack, focus and one background inert snapshot. A registration with `layer: 'dialog'` stacks; every other modal replaces. Only the confirmation dialog stacks today. The parent remains visible and inert. `.is-stacked` raises the dialog and draws a scrim without another backdrop blur. Escape, outside click, the X and Back dismiss the top layer; a dismissed dialog never reopens from Forward.

- **Three widths.** A `.modal-content` is form width by default. `.modal-dialog` is the 480px dialog (confirm, alert, sticker upload). `.modal-reading` is the 880px reading frame; Export Ready uses the same width. `.modal-browse` fixes the height so a filter or tab never resizes the frame.
- **Footer.** Actions sit at the right, primary last. A secondary link, reset or destructive action is a `.btn-text` at the left. The footer is chrome, so its buttons are `.btn-text-with-icon`. At phone width every footer does the same thing (`css/modals/_responsive.scss`): the action buttons share one row equally and a label that does not fit truncates, and the left-side `.btn-text` takes its own centered line under them. The confirmation dialog stacks its action buttons instead.
- **Body buttons are `.btn-flat`**: a search's clear button, a table of contents toggle, Cancel on the export progress.
- **A heading over a group of tiles is a `.property-group-label`**, with no box around the group (Add menu, New Canvas presets).
- **The confirmation dialog** takes its content through `editor.confirmAction()` slots (`subject`, `facts`, `details`, `outro`). The subject is the one box. `tone: 'danger'` selects the warning icon and danger button treatment; `skippable: true` permits the global confirmation preference to bypass an undoable action. Danger dialogs that cannot be skipped focus Cancel and Enter activates the focused button. Other confirmations focus Confirm and keep Enter-to-confirm. `editor.chooseAction({ actions: [{ id, label, tone, primary }] })` returns an action id or `null` on dismissal; `confirmAction` is its boolean two-action wrapper. Project replacement offers Save, Don't Save and Cancel, and proceeds after Save only when saving succeeds.
- **Export Ready** is a fixed frame that never resizes, and its body never scrolls. It has three regions, each with its own padding: the preview stage, the facts pinned beside it (size first, tinted with the warning color when the file is over an upload limit), and the side column under the facts, which is the only scroller. Between the facts and the scroller sits one pinned control row: the Result / Details segmented control (hidden when there is nothing to show) and Export again, the same menu as the canvas export button. The side shows the result notes (the save guide, the upload limits, the notices, in that order) or the Details tables (`.export-detail-table` under `.property-group-label`s, one value per column), so the preview stays in view either way. A notice is a `.property-note` and appears only when it changes what the user should do or expect; a clean export shows none. The upload limits are the one box in the notes: a warning surface holding a small table, one row per service, with each limit as a `.badge.is-warning` in its own column. Every platform has exactly one primary footer button (Share where saving has to go through the share sheet). What is shown is decided by `buildExportReport` (`js/export/export-report.js`), which is DOM-free and covered by `tests/unit/export-report-unit.js`; add a rule there, not in the presenter.
- **Reading modals** (About, History, Guide and the article pages) share the shell: header, nav row and frame. Their prose, timelines and references are content and have their own rules in `content/AUTHORING.md`.

### Form modals

New Canvas, Settings, Export Settings and Commands & Shortcuts are property panels in a wider column. The modal body carries `.modal-form.property-panel` and holds a `.section` host, so groups, sections, rows, switches, segmented controls and notes are the sidebar's, styled by `css/panels/property/`. `.modal-form` in `css/modals/_forms.scss` sets only what the wider column changes.

- **A fixed form** is a `PANEL_SCHEMAS` entry with `section: { id, bare: true }` (New Canvas is `PANEL_SCHEMAS.newCanvas`). Width and height are one `numberPair`, a two-way choice is a `segmented` row (`showLabel: true` keeps the word beside an option's icon), and a color is a `field` of `type: 'color'`, hidden while it does not apply.
- **A settings list** is declared in `EXPORT_SETTINGS_LAYOUT` / `APP_SETTINGS_LAYOUT` and built by `js/ui/settings-renderer.js` from the same primitives: one titled section per group, one `.property-set` per setting, the description as a `.property-note`. `settings-group` (with the group's `data-section`) and `settings-row` are hooks for the search filter and the settings code and carry no layout.
- Never write row markup for these modals by hand. A widget that is not a plain row is a `<template>` using the property classes.
- **Rows a setting governs** (`governed` in a layout: GIF Look, Export fidelity) sit in an Advanced disclosure under it. The governing row is the last row of its section and ends on a `.governed-summary` note that states the governed values. The shared `[data-advanced]` handler toggles it and Show All Controls opens it; open it from code with `setAdvancedDisclosureOpen`.
- **Search hides with `.is-filtered-out`, never `hidden`.** `hidden` on a row means it does not apply to the current format, and the filter reads it to decide what is searchable.
- **Resets are the panel's.** A setting that declares a `default` gets the row's `.property-revert`, and reverting fires the control's own change event. A group with a `section` gets the same icon in its title (the section's `reset` option, `.property-card-reset`); it replays the lit reverts of the rows showing in the section and holds no defaults of its own. Neither asks for confirmation. Rows written by a preset (`rowReverts: false`, the GIF Look rail) have no revert: the preset row's restores them together. The footer button is the only reset that confirms, because it also clears state no row shows (Brush and Eraser defaults, panel layout, toolbar position). New Canvas is a one-shot form and has no resets.

## Phone drawer

- A drawer has no window bar. Under the grabber, one row names what the drawer holds as plain text (`.mobile-sheet-bar`), with that surface's real actions as flat icon buttons (Library search, sticker upload, add layer).
- A lone section in the Edit drawer sits directly on the drawer surface, named in that row. When the drawer holds two (a fill layer beside its tool settings, a layer beside Mask Settings), the row reads "Edit" and the sections stack under flat bars that collapse as the sidebar accordion does, one open at a time (`MobileManager.syncEditSections`).
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

### Zones

Floating UI over the canvas has two homes. Put a new element in one of them; never position it with an offset computed from a sibling's size.

| Zone | Element | Holds |
|---|---|---|
| Top | `#previewControls` (`.preview-controls`), one grid | Row 1: view toggles (`.preview-controls-view`), the activity pill (`.preview-controls-status`), export (`.preview-controls-export`). Row 2 (`.preview-controls-stack`): the hint, or the export progress card |
| Bottom | The context bars (`CONFIG.ui.contextToolbars`) | One bar at a time, draggable on desktop |

- The top zone is a size container (`canvastop`). Size its contents to the workspace with `@container canvastop`, not the viewport: a laptop with both panels open is as narrow as a phone.
- The view toggles are one set of buttons: inline at desktop width, a dropdown under `#viewMenuBtn` when narrow (`setupViewMenu`). Add a toggle as a button inside `#viewMenuPanel` and it gets both.
- Layers inside the preview column use `--z-canvas-chrome` (context bars) and `--z-canvas-chrome-raised` (top zone). The top zone is a stacking context, so a surface inside it takes `mini-modal($layer: null)` and stacks in DOM order.

### Activity: the one "working" signal

Anything that takes time before it shows on the canvas reports through the activity pill. It is the only busy signal on phones, where the status bar is hidden.

```js
const done = editor.beginActivity('filter-preview', 'Updating filter preview');
try { … editor.updateActivity('filter-preview', { label: 'Rendering preview', current: 3, total: 24 }); … }
finally { done(); }
```

- Keys are stable per kind of work. Beginning a running key replaces it; an older run's `done` cannot end a newer one. Use `editor.endActivity(key)` where there is no single call to wrap (a pending flag that settles elsewhere).
- Wire it unconditionally. Work faster than `CONFIG.ui.activity.showDelayMs` shows nothing, and once shown the pill stays `minVisibleMs`, so call sites never decide whether something is slow enough.
- Labels are a short present participle with no ellipsis: "Opening image", "Applying glitter".
- A session mode (Auto Glitter) takes the same slot with `editor.notifications.setMode({ label, icon, badge, onExit })` and `setMode(null)`. Do not build a separate mode banner.
- In a session mode, the mode icon becomes the shared spinner and the fixed-width mode label shows the activity text while busy, then restores both. There is no empty status slot. Keep `#canvasActivityStatus` as a visually hidden live region; narrow layouts retain the icon and Exit. Inline status labels use the shared tight line-height token so descenders remain visible.
- Blocking work with a percentage and Cancel uses the export card, which takes over the slot (`suspendActivity`) and hides the hint while it is open.
- Do not dim or cover the canvas to show work. Previews update live under the pill.

## Icons

All icons are `<use href="#icon-NAME">` against the one SVG sprite in `index.html`. The `modals/*.html` files share it and carry no sprite of their own. Build icons with `createIcon('name')` or `tpl-icon`, or with a schema `icon: 'name'` key (context toolbars, panel section headers, panel actions, layer type modal config).

- **One line-art family, no exceptions.** Every symbol is `viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`. A few dense glyphs drop to 1.35, and segmented-control glyphs use 1.4. `fill` and `stroke` live on the `<symbol>` so the shared `svg.icon{fill:currentColor}` never fills them. A genuinely filled bit, such as a dot, carries its own `fill="currentColor" stroke="none"`. Draw new icons in this style. Never paste a filled or FontAwesome path.
- **One action, one icon, everywhere.** The toolbar, context bar, sidebar button, modal submit, app menu, empty state and tool hint for the *same* action all use the same key. Before adding a symbol, check the sprite for an existing glyph for that action. A new symbol is justified only when reusing one would overload it.
- **When an icon is required:** tool buttons, icon-only buttons (also give them `title` plus `aria-label` or a hidden `.name`), menu items, section headers, empty states, and spatial segmented-control options.
- **Icon plus visible label:** card, modal and workspace action buttons, and sidebar actions with an `icon:`. If one button in a row has an icon, all of them do.
- **No icon:** plain text links, body text, confirm and cancel buttons, and word-only segmented options (Low/Med/High).
- **Inputs:** a leading glyph inside the field (`.search-input-icon`) or the right-edge `.property-revert` reset. Never a decorative trailing icon. Reset-to-default is `#icon-reset` (circular arrow), distinct from history's `#icon-undo`.
- **Feature maturity** is a `.feature-badge.feature-badge-beta` pill (schema `section.badge: 'beta'|'alpha'`, or inline), not an icon.

### Icon registry (action → key)

The action → key registry lives in `content/icon-registry.json`; add a row there when an action gets a standard icon. Tool icons live on their `TOOLS` entries (`js/core/tools.js`), which also drive the toolbar, the canvas hint chip and the guide. `tests/unit/icon-references.js` checks every registry key and every icon referenced in markup, schemas, `createIcon` calls and registries against the sprite.

## Buttons

- **`.btn-flat`** is the content-layer button: sidebar actions, an asset's Change, any button in a modal body. A field-shaped box at `--control-height`. `.primary` fills it with the accent for the one main action of a form; `.is-icon` is the square glyph-only form beside a field.
- **`.btn-text-with-icon`** is the chrome text button: a modal footer, the start card. Gloss, at `--row-height`; `.primary` is full strength and `.secondary` or default is dimmed. `.btn-icon` is the square chrome icon button (tools, bar actions, a modal's close).
- **`.btn-text`** is a plain text button, for the secondary link, reset or destructive action at the left of a footer.
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
  | `css/modals/` | `_shell`, `_forms`, then one partial per modal; `_responsive` supplies the common phone layout, followed by `_confirmation` for its stacked action buttons |

- **Each rule is declared once.** `.property-panel` (a whole surface) and `.property-section` (one schema-rendered section) share one token set. A panel-wide class takes no scope; a rule that restyles a global control (select, input) is scoped to `.property-panel` or `.property-section`. Never add a second, more specific copy of a rule to override the first: change the first. **When a change supersedes styling, remove what it supersedes in the same change.**
- **No `:has()`.** State the stylesheet reads is a class the code stamps where that state already changes:

  | Class | Means | Stamped by |
  |---|---|---|
  | `.is-stacked` | a dialog has a parent on the modal stack | `ModalManager` |
  | `.is-off` | a module's enable switch is off | `syncPanelEffectToggle` |
  | `.is-vacant` | every child of a container is `hidden` | the vacancy observer in `panel-renderer.js` |
  | `.is-unset` | a swatch or asset thumbnail has no value to show | `syncModuleSummary`, `buildAssetInfo` |
  | `.is-filtered-out` | a row, group or disclosure has no match for the modal search | `createModalFilter` |
  | `.has-open-menu` | a bar holds an open popover menu | `setupMenuPopover` (`liftHost`) |
  | `.has-active-query`, `.has-filter-summary` | the folded Library search still has something applied | `syncLibrarySearchState` |
  | `.is-edge-hover` | an edge handle is hovered | `SelectionChrome` |

  A control that wraps its own input (flip checkboxes, a radio group, the context-bar toggle) puts its look on the element after the input and styles it with `input:checked + …`, so nothing has to mirror `checked` onto the label.
- A row built by `buildOptionGroup` stacks its control under the label only when the control is not a segmented control or a select. Don't fix a row's layout from CSS.

Shadow sections share a Type row from `shadowKind`: Drop, Extrude and Cast. Cast shows Length (floor depth in px, projected upward from the anchor) and Lean (signed horizontal reach in px). On text, Length, Lean and the Cast Blur row are percentages of font size and scale with the text; Drop/Extrude retain their pixel Blur row. Text also offers an Anchor row (Baseline by default, or Bottom edge), visible only for Cast. Other artwork uses Bottom edge. Blur is available for every shadow type and defaults to zero; Cast applies it after projection. Offset and Spread appear only for Drop and Extrude. These controls are slot fields and options, so desktop panels and phone drawers use the same bindings and undo path.

## Checking a styling change

The glitter recolor modal uses a fixed `.modal-browse` frame, a pixel canvas stage and a scrolling `PANEL_SCHEMAS.glitterRecolor` form. On phones the stage stays above the form. Color rows reuse the color field, eyedropper and revert primitives; their paired hex field writes the exact RGB value. Whole-tile OKLCH sliders are a pending step: Apply writes their result into the swatches and centers them, Cancel centers them without changing the swatches, and saving applies a pending step first. Pending steps make the swatches and stage selection inert. The modal has its own undo history and confirms discarded changes independently of the destructive-action preference.

Recolor opens from a paint slot's Color adjust set in Advanced, or from the glitter Library's header icon, which stays active while its one-shot picker is armed. My Glitter's header offers Edit colors for its selected tile. Library originals always save a new tile; only a tile currently in My Glitter offers Replace and Delete. A retired tile still used by the document can be reopened and saved as a new tile. Name leads the modal form; All colors belongs to Adjust all and shifts the palette's hues around the chosen main color. Preview pixels retain their exact colors on hover. `buildColorListRow` combines the shared `.list-row` surface and text tiers with native color, hex and revert controls. Nothing starts selected; another row or preview color changes selection, and the selected row, selected preview color, empty preview surface or Escape clears it. Editing controls select their own row without toggling it off. Palette rows share square swatch sizing with gradient stops, and the preview surface shares its mixin with Export Ready.

Both tools drive the real app through the states in `tools/ui-states.js` (every layer panel, every tool, the Library, each modal, the phone drawer). Compile a candidate to a scratch file first: `npx sass css/style.scss <scratch>/b.css --no-source-map`.

Editable palette controls order the native swatch, hex input, then eyedropper in one `.color-input-with-eyedropper.has-hex` wrapper. Recolor's list labels show only pixel coverage; the accessible names still distinguish each color. Adjust all keeps its split Cancel / Apply row visible and disabled until an adjustment is pending, so slider edits do not move the form.

Recolor's preview compares the source's Original palette with the current Recolored draft at the same animation frame through a compact switch floating above the preview, centered horizontally. Switching does not change colors, pending adjustments or undo history. The tile canvas keeps its source-resolution pixels and fills the available width with its aspect ratio preserved; pixel picking maps the rendered bounds back to those source pixels. Tall tiles can scroll in the preview surface. A separate, taller repeat canvas draws the pattern at actual size. The stage omits size, count, zoom and view labels; percentage tooltips explain coverage across the original opaque pixels in all frames. Stage notes take no padding beyond the preview surface's inset.

Toggling the Library's recolor picker updates availability on existing tiles without rebuilding or resetting its scroll. Exiting restores the selected layer's picker strip and any previous armed destination while that layer is still selected; closing all pickers discards that destination.

- **A change meant to be invisible** (a refactor, a rename, a dead-rule sweep): `node tools/ui-ab.js <a.css> <b.css>` loads both stylesheets on the same DOM and reports every element whose computed style or box differs. It must report zero, or every difference must be listed with its reason in an `--allow` file.
- **A change meant to be visible:** `node tools/ui-contact-sheet.js capture <dir> --css <compiled.css>` before and after, then `build <before> <after> <out.html>` for a page of real screenshots side by side at three widths and two themes. Review the page and the live app; tune by changing token values.
- `node tools/gutter-check.js` checks the gutter rule, and `node tests/ui/panel-parity.js` the panel DOM against its baseline (`--capture` after an intended change).

## Confirmation policy

Always confirm when Undo cannot restore the discarded work: Clear All, opening over unsaved work, and discarding a preview. These confirmations are independent of Confirm Destructive Actions. Undoable removal of hand-made work (deleting layers, clearing paint, dropping hidden overflow during Split) passes `tone: 'danger', skippable: true` and follows that preference. Other edits that take one undo step use status feedback without a dialog; Invert Mask follows this rule on every device.

Context toolbar entries may declare `session: 'textEdit'`. Active session bars take priority over tool bars. Their controls dispatch the same commands as the property panel; Bold, Italic and Underline explicitly allow their shortcuts while typing. The text font-size control reuses the `textFontSize` field spec.

Border edge controls derive from `borderEdgeStyle` in `js/core/options.js` and each border slot's `edgeStyles`: Smooth (`round`), Sharp (`miter`) and Pixel (`hard`). Shapes offer Smooth and Sharp.

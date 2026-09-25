# UI conventions

Visual and interaction conventions for the editor UI: sidebar panels, layout names, icons and buttons. Referenced from `AGENTS.md`. Read this before adding or changing any panel, toolbar, modal, button or icon.

## Sidebar panels

- **Naming.** "\<Thing\> Properties" means attributes of the selected layer (Glitter Properties, Sticker Properties, Text Properties). "\<Tool\> Settings" means tool configuration (Mask Settings, Color Fill Settings). Section *ids* are historically `*SettingsSection` regardless of title. Don't rename ids.
- **Built from schemas.** Every sidebar section is a `PANEL_SCHEMAS` entry in `js/ui/panel-schemas.js`, composed from the `tpl-*` primitives through `js/ui/panel-renderer.js`. Never copy live sidebar markup into `index.html`.
- **The guide mirrors the UI by generation.** Write guide copy in `content/src/guide.src.html` and build it with `node tools/build-modals.js guide`. Tool headings (`{ui-tool:select}`), tool icons (`{ui-tool-icon:select}`), panel titles (`{ui-panel:textSettingsSection}`) and the full shortcut list (`{ui-shortcuts}`) come from `TOOLS`, `PANEL_SCHEMAS` and `COMMANDS`; use the tokens instead of typing those names. `tests/unit/shortcut-coverage.js` fails when the built guide is stale.
- **Reuse the existing patterns:** gallery cards (font, sticker and brush-shape pickers), segmented controls, carded effect subsections, paint-slot cards, and the shared `renderGlitterAssetDisplay` asset chips.

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

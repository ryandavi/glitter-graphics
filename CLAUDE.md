# CLAUDE.md — glitter editor

Vanilla-JS glitter GIF editor (index.html + js/) with a PHP admin (admin/), developed against local XAMPP. No framework, no bundler, no build step for JS.

## Hard rules

- **Never hand-edit `css/style.css` or `css/style.css.map`.** All styling changes go in `css/style.scss`; Ryan compiles it himself. If asked to compile, use `npx sass` directly — `npm run` scripts break on stdin in this environment.
- **No JS build system.** New JS files are plain scripts (globals, `class Foo {}`) loaded via `<script>` tags in index.html — add the tag yourself, with a `?v=1` cache-bust. **Bump the `?v=` number on every JS file you edit** (same for `style.css?v=` when SCSS changes).
- **LF line endings only** (.gitattributes enforces it); tabs for indentation; match the existing comment style — comments state constraints, not narration.
- Don't run full Playwright verification unless asked — Ryan does manual testing himself. Quick suites that ARE expected: `node tests/touch-smoke.js` and `node tests/touch-handle-verify.js` (invoke with `node`, not npm). When touching export, effect sources, or text/shape managers, also run `node tests/export-parity.js` and `node tests/shape-border-verify.js`.
- Commit only when asked; work happens on feature branches (currently `masks-and-text`).

## Architecture invariants (violating these causes real, shipped bugs)

- **Preview is DOM, export is canvas — every visual feature is implemented twice and must match.** Preview: animated GIF as `background-image` + CSS `mask-image` blob (GlitterManager), or per-slot masked spans (TextGlitterManager span stack). Export: GifExporter flattens GIF frames to ImageData and composites on canvas. When you change one side, find and change its twin (several functions are deliberate mirrors, e.g. `getEffectPaintSource` ↔ `_getTextEffectSource`, border ring stamping).
- **Never use `ctx.filter`** — unsupported on Safari/iOS and iOS export is a supported path. Pixel-level math instead (see js/effects/color-adjust.js for the pattern).
- **No-flicker rules:** never clear-and-rebuild glitter DOM elements in render paths (reconcile instead — recreating an element restarts its GIF and drops its mask for a frame); always decode a new mask image (`Image` preload) *before* swapping `mask-image`, and revoke the old object URL after.
- **Masks are binarized** (`CONFIG.rendering.crispMaskEdges`, default true): partial-alpha mask edges fringe against the GIF transparency key (magenta) on transparent exports. Any new mask source (text, shapes) must go through the same threshold step.
- **History is not self-contained JSON:** layer snapshots deep-clone via JSON, but painted masks live as versioned binaries in `GlitterManager.paintHistory` (snapshots hold `maskVersion` pointers). Anything that serializes state must account for this.
- **Export fragility test** after touching GifExporter or frame handling: add animated sticker → export → edit → undo → export again; also export twice in a row — outputs must be stable (byte-identical when nothing changed).
- Config/state lives in `js/core/config.js` (`CONFIG`, `LayerType`, `ToolType`, `LAYER_UI_CONFIG`). New layer types register in `LAYER_UI_CONFIG` (desktop sections + `mobileSettingsSections`) — that is what makes mobile drawers work.
- Canvas-overlay UI needs `.ui-ignore-gestures`; touch input routes through GestureManager (pointer events), and capture-phase handlers must exclude `.transform-handle-wrapper` / `.transform-handles`.

## Conventions

- Sidebar panels: "\<Thing\> Properties" = attributes of the selected layer; "\<Tool\> Settings" = tool configuration. Section *ids* are historically `*SettingsSection` regardless — don't rename ids.
- `modals/guide.html` must mirror every new panel title, tool, and keyboard shortcut (shortcuts also listed in `CONFIG.shortcuts`).
- Debug output goes through `dbg()` (`js/core/debug.js`), never bare `console.log`.
- Reuse the existing UI patterns: gallery cards (font/sticker/brush-shape pickers), segmented controls, carded effect subsections, shared `renderGlitterAssetDisplay` asset chips.
- **Layout chrome names purpose, not position:** `.preview-panel` is the canvas workspace column (formerly `.right-panel`); `.design-panel` is the right-side control panel; `.layers-panel` is the layers column. Don't reintroduce positional names.
- **Adding a layer type or tool:** follow `docs/!old/LAYER-TYPE-CONTRACT.md` — one manager class implementing the shared interface, one `LAYER_UI_CONFIG` entry, one GifExporter export-plan entry, and a `PANEL_SCHEMAS` entry composed from the `tpl-*` primitives through `js/ui/panel-renderer.js` (never copy live sidebar markup). Mirror its title in the guide. If it needs more than that, fix the dispatch site, don't add a branch.
- **Cross-manager logic goes in responsibility folders** (`js/core`, `js/effects`, `js/transforms`, `js/ui`) with thin delegating methods kept on the classes — never inheritance between layer managers. Keep only the application entrypoint at `js/app.js`; workers belong in `js/workers`.
- **Config:** any user-tunable or twice-used value belongs in `js/core/config.js` under the existing tree. Inline `??` fallbacks that restate CONFIG defaults are forbidden.
- **SCSS:** nested SCSS + mixins + CSS-variable tokens (`:root` ramps → semantic vars). Tokenize a value when it repeats ≥3× or is an app-layer z-index; intra-component stacking stays literal. The Windows-7 theme mixin block is deliberately literal — leave it self-contained.

## Current work

Latest audit + delegation plan: `docs/AUDIT-2026-07-09.md` (slot-effects extraction, slider unification, SCSS tokens, panel renames — with paste-ready prompts and a do-not-touch list). Completed feature plans and their decisions live in `docs/!old/` (TOOL-EXPANSION-PLAN, SYSTEM-AUDIT-AND-DELEGATION-PLAN, TEXT-LAYOUT-SPEC, TOUCH-PLAN, LAYER-TYPE-CONTRACT, etc.); they record *why* things are the way they are — check there before assuming a behavior is accidental.

## Testing gotchas (headless probes)

- Fresh sessions show the welcome modal over the app — remove `.modal-overlay.visible` before screenshots/clicks.
- The visible canvas is `editor.previewCanvas`; `#originalCanvas` is display:none.
- After `editor.loadBlankImage()` / image upload, wait for `editor.originalImage != null` before adding layers (load resolves before the async reset).
- Upload images via `setInputFiles('#imageUpload', …)`.
- Panels auto-open the active layer's settings section — don't assert sections closed.

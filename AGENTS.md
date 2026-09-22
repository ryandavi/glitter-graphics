# AGENTS.md — glitter editor

Vanilla-JS glitter GIF editor (`index.html` + `js/`) with a PHP/MySQL admin (`admin/`), developed against local XAMPP at `http://localhost/glitter/`. No framework, no bundler, no build step for JS. The dev machine is Windows; shells are Git Bash and PowerShell.

## Read this when…

| When you are… | Read |
|---|---|
| Getting oriented: boot order, who owns what, where state lives, render/export/undo paths | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Adding a layer type or touching a layer manager's interface | [docs/LAYER-TYPE-CONTRACT.md](docs/LAYER-TYPE-CONTRACT.md) |
| Adding or changing panels, toolbars, modals, buttons, icons or SCSS | [docs/UI-CONVENTIONS.md](docs/UI-CONVENTIONS.md) |
| Running or writing tests, or probing the app headlessly | [tests/README.md](tests/README.md) |
| Working in `admin/` or on the `data/` manifests | [admin/README.md](admin/README.md) |
| Editing the history or personal-web pages | `docs/local/HISTORY-PAGE-STYLE-GUIDE.md` (local-only) |
| Picking up planned work, or writing or finishing a plan | `docs/README.md` (local-only): the index of active plans in `docs/plans/`, the archive in `docs/!old/`, and the plan lifecycle rules |

## Hard rules

- **Never hand-edit `css/style.css` or `css/style.css.map`.** Styling changes go in the SCSS partials under `css/`; `css/style.scss` is import-only. Ryan compiles it himself. If asked to compile, use `npx sass css/style.scss css/style.css --no-source-map` directly. CI recompiles and fails if the committed `style.css` doesn't match, so tell Ryan whenever an SCSS change needs a recompile.
- **No JS build system.** New JS files are plain scripts (globals, `class Foo {}`) loaded by `<script>` tags in `index.html`. Add the tag yourself, after every script it depends on, then run `node tools/bump-cache.js` after JS or SCSS output changes so every local asset gets a content hash.
- **LF line endings only** (`.gitattributes` enforces it). Tabs for indentation. Match the existing comment style: comments state constraints, not narration.
- **Make the smallest change that fully solves the problem.** Don't refactor unrelated code or introduce new architecture unless asked.
- **Reuse before creating.** Before adding a helper, utility, class, file, config entry or test, search for an existing one that can be extended.
- **Verification:** don't run full Playwright verification unless asked; Ryan does manual testing. Always run `node tests/touch-smoke.js` and `node tests/touch-handle-verify.js` (with `node`, not `npm`). When touching export, effect sources, or the text or shape managers, also run `node tests/export-parity.js` and `node tests/shape-border-verify.js`. `npm run lint` must stay clean. Details: [tests/README.md](tests/README.md).
- **Git:** commit only when asked. Work happens on feature branches, never directly on the main branch.

## Architecture invariants (violating these causes real, shipped bugs)

- **Preview is DOM, export is canvas: every visual feature is implemented twice and must match.** Preview is an animated GIF as `background-image` plus a CSS `mask-image` blob (GlitterManager), or per-slot masked spans (the text and shape span stacks). Export is `GifExporter`, which flattens GIF frames to ImageData and composites on canvas for every format. When you change one side, find and change its twin. `js/effects/preview-export-parity.js` lists the known twins.
- **Never use `ctx.filter`.** It's unsupported on Safari/iOS, and iOS export is a supported path. Use pixel-level math instead (see `js/effects/color-adjust.js`). Two existing uses (`MaskCompositor`, `MaskEditor`) are known violations scheduled for removal; don't add more.
- **No-flicker rules:** never clear-and-rebuild glitter DOM elements in render paths; reconcile instead (recreating an element restarts its GIF and drops its mask for a frame). Always decode a new mask image (`Image` preload) *before* swapping `mask-image`, and revoke the old object URL after.
- **Masks are binarized** (`CONFIG.rendering.crispMaskEdges`, default true). Partial-alpha mask edges fringe against the GIF transparency key on transparent exports, so any new mask source must go through the same threshold step.
- **History is not self-contained JSON.** Layer snapshots deep-clone through `LayerManager.serializeLayer`, but painted masks live as versioned binaries in `GlitterManager.paintHistory`; snapshots hold `maskVersion` pointers. Anything that serializes state must account for this. The base-image buffers are replace-only, because snapshots share them by reference.
- **Export fragility test** after touching `GifExporter` or frame handling: add an animated sticker, export, edit, undo, then export again. Also export twice in a row. Outputs must be stable (byte-identical when nothing changed).
- **Render through the scheduler.** Anything that changes what's visible calls `editor.requestPreviewUpdate()`, not `updatePreview()`. Committed user edits call `editor.saveState(label)` once, not per slider tick; repeated small edits share a `coalesceKey`.
- **Where values live:** static defaults and tunables go in the frozen `CONFIG` (`js/core/config.js`), which is never assigned at runtime. Any user-tunable or twice-used value belongs there, and inline `??` fallbacks that restate a CONFIG default are forbidden. Runtime user preferences go in `PREFERENCES` (`js/core/preferences.js`), and export settings in `EXPORT_SETTINGS_SCHEMA` (`js/ui/settings-store.js`). Layer types live in `LayerType`/`LAYER_UI_CONFIG`, sidebar structure in `PANEL_SCHEMAS`, tools in `ToolType`, and commands and keyboard shortcuts in `COMMANDS` (`js/core/commands.js`).
- **Layer types:** a new type registers in `LAYER_UI_CONFIG` (desktop sections plus `mobileSettingsSections`, which is what makes mobile drawers work) and follows [docs/LAYER-TYPE-CONTRACT.md](docs/LAYER-TYPE-CONTRACT.md). If it needs more than the contract lists, fix the dispatch site; don't add a type branch.
- **Canvas-overlay UI needs `.ui-ignore-gestures`.** Touch input routes through `GestureManager` (pointer events), and capture-phase handlers must exclude `.transform-handle-wrapper` and `.transform-handles`.

## Conventions

- **Generated content:** the article modals (`modals/history.html`, `modals/personal-web.html`, and any local-only pages) are generated from `content/src/*.src.html`. Edit the source and run `node tools/build-modals.js`; never edit the generated modal files by hand. The `data/*.json` asset manifests are generated by the admin export; see [admin/README.md](admin/README.md).
- **UI:** sidebar panels come from `PANEL_SCHEMAS` through `js/ui/panel-renderer.js`, never from copied markup. `modals/guide.html` must mirror every new panel title, tool and keyboard shortcut. Icons, buttons, panel naming and SCSS rules are in [docs/UI-CONVENTIONS.md](docs/UI-CONVENTIONS.md).
- **User feedback** goes through `editor.updateStatus()`, `editor.showError()` or `editor.confirmAction()` (policy in `js/ui/notify.js`). Debug output goes through `dbg()` (`js/core/debug.js`), never bare `console.log`. `console.warn` and `console.error` are for genuine failures only.
- **Cross-manager logic** goes in the responsibility folders (`js/core`, `js/effects`, `js/transforms`, `js/ui`), with thin delegating methods kept on the classes. Never use inheritance between layer managers. Keep only the application entrypoint at `js/app.js`; workers belong in `js/workers`, and anything a worker `importScripts` must be DOM-free.

## `js/` layout and naming

The current layout:

- `js/classes/`: stateful classes instantiated by `GlitterEditor`. **The filename is the class it exports** (`GlitterManager.js` → `class GlitterManager`), in PascalCase.
- `js/core`, `js/effects`, `js/transforms`, `js/ui`: responsibility folders for shared logic, with **kebab-case** filenames and no ALL-CAPS.
- **`js/editor/` holds the `app.js` prototype method bags, not standalone modules.** Each defines one `const FOO_METHODS = {…}` object that `js/app.js` `Object.assign`s onto `GlitterEditor.prototype`. Add new prototype behaviour to an existing bag, or to a new `*_METHODS` file wired into that `Object.assign` call. Never grow `app.js` itself.
- `js/workers/` and `js/vendor/`: workers and vendored libraries.

**Reorganizing is allowed.** Ryan wants `js/` reorganized by domain. The target layout and move procedure are in section 7 of the architecture audit plan (`docs/plans/ARCHITECTURE-AUDIT-2026-09-22.md`, local-only; `docs/!old/` once finished). A move changes only script paths: update the `index.html` tags, worker URLs and `importScripts` lists, the test harnesses and `tools/`, then run `node tools/bump-cache.js`. Keep the naming rules above, and update this section when the move lands.

**`*Manager` has two senses; both are fine.** (1) A layer-type controller per the layer-type contract: `GlitterManager` (the glitter-*fill* layer; the glitter asset library is `ContentManager`/`AssetBrowser`), `TextGlitterManager`, `ShapeGlitterManager`, `StickerManager`, `BaseBackgroundManager`, `FilterLayerManager`. (2) A subsystem owner: `LayerManager`, `HistoryManager`, `ViewportManager`, `GestureManager`, `ModalManager`, `MobileManager`, `ContentManager`. `AutoGlitterManager` is neither: it's a session tool that emits glitter-fill layers. Precise suffixes stay as they are: `*Compositor`, `*Serializer`, `*Exporter`, `*Library`, `*Timeline`, `*Palette`, `*Browser`.

## Docs

- Reference docs (this file, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/LAYER-TYPE-CONTRACT.md`, `docs/UI-CONVENTIONS.md`, `tests/README.md`, `admin/README.md`) are tracked in git. Keep them current when behaviour they describe changes.
- `docs/` has four parts. The root holds the tracked reference docs above. `docs/local/` holds private reference material, `docs/plans/` holds active plans and their delegation prompts, and `docs/!old/` is the archive of finished plans. The last three and `docs/README.md` are local-only, via `.git/info/exclude`, as are some private content pages.
- **Plan lifecycle:** new plans go in `docs/plans/` with a `Status:` line under the title. When a plan is done, fold what is still true into the reference docs, then move it and its delegation prompts to `docs/!old/`. Run `node tools/docs-index.js` after any add or move; it regenerates the index in `docs/README.md`.
- **Code comments must not cite plan files.** Plans are local-only and move when they finish. State the constraint in the comment, or point at a tracked reference doc.
- `CLAUDE.md` is only a pointer to this file. This file is canonical.

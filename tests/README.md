# Tests

Plain Node scripts, most of them driving the real app in headless Chromium through Playwright. There is no test framework: each file exits non-zero on failure.

Suites are grouped by responsibility: `unit/` for isolated logic, `parity/` for preview/export contracts, `ui/` for browser interaction, and `admin/` for PHP contracts. Shared fixtures remain in `fixtures/`; `run.js` is the tagged entry point.

## Running

- The browser suites need the app served at `http://localhost/glitter/` (XAMPP). Override the URL with `GLITTER_URL`, for example in PowerShell: `$env:GLITTER_URL='http://localhost/glitter/'; node tests/ui/touch-smoke.js`.
- Run files directly with `node`. `npm run` scripts break on stdin in this environment.
- `node tests/run.js --skip-tag admin` runs the complete editor matrix; repeated `--skip-tag` flags exclude more environments. CI also excludes `local`; each local suite documents its requirement beside the registration.
- `node tests/run.js --tag <tag>` runs every file with that tag and aggregates failures before exiting. The tag table is at the top of `tests/run.js`; add new files there.
- Local hosts default to unminified sources. Add `--bundle` to the runner (`node tests/run.js --tag quick --bundle`) to run the same suites against `?bundle=1`, or set `GLITTER_URL='http://localhost/glitter/?bundle=1'` for a single file. Deployed hosts default to the bundle; `?src=1` selects sources for debugging. `?bundle=1` takes precedence. After boot-source changes, run `node tools/build.js` before bundle verification; `--check` verifies generated output and hashes without writing.

| Tag | Covers |
|---|---|
| `quick` | interaction smoke, touch handles, pixel parity and frequently used unit contracts (see `SUITES` in `tests/run.js`). |
| `export` | export parity, formats, transparency, timeline, palette, MP4, shape borders, mask edges. CI runs every suite except `admin` and `local`. |
| `unit` | pure-logic suites that need no page |
| `effects` | pixel effects, Auto Glitter analysis, shimmer, combinatorial effect parity |
| `panels` | panel parity, shortcut structure and generated-guide freshness, icon references, hints, notification policy, settings modals |
| `modals` | the modal content build and lint: every `content/src` page builds with 0 errors and matches its `modals/` output, the registries validate, timeline entities exist |
| `touch`, `shape`, `mask`, `layers`, `document`, `assets` | the named areas |
| `admin` | PHP contract tests for the admin (run with `php`) |

## What to run when

Run the smallest existing suite that covers the change. Run `npm run lint` after JS changes; rebuild before bundle verification. Successful suites need repeating only after relevant changes. Register new suites in `tests/run.js`; its registry unit rejects omissions and duplicate registrations.

Paths below are relative to `tests/`. Related pure-logic contracts live in `unit/`; use the runner's tags for the complete inventory.

| Suite | Covers | Run after changing |
|---|---|---|
| `ui/document-start-verify.js`, `unit/recents-unit.js` | Start card, New Canvas split scrolling, template mode, recents, coarse-pointer focus and short viewport fallback | Document-start UI, blank creation or recency helpers |
| `ui/history-contract-verify.js` | Action step counts, canonical undo/redo, native typing, pending commits, sessions, document replacement, failed decoding, queued restore and animated exports | History, selection, tools, sessions or document loading |
| `ui/touch-smoke.js`, `ui/touch-handle-verify.js` | Pointer routing, pan/pinch/twist, selection, drawer detents, numeric scrubbing and individual/group handles | Touch, viewport, selection, mobile or transform interaction |
| `ui/panel-resize-verify.js`, `ui/inspector-library-verify.js` | Responsive panel hosts, drawer handoff, fit and retained pan/zoom | Panel resizing, breakpoint or inspector ownership |
| `ui/panel-parity.js` | Computed styles against the tracked baseline | Panel markup or invisible styling changes |
| `ui/ux-polish-verify.js`, `ui/modal-settings-verify.js` | Settings, reset, keyboard, theme, scroll and phone controls | Settings and editor chrome |
| `ui/modal-stack-verify.js` | Stacking, inert/focus state, dismissals, guards, confirmations, browser Back and Forward | Modal policy or lifecycle |
| `ui/keyboard-shortcuts-verify.js` | Tool shortcuts, Done/Escape, text/layer clipboard priority and picking without selection | Commands or keyboard routing |
| `ui/manifest-library-browser.js`, `ui/lazy-manifest-browser.js` | Manifest completeness, lazy rendering, ordered boot, stylesheet gating, subfolder URLs, first-use downloads and retries | Manifests, boot or lazy groups |
| `ui/personal-assets-verify.js`, `ui/upload-delete-browser.js`, `ui/glitter-recolor-verify.js` | Upload metadata, origin marks, personal collections, deletion, export stability, retained history and portable projects | Asset library, upload or project embedding |
| `ui/background-removal-browser.js` | Eligibility, Cancel/Discard/Keep, transforms, history, project reload and exports using a deterministic worker | Background removal lifecycle; real inference uses separate spike fixtures |
| `ui/brush-target-settings-verify.js`, `ui/area-select-verify.js` | First-stroke creation, hit resolution, reset persistence, area geometry, clipping and history | Brush, mask or area selection |
| `ui/text-tool-verify.js`, `ui/text-chrome-verify.js` | Desktop/phone editing, word/drag selection, composition, wrapping, splitting, emoji, captions, overflow and sizing | Text input, geometry, preview or edit sessions |
| `ui/shape-touch-verify.js`, `parity/shape-border-verify.js` | Shape interactions, masks, borders and shared slot-stack geometry | Shape geometry, mask, border or slot geometry |
| `ui/crop-motion-verify.js`, `ui/animated-base-verify.js` | Crop handles/actions, transforms, one-step history, base pixels and animation placement | Canvas sizing, Crop or base animation |
| `ui/svg-verify.js`, `unit/svg-geometry-unit.js` | SVG parser/import/fallback, outlined/editable and warped text, gradient/pattern rendering, outlines/shadows/bevels, stroke ornaments, painted fills, backgrounds, image exclusion, settings and stable output | SVG import/export |
| `ui/animation-loop-verify.js`, `ui/preview-motion-verify.js` | Frame indices, crawl offsets, pixel equality, loop fitting, Pause/Resume and export stability | Animation timing, loop fitting or preview playback |
| `parity/export-parity.js` | Repeated matte/transparent exports, edit/undo byte identity and preview/export twins | Compositor, exporter, frames, timeline or effect sources |
| `parity/effect-combinatorial-parity.js`, `parity/raster-scale-verify.js` | Combined effects, unequal scales, physical outlines and texture geometry | Shared effects, text/shape raster geometry or slot stacks |
| `parity/nine-slice-parity.js`, `parity/pattern-paint-parity.js`, `parity/filter-parity.js` | Slice tiling, every pattern, alpha/seams and filter pixel math | Their paint/effect algorithms |
| `unit/script-globals-unit.js` | Unique globals, manifest-derived lint boundaries, shared math and phone breakpoint | Script groups, shared globals or breakpoint constants |
| `unit/config-usage-unit.js`, `unit/doc-paths-unit.js`, `unit/cross-language-contract-unit.js` | Unused CONFIG keys, stale documented paths, PHP/JS attribution and tile limits | CONFIG, reference docs or shared language contracts |
| `unit/panel-schema-grammar.js`, `unit/style-presets-unit.js` | Fields/settings grammar, numeric constraints and authored-template vocabulary | Registries, settings layouts or shipped templates |
| `admin/` suites | Export schemas, manifests, organization/imports and isolated database mutations | Admin APIs, taxonomy, manifests or imports; require local PHP/MySQL |

## Harness and probe constraints

`tests/lib/app.js` exports `openApp({ viewport, touch, document })`, returning `{ browser, context, page, errors }`. It owns URL/CSS routing, boot wait, welcome dismissal and optional blank canvas. Use it for new browser tests and suites being edited; do not migrate untouched suites. The parity harness in `tests/parity/export-harness.js` owns compositor exports and byte comparisons.

`GLITTER_TEST_CSS` routes a scratch Sass compile. `GLITTER_UI_SOURCE_DIR` routes selected JS files from a source snapshot for before/after styling checks. `GLITTER_PANEL_BASELINE` selects a scratch panel baseline; capture unchanged HEAD before comparing a refactor. `HISTORY_BASELINE=<git revision>` replays the history suite against earlier source without changing the worktree.

Standalone exporters that verify the result modal must receive `editor.exportResultPresenter`. Load `gif-codec` before replacing `window.GIF`. Native-palette fixtures need more than `CONFIG.export.limits.colorAnalysis.significantColorCount` colors. Prepare text measurements before counting per-frame compositor allocations. On phones, wait for `mobileManager.sheetRelease` to clear after Close before checking the picker session. Wait for entry animations before measuring card geometry.

After compositor, exporter or frame changes, perform the export fragility routine: animated sticker, export, edit, undo, export again, then twice consecutively. Unchanged outputs must be byte-identical. Automated parity covers this too; the manual desktop/phone interaction pass remains useful for session and touch changes.

## Inspection tools

- Invisible SCSS cleanup: `node tools/ui-ab.js` compares computed styles on the same DOM. Visible styling: `node tools/ui-contact-sheet.js` captures before/after pages with `--css <scratch.css>`. Ryan compiles committed CSS.
- `node tools/wordart-contact-sheet.js` compares authored WordArt looks using real masks without adding document layers.
- `node tools/load-report.js --url http://localhost/glitter/ --output .tmp/loading/report.json` measures cold/warm loads, bytes, boot stages and layout shifts; `--check` enforces CONFIG budgets. Measure without concurrent browser suites. For shipping budgets, use `node tools/serve.js` and `http://127.0.0.1:8100/?bundle=1`; `--css` serves scratch styles.

CI checks lint, generated shell/bundle and both compiled stylesheets, then runs every editor suite except explicitly tagged `local`. Full audit validation runs `node tests/run.js --skip-tag admin` both with sources and `--bundle`. Admin suites run separately against local services.

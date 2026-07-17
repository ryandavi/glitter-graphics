# ADMIN-IMPROVEMENT-PLAN — swatch quality, admin unification, ingest & styling

2026-07-17. Covers the PHP admin (`admin/`), the asset data contracts it feeds the
editor (`data/glitter.json` / `data/stickers.json` → GlitterManager/StickerManager →
AutoGlitterManager → auto-glitter worker), and two narrowly scoped editor-side
packages (WP-C consumption changes, WP-H shared styling).

Work packages A–E were lettered in the order they were written, not the order they
dispatch — the **Order & rollout** section is the authority on sequencing.

## Problem statement (Ryan-said, accumulated over the day)

- Auto Glitter suggests patterned glitters whose swatches "don't really make sense."
- Ryan has manually added a `pattern` tag to those assets, but nothing in the editor
  checks it.
- Nearly every glitter contains white sparkle pixels; some contain yellow glint etc.
  Without knowing *how much* of each color is present, a glitter with a white glint is
  indistinguishable from a white glitter. Ryan wants per-color percentage stored.
- Beyond colors: overall admin improvements; the same treatment for the sticker
  admin (metadata + methodology), sharing as much code as possible between the two;
  making it easy to add new assets while keeping a human approval step; and reusing
  the main app's styling so the admin feels like part of the same app.
- General directive: reuse code, extract utils where needed, keep it easy to expand.
- Open decisions were delegated ("do whatever you think best practice is",
  2026-07-17) — resolved decisions are tagged DECIDED inline.

## Diagnosis (measured — from the current code)

1. **Exact-hex histogram, counts discarded.** `GifAnalyzer::extractColorData()`
   (`admin/includes/gifAnalyzer.php`) counts pixels per exact `#RRGGBB`, keeps colors
   whose count ≥ 5% of opaque pixels (`color_threshold`), then stores only the hex list
   (`color_codes` CSV). Coverage is computed and thrown away.
2. **Fragmentation kills patterned/dithered GIFs.** A patterned or dithered glitter
   spreads across thousands of unique hexes; few or none reach 5%. What *does* survive
   is often the white sparkle (uniform `#FFFFFF` runs), so patterned assets end up with
   swatches that are mostly white/noise. This is the root cause of the bad suggestions.
3. **Sparkle skip is dead code.** The "skip bright whites" branch (line ~133) is
   commented out — white glint counts at full weight and also drags `color_value` /
   `generated_name` toward White.
4. **First frame only.** GD (`imagecreatefromgif`) decodes only frame 1; sparkle
   position varies per frame, so single-frame sampling is noisy.
5. **Worker treats all swatch colors equally.**
   `assignSuggestedSwatches()` (`js/workers/auto-glitter.worker.js`) matches each
   palette entry against a glitter's `colorCodes` using primary (= `colors[0]`) +
   closest-color distance (`swatchPrimaryWeight` 0.75). A 6% white entry in
   `colorCodes` makes that glitter a candidate for white regions.
6. **`pattern` tag is ignored.** `AutoGlitterManager` builds its suggestion pool with
   only `isActive !== false && !hasTransparency && colorCodes?.length`.
7. **Bulk Analyze silently drops all color results.** `AssetAPI::persistAnalysis()`
   writes only width/height/file_size/frame fields — `color_codes`, `color_value`,
   `hue`, `generated_name` are computed and discarded. Only the single-asset analyze
   modal (user applies checkboxes → save) ever updates colors. "Bulk Analyze All" has
   never refreshed a swatch color.
8. **Path building is duplicated and inconsistent.** `performAnalysis()` hands
   GifAnalyzer `"../" . $url` which the constructor prefixes with `image_base_path`
   (`"../"`) → `"../../$url"`, while the same function separately builds
   `"../../" . $url` for filesize/transparency. Works today because the two happen to
   agree; one refactor away from analyzing one file and stat-ing another.
9. **N+1 queries and loop-per-row writes.** `exportAssets()` runs `getAssetTags()` per
   asset; `saveAssetTags()`/`reorderAssetsByIds()` prepare one statement per row, no
   transaction (delete asset+tags isn't atomic either). Harmless at current scale,
   but cheap to fix while in there.
10. **`has_transparency` is a 20×20 grid sample of frame 1** — a sparse transparent
    region can be missed, and that flag *gates the auto-glitter pool* (see item 6).

### Sticker-side findings (measured)

11. **The analyze flow is written twice.** `sticker_admin.js` and `glitter_admin.js`
    each carry their own `analyzeCurrentAsset`/`analyzeBulk`/`showAnalyzeModal`/
    `applyAnalysis` — near-identical logic differing only in field lists. Same for
    the hand-built `renderEditor` form HTML.
12. **Add-asset asymmetry:** `StickerAPI::addAsset` auto-analyzes the file on add;
    `GlitterAPI::addAsset` doesn't — new glitters sit unanalyzed until someone
    remembers the button.
13. **`sticker_text` is invisible to the editor.** The admin captures it, the export
    ships it, `normalizeAsset` normalizes it — but `ContentManager.matchesSearch`
    matches only name + tags. Searching "birthday" won't find a sticker whose text
    says Happy Birthday unless someone also tagged it.
14. **Sticker color filter chips run on manual tags.** The editor's sticker gallery
    filters color via tags (`matchesColors`), so color findability depends entirely
    on hand-tagging. GifAnalyzer already computes color data for stickers — then
    `StickerAPI` drops it (no color columns, none exported).
15. **`thumbnailUrl` is always just `url`.** The sticker gallery downloads every
    full animated GIF to render its cards; the contract field for thumbnails exists
    but nothing generates them.

### Sidebar, drag-drop, and ingest findings (measured)

16. **Sidebar drag-sort is buggy on three counts.** `renderAssetList` ignores
    `showRecentSection`, so the glitter list (sorting enabled) renders a
    "Recently Added" section whose items *duplicate* data-ids from the category
    groups; `saveOrder` collects `document.querySelectorAll('.swatch-item')` —
    unscoped and including those duplicates, so the reorder payload contains each
    recent id twice and last-write wins; and the `dragover` handler inserts relative
    to the whole container, letting an item be dropped outside its
    `.category-items` group (visually escaping its `<details>`). Also every rerender
    hardcodes all `<details open>` — collapsed state doesn't survive a save.
17. **The "Or Upload File" input does not upload.** `handleFileSelection` only
    derives a URL string from the chosen filename — the file bytes never leave the
    browser and no upload endpoint exists (`move_uploaded_file` appears nowhere).
    Adding an asset today means: manually copy the file into `images/<type>/<cat>/`
    over the filesystem, then fill in the modal so the DB row points at it.
18. **`is_active` is not a real gate.** `exportAssets` has no active filter
    (inactive rows ship in the JSON with `isActive: 0`), and the editor gallery
    (`ContentManager.filterContent`) never checks `isActive` — only the
    auto-glitter pool does. Unchecking Active hides nothing from users.

## Data contract change (the spine of this plan)

Add **coverage** alongside every swatch color, end to end:

| Layer | Today | After |
|---|---|---|
| DB (`glitter` table) | `color_codes` VARCHAR CSV | + `color_weights` VARCHAR CSV of floats (parallel to `color_codes`, 0–1, 2 dp) |
| Analyzer output | `color_codes` | + `color_weights`, + `sparkle_coverage`, + `suggested_tags` |
| Export (`glitterAPI.php` → `data/glitter.json`) | `colorCodes: []` | + `colorWeights: []` (same length/order) |
| Editor (`GlitterManager.normalizeAsset`) | `colorCodes: []` default | + `colorWeights: null` default |
| Worker swatch input | `{ id, colors }` | `{ id, colors, weights }` |

Back-compat rule (recommendation): `colorWeights` missing/length-mismatched → treat as
uniform weights. User-imported glitters and stale JSON keep working; nothing hard-fails.

Parallel-CSV over a JSON blob column (recommendation): matches the existing
`color_codes` storage style, keeps `getAssetSpecificFields()` string-typed, zero
migration risk beyond one `ALTER TABLE ADD COLUMN`.

## WP-A — Analyzer rewrite (Codex)

Rewrite `extractColorData()` around **bucketed clustering with coverage**:

1. **Quantize** each opaque pixel to a 4-bit-per-channel bucket (4096 buckets) while
   counting — kills hex fragmentation.
2. **Merge** buckets whose Lab distance is below a config threshold
   (`cluster_merge_distance`, start ~12 ΔE) into clusters; cluster color =
   count-weighted centroid; cluster coverage = pixels/opaquePixels.
3. **Sparkle handling:** clusters with L > 92 and chroma < 10 are classified sparkle.
   Keep them in the output (with their true coverage) but exclude them from
   `generated_name` / `color_value` dominant-color selection, and report a separate
   `sparkle_coverage` total. Delete the commented-out skip.
4. **Threshold on cluster coverage** (keep `color_threshold` = 5%, now meaningful
   because clusters aggregate), cap at `max_colors`, sort by coverage desc — order in
   `color_codes`/`color_weights` **is** the ranking; primary = index 0.
5. **Multi-frame sampling** (recommendation): if the `imagick` extension is loaded,
   sample up to 3 evenly spaced frames and pool the pixels; else GD first-frame
   fallback. Frame-delay parsing stays as-is.
6. **Pattern suggestion heuristic** (recommendation, human-confirmed): if ≥4
   non-sparkle clusters each hold ≥10% coverage with hue spread > 60°, include
   `pattern` in a new `suggested_tags` array in the analyze result. The analyze modal
   shows it as a checkbox like the other fields; nothing is auto-applied.
7. All magic numbers go in `admin/includes/config.php` next to `color_threshold`.
8. **Utils:** extract `rgbToHSV`, new `rgbToLab`/ΔE, and hex helpers into
   `admin/includes/colorUtils.php` (plain functions, shared with any future sticker
   analysis). Delete dead `getColorName`/`getColorNames`.

Also in this WP: `ALTER TABLE` migration for `color_weights` (idempotent, in the same
place existing schema setup lives), `assetAPI.php` analyze/save plumbing for the new
fields, and `getAssetSpecificFields()` gains `color_weights` (string).

**Bulk-analyze color persistence (fixes diagnosis #7):** color fields must reach the
DB in bulk — behind an "include colors" checkbox on the Bulk Analyze confirm (default
ON; the guard exists so hand-curated swatches aren't clobbered by accident). Design:
base `persistAnalysis()` stays technical-fields-only (the sticker table has no color
columns); `GlitterAPI` overrides it to additionally write `color_codes`,
`color_weights`, `color_value`, `hue`, `generated_name`. Without this fix the entire
analyzer rewrite is unreachable in bulk.

**Path helper (fixes diagnosis #8):** one `assetFilePath($url)` helper used by both
GifAnalyzer and `performAnalysis()`; GifAnalyzer takes the resolved path, stops
prefixing internally.

**Transparency sampling (fixes diagnosis #10):** while rewriting the pixel loop,
detect GIF transparency from the full pass already being made (any pixel at the
transparent index) instead of the separate 20×20 grid probe.

## WP-B — Admin UI for coverage (Codex)

- `glitter_admin.js`: render each swatch chip with its percentage (bar or label);
  analyze modal shows the proposed colors *with coverage* and the `suggested_tags`
  checkboxes; save path writes `color_weights` in lockstep with `color_codes` when the
  user manually adds/removes/reorders colors (manual edits without known coverage get
  uniform re-normalized weights).
- `glitterAPI.php::formatAssetForExport`: emit `colorWeights` parallel to
  `colorCodes` (floats), omitting nothing — mismatch is a bug, not a fallback.
- Bulk Analyze: `analyzeAllAssets` currently runs as one long request. Convert to
  batched requests from the client (N assets per call) with a progress count in the
  status bar, so 100+ assets can't hit PHP max_execution_time.

## WP-C — Editor consumption (Fable)

Fable takes this one: it touches the editor data contract, CONFIG rules, and worker
math that must stay in tune with AutoGlitterManager.

1. `GlitterManager.normalizeAsset` defaults: `colorWeights: null`.
2. `AutoGlitterManager` swatch pool (Ryan-said): exclude glitters whose tags include
   `pattern` (case-insensitive) from the suggestion pool. They stay available for
   manual selection everywhere else.
3. Worker `assignSuggestedSwatches`:
   - Swatch payload gains `weights`; uniform fallback when absent.
   - Primary is the highest-weight color (index 0 by contract).
   - Closest-color search ignores colors below `swatchMinCoverage` (start 0.08)
     unless the swatch has only one color.
   - Distance penalized for low coverage:
     `d * (1 + swatchCoverageBias * (1 - weight))` — a 6% white can no longer win a
     white palette entry against a genuinely white glitter.
   - New knobs under `CONFIG.tools.autoGlitter.analysis`: `swatchMinCoverage`,
     `swatchCoverageBias` (start 1.5). No inline `??` fallbacks.
4. **Search matches `stickerText` (fixes #13, recommendation):**
   `ContentManager.matchesSearch` full-mode adds `stickerText` to the haystack
   alongside name and tags (Name Only mode unchanged). Base-class change, so it
   costs nothing for glitters (`stickerText` null) and makes the admin's
   Sticker Text field actually findable.
5. Bump `?v=` on every touched JS file; run `node tests/auto-glitter-analysis.js`.

## WP-D — Admin QOL grab-bag (Codex, lowest priority)

- Move remaining inline `style=""` blobs in `glitter.php`/`sticker.php` into
  `swatch_admin.scss`.
- Analyze modal: side-by-side old vs proposed values (currently proposed only).
- "Export JSON" reminder: after any save/bulk-analyze, surface a "data/glitter.json is
  stale — export?" hint in the status bar (recommendation; today it's easy to forget
  the export step and the editor keeps serving old swatches).
- Name generation already benefits from WP-A (sparkle excluded from dominant color) —
  re-run Bulk Analyze afterward and spot-check `generated_name` no longer says White
  for glint-heavy assets.

## WP-E — General admin hardening & workflow (Codex, independent of the color work)

All recommendations unless marked; none change the data contract.

- **Atomicity/perf (fixes #9):** wrap delete-asset (tags map + row), `saveAssetTags`,
  and `reorderAssetsByIds` in transactions; batch the tag inserts into one
  multi-VALUES statement; fix the `exportAssets` N+1 with one JOIN query grouped in
  PHP.
- **Dirty-state guard:** selecting another asset (or closing the tab —
  `beforeunload`) with unsaved edits currently discards them silently. Track a dirty
  flag in `asset_admin.js` (shared base, so stickers get it free) and confirm before
  navigation.
- **Sidebar search/filter:** a text filter over name/category/tags in the asset list —
  the glitter list is 100+ items and scroll-hunting is the main workflow friction.
- **Export safety:** before `saveExport`/`saveCategoriesExport` overwrite
  `data/*.json`, copy the previous file to `data/backup/<name>.<date>.json` (keep
  last 3). The exports are the editor's live database; today a bad export has no
  undo.
- **Duplicate/orphan detection:** on add + a small "Health" report on index.php —
  URLs referenced by DB rows that don't exist on disk, files in `images/glitter/`
  not referenced by any row, duplicate URLs. (WP-G's `is_active` audit depends on
  this report — see rollout.)
- **Dead code & consistency sweep:** remove unused `getColorName`/`getColorNames`
  (done in WP-A), the sticker-only `orderByMap` special case comment-documented,
  inline `style=""` moved to SCSS (WP-D overlap — do once).
- **Sidebar & drag-sort fixes (diagnosis #16):**
  - `renderAssetList` honors `showRecentSection`; when it does render Recently
    Added, those items are navigation-only (no `draggable`, a `data-recent`
    marker).
  - `saveOrder` scopes to `#<listContainerId> .category-items .swatch-item`
    (excludes recent duplicates by construction) and asserts no duplicate ids
    before POSTing.
  - Drag is constrained to the item's own `.category-items` group — cross-category
    moves are a category *change* (edit form), not a sort. `getDragAfterElement`
    takes the group element, not the whole container.
  - `<details>` open/collapsed state persists per category id in `localStorage`
    and is restored on rerender (stop hardcoding `open`).
  - Category summaries show item counts (`Sparkle (34)`).
  - Keyboard: focused list item, arrow up/down to navigate assets — cheap and
    makes long review sessions (WP-G approvals) much faster.

## WP-F — Sticker admin + shared-base unification (Codex)

The reuse mandate (Ryan-said): glitter and sticker admin share one codebase wherever
behavior is the same. This WP **dispatches first** (see rollout) — it turns the
duplicated surfaces into shared base code so WP-A/B build the coverage UI *once*.

1. **Shared analyze flow (fixes #11).** Move `analyzeCurrentAsset`, `analyzeBulk`,
   `showAnalyzeModal`, `applyAnalysis` into the `AssetEditor` base
   (`asset_admin.js`), driven by a per-type field-descriptor array
   (`{ key, label, format }`) declared by each subclass. The subclasses keep only
   their descriptor lists. WP-D's old-vs-proposed comparison and WP-A/B's coverage
   display then get implemented once in the base.
2. **Descriptor-driven editor forms (same pattern, stretch within this WP).** Both
   `renderEditor` bodies are parallel hand-built HTML; drive them from a shared
   field-schema renderer in the base (text/number/checkbox/select/tag-section
   primitives). Mirrors the main app's PANEL_SCHEMAS philosophy: schema in the
   subclass, rendering in one place.
3. **Auto-analyze on add for both types (fixes #12).** Hoist `addAsset` into
   `AssetAPI` with a per-type insert-field map; both types run
   `performAnalysis` + `persistAnalysis` on add, so a new asset is born with correct
   dimensions/frames/transparency.
4. **Analyzer-suggested color tags for stickers (fixes #14 — the metadata
   methodology win).** Sticker tags already carry `hex_color` in the DB. Reuse the
   WP-A cluster output: match each dominant non-sparkle cluster against the existing
   color-tag vocabulary by Lab distance (via `colorUtils.php`) and offer the matches
   in `suggested_tags`, shown as confirm-checkboxes in the analyze modal — same
   human-confirmed pattern as the glitter `pattern` suggestion. High
   `sparkle_coverage` additionally suggests the glitter/sparkly vibe tag if one
   exists. No new columns; stickers stay tag-based, which is exactly what the
   editor's color filter chips already consume.
5. **Real thumbnails (fixes #15, recommendation).** On add/analyze, generate a
   static first-frame PNG capped at 128px (`images/stickers/.thumbs/<id>.png`, GD)
   and export it as `thumbnailUrl`. The editor already reads `thumbnailUrl` for
   gallery cards with `url` fallback, so this is additive — cards get cheap static
   previews, full GIF loads only on use. (DECIDED 2026-07-17, Fable recommendation
   under Ryan's delegation: static thumbs ship; if browsing feel suffers, add
   hover-swap to the animated `url` as editor-side polish later — the data
   contract already supports it.)

Bulk Analyze for stickers picks up WP-B's batching for free once shared.

## WP-G — Upload & ingest pipeline with human approval (Codex)

Goal (Ryan-said): make adding new stickers/glitters *easy* — but machines only
propose; a human approves. Two gates stay human: per-asset **Approve**, and the
existing **Export JSON** step that publishes to the editor.

### Upload endpoint (new; fixes #17)

`includes/api.php?action=upload&type=<type>` — POST multipart, CSRF-checked like
every other action:

- Validate by **magic bytes** (GIF87a/GIF89a, PNG, JPEG), never by extension;
  reject others. Size cap in `config.php` (`upload_max_bytes`, start 5 MB).
- Filename: slugified from the original name (same regex the modal already uses),
  collision-suffixed `-2`, `-3`, ….
- **Duplicate rejection by content hash:** md5 the upload, compare against an
  `file_hash` column (added in the same idempotent migration as `color_weights`;
  backfilled by Bulk Analyze). On match, respond with the existing asset's id/name
  instead of creating a copy.
- File lands directly in `images/<type>/<category-slug>/` — category is chosen at
  upload time (reuses the add-modal select). URLs are asset identity in this app;
  we do not move files after approval, so no staging directory.

### Ingest flow (per file, all automatic)

1. Insert DB row with **`is_active = 0`** (pending).
2. Run `performAnalysis` + `persistAnalysis` (WP-F already auto-analyzes on add):
   dimensions, frames, transparency, colors + weights (glitter), and
   `suggested_tags`.
3. Prefill `name` from `generated_name` (glitter) or the cleaned filename
   (sticker) — a *proposal*, expected to be edited at review.

### Review & approval (human)

- The sidebar gains a **Pending** section pinned above the categories (this
  replaces Recently Added's job for new assets; recent stays for recently
  *approved*). Badge with count.
- Selecting a pending asset opens the normal editor, analysis prefilled and
  suggested tags pre-checked but not saved. A prominent **Approve** button (and
  **Reject** = delete row + file, confirm required) sits next to Save.
- Approve = save form + `is_active = 1`. Nothing more — publishing still requires
  Export JSON, so a half-reviewed batch can never leak.

### Making `is_active` a real gate (fixes #18 — DECIDED 2026-07-17: Fable
recommendation, Ryan delegated "do whatever you think best practice is")

`exportAssets` gains `WHERE is_active = 1`, and `isActive` is dropped from the
export payload (it would be constant 1). Chosen over a separate `status` column:
the flag, the checkbox, and the editor-side default all already exist — a second
approval field would be duplicate state. Consequence: any *currently* inactive
rows disappear from `data/*.json` on next export — audit them before the first
export after this lands (the WP-E health report lists them). The editor needs no
change: gallery shows everything it receives, which is now exactly the approved
set; AutoGlitterManager's `isActive` check degrades to a no-op via the
`normalizeAsset` default (true).

### Bulk entry points

- **Drop zone:** dragging files anywhere onto the sidebar highlights it and opens
  a category picker; multi-file drop uploads sequentially with per-file status
  (reuses WP-B's batched-request pattern). The add modal's file input gains
  `multiple`.
- The old URL-only add path stays (for hand-placed files), unchanged.

## WP-H — Shared styling: make the admin feel like the app (Codex)

Ryan-said: reuse as much of the main app's styling as possible. The structures are
compatible: the app has layered SCSS (`css/_tokens.scss` ramps → semantic vars,
`css/_themes.scss` with six `:root[data-theme]` skins, `css/_mixins.scss` gloss/bar/
window mixins, `css/_components.scss` controls); the admin is one 1123-line
`swatch_admin.scss` with its own flat, differently-named variable system
(`--bg-primary`, `--accent-primary`, bootstrap-ish visuals). Strategy: **share the
token, theme, and mixin layers; adopt components selectively; never fork tokens.**

### H1 — wire shared layers + compat bridge (cheap, do first)

- `swatch_admin.scss` header becomes `@use '../../css/tokens'`,
  `@use '../../css/themes'`, `@use '../../css/mixins'` (compile-time relative
  paths — output location and serving are unaffected).
- Delete the admin's own color variables. In their place, one **compat bridge**
  `:root` block maps every legacy admin var name to an app token
  (`--bg-primary: var(--color-bg-primary); --text-secondary:
  var(--color-text-secondary); --accent-primary: var(--blue-200); --status-success:
  var(--green-100); …`). The 1100 lines of existing admin rules keep working
  untouched, but instantly recolor into the app's slate-blue palette — and all six
  themes apply.
- Admin-only scales the app doesn't have (`--spacing-*`, `--font-size-*` ramps)
  move to `admin/css/_admin-tokens.scss` and stay admin-local. Do not add them to
  the app's tokens; the app tokenizes on the repeat-3×/z-index rule, not wholesale.

### H2 — shared controls + mixin adoption

- Extract the truly generic controls from `css/_components.scss` into a new
  `css/_controls.scss`: the `.btn` family, `.filter-chip`, `.switch`, `.tooltip`.
  Both entrypoints `@use` it — `style.scss` in the exact position the rules
  occupied inside components (the compiled `style.css` diff must be a pure move;
  that's the verification). App-specific chrome (transform handles, layer rows,
  panels) stays where it is.
- Admin surfaces then adopt the app's look via mixins, not copied rules:
  `gloss-button` for primary/secondary buttons (retiring the bootstrap-blue
  `.btn-primary`), `bar-base`/section-header treatment for the admin header and
  sidebar headers, `mini-modal` for modals. The Windows-7 mixin block stays
  self-contained and untouched — admin consumes it as-is like every theme does.
- Migrate admin rules from legacy var names to app tokens section by section,
  shrinking the H1 bridge until it can be deleted. Bridge deletion is the
  done-signal for H2.

### H3 — theme sync (free "same app" feel)

The app persists `interfaceTheme` inside the `glitterEditorSettings` localStorage
JSON and applies it as `document.documentElement.dataset.theme`. Same origin ⇒ the
admin can read it. Add one tiny inline script in the `<head>` of
`glitter.php`/`sticker.php`/`index.php` (before CSS paint): parse the key, set
`dataset.theme`, fall back to `dark`. No admin theme UI — the admin simply follows
whatever Ryan picked in the editor.

### Constraints

- `swatch_admin.css` is compiled output like `style.css` — never hand-edit either;
  Ryan compiles both entrypoints (Live Sass Compile can watch both).
- Never rename an app token for the admin's benefit; the bridge exists so the
  admin adapts to the app, not the reverse.
- Timing: H1+H3 can ship in the first wave alongside WP-F; H2 should land before
  the WP-B/WP-G UI work so coverage bars, the Pending section, and the drop zone
  are styled with the shared controls from day one.

## Impact on the main app (read before dispatching anything)

The admin's only interfaces to the editor are the exported JSON files and the image
files themselves. Nothing here touches editor code except WP-C. Concretely:

- **New `colorWeights` field is additive.** Editor consumers of `data/glitter.json`
  are exactly: `ContentManager.normalizeAsset` (defensive per-field defaults — unknown
  fields pass through, missing fields get defaults, so old editor + new JSON and new
  editor + old JSON both work), `AutoGlitterManager`'s swatch pool, and
  `MaskEditor`'s overlay tint (`colorCodes[0]`). No other code reads
  `colorCodes`/`hue`/`brightness`/`generatedName` in render or export paths — the
  GIF pixels the editor composites come from the image files, which this plan never
  modifies. **Exports (preview and GIF/MP4 output) are unaffected.**
- **Re-analysis changes swatch *metadata* for every asset.** After Bulk Analyze +
  Export: `colorCodes[0]` becomes the true dominant color (improves MaskEditor's
  overlay tint on glint-heavy assets), `generated_name` stops saying "White",
  `hue`/`brightness` shift toward honest values. Ryan's manual `name` and tags are
  untouched (analyze never writes `name`; tags only change if suggested + confirmed).
- **`has_transparency` fix can shrink the auto-glitter pool.** The full-pass
  detection (WP-A) may flip some assets from 0→1, and `hasTransparency` excludes an
  asset from auto-glitter suggestions. That's the flag doing its job, but expect a
  few assets to drop out of the pool after re-analysis — if a favorite disappears,
  check its flag before suspecting the matcher.
- **Auto-glitter suggestions change on two axes at once** (better swatch data ×
  coverage-weighted matching). If results look off after rollout, bisect: re-export
  with WP-C's `swatchCoverageBias` set to 0 first (isolates data change from matcher
  change).
- **Existing saved projects are safe.** `.glitter.json` project files reference
  glitters by id/url and store their own state; they don't embed swatch metadata.
  Pattern-tagged glitters remain fully usable manually — the tag only removes them
  from *automatic* suggestion.
- **Sticker changes are additive too.** `thumbnailUrl` pointing at real thumbs only
  changes what gallery cards download (layer creation still uses `url` — export
  pixels identical); analyzer-suggested color tags flow through the *existing* tag
  filter chips; `stickerText` search is a superset of current matches (Name Only
  mode unchanged). `data/stickers.json` gains no new required fields.
- **Nothing in WP-D/WP-E touches the editor at all.**
- **WP-H is the only work package besides WP-C that edits main-app files** (WP-C
  edits editor JS; WP-H edits editor styling) —
  `css/_components.scss` (extract the generic controls out), `css/style.scss` (one
  `@use 'controls'` line), and new `css/_controls.scss`. The guardrail is that the
  extraction must be a *pure move*: compile `style.css` before and after, and the
  only diff allowed is rule ordering that produces identical cascade — no visual
  change to the editor. If the compiled diff shows anything else, the extraction
  drew the line in the wrong place. The app's `.btn`/`.filter-chip`/`.switch`/
  `.tooltip` selectors and their output are unchanged; they just live in a partial
  both apps `@use`.
- **WP-G's `is_active` export filter is the one deliberate behavior change.**
  After it lands, inactive rows vanish from `data/*.json` on next export and the
  `isActive` field disappears from the payload (the editor's `normalizeAsset`
  defaults it to true, and the gallery never read it anyway — verified). Audit
  currently-inactive rows via the health report before that first export. This is
  what makes "unapproved" actually mean "invisible to users".

## Order & rollout

1. **WP-F** (shared-base unification — pure refactor + sticker metadata methodology;
   lands first so the coverage UI is built once in the base). **WP-H1+H3**
   (shared tokens/themes/mixins + theme sync) ship in this same first wave — pure
   styling, no logic, and every later UI (coverage bars, Pending section, drop
   zone) then inherits the app's look for free.
2. **WP-A + WP-B** land together (admin self-contained, no editor impact).
   **WP-H2** (shared `_controls.scss` + mixin adoption) lands before WP-B's
   coverage UI so it's styled with the shared controls from the start.
3. Ryan: **Bulk Analyze All → spot-check → Export JSON** for glitter (regenerates
   `data/glitter.json` with `colorWeights`); for stickers, walk the analyze modal on
   a batch to confirm suggested color tags, then Export.
4. **WP-C** (editor). Safe to land before step 3 thanks to the uniform-weights
   fallback, but suggestions only improve after re-export.
5. **WP-E before WP-G**: the Pending section builds on WP-E's fixed sidebar, and
   WP-G's `is_active` export filter needs WP-E's health report to audit inactive
   rows before the first filtered export.
6. **WP-G** (ingest pipeline) after WP-F + WP-A/B + WP-E — it leans on
   auto-analyze-on-add, `suggested_tags`, the `color_weights` migration file, and
   the health report.
7. WP-D whenever.

## Appendix — exact contracts & algorithm intent (read by every WP)

Codex: where this appendix conflicts with a WP summary above, the appendix wins.

### `color_weights` semantics

- Value = cluster pixels ÷ **opaque** pixels of the sampled frame(s), rounded to
  2 dp. Weights are **not renormalized** after thresholding — they may sum to < 1;
  the remainder is sub-threshold noise. Never emit a weight of 0.00 (floor 0.01).
- Parallel arrays, sorted by weight desc; `colorCodes[0]`/`colorWeights[0]` is the
  dominant color by definition. Sparkle clusters are included in both arrays (they
  are real coverage) — they are only excluded from *naming* and `color_value`.
- DB CSV example: `color_codes = "#E16871,#FFFFFF,#FF30E5"`,
  `color_weights = "0.62,0.14,0.09"`. Export: `colorWeights: [0.62, 0.14, 0.09]`.
- Editor/worker fallback when weights are missing or length-mismatched: uniform
  `1/n` per color (do this in AutoGlitterManager when building the swatch payload,
  once — the worker always receives a valid `weights` array).

### Cluster procedure (WP-A, deterministic — no random seeding)

1. One pass over opaque pixels: bucket key = `(r>>4, g>>4, b>>4)`, accumulate
   count and r/g/b sums per bucket.
2. Sort buckets by count desc. Greedy merge in that order: convert bucket centroid
   to Lab; if ΔE (CIE76 is fine — `colorUtils.deltaE`) to an existing cluster
   centroid < `cluster_merge_distance` (config, start 12), fold into it
   (count-weighted centroid update); else start a new cluster. Descending order
   makes dominant colors the merge anchors, so the result is stable run-to-run.
3. Classify sparkle: cluster Lab L > 92 and chroma (√(a²+b²)) < 10.
4. Keep clusters ≥ `color_threshold` % coverage, cap `max_colors`. If *nothing*
   passes (ultra-fragmented asset), keep the top 3 clusters regardless — an asset
   must never export an empty `colorCodes` while having opaque pixels.
5. Multi-frame (Imagick path): pool pixels from up to 3 evenly spaced frames
   *before* step 1 — one histogram, not three merged results.

### `suggested_tags` contract (analyze response only — never persisted directly)

```json
"suggested_tags": [
  { "tag_id": 14, "name": "Gold", "reason": "color 0.31" },
  { "tag_id": null, "name": "pattern", "reason": "4 hues >= 10%" }
]
```
`tag_id` resolves against the existing vocabulary (match cluster→tag `hex_color`
by smallest ΔE, accept < 25); `tag_id: null` means the tag doesn't exist yet — the
modal shows it greyed with "create tag first". The modal renders one checkbox per
entry, all **unchecked** in the plain analyze modal, **pre-checked** in the WP-G
pending-review flow (still requiring Save/Approve). Applying checked tags appends
to the asset's tag list; it never removes existing tags.

### Field-descriptor schema (WP-F)

```js
// Subclass declares; base renders both the editor form and the analyze modal.
static FIELDS = [
	{ key: 'name',        label: 'Name',        input: 'text',     section: 'basic' },
	{ key: 'is_animated', label: 'Animated',    input: 'checkbox', section: 'tech', analyze: { format: v => v ? 'Yes' : 'No' } },
	{ key: 'frame_rate',  label: 'Frame Rate (centiseconds)', input: 'number', section: 'tech', analyze: {} },
	// analyze: {} present = field appears in the analyze modal with an apply-checkbox.
];
```
`getAssetDataFromForm` and `applyAnalysis` become generic loops over `FIELDS`;
type-specific oddities (glitter's color preview row, sticker's image preview) are
named slots the subclass renders, not branches in the base.

### Worker matching formula (WP-C, replacing the current one)

For palette entry `E` vs swatch `S` with prepared Lab colors `S.colors[i]` and
weights `S.weights[i]`:

```
eligible(i)  = S.weights[i] >= swatchMinCoverage OR S.colors.length == 1
penal(i)     = 1 + swatchCoverageBias * (1 - S.weights[i])
closest      = argmin over eligible i of  d2(E.lab, S.colors[i]) * penal(i)
score        = d2(E.lab, S.colors[0]) * swatchPrimaryWeight
             + d2(E.lab, S.colors[closest]) * penal(closest) * (1 - swatchPrimaryWeight)
```

Best swatch = lowest score. Hue-tune (`getHueAdjustment`) keeps operating on the
chosen `closest` color, unchanged. With uniform weights and
`swatchCoverageBias = 0` this reduces exactly to today's behavior — that identity
is the regression test.

## Paste-ready Codex prompts

### WP-F prompt (dispatch first)

```
In admin/ of the glitter repo: unify the glitter and sticker admin per
docs/ADMIN-IMPROVEMENT-PLAN.md WP-F (read it first). Best practices, reuse code:
- Move the duplicated analyzeCurrentAsset/analyzeBulk/showAnalyzeModal/
  applyAnalysis logic from glitter_admin.js and sticker_admin.js into the
  AssetEditor base in asset_admin.js, driven by per-type field-descriptor arrays
  ({ key, label, format }) declared in each subclass.
- Drive both renderEditor forms from a shared field-schema renderer in the base
  (text/number/checkbox/select/tag-section primitives); subclasses declare schema
  only.
- Hoist addAsset into AssetAPI with a per-type insert-field map; auto-run
  performAnalysis + persistAnalysis on add for BOTH asset types (glitter currently
  skips it).
- Sticker analyze results: match dominant non-sparkle color clusters against the
  existing sticker tag vocabulary (tags have hex_color in the DB) by Lab distance
  and return them in suggested_tags; show as confirm-checkboxes in the analyze
  modal, never auto-applied. High sparkle coverage suggests the glitter/sparkly
  vibe tag when it exists. NOTE: if WP-A has not landed yet, build this against the
  current analyzer's color_codes output and leave a clearly named seam for cluster
  data.
- Generate static first-frame PNG thumbnails (max 128px, GD) at
  images/stickers/.thumbs/<id>.png on add/analyze; export as thumbnailUrl (editor
  already falls back to url — do not touch editor code).
Behavior of existing features must not change except as listed. LF endings, tabs,
comments state constraints not narration, no build step. Do not touch anything
outside admin/ and images/stickers/.thumbs/.
```

### WP-A+B prompt

```
In admin/ of the glitter repo: improve the glitter swatch analyzer and admin UI.
Best practices, reuse code, extract utils. Read docs/ADMIN-IMPROVEMENT-PLAN.md
sections WP-A and WP-B and implement both exactly as specified:
- Rewrite GifAnalyzer::extractColorData (admin/includes/gifAnalyzer.php) to use
  4-bit/channel bucketing + Lab-distance cluster merging, per-cluster coverage,
  sparkle classification (L>92, chroma<10; excluded from name/value, reported as
  sparkle_coverage), coverage-sorted output, optional Imagick multi-frame sampling
  (GD fallback), and a suggested_tags pattern heuristic. All thresholds in
  admin/includes/config.php.
- New admin/includes/colorUtils.php with rgbToHSV/rgbToLab/deltaE/hex helpers;
  move existing rgbToHSV there; delete dead getColorName/getColorNames.
- Add color_weights column (idempotent migration), plumb through assetAPI.php,
  getAssetSpecificFields, and formatAssetForExport (export key: colorWeights,
  parallel to colorCodes).
- Fix persistAnalysis: it currently discards color_codes/color_value/hue/
  generated_name — persist them (plus color_weights) behind an "include colors"
  checkbox on the Bulk Analyze confirm, default ON. Design: the AssetAPI base
  method stays technical-fields-only (the sticker table has no color columns);
  GlitterAPI overrides it to add the color fields.
- Extract a single assetFilePath($url) helper; GifAnalyzer takes the resolved path
  (today performAnalysis builds "../$url" AND "../../$url" for the same file).
- Detect GIF transparency from the full analyzer pixel pass, replacing the 20x20
  grid probe in performAnalysis.
- glitter_admin.js: show coverage % on swatch chips and in the analyze modal,
  suggested_tags as checkboxes (never auto-applied), keep color_weights in sync on
  manual color edits (uniform re-normalized when unknown).
- Convert Bulk Analyze to client-batched requests with progress in the status bar.
Constraints: LF endings, tabs, comments state constraints not narration, admin has
no build step. Do not touch anything outside admin/ — the editor-side changes are a
separate work package.
```

### WP-D prompt

```
In admin/ of the glitter repo, QOL pass per docs/ADMIN-IMPROVEMENT-PLAN.md WP-D:
move inline style="" attributes from glitter.php/sticker.php into
css/swatch_admin.scss (do not hand-edit swatch_admin.css — compile with npx sass),
show old vs proposed values side by side in the analyze modal, and add a status-bar
hint that data/glitter.json is stale after any save or bulk analyze until Export
JSON is clicked. LF endings, tabs, no build step.
```

### WP-E prompt

```
In admin/ of the glitter repo, hardening pass per docs/ADMIN-IMPROVEMENT-PLAN.md
WP-E: transactions around delete-asset/saveAssetTags/reorder with batched
multi-VALUES tag inserts; fix the exportAssets N+1 with one JOINed tag query;
dirty-state confirm (per-field tracking in the shared asset_admin.js base +
beforeunload) before switching assets with unsaved edits; sidebar text filter over
name/category/tags; back up data/*.json to data/backup/ (keep last 3) before
saveExport/saveCategoriesExport overwrite; a Health report on index.php listing
missing files, orphaned files, and duplicate URLs. Also the sidebar/drag-sort
fixes from the WP-E bullet list: honor showRecentSection, recent items
non-draggable, saveOrder scoped to category-items with a duplicate-id assert,
drag constrained within its own category group, details open-state persisted in
localStorage, category item counts, arrow-key navigation. Do not change any
exported JSON field or touch anything outside admin/ except creating data/backup/.
LF endings, tabs, no build step.
```

### WP-G prompt (after WP-F and WP-A+B)

```
In admin/ of the glitter repo: build the upload + approval ingest pipeline per
docs/ADMIN-IMPROVEMENT-PLAN.md WP-G and its Appendix (read both fully first).
- New CSRF-checked upload action in includes/api.php: multipart POST, magic-byte
  validation (GIF/PNG/JPEG only), upload_max_bytes cap in config.php, slugified
  collision-suffixed filenames, md5 file_hash duplicate rejection (file_hash
  column via idempotent migration, backfilled during Bulk Analyze), file written
  to images/<type>/<category-slug>/.
- Ingest: insert row is_active=0, run the existing auto-analyze-on-add, prefill
  name from generated_name (glitter) or cleaned filename (sticker).
- Sidebar: pinned "Pending" section with count badge listing is_active=0 assets;
  selecting one opens the normal editor with suggested_tags pre-checked (not
  saved); Approve button = save + is_active=1; Reject = confirm, delete row+file.
- exportAssets gains WHERE is_active=1 and drops isActive from the payload (Ryan
  approved this behavior change; the health report lists inactive rows to audit).
- Multi-file: drop zone over the sidebar (highlight, category picker, sequential
  uploads with per-file status) and multiple on the add-modal file input; keep
  the URL-only add path working unchanged.
Human gates are the point: never auto-activate, never auto-export. LF endings,
tabs, comments state constraints not narration, no build step. Touch nothing
outside admin/ and images/.
```

### WP-H prompt (H1+H3 with the first wave; H2 before WP-B/WP-G UI)

```
In the glitter repo: unify admin styling with the main app per
docs/ADMIN-IMPROVEMENT-PLAN.md WP-H (read it fully first).
- H1: admin/css/swatch_admin.scss @use's ../../css/tokens, themes, mixins; delete
  its own color variables and replace with ONE :root compat bridge mapping every
  legacy admin var name to an app token; move the admin-only spacing/typography
  scales to admin/css/_admin-tokens.scss. Do not add spacing/font ramps to the
  app's tokens.
- H2: extract .btn family, .filter-chip, .switch, .tooltip from
  css/_components.scss into css/_controls.scss, @use'd by both entrypoints with
  the compiled style.css diff being a pure move (verify by compiling before and
  after); restyle admin buttons/headers/modals via the gloss-button, bar-base,
  and mini-modal mixins; migrate admin rules off the legacy var names section by
  section and delete the bridge when empty. Leave the Windows-7 mixin block
  untouched.
- H3: inline script in the <head> of admin/glitter.php, sticker.php, index.php
  (before the stylesheet link): read localStorage glitterEditorSettings, apply
  interfaceTheme to document.documentElement.dataset.theme, fallback 'dark'.
NEVER hand-edit css/style.css or admin/css/swatch_admin.css — compile with
npx sass. LF endings, tabs, comments state constraints not narration. Outside
admin/, only css/_controls.scss, css/style.scss (the @use line), and
css/_components.scss (the extraction) may change.
```

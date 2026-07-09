# Glitter Editor — System Audit

**Date:** 2026-07-02 · **Scope:** full codebase (~20k lines: `js/`, `admin/`, `process/`, `index.html`, `css/`, `data/`)

> ⚠️ **Do not deploy this `docs/` folder to production.** This document describes unpatched security issues (notably the unauthenticated admin API). Keep it out of the web root on ryandavi.com until Critical items are fixed.

---

## Executive Summary

This is a well-featured vanilla-JS editor with genuinely good instincts — manager classes, a `ContentManager` base class, a central `CONFIG` object, delegation via `LayerTransform`. But it's carrying heavy iteration residue: **two features that silently do nothing** (frame skip, reverse export), **an unauthenticated admin API that can delete DB rows and write files**, an entire **dead backend endpoint** (`process/submit.php`), a **dead class file**, **two parallel admin implementations** for the same concept, **two tooltip systems initialized on the same elements**, a **debug console (eruda) shipped to production users**, and ~100 `console.log`s including ones firing on every touchmove.

The single biggest architectural theme: **the same concept represented two ways** — glitter admin vs sticker admin, `glitter.json` (camelCase) vs `stickers.json` (snake_case), `CONFIG.allowedStickerTypes` vs a hardcoded list in `validateUpload`, `exportFrameSkip` vs `frameSkip`. Every bug in the "silently broken" category traces back to this. The two-year fix is not a rewrite; it's picking one canonical form for each concept and deleting the other.

---

## Critical

### C1. Admin API has zero authentication
- **Location:** `admin/includes/api.php`, `admin/glitter.php`, `admin/sticker.php` — no session, no password, no `.htaccess` anywhere in the repo
- **Problem:** Anyone who can reach `/admin/includes/api.php` can delete assets (`action=delete`), rewrite categories, and trigger `saveExport()` / `saveCategoriesExport()`, which `file_put_contents` into the public `data/*.json` — letting an attacker replace the content the live app serves. Config references `https://ryandavi.com`, so this is intended for production.
- **Why it matters:** Remote content tampering + data destruction with a single curl command.
- **Fix:** Minimum: HTTP Basic Auth or `.htaccess` deny on `/admin`. Better: session login gate included at the top of `api.php`. Also migrate string-built SQL to prepared statements (the `escape()`-based interpolation in `admin/includes/assetAPI.php:48` is one missed escape away from injection).
- **Effort:** 1–3h (auth) + 3h (prepared statements) · **Risk:** Low · **Dispatch:** Codex (Goal 1)

### C2. Frame Skip and Reverse export settings are silently ignored
- **Location:** `js/classes/GifExporter.js:289` reads `exportSettings.frameSkip`; `:300` reads `exportSettings.reverse` — but app.js stores these as `exportFrameSkip` and `exportReverse` (`js/app.js:575-576`)
- **Problem:** Property-name mismatch → both features permanently `undefined` → skip=1, reverse=false. UI, persistence, and validation all work; the export never sees them.
- **Fix:** Change the two reads in GifExporter (2-line fix), or rename the `exportSettings` properties everywhere.
- **Effort:** 15 min · **Risk:** Low · **Dispatch:** Fable

### C3. eruda debug console + unpinned CDN scripts served to all users
- **Location:** `index.html:2366-2367` (eruda + `eruda.init()`), `index.html:2337-2338` (omggif from unpkg, gif.js from cdnjs, no SRI)
- **Problem:** Every visitor boots a full devtools overlay. Core GIF decode/encode depends on three third-party CDNs with no integrity attributes and no fallback. Note the inconsistency: `gif.worker.js` is self-hosted but the encoder is remote.
- **Fix:** Remove eruda (or gate behind `?debug=1`). Vendor `omggif.js` and `gif.js` locally.
- **Effort:** 30 min · **Risk:** Low · **Dispatch:** Fable

### C4. `process/submit.php` — dead endpoint with real vulnerabilities
- **Location:** `process/submit.php` — referenced by **nothing** in index.html, js/, or modals/
- **Problem:** 381 lines of artwork-upload backend no frontend calls. Contains: CORS origin check bypassable by prefix (`strpos($origin, 'https://ryandavi.com') === 0` matches `https://ryandavi.com.evil.com`, line 62), rate limiting keyed on spoofable `X-Forwarded-For` / `Client-IP` (lines 106–114), and a third copy of the DB credentials.
- **Fix:** Delete the file (and its DB tables) unless the gallery feature is on the roadmap. If keeping: exact-match CORS, trust only `REMOTE_ADDR`, shared config.
- **Effort:** 5 min to delete · **Risk:** Low (verify nothing external posts to it) · **Dispatch:** Fable

---

## High

### H1. Duplicate admin systems for the same concept
- **Location:** `admin/js/swatch_admin.js` (1,170 lines, legacy `GlitterEditor`) vs `admin/js/asset_admin.js` (768 lines, generic `AssetEditor`) + `sticker_admin.js`. `glitter.php` loads the legacy one; `sticker.php` loads the new one.
- **Problem:** The generic `AssetEditor` abstraction was built, stickers migrated, glitter never migrated. Every admin bugfix needs doing twice; the pages already drift (cache headers, list ordering, ID conventions).
- **Fix:** Create `glitter_admin.js` extending `AssetEditor`, point `glitter.php` at it, delete `swatch_admin.js`. Net ~900 lines deleted.
- **Effort:** 4–6h · **Risk:** Medium · **Dispatch:** Codex (Goal 2)

### H2. GlitterAPI and StickerAPI are ~80% copy-paste
- **Location:** `admin/includes/glitterAPI.php` vs `stickerAPI.php` — `performGlitterAnalysis` / `performStickerAnalysis` are byte-identical (~70 lines each); `update`, `delete`, `reorder`, `analyze`, `analyzeAll` differ only in method names and the ID column.
- **Fix:** Move generic methods into `AssetAPI` parameterized by `$this->assetType` and `getAssetSpecificFields()` (which already exists); child classes keep `formatAssetForExport` + field definitions. Collapse `api.php`'s per-type if/else.
- **Effort:** 3–4h · **Risk:** Medium · **Dispatch:** Codex (bundle with Goal 1)

### H3. Two data schemas for the same concept (glitter vs stickers JSON)
- **Location:** `glitterAPI.php:22-43` emits camelCase (`isAnimated`); `stickerAPI.php:16-35` emits snake_case (`is_animated`). Each frontend manager has its own bespoke mapping (`GlitterManager.js:151-176`, `StickerManager.js:140-170`).
- **Why it matters:** The exact class of mismatch that caused C2. Four mapping sites to keep in sync forever.
- **Fix:** camelCase canonical everywhere; one `normalizeAsset()` in `ContentManager`; re-export both JSON files.
- **Effort:** 2–3h · **Risk:** Medium · **Dispatch:** Codex (bundle with Goal 2)

### H4. Dead and broken code inventory (frontend)
- `js/classes/TextLayerManager.js` — never loaded by index.html; references `LayerType.TEXT` and `generateId()` which don't exist. Delete (git history keeps it for the future text feature).
- `randomizeGlitter()` (`GlitterManager.js:305-338`) — never called; throws `ReferenceError: oldIndex` if it ever were. Delete.
- `updatePreviewScale()` (`GlitterManager.js:422-441`) — queries `.glitter-bg-layer`, a class nothing creates. Guaranteed no-op called on **every** `updatePreview()` (`app.js:4053`). Delete both.
- `handleCanvasZoomClick()` (`app.js:3819-3848`) — never called; obsolete scroll-based pan model. Delete.
- `CONFIG.autoSwitchAfterPick` (`app.js:3923`) and `CONFIG.siteName` (`GifExporter.js:1435`) — read but never defined. The second produces share text **"Created with undefined"** on iOS. Add both to CONFIG.
- `getSectionDisplayName` defined **twice** (`app.js:763` and `:775`) — identical; delete one.
- `GlitterEditor.init()` re-creates `this.stickerManager` (`app.js:514`) though the constructor already made one — first instance becomes garbage. Remove the re-creation.
- `this.isMobile` on `GlitterEditor` is **never assigned** — `setupMobileClickProtection()` (`app.js:1407`) always returns immediately; mobile branches in `handlePreviewContainerClick` (`app.js:3611`, `:3638`) are dead. Either delete the protection system (mobile works via `TouchGestureHandler`'s synthetic events) or wire to `this.mobileManager.isMobile`. **Judgment call → Fable.**
- `_analyzeColors()` and unused `isLocal` in GifExporter. Delete.
- **Effort:** 2h · **Risk:** Low · **Dispatch:** Codex (Goal 3), `isMobile` decision in Fable

### H5. Tooltip system initialized twice on every element
- **Location:** `utils.js:454` creates a global `tooltipManager`; `app.js:4263` creates a **second** `new TooltipManager()` in the boot IIFE.
- **Problem:** Every `[data-tooltip]` element gets duplicate listeners; the managers fight via `dismissAll`. Also `initTooltipsInContainer` (`utils.js:456-485`) duplicates `attachTooltipListeners` (the `_tooltipInitialized` guard exists in one but not the other). Same story for `initPixelScaler` vs `initPixelScalerInContainer` (`utils.js:94-158`).
- **Fix:** Delete the app.js instantiation; deduplicate the paired functions (keep the container versions; global versions delegate).
- **Effort:** 45 min · **Risk:** Low · **Dispatch:** Fable

### H6. `app.js` is a 4,271-line god class with no module system
- **Location:** `js/app.js` — `GlitterEditor` owns tools, history, export orchestration, settings persistence, hints, modal wiring, canvas events, color picking, DOM sync for three layer types. 15 `<script>` tags with load-order coupling; everything global.
- **Fix (incremental):** (1) Extract `CONFIG` / `LayerType` / `ToolType` / `LAYER_UI_CONFIG` into `js/config.js`. (2) Extract history into `HistoryManager`. (3) Extract export-settings persistence into `SettingsManager`. (4) Extract the hint system. Then ES modules to kill script-order fragility.
- **Effort:** 1–2 days across PRs · **Risk:** Medium · **Dispatch:** Codex per-extraction (Goal 4)

---

## Medium

### M1. Feather blur is O(w·h·r²)
- `GlitterManager.js:559-579` — nested box blur, recomputed per layer per preview update. 800×800 at feather 10 ≈ 280M ops. Replace with separable two-pass running-sum box blur → ~100× faster, identical output.
- **Effort:** 1h · **Risk:** Low · **Dispatch:** Codex (Goal 3)

### M2. Masks rebuilt from scratch on every preview update
- `GlitterManager.js:363-420` — every `updatePreview()` clears all glitter elements, re-runs selection matching/flood-fill for every layer, and round-trips a full-canvas base64 `toDataURL()` for the CSS mask.
- **Fix:** Cache the mask per layer keyed on `(selections, threshold, feather, contiguous, invert)`; rebuild only the changed layer's element; use `toBlob` + object URL instead of base64.
- **Effort:** 3–4h · **Risk:** Medium · **Dispatch:** Codex (Goal 3)

### M3. `loadStickerSettings` runs on every mousemove during drag
- `LayerTransform.js:331-333` (+ touch handlers) — ~15 `getElementById` + DOM writes per pointer event. Throttle to rAF or sync only position fields during drag.
- **Effort:** 30 min · **Risk:** Low · **Dispatch:** Fable

### M4. `hasActiveFilters()` always returns true
- `ContentManager.js:302-313` — an empty `Set` passes `val !== null && val !== '' && val !== false`. Clear-filters button never disables. Handle Sets exclusively before the scalar check.
- **Effort:** 10 min · **Risk:** Low · **Dispatch:** Fable

### M5. History/undo edge cases
- `clearImage()` (`app.js:3347`) empties layers but never resets `history`/`historyIndex` — Undo after clearing restores layers for a removed image.
- `saveSettingsToStorage` (`app.js:523-537`) never persists `exportBaseImage` though `initializeExportSettings` reads it.
- `loadImage` never calls `URL.revokeObjectURL` (`app.js:3556`), no `img.onerror`. (`StickerManager.destroy()` does it right — and is itself never called.)
- **Effort:** 1h · **Risk:** Low · **Dispatch:** Fable

### M6. Sticker upload validation contradicts CONFIG
- `StickerManager.js:207-223` hardcodes `validTypes` (no webp) and 10MB; `CONFIG.allowedStickerTypes` still lists `image/webp` and `CONFIG.maxStickerUploadSize` says 5MB. Two of four values are lies. `validateUpload` should read exclusively from CONFIG.
- **Effort:** 15 min · **Risk:** Low · **Dispatch:** Fable

### M7. `console.log` shipping in hot paths
- ~100 logs; `TouchGestureHandler.js` logs multiple lines **per touchmove**; `AssetBrowser.js:468-475` logs per scroll batch. Add a `dbg()` helper gated on `CONFIG.debug`.
- **Effort:** 1–2h · **Risk:** Low · **Dispatch:** Codex (Goal 3)

### M8. Exporter mutates the shared glitter cache
- `GifExporter.js:828` — `_deoptimizeAnimatedFrames` replaces `glitter.frames.frames` (app-wide cache) with flattened frames of a *different shape* (`.data` vs `.imageData`), relying on `isFlattened` flags and dual-shape handling at every consumer.
- **Fix:** Flatten into a local map used only within the export; delete the flags.
- **Effort:** 2h · **Risk:** Medium (verify by exporting twice in a row) · **Dispatch:** Codex (Goal 3)

### M9. `renderLayersList()` full re-render on every state change
- `LayerManager.js:485-525` rebuilds all layer DOM; `updateMobileLayersSwatch` (`:982`) runs a full `canvas.toDataURL()` per render. Reuse elements for active-state changes (`reorderLayerItems()` already exists as the cheap path); cache the base-image thumbnail once per image load.
- **Effort:** 2h · **Risk:** Low · **Dispatch:** Codex (Goal 3)

---

## Low

- **`updateAssetInfo` clone-to-remove-listeners hack** (`app.js:974`): use one delegated click handler on the container instead.
- **`debouncedSliderUpdate(sliderType)` ignores its argument** (`app.js:3433`).
- **Zoom clamp duplication:** pinch hardcodes `0.1`/`16` (`ViewportManager.js:408`) — derive from `CONFIG.zoomLevels`.
- **`LAYER_MARGIN_BOTTOM`/`INSERTION_LINE_HEIGHT` duplicated** (`LayerManager.js:1061-1063` and `:1237-1239`).
- **Leftover AI-collab comments:** `// ADD THIS`, `// CORRECTED`, `// FIXED`, `// BOO`, commented-out blocks (`LayerManager.js:683-694`), and the copy-pasted `<span class="name">About</span>` inside every layer drag handle (`LayerManager.js:674`).
- **`setupContainerEvents` dead dragover math** (`LayerManager.js:43-52`).
- **Indentation chaos** in app.js — a Prettier pass would have caught the duplicate-method bug.
- **Duplicate `<body>` tag** in `admin/index.php:12-13`.
- **`ModalManager.closeTopModal`** iterates insertion order, not stack order (harmless today; rename or track a stack).
- **Watermark fetched twice** (`GifExporter.js:1035` then `_parseGifWithMetadata` re-fetches; its second argument is ignored).

---

> **Status 2026-07-02:** All Fable-designated items below are DONE (C2, C3, C4, H4 deletions + isMobile dead-branch removal, H5, M4, M5, M6, M3 throttle, interim admin `.htaccess`, plus the minimal sticker-export poison fix — `serializeSticker` resets `isFlattened`, `cloneLayer` no longer shares frames). **All four Codex Goals (1–4) are also DONE and verified** — admin auth/CSRF/prepared statements (Goal 1), admin unification onto `AssetEditor` + camelCase schema (Goal 2), dead-code/perf pass incl. the full flatten-into-local-map export refactor (Goal 3), and app.js config/history extraction (Goal 4). Verification was static (grep, `node --check`, `php -l`) plus a Playwright-driven smoke test of the frontend against the local XAMPP instance; the admin backend (PHP) isn't live-tested since it isn't served with PHP execution where this repo is hosted (GitHub) — auth/CSRF wiring was verified by reading the code and confirming response codes against the local XAMPP instance instead.

## Quick Wins

1. Fix C2 (frameSkip/reverse property names) — 2 lines, restores two features.
2. Remove eruda + self-host the two CDN libs (C3).
3. Delete dead code: `TextLayerManager.js`, `randomizeGlitter`, `updatePreviewScale` + call site, `handleCanvasZoomClick`, `_analyzeColors`, duplicate `getSectionDisplayName`, double `StickerManager` construction, second `TooltipManager`. ~400 lines gone, zero behavior change.
4. Add `siteName`, remove `autoSwitchAfterPick` branch — fixes "Created with undefined".
5. Fix `hasActiveFilters` Set handling (M4).
6. Point `validateUpload` at CONFIG (M6).
7. Separable feather blur (M1) — biggest perf win per line changed.
8. `.htaccess`/Basic Auth on `/admin` — closes C1's front door while the real fix is pending.

## Larger Refactors

1. **Admin unification** (H1+H2+C1): auth gate → merge APIs into `AssetAPI` → migrate glitter admin to `AssetEditor` → delete `swatch_admin.js`. Net ~1,200 lines deleted.
2. **Canonical asset schema** (H3): camelCase everywhere, one `normalizeAsset()`, re-export JSON.
3. **app.js decomposition** (H6): config → history → settings → hints, one extraction per PR, ES modules at the end.
4. **Mask caching + targeted layer re-render** (M2+M9).

## Things That Should Not Be Refactored Yet

- **`ViewportManager.js`** — cleanest class in the codebase; correct anchor-point zoom math. Leave alone.
- **`ModalManager.js`** — small, coherent.
- **TouchGestureHandler's state machine** — encodes hard-won device behavior (pinch→pan handoff, orphan cleanup). Strip logging, don't restructure.
- **GifExporter's disposal analysis & frame-sync heuristics** (`_deoptimizeAnimatedFrames`, `_smartReduceFrames`, `_findSafeTransparencyKey`) — tuned against real GIFs; don't rewrite without a regression corpus.
- **LAYER_UI_CONFIG / ASSET_TYPE_CONFIG** — the right data-driven pattern; extend, don't replace.

## Technical Debt

- Three copies of DB credentials — consolidate to one config outside webroot.
- `data/*.json` are a manual DB export ("Save Export" = human cache invalidation). Document it, or serve JSON from the API with caching eventually.
- No tests. Cheapest first targets: `createMaskForLayer`, `floodFill`, `_smartReduceFrames`, `_findSafeTransparencyKey`, `isPointInSticker`.
- `TextLayer` feature clearly planned (`LayerTransform` already supports `textData`) — should land via `LAYER_UI_CONFIG` + `ContentManager`.
- `index.html` at 2,373 lines — extract the SVG icon sheet and modal shells into fetched partials (mechanism exists via `externalContentUrl`).
- Adopt Prettier + pre-commit hook.

## Configuration (magic numbers to promote)

| Variable | Current value | Where it lives now | Move to | Controls | Why |
|---|---|---|---|---|---|
| `maxStickerUploadSize` | 10MB hardcoded vs 5MB in CONFIG | `StickerManager.js:216` | `CONFIG.maxStickerUploadSize` | Upload rejection | Two contradictory values today |
| `stickerScaleMin/Max` | 10/500 hardcoded ×3 | `LayerTransform.js:446-447`, `:904-905` | `CONFIG.stickerHandles.minScale/maxScale` (already defined, unused!) | Scale clamping | Config exists but code ignores it |
| `tapThreshold` / `tapMaxDuration` | 10px / 300ms | `TouchGestureHandler.js:28`, `:277` | `CONFIG.touch` | Tap-vs-drag feel | Prime mobile tuning knob |
| `batchSize` / `bufferZone` / `searchDebounce` | 20 / 400px / 300ms | `AssetBrowser.js:12`, `:465`, `:405` | `CONFIG.browser` | Lazy-load pacing | Perf tuning shouldn't require code search |
| `zoomClampMin/Max` (pinch) | 0.1 / 16 | `ViewportManager.js:408` | derive from `CONFIG.zoomLevels` | Pinch zoom range | Desyncs if zoomLevels change |
| `errorToastDuration` | 5000ms | `app.js:4240` | `CONFIG.ui` | Toast lifetime | UX tuning |
| `ignoreClickDelay` | 100ms / 150ms (inconsistent) | LayerTransform ×3 sites | `CONFIG.ui.ignoreClickDelay` | Post-drag click suppression | Inconsistent values = inconsistent feel |
| `exportQualityMin/Max`, `frameDelayMin` | 1–30, 20ms | `app.js:4115-4131`, GifExporter | `CONFIG.export` | Validation bounds | Balancing exports |
| `sizeWarnings` table | Discord/Twitter limits | `GifExporter.js:55-60` | `CONFIG.export.sizeWarnings` | Warning badges | Platform limits are data |
| `siteName`, `exportFileName` | undefined / hardcoded | GifExporter | `CONFIG` | Branding | `siteName` is currently a bug |

---

## Codex Tasks

### Goal 1 — Secure and harden the admin backend

```
/goal Secure the PHP admin backend of the glitter editor at c:\xampp\htdocs\glitter.

OBJECTIVE
Add authentication to the admin area and convert all SQL to prepared statements. No behavior change for authenticated users.

FILES
- admin/includes/api.php (entry point, no auth today)
- admin/includes/database.php (thin mysqli wrapper)
- admin/includes/assetAPI.php, glitterAPI.php, stickerAPI.php (string-interpolated SQL)
- admin/index.php, admin/glitter.php, admin/sticker.php (pages)
- NEW: admin/includes/auth.php, admin/login.php, admin/logout.php

EXACT CHANGES
1. Create admin/includes/auth.php: session-based guard. requireAuth() checks $_SESSION['admin_authed']; if absent, for api.php return HTTP 401 JSON {"error":"unauthorized"}, for pages redirect to login.php. Password verified with password_verify() against a hash stored in a new admin/includes/credentials.php (gitignored; ship credentials.example.php). Add session_regenerate_id(true) on login, CSRF token stored in session and required (X-CSRF-Token header) for all mutating actions (update/delete/add/reorder/save_export/save_categories_export/add_category/delete_category/update_category/add_tag/delete_tag).
2. Include requireAuth() at the top of api.php, glitter.php, sticker.php, index.php.
3. database.php: add prepare($sql, $types, $params) helper returning mysqli_stmt results; keep query() temporarily for SELECTs without params.
4. Rewrite every query in assetAPI.php/glitterAPI.php/stickerAPI.php to use prepared statements with bound params. Table/column names come only from the $CONFIG['asset_types'] whitelist (never from request input) — assert the asset type key exists before use.
5. Update admin/js/asset_admin.js, swatch_admin.js, sticker_admin.js fetch() calls to send the CSRF token header (emit it into the page as a JS constant from PHP).

CONSTRAINTS
- Do not change any API response shapes.
- PHP 7.4+ compatible, no Composer dependencies.
- Do not touch anything outside admin/.

ACCEPTANCE CRITERIA
- Unauthenticated GET to admin/includes/api.php?action=list&type=glitter returns 401.
- After login, all existing admin flows (list, edit, save, delete, reorder, analyze, export, save_export, categories, tags) work identically.
- grep confirms no request-derived value is ever interpolated into SQL strings.
- Mutating action without CSRF header returns 403.
```

### Goal 2 — Unify the duplicate admin systems and asset schema

```
/goal Consolidate the duplicated glitter/sticker admin implementations in c:\xampp\htdocs\glitter\admin and unify the exported JSON schema.

CONTEXT
- sticker.php uses the generic AssetEditor (admin/js/asset_admin.js) + sticker_admin.js subclass.
- glitter.php still uses a legacy standalone GlitterEditor (admin/js/swatch_admin.js, 1170 lines) that predates AssetEditor.
- GlitterAPI and StickerAPI (admin/includes/) duplicate ~80% of their code; performGlitterAnalysis and performStickerAnalysis are identical.
- glitter.json exports camelCase keys; stickers.json exports snake_case. The frontend (js/classes/GlitterManager.js loadContent, js/classes/StickerManager.js loadContent) maps each separately.

EXACT CHANGES
1. PHP: move updateAsset, deleteAsset, addAsset, reorderAssets, analyzeAsset, analyzeAllAssets, performAnalysis into AssetAPI (admin/includes/assetAPI.php), driven by getAssetSpecificFields() and $this->assetType for ID column names (glitter_id vs sticker_id etc.). Child classes keep only constructor, formatAssetForExport, getAssetSpecificFields, and truly type-specific logic (sticker sort_order-reset-on-category-change). Update api.php switch to call the unified method names (no per-type if/else).
2. Schema: change StickerAPI::formatAssetForExport to emit camelCase matching GlitterAPI (isAnimated, hasTransparency, frameCount, frameRate, isVariableFramerate, fileSize, sortOrder, stickerText, thumbnailUrl). Re-run save_export for both types to regenerate data/stickers.json.
3. Frontend: update js/classes/StickerManager.js loadContent to read the camelCase keys. Add a shared normalizeAsset(raw, defaults) in js/classes/ContentManager.js used by both managers. Also update js/app.js updateAssetInfo's use of asset.sticker_text → asset.stickerText.
4. Admin JS: create admin/js/glitter_admin.js extending AssetEditor (mirror sticker_admin.js structure: thumbnail render, type-specific editor fields including color_codes, hue, is_pixelated, generated_name, analysis UI). Point glitter.php at asset_admin.js + glitter_admin.js. Delete admin/js/swatch_admin.js.
5. Align glitter.php page markup with sticker.php structure (same container IDs the AssetEditor config expects).

CONSTRAINTS
- Preserve all current admin capabilities for glitter (edit fields, tags, categories, analyze, analyze-all, reorder, export buttons).
- data/glitter.json output must be byte-compatible with current format (it already is camelCase).
- The main editor app (index.html + js/) must keep working against regenerated JSON — test by loading the app and placing one glitter fill and one sticker.

ACCEPTANCE CRITERIA
- swatch_admin.js deleted; glitter admin fully functional through AssetEditor.
- GlitterAPI.php and StickerAPI.php each under ~120 lines.
- data/stickers.json regenerated in camelCase; app loads stickers, search/filters/categories work, sticker placement works.
- No remaining references to snake_case sticker fields in js/ (grep is_animated, has_transparency, frame_count, sticker_text under js/).
```

### Goal 3 — Dead code removal + performance pass (frontend)

```
/goal Dead-code removal and performance cleanup in the glitter editor frontend at c:\xampp\htdocs\glitter (vanilla JS, no build system).

EXACT CHANGES — deletions (verify zero references before each, then delete):
1. js/classes/TextLayerManager.js (not loaded by index.html; references undefined LayerType.TEXT).
2. GlitterManager.randomizeGlitter (js/classes/GlitterManager.js:305-338; never called, contains undefined `oldIndex`).
3. GlitterManager.updatePreviewScale (queries `.glitter-bg-layer` which nothing creates) AND its call in js/app.js updatePreview.
4. GlitterEditor.handleCanvasZoomClick (js/app.js ~3819), duplicate getSectionDisplayName (keep one, js/app.js ~763 vs ~775), the CONFIG.autoSwitchAfterPick branch in glitterFillSelector, GifExporter._analyzeColors and the unused isLocal const.
5. In GlitterEditor.init (js/app.js ~514): remove `this.stickerManager = new StickerManager(this)` (constructor already created it); keep `await this.stickerManager.init()`.
6. In the boot IIFE (js/app.js end): remove `const tooltips = new TooltipManager()` — utils.js already creates the global instance.
7. Add to CONFIG: siteName: 'ryandavi.com glitter editor' (used by GifExporter share text).

EXACT CHANGES — performance:
8. GlitterManager.applyFeatherToMask: replace the O(r²) per-pixel box blur with a separable two-pass running-sum box blur (horizontal then vertical) over the Uint8Array mask. Identical parameters/output semantics.
9. Mask caching: add layer._maskCache = { key, mask } where key = JSON.stringify([layer.selections, settings.threshold, settings.feather, settings.contiguous, settings.invert]). createMaskForLayer returns the cached mask on key match.
10. Introduce js/debug.js with `const dbg = (...a) => { if (CONFIG.debug) console.log(...a); }` loaded before other scripts; replace all console.log calls in js/ (except console.error/warn) with dbg(). TouchGestureHandler.js and AssetBrowser.js are the priority (they log per-touchmove/per-scroll).
11. LayerManager.updateMobileLayersSwatch: cache the base-image toDataURL once per image load instead of re-encoding the canvas on every layers-list render.
12. LayerTransform: throttle the editor.loadStickerSettings calls in mouse/touch move handlers to requestAnimationFrame (latest-wins).
13. GifExporter._deoptimizeAnimatedFrames: write flattened frames into a local Map(layerId/glitterId → frames) consumed by _renderFrame/_renderLayerToCanvas via a parameter, instead of mutating glitter.frames.frames on the shared library. Remove the isFlattened flags.

CONSTRAINTS
- No behavior changes visible to users (except things getting faster and share text no longer saying "undefined").
- Scripts are plain <script> tags; maintain global-scope compatibility (no ES module conversion in this task).
- Manual verification flow: load an image, color-pick a glitter fill, adjust feather slider (should be smooth), add an animated sticker, export a GIF twice in a row (second export must still be correct — this exercises change #13), test on the touch emulator (no console spam).

ACCEPTANCE CRITERIA
- grep finds no references to the deleted symbols.
- Feather slider at radius 10 on an 800x800 image updates without visible freeze.
- Two consecutive exports of the same composition produce equivalent GIFs.
- console is silent during normal use with CONFIG.debug=false.
```

### Goal 4 — First app.js extractions (config + history)

```
/goal Extract configuration and history management out of the 4,271-line js/app.js in c:\xampp\htdocs\glitter. Plain scripts, no bundler.

EXACT CHANGES
1. Create js/config.js containing: CONFIG, LayerType, ToolType, LAYER_UI_CONFIG, ASSET_TYPE_CONFIG, DEBUG_CONFIG — moved verbatim from js/app.js. Load it first in index.html (before utils.js).
2. Create js/classes/HistoryManager.js: class HistoryManager { constructor(editor, limit = CONFIG.historyLimit) } owning history[], historyIndex, and methods saveState(), restoreState(state), undo(), redo(), reset(initialState), updateButtons() — moved from GlitterEditor (saveState/restoreState/undo/redo/updateHistoryButtons plus the inline history-reset block inside loadImage → historyManager.reset(...)). Serialization of layers stays as-is (delegates via editor reference).
3. In GlitterEditor: replace this.history/this.historyIndex with this.historyManager; keep thin undo()/redo() delegating methods. Update beforeunload check (historyIndex > 0 → this.historyManager.canUndo()).
4. Update index.html script order: config.js, utils.js, debug.js (if present), then classes, then app.js.

CONSTRAINTS
- Zero behavior change. Undo/redo must work identically for: glitter selections, sticker move/scale/rotate, layer add/delete/reorder/visibility, and after image load (history resets to a single baseline state).
- Do not convert to ES modules; keep globals.

ACCEPTANCE CRITERIA
- js/app.js shrinks by roughly 400+ lines; no references to this.history / this.historyIndex remain in app.js outside the delegating methods.
- Manual test: load image → add glitter fill with 2 selections → add sticker → move sticker → undo x4 returns to baseline (buttons disable correctly) → redo x4 restores → export still works.
```

---

**Suggested sequencing:** Quick Wins 1–6 in Fable (under an hour total), then Goal 1 (security, independent), Goal 3 (cleanup — reduces noise before bigger moves), Goal 2, Goal 4.

---

## Appendix: "Stickers sometimes don't export" — root cause (2026-07-02)

**Symptom:** animated stickers intermittently missing from the exported GIF (preview looks fine), or the whole export fails with a toast; hard to reproduce; "simple changes fully ruin it."

### The invariant that breaks

Sticker frames exist in **two shapes**, and the exporter's frame renderer only accepts one of them:

1. **Raw parse shape** — `GlitterManager.parseGifFromUrl()` returns frames as `{ imageData: ImageData, disposal, x, y, ... }`.
2. **Flattened shape** — `GifExporter._deoptimizeAnimatedFrames()` converts them to `{ data: ImageData, width, height }` and sets `layer.stickerData.isFlattened = true`.

`_renderLayerToCanvas` (`GifExporter.js:97-104`) checks `frame instanceof ImageData`, then `frame.data instanceof ImageData`, else **logs and silently returns** — i.e. the sticker is skipped for every frame. Raw-shape frames (`.imageData`) match **neither branch**. So a sticker only renders in export if `_deoptimizeAnimatedFrames` ran on its current frames — and the *only* thing guarding that is the `isFlattened` boolean.

### How the flag goes stale

`StickerManager.serializeSticker()` (`:632-654`) — called by `saveState()` on **every user action** — spreads `...layer.stickerData` into the history snapshot, nulling `frames` and `element` **but preserving `isFlattened`**. `restoreState()` makes the snapshot object the live layer. So:

```
t0  add animated sticker            → snapshot S0 {isFlattened: false, frames: null}
t1  EXPORT                          → live layer: frames=flattened, isFlattened=true (no saveState)
t2  move the sticker (any edit)     → snapshot S1 {isFlattened: TRUE, frames: null}   ← poison
t3  edit again                      → snapshot S2 {isFlattened: TRUE, frames: null}
t4  UNDO (lands on S1)              → live layer: isFlattened=true, frames=null
t5  EXPORT
      _loadMissingFrames: frames=null → re-parses → RAW shape (.imageData)
      _deoptimizeAnimatedFrames: isFlattened=true → SKIPPED
      _renderLayerToCanvas: raw shape matches neither branch → silent return
      → sticker absent from every frame of the GIF
```

Two failure presentations from the same state, depending on export settings:
- **Transparency inactive** (typical opaque image): sticker **silently missing**; export "succeeds". (`console.error '[GifExporter] Invalid sticker frame format'` fires — GifExporter's `config.debug` is `true` — but nobody's watching the console.)
- **Transparency active:** `_findSafeTransparencyKey` (`GifExporter.js:430`) does `frame.data.data || frame.data` → `frame.data` is `undefined` on raw frames → TypeError → **entire export fails** with a toast.

### Why it feels random

- Trigger requires the sequence: **export → any edit → undo/redo landing on a post-export snapshot → export**. Never undo? Never breaks.
- Once poisoned, it's sticky: the restored layer keeps `isFlattened: true`, every subsequent snapshot inherits it, and **every future export of that sticker is broken** until the sticker is replaced (`addStickerToCanvas` replace path is the only code that resets the flag, `StickerManager.js:437`). Hence "simple changes can fully ruin it."
- Only **animated** stickers break: static stickers' `staticImageData` survives serialization (it's not nulled), and glitter never breaks because its frames + `isFlattened` live on the shared `glitterManager.content` item, which history snapshots never touch.
- `cloneLayer` (`LayerManager.js:586`) copies `isFlattened` and shares the `frames` **reference** with the source — a second way for flag and frame-shape to disagree.

### Fix (= audit Goal 3 item 13, now upgraded from "cleanup" to "bug fix")

Root cause is *state about a cache stored in the document*. Remove the flag entirely:

1. `_deoptimizeAnimatedFrames` writes flattened frames into a **local `Map(layerId → frames)`** scoped to the export run; never mutate `stickerData.frames` / the glitter library; delete `isFlattened` everywhere (the frame-shape if/else in `_renderLayerToCanvas` then has exactly one input shape and the dead branches go away).
2. `cloneLayer`: set `frames: null` on the clone (it reloads on demand) instead of sharing the reference.
3. Defense in depth: make `_renderLayerToCanvas`'s unmatched-shape branch **throw** instead of silently returning — a missing sticker should fail the export loudly, not ship a wrong GIF.
4. While in there: `gif.on('error')`/`gif.on('abort')` currently `throw` inside event callbacks (uncatchable → stuck progress bar + permanently disabled export button). Route them to the existing error path (`hideExportProgress`, re-enable button, toast).
5. Minor: `_loadStaticImage(url, width, height)` sizes the canvas from stored metadata but draws the image unscaled — if metadata ≠ natural size (user uploads before analysis completes default to 100×100), the exported sticker is cropped. Use `img.naturalWidth/Height` for the canvas and let the transform handle display size.

**Manual repro to verify the fix:** load image → add animated sticker → export → move sticker → undo → export again → sticker must appear in the second GIF.

# Glitter admin

The PHP and MySQL back office that manages the glitter and sticker libraries, the font, shape and brush manifests, and exports them as the JSON the editor loads from `data/`. It runs on local XAMPP only.

## Setup

1. XAMPP with Apache, PHP and MySQL. The app is served from `http://localhost/glitter/`, and the admin from `http://localhost/glitter/admin/`.
2. Database settings are in `admin/includes/config.php`. Defaults: host `127.0.0.1`, user `root`, empty password, database `glitter`.
3. Copy `admin/includes/credentials.example.php` to `credentials.php` and set a bcrypt password hash. The file explains how to generate one. `credentials.php` must never be committed.
4. `admin/.htaccess` restricts the whole admin directory to local requests. Keep it that way unless it is replaced with real HTTP authentication.

**Schema.** The base asset tables (glitter, stickers, categories, tags) are not created by anything in the repository; they come from an existing local database. `AdminMigrations::run` (`includes/adminMigrations.php`) runs on every database connection and adds the newer columns, indexes, workflow tables and sticker facets idempotently. Put new schema changes there, as idempotent checks, never as one-off SQL.

## Pages

| Page | Manages |
|---|---|
| `index.php` | Dashboard: health, recent activity, export status |
| `glitter.php`, `sticker.php` | The glitter and sticker libraries: upload and ingest review, analysis, tags, categories, attribution, variants |
| `fonts.php`, `shapes.php`, `brushes.php` | The `data/fonts.json`, `data/shapes.json` and `data/brushes.json` manifests (shared page code in `includes/manifestAdminPage.php`) |

The pages call one JSON endpoint, `includes/api.php`, which dispatches on an `action` parameter to `GlitterAPI` or `StickerAPI`. Both extend the shared `AssetAPI` (`includes/assetAPI.php`). Page scripts live in `admin/js/`, and styles in `admin/css/` (compiled from `swatch_admin.scss`, which shares tokens through `_admin-tokens.scss`).

## Services

| File | Responsibility |
|---|---|
| `assetAPI.php` | Asset CRUD, analysis, ingest approval, and the JSON export |
| `assetIngestService.php`, `ingestPreview.php` | The upload and approval pipeline. Only active assets in published categories (`is_active`) are exported; an unpublished root also hides its sets. |
| `gifAnalyzer.php`, `colorClassifier.php`, `colorUtils.php`, `assetAnalysisResult.php` | GIF palette analysis, color naming and color tags. Weights come from `data/rendering-rules.json`. |
| `tagTaxonomyService.php` | Tags, aliases and merges |
| `assetHealthService.php`, `assetVariantService.php`, `assetPathService.php`, `assetNaming.php` | Health scans, multi-resolution sticker variants, file paths, generated names |
| `manifestLibraryService.php`, `manifestApi.php` | Font, shape and brush manifest editing |
| `exportStateService.php`, `adminEventService.php` | Export freshness tracking and the activity log |
| `auth.php` | Sessions, CSRF tokens, and login rate limiting |

## Exporting to the editor

The dashboard's export writes, for each asset type:

- the full manifest (`data/glitter.json`, `data/stickers.json`);
- a lightweight browse index (`*.index.json`), which the editor loads at boot;
- per-asset detail files (`data/glitter/`, `data/stickers/`), which the editor loads when an asset is selected;
- the category files (`*-categories.json`).

Each export first writes a timestamped backup to `data/backup/`, which is git-ignored. Don't hand-edit the generated files. If only a full manifest changed, `node tools/split-manifests.js` regenerates the index and detail files.

## Tests

The PHP contract tests run through the shared runner: `node tests/run.js --tag admin`. They cover the color classifier, the export contract, the workflow, and the manifest library. `npm run lint` also lints `admin/js`.

## Stretchable stickers

The sticker editor's Slice section stores four independent insets in base-image pixels and a Stretch/Round mode. Number fields and draggable image guides stay synchronized; wide and tall sample boxes use the editor's shared `js/paint/nine-slice.js` geometry. Disable Stretchable to save `null`. Insets must be nonnegative integers and leave a nonempty center; at least one inset must be positive. Sibling variants keep the same base-pixel metadata. Exports put the full slice record in asset details and only the `sliced` boolean in the browse index.

## Asset sets and provenance

Glitter and sticker categories support two levels. Their Published switch controls category `is_active`; unpublishing preserves asset rows, files, tags and attribution. Category exports omit inactive categories and children of inactive roots; full manifests, browse indexes and detail files omit their assets. The normal export cleanup removes stale omitted detail files. Health scans still inspect unpublished assets for file and analysis issues; they do not require an export entry. A style root has no `parent_id`; its child categories are sets. Roots can also own assets directly. The API rejects self-parenting, parents that already have a parent, and giving a parent to a category with children. Categories with children cannot be deleted. Parent changes do not move assets: each asset's home category slug remains its flat folder.

Category attribution accepts `authorId` and `sourceId` from `content/entities.json` alongside the existing display text. The category manager offers identity datalists and root-only parent choices. Attribution inherits from an asset's home category to that asset; it never inherits from a style root to a child set.

Exports include category `parent` as a slug or null, while `count` remains the category's own active assets. Asset `original_order` exports as `originalOrder` in the full manifest, browse index and detail record, and appears read-only beside Original name in admin. Its migration backfills sourced assets from `sort_order` once when adding the column; later sorting and import reruns preserve it. New sourced imports write the source order. Asset `original_name` and `appearances` export as `originalName` and an ordered list of `{set, originalName}`. Original names are read-only in the editor; appearances are import facts. Both are in the browse index for search and lineage. `search_terms` stores per-asset old library names retained by source imports, merged with tag aliases on export.

Source sets can be standalone style roots by using a null `parent` in the import map. Import reruns preserve the inactive status of tiles already in their mapped home, so an unpublished sourced tile stays unpublished.

Assets also support an optional JSON `attribution` override, exported in the full manifest, browse index and detail record. Item attribution wins over category attribution in the editor. The six Christmas tiles belong directly to Classic Sparkle and carry Aylana's credit individually; Christmas is not a separate published set.

Appearances name other sets where the image was published. Alternate filenames within the asset's own set become search aliases, so a set never lists its own tile again in the carried-over row.

`php admin/tools/import-glitter-sources.php` previews the source reorganization using `data/admin-incoming/glitter-sources-map.json`. It makes no writes by default, including schema migrations. The report lists category changes, all proposed moves and removals, unregistered files, wrong-folder records, lineage and per-set totals. `--map <path>` uses an alternate mapping. Review the report before `--apply`, which requires a clean git tree. Apply backs up the database, glitter images and both libraries' full/index/category exports under `data/backup/`, then uses the normal ingest analysis and approval path for sourced assets. Unknown files enter review without approval. Existing ids, tags and analysis are retained when matching records are re-homed; duplicate tags and library-name aliases are merged. Mica precedes Dan, then Aylana, then unsourced copies. The two existing credited sticker categories gain identity ids during this import. Keep the data reorganization in a separate commit from its code.

Local CLI ingest uses `AssetIngestService::receiveLocalFile`; it shares upload format, size, analysis and thumbnail checks, but copies a local file into the incoming queue. HTTP uploads continue to require `is_uploaded_file`.

An alternate mapping may list `deferredFiles` as exact paths relative to the glitter root. These files are reported as deferred and left untouched, including when they match another source. Use this for an asset awaiting repair; remove the deferral when it is ready.

GIF analysis and thumbnails tolerate historical files whose logical-screen header is smaller than their frames. The analyzer reads GIF block boundaries for the true dimensions and supplies corrected header bytes to GD in memory; imported source files and their byte hashes remain unchanged.

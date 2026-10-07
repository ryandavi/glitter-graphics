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

A glitter or sticker category row is one of two kinds, chosen by Kind in the category manager (`is_set`):

- A **style** is what an asset is filed in: one per asset, required. It is the folder a new upload lands in and the list the asset is ordered in.
- A **set** is a creator's collection. An asset points at zero or one through `set_id`, the Set select beside Category. A set holds no assets of its own, spans styles, supplies the credit, and appears in the editor as a filter inside each style that has its tiles.

A row can change kind only while no asset uses it, and cannot be deleted while any asset is filed in it or points at it. Moving an asset to another style keeps its set.

A style's Published switch controls `is_active`; unpublishing preserves asset rows, files, tags and attribution. Exports omit an inactive style and its assets from the category file, full manifest, browse index and detail files, and the normal export cleanup removes the stale detail files. Sets are always exported. Health scans still inspect unpublished assets for file and analysis issues; they do not require an export entry.

A file's folder is where it was first filed and says nothing about its style: health does not compare them, and the category manager lists a folder as unregistered only when none of its files has a record. Renaming a category's slug renames its folder and repoints every record whose file is in it.

**Category covers.** Pick one to four asset previews in the category manager. The ordered `previews` list stores asset ids, so covers follow file renames. With no selected previews, cards use the first four ordered members; unavailable previews are skipped. A Custom image path (`icon`) overrides the asset grid with one contained image. Export excludes inactive assets and assets in unpublished styles from preview ids. Raster brush covers derive from `packs[]` and its ordered brushes in `brushes.json`; there is no separate brush category manifest.

**Textures.** The Textures style contains 25 static, smoothly scaled Office JPG tiles, credited through the Microsoft Office Textures set. They use the existing glitter fill pipeline, including scale, offset and anchor. Their license remains unknown; the category credit records that redistribution rights have not been established.

**Order.** `sort_order` inside a style is the order the editor shows, as exported. Arrange, on each category heading in the asset list, opens that category as a tile grid: drag a tile, or focus one and hold Alt with the arrow keys, then Save order. Show set dims the other sets without removing them. For glitter, Sort by color proposes a rainbow order (multicolor and pattern tiles last) from `admin/js/glitter_color_order.js`; nothing is written until Save. Saving one category leaves every other category's order alone.

**Credit.** Attribution accepts `authorId` and `sourceId` from `content/entities.json` alongside the display text. An asset's credit is its own override, else its set's, else its style's. Glitter styles carry none; sticker categories that are one creator's work (`ryandavi`, `twitter`) still do.

**Export.** The category file lists styles, then sets marked `"kind": "set"`. A style's `count` is its published assets; a set's is the published assets pointing at it, in published styles. Each asset exports `category` (its style) and, when it has one, `set`. Asset `original_order` exports as `originalOrder` in the full manifest, browse index and detail record, and appears read-only beside Original name in admin; sorting and import reruns preserve it. Asset `original_name` and `appearances` export as `originalName` and an ordered list of `{set, originalName}`. Original names are read-only in the editor; appearances are import facts. Both are in the browse index for search and lineage. `search_terms` stores per-asset old library names retained by source imports, merged with tag aliases on export.

**Source import.** `admin/tools/import-glitter-sources.php` reads `data/admin-incoming/glitter-sources-map.json`: `styles`, `sources` (the sets) and `sections` (source folders, each naming its set and the style its new tiles start in). It creates missing styles and sets and leaves existing rows as they are. A tile already imported keeps its style, order and published state on a rerun, so refiling a tile by hand is safe; a second dry run reports every file as kept. `admin/tools/migrate-style-and-set.php` is the one-time move from child-category sets to this model and does nothing once it has run.

Assets also support an optional JSON `attribution` override, exported in the full manifest, browse index and detail record. Item attribution wins over category attribution in the editor. Use it for a real one-off; a tile from a set needs none.

Appearances name other sets where the image was published. Alternate filenames within the asset's own set become search aliases, so a set never lists its own tile again in the carried-over row.

`php admin/tools/import-glitter-sources.php` previews the source reorganization using `data/admin-incoming/glitter-sources-map.json`. It makes no writes by default, including schema migrations. The report lists category changes, all proposed moves and removals, unregistered files, wrong-folder records, lineage and per-set totals. `--map <path>` uses an alternate mapping. Review the report before `--apply`, which requires a clean git tree. Apply backs up the database, glitter images and both libraries' full/index/category exports under `data/backup/`, then uses the normal ingest analysis and approval path for sourced assets. Unknown files enter review without approval. Existing ids, tags and analysis are retained when matching records are re-homed; duplicate tags and library-name aliases are merged. Mica precedes Dan, then Aylana, then unsourced copies. The two existing credited sticker categories gain identity ids during this import. Keep the data reorganization in a separate commit from its code.

Local CLI ingest uses `AssetIngestService::receiveLocalFile`; it shares upload format, size, analysis and thumbnail checks, but copies a local file into the incoming queue. HTTP uploads continue to require `is_uploaded_file`.

An alternate mapping may list `deferredFiles` as exact paths relative to the glitter root. These files are reported as deferred and left untouched, including when they match another source. Use this for an asset awaiting repair; remove the deferral when it is ready.

GIF analysis and thumbnails tolerate historical files whose logical-screen header is smaller than their frames. The analyzer reads GIF block boundaries for the true dimensions and supplies corrected header bytes to GD in memory; imported source files and their byte hashes remain unchanged.


## Font category preview icons

Font source is the existing System font checkbox (`system` boolean), separate from style tags. Editor Source filters read that field. Category representatives come from the first ordered/featured member; no separate category-icon setting is needed.

After adding or replacing fonts, regenerate dropdown glyph outlines with `python tools/build-font-preview-icons.py`, then `node tools/bump-cache.js`. This tool reads the manifest without changing it, uses the editor's script-aware sample rules, and writes `js/generated/font-preview-icons.js`. It requires fontTools and brotli plus Node. System outlines come from Windows Fonts by default; `--system-font-dir` selects another installed-font directory. An unavailable system face is omitted and gets a live-lettering fallback in the editor. `--check` verifies the generated output on the same font environment. Home-card phrases and individual font samples still load the actual font; dropdown SVGs do not.

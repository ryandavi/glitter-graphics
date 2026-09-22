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
| `assetIngestService.php`, `ingestPreview.php` | The upload and approval pipeline. Only active assets (`is_active`) are exported. |
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

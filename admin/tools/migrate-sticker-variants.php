<?php
// One-time cleanup for docs/STICKER-MULTI-RESOLUTION-PLAN.md's "Migration"
// section. Run once from the CLI:
//
//   php admin/tools/migrate-sticker-variants.php
//
// No dry run, per the plan's own decision — every rename and DB update is
// logged as it happens; back up images/stickers/ and the `stickers` table
// first if you want a rollback path. Safe to re-run: phase 1 skips rows that
// no longer match `_256.<ext>` or already have variants, and phase 2 skips
// files that have already been moved to their destination.

if (php_sapi_name() !== 'cli') {
    fwrite(STDERR, "This script is CLI-only.\n");
    exit(1);
}

require_once(__DIR__ . '/../includes/config.php');
require_once(__DIR__ . '/../includes/database.php');
require_once(__DIR__ . '/../includes/assetPathService.php');
require_once(__DIR__ . '/../includes/assetVariantService.php');
require_once(__DIR__ . '/../includes/adminEventService.php');
require_once(__DIR__ . '/../includes/exportStateService.php');
require_once(__DIR__ . '/../includes/tagTaxonomyService.php');
require_once(__DIR__ . '/../includes/assetAnalysisResult.php');
require_once(__DIR__ . '/../includes/assetNaming.php');
require_once(__DIR__ . '/../includes/assetHealthService.php');
require_once(__DIR__ . '/../includes/assetIngestService.php');
require_once(__DIR__ . '/../includes/assetAPI.php');
require_once(__DIR__ . '/../includes/stickerAPI.php');

function migLog($message)
{
    echo '[' . date('H:i:s') . '] ' . $message . "\n";
}

$db = new Database($CONFIG);
$paths = new AssetPathService($CONFIG);
$variants = new AssetVariantService($CONFIG);

// ============================================
// Phase 1: drop the `_256` suffix from every `<id>_256.<ext>` file under the
// managed sticker root, registered or not — the plan calls for renaming ALL
// of them; a DB row only gets updated when one actually references the file.
// ============================================
migLog('Phase 1: dropping `_256` suffix from every matching file on disk...');
$phase1Count = 0;
$root = $paths->managedRoot('sticker');
$phase1Iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
foreach ($phase1Iterator as $file) {
    if (!$file->isFile() || strpos($file->getPathname(), DIRECTORY_SEPARATOR . '.thumbs' . DIRECTORY_SEPARATOR) !== false) continue;
    $filename = $file->getFilename();
    $extension = pathinfo($filename, PATHINFO_EXTENSION);
    if (!preg_match('/^(.+)_256\.' . preg_quote($extension, '/') . '$/', $filename, $match)) continue;
    $newFilename = $match[1] . '.' . $extension;
    $directory = dirname($file->getPathname());
    $newFile = $directory . DIRECTORY_SEPARATOR . $newFilename;
    if (is_file($newFile)) {
        migLog("  WARN {$filename}: target {$newFilename} already exists, skipping");
        continue;
    }
    $oldUrl = $paths->fileToUrl($file->getPathname(), 'sticker');
    if (!rename($file->getPathname(), $newFile)) {
        migLog("  ERROR {$filename}: rename failed");
        continue;
    }
    $newUrl = $paths->fileToUrl($newFile, 'sticker');
    $stmt = $db->prepare('SELECT id FROM stickers WHERE url = ? LIMIT 1', 's', [$oldUrl]);
    $matchedRow = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if ($matchedRow) {
        $stmt = $db->prepare('UPDATE stickers SET filename = ?, url = ?, updated_at = NOW() WHERE id = ?', 'ssi', [$newFilename, $newUrl, (int)$matchedRow['id']]);
        $stmt->close();
        migLog("  OK #{$matchedRow['id']}: {$filename} -> {$newFilename} (DB row updated)");
    } else {
        migLog("  OK {$filename} -> {$newFilename} (not registered yet — file renamed only)");
    }
    $phase1Count++;
}
migLog("Phase 1 done: {$phase1Count} file(s) renamed.");

// ============================================
// Phase 2: merge images/stickers_11616-21442/* into the matching category
// folder. Each source id's base file (`<id>.<ext>`) already lives somewhere
// under images/stickers/ — phase 1 renamed it, this run or an earlier one,
// whether or not it's registered yet. Every other file for that id (`_512`,
// `_1024`, `_raw`, ...) is measured with getimagesize(), renamed to its
// actual width, and moved next to that base; the delivered label is never
// trusted as the size. If the base is already a registered row, its
// `variant_urls` is updated too; if not, the files just wait next to the
// base for whenever it's added — addAsset() auto-detects siblings on add.
// ============================================
$stagingDir = realpath(__DIR__ . '/../../images/stickers_11616-21442');
if ($stagingDir && is_dir($stagingDir)) {
    migLog('Phase 2: merging images/stickers_11616-21442/ into the library...');
    $bySourceId = [];
    foreach (scandir($stagingDir) as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        if (!preg_match('/^(\d+)_(\d+|raw)\.([a-zA-Z0-9]+)$/', $entry, $match)) {
            migLog("  WARN unexpected file in staging dir: {$entry}, skipping");
            continue;
        }
        [, $sourceId, $label, $extension] = $match;
        $bySourceId[$sourceId][] = ['file' => $stagingDir . DIRECTORY_SEPARATOR . $entry, 'label' => $label, 'extension' => $extension];
    }

    $phase2Attached = 0;
    $phase2Skipped = 0;
    foreach ($bySourceId as $sourceId => $files) {
        $extension = $files[0]['extension'];
        $baseFile = null;
        foreach (glob($root . DIRECTORY_SEPARATOR . '*' . DIRECTORY_SEPARATOR . $sourceId . '.' . $extension) as $candidateBase) {
            $baseFile = $candidateBase;
            break;
        }
        if (!$baseFile) {
            migLog("  WARN source id {$sourceId}: no base file `{$sourceId}.{$extension}` found anywhere under images/stickers/, skipping its variants");
            $phase2Skipped += count($files);
            continue;
        }
        $categoryDirectory = dirname($baseFile);
        $baseUrl = $paths->fileToUrl($baseFile, 'sticker');
        $stmt = $db->prepare('SELECT id, variant_urls FROM stickers WHERE url = ? LIMIT 1', 's', [$baseUrl]);
        $baseRow = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        $existingVariants = $baseRow ? $variants->decodeVariantUrls($baseRow['variant_urls']) : [];
        $changed = false;
        foreach ($files as $candidate) {
            if ($candidate['label'] === '256') {
                // Duplicate of the file that's already the live base — discard it
                // so the staging directory actually empties out.
                if (unlink($candidate['file'])) {
                    migLog("  skip {$sourceId}_256.{$extension}: superseded by the base file, removed from staging");
                } else {
                    migLog("  WARN {$sourceId}_256.{$extension}: couldn't remove redundant staging copy");
                }
                continue;
            }
            $dimensions = @getimagesize($candidate['file']);
            if (!$dimensions) {
                migLog("  WARN {$sourceId}_{$candidate['label']}: unreadable image, skipping");
                continue;
            }
            $width = (int)$dimensions[0];
            $height = (int)$dimensions[1];
            $destFilename = "{$sourceId}_{$width}.{$extension}";
            $destFile = $categoryDirectory . DIRECTORY_SEPARATOR . $destFilename;
            if (is_file($destFile)) {
                migLog("  WARN {$sourceId}_{$candidate['label']}: {$destFilename} already exists at destination, skipping");
                continue;
            }
            if (!rename($candidate['file'], $destFile)) {
                migLog("  ERROR {$sourceId}_{$candidate['label']}: move failed");
                continue;
            }
            $destUrl = $paths->fileToUrl($destFile, 'sticker');
            $existingVariants[(string)$width] = ['url' => $destUrl, 'width' => $width, 'height' => $height];
            migLog("  OK {$sourceId}_{$candidate['label']}.{$extension} -> {$destFilename} (measured {$width}x{$height})");
            $phase2Attached++;
            $changed = true;
        }
        if ($baseRow && $changed) {
            $stmt = $db->prepare('UPDATE stickers SET variant_urls = ?, updated_at = NOW() WHERE id = ?', 'si', [$variants->encodeVariantUrls($existingVariants), (int)$baseRow['id']]);
            $stmt->close();
        }
    }
    migLog("Phase 2 done: {$phase2Attached} variant file(s) attached, {$phase2Skipped} skipped (no base match).");

    $remaining = array_diff(scandir($stagingDir), ['.', '..']);
    if (!$remaining) {
        rmdir($stagingDir);
        migLog('Removed now-empty staging directory.');
    } else {
        migLog('Staging directory still has ' . count($remaining) . ' leftover file(s) — left in place for manual review.');
    }
} else {
    migLog('Phase 2: images/stickers_11616-21442/ not found, skipping merge.');
}

// ============================================
// Re-export so the rename/variant changes reach data/stickers*.json.
// saveExport() writes with paths relative to admin/includes/, so match cwd.
// ============================================
migLog('Re-exporting data/stickers.json, data/stickers.index.json, data/stickers/*.json...');
chdir(__DIR__ . '/../includes');
$api = new StickerAPI($db, $CONFIG);
$api->saveExport();
migLog('Export complete. Migration finished.');

<?php

// Detects size variants of an asset that live next to it on disk, per
// docs/STICKER-MULTI-RESOLUTION-PLAN.md's naming convention: the canonical
// file has no suffix ("11616.png"), any variant carries "_<label>"
// ("11616_512.png"). The label in the filename is never trusted as the real
// size — every candidate is measured with getimagesize() and the result is
// keyed by that measured width, so a mislabeled file can't corrupt the data.
class AssetVariantService
{
    private $paths;

    public function __construct($config)
    {
        $this->paths = new AssetPathService($config);
    }

    // Returns ['baseStem' => ..., 'label' => ...] if $filename looks like
    // "<base>_<digits>.<ext>", or null if it carries no numeric suffix at all
    // (sanitized library filenames use underscores between words too, so only
    // a *trailing all-digit* segment counts as a variant label).
    public function parseVariantFilename($filename)
    {
        $stem = pathinfo((string)$filename, PATHINFO_FILENAME);
        if (preg_match('/^(.+)_(\d+)$/', $stem, $match)) {
            return ['baseStem' => $match[1], 'label' => $match[2]];
        }
        return null;
    }

    public function baseFileExists($directory, $baseStem, $extension)
    {
        return is_file($directory . DIRECTORY_SEPARATOR . $baseStem . '.' . $extension);
    }

    // Scans the directory containing $url for sibling variant files of the
    // asset at $url, returning a map keyed by measured pixel width matching
    // the `variant_urls` column shape:
    // {"512": {"url":..., "width":512, "height":512}}.
    public function detectSiblingVariants($url, $assetType)
    {
        $file = $this->paths->urlToFile($url, $assetType);
        $directory = dirname($file);
        if (!is_dir($directory)) return [];
        $baseStem = pathinfo($file, PATHINFO_FILENAME);
        $extension = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        $variants = [];
        foreach (scandir($directory) as $entry) {
            if ($entry === '.' || $entry === '..') continue;
            if (strtolower(pathinfo($entry, PATHINFO_EXTENSION)) !== $extension) continue;
            $parsed = $this->parseVariantFilename($entry);
            if (!$parsed || $parsed['baseStem'] !== $baseStem) continue;
            $path = $directory . DIRECTORY_SEPARATOR . $entry;
            $dimensions = @getimagesize($path);
            if (!$dimensions) continue;
            $width = (int)$dimensions[0];
            $variants[(string)$width] = [
                'url' => $this->paths->fileToUrl($path, $assetType),
                'width' => $width,
                'height' => (int)$dimensions[1],
            ];
        }
        return $variants;
    }

    public function decodeVariantUrls($json)
    {
        $decoded = json_decode((string)$json, true);
        return is_array($decoded) ? $decoded : [];
    }

    public function encodeVariantUrls($variants)
    {
        return $variants ? json_encode($variants, JSON_UNESCAPED_SLASHES) : null;
    }
}

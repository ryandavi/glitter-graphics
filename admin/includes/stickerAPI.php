<?php
require_once('assetAPI.php');

// ============================================
// STICKER-SPECIFIC API
// ============================================
class StickerAPI extends AssetAPI
{
    public function __construct($db, $config)
    {
        parent::__construct($db, $config, 'sticker');
    }

    protected function formatAssetForExport($asset, $tags, $searchTerms = [])
    {
        // Same resolution as glitter: a human override wins over the
        // analyzer's observation. Tags stay the gallery's filter surface;
        // this palette is machine data for masks, matching, and future use.
        $palette = $this->effectivePalette($asset);
        return [
            'id' => (int)$asset['id'],
            'name' => $asset['name'],
            'filename' => $asset['filename'],
            'url' => $asset['url'],
            'thumbnailUrl' => $asset['url'],
            'category' => $asset['category_slug'],
            'attribution' => $asset['attribution'] ?? null,
            'stickerText' => $asset['sticker_text'] ?? null,
            'tags' => $tags,
            'searchTerms' => $searchTerms,
            'colorCodes' => array_values(array_column($palette, 'hex')),
            'colorWeights' => array_values(array_map('floatval', array_column($palette, 'weight'))),
            'paletteType' => $this->paletteTypeState($asset)['type'],
            'isAnimated' => (int)$asset['is_animated'],
            'hasTransparency' => (int)$asset['has_transparency'],
            'isPixelated' => (int)($asset['is_pixelated'] ?? 1),
            'width' => (int)($asset['width'] ?? 0),
            'height' => (int)($asset['height'] ?? 0),
            'frameCount' => (int)($asset['frame_count'] ?? 0),
            'frameRate' => (int)($asset['frame_rate'] ?? 10),
            'isVariableFramerate' => (int)$asset['is_variable_framerate'],
            'fileSize' => (int)($asset['file_size'] ?? 0),
            'sortOrder' => (int)($asset['sort_order'] ?? 0),
        ];
    }

    protected function getAssetSpecificFields()
    {
        return [
            'string' => ['name', 'filename', 'url', 'attribution', 'sticker_text', 'file_hash', 'palette_type_override'],
            'int' => ['sticker_category_id', 'width', 'height', 'frame_count', 'frame_rate', 'file_size', 'sort_order'],
            'float' => [],
            'bool' => ['is_animated', 'has_transparency', 'is_active', 'is_variable_framerate', 'is_pixelated'],
        ];
    }

    protected function getNullableStringFields()
    {
        return ['attribution', 'sticker_text', 'palette_type_override'];
    }

    protected function getUpdateExtraAssignments($data)
    {
        if (array_key_exists('sticker_category_id', $data)) {
            return ['sort_order = 0'];
        }

        return [];
    }

    protected function getAddFieldMap()
    {
        return [
            'name' => ['type' => 's'],
            'filename' => ['type' => 's'],
            'url' => ['type' => 's'],
            'sticker_category_id' => ['type' => 'i', 'source' => 'category_id', 'default' => 1],
            'attribution' => ['type' => 's', 'default' => null],
            'is_pixelated' => ['type' => 'i', 'default' => 1],
            'is_active' => ['type' => 'i', 'default' => 1],
        ];
    }

}

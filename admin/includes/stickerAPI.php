<?php
require_once('assetAPI.php');
require_once(__DIR__ . '/assetVariantService.php');

// ============================================
// STICKER-SPECIFIC API
// ============================================
class StickerAPI extends AssetAPI
{
    private $variants;

    public function __construct($db, $config)
    {
        parent::__construct($db, $config, 'sticker');
        $this->variants = new AssetVariantService($config);
    }

    // Any `_<width>` sibling files already sitting next to a sticker's base
    // file are auto-attached as variants on add — no per-variant review step.
    // See docs/STICKER-MULTI-RESOLUTION-PLAN.md.
    public function addAsset($data)
    {
        if (!array_key_exists('variant_urls', $data) && !empty($data['url'])) {
            $detected = $this->variants->detectSiblingVariants($data['url'], $this->assetType);
            $data['variant_urls'] = $this->variants->encodeVariantUrls($detected);
        }
        return parent::addAsset($data);
    }

    public function attachDetectedVariants($id)
    {
        $asset = $this->getAssetUrlById((int)$id);
        if (!$asset) throw new InvalidArgumentException('Asset not found');
        $detected = $this->variants->detectSiblingVariants($asset['url'], $this->assetType);
        $stmt = $this->db->prepare(
            "SELECT variant_urls FROM {$this->tables['table']} WHERE id = ?",
            'i',
            [(int)$id]
        );
        $row = $this->fetchOneAssoc($stmt->get_result());
        $stmt->close();
        $existing = $this->variants->decodeVariantUrls($row['variant_urls'] ?? null);
        $merged = array_merge($existing, $detected);
        $this->updateAssetRecord((int)$id, ['variant_urls' => $this->variants->encodeVariantUrls($merged)], ['updated_at = NOW()']);
        $this->events->record($this->assetType, (int)$id, 'variants_attached', ['variants' => array_keys($detected)]);
        $this->exportState->markDirty($this->assetType);
        return ['success' => true, 'variant_urls' => $merged];
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
            'attribution' => $this->decodeAttribution($asset['attribution'] ?? null),
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
            // Not in formatAssetForBrowseIndex's allowlist, so this only
            // reaches the per-sticker detail file, not the slim index.
            'variantUrls' => $this->variants->decodeVariantUrls($asset['variant_urls'] ?? null),
        ];
    }

    protected function getAssetSpecificFields()
    {
        return [
            'string' => ['name', 'filename', 'url', 'attribution', 'sticker_text', 'file_hash', 'palette_type_override', 'variant_urls'],
            'int' => ['sticker_category_id', 'width', 'height', 'frame_count', 'frame_rate', 'file_size', 'sort_order'],
            'float' => [],
            'bool' => ['is_animated', 'has_transparency', 'is_active', 'is_variable_framerate', 'is_pixelated'],
        ];
    }

    protected function getNullableStringFields()
    {
        return ['attribution', 'sticker_text', 'palette_type_override', 'variant_urls'];
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
            'variant_urls' => ['type' => 's', 'default' => null],
        ];
    }

}

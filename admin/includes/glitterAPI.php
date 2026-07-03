<?php
require_once('assetAPI.php');

// ============================================
// GLITTER-SPECIFIC API
// ============================================
class GlitterAPI extends AssetAPI
{
    public function __construct($db, $config)
    {
        parent::__construct($db, $config, 'glitter');
    }

    protected function formatAssetForExport($asset, $tags)
    {
        $colorCodes = [];
        if (!empty($asset['color_codes'])) {
            $colorCodes = array_map('trim', explode(',', $asset['color_codes']));
        }

        return [
            'id' => (int)$asset['id'],
            'url' => $asset['url'],
            'name' => $asset['name'],
            'generatedName' => $asset['generated_name'],
            'brightness' => $asset['color_value'],
            'sortOrder' => (int)($asset['sort_order'] ?? 0),
            'hue' => $asset['hue'] ? (float)$asset['hue'] : null,
            'colorCodes' => $colorCodes,
            'frameCount' => (int)($asset['frame_count'] ?? 0),
            'frameRate' => (int)($asset['frame_rate'] ?? 10),
            'isVariableFramerate' => (int)$asset['is_variable_framerate'],
            'isAnimated' => (int)$asset['is_animated'],
            'hasTransparency' => (int)$asset['has_transparency'],
            'width' => (int)($asset['width'] ?? 0),
            'height' => (int)($asset['height'] ?? 0),
            'fileSize' => (int)($asset['file_size'] ?? 0),
            'category' => $asset['category_slug'],
            'isPixelated' => (int)$asset['is_pixelated'],
            'isActive' => (int)$asset['is_active'],
            'tags' => $tags,
        ];
    }

    protected function getAssetSpecificFields()
    {
        return [
            'string' => ['name', 'url', 'generated_name', 'color_codes'],
            'int' => ['glitter_category_id', 'frame_count', 'frame_rate', 'sort_order', 'width', 'height', 'file_size'],
            'float' => ['hue', 'color_value'],
            'bool' => ['is_pixelated', 'is_active', 'is_variable_framerate', 'is_animated', 'has_transparency'],
        ];
    }

    public function addAsset($data)
    {
        $stmt = $this->db->prepare(
            "INSERT INTO {$this->tables['table']} (name, url, glitter_category_id, is_pixelated, is_active) VALUES (?, ?, ?, ?, ?)",
            'ssiii',
            [
                (string)$data['name'],
                (string)$data['url'],
                (int)($data['category_id'] ?? 1),
                1,
                1,
            ]
        );
        $stmt->close();

        return ['success' => true, 'id' => $this->db->lastInsertId()];
    }
}

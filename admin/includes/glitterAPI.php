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
        $colorWeights = [];
        if (!empty($asset['color_codes'])) {
            $colorCodes = array_map('trim', explode(',', $asset['color_codes']));
        }
        if (!empty($asset['color_weights'])) {
            $colorWeights = array_map('floatval', explode(',', $asset['color_weights']));
        }
        if (count($colorCodes) !== count($colorWeights)) {
            throw new Exception('Color code/weight mismatch for glitter ID ' . $asset['id']);
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
            'colorWeights' => $colorWeights,
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
            'tags' => $tags,
        ];
    }

    protected function getAssetSpecificFields()
    {
        return [
            'string' => ['name', 'url', 'generated_name', 'color_codes', 'color_weights', 'file_hash'],
            'int' => ['glitter_category_id', 'frame_count', 'frame_rate', 'sort_order', 'width', 'height', 'file_size'],
            'float' => ['hue', 'color_value'],
            'bool' => ['is_pixelated', 'is_active', 'is_variable_framerate', 'is_animated', 'has_transparency'],
        ];
    }

    protected function getAddFieldMap()
    {
        return [
            'name' => ['type' => 's'],
            'url' => ['type' => 's'],
            'glitter_category_id' => ['type' => 'i', 'source' => 'category_id', 'default' => 1],
            'is_pixelated' => ['type' => 'i', 'default' => 1],
            'is_active' => ['type' => 'i', 'default' => 1],
        ];
    }

    protected function persistAnalysis($id, $analysis, $includeColors = true)
    {
        parent::persistAnalysis($id, $analysis, $includeColors);
        if (!$includeColors) {
            return;
        }
        $stmt = $this->db->prepare(
            "UPDATE {$this->tables['table']}
             SET color_codes = ?, color_weights = ?, color_value = ?, hue = ?, generated_name = ?
             WHERE id = ?",
            'ssddsi',
            [
                (string)$analysis['color_codes'],
                (string)$analysis['color_weights'],
                (float)$analysis['color_value'],
                (float)$analysis['hue'],
                (string)$analysis['generated_name'],
                (int)$id,
            ]
        );
        $stmt->close();
    }
}

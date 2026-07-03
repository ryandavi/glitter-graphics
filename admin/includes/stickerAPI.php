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

    protected function formatAssetForExport($asset, $tags)
    {
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
            'isAnimated' => (int)$asset['is_animated'],
            'hasTransparency' => (int)$asset['has_transparency'],
            'isActive' => (int)$asset['is_active'],
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
            'string' => ['name', 'filename', 'url', 'attribution', 'sticker_text'],
            'int' => ['sticker_category_id', 'width', 'height', 'frame_count', 'frame_rate', 'file_size', 'sort_order'],
            'float' => [],
            'bool' => ['is_animated', 'has_transparency', 'is_active', 'is_variable_framerate'],
        ];
    }

    protected function getNullableStringFields()
    {
        return ['attribution', 'sticker_text'];
    }

    protected function getUpdateExtraAssignments($data)
    {
        if (array_key_exists('sticker_category_id', $data)) {
            return ['sort_order = 0'];
        }

        return [];
    }

    public function addAsset($data)
    {
        $stmt = $this->db->prepare(
            "INSERT INTO {$this->tables['table']} (name, filename, url, sticker_category_id, attribution, is_active) VALUES (?, ?, ?, ?, ?, ?)",
            'sssisi',
            [
                (string)$data['name'],
                (string)$data['filename'],
                (string)$data['url'],
                (int)($data['category_id'] ?? 1),
                isset($data['attribution']) && $data['attribution'] !== '' ? (string)$data['attribution'] : null,
                1,
            ]
        );
        $stmt->close();

        $id = $this->db->lastInsertId();

        try {
            $analysis = $this->performAnalysis($data['url']);
            $this->persistAnalysis($id, $analysis);
        } catch (Exception $e) {
            error_log('Auto-analysis failed for sticker ID ' . $id . ': ' . $e->getMessage());
        }

        return ['success' => true, 'id' => $id];
    }
}

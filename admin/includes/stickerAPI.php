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
            'category' => $asset['category_slug'],
            'attribution' => $asset['attribution'] ?? null,
            'tags' => $tags,
            'is_animated' => (bool)$asset['is_animated'],
            'has_transparency' => (bool)$asset['has_transparency'],
            'width' => (int)($asset['width'] ?? 0),
            'height' => (int)($asset['height'] ?? 0),
            'frame_count' => (int)($asset['frame_count'] ?? 0),
            'file_size' => (int)($asset['file_size'] ?? 0),
            'sort_order' => (int)($asset['sort_order'] ?? 0)
        ];
    }

    protected function getAssetSpecificFields()
    {
        return [
            'string' => ['name', 'filename', 'url', 'attribution'],
            'int' => ['sticker_category_id', 'is_animated', 'has_transparency', 'is_active', 'width', 'height', 'frame_count', 'file_size', 'sort_order'],
            'float' => []
        ];
    }

    public function updateSticker($data)
    {
        $id = (int)$data['id'];
        $fields = [];
        $fieldTypes = $this->getAssetSpecificFields();

        foreach ($fieldTypes['string'] as $field) {
            if (isset($data[$field])) {
                $value = $this->db->escape($data[$field]);
                $fields[] = "$field = '$value'";
            }
        }

        foreach ($fieldTypes['int'] as $field) {
            if (isset($data[$field])) {
                $value = $data[$field] !== '' ? (int)$data[$field] : 'NULL';
                $fields[] = "$field = $value";
            }
        }

        if (empty($fields)) {
            throw new Exception('No fields to update');
        }

        $table = $this->tables['table'];
        $sql = "UPDATE $table SET " . implode(', ', $fields) . " WHERE id = $id";
        $this->db->query($sql);

        // Update tags if provided
        if (isset($data['tags'])) {
            $tagsMapTable = $this->tables['tags_map_table'];
            $this->db->query("DELETE FROM $tagsMapTable WHERE sticker_id = $id");
            foreach ($data['tags'] as $tagId) {
                $tagId = (int)$tagId;
                $this->db->query("INSERT INTO $tagsMapTable (sticker_id, sticker_tag_id) VALUES ($id, $tagId)");
            }
        }

        return ['success' => true];
    }

    public function deleteSticker($id)
    {
        $tagsMapTable = $this->tables['tags_map_table'];
        $table = $this->tables['table'];
        
        $this->db->query("DELETE FROM $tagsMapTable WHERE sticker_id = $id");
        $this->db->query("DELETE FROM $table WHERE id = $id");
        return ['success' => true];
    }

// Helper method for full sticker analysis
private function performStickerAnalysis($url)
{
    require_once('gifAnalyzer.php');
    
    // Get GIF frame data
    $analyzer = new GifAnalyzer("../" . $url, $this->config);
    $analysis = $analyzer->analyze();

    // Get file info
    $filePath = $this->config['image_base_path'] . $url;
    $fileSize = file_exists($filePath) ? filesize($filePath) : 0;

    // Get image dimensions
    $imageInfo = @getimagesize($filePath);
    $width = $imageInfo ? $imageInfo[0] : 0;
    $height = $imageInfo ? $imageInfo[1] : 0;

    // Check for transparency (basic check for GIF)
    $hasTransparency = 0;
    if ($imageInfo && $imageInfo[2] === IMAGETYPE_GIF) {
        $image = @imagecreatefromgif($filePath);
        if ($image) {
            $transparentIndex = imagecolortransparent($image);
            $hasTransparency = ($transparentIndex >= 0) ? 1 : 0;
            imagedestroy($image);
        }
    }

    // Combine all analysis data
    return array_merge($analysis, [
        'width' => $width,
        'height' => $height,
        'file_size' => $fileSize,
        'has_transparency' => $hasTransparency,
        'is_animated' => ($analysis['frame_count'] ?? 1) > 1 ? 1 : 0
    ]);
}

public function analyzeSticker($id)
{
    $table = $this->tables['table'];
    $result = $this->db->query("SELECT url FROM $table WHERE id = $id");
    $sticker = $result->fetch_assoc();

    if (!$sticker) {
        throw new Exception('Sticker not found');
    }

    return $this->performStickerAnalysis($sticker['url']);
}

public function addSticker($data)
{
    $name = $this->db->escape($data['name']);
    $filename = $this->db->escape($data['filename']);
    $url = $this->db->escape($data['url']);
    $categoryId = (int)($data['category_id'] ?? 1);
    $attribution = isset($data['attribution']) ? "'" . $this->db->escape($data['attribution']) . "'" : 'NULL';
    $table = $this->tables['table'];

    $sql = "INSERT INTO $table (name, filename, url, sticker_category_id, attribution, is_active) 
            VALUES ('$name', '$filename', '$url', $categoryId, $attribution, 1)";

    $this->db->query($sql);
    $id = $this->db->lastInsertId();

    // Auto-analyze the sticker to populate metadata
    try {
        $analysis = $this->performStickerAnalysis($url);

        // Update record with analysis data
        $updateSql = "UPDATE $table SET 
            width = {$analysis['width']},
            height = {$analysis['height']},
            frame_count = {$analysis['frame_count']},
            is_animated = {$analysis['is_animated']},
            has_transparency = {$analysis['has_transparency']},
            file_size = {$analysis['file_size']}
            WHERE id = $id";

        $this->db->query($updateSql);
    } catch (Exception $e) {
        // If analysis fails, that's okay - we still have the basic sticker
        error_log("Auto-analysis failed for sticker ID $id: " . $e->getMessage());
    }

    return ['success' => true, 'id' => $id];
}

    public function reorderStickers($data)
    {
        $table = $this->tables['table'];
        
        foreach ($data['order'] as $index => $id) {
            $id = (int)$id;
            $order = (int)$index;

            $sql = "UPDATE $table SET sort_order = $order WHERE id = $id";
            $this->db->query($sql);
        }

        return ['success' => true];
    }




}
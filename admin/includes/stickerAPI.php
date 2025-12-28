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
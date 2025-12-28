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
        // Convert color_codes string to array
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
            'isVariableFramerate' => (bool)$asset['is_variable_framerate'],
            'category' => $asset['category_slug'],
            'isPixelated' => (bool)$asset['is_pixelated'],
            'tags' => $tags
        ];
    }

    protected function getAssetSpecificFields()
    {
        return [
            'string' => ['name', 'url', 'generated_name', 'color_codes'],
            'int' => ['glitter_category_id', 'is_pixelated', 'is_active', 'frame_count', 'frame_rate', 'is_variable_framerate', 'sort_order'],
            'float' => ['hue', 'color_value']
        ];
    }

    public function updateGlitter($data)
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

        foreach ($fieldTypes['float'] as $field) {
            if (isset($data[$field])) {
                $value = $data[$field] !== '' ? (float)$data[$field] : 'NULL';
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
            $this->db->query("DELETE FROM $tagsMapTable WHERE glitter_id = $id");
            foreach ($data['tags'] as $tagId) {
                $tagId = (int)$tagId;
                $this->db->query("INSERT INTO $tagsMapTable (glitter_id, glitter_tag_id) VALUES ($id, $tagId)");
            }
        }

        return ['success' => true];
    }

    public function deleteGlitter($id)
    {
        $tagsMapTable = $this->tables['tags_map_table'];
        $table = $this->tables['table'];
        
        $this->db->query("DELETE FROM $tagsMapTable WHERE glitter_id = $id");
        $this->db->query("DELETE FROM $table WHERE id = $id");
        return ['success' => true];
    }

    public function addGlitter($data)
    {
        $name = $this->db->escape($data['name']);
        $url = $this->db->escape($data['url']);
        $categoryId = (int)($data['category_id'] ?? 1);
        $table = $this->tables['table'];

        $sql = "INSERT INTO $table (name, url, glitter_category_id, is_pixelated, is_active) 
                VALUES ('$name', '$url', $categoryId, 1, 1)";

        $this->db->query($sql);
        $id = $this->db->lastInsertId();

        return ['success' => true, 'id' => $id];
    }

    public function reorderGlitter($data)
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

    public function analyzeGlitter($id)
    {
        $table = $this->tables['table'];
        $result = $this->db->query("SELECT url FROM $table WHERE id = $id");
        $glitter = $result->fetch_assoc();

        if (!$glitter) {
            throw new Exception('Glitter not found');
        }

        require_once('gifAnalyzer.php');
        $analyzer = new GifAnalyzer("../" . $glitter['url'], $this->config);
        $analysis = $analyzer->analyze();

        return $analysis;
    }
}
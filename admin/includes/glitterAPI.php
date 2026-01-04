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
        'isVariableFramerate' => (int)$asset['is_variable_framerate'],
        'isAnimated' => (int)$asset['is_animated'],          // NEW - remove if not needed
        'hasTransparency' => (int)$asset['has_transparency'], // NEW - remove if not needed
        'width' => (int)($asset['width'] ?? 0),               // NEW - remove if not needed
        'height' => (int)($asset['height'] ?? 0),             // NEW - remove if not needed
        'fileSize' => (int)($asset['file_size'] ?? 0),        // NEW - remove if not needed
        'category' => $asset['category_slug'],
        'isPixelated' => (int)$asset['is_pixelated'],
        'isActive' => (int)$asset['is_active'],
        'tags' => $tags
    ];
}

    protected function getAssetSpecificFields()
    {
        return [
            'string' => ['name', 'url', 'generated_name', 'color_codes'],
            'int' => ['glitter_category_id', 'frame_count', 'frame_rate', 'sort_order', 'width', 'height', 'file_size'],
            'float' => ['hue', 'color_value'],
            'bool' => ['is_pixelated', 'is_active', 'is_variable_framerate', 'is_animated', 'has_transparency']
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

        foreach ($fieldTypes['bool'] as $field) {
            // Only update if passed (PATCH compliant)
            if (array_key_exists($field, $data)) {
                // Handles: true, 1, "1", "true", "on" => 1
                // Handles: false, 0, "0", "false", "off", null => 0
                $val = filter_var($data[$field], FILTER_VALIDATE_BOOLEAN);
                $value = $val ? 1 : 0;
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

        return $this->performGlitterAnalysis($glitter['url']);
    }

    // Helper method for full glitter analysis
    private function performGlitterAnalysis($url)
    {
        require_once('gifAnalyzer.php');
        
        // Get GIF frame data
        $analyzer = new GifAnalyzer("../" . $url, $this->config);
        $analysis = $analyzer->analyze();

        // Get file info
        $filePath = "../../" . $url;
        $fileSize = file_exists($filePath) ? filesize($filePath) : 0;

        // Get image dimensions
        $imageInfo = @getimagesize($filePath);
        $width = $imageInfo ? $imageInfo[0] : 0;
        $height = $imageInfo ? $imageInfo[1] : 0;

// Check for transparency (actual transparent pixels, not just palette)
$hasTransparency = 0;
if ($imageInfo && $imageInfo[2] === IMAGETYPE_GIF) {
    $image = @imagecreatefromgif($filePath);
    if ($image) {
        $transparentIndex = imagecolortransparent($image);
        
        // Only mark as transparent if pixels actually use the transparent color
        if ($transparentIndex >= 0) {
            $width = imagesx($image);
            $height = imagesy($image);
            $foundTransparent = false;
            
            // Sample pixels to check if transparent color is actually used
            for ($y = 0; $y < $height && !$foundTransparent; $y += max(1, floor($height / 20))) {
                for ($x = 0; $x < $width && !$foundTransparent; $x += max(1, floor($width / 20))) {
                    if (imagecolorat($image, $x, $y) === $transparentIndex) {
                        $foundTransparent = true;
                    }
                }
            }
            
            $hasTransparency = $foundTransparent ? 1 : 0;
        }
        
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

    public function analyzeAllGlitter()
    {
        $table = $this->tables['table'];
        $result = $this->db->query("SELECT id, url FROM $table WHERE is_active = 1");

        $updated = 0;
        $errors = [];

        while ($glitter = $result->fetch_assoc()) {
            try {
                $analysis = $this->performGlitterAnalysis($glitter['url']);
                
                // Update only the factual/technical fields
                $updateSql = "UPDATE $table SET 
                    width = {$analysis['width']},
                    height = {$analysis['height']},
                    file_size = {$analysis['file_size']},
                    frame_count = {$analysis['frame_count']},
                    frame_rate = {$analysis['frame_rate']},
                    is_variable_framerate = {$analysis['is_variable_framerate']},
                    is_animated = {$analysis['is_animated']},
                    has_transparency = {$analysis['has_transparency']}
                    WHERE id = {$glitter['id']}";

                $this->db->query($updateSql);
                $updated++;
            } catch (Exception $e) {
                $errors[] = "ID {$glitter['id']}: " . $e->getMessage();
            }
        }

        return [
            'success' => true,
            'updated' => $updated,
            'errors' => $errors
        ];
    }
}
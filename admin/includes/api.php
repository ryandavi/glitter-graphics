<?php
// ============================================
// API HANDLER CLASS
// ============================================
class SwatchAPI
{
    private $db;
    private $config;

    public function __construct($db, $config)
    {
        $this->db = $db;
        $this->config = $config;
    }

    public function handleRequest()
    {
        $action = $_GET['action'] ?? '';

        header('Content-Type: application/json');

        try {
            switch ($action) {
                case 'list':
                    echo json_encode($this->listSwatches());
                    break;

                case 'get':
                    $id = (int)$_GET['id'];
                    echo json_encode($this->getSwatch($id));
                    break;

                case 'update':
                    $data = json_decode(file_get_contents('php://input'), true);
                    echo json_encode($this->updateSwatch($data));
                    break;

                case 'delete':
                    $id = (int)$_POST['id'];
                    echo json_encode($this->deleteSwatch($id));
                    break;

                case 'analyze':
                    $id = (int)$_GET['id'];
                    echo json_encode($this->analyzeSwatch($id));
                    break;

                case 'reorder':
                    $data = json_decode(file_get_contents('php://input'), true);
                    echo json_encode($this->reorderSwatches($data));
                    break;

                case 'add':
                    $data = json_decode(file_get_contents('php://input'), true);
                    echo json_encode($this->addSwatch($data));
                    break;

                case 'export':
                    echo json_encode($this->exportSwatches());
                    break;

                case 'save_export':
                    echo json_encode($this->saveExport());
                    break;

                case 'tags':
                    echo json_encode($this->getTags());
                    break;

                case 'tag_categories':
                    echo json_encode($this->getTagCategories());
                    break;

                case 'categories':
                    echo json_encode($this->getCategories());
                    break;

                case 'add_category':
                    $data = json_decode(file_get_contents('php://input'), true);
                    echo json_encode($this->addCategory($data));
                    break;

                case 'delete_category':
                    $id = (int)$_POST['id'];
                    echo json_encode($this->deleteCategory($id));
                    break;

                case 'add_tag':
                    $data = json_decode(file_get_contents('php://input'), true);
                    echo json_encode($this->addTag($data));
                    break;

                case 'delete_tag':
                    $id = (int)$_POST['id'];
                    echo json_encode($this->deleteTag($id));
                    break;

                default:
                    throw new Exception('Invalid action');
            }
        } catch (Exception $e) {
            http_response_code(400);
            echo json_encode(['error' => $e->getMessage()]);
        }
    }



    private function listSwatches()
    {
        $sql = "
        SELECT s.*, c.name as category_name 
        FROM swatches s 
        JOIN categories c ON s.category_id = c.id 
        ORDER BY c.sort_order, s.sort_order, s.name
    ";

        $result = $this->db->query($sql);

        $swatches = [];
        while ($row = $result->fetch_assoc()) {
            $swatches[] = $row;
        }

        return $swatches;
    }

    private function getSwatch($id)
    {
        // Get swatch data
        $result = $this->db->query("SELECT * FROM swatches WHERE id = $id");
        $swatch = $result->fetch_assoc();

        if (!$swatch) {
            throw new Exception('Swatch not found');
        }

        // Get tags
        $tagsResult = $this->db->query("
            SELECT t.id, t.name, t.hex_color, tc.name as category_name
            FROM swatch_tags st
            JOIN tags t ON st.tag_id = t.id
            JOIN tag_categories tc ON t.tag_category_id = tc.id
            WHERE st.swatch_id = $id
            ORDER BY tc.sort_order, t.name
        ");

        $tags = [];
        while ($tag = $tagsResult->fetch_assoc()) {
            $tags[] = $tag;
        }

        $swatch['tags'] = $tags;

        return $swatch;
    }

    private function updateSwatch($data)
    {
        $id = (int)$data['id'];
        $fields = [];

        $stringFields = ['name', 'url', 'generated_name', 'color_codes'];
        $intFields = [
            'category_id',
            'is_pixelated',
            'is_active',
            'frame_count',
            'frame_rate',
            'is_variable_framerate',
            'sort_order'
        ];
        $floatFields = ['hue', 'color_value'];

        foreach ($stringFields as $field) {
            if (isset($data[$field])) {
                $value = $this->db->escape($data[$field]);
                $fields[] = "$field = '$value'";
            }
        }

        foreach ($intFields as $field) {
            if (isset($data[$field])) {
                $value = $data[$field] !== '' ? (int)$data[$field] : 'NULL';
                $fields[] = "$field = $value";
            }
        }

        foreach ($floatFields as $field) {
            if (isset($data[$field])) {
                $value = $data[$field] !== '' ? (float)$data[$field] : 'NULL';
                $fields[] = "$field = $value";
            }
        }

        if (empty($fields)) {
            throw new Exception('No fields to update');
        }

        $sql = "UPDATE swatches SET " . implode(', ', $fields) . " WHERE id = $id";
        $this->db->query($sql);

        // Update tags if provided
        if (isset($data['tags'])) {
            $this->db->query("DELETE FROM swatch_tags WHERE swatch_id = $id");
            foreach ($data['tags'] as $tagId) {
                $tagId = (int)$tagId;
                $this->db->query("INSERT INTO swatch_tags (swatch_id, tag_id) VALUES ($id, $tagId)");
            }
        }

        return ['success' => true];
    }

    private function deleteSwatch($id)
    {
        $this->db->query("DELETE FROM swatch_tags WHERE swatch_id = $id");
        $this->db->query("DELETE FROM swatches WHERE id = $id");
        return ['success' => true];
    }

    private function analyzeSwatch($id)
    {
        $result = $this->db->query("SELECT url FROM swatches WHERE id = $id");
        $swatch = $result->fetch_assoc();

        if (!$swatch) {
            throw new Exception('Swatch not found');
        }

        $analyzer = new GifAnalyzer("../" . $swatch['url'], $this->config);
        $analysis = $analyzer->analyze();

        return $analysis;
    }

    private function reorderSwatches($data)
    {
        error_log("=== REORDER DEBUG ===");
        error_log("Received " . count($data['order']) . " items");

        // Log sample items
        $sampleIds = [47, 24, 123, 122, 26, 25];
        foreach ($data['order'] as $index => $id) {
            if (in_array($id, $sampleIds)) {
                error_log("Position $index → ID $id");
            }
        }

        foreach ($data['order'] as $index => $id) {
            $id = (int)$id;
            $order = (int)$index;

            $sql = "UPDATE swatches SET sort_order = $order WHERE id = $id";
            $result = $this->db->query($sql);

            if (!$result) {
                error_log("FAILED to update ID $id to sort_order $order");
            }
        }

        // Verify what was actually saved
        error_log("=== VERIFICATION ===");
        foreach ($sampleIds as $checkId) {
            $verifyResult = $this->db->query("SELECT sort_order FROM swatches WHERE id = $checkId");
            $row = $verifyResult->fetch_assoc();
            error_log("ID $checkId → sort_order " . ($row ? $row['sort_order'] : 'NOT FOUND'));
        }

        return ['success' => true];
    }


    private function addSwatch($data)
    {
        $name = $this->db->escape($data['name']);
        $url = $this->db->escape($data['url']);
        $categoryId = (int)($data['category_id'] ?? 1);

        $sql = "INSERT INTO swatches (name, url, category_id, is_pixelated, is_active) 
                VALUES ('$name', '$url', $categoryId, 1, 1)";

        $this->db->query($sql);
        $id = $this->db->lastInsertId();

        return ['success' => true, 'id' => $id];
    }

    private function exportSwatches()
    {
        $swatches = $this->listSwatches();

        $formatted = [];
        foreach ($swatches as $swatch) {
            // Get tags for this swatch
            $id = $swatch['id'];
            $tagsResult = $this->db->query("
                SELECT t.name 
                FROM swatch_tags st
                JOIN tags t ON st.tag_id = t.id
                WHERE st.swatch_id = $id
            ");

            $tags = [];
            while ($tag = $tagsResult->fetch_assoc()) {
                $tags[] = $tag['name'];
            }

            // Convert color_codes string to array
            $colorCodes = [];
            if (!empty($swatch['color_codes'])) {
                $colorCodes = array_map('trim', explode(',', $swatch['color_codes']));
            }

            // Format for app consumption
            $formatted[] = [
                'id' => (int)$swatch['id'],
                'url' => $swatch['url'],
                'name' => $swatch['name'],
                'generatedName' => $swatch['generated_name'],
                'brightness' => $swatch['color_value'],
                'sortOrder' => (int)($swatch['sort_order'] ?? 0),
                'hue' => $swatch['hue'] ? (float)$swatch['hue'] : null,
                'colorCodes' => $colorCodes,
                'frameCount' => (int)($swatch['frame_count'] ?? 0),
                'frameRate' => (int)($swatch['frame_rate'] ?? 10),
                'isVariableFramerate' => (bool)$swatch['is_variable_framerate'],
                'category' => $swatch['category_name'],
                'isPixelated' => (bool)$swatch['is_pixelated'],
                'tags' => $tags
            ];
        }

        return $formatted;
    }

    private function saveExport()
    {
        $swatches = $this->exportSwatches();
        $jsonPath = "../".$this->config['image_base_path'] . 'data/swatches.json';

        // Format JSON nicely
        $json = json_encode($swatches, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

        // Try to write to file
        $result = file_put_contents($jsonPath, $json);

        if ($result === false) {
            throw new Exception('Failed to write to ' . $jsonPath);
        }

        return ['success' => true, 'path' => $jsonPath, 'bytes' => $result];
    }

    private function getTags()
    {
        $result = $this->db->query("
            SELECT t.*, tc.name as category_name 
            FROM tags t 
            JOIN tag_categories tc ON t.tag_category_id = tc.id 
            ORDER BY tc.sort_order, t.name
        ");

        $tags = [];
        while ($row = $result->fetch_assoc()) {
            $tags[] = $row;
        }

        return $tags;
    }

    private function getTagCategories()
    {
        $result = $this->db->query("SELECT * FROM tag_categories ORDER BY sort_order");

        $categories = [];
        while ($row = $result->fetch_assoc()) {
            $categories[] = $row;
        }

        return $categories;
    }

    private function getCategories()
    {
        $result = $this->db->query("SELECT * FROM categories ORDER BY sort_order");

        $categories = [];
        while ($row = $result->fetch_assoc()) {
            $categories[] = $row;
        }

        return $categories;
    }

    private function addCategory($data)
    {
        $name = $this->db->escape($data['name']);
        $slug = $this->db->escape($data['slug']);
        $description = isset($data['description']) ? $this->db->escape($data['description']) : '';
        $sortOrder = (int)($data['sort_order'] ?? 999);

        $sql = "INSERT INTO categories (name, slug, description, sort_order) 
                VALUES ('$name', '$slug', '$description', $sortOrder)";

        $this->db->query($sql);
        return ['success' => true, 'id' => $this->db->lastInsertId()];
    }

    private function deleteCategory($id)
    {
        // Check if any swatches use this category
        $result = $this->db->query("SELECT COUNT(*) as count FROM swatches WHERE category_id = $id");
        $row = $result->fetch_assoc();

        if ($row['count'] > 0) {
            return ['success' => false, 'error' => 'Cannot delete category - ' . $row['count'] . ' swatch(es) use it'];
        }

        $this->db->query("DELETE FROM categories WHERE id = $id");
        return ['success' => true];
    }

    private function addTag($data)
    {
        $name = $this->db->escape($data['name']);
        $slug = strtolower(str_replace(' ', '-', $data['name']));
        $slug = $this->db->escape($slug);
        $tagCategoryId = (int)$data['tag_category_id'];
        $hexColor = isset($data['hex_color']) && $data['hex_color'] ?
            $this->db->escape($data['hex_color']) : 'NULL';

        $sql = "INSERT INTO tags (tag_category_id, name, slug, hex_color) 
                VALUES ($tagCategoryId, '$name', '$slug', " .
            ($hexColor === 'NULL' ? 'NULL' : "'$hexColor'") . ")";

        $this->db->query($sql);
        return ['success' => true, 'id' => $this->db->lastInsertId()];
    }

    private function deleteTag($id)
    {
        // Check if any swatches use this tag
        $result = $this->db->query("SELECT COUNT(*) as count FROM swatch_tags WHERE tag_id = $id");
        $row = $result->fetch_assoc();

        if ($row['count'] > 0) {
            // Remove tag from all swatches
            $this->db->query("DELETE FROM swatch_tags WHERE tag_id = $id");
        }

        $this->db->query("DELETE FROM tags WHERE id = $id");
        return ['success' => true, 'removed_from' => $row['count']];
    }
}

include_once('config.php');
include_once('database.php');
include_once('gifAnalyzer.php');

// ============================================
// HANDLE API REQUESTS
// ============================================

$db = new Database($CONFIG);
$api = new SwatchAPI($db, $CONFIG);
$api->handleRequest();
exit;

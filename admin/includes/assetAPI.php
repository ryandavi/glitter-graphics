<?php
// ============================================
// GENERIC ASSET API BASE CLASS
// ============================================
abstract class AssetAPI
{
    protected $db;
    protected $config;
    protected $assetType;
    protected $tables;

    public function __construct($db, $config, $assetType)
    {
        $this->db = $db;
        $this->config = $config;
        $this->assetType = $assetType;
        $this->tables = $config['asset_types'][$assetType];
    }

    // ===== ABSTRACT METHODS (must be implemented by child classes) =====
    
    abstract protected function formatAssetForExport($asset, $tags);
    abstract protected function getAssetSpecificFields();
    
    // ===== CATEGORY METHODS =====
    
    public function getCategories()
    {
        $table = $this->tables['categories_table'];
        $result = $this->db->query("SELECT * FROM $table ORDER BY sort_order");

        $categories = [];
        while ($row = $result->fetch_assoc()) {
            $categories[] = $row;
        }

        return $categories;
    }

    public function addCategory($data)
    {
        $table = $this->tables['categories_table'];
        $name = $this->db->escape($data['name']);
        $slug = $this->db->escape($data['slug']);
        $description = isset($data['description']) ? $this->db->escape($data['description']) : '';
        $sortOrder = (int)($data['sort_order'] ?? 999);

        $sql = "INSERT INTO $table (name, slug, description, sort_order) 
                VALUES ('$name', '$slug', '$description', $sortOrder)";

        $this->db->query($sql);
        return ['success' => true, 'id' => $this->db->lastInsertId()];
    }

    public function deleteCategory($id)
    {
        $table = $this->tables['categories_table'];
        $assetTable = $this->tables['table'];
        $categoryIdField = $this->assetType . '_category_id';
        
        // Check if any assets use this category
        $result = $this->db->query("SELECT COUNT(*) as count FROM $assetTable WHERE $categoryIdField = $id");
        $row = $result->fetch_assoc();

        if ($row['count'] > 0) {
            return ['success' => false, 'error' => 'Cannot delete category - ' . $row['count'] . ' asset(s) use it'];
        }

        $this->db->query("DELETE FROM $table WHERE id = $id");
        return ['success' => true];
    }

public function exportCategories()
{
    $table = $this->tables['categories_table'];
    $assetTable = $this->tables['table'];
    $categoryIdField = $this->assetType . '_category_id';
    
    // For stickers: "User Uploads" first, then by item count (most items first)
    // For glitter: use sort_order
    if ($this->assetType === 'sticker') {
        $sql = "
            SELECT c.*, COUNT(a.id) as item_count
            FROM $table c
            LEFT JOIN $assetTable a ON c.id = a.$categoryIdField
            GROUP BY c.id
            ORDER BY 
                CASE WHEN c.name = 'User Uploads' THEN 0 ELSE 1 END,
                item_count DESC, 
                c.name
        ";
    } else {
        $sql = "SELECT * FROM $table ORDER BY sort_order";
    }
    
    $result = $this->db->query($sql);

    $categories = [];
    while ($row = $result->fetch_assoc()) {
        $categories[] = [
            'id' => $row['slug'], // Use slug as ID for frontend
            'name' => $row['name'],
            'icon' => isset($row['icon']) ? $row['icon'] : '',
            'color' => isset($row['color']) ? $row['color'] : '#ff69b4',
            'description' => isset($row['description']) ? $row['description'] : ''
        ];
    }

    return $categories;
}

    public function saveCategoriesExport()
    {
        $categories = $this->exportCategories();
        $jsonPath = "../../" . $this->tables['categories_json_file'];

        $json = json_encode($categories, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        $result = file_put_contents($jsonPath, $json);

        if ($result === false) {
            throw new Exception('Failed to write to ' . $jsonPath);
        }

        return ['success' => true, 'path' => $jsonPath, 'bytes' => $result];
    }


public function updateCategory($data)
{
    $table = $this->tables['categories_table'];
    $id = (int)$data['id'];
    $fields = [];

    $stringFields = ['name', 'slug', 'description', 'icon', 'color'];
    $intFields = ['sort_order'];

    foreach ($stringFields as $field) {
        if (isset($data[$field])) {
            $value = $this->db->escape($data[$field]);
            $fields[] = "$field = '$value'";
        }
    }

    foreach ($intFields as $field) {
        if (isset($data[$field])) {
            $value = (int)$data[$field];
            $fields[] = "$field = $value";
        }
    }

    if (empty($fields)) {
        throw new Exception('No fields to update');
    }

    $sql = "UPDATE $table SET " . implode(', ', $fields) . " WHERE id = $id";
    $this->db->query($sql);

    return ['success' => true];
}


    // ===== TAG METHODS =====
    
    public function getTags()
    {
        $tagsTable = $this->tables['tags_table'];
        $tagCategoriesTable = $this->tables['tag_categories_table'];
        $tagCategoryIdField = $this->assetType . '_tag_category_id';
        
        $result = $this->db->query("
            SELECT t.*, tc.name as category_name 
            FROM $tagsTable t 
            JOIN $tagCategoriesTable tc ON t.$tagCategoryIdField = tc.id 
            ORDER BY tc.sort_order, t.name
        ");

        $tags = [];
        while ($row = $result->fetch_assoc()) {
            $tags[] = $row;
        }

        return $tags;
    }

    public function getTagCategories()
    {
        $table = $this->tables['tag_categories_table'];
        $result = $this->db->query("SELECT * FROM $table ORDER BY sort_order");

        $categories = [];
        while ($row = $result->fetch_assoc()) {
            $categories[] = $row;
        }

        return $categories;
    }

    public function addTag($data)
    {
        $tagsTable = $this->tables['tags_table'];
        $tagCategoryIdField = $this->assetType . '_tag_category_id';
        
        $name = $this->db->escape($data['name']);
        $slug = strtolower(str_replace(' ', '-', $data['name']));
        $slug = $this->db->escape($slug);
        $tagCategoryId = (int)$data['tag_category_id'];
        $hexColor = isset($data['hex_color']) && $data['hex_color'] ?
            $this->db->escape($data['hex_color']) : 'NULL';

        $sql = "INSERT INTO $tagsTable ($tagCategoryIdField, name, slug, hex_color) 
                VALUES ($tagCategoryId, '$name', '$slug', " .
            ($hexColor === 'NULL' ? 'NULL' : "'$hexColor'") . ")";

        $this->db->query($sql);
        return ['success' => true, 'id' => $this->db->lastInsertId()];
    }

    public function deleteTag($id)
    {
        $tagsTable = $this->tables['tags_table'];
        $tagsMapTable = $this->tables['tags_map_table'];
        $tagIdField = $this->assetType . '_tag_id';
        
        // Check if any assets use this tag
        $result = $this->db->query("SELECT COUNT(*) as count FROM $tagsMapTable WHERE $tagIdField = $id");
        $row = $result->fetch_assoc();

        if ($row['count'] > 0) {
            // Remove tag from all assets
            $this->db->query("DELETE FROM $tagsMapTable WHERE $tagIdField = $id");
        }

        $this->db->query("DELETE FROM $tagsTable WHERE id = $id");
        return ['success' => true, 'removed_from' => $row['count']];
    }

    // ===== ASSET METHODS =====
    
public function listAssets()
{
    $assetTable = $this->tables['table'];
    $categoriesTable = $this->tables['categories_table'];
    $categoryIdField = $this->assetType . '_category_id';
    
    // For stickers: alphabetical category order, then by name (ignore sort_order)
    // For glitter: use sort_order as before
    $orderByMap = [
        'sticker' => 'c.name, a.id, a.name',
    ];

    $orderBy = $orderByMap[$this->assetType]
        ?? 'c.sort_order, a.sort_order, a.name';

    
    $sql = "
        SELECT a.*, c.name as category_name, c.slug as category_slug
        FROM $assetTable a 
        JOIN $categoriesTable c ON a.$categoryIdField = c.id 
        ORDER BY $orderBy
    ";

    $result = $this->db->query($sql);

    $assets = [];
    while ($row = $result->fetch_assoc()) {
        $assets[] = $row;
    }

    return $assets;
}

    public function getAsset($id)
    {
        $assetTable = $this->tables['table'];
        
        // Get asset data
        $result = $this->db->query("SELECT * FROM $assetTable WHERE id = $id");
        $asset = $result->fetch_assoc();

        if (!$asset) {
            throw new Exception('Asset not found');
        }

        // Get tags
        $asset['tags'] = $this->getAssetTags($id);

        return $asset;
    }

    protected function getAssetTags($assetId)
    {
        $tagsTable = $this->tables['tags_table'];
        $tagCategoriesTable = $this->tables['tag_categories_table'];
        $tagsMapTable = $this->tables['tags_map_table'];
        $assetIdField = $this->assetType . '_id';
        $tagIdField = $this->assetType . '_tag_id';
        $tagCategoryIdField = $this->assetType . '_tag_category_id';
        
        $result = $this->db->query("
            SELECT t.id, t.name, t.hex_color, tc.name as category_name
            FROM $tagsMapTable tm
            JOIN $tagsTable t ON tm.$tagIdField = t.id
            JOIN $tagCategoriesTable tc ON t.$tagCategoryIdField = tc.id
            WHERE tm.$assetIdField = $assetId
            ORDER BY tc.sort_order, t.name
        ");

        $tags = [];
        while ($tag = $result->fetch_assoc()) {
            $tags[] = $tag;
        }

        return $tags;
    }

    public function exportAssets()
    {
        $assets = $this->listAssets();
        $formatted = [];

        foreach ($assets as $asset) {
            // Get tags for this asset
            $tags = $this->getAssetTags($asset['id']);
            $tagNames = array_map(function($tag) {
                return $tag['name'];
            }, $tags);

            // Format for app consumption (child class defines specifics)
            $formatted[] = $this->formatAssetForExport($asset, $tagNames);
        }

        return $formatted;
    }

    public function saveExport()
    {
        $assets = $this->exportAssets();
        $jsonPath = "../../" . $this->tables['json_file'];

        $json = json_encode($assets, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        $result = file_put_contents($jsonPath, $json);

        if ($result === false) {
            throw new Exception('Failed to write to ' . $jsonPath);
        }

        return ['success' => true, 'path' => $jsonPath, 'bytes' => $result];
    }
}
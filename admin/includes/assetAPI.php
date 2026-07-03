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
        if (!isset($config['asset_types'][$assetType])) {
            throw new InvalidArgumentException('Invalid asset type');
        }

        $this->db = $db;
        $this->config = $config;
        $this->assetType = $assetType;
        $this->tables = $config['asset_types'][$assetType];
    }

    abstract protected function formatAssetForExport($asset, $tags);
    abstract protected function getAssetSpecificFields();

    protected function getNullableStringFields()
    {
        return [];
    }

    protected function getUpdateExtraAssignments($data)
    {
        return [];
    }

    protected function getAssetDisplayName()
    {
        return ucfirst($this->assetType);
    }

    protected function getCategoryIdField()
    {
        return $this->assetType . '_category_id';
    }

    protected function getAssetIdField()
    {
        return $this->assetType . '_id';
    }

    protected function getTagIdField()
    {
        return $this->assetType . '_tag_id';
    }

    protected function getTagCategoryIdField()
    {
        return $this->assetType . '_tag_category_id';
    }

    protected function fetchAllAssoc($result)
    {
        $rows = [];
        while ($row = $result->fetch_assoc()) {
            $rows[] = $row;
        }

        return $rows;
    }

    protected function fetchOneAssoc($result)
    {
        $row = $result->fetch_assoc();
        return $row ?: null;
    }

    protected function normalizeBoolean($value)
    {
        return filter_var($value, FILTER_VALIDATE_BOOLEAN) ? 1 : 0;
    }

    protected function buildAssetUpdatePayload($data, $extraAssignments = [])
    {
        $fieldTypes = $this->getAssetSpecificFields();
        $nullableStringFields = array_flip($this->getNullableStringFields());
        $assignments = [];
        $types = '';
        $params = [];

        foreach ($fieldTypes['string'] as $field) {
            if (!array_key_exists($field, $data)) {
                continue;
            }

            if (
                isset($nullableStringFields[$field]) &&
                ($data[$field] === null || $data[$field] === '')
            ) {
                $assignments[] = "$field = NULL";
                continue;
            }

            $assignments[] = "$field = ?";
            $types .= 's';
            $params[] = (string)$data[$field];
        }

        foreach ($fieldTypes['int'] as $field) {
            if (!array_key_exists($field, $data)) {
                continue;
            }

            if ($data[$field] === '' || $data[$field] === null) {
                $assignments[] = "$field = NULL";
                continue;
            }

            $assignments[] = "$field = ?";
            $types .= 'i';
            $params[] = (int)$data[$field];
        }

        foreach ($fieldTypes['float'] as $field) {
            if (!array_key_exists($field, $data)) {
                continue;
            }

            if ($data[$field] === '' || $data[$field] === null) {
                $assignments[] = "$field = NULL";
                continue;
            }

            $assignments[] = "$field = ?";
            $types .= 'd';
            $params[] = (float)$data[$field];
        }

        foreach ($fieldTypes['bool'] as $field) {
            if (!array_key_exists($field, $data)) {
                continue;
            }

            $assignments[] = "$field = ?";
            $types .= 'i';
            $params[] = $this->normalizeBoolean($data[$field]);
        }

        foreach ($extraAssignments as $assignment) {
            $assignments[] = $assignment;
        }

        return [$assignments, $types, $params];
    }

    protected function updateAssetRecord($id, $data, $extraAssignments = [])
    {
        list($assignments, $types, $params) = $this->buildAssetUpdatePayload($data, $extraAssignments);

        if (empty($assignments)) {
            throw new Exception('No fields to update');
        }

        $sql = "UPDATE {$this->tables['table']} SET " . implode(', ', $assignments) . " WHERE id = ?";
        $types .= 'i';
        $params[] = (int)$id;
        $stmt = $this->db->prepare($sql, $types, $params);
        $stmt->close();
    }

    protected function saveAssetTags($assetId, $tagIds)
    {
        $assetId = (int)$assetId;
        $tagsMapTable = $this->tables['tags_map_table'];
        $assetIdField = $this->getAssetIdField();
        $tagIdField = $this->getTagIdField();

        $deleteStmt = $this->db->prepare(
            "DELETE FROM $tagsMapTable WHERE $assetIdField = ?",
            'i',
            [$assetId]
        );
        $deleteStmt->close();

        $insertSql = "INSERT INTO $tagsMapTable ($assetIdField, $tagIdField) VALUES (?, ?)";
        foreach ($tagIds as $tagId) {
            $insertStmt = $this->db->prepare($insertSql, 'ii', [$assetId, (int)$tagId]);
            $insertStmt->close();
        }
    }

    protected function deleteAssetRecord($id)
    {
        $assetId = (int)$id;
        $tagsMapTable = $this->tables['tags_map_table'];
        $assetTable = $this->tables['table'];
        $assetIdField = $this->getAssetIdField();

        $tagsStmt = $this->db->prepare(
            "DELETE FROM $tagsMapTable WHERE $assetIdField = ?",
            'i',
            [$assetId]
        );
        $tagsStmt->close();

        $assetStmt = $this->db->prepare(
            "DELETE FROM $assetTable WHERE id = ?",
            'i',
            [$assetId]
        );
        $assetStmt->close();
    }

    protected function reorderAssetsByIds($order)
    {
        $table = $this->tables['table'];
        $sql = "UPDATE $table SET sort_order = ? WHERE id = ?";

        foreach ($order as $index => $id) {
            $stmt = $this->db->prepare($sql, 'ii', [(int)$index, (int)$id]);
            $stmt->close();
        }
    }

    protected function getAssetUrlById($id)
    {
        $stmt = $this->db->prepare(
            "SELECT url FROM {$this->tables['table']} WHERE id = ?",
            'i',
            [(int)$id]
        );
        $result = $stmt->get_result();
        $asset = $this->fetchOneAssoc($result);
        $stmt->close();

        return $asset;
    }

    protected function getActiveAssetRows()
    {
        $stmt = $this->db->prepare(
            "SELECT id, url FROM {$this->tables['table']} WHERE is_active = ?",
            'i',
            [1]
        );
        $result = $stmt->get_result();
        $rows = $this->fetchAllAssoc($result);
        $stmt->close();

        return $rows;
    }

    protected function persistAnalysis($id, $analysis)
    {
        $table = $this->tables['table'];
        $sql = "
            UPDATE $table
            SET width = ?,
                height = ?,
                file_size = ?,
                frame_count = ?,
                frame_rate = ?,
                is_variable_framerate = ?,
                is_animated = ?,
                has_transparency = ?
            WHERE id = ?
        ";

        $stmt = $this->db->prepare(
            $sql,
            'iiiiiiiii',
            [
                (int)$analysis['width'],
                (int)$analysis['height'],
                (int)$analysis['file_size'],
                (int)$analysis['frame_count'],
                (int)$analysis['frame_rate'],
                (int)$analysis['is_variable_framerate'],
                (int)$analysis['is_animated'],
                (int)$analysis['has_transparency'],
                (int)$id,
            ]
        );
        $stmt->close();
    }

    protected function performAnalysis($url)
    {
        require_once('gifAnalyzer.php');

        $analyzer = new GifAnalyzer("../" . $url, $this->config);
        $analysis = $analyzer->analyze();

        $filePath = "../../" . $url;
        $fileSize = file_exists($filePath) ? filesize($filePath) : 0;
        $imageInfo = @getimagesize($filePath);
        $width = $imageInfo ? $imageInfo[0] : 0;
        $height = $imageInfo ? $imageInfo[1] : 0;
        $hasTransparency = 0;

        if ($imageInfo) {
            $image = false;
            switch ($imageInfo[2]) {
                case IMAGETYPE_GIF:
                    $image = @imagecreatefromgif($filePath);
                    break;
                case IMAGETYPE_PNG:
                    $image = @imagecreatefrompng($filePath);
                    break;
                case IMAGETYPE_JPEG:
                    $image = @imagecreatefromjpeg($filePath);
                    break;
            }

            if ($image) {
                $width = imagesx($image);
                $height = imagesy($image);
                $foundTransparent = false;

                if ($imageInfo[2] === IMAGETYPE_PNG) {
                    $foundTransparent = true;
                } else if ($imageInfo[2] === IMAGETYPE_GIF) {
                    $transparentIndex = imagecolortransparent($image);
                    if ($transparentIndex >= 0) {
                        for ($y = 0; $y < $height && !$foundTransparent; $y += max(1, floor($height / 20))) {
                            for ($x = 0; $x < $width && !$foundTransparent; $x += max(1, floor($width / 20))) {
                                if (imagecolorat($image, $x, $y) === $transparentIndex) {
                                    $foundTransparent = true;
                                }
                            }
                        }
                    }
                }

                $hasTransparency = $foundTransparent ? 1 : 0;
                imagedestroy($image);
            }
        }

        return array_merge($analysis, [
            'width' => $width,
            'height' => $height,
            'file_size' => $fileSize,
            'has_transparency' => $hasTransparency,
            'is_animated' => ($analysis['frame_count'] ?? 1) > 1 ? 1 : 0,
        ]);
    }

    public function getCategories()
    {
        $result = $this->db->query(
            "SELECT * FROM {$this->tables['categories_table']} ORDER BY sort_order"
        );

        return $this->fetchAllAssoc($result);
    }

    public function addCategory($data)
    {
        $stmt = $this->db->prepare(
            "INSERT INTO {$this->tables['categories_table']} (name, slug, description, sort_order) VALUES (?, ?, ?, ?)",
            'sssi',
            [
                (string)$data['name'],
                (string)$data['slug'],
                (string)($data['description'] ?? ''),
                (int)($data['sort_order'] ?? 999),
            ]
        );
        $stmt->close();

        return ['success' => true, 'id' => $this->db->lastInsertId()];
    }

    public function deleteCategory($id)
    {
        $categoryId = (int)$id;
        $assetTable = $this->tables['table'];
        $categoriesTable = $this->tables['categories_table'];
        $categoryIdField = $this->getCategoryIdField();

        $countStmt = $this->db->prepare(
            "SELECT COUNT(*) AS count FROM $assetTable WHERE $categoryIdField = ?",
            'i',
            [$categoryId]
        );
        $countResult = $countStmt->get_result();
        $row = $this->fetchOneAssoc($countResult);
        $countStmt->close();

        if ((int)$row['count'] > 0) {
            return ['success' => false, 'error' => 'Cannot delete category - ' . $row['count'] . ' asset(s) use it'];
        }

        $deleteStmt = $this->db->prepare(
            "DELETE FROM $categoriesTable WHERE id = ?",
            'i',
            [$categoryId]
        );
        $deleteStmt->close();

        return ['success' => true];
    }

    public function exportCategories()
    {
        $table = $this->tables['categories_table'];
        $assetTable = $this->tables['table'];
        $categoryIdField = $this->getCategoryIdField();

        if ($this->assetType === 'sticker') {
            $sql = "
                SELECT c.*, COUNT(a.id) AS item_count
                FROM $table c
                LEFT JOIN $assetTable a ON c.id = a.$categoryIdField
                GROUP BY c.id
                ORDER BY
                    CASE WHEN c.name = 'User Uploads' THEN 0 ELSE 1 END,
                    item_count DESC,
                    c.name
            ";
        } else {
            $sql = "
                SELECT c.*, COUNT(a.id) AS item_count
                FROM $table c
                LEFT JOIN $assetTable a ON c.id = a.$categoryIdField
                GROUP BY c.id
                ORDER BY c.sort_order
            ";
        }

        $result = $this->db->query($sql);
        $rows = $this->fetchAllAssoc($result);
        $categories = [];

        foreach ($rows as $row) {
            $categories[] = [
                'id' => $row['slug'],
                'name' => $row['name'],
                'icon' => isset($row['icon']) ? $row['icon'] : '',
                'color' => isset($row['color']) ? $row['color'] : '#ff69b4',
                'description' => isset($row['description']) ? $row['description'] : '',
                'count' => isset($row['item_count']) ? (int)$row['item_count'] : 0,
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
        $id = (int)$data['id'];
        $fields = [];
        $types = '';
        $params = [];

        foreach (['name', 'slug', 'description', 'icon', 'color'] as $field) {
            if (!array_key_exists($field, $data)) {
                continue;
            }

            $fields[] = "$field = ?";
            $types .= 's';
            $params[] = (string)$data[$field];
        }

        if (array_key_exists('sort_order', $data)) {
            $fields[] = "sort_order = ?";
            $types .= 'i';
            $params[] = (int)$data['sort_order'];
        }

        if (empty($fields)) {
            throw new Exception('No fields to update');
        }

        $sql = "UPDATE {$this->tables['categories_table']} SET " . implode(', ', $fields) . " WHERE id = ?";
        $types .= 'i';
        $params[] = $id;
        $stmt = $this->db->prepare($sql, $types, $params);
        $stmt->close();

        return ['success' => true];
    }

    public function getTags()
    {
        $tagsTable = $this->tables['tags_table'];
        $tagCategoriesTable = $this->tables['tag_categories_table'];
        $tagCategoryIdField = $this->getTagCategoryIdField();

        $sql = "
            SELECT t.*, tc.name AS category_name
            FROM $tagsTable t
            JOIN $tagCategoriesTable tc ON t.$tagCategoryIdField = tc.id
            ORDER BY tc.sort_order, t.name
        ";

        $result = $this->db->query($sql);
        return $this->fetchAllAssoc($result);
    }

    public function getTagCategories()
    {
        $result = $this->db->query(
            "SELECT * FROM {$this->tables['tag_categories_table']} ORDER BY sort_order"
        );

        return $this->fetchAllAssoc($result);
    }

    public function addTag($data)
    {
        $tagCategoryId = $data['tag_category_id'] ?? $data['category_id'] ?? null;
        if ($tagCategoryId === null) {
            throw new Exception('tag_category_id is required');
        }

        $hexColor = isset($data['hex_color']) && $data['hex_color'] !== ''
            ? (string)$data['hex_color']
            : null;

        $stmt = $this->db->prepare(
            "INSERT INTO {$this->tables['tags_table']} ({$this->getTagCategoryIdField()}, name, slug, hex_color) VALUES (?, ?, ?, ?)",
            'isss',
            [
                (int)$tagCategoryId,
                (string)$data['name'],
                strtolower(str_replace(' ', '-', (string)$data['name'])),
                $hexColor,
            ]
        );
        $stmt->close();

        return ['success' => true, 'id' => $this->db->lastInsertId()];
    }

    public function deleteTag($id)
    {
        $tagId = (int)$id;
        $tagsTable = $this->tables['tags_table'];
        $tagsMapTable = $this->tables['tags_map_table'];
        $tagIdField = $this->getTagIdField();

        $countStmt = $this->db->prepare(
            "SELECT COUNT(*) AS count FROM $tagsMapTable WHERE $tagIdField = ?",
            'i',
            [$tagId]
        );
        $countResult = $countStmt->get_result();
        $row = $this->fetchOneAssoc($countResult);
        $countStmt->close();

        if ((int)$row['count'] > 0) {
            $mapStmt = $this->db->prepare(
                "DELETE FROM $tagsMapTable WHERE $tagIdField = ?",
                'i',
                [$tagId]
            );
            $mapStmt->close();
        }

        $tagStmt = $this->db->prepare(
            "DELETE FROM $tagsTable WHERE id = ?",
            'i',
            [$tagId]
        );
        $tagStmt->close();

        return ['success' => true, 'removed_from' => (int)$row['count']];
    }

    public function listAssets()
    {
        $assetTable = $this->tables['table'];
        $categoriesTable = $this->tables['categories_table'];
        $categoryIdField = $this->getCategoryIdField();
        $orderByMap = [
            'sticker' => 'c.name, a.id, a.name',
        ];
        $orderBy = isset($orderByMap[$this->assetType])
            ? $orderByMap[$this->assetType]
            : 'c.sort_order, a.sort_order, a.name';

        $sql = "
            SELECT a.*, c.name AS category_name, c.slug AS category_slug
            FROM $assetTable a
            JOIN $categoriesTable c ON a.$categoryIdField = c.id
            ORDER BY $orderBy
        ";

        $result = $this->db->query($sql);
        return $this->fetchAllAssoc($result);
    }

    public function getAsset($id)
    {
        $stmt = $this->db->prepare(
            "SELECT * FROM {$this->tables['table']} WHERE id = ?",
            'i',
            [(int)$id]
        );
        $result = $stmt->get_result();
        $asset = $this->fetchOneAssoc($result);
        $stmt->close();

        if (!$asset) {
            throw new Exception('Asset not found');
        }

        $asset['tags'] = $this->getAssetTags($id);
        return $asset;
    }

    protected function getAssetTags($assetId)
    {
        $tagsTable = $this->tables['tags_table'];
        $tagCategoriesTable = $this->tables['tag_categories_table'];
        $tagsMapTable = $this->tables['tags_map_table'];
        $assetIdField = $this->getAssetIdField();
        $tagIdField = $this->getTagIdField();
        $tagCategoryIdField = $this->getTagCategoryIdField();

        $sql = "
            SELECT t.id, t.name, t.hex_color, tc.name AS category_name
            FROM $tagsMapTable tm
            JOIN $tagsTable t ON tm.$tagIdField = t.id
            JOIN $tagCategoriesTable tc ON t.$tagCategoryIdField = tc.id
            WHERE tm.$assetIdField = ?
            ORDER BY tc.sort_order, t.name
        ";

        $stmt = $this->db->prepare($sql, 'i', [(int)$assetId]);
        $result = $stmt->get_result();
        $tags = $this->fetchAllAssoc($result);
        $stmt->close();

        return $tags;
    }

    public function updateAsset($data)
    {
        $this->updateAssetRecord(
            (int)$data['id'],
            $data,
            $this->getUpdateExtraAssignments($data)
        );

        if (isset($data['tags'])) {
            $this->saveAssetTags($data['id'], $data['tags']);
        }

        return ['success' => true];
    }

    public function deleteAsset($id)
    {
        $this->deleteAssetRecord($id);
        return ['success' => true];
    }

    public function reorderAssets($data)
    {
        $this->reorderAssetsByIds($data['order']);
        return ['success' => true];
    }

    public function analyzeAsset($id)
    {
        $asset = $this->getAssetUrlById($id);
        if (!$asset) {
            throw new Exception($this->getAssetDisplayName() . ' not found');
        }

        return $this->performAnalysis($asset['url']);
    }

    public function analyzeAllAssets()
    {
        $updated = 0;
        $errors = [];

        foreach ($this->getActiveAssetRows() as $asset) {
            try {
                $analysis = $this->performAnalysis($asset['url']);
                $this->persistAnalysis($asset['id'], $analysis);
                $updated++;
            } catch (Exception $e) {
                $errors[] = 'ID ' . $asset['id'] . ': ' . $e->getMessage();
            }
        }

        return [
            'success' => true,
            'updated' => $updated,
            'errors' => $errors,
        ];
    }

    public function exportAssets()
    {
        $assets = $this->listAssets();
        $formatted = [];

        foreach ($assets as $asset) {
            $tags = $this->getAssetTags($asset['id']);
            $tagNames = array_map(function ($tag) {
                return $tag['name'];
            }, $tags);
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

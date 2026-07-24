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
    abstract protected function getAddFieldMap();

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

    protected function assertUniqueUrl($url)
    {
        $stmt = $this->db->prepare(
            "SELECT id, name FROM {$this->tables['table']} WHERE url = ? LIMIT 1",
            's',
            [(string)$url]
        );
        $existing = $this->fetchOneAssoc($stmt->get_result());
        $stmt->close();
        if ($existing) {
            throw new Exception('URL is already used by ' . $existing['name'] . ' (ID ' . $existing['id'] . ')');
        }
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

    protected function getAssetOrderBy()
    {
        // Sticker ordering intentionally follows category/name until drag sorting is enabled there.
        return $this->assetType === 'sticker'
            ? 'c.name, a.id, a.name'
            : 'c.sort_order, a.sort_order, a.name';
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

        $this->db->beginTransaction();
        try {
            $deleteStmt = $this->db->prepare(
                "DELETE FROM $tagsMapTable WHERE $assetIdField = ?",
                'i',
                [$assetId]
            );
            $deleteStmt->close();
            $tagIds = array_values(array_unique(array_map('intval', $tagIds)));
            if ($tagIds) {
                $values = implode(',', array_fill(0, count($tagIds), '(?, ?)'));
                $params = [];
                foreach ($tagIds as $tagId) {
                    $params[] = $assetId;
                    $params[] = $tagId;
                }
                $insertStmt = $this->db->prepare(
                    "INSERT INTO $tagsMapTable ($assetIdField, $tagIdField) VALUES $values",
                    str_repeat('ii', count($tagIds)),
                    $params
                );
                $insertStmt->close();
            }
            $this->db->commit();
        } catch (Throwable $error) {
            $this->db->rollback();
            throw $error;
        }
    }

    protected function deleteAssetRecord($id)
    {
        $assetId = (int)$id;
        $tagsMapTable = $this->tables['tags_map_table'];
        $assetTable = $this->tables['table'];
        $assetIdField = $this->getAssetIdField();

        $this->db->beginTransaction();
        try {
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
            $this->db->commit();
        } catch (Throwable $error) {
            $this->db->rollback();
            throw $error;
        }
    }

    protected function reorderAssetsByIds($order)
    {
        $table = $this->tables['table'];
        $sql = "UPDATE $table SET sort_order = ? WHERE id = ?";

        $this->db->beginTransaction();
        try {
            foreach (array_values(array_unique(array_map('intval', $order))) as $index => $id) {
                $stmt = $this->db->prepare($sql, 'ii', [(int)$index, $id]);
                $stmt->close();
            }
            $this->db->commit();
        } catch (Throwable $error) {
            $this->db->rollback();
            throw $error;
        }
    }

    protected function getAssetUrlById($id)
    {
        $stmt = $this->db->prepare(
            "SELECT url, is_active FROM {$this->tables['table']} WHERE id = ?",
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

    protected function persistAnalysis($id, $analysis, $includeColors = true)
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
                has_transparency = ?,
                file_hash = ?
            WHERE id = ?
        ";

        $stmt = $this->db->prepare(
            $sql,
            'iiiiiiiisi',
            [
                (int)$analysis['width'],
                (int)$analysis['height'],
                (int)$analysis['file_size'],
                (int)$analysis['frame_count'],
                (int)$analysis['frame_rate'],
                (int)$analysis['is_variable_framerate'],
                (int)$analysis['is_animated'],
                (int)$analysis['has_transparency'],
                (string)($analysis['file_hash'] ?? ''),
                (int)$id,
            ]
        );
        $stmt->close();
    }

    protected function performAnalysis($url)
    {
        require_once('gifAnalyzer.php');

        $filePath = $this->assetFilePath($url);
        $analyzer = new GifAnalyzer($filePath, $this->config);
        $analysis = $analyzer->analyze();
        $fileSize = file_exists($filePath) ? filesize($filePath) : 0;
        $imageInfo = @getimagesize($filePath);
        $width = $imageInfo ? $imageInfo[0] : 0;
        $height = $imageInfo ? $imageInfo[1] : 0;

        return array_merge($analysis, [
            'width' => $width,
            'height' => $height,
            'file_size' => $fileSize,
            'has_transparency' => (int)($analysis['has_transparency'] ?? 0),
            'is_animated' => ($analysis['frame_count'] ?? 1) > 1 ? 1 : 0,
            'file_hash' => md5_file($filePath),
        ]);
    }

    protected function assetFilePath($url)
    {
        $root = realpath(__DIR__ . '/../..');
        $relative = str_replace('\\', '/', ltrim((string)$url, '/\\'));
        $segments = explode('/', $relative);
        if (!$relative || in_array('..', $segments, true) || in_array('', $segments, true)) {
            throw new Exception('Invalid asset path');
        }
        $candidate = $root . DIRECTORY_SEPARATOR . implode(DIRECTORY_SEPARATOR, $segments);
        $ancestor = dirname($candidate);
        while (!file_exists($ancestor) && dirname($ancestor) !== $ancestor) {
            $ancestor = dirname($ancestor);
        }
        $directory = realpath($ancestor);
        if ($directory === false || ($directory !== $root && strpos($directory, $root . DIRECTORY_SEPARATOR) !== 0)) {
            throw new Exception('Invalid asset path');
        }

        return $candidate;
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
        $this->backupExport($jsonPath);
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
        $orderBy = $this->getAssetOrderBy();

        $tagsMapTable = $this->tables['tags_map_table'];
        $tagsTable = $this->tables['tags_table'];
        $assetIdField = $this->getAssetIdField();
        $tagIdField = $this->getTagIdField();
        $sql = "
            SELECT a.*, c.name AS category_name, c.slug AS category_slug,
                ts.tag_names
            FROM $assetTable a
            JOIN $categoriesTable c ON a.$categoryIdField = c.id
            LEFT JOIN (
                SELECT tm.$assetIdField AS asset_id, GROUP_CONCAT(DISTINCT t.name SEPARATOR ' ') AS tag_names
                FROM $tagsMapTable tm
                JOIN $tagsTable t ON t.id = tm.$tagIdField
                GROUP BY tm.$assetIdField
            ) ts ON ts.asset_id = a.id
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

    public function addAsset($data)
    {
        $map = $this->getAddFieldMap();
        $columns = [];
        $placeholders = [];
        $types = '';
        $params = [];
        foreach ($map as $column => $definition) {
            $source = $definition['source'] ?? $column;
            $value = array_key_exists($source, $data) ? $data[$source] : ($definition['default'] ?? null);
            $columns[] = $column;
            $placeholders[] = '?';
            $types .= $definition['type'];
            $params[] = $value;
        }
        $this->assertUniqueUrl($data['url']);
        $stmt = $this->db->prepare(
            "INSERT INTO {$this->tables['table']} (" . implode(', ', $columns) . ') VALUES (' . implode(', ', $placeholders) . ')',
            $types,
            $params
        );
        $stmt->close();
        $id = $this->db->lastInsertId();
        try {
            $analysis = $this->performAnalysis($data['url']);
            $this->persistAnalysis($id, $analysis, true);
        } catch (Throwable $error) {
            error_log('Auto-analysis failed for ' . $this->assetType . ' ID ' . $id . ': ' . $error->getMessage());
        }
        return ['success' => true, 'id' => $id];
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

        return $this->enrichSuggestedTags($this->performAnalysis($asset['url']));
    }

    protected function enrichSuggestedTags($analysis)
    {
        require_once(__DIR__ . '/colorUtils.php');
        $tags = $this->getTags();
        $suggestions = $analysis['suggested_tags'] ?? [];
        foreach ($suggestions as &$suggestion) {
            foreach ($tags as $tag) {
                if (strcasecmp($tag['name'], $suggestion['name']) === 0) {
                    $suggestion['tag_id'] = (int)$tag['id'];
                    break;
                }
            }
        }
        unset($suggestion);

        if ($this->assetType === 'sticker' && !empty($analysis['color_codes'])) {
            foreach (explode(',', $analysis['color_codes']) as $index => $hex) {
                $rgb = hexToRgb($hex);
                if (!$rgb) continue;
                $best = null;
                $bestDistance = INF;
                foreach ($tags as $tag) {
                    $tagRgb = hexToRgb($tag['hex_color'] ?? '');
                    if (!$tagRgb) continue;
                    $distance = deltaE(rgbToLab($rgb[0], $rgb[1], $rgb[2]), rgbToLab($tagRgb[0], $tagRgb[1], $tagRgb[2]));
                    if ($distance < $bestDistance) {
                        $bestDistance = $distance;
                        $best = $tag;
                    }
                }
                if ($best && $bestDistance < $this->config['tag_match_distance']) {
                    $weight = explode(',', $analysis['color_weights'] ?? '')[$index] ?? '';
                    $suggestions[(int)$best['id']] = [
                        'tag_id' => (int)$best['id'],
                        'name' => $best['name'],
                        'reason' => 'color ' . $weight,
                    ];
                }
            }
            if (($analysis['sparkle_coverage'] ?? 0) >= $this->config['sparkle_tag_min_coverage']) {
                foreach ($tags as $tag) {
                    if (preg_match('/glitter|spark/i', $tag['name'])) {
                        $suggestions[(int)$tag['id']] = [
                            'tag_id' => (int)$tag['id'],
                            'name' => $tag['name'],
                            'reason' => 'sparkle ' . round($analysis['sparkle_coverage'] * 100) . '%',
                        ];
                        break;
                    }
                }
            }
        }
        $analysis['suggested_tags'] = array_values($suggestions);

        return $analysis;
    }

    public function analyzeAllAssets($ids = null, $includeColors = true)
    {
        $updated = 0;
        $errors = [];

        $assets = $this->getActiveAssetRows();
        if (is_array($ids)) {
            $wanted = array_flip(array_map('intval', $ids));
            $assets = array_values(array_filter($assets, function ($asset) use ($wanted) {
                return isset($wanted[(int)$asset['id']]);
            }));
        }
        foreach ($assets as $asset) {
            try {
                $analysis = $this->enrichSuggestedTags($this->performAnalysis($asset['url']));
                $this->persistAnalysis($asset['id'], $analysis, $includeColors);
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
        $assetTable = $this->tables['table'];
        $categoriesTable = $this->tables['categories_table'];
        $tagsTable = $this->tables['tags_table'];
        $tagsMapTable = $this->tables['tags_map_table'];
        $categoryIdField = $this->getCategoryIdField();
        $assetIdField = $this->getAssetIdField();
        $tagIdField = $this->getTagIdField();
        $orderBy = $this->getAssetOrderBy();
        $result = $this->db->query("
            SELECT a.*, c.name AS category_name, c.slug AS category_slug,
                ts.tag_names
            FROM $assetTable a
            JOIN $categoriesTable c ON a.$categoryIdField = c.id
            LEFT JOIN (
                SELECT tm.$assetIdField AS asset_id,
                    GROUP_CONCAT(DISTINCT t.name ORDER BY t.name SEPARATOR '||') AS tag_names
                FROM $tagsMapTable tm
                JOIN $tagsTable t ON t.id = tm.$tagIdField
                GROUP BY tm.$assetIdField
            ) ts ON ts.asset_id = a.id
            WHERE a.is_active = 1
            ORDER BY $orderBy
        ");
        $assets = $this->fetchAllAssoc($result);
        $formatted = [];

        foreach ($assets as $asset) {
            $tagNames = $asset['tag_names'] ? explode('||', $asset['tag_names']) : [];
            $formatted[] = $this->formatAssetForExport($asset, $tagNames);
        }

        return $formatted;
    }

    public function saveExport()
    {
        $assets = $this->exportAssets();
        $jsonPath = "../../" . $this->tables['json_file'];
        $json = json_encode($assets, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        $this->backupExport($jsonPath);
        $result = file_put_contents($jsonPath, $json);

        if ($result === false) {
            throw new Exception('Failed to write to ' . $jsonPath);
        }

        return ['success' => true, 'path' => $jsonPath, 'bytes' => $result];
    }

    protected function backupExport($jsonPath)
    {
        if (!file_exists($jsonPath)) {
            return;
        }
        $backupDirectory = dirname($jsonPath) . '/backup';
        if (!is_dir($backupDirectory) && !mkdir($backupDirectory, 0775, true)) {
            throw new Exception('Failed to create export backup directory');
        }
        $name = pathinfo($jsonPath, PATHINFO_FILENAME);
        $backup = $backupDirectory . '/' . $name . '.' . date('Ymd-His') . '.json';
        if (!copy($jsonPath, $backup)) {
            throw new Exception('Failed to back up previous export');
        }
        $backups = glob($backupDirectory . '/' . $name . '.*.json');
        rsort($backups);
        foreach (array_slice($backups, 3) as $oldBackup) {
            unlink($oldBackup);
        }
    }

    public function healthReport()
    {
        $rows = $this->listAssets();
        $urls = [];
        $missing = [];
        $inactive = [];
        foreach ($rows as $row) {
            $urls[$row['url']][] = $row;
            if (!file_exists($this->assetFilePath($row['url']))) {
                $missing[] = ['id' => (int)$row['id'], 'name' => $row['name'], 'url' => $row['url']];
            }
            if (!(int)$row['is_active']) {
                $inactive[] = ['id' => (int)$row['id'], 'name' => $row['name'], 'url' => $row['url']];
            }
        }
        $duplicates = [];
        foreach ($urls as $url => $assets) {
            if (count($assets) < 2) continue;
            $duplicates[] = [
                'url' => $url,
                'assets' => array_map(function ($asset) {
                    return ['id' => (int)$asset['id'], 'name' => $asset['name'], 'url' => $asset['url']];
                }, $assets),
            ];
        }
        $imageRoot = realpath(__DIR__ . '/../../images/' . $this->assetType);
        $orphans = [];
        if ($imageRoot) {
            $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($imageRoot, FilesystemIterator::SKIP_DOTS));
            foreach ($iterator as $file) {
                if (
                    !$file->isFile()
                    || !in_array(strtolower($file->getExtension()), ['gif', 'png', 'jpg', 'jpeg'], true)
                    || strpos($file->getPathname(), DIRECTORY_SEPARATOR . '.thumbs' . DIRECTORY_SEPARATOR) !== false
                ) {
                    continue;
                }
                $url = str_replace('\\', '/', substr($file->getPathname(), strlen(realpath(__DIR__ . '/../..')) + 1));
                if (!isset($urls[$url])) {
                    $orphans[] = ['url' => $url];
                }
            }
        }

        return ['missing' => $missing, 'orphans' => $orphans, 'duplicates' => $duplicates, 'inactive' => $inactive];
    }

    public function uploadAsset($file, $categoryId)
    {
        if (!isset($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
            throw new Exception('No valid upload received');
        }
        if ((int)$file['size'] > $this->config['upload_max_bytes']) {
            throw new Exception('File exceeds the upload size limit');
        }
        $header = file_get_contents($file['tmp_name'], false, null, 0, 12);
        $types = [
            'gif' => strncmp($header, 'GIF87a', 6) === 0 || strncmp($header, 'GIF89a', 6) === 0,
            'png' => substr($header, 0, 8) === "\x89PNG\r\n\x1a\n",
            'jpg' => substr($header, 0, 3) === "\xFF\xD8\xFF",
        ];
        $extension = array_search(true, $types, true);
        if ($extension === false) {
            throw new Exception('Only GIF, PNG, and JPEG files are accepted');
        }
        $hash = md5_file($file['tmp_name']);
        $stmt = $this->db->prepare(
            "SELECT id, name FROM {$this->tables['table']} WHERE file_hash = ? LIMIT 1",
            's',
            [$hash]
        );
        $duplicate = $this->fetchOneAssoc($stmt->get_result());
        $stmt->close();
        if ($duplicate) {
            return ['success' => false, 'duplicate' => true, 'existing' => $duplicate];
        }
        $categoryStmt = $this->db->prepare(
            "SELECT id, slug FROM {$this->tables['categories_table']} WHERE id = ?",
            'i',
            [(int)$categoryId]
        );
        $category = $this->fetchOneAssoc($categoryStmt->get_result());
        $categoryStmt->close();
        if (!$category) {
            throw new Exception('Invalid category');
        }
        if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $category['slug'])) {
            throw new Exception('Category slug is not safe for uploads');
        }
        $base = strtolower(pathinfo($file['name'], PATHINFO_FILENAME));
        $base = trim(preg_replace('/[^a-z0-9]+/', '-', $base), '-');
        $base = $base ?: $this->assetType;
        $directory = dirname(__DIR__, 2) . '/images/' . $this->assetType . '/' . $category['slug'];
        if (!is_dir($directory) && !mkdir($directory, 0775, true)) {
            throw new Exception('Could not create upload directory');
        }
        $filename = $base . '.' . $extension;
        for ($suffix = 2; file_exists($directory . '/' . $filename); $suffix++) {
            $filename = $base . '-' . $suffix . '.' . $extension;
        }
        $destination = $directory . '/' . $filename;
        if (!move_uploaded_file($file['tmp_name'], $destination)) {
            throw new Exception('Could not store uploaded file');
        }
        $url = 'images/' . $this->assetType . '/' . $category['slug'] . '/' . $filename;
        try {
            $result = $this->addAsset([
                'name' => ucwords(str_replace('-', ' ', $base)),
                'filename' => $filename,
                'url' => $url,
                'category_id' => (int)$category['id'],
                'is_active' => 0,
            ]);
            $stmt = $this->db->prepare(
                "UPDATE {$this->tables['table']} SET file_hash = ? WHERE id = ?",
                'si',
                [$hash, (int)$result['id']]
            );
            $stmt->close();
            if ($this->assetType === 'glitter') {
                $stmt = $this->db->prepare(
                    "UPDATE {$this->tables['table']} SET name = generated_name WHERE id = ? AND generated_name IS NOT NULL",
                    'i',
                    [(int)$result['id']]
                );
                $stmt->close();
            }
            return ['success' => true, 'id' => (int)$result['id'], 'url' => $url, 'pending' => true];
        } catch (Throwable $error) {
            unlink($destination);
            throw $error;
        }
    }

    public function rejectAsset($id)
    {
        $asset = $this->getAssetUrlById($id);
        if (!$asset) {
            throw new Exception('Asset not found');
        }
        if ((int)$asset['is_active']) {
            throw new Exception('Only pending assets can be rejected');
        }
        $path = $this->assetFilePath($asset['url']);
        $this->deleteAssetRecord($id);
        if (file_exists($path) && !unlink($path)) {
            throw new Exception('Database record deleted, but the file could not be removed');
        }
        return ['success' => true];
    }
}

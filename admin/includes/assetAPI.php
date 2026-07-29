<?php
require_once(__DIR__ . '/assetPathService.php');
require_once(__DIR__ . '/assetNaming.php');
require_once(__DIR__ . '/assetAnalysisResult.php');
require_once(__DIR__ . '/assetHealthService.php');
require_once(__DIR__ . '/assetIngestService.php');
require_once(__DIR__ . '/adminEventService.php');
require_once(__DIR__ . '/exportStateService.php');
require_once(__DIR__ . '/tagTaxonomyService.php');
// ============================================
// GENERIC ASSET API BASE CLASS
// ============================================
abstract class AssetAPI
{
    protected $db;
    protected $config;
    protected $assetType;
    protected $tables;
    protected $paths;
    protected $events;
    protected $exportState;
    protected $taxonomy;

    public function __construct($db, $config, $assetType)
    {
        if (!isset($config['asset_types'][$assetType])) {
            throw new InvalidArgumentException('Invalid asset type');
        }

        $this->db = $db;
        $this->config = $config;
        $this->assetType = $assetType;
        $this->tables = $config['asset_types'][$assetType];
        $this->paths = new AssetPathService($config);
        $this->events = new AdminEventService($db);
        $this->exportState = new ExportStateService($db);
        $this->taxonomy = new TagTaxonomyService($db, $this->tables, $assetType);
    }

    abstract protected function formatAssetForExport($asset, $tags, $searchTerms = []);
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
        // Both types drag-sort, so both honour category then asset sort_order.
        return 'c.sort_order, a.sort_order, a.name';
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

    protected function saveAssetTags($assetId, $tagIds, $transactional = true)
    {
        $assetId = (int)$assetId;
        $tagsMapTable = $this->tables['tags_map_table'];
        $assetIdField = $this->getAssetIdField();
        $tagIdField = $this->getTagIdField();

        if ($transactional) $this->db->beginTransaction();
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
            if ($transactional) $this->db->commit();
        } catch (Throwable $error) {
            if ($transactional) $this->db->rollback();
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

    // Drag-sorting the category manager rewrites sort_order in one pass, so
    // long lists never need per-row sort_order edits.
    public function reorderCategories($order)
    {
        $table = $this->tables['categories_table'];
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

        return ['success' => true];
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

    // Naming ids is an explicit instruction, so it reaches inactive rows too —
    // a pending asset with stale analysis is exactly what the health queue
    // asks to re-analyze. The unfiltered sweep stays active-only.
    protected function getAssetRowsByIds($ids)
    {
        $ids = array_values(array_filter(array_map('intval', (array)$ids)));
        if (!$ids) {
            return [];
        }
        $result = $this->db->query(
            "SELECT id, url FROM {$this->tables['table']} WHERE id IN (" . implode(',', $ids) . ')'
        );

        return $this->fetchAllAssoc($result);
    }

    protected function persistAnalysis($id, $analysis, $includeColors = true)
    {
        $table = $this->tables['table'];
        $normalized = $analysis['normalized'] ?? AssetAnalysisResult::fromAnalyzer(
            $analysis,
            $this->assetFilePath($this->getAssetUrlById($id)['url']),
            $this->config
        );
        // analyzed_at is this write's timestamp; updated_at stays the last
        // human edit. Bumping both made one Bulk Analyze stamp the whole
        // library as freshly edited, which flattens the sidebar's Recent list.
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
                file_hash = ?,
                analysis_json = ?,
                analysis_version = ?,
                analyzed_at = NOW()
            WHERE id = ?
        ";

        $stmt = $this->db->prepare(
            $sql,
            'iiiiiiiissii',
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
                json_encode($normalized, JSON_UNESCAPED_SLASHES),
                (int)$normalized['version'],
                (int)$id,
            ]
        );
        $stmt->close();
    }

    protected function performAnalysis($url)
    {
        $filePath = $this->assetFilePath($url);
        return $this->performAnalysisPath($filePath);
    }

    protected function performAnalysisPath($filePath)
    {
        require_once(__DIR__ . '/gifAnalyzer.php');

        $analyzer = new GifAnalyzer($filePath, $this->analysisConfig());
        $analysis = $analyzer->analyze();
        $fileSize = file_exists($filePath) ? filesize($filePath) : 0;
        $imageInfo = @getimagesize($filePath);
        $width = $imageInfo ? $imageInfo[0] : 0;
        $height = $imageInfo ? $imageInfo[1] : 0;

        $analysis = array_merge($analysis, [
            'width' => $width,
            'height' => $height,
            'file_size' => $fileSize,
            'has_transparency' => (int)($analysis['has_transparency'] ?? 0),
            'is_animated' => ($analysis['frame_count'] ?? 1) > 1 ? 1 : 0,
            'file_hash' => md5_file($filePath),
        ]);
        $analysis['normalized'] = AssetAnalysisResult::fromAnalyzer($analysis, $filePath, $this->analysisConfig());
        return $analysis;
    }

    // Illustration and pattern assets need different palette sensitivity, so
    // color analysis runs against this asset type's tuned copy of the config.
    protected function analysisConfig()
    {
        return array_merge($this->config, $this->config['analysis_type_overrides'][$this->assetType] ?? []);
    }

    protected function assetFilePath($url)
    {
        return $this->paths->urlToFile($url, $this->assetType);
    }

    public function getCategories()
    {
        $categoryIdField = $this->getCategoryIdField();
        $result = $this->db->query("
            SELECT c.*, SUM(CASE WHEN a.is_active = 1 THEN 1 ELSE 0 END) AS active_count
            FROM {$this->tables['categories_table']} c
            LEFT JOIN {$this->tables['table']} a ON a.$categoryIdField = c.id
            GROUP BY c.id
            ORDER BY c.sort_order, c.name
        ");
        $categories = $this->fetchAllAssoc($result);
        $pending = [];
        $pendingStmt = $this->db->prepare(
            "SELECT suggested_category_id, COUNT(*) AS count FROM asset_ingest
             WHERE asset_type = ? AND status IN ('uploaded', 'analyzing', 'ready', 'failed')
             GROUP BY suggested_category_id",
            's',
            [$this->assetType]
        );
        $pendingResult = $pendingStmt->get_result();
        while ($row = $pendingResult->fetch_assoc()) {
            $pending[(int)$row['suggested_category_id']] = (int)$row['count'];
        }
        $pendingStmt->close();
        foreach ($categories as &$category) {
            $category['active_count'] = (int)$category['active_count'];
            $category['pending_count'] = $pending[(int)$category['id']] ?? 0;
            $category['folder_url'] = $this->paths->categoryUrl($this->assetType, $category['slug']);
            try {
                $directory = $this->paths->categoryDirectory($this->assetType, $category['slug']);
                $category['folder_status'] = is_dir($directory) ? 'present' : 'missing';
            } catch (InvalidArgumentException $error) {
                $category['folder_status'] = 'invalid-slug';
            }
            $category['slug_locked'] = $category['active_count'] > 0 || $category['pending_count'] > 0;
        }
        unset($category);
        $root = $this->paths->managedRoot($this->assetType);
        if (is_dir($root)) {
            $known = array_flip(array_column($categories, 'slug'));
            foreach (new DirectoryIterator($root) as $directory) {
                $slug = $directory->getFilename();
                if (!$directory->isDir() || $directory->isDot() || $slug[0] === '.' || isset($known[$slug])) continue;
                $categories[] = [
                    'id' => null,
                    'name' => ucwords(str_replace('-', ' ', $slug)),
                    'slug' => $slug,
                    'folder_url' => $this->paths->categoryUrl($this->assetType, $slug),
                    'folder_status' => 'unregistered',
                    'active_count' => 0,
                    'pending_count' => 0,
                    'sort_order' => 999,
                ];
            }
        }
        return $categories;
    }

    public function addCategory($data)
    {
        $name = trim((string)($data['name'] ?? ''));
        $slug = $this->paths->validateSlug($data['slug'] ?? '');
        if ($name === '') throw new InvalidArgumentException('Category name is required');
        $this->assertCategorySlugAvailable($slug);
        $stmt = $this->db->prepare(
            "INSERT INTO {$this->tables['categories_table']} (name, slug, description, icon, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
            'sssssi',
            [
                $name,
                $slug,
                (string)($data['description'] ?? ''),
                (string)($data['icon'] ?? ''),
                (string)($data['color'] ?? '#ff69b4'),
                (int)($data['sort_order'] ?? 999),
            ]
        );
        $stmt->close();
        $id = $this->db->lastInsertId();
        $this->events->record('category', $id, 'category_created', ['asset_type' => $this->assetType, 'name' => $name, 'slug' => $slug]);
        $this->exportState->markDirty($this->assetType);
        $record = null;
        foreach ($this->getCategories() as $category) {
            if ((int)($category['id'] ?? 0) === (int)$id) $record = $category;
        }
        return ['success' => true, 'id' => $id, 'category' => $record];
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
        $this->events->record('category', $categoryId, 'category_deleted', ['asset_type' => $this->assetType]);
        $this->exportState->markDirty($this->assetType);
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
                LEFT JOIN $assetTable a ON c.id = a.$categoryIdField AND a.is_active = 1
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
                LEFT JOIN $assetTable a ON c.id = a.$categoryIdField AND a.is_active = 1
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
        $currentStmt = $this->db->prepare(
            "SELECT c.*, COUNT(a.id) AS asset_count
             FROM {$this->tables['categories_table']} c
             LEFT JOIN {$this->tables['table']} a ON a.{$this->getCategoryIdField()} = c.id
             WHERE c.id = ? GROUP BY c.id",
            'i',
            [$id]
        );
        $current = $this->fetchOneAssoc($currentStmt->get_result());
        $currentStmt->close();
        if (!$current) throw new InvalidArgumentException('Category not found');
        if (array_key_exists('slug', $data)) {
            $data['slug'] = $this->paths->validateSlug($data['slug']);
            $this->assertCategorySlugAvailable($data['slug'], $id);
        }
        $slugChanged = isset($data['slug']) && $data['slug'] !== $current['slug'];
        $oldPrefix = $this->paths->categoryUrl($this->assetType, $current['slug']);
        $newPrefix = $slugChanged ? $this->paths->categoryUrl($this->assetType, $data['slug']) : $oldPrefix;
        if ($slugChanged && isset($data['icon']) && strpos((string)$data['icon'], $oldPrefix) === 0) {
            $data['icon'] = $newPrefix . substr((string)$data['icon'], strlen($oldPrefix));
        }
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
        $directoryMoved = false;
        $sourceDirectory = null;
        $destinationDirectory = null;
        $this->db->beginTransaction();
        try {
            if ($slugChanged) {
                $invalidStmt = $this->db->prepare(
                    "SELECT COUNT(*) AS count FROM {$this->tables['table']}
                     WHERE {$this->getCategoryIdField()} = ?
                       AND LEFT(url, ?) <> ?
                       AND LEFT(url, ?) <> ?",
                    'iisis',
                    [$id, strlen($oldPrefix), $oldPrefix, strlen($newPrefix), $newPrefix]
                );
                $invalid = $this->fetchOneAssoc($invalidStmt->get_result());
                $invalidStmt->close();
                if ((int)$invalid['count'] > 0) {
                    throw new RuntimeException('Category contains asset URLs outside its canonical folder');
                }
                if (!preg_match('/^[a-zA-Z0-9_-]+$/', (string)$current['slug'])) {
                    throw new RuntimeException('Current category slug is not a safe path segment');
                }
                $sourceDirectory = $this->paths->managedRoot($this->assetType) . DIRECTORY_SEPARATOR . $current['slug'];
                $destinationDirectory = $this->paths->categoryDirectory($this->assetType, $data['slug']);
                $directoryMoved = $this->renameCategoryDirectory($sourceDirectory, $destinationDirectory, $id);
                $urlStmt = $this->db->prepare(
                    "UPDATE {$this->tables['table']}
                     SET url = CONCAT(?, SUBSTRING(url, ?))
                     WHERE {$this->getCategoryIdField()} = ? AND LEFT(url, ?) = ?",
                    'siiis',
                    [$newPrefix, strlen($oldPrefix) + 1, $id, strlen($oldPrefix), $oldPrefix]
                );
                $urlStmt->close();
            }
            $stmt = $this->db->prepare($sql, $types, $params);
            $stmt->close();
            $this->db->commit();
        } catch (Throwable $error) {
            $this->db->rollback();
            if ($directoryMoved) {
                try {
                    $this->renameCategoryDirectory($destinationDirectory, $sourceDirectory, $id);
                } catch (Throwable $rollbackError) {
                    throw new RuntimeException(
                        $error->getMessage() . '; folder rollback failed: ' . $rollbackError->getMessage(),
                        0,
                        $error
                    );
                }
            }
            throw $error;
        }
        $this->events->record('category', $id, 'category_updated', ['asset_type' => $this->assetType, 'fields' => array_keys($data)]);
        $this->exportState->markDirty($this->assetType);
        return ['success' => true];
    }

    // A category slug owns both a database prefix and a physical folder.
    // Case-only changes need a temporary hop on case-insensitive filesystems.
    private function renameCategoryDirectory($source, $destination, $categoryId)
    {
        if ($source === $destination || !is_dir($source)) {
            return false;
        }
        $sourceReal = realpath($source);
        $destinationReal = is_dir($destination) ? realpath($destination) : false;
        $sameDirectory = $sourceReal !== false
            && $destinationReal !== false
            && $sourceReal === $destinationReal;
        if (is_dir($destination) && !$sameDirectory) {
            throw new RuntimeException('A folder already exists for that category slug');
        }
        if (!$sameDirectory) {
            if (!rename($source, $destination)) {
                throw new RuntimeException('Could not rename the category folder');
            }
            return true;
        }

        $temporary = dirname($source) . DIRECTORY_SEPARATOR
            . '.category-rename-' . (int)$categoryId . '-' . bin2hex(random_bytes(4));
        if (!rename($source, $temporary)) {
            throw new RuntimeException('Could not prepare the case-only category rename');
        }
        if (!rename($temporary, $destination)) {
            rename($temporary, $source);
            throw new RuntimeException('Could not finish the case-only category rename');
        }
        return true;
    }

    protected function assertCategorySlugAvailable($slug, $excludeId = null)
    {
        $sql = "SELECT id FROM {$this->tables['categories_table']} WHERE slug = ?";
        $types = 's';
        $params = [$slug];
        if ($excludeId !== null) {
            $sql .= ' AND id <> ?';
            $types .= 'i';
            $params[] = (int)$excludeId;
        }
        $sql .= ' LIMIT 1';
        $stmt = $this->db->prepare($sql, $types, $params);
        $row = $this->fetchOneAssoc($stmt->get_result());
        $stmt->close();
        if ($row) throw new InvalidArgumentException('That category slug already exists');
    }

    public function getTags()
    {
        return $this->taxonomy->tags();
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

        $normalized = TagTaxonomyService::normalize($data['name'] ?? '');
        if ($normalized === '') throw new InvalidArgumentException('Tag name is required');
        foreach ($this->getTags() as $existing) {
            $aliases = array_map(['TagTaxonomyService', 'normalize'], $existing['aliases'] ?? []);
            if (TagTaxonomyService::normalize($existing['name']) === $normalized || in_array($normalized, $aliases, true)) {
                throw new InvalidArgumentException('A canonical tag or alias already matches that name');
            }
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
                str_replace(' ', '-', $normalized),
                $hexColor,
            ]
        );
        $stmt->close();
        $id = $this->db->lastInsertId();
        $this->events->record('tag', $id, 'tag_created', ['asset_type' => $this->assetType, 'name' => $data['name']]);
        $this->exportState->markDirty($this->assetType);
        return ['success' => true, 'id' => $id];
    }

    public function deleteTag($id)
    {
        $tagId = (int)$id;
        $tagsTable = $this->tables['tags_table'];
        $tagsMapTable = $this->tables['tags_map_table'];
        $tagAliasesTable = $this->tables['tag_aliases_table'];
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
        $aliasStmt = $this->db->prepare(
            "DELETE FROM $tagAliasesTable WHERE $tagIdField = ?",
            'i',
            [$tagId]
        );
        $aliasStmt->close();

        $tagStmt = $this->db->prepare(
            "DELETE FROM $tagsTable WHERE id = ?",
            'i',
            [$tagId]
        );
        $tagStmt->close();
        $this->events->record('tag', $tagId, 'tag_deleted', ['asset_type' => $this->assetType, 'removed_from' => (int)$row['count']]);
        $this->exportState->markDirty($this->assetType);
        return ['success' => true, 'removed_from' => (int)$row['count']];
    }

    public function updateTag($data)
    {
        $ids = isset($data['ids']) ? array_values(array_unique(array_map('intval', $data['ids']))) : [(int)$data['id']];
        $ids = array_values(array_filter($ids));
        if (!$ids) throw new InvalidArgumentException('Choose at least one tag');
        $assignments = [];
        $types = '';
        $params = [];
        if (array_key_exists('name', $data)) {
            if (count($ids) !== 1) throw new InvalidArgumentException('Batch rename is not supported');
            $name = trim((string)$data['name']);
            if ($name === '') throw new InvalidArgumentException('Tag name is required');
            $normalized = TagTaxonomyService::normalize($name);
            foreach ($this->getTags() as $existing) {
                if ((int)$existing['id'] === $ids[0]) continue;
                $aliases = array_map(['TagTaxonomyService', 'normalize'], $existing['aliases'] ?? []);
                if (TagTaxonomyService::normalize($existing['name']) === $normalized || in_array($normalized, $aliases, true)) {
                    throw new InvalidArgumentException('A canonical tag or alias already matches that name');
                }
            }
            $assignments[] = 'name = ?';
            $types .= 's';
            $params[] = $name;
            $assignments[] = 'slug = ?';
            $types .= 's';
            $params[] = str_replace(' ', '-', $normalized);
        }
        if (array_key_exists('category_id', $data)) {
            $assignments[] = $this->getTagCategoryIdField() . ' = ?';
            $types .= 'i';
            $params[] = (int)$data['category_id'];
        }
        if (!$assignments) throw new InvalidArgumentException('No tag fields to update');
        $idList = implode(',', $ids);
        $stmt = $this->db->prepare(
            "UPDATE {$this->tables['tags_table']} SET " . implode(', ', $assignments) . " WHERE id IN ($idList)",
            $types,
            $params
        );
        $stmt->close();
        $this->events->record('tag', implode(',', $ids), 'tag_updated', ['asset_type' => $this->assetType, 'fields' => array_keys($data)]);
        $this->exportState->markDirty($this->assetType);
        return ['success' => true, 'ids' => $ids];
    }

    public function addTagAlias($data)
    {
        $result = $this->taxonomy->addAlias((int)$data['tag_id'], $data['alias'] ?? '');
        $this->events->record('tag', (int)$data['tag_id'], 'tag_alias_added', ['asset_type' => $this->assetType, 'alias' => $data['alias'] ?? '']);
        $this->exportState->markDirty($this->assetType);
        return $result;
    }

    public function tagDuplicateCandidates()
    {
        return $this->taxonomy->duplicateCandidates();
    }

    public function mergeTags($data)
    {
        $result = $this->taxonomy->merge((int)$data['target_id'], $data['source_ids'] ?? []);
        $this->events->record('tag', (int)$data['target_id'], 'tags_merged', [
            'asset_type' => $this->assetType,
            'source_ids' => $result['merged_ids'],
        ]);
        $this->exportState->markDirty($this->assetType);
        return $result;
    }

    public function listAssets()
    {
        $assetTable = $this->tables['table'];
        $categoriesTable = $this->tables['categories_table'];
        $categoryIdField = $this->getCategoryIdField();
        $orderBy = $this->getAssetOrderBy();

        $tagsMapTable = $this->tables['tags_map_table'];
        $tagsTable = $this->tables['tags_table'];
        $tagAliasesTable = $this->tables['tag_aliases_table'];
        $assetIdField = $this->getAssetIdField();
        $tagIdField = $this->getTagIdField();
        $sql = "
            SELECT a.*, c.name AS category_name, c.slug AS category_slug,
                ts.tag_names, ats.alias_names
            FROM $assetTable a
            JOIN $categoriesTable c ON a.$categoryIdField = c.id
            LEFT JOIN (
                SELECT tm.$assetIdField AS asset_id, GROUP_CONCAT(DISTINCT t.name SEPARATOR ' ') AS tag_names
                FROM $tagsMapTable tm
                JOIN $tagsTable t ON t.id = tm.$tagIdField
                GROUP BY tm.$assetIdField
            ) ts ON ts.asset_id = a.id
            LEFT JOIN (
                SELECT tm.$assetIdField AS asset_id,
                    GROUP_CONCAT(DISTINCT ta.alias ORDER BY ta.alias SEPARATOR '||') AS alias_names
                FROM $tagsMapTable tm
                JOIN $tagAliasesTable ta ON ta.$tagIdField = tm.$tagIdField
                GROUP BY tm.$assetIdField
            ) ats ON ats.asset_id = a.id
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
        // The editor form always edits the effective palette, whichever
        // storage it came from, so both asset types present the same fields.
        $palette = $this->effectivePalette($asset);
        $asset['color_codes'] = implode(',', array_column($palette, 'hex'));
        $asset['color_weights'] = implode(',', array_map(function ($color) {
            return number_format((float)$color['weight'], 2, '.', '');
        }, $palette));
        $paletteType = $this->paletteTypeState($asset);
        $asset['palette_type'] = $paletteType['type'];
        $asset['palette_type_auto'] = $paletteType['auto'];
        $asset['palette_type_observed'] = $paletteType['observed'];
        return $asset;
    }

    // Single resolution order for "what colors does this asset have":
    // human override first, then the analyzer's observation, then the
    // legacy per-type columns. Used by getAsset and both exporters.
    protected function effectivePalette($asset)
    {
        $override = json_decode((string)($asset['palette_override_json'] ?? ''), true);
        if (is_array($override) && $override) {
            return array_values(array_map(function ($color) {
                return [
                    'hex' => strtoupper(is_array($color) ? $color['hex'] : $color),
                    'weight' => is_array($color) ? (float)($color['weight'] ?? 0) : 0.0,
                ];
            }, $override));
        }
        $analysis = AssetAnalysisResult::decode($asset['analysis_json'] ?? null);
        if (!empty($analysis['palette']['colors'])) {
            return array_values(array_map(function ($color) {
                return ['hex' => strtoupper($color['hex']), 'weight' => (float)$color['weight']];
            }, $analysis['palette']['colors']));
        }
        if (empty($asset['color_codes'])) {
            return [];
        }
        $codes = array_values(array_filter(array_map('trim', explode(',', (string)$asset['color_codes'])), 'strlen'));
        $weights = array_map('floatval', explode(',', (string)($asset['color_weights'] ?? '')));
        return array_values(array_map(function ($hex, $index) use ($weights, $codes) {
            return [
                'hex' => strtoupper($hex),
                'weight' => (float)($weights[$index] ?? round(1 / max(1, count($codes)), 4)),
            ];
        }, $codes, array_keys($codes)));
    }

    // Only the classifier's own vocabulary is accepted, so an override can
    // never publish a type the rest of the system does not understand. Empty
    // means "back to Auto".
    protected function normalizePaletteTypeOverride($value)
    {
        $value = trim((string)$value);
        if ($value === '') {
            return null;
        }
        if (!in_array($value, $this->config['palette_types'], true)) {
            throw new InvalidArgumentException('Unknown palette type: ' . $value);
        }

        return $value;
    }

    // Same resolution order as the palette: a human override wins, otherwise
    // the type is read from whatever palette the asset actually publishes.
    // Editing the color list therefore moves the type with it, and the
    // analyzer's own verdict stays visible as the observation it is.
    protected function paletteTypeState($asset)
    {
        $override = trim((string)($asset['palette_type_override'] ?? ''));
        $analysis = AssetAnalysisResult::decode($asset['analysis_json'] ?? null);
        $observed = $analysis['palette']['type'] ?? null;
        $editedPalette = json_decode((string)($asset['palette_override_json'] ?? ''), true);
        $auto = is_array($editedPalette) && $editedPalette
            ? AssetAnalysisResult::typeFromPalette($this->effectivePalette($asset), $this->analysisConfig())
            : $observed;

        return [
            'type' => $override !== '' ? $override : $auto,
            'auto' => $auto,
            'observed' => $observed,
            'override' => $override !== '' ? $override : null,
        ];
    }

    // Color edits land in palette_override_json for every asset type; the
    // per-type columns stay whatever the subclass chooses to keep in sync.
    protected function savePaletteOverride($id, $data)
    {
        $codes = array_values(array_filter(array_map('trim', explode(',', (string)($data['color_codes'] ?? ''))), 'strlen'));
        $weights = array_values(array_filter(array_map('trim', explode(',', (string)($data['color_weights'] ?? ''))), 'strlen'));
        if ($codes && count($codes) !== count($weights)) {
            throw new InvalidArgumentException('Color codes and weights must have the same length');
        }
        $palette = [];
        foreach ($codes as $index => $code) {
            $palette[] = ['hex' => strtoupper($code), 'weight' => (float)$weights[$index]];
        }
        $stmt = $this->db->prepare(
            "UPDATE {$this->tables['table']} SET palette_override_json = ? WHERE id = ?",
            'si',
            [$palette ? json_encode($palette, JSON_UNESCAPED_SLASHES) : null, (int)$id]
        );
        $stmt->close();
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
        if (array_key_exists('palette_type_override', $data)) {
            $data['palette_type_override'] = $this->normalizePaletteTypeOverride($data['palette_type_override']);
        }
        $this->updateAssetRecord(
            (int)$data['id'],
            $data,
            array_merge($this->getUpdateExtraAssignments($data), ['updated_at = NOW()'])
        );

        if (isset($data['tags'])) {
            $this->saveAssetTags($data['id'], $data['tags']);
        }
        if (array_key_exists('color_codes', $data) || array_key_exists('color_weights', $data)) {
            $this->savePaletteOverride((int)$data['id'], $data);
        }
        $this->events->record($this->assetType, (int)$data['id'], 'asset_updated', ['fields' => array_keys($data)]);
        $this->exportState->markDirty($this->assetType);
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
        $this->events->record($this->assetType, $id, 'asset_created', ['url' => $data['url']]);
        $this->exportState->markDirty($this->assetType);
        return ['success' => true, 'id' => $id];
    }

    // Renaming is a filesystem move plus a pointer update, so it applies
    // immediately rather than riding along with the form's Save: a half-applied
    // rename leaves the record pointing at a file that is no longer there. The
    // file stays in its current directory — moving between categories is a
    // category change, not a rename. Thumbnails are keyed by id, so they need
    // no work here.
    public function renameAssetFile($data)
    {
        $id = (int)($data['id'] ?? 0);
        $asset = $this->getAssetUrlById($id);
        if (!$asset) throw new InvalidArgumentException('Asset not found');
        $source = $this->paths->urlToFile($asset['url'], $this->assetType, true);
        $extension = strtolower(pathinfo($source, PATHINFO_EXTENSION));
        $base = $this->paths->sanitizeFilename((string)($data['filename'] ?? ''), '');
        if ($base === '') throw new InvalidArgumentException('Enter a file name');

        $directory = dirname($source);
        $folderUrl = substr($asset['url'], 0, strrpos($asset['url'], '/') + 1);
        if ($base . '.' . $extension === basename($source)) {
            return ['success' => true, 'url' => $asset['url'], 'filename' => basename($source), 'renamed' => false];
        }
        $filename = $this->paths->collisionSafeFilename($directory, $base, $extension);
        $url = $folderUrl . $filename;
        $this->assertUniqueUrl($url);
        $destination = $directory . DIRECTORY_SEPARATOR . $filename;

        $this->db->beginTransaction();
        try {
            if (!rename($source, $destination)) throw new RuntimeException('Could not rename the file on disk');
            $fields = ['url' => $url];
            if (in_array('filename', $this->getAssetSpecificFields()['string'], true)) {
                $fields['filename'] = $filename;
            }
            $this->updateAssetRecord($id, $fields, ['updated_at = NOW()']);
            $this->db->commit();
        } catch (Throwable $error) {
            $this->db->rollback();
            if (is_file($destination) && !is_file($source)) rename($destination, $source);
            throw $error;
        }

        $this->events->record($this->assetType, $id, 'asset_renamed', [
            'from' => $asset['url'],
            'to' => $url,
        ]);
        $this->exportState->markDirty($this->assetType);

        return ['success' => true, 'url' => $url, 'filename' => $filename, 'renamed' => true];
    }

    // Publishing a batch straight from the health queue. Only rows that are
    // actually inactive are counted, so re-running over a mixed selection
    // reports what it changed rather than what it was handed.
    public function activateAssets($ids)
    {
        $ids = array_values(array_filter(array_map('intval', (array)$ids)));
        if (!$ids) throw new InvalidArgumentException('Select at least one asset');
        $idList = implode(',', $ids);
        $stmt = $this->db->prepare(
            "UPDATE {$this->tables['table']}
             SET is_active = 1, approved_at = NOW(), approved_by = ?, updated_at = NOW()
             WHERE id IN ($idList) AND is_active = 0",
            's',
            [$_SESSION['admin_username'] ?? 'local-admin']
        );
        $activated = $stmt->affected_rows;
        $stmt->close();
        $this->events->record($this->assetType, implode(',', $ids), 'assets_activated', ['count' => $activated]);
        $this->exportState->markDirty($this->assetType);

        return ['success' => true, 'activated' => $activated, 'ids' => $ids];
    }

    public function deleteAsset($id)
    {
        $this->deleteAssetRecord($id);
        $this->events->record($this->assetType, (int)$id, 'asset_deleted');
        $this->exportState->markDirty($this->assetType);
        return ['success' => true];
    }

    public function reorderAssets($data)
    {
        $this->reorderAssetsByIds($data['order']);
        $this->exportState->markDirty($this->assetType);
        return ['success' => true];
    }

    public function analyzeAsset($id)
    {
        $asset = $this->getAssetUrlById($id);
        if (!$asset) {
            throw new Exception($this->getAssetDisplayName() . ' not found');
        }

        $analysis = $this->enrichSuggestedTags($this->performAnalysis($asset['url']));
        $this->persistObservation($id, $analysis);
        $this->events->record($this->assetType, (int)$id, 'asset_analyzed', [
            'analysis_version' => $this->config['analysis_version'],
        ]);
        $this->exportState->markDirty($this->assetType);
        return $analysis;
    }

    protected function persistObservation($id, $analysis)
    {
        $normalized = $analysis['normalized'];
        $stmt = $this->db->prepare(
            "UPDATE {$this->tables['table']}
             SET analysis_json = ?, analysis_version = ?, analyzed_at = NOW(), file_hash = ?, updated_at = NOW()
             WHERE id = ?",
            'sisi',
            [
                json_encode($normalized, JSON_UNESCAPED_SLASHES),
                (int)$normalized['version'],
                (string)($analysis['file_hash'] ?? ''),
                (int)$id,
            ]
        );
        $stmt->close();
    }

    protected function enrichSuggestedTags($analysis)
    {
        require_once(__DIR__ . '/colorUtils.php');
        $tags = $this->getTags();
        $config = $this->analysisConfig();
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
            $paletteType = $analysis['normalized']['palette']['type'] ?? 'limited';
            if (in_array($paletteType, ['multicolor', 'rainbow', 'complex-palette'], true)) {
                foreach ($tags as $tag) {
                    if (strcasecmp($tag['name'], $paletteType) === 0) {
                        $suggestions[(int)$tag['id']] = [
                            'tag_id' => (int)$tag['id'],
                            'name' => $tag['name'],
                            'reason' => 'palette classified as ' . $paletteType,
                        ];
                        break;
                    }
                }
            }
            $palette = [];
            $families = [];
            $weights = explode(',', $analysis['color_weights'] ?? '');
            foreach (explode(',', $analysis['color_codes']) as $index => $hex) {
                $weight = (float)($weights[$index] ?? 0);
                $rgb = hexToRgb($hex);
                if (!$rgb) continue;
                list($hue, $saturation, $value) = rgbToHSV($rgb[0], $rgb[1], $rgb[2]);
                $family = $saturation < $config['naming_min_saturation'] || $value < $config['naming_min_value']
                    ? neutralTagWord($value, $config['neutral_tag_words'])
                    : hueFamily($hue);
                $palette[] = ['rgb' => $rgb, 'weight' => $weight];
                if ($family !== null) {
                    $families[$family] = ($families[$family] ?? 0) + $weight;
                }
            }
            arsort($families, SORT_NUMERIC);
            $suggestedIds = [];
            foreach ($suggestions as $suggestion) {
                if (!empty($suggestion['tag_id'])) {
                    $suggestedIds[(int)$suggestion['tag_id']] = true;
                }
            }
            foreach ($families as $family => $weight) {
                if ($weight < $config['color_tag_min_family_weight']) continue;
                $normalizedFamily = TagTaxonomyService::normalize($family);
                foreach ($tags as $tag) {
                    $names = array_merge([$tag['name']], $tag['aliases'] ?? []);
                    $normalizedNames = array_map(['TagTaxonomyService', 'normalize'], $names);
                    if (!in_array($normalizedFamily, $normalizedNames, true)) continue;
                    $tagId = (int)$tag['id'];
                    if (!isset($suggestedIds[$tagId])) {
                        $suggestions[$tagId] = [
                            'tag_id' => $tagId,
                            'name' => $tag['name'],
                            'reason' => $family . ' family ' . round($weight * 100) . '%',
                        ];
                        $suggestedIds[$tagId] = true;
                    }
                    break;
                }
            }
            foreach ($palette as $entry) {
                $weight = $entry['weight'];
                if ($weight < $config['color_tag_min_family_weight']) continue;
                $rgb = $entry['rgb'];
                $best = null;
                $bestDistance = INF;
                foreach ($tags as $tag) {
                    $tagRgb = hexToRgb($tag['hex_color'] ?? '');
                    if (!$tagRgb) continue;
                    $distance = deltaE2000(rgbToLab($rgb[0], $rgb[1], $rgb[2]), rgbToLab($tagRgb[0], $tagRgb[1], $tagRgb[2]));
                    if ($distance < $bestDistance) {
                        $bestDistance = $distance;
                        $best = $tag;
                    }
                }
                if ($best
                    && !isset($suggestedIds[(int)$best['id']])
                    && $bestDistance < $config['tag_match_distance']) {
                    $tagId = (int)$best['id'];
                    $suggestions[$tagId] = [
                        'tag_id' => $tagId,
                        'name' => $best['name'],
                        'reason' => 'color ' . round($weight * 100) . '%',
                    ];
                    $suggestedIds[$tagId] = true;
                }
            }
            if (!empty($analysis['is_animated'])
                && ($analysis['sparkle_coverage'] ?? 0) >= $config['sparkle_tag_min_coverage']) {
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

        $assets = is_array($ids) ? $this->getAssetRowsByIds($ids) : $this->getActiveAssetRows();
        foreach ($assets as $asset) {
            try {
                $analysis = $this->enrichSuggestedTags($this->performAnalysis($asset['url']));
                $this->persistAnalysis($asset['id'], $analysis, $includeColors);
                $this->events->record($this->assetType, (int)$asset['id'], 'asset_analyzed', [
                    'analysis_version' => $this->config['analysis_version'],
                ]);
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
        $tagAliasesTable = $this->tables['tag_aliases_table'];
        $tagCategoriesTable = $this->tables['tag_categories_table'];
        $categoryIdField = $this->getCategoryIdField();
        $assetIdField = $this->getAssetIdField();
        $tagIdField = $this->getTagIdField();
        $tagCategoryIdField = $this->getTagCategoryIdField();
        $orderBy = $this->getAssetOrderBy();
        $result = $this->db->query("
            SELECT a.*, c.name AS category_name, c.slug AS category_slug,
                ts.tag_names, ats.alias_names
            FROM $assetTable a
            JOIN $categoriesTable c ON a.$categoryIdField = c.id
            LEFT JOIN (
                SELECT tm.$assetIdField AS asset_id,
                    GROUP_CONCAT(DISTINCT t.name ORDER BY t.name SEPARATOR '||') AS tag_names
                FROM $tagsMapTable tm
                JOIN $tagsTable t ON t.id = tm.$tagIdField
                JOIN $tagCategoriesTable tc ON tc.id = t.$tagCategoryIdField AND tc.slug <> 'internal'
                GROUP BY tm.$assetIdField
            ) ts ON ts.asset_id = a.id
            LEFT JOIN (
                SELECT tm.$assetIdField AS asset_id,
                    GROUP_CONCAT(DISTINCT ta.alias ORDER BY ta.alias SEPARATOR '||') AS alias_names
                FROM $tagsMapTable tm
                JOIN $tagsTable t ON t.id = tm.$tagIdField
                JOIN $tagCategoriesTable tc ON tc.id = t.$tagCategoryIdField AND tc.slug <> 'internal'
                JOIN $tagAliasesTable ta ON ta.$tagIdField = tm.$tagIdField
                GROUP BY tm.$assetIdField
            ) ats ON ats.asset_id = a.id
            WHERE a.is_active = 1
            ORDER BY $orderBy
        ");
        $assets = $this->fetchAllAssoc($result);
        $formatted = [];

        foreach ($assets as $asset) {
            $tagNames = $asset['tag_names'] ? explode('||', $asset['tag_names']) : [];
            $searchTerms = !empty($asset['alias_names']) ? explode('||', $asset['alias_names']) : [];
            $formatted[] = $this->formatAssetForExport($asset, $tagNames, $searchTerms);
        }

        return $formatted;
    }

    public function saveExport()
    {
        $assets = $this->exportAssets();
        $categories = $this->exportCategories();
        $jsonPath = "../../" . $this->tables['json_file'];
        $indexPath = preg_replace('/\.json$/', '.index.json', $jsonPath);
        $detailDirectory = preg_replace('/\.json$/', '', $jsonPath);
        $categoriesPath = "../../" . $this->tables['categories_json_file'];
        $json = json_encode($assets, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        $indexJson = json_encode(
            array_map([$this, 'formatAssetForBrowseIndex'], $assets),
            JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
        );
        $categoriesJson = json_encode($categories, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        $this->backupExport($jsonPath);
        $this->backupExport($indexPath);
        $this->backupExport($categoriesPath);
        $result = file_put_contents($jsonPath, $json);
        $indexResult = file_put_contents($indexPath, $indexJson);
        $categoriesResult = file_put_contents($categoriesPath, $categoriesJson);
        if (!is_dir($detailDirectory) && !mkdir($detailDirectory, 0775, true) && !is_dir($detailDirectory)) {
            throw new Exception('Failed to create asset detail export directory');
        }
        $detailBytes = 0;
        foreach ($assets as $asset) {
            $detailJson = json_encode($asset, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
            $detailResult = file_put_contents(
                $detailDirectory . '/' . rawurlencode((string)$asset['id']) . '.json',
                $detailJson
            );
            if ($detailResult === false) {
                throw new Exception('Failed to write an asset detail record');
            }
            $detailBytes += $detailResult;
        }
        if ($result === false || $indexResult === false || $categoriesResult === false) {
            throw new Exception('Failed to write a consistent asset/category export');
        }
        $hash = hash('sha256', $json);
        $this->exportState->markCurrent($this->assetType, $hash);
        $this->events->record('export', $this->assetType, 'export_generated', [
            'bytes' => $result + $indexResult + $detailBytes + $categoriesResult,
            'hash' => $hash,
        ]);
        return [
            'success' => true,
            'path' => $jsonPath,
            'index_path' => $indexPath,
            'detail_directory' => $detailDirectory,
            'categories_path' => $categoriesPath,
            'bytes' => $result + $indexResult + $detailBytes + $categoriesResult,
        ];
    }

    protected function formatAssetForBrowseIndex($asset)
    {
        $fields = [
            'id', 'name', 'filename', 'url', 'thumbnailUrl', 'category', 'attribution',
            'stickerText', 'tags', 'searchTerms', 'colors', 'generatedName', 'sortOrder',
            'isAnimated', 'hasTransparency', 'isPixelated', 'featured', 'source',
        ];
        return array_intersect_key($asset, array_flip($fields));
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
        return (new AssetHealthService($this->db, $this->config, $this->assetType))->report();
    }

    public function ingestUpload($file, $batchId = null)
    {
        $service = new AssetIngestService($this->db, $this->config);
        $result = $service->receive($this->assetType, $file, function ($path) {
            $analysis = $this->enrichSuggestedTags($this->performAnalysisPath($path));
            return [
                'normalized' => $analysis['normalized'],
                'suggested_tags' => $analysis['suggested_tags'] ?? [],
            ];
        }, $batchId);
        if (!empty($result['success'])) {
            $this->events->record('ingest', $result['item']['id'], 'asset_uploaded', [
                'asset_type' => $this->assetType,
                'batch_id' => $result['batch_id'],
                'filename' => $result['item']['original_filename'],
            ]);
        }
        return $result;
    }

    public function ingestList($status = null)
    {
        return (new AssetIngestService($this->db, $this->config))->list($this->assetType, $status);
    }

    public function ingestUpdate($data)
    {
        return (new AssetIngestService($this->db, $this->config))->update((int)$data['id'], $data);
    }

    public function ingestApprove($data)
    {
        $service = new AssetIngestService($this->db, $this->config);
        $item = $service->get((int)$data['id']);
        if ($item['asset_type'] !== $this->assetType || $item['status'] !== 'ready') {
            throw new InvalidArgumentException('Only ready items of this asset type can be approved');
        }
        $categoryId = (int)($data['category_id'] ?? $item['suggested_category_id']);
        $categoryStmt = $this->db->prepare(
            "SELECT id, slug FROM {$this->tables['categories_table']} WHERE id = ?",
            'i',
            [$categoryId]
        );
        $category = $this->fetchOneAssoc($categoryStmt->get_result());
        $categoryStmt->close();
        if (!$category) throw new InvalidArgumentException('Choose a valid category');
        $directory = $this->paths->categoryDirectory($this->assetType, $category['slug']);
        if (!is_dir($directory) && !mkdir($directory, 0775, true)) {
            throw new RuntimeException('Could not create category directory');
        }
        $source = $service->incomingPath($item);
        if (!is_file($source)) throw new RuntimeException('Incoming file is missing');
        $extension = pathinfo($item['incoming_filename'], PATHINFO_EXTENSION);
        $base = $this->paths->sanitizeFilename($item['incoming_filename'], $this->assetType);
        $filename = $this->paths->collisionSafeFilename($directory, $base, $extension);
        $destination = $directory . DIRECTORY_SEPARATOR . $filename;
        $url = $this->paths->categoryUrl($this->assetType, $category['slug']) . $filename;
        $this->db->beginTransaction();
        try {
            if (!rename($source, $destination)) throw new RuntimeException('Could not move incoming file');
            $result = $this->addAsset([
                'name' => trim((string)($data['name'] ?? $item['suggested_name'] ?? AssetNaming::displayName($item['original_filename'], $this->config, $base))),
                'filename' => $filename,
                'url' => $url,
                'category_id' => $categoryId,
                'is_active' => 1,
            ]);
            $finalAnalysis = $this->enrichSuggestedTags($this->performAnalysis($url));
            $this->persistAnalysis($result['id'], $finalAnalysis, true);
            $tagIds = array_values(array_unique(array_map('intval', $data['tags'] ?? [])));
            if ($tagIds) $this->saveAssetTags($result['id'], $tagIds, false);
            $stmt = $this->db->prepare(
                "UPDATE {$this->tables['table']}
                 SET approved_at = NOW(), approved_by = ?, original_filename = ?, original_ingest_id = ?, updated_at = NOW()
                 WHERE id = ?",
                'ssii',
                [
                    $_SESSION['admin_username'] ?? 'local-admin',
                    $item['original_filename'],
                    (int)$item['id'],
                    (int)$result['id'],
                ]
            );
            $stmt->close();
            $service->mark($item['id'], 'approved');
            $this->db->commit();
            if (!empty($item['thumbnail_url'])) {
                $incomingThumbnail = dirname($source) . DIRECTORY_SEPARATOR . basename($item['thumbnail_url']);
                if (is_file($incomingThumbnail)) unlink($incomingThumbnail);
            }
            @rmdir(dirname($source));
            $this->events->record('ingest', $item['id'], 'asset_approved', [
                'asset_type' => $this->assetType,
                'asset_id' => (int)$result['id'],
                'url' => $url,
            ]);
            $this->exportState->markDirty($this->assetType);
            return ['success' => true, 'id' => (int)$result['id'], 'url' => $url];
        } catch (Throwable $error) {
            $this->db->rollback();
            if (is_file($destination) && !is_file($source)) rename($destination, $source);
            throw $error;
        }
    }

    public function ingestReject($id, $reason = '')
    {
        $service = new AssetIngestService($this->db, $this->config);
        $item = $service->get((int)$id);
        if ($item['asset_type'] !== $this->assetType || in_array($item['status'], ['approved', 'rejected'], true)) {
            throw new InvalidArgumentException('Ingest item cannot be rejected');
        }
        $path = $service->incomingPath($item);
        if (is_file($path) && !unlink($path)) throw new RuntimeException('Could not remove incoming file');
        if (!empty($item['thumbnail_url'])) {
            $incomingThumbnail = dirname($path) . DIRECTORY_SEPARATOR . basename($item['thumbnail_url']);
            if (is_file($incomingThumbnail) && !unlink($incomingThumbnail)) {
                throw new RuntimeException('Could not remove incoming thumbnail');
            }
        }
        @rmdir(dirname($path));
        $service->mark($item['id'], 'rejected', $reason ?: null);
        $this->events->record('ingest', $item['id'], 'asset_rejected', ['asset_type' => $this->assetType, 'reason' => $reason]);
        return ['success' => true];
    }

    public function registerExisting($data)
    {
        $url = (string)($data['url'] ?? '');
        $this->paths->urlToFile($url, $this->assetType, true);
        $categoryId = (int)($data['category_id'] ?? 0);
        if (!$categoryId) {
            foreach ($this->getCategories() as $category) {
                if (!empty($category['id']) && strpos($url, $category['folder_url']) === 0) {
                    $categoryId = (int)$category['id'];
                    break;
                }
            }
        }
        if (!$categoryId) throw new InvalidArgumentException('Choose a category for this existing file');
        return $this->addAsset([
            'name' => (string)($data['name'] ?? AssetNaming::displayName($url, $this->config, basename($url))),
            'filename' => basename($url),
            'url' => $url,
            'category_id' => $categoryId,
            'is_active' => 0,
        ]);
    }

    public function storedAnalysis($id)
    {
        $stmt = $this->db->prepare(
            "SELECT analysis_json, analysis_version, analyzed_at, palette_override_json FROM {$this->tables['table']} WHERE id = ?",
            'i',
            [(int)$id]
        );
        $row = $this->fetchOneAssoc($stmt->get_result());
        $stmt->close();
        if (!$row) throw new InvalidArgumentException('Asset not found');
        return [
            'analysis' => AssetAnalysisResult::decode($row['analysis_json']),
            'version' => $row['analysis_version'] === null ? null : (int)$row['analysis_version'],
            'analyzed_at' => $row['analyzed_at'],
            'palette_override' => json_decode((string)$row['palette_override_json'], true),
        ];
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

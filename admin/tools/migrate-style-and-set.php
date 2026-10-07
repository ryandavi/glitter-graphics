<?php
// One-time move from "a set is a child category" to "a category is a style
// and a set is its own field". Run once from the CLI:
//
//   php admin/tools/migrate-style-and-set.php
//
// Rows of the touched tables and the current exports are copied to
// data/backup/style-and-set-<timestamp>/ first. No file under images/ moves.
// Safe to re-run: it does nothing once the category tables have no parent_id.

if (php_sapi_name() !== 'cli') {
	fwrite(STDERR, "This script is CLI-only.\n");
	exit(1);
}

require_once(__DIR__ . '/../includes/config.php');
require_once(__DIR__ . '/../includes/database.php');
require_once(__DIR__ . '/../includes/glitterAPI.php');
require_once(__DIR__ . '/../includes/stickerAPI.php');

class StyleAndSetMigration
{
	// A child category that is a look of its own, not a source's share of
	// its parent: it becomes a style beside the parent.
	const OWN_STYLES = ['noise-2'];

	private $db;
	private $table;
	private $categories;
	private $categoryField;

	public function __construct($db, $tables, $assetType)
	{
		$this->db = $db;
		$this->table = $tables['table'];
		$this->categories = $tables['categories_table'];
		$this->categoryField = $assetType . '_category_id';
	}

	private function rows($sql)
	{
		return $this->db->query($sql)->fetch_all(MYSQLI_ASSOC);
	}

	private function run($sql, $types = '', $params = [])
	{
		$this->db->prepare($sql, $types, $params)->close();
	}

	public function hasParents()
	{
		return (bool)$this->rows("SHOW COLUMNS FROM `{$this->categories}` LIKE 'parent_id'");
	}

	public function backupRows()
	{
		return [
			$this->categories => $this->rows("SELECT * FROM `{$this->categories}`"),
			$this->table => $this->rows("SELECT id, {$this->categoryField}, set_id, sort_order, attribution FROM `{$this->table}`"),
		];
	}

	private static function credit($json)
	{
		$decoded = json_decode((string)$json, true);
		if (!is_array($decoded)) return [];
		ksort($decoded);
		return $decoded;
	}

	public function apply()
	{
		$log = [];
		$categories = array_column($this->rows("SELECT * FROM `{$this->categories}`"), null, 'id');
		$bySlug = array_column($categories, null, 'slug');

		// A category named for the source it credits is that source's set.
		$sets = [];
		foreach ($categories as $category) {
			$source = self::credit($category['attribution'])['sourceId'] ?? null;
			if ($source !== null && $source === $category['slug'] && $category['parent_id'] !== null) $sets[$source] = (int)$category['id'];
			// A sourced root with no assets is a set waiting for its tiles.
			if ($source !== null && $source === $category['slug'] && $category['parent_id'] === null) {
				$used = $this->rows("SELECT COUNT(*) AS n FROM `{$this->table}` WHERE {$this->categoryField} = " . (int)$category['id'])[0]['n'];
				if (!(int)$used) $sets[$source] = (int)$category['id'];
			}
		}
		foreach ($sets as $slug => $id) {
			$this->run("UPDATE `{$this->categories}` SET is_set = 1, is_active = 1 WHERE id = ?", 'i', [$id]);
			$log[] = "set: $slug";
		}

		// Each asset takes the set of its resolved credit, and drops its own
		// copy of that credit.
		foreach ($this->rows("SELECT id, {$this->categoryField} AS category_id, attribution FROM `{$this->table}`") as $asset) {
			$own = self::credit($asset['attribution']);
			$resolved = $own ?: self::credit($categories[$asset['category_id']]['attribution'] ?? null);
			$setId = $sets[$resolved['sourceId'] ?? ''] ?? null;
			if ($setId === null) continue;
			$this->run("UPDATE `{$this->table}` SET set_id = ? WHERE id = ?", 'ii', [$setId, (int)$asset['id']]);
			if ($own && $own == self::credit($categories[$setId]['attribution'])) {
				$this->run("UPDATE `{$this->table}` SET attribution = NULL WHERE id = ?", 'i', [(int)$asset['id']]);
			}
		}

		// Assets of a set, and of a published child that is not a look of its
		// own, join the parent style after the tiles already there.
		foreach ($categories as $category) {
			if ($category['parent_id'] === null || in_array($category['slug'], self::OWN_STYLES, true)) continue;
			$isSet = in_array((int)$category['id'], $sets, true);
			if (!$isSet && !(int)$category['is_active']) continue;
			$parent = (int)$category['parent_id'];
			$next = (int)$this->rows("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM `{$this->table}` WHERE {$this->categoryField} = $parent")[0]['n'];
			$moving = $this->rows("SELECT id FROM `{$this->table}` WHERE {$this->categoryField} = " . (int)$category['id'] . " ORDER BY sort_order, name, id");
			foreach ($moving as $index => $asset) {
				$this->run("UPDATE `{$this->table}` SET {$this->categoryField} = ?, sort_order = ? WHERE id = ?", 'iii', [$parent, $next + $index, (int)$asset['id']]);
			}
			if ($moving) $log[] = count($moving) . " from {$category['slug']} to {$categories[$parent]['slug']}";
		}

		// A style credits nobody once its tiles carry a set.
		foreach ($categories as $category) {
			$source = self::credit($category['attribution'])['sourceId'] ?? null;
			if (in_array((int)$category['id'], $sets, true) || !isset($sets[$source ?? ''])) continue;
			$this->run("UPDATE `{$this->categories}` SET attribution = NULL WHERE id = ?", 'i', [(int)$category['id']]);
		}

		// Emptied children and unpublished categories that hold nothing go.
		foreach ($categories as $category) {
			if (in_array((int)$category['id'], $sets, true)) continue;
			$used = (int)$this->rows("SELECT COUNT(*) AS n FROM `{$this->table}` WHERE {$this->categoryField} = " . (int)$category['id'])[0]['n'];
			if ($used || ($category['parent_id'] === null && (int)$category['is_active'])) continue;
			if (in_array($category['slug'], self::OWN_STYLES, true)) continue;
			$this->run("DELETE FROM `{$this->categories}` WHERE id = ?", 'i', [(int)$category['id']]);
			$log[] = "deleted empty category: {$category['slug']}";
		}

		$this->db->query("ALTER TABLE `{$this->categories}` DROP COLUMN parent_id");
		return $log;
	}
}

$db = new Database($CONFIG);
$directory = __DIR__ . '/../../data/backup/style-and-set-' . date('Ymd-His');
$migrations = [];
foreach (['glitter' => 'GlitterAPI', 'sticker' => 'StickerAPI'] as $type => $class) {
	$migration = new StyleAndSetMigration($db, $CONFIG['asset_types'][$type], $type);
	if ($migration->hasParents()) $migrations[$type] = [$migration, $class];
}
if (!$migrations) {
	echo "Nothing to do: categories are already flat.\n";
	exit(0);
}
if (!is_dir($directory) && !mkdir($directory, 0775, true)) {
	fwrite(STDERR, "Could not create the backup directory.\n");
	exit(1);
}
foreach ($migrations as $type => $entry) {
	file_put_contents("$directory/$type-rows.json", json_encode($entry[0]->backupRows(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
	foreach (['json_file', 'categories_json_file'] as $key) {
		$file = __DIR__ . '/../../' . $CONFIG['asset_types'][$type][$key];
		if (is_file($file)) copy($file, $directory . '/' . basename($file));
	}
}
echo "Backup: $directory\n";
chdir(__DIR__ . '/../includes');
foreach ($migrations as $type => $entry) {
	echo "== $type\n";
	foreach ($entry[0]->apply() as $line) echo "  $line\n";
	(new $entry[1]($db, $CONFIG))->saveExport();
	echo "  exports regenerated\n";
}

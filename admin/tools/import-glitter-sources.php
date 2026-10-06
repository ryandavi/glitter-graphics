<?php
// CLI import: preview by default; apply only after reviewing the report on a clean tree.
require_once(__DIR__ . '/../includes/config.php');
require_once(__DIR__ . '/../includes/database.php');
require_once(__DIR__ . '/../includes/glitterAPI.php');
require_once(__DIR__ . '/../includes/stickerAPI.php');

class GlitterSourceImportAPI extends GlitterAPI
{
	public function analyzeLocal($path)
	{
		$analysis = $this->enrichSuggestedTags($this->performAnalysisPath($path));
		return ['normalized' => $analysis['normalized'], 'suggested_tags' => $analysis['suggested_tags'] ?? []];
	}
}

class GlitterSourceImport
{
	private $db;
	private $config;
	private $paths;
	private $map;
	private $root;

	public function __construct($db, $config, $map)
	{
		$this->db = $db;
		$this->config = $config;
		$this->paths = new AssetPathService($config);
		$this->root = $this->paths->managedRoot('glitter');
		$this->map = $map;
		foreach ($map['deferredFiles'] ?? [] as $file) {
			if (!preg_match('#^[a-zA-Z0-9_/-]+\.(gif|png|jpe?g)$#i', $file) || $file[0] === '/') throw new RuntimeException('Unsafe deferred file path');
		}
		$slugs = [];
		foreach (array_merge($map['roots'], $map['sets']) as $set) {
			$this->paths->validateSlug($set['slug']);
			if (isset($slugs[$set['slug']])) throw new RuntimeException('Duplicate set slug: ' . $set['slug']);
			$slugs[$set['slug']] = true;
		}
		$roots = array_column($map['roots'], 'slug');
		foreach ($map['sets'] as $set) {
			if (!in_array($set['parent'], $roots, true)) throw new RuntimeException('Sets must have a mapped style root');
			if (!in_array($set['names'], ['original', 'generated'], true)) throw new RuntimeException('Unknown naming policy');
			if (!in_array($set['source'] ?? $set['slug'], $map['precedence'], true)) throw new RuntimeException('Source missing from precedence');
		}
	}

	private function expandDirectories($pattern)
	{
		if (preg_match('/\{([^}]+)\}/', $pattern, $match)) {
			$result = [];
			foreach (explode(',', $match[1]) as $section) {
				$result = array_merge($result, $this->expandDirectories(str_replace($match[0], $section, $pattern)));
			}
			return $result;
		}
		if (strpos($pattern, '..') !== false || !preg_match('#^[a-z0-9_/-]+/$#', $pattern)) throw new RuntimeException('Unsafe source directory');
		return [$this->root . '/' . rtrim($pattern, '/')];
	}

	public function plan()
	{
		$rows = $this->db->query('SELECT g.*, c.slug AS category_slug FROM glitter g JOIN glitter_categories c ON c.id = g.glitter_category_id ORDER BY g.id')->fetch_all(MYSQLI_ASSOC);
		$byPath = [];
		foreach ($rows as $row) {
			$path = $this->paths->urlToFile($row['url'], 'glitter', true);
			$byPath[strtolower(str_replace('\\', '/', $path))][] = $row;
		}
		$sources = [];
		foreach ($this->map['sets'] as $order => $set) {
			$directories = $this->expandDirectories($set['from']);
			$directories[] = $this->paths->categoryDirectory('glitter', $set['slug']);
			foreach (array_unique($directories) as $sectionOrder => $directory) {
				$files = glob($directory . '/*') ?: [];
				sort($files, SORT_NATURAL | SORT_FLAG_CASE);
				foreach ($files as $fileOrder => $file) {
					if (!is_file($file) || !preg_match('/\.(gif|png|jpe?g)$/i', $file)) continue;
					$key = strtolower(str_replace('\\', '/', realpath($file)));
					$sources[$key] = ['set' => $set, 'rank' => array_search($set['source'] ?? $set['slug'], $this->map['precedence'], true), 'order' => $order, 'sort' => $sectionOrder * 1000 + $fileOrder];
				}
			}
		}
		$groups = [];
		$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($this->root, FilesystemIterator::SKIP_DOTS));
		foreach ($iterator as $file) {
			$relative = str_replace('\\', '/', substr($file->getPathname(), strlen($this->root) + 1));
			if (in_array($relative, $this->map['deferredFiles'] ?? [], true)) continue;
			if (!$file->isFile() || strpos($relative, 'ms-office-texture/') === 0 || strpos($relative, '.thumbs/') !== false || !preg_match('/\.(gif|png|jpe?g)$/i', $relative)) continue;
			$key = strtolower(str_replace('\\', '/', $file->getRealPath()));
			$source = $sources[$key] ?? null;
			$groups[md5_file($file->getPathname())][] = [
				'file' => $file->getPathname(), 'relative' => $relative, 'source' => $source,
				'rows' => $byPath[$key] ?? [], 'rank' => $source['rank'] ?? PHP_INT_MAX,
				'order' => $source['order'] ?? PHP_INT_MAX, 'sort' => $source['sort'] ?? 0,
			];
		}
		$plan = [];
		$destinations = [];
		foreach ($groups as $hash => $files) {
			usort($files, function ($a, $b) {
				return [$a['rank'], $a['order'], $a['sort'], $a['rows'][0]['id'] ?? PHP_INT_MAX, $a['relative']]
					<=> [$b['rank'], $b['order'], $b['sort'], $b['rows'][0]['id'] ?? PHP_INT_MAX, $b['relative']];
			});
			$winner = $files[0];
			$records = [];
			foreach ($files as $file) foreach ($file['rows'] as $row) $records[(int)$row['id']] = $row;
			ksort($records);
			$record = $records ? reset($records) : null;
			$set = $winner['source']['set'] ?? null;
			$slug = $set['slug'] ?? ($record['category_slug'] ?? 'unsorted');
			$original = $set ? pathinfo($winner['file'], PATHINFO_FILENAME) : ($record['original_name'] ?? null);
			$destination = $this->paths->categoryDirectory('glitter', $slug) . '/' . basename($winner['file']);
			$key = strtolower(str_replace('\\', '/', $destination));
			if (isset($destinations[$key]) && $destinations[$key] !== $hash) throw new RuntimeException('Two distinct images map to ' . $destination);
			if (is_file($destination) && md5_file($destination) !== $hash) throw new RuntimeException('Destination contains another image: ' . $destination);
			$destinations[$key] = $hash;
			$name = $record['name'] ?? null;
			if ($set && $set['names'] === 'original') {
				$name = preg_match('/^sparkbutton/i', $original) ? 'Spark Button' : AssetNaming::displayName($original . '.gif', $this->config, $original);
				$name = preg_replace('/ \((\d+)\)$/', ' $1', $name);
			}
			$appearances = [];
			$terms = [];
			foreach ($records as $row) {
				$terms = array_merge($terms, json_decode($row['search_terms'] ?? '[]', true) ?: []);
				$appearances = array_merge($appearances, json_decode($row['appearances'] ?? '[]', true) ?: []);
				if ($row['name'] !== $name) $terms[] = $row['name'];
			}
			foreach (array_slice($files, 1) as $loser) {
				if ($loser['source']) $appearances[] = ['set' => $loser['source']['set']['slug'], 'originalName' => pathinfo($loser['file'], PATHINFO_FILENAME)];
				else $terms[] = pathinfo($loser['file'], PATHINFO_FILENAME);
			}
			$unique = [];
			foreach ($appearances as $appearance) $unique[$appearance['set'] . ':' . $appearance['originalName']] = $appearance;
			$plan[] = compact('hash', 'files', 'winner', 'record', 'records', 'set', 'slug', 'original', 'destination', 'name') + [
				'appearances' => array_values($unique), 'terms' => array_values(array_unique($terms)),
				'action' => !$set && !$record ? 'queue' : ($record ? (!$set && $record['category_slug'] === $slug && str_replace('\\', '/', $winner['file']) === str_replace('\\', '/', $destination) ? 'keep' : 'rehome') : 'new'),
			];
		}
		return $plan;
	}

	public function report($plan)
	{
		foreach ($this->map['deferredFiles'] ?? [] as $file) echo 'DEFER ', $file, " (left untouched)\n";
		echo "Planned categories (counts remain owned tiles only):\n";
		foreach (array_merge($this->map['roots'], $this->map['sets']) as $set) {
			echo '  ', $set['slug'], ' — ', $set['name'], ' (parent: ', $set['parent'] ?? 'none', ')', isset($set['renameFrom']) ? ' rename from ' . $set['renameFrom'] : '', "\n";
		}
		foreach ($this->map['stickerCategories'] ?? [] as $category) {
			echo '  Sticker creator/source ids: ', $category['slug'], ' -> ', $category['attribution']['authorId'], ' / ', $category['attribution']['sourceId'], "\n";
		}
		$counts = [];
		foreach ($plan as $entry) {
			$slug = $entry['slug'];
			if (!isset($counts[$slug])) $counts[$slug] = ['new' => 0, 'rehome' => 0, 'keep' => 0, 'queue' => 0, 'dropped' => 0];
			$counts[$slug][$entry['action']]++;
			$counts[$slug]['dropped'] += count($entry['files']) - 1;
			echo strtoupper($entry['action']), ' ', $entry['winner']['relative'], ' -> ', $entry['action'] === 'queue' ? 'ingest queue (Unsorted)' : 'images/glitter/' . $slug . '/' . basename($entry['destination']), "\n";
			foreach ($entry['files'] as $index => $file) {
				if (!$file['rows']) echo '  NO RECORD ', $file['relative'], "\n";
				foreach ($file['rows'] as $row) {
					if (dirname($file['relative']) !== $row['category_slug']) echo '  WRONG FOLDER #', $row['id'], ' ', $file['relative'], ' (category ', $row['category_slug'], ")\n";
				}
				if ($index) echo '  DROP ', $file['relative'], "\n";
			}
			foreach ($entry['appearances'] as $appearance) echo '  ALSO ', $appearance['set'], ' as ', $appearance['originalName'], "\n";
		}
		echo "\nPer-set totals (owned images; carried-over tiles excluded):\n";
		foreach ($counts as $slug => $count) echo $slug, ': ', json_encode($count), "\n";
		echo count($plan), " distinct in-scope images. Microsoft textures are excluded.\n";
		return $counts;
	}

	private function makeDirectory($path)
	{
		if (!is_dir($path) && !mkdir($path, 0775, true)) throw new RuntimeException('Could not create ' . $path);
	}

	public function backup($directory)
	{
		$this->makeDirectory($directory);
		$tables = $this->db->query('SHOW TABLES')->fetch_all(MYSQLI_NUM);
		$dump = '';
		foreach ($tables as $table) {
			$name = $table[0];
			$create = $this->db->query("SHOW CREATE TABLE `$name`")->fetch_row()[1];
			$dump .= "DROP TABLE IF EXISTS `$name`;\n$create;\n";
			foreach ($this->db->query("SELECT * FROM `$name`")->fetch_all(MYSQLI_ASSOC) as $row) {
				$values = array_map(function ($value) { return $value === null ? 'NULL' : "'" . $this->db->escape($value) . "'"; }, array_values($row));
				$dump .= "INSERT INTO `$name` VALUES (" . implode(',', $values) . ");\n";
			}
		}
		if (file_put_contents($directory . '/database.sql', "SET FOREIGN_KEY_CHECKS=0;\n" . $dump . "SET FOREIGN_KEY_CHECKS=1;\n") === false) throw new RuntimeException('Database backup failed');
		foreach (['glitter.json', 'glitter.index.json', 'glitter-categories.json', 'stickers.json', 'stickers.index.json', 'sticker-categories.json'] as $name) {
			if (!copy(__DIR__ . '/../../data/' . $name, $directory . '/' . $name)) throw new RuntimeException('Export backup failed');
		}
		$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($this->root, FilesystemIterator::SKIP_DOTS));
		foreach ($iterator as $file) {
			if (!$file->isFile()) continue;
			$destination = $directory . '/images/' . substr($file->getPathname(), strlen($this->root) + 1);
			$this->makeDirectory(dirname($destination));
			if (!copy($file->getPathname(), $destination)) throw new RuntimeException('Image backup failed');
		}
	}

	private function upsertCategories($api)
	{
		$ids = [];
		foreach (array_merge($this->map['roots'], $this->map['sets']) as $set) {
			$stmt = $this->db->prepare('SELECT * FROM glitter_categories WHERE slug = ? OR slug = ? ORDER BY slug = ? DESC LIMIT 1', 'sss', [$set['slug'], $set['renameFrom'] ?? $set['slug'], $set['slug']]);
			$row = $stmt->get_result()->fetch_assoc();
			$stmt->close();
			$data = ['name' => $set['name'], 'slug' => $set['slug'], 'sort_order' => $set['sort_order'], 'parent_id' => isset($set['parent']) ? $ids[$set['parent']] : null];
			if (isset($set['attribution'])) $data['attribution'] = $set['attribution'];
			if ($row) {
				if ($row['slug'] !== $set['slug']) {
					$used = $this->db->prepare('SELECT COUNT(*) AS count FROM glitter WHERE glitter_category_id = ?', 'i', [(int)$row['id']]);
					if ((int)$used->get_result()->fetch_assoc()['count']) throw new RuntimeException('Only empty source placeholders may be renamed');
					$used->close();
					$this->db->prepare('UPDATE glitter_categories SET slug = ? WHERE id = ?', 'si', [$set['slug'], (int)$row['id']])->close();
				}
				unset($data['slug']);
				$api->updateCategory($data + ['id' => (int)$row['id']]);
				$ids[$set['slug']] = (int)$row['id'];
			} else $ids[$set['slug']] = $api->addCategory($data)['id'];
		}
		return $ids;
	}

	public function apply($plan)
	{
		$api = new GlitterSourceImportAPI($this->db, $this->config);
		$ingest = new AssetIngestService($this->db, $this->config);
		$ids = $this->upsertCategories($api);
		foreach ($plan as $entry) {
			$winner = $entry['winner'];
			$destination = $entry['destination'];
			$record = $entry['record'];
			if ($entry['action'] === 'queue' || !$record) {
				$received = $ingest->receiveLocalFile('glitter', $winner['file'], [$api, 'analyzeLocal']);
				if (!empty($received['duplicate'])) {
					if ($received['existing']['kind'] !== 'incoming') throw new RuntimeException('Unexpected published duplicate during import');
				}
				$item = !empty($received['duplicate']) ? $ingest->get($received['existing']['id']) : $received['item'];
				if ($item['status'] !== 'ready') throw new RuntimeException('Analysis failed for ' . $winner['file'] . ': ' . ($item['error'] ?? 'unknown error'));
				$ingest->update($item['id'], ['suggested_category_id' => $ids[$entry['slug']]]);
				if ($entry['action'] !== 'queue') {
					$name = $entry['name'];
					$approved = $api->ingestApprove(['id' => $item['id'], 'category_id' => $ids[$entry['slug']], 'name' => $name ?: $item['suggested_name'], 'tags' => array_column($item['suggested_tags'], 'tag_id')]);
					$record = ['id' => $approved['id']];
					$approvedPath = $this->paths->urlToFile($approved['url'], 'glitter', true);
					if (strtolower(str_replace('\\', '/', $approvedPath)) !== strtolower(str_replace('\\', '/', $destination))) {
						if (is_file($destination) && md5_file($destination) !== $entry['hash']) throw new RuntimeException('Destination conflict');
						if (is_file($destination) && !unlink($destination)) throw new RuntimeException('Could not replace source copy');
						if (!rename($approvedPath, $destination)) throw new RuntimeException('Could not preserve original filename');
					}
				}
			}
			if ($record) {
				$this->makeDirectory(dirname($destination));
				if (!is_file($destination)) {
					if (!copy($winner['file'], $destination)) throw new RuntimeException('Move failed');
				} elseif (md5_file($destination) !== $entry['hash']) throw new RuntimeException('Destination conflict');
				$url = $this->paths->categoryUrl('glitter', $entry['slug']) . basename($destination);
				$asset = $api->getAsset($record['id']);
				$name = $entry['name'] ?: ($asset['generated_name'] ?: $asset['name']);
				$sort = $entry['set'] ? $winner['sort'] : (int)($asset['sort_order'] ?? 0);
				$active = $entry['set'] ? 1 : (int)$asset['is_active'];
				$this->db->prepare('UPDATE glitter SET glitter_category_id = ?, url = ?, name = ?, original_name = ?, appearances = ?, search_terms = ?, file_hash = ?, sort_order = ?, is_active = ?, updated_at = NOW() WHERE id = ?', 'issssssiii', [
					$ids[$entry['slug']], $url, $name, $entry['original'], json_encode($entry['appearances'], JSON_UNESCAPED_SLASHES), json_encode($entry['terms']), $entry['hash'], $sort, $active, (int)$record['id'],
				])->close();
				foreach ($entry['records'] as $old) {
					if ((int)$old['id'] === (int)$record['id']) continue;
					$this->db->prepare('INSERT INTO glitter_tags_map (glitter_id, glitter_tag_id, is_auto_generated) SELECT ?, source.glitter_tag_id, source.is_auto_generated FROM glitter_tags_map source WHERE source.glitter_id = ? AND NOT EXISTS (SELECT 1 FROM glitter_tags_map target WHERE target.glitter_id = ? AND target.glitter_tag_id = source.glitter_tag_id)', 'iii', [(int)$record['id'], (int)$old['id'], (int)$record['id']])->close();
					$api->deleteAsset($old['id']);
				}
			}
			foreach ($entry['files'] as $file) {
				if ($record && strtolower(str_replace('\\', '/', $file['file'])) === strtolower(str_replace('\\', '/', $destination))) continue;
				if (is_file($file['file']) && !unlink($file['file'])) throw new RuntimeException('Could not drop duplicate/source ' . $file['file']);
			}
		}
		// Repair covers that referred to a copy removed by the import.
		$categories = $api->getCategories();
		$assets = $api->exportAssets();
		foreach ($categories as $category) {
			if (!$category['id']) continue;
			$own = array_values(array_filter($assets, function ($asset) use ($category) { return $asset['category'] === $category['slug']; }));
			$children = array_column(array_filter($categories, function ($child) use ($category) { return (int)($child['parent_id'] ?? 0) === (int)$category['id']; }), 'slug');
			$descendants = array_values(array_filter($assets, function ($asset) use ($children) { return in_array($asset['category'], $children, true); }));
			$cover = $own[0]['url'] ?? $descendants[0]['url'] ?? '';
			$api->updateCategory(['id' => $category['id'], 'icon' => $cover]);
		}
		$directories = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($this->root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
		foreach ($directories as $directory) {
			if ($directory->isDir() && count(scandir($directory->getPathname())) === 2) rmdir($directory->getPathname());
		}
		$oldCwd = getcwd();
		chdir(__DIR__ . '/../includes');
		try {
			$api->saveExport();
			if (!empty($this->map['stickerCategories'])) {
				$stickers = new StickerAPI($this->db, $this->config);
				$categories = $stickers->getCategories();
				foreach ($this->map['stickerCategories'] as $mapped) {
					foreach ($categories as $category) {
						if ($category['slug'] === $mapped['slug'] && $category['id']) {
							$stickers->updateCategory(['id' => $category['id'], 'attribution' => array_merge($mapped['attribution'], $category['attribution'] ?? [], array_intersect_key($mapped['attribution'], array_flip(['authorId', 'sourceId'])))]);
						}
					}
				}
				$stickers->saveExport();
			}
		} finally { chdir($oldCwd); }
	}
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
	if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI-only'); }
	try {
		$options = getopt('', ['apply', 'map:']);
		$apply = isset($options['apply']);
		$mapPath = $options['map'] ?? __DIR__ . '/../../data/admin-incoming/glitter-sources-map.json';
		$map = json_decode(file_get_contents($mapPath), true, 512, JSON_THROW_ON_ERROR);
		$db = new Database($CONFIG, false);
		$import = new GlitterSourceImport($db, $CONFIG, $map);
		$plan = $import->plan();
		$import->report($plan);
		if (!$apply) { echo "DRY RUN: no database or file changes. Review before --apply.\n"; exit(0); }
		$git = shell_exec('git -C ' . escapeshellarg(realpath(__DIR__ . '/../..')) . ' status --porcelain');
		if ($git === null || trim($git) !== '') throw new RuntimeException('--apply requires a clean git tree; commit code changes separately first');
		$backup = __DIR__ . '/../../data/backup/glitter-source-import-' . date('Ymd-His');
		$import->backup($backup);
		echo 'Backup: ', $backup, "\n";
		$db = new Database($CONFIG);
		$import = new GlitterSourceImport($db, $CONFIG, $map);
		$import->apply($plan);
		echo "Import complete; exports regenerated. Commit the data reorganization separately.\n";
	} catch (Throwable $error) {
		fwrite(STDERR, $error->getMessage() . "\n");
		exit(1);
	}
}

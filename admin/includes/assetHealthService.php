<?php

require_once(__DIR__ . '/assetPathService.php');
require_once(__DIR__ . '/exportStateService.php');

class AssetHealthService
{
	private $db;
	private $config;
	private $assetType;
	private $tables;
	private $paths;

	public function __construct($db, $config, $assetType)
	{
		$this->db = $db;
		$this->config = $config;
		$this->assetType = $assetType;
		$this->tables = $config['asset_types'][$assetType];
		$this->paths = new AssetPathService($config);
	}

	public function report()
	{
		$categoryId = $this->assetType . '_category_id';
		$result = $this->db->query(
			"SELECT a.*, c.name AS category_name, c.slug AS category_slug
			 FROM {$this->tables['table']} a
			 LEFT JOIN {$this->tables['categories_table']} c ON c.id = a.$categoryId
			 ORDER BY a.id"
		);
		$issues = [];
		$urls = [];
		while ($row = $result->fetch_assoc()) {
			$urls[$row['url']][] = $row;
			$this->inspectRow($row, $issues);
		}
		foreach ($urls as $url => $rows) {
			if (count($rows) < 2) continue;
			$issues[] = $this->item('duplicate', $rows[0], [
				'records' => array_map(function ($row) {
					return [
						'id' => (int)$row['id'],
						'name' => $row['name'],
						'category' => $row['category_name'],
					];
				}, $rows),
				'row_count' => count($rows),
			], ['review_records', 'copy_url']);
		}
		$this->findOrphans($urls, $issues);
		$pending = $this->pendingItems();
		foreach ($pending as $row) {
			$issues[] = [
				'issue' => 'pending',
				'severity' => $this->severity('pending'),
				'asset_type' => $this->assetType,
				'id' => (int)$row['id'],
				'name' => $row['suggested_name'] ?: $row['original_filename'],
				'url' => null,
				'thumbnail_url' => null,
				'category' => null,
				'details' => ['status' => $row['status'], 'ingest' => true],
				'actions' => ['review_ingest'],
			];
		}
		$order = ['pending' => 0, 'missing' => 1, 'duplicate' => 2, 'orphan' => 3, 'analysis_missing' => 4, 'analysis_stale' => 4];
		usort($issues, function ($a, $b) use ($order) {
			return ($order[$a['issue']] ?? 8) <=> ($order[$b['issue']] ?? 8);
		});
		$summary = [];
		foreach ($issues as $issue) $summary[$issue['issue']] = ($summary[$issue['issue']] ?? 0) + 1;
		return [
			'asset_type' => $this->assetType,
			'checked_at' => gmdate('c'),
			'summary' => $summary,
			'issues' => $issues,
			'healthy' => count($issues) === 0,
			'export' => (new ExportStateService($this->db))->status($this->assetType),
		];
	}

	private function inspectRow($row, &$issues)
	{
		if (!(int)$row['is_active']) {
			$issues[] = $this->item('pending', $row, ['ingest' => false, 'legacy_inactive' => true], ['open_record']);
		}
		$file = $this->paths->urlToFile($row['url'], $this->assetType);
		if (!is_file($file)) {
			$issues[] = $this->item('missing', $row, [], ['open_record', 'replace_file', 'deactivate'], false);
			return;
		}
		if (!is_readable($file) || filesize($file) === 0) {
			$issues[] = $this->item('unreadable_file', $row, ['bytes' => (int)@filesize($file)], ['open_record', 'replace_file']);
		}
		$extension = strtolower(pathinfo($file, PATHINFO_EXTENSION));
		if (!isset($this->config['allowed_asset_types'][$extension])) {
			$issues[] = $this->item('unsafe_file_type', $row, ['extension' => $extension], ['open_record', 'replace_file']);
		}
		if (empty($row['analysis_json']) || empty($row['analyzed_at'])) {
			$issues[] = $this->item('analysis_missing', $row, [], ['reanalyze']);
		} elseif (!empty($row['file_hash']) && md5_file($file) !== $row['file_hash']) {
			$issues[] = $this->item('analysis_stale', $row, ['stored_hash' => $row['file_hash']], ['reanalyze']);
		}
		$expectedPrefix = $this->paths->categoryUrl($this->assetType, $row['category_slug']);
		if (strpos($row['url'], $expectedPrefix) !== 0) {
			$issues[] = $this->item('category_path_mismatch', $row, ['expected_prefix' => $expectedPrefix], ['open_record']);
		}
		if ($this->assetType === 'sticker' && (
			empty($row['thumbnail_url'])
			|| !is_file($this->paths->urlToFile($row['thumbnail_url']))
		)) {
			$issues[] = $this->item('thumbnail_missing', $row, [], ['reanalyze']);
		}
	}

	private function findOrphans($knownUrls, &$issues)
	{
		$root = $this->paths->managedRoot($this->assetType);
		if (!is_dir($root)) return;
		$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
		foreach ($iterator as $file) {
			if (!$file->isFile() || strpos($file->getPathname(), DIRECTORY_SEPARATOR . '.thumbs' . DIRECTORY_SEPARATOR) !== false) continue;
			$extension = strtolower($file->getExtension());
			if (!isset($this->config['allowed_asset_types'][$extension])) continue;
			$url = $this->paths->fileToUrl($file->getPathname(), $this->assetType);
			if (isset($knownUrls[$url])) continue;
			$parts = explode('/', $url);
			$issues[] = [
				'issue' => 'orphan',
				'severity' => $this->severity('orphan'),
				'asset_type' => $this->assetType,
				'id' => null,
				'name' => basename($url),
				'url' => $url,
				'thumbnail_url' => $url,
				'category' => count($parts) > 2 ? $parts[count($parts) - 2] : null,
				'details' => ['bytes' => (int)$file->getSize()],
				'actions' => ['review_add', 'copy_url'],
			];
		}
	}

	private function pendingItems()
	{
		$stmt = $this->db->prepare(
			"SELECT id, original_filename, suggested_name, status FROM asset_ingest
			 WHERE asset_type = ? AND status IN ('uploaded', 'analyzing', 'ready', 'failed')
			 ORDER BY created_at",
			's',
			[$this->assetType]
		);
		$result = $stmt->get_result();
		$rows = [];
		while ($row = $result->fetch_assoc()) $rows[] = $row;
		$stmt->close();
		return $rows;
	}

	private function item($issue, $row, $details, $actions, $preview = true)
	{
		return [
			'issue' => $issue,
			'severity' => $this->severity($issue),
			'asset_type' => $this->assetType,
			'id' => (int)$row['id'],
			'name' => $row['name'],
			'url' => $row['url'],
			'thumbnail_url' => $preview ? ($row['thumbnail_url'] ?? $row['url']) : null,
			'category' => $row['category_name'] ?? null,
			'details' => $details,
			'actions' => $actions,
		];
	}

	private function severity($issue)
	{
		return $this->config['health_severity'][$issue] ?? 'info';
	}
}

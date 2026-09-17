<?php

require_once(__DIR__ . '/assetPathService.php');
require_once(__DIR__ . '/assetVariantService.php');
require_once(__DIR__ . '/exportStateService.php');

class AssetHealthService
{
	private $db;
	private $config;
	private $assetType;
	private $tables;
	private $paths;
	private $variants;

	public function __construct($db, $config, $assetType)
	{
		$this->db = $db;
		$this->config = $config;
		$this->assetType = $assetType;
		$this->tables = $config['asset_types'][$assetType];
		$this->paths = new AssetPathService($config);
		$this->variants = new AssetVariantService($config);
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
			], ['review_records']);
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
		} elseif ((int)$row['analysis_version'] !== (int)$this->config['analysis_version']) {
			// The file is unchanged but the rules that read it moved on, so the
			// stored palette and type no longer match what analysis produces.
			$issues[] = $this->item('analysis_stale', $row, [
				'stored_version' => (int)$row['analysis_version'],
				'current_version' => (int)$this->config['analysis_version'],
			], ['reanalyze']);
		}
		$expectedPrefix = $this->paths->categoryUrl($this->assetType, $row['category_slug']);
		if (strpos($row['url'], $expectedPrefix) !== 0) {
			$issues[] = $this->item('category_path_mismatch', $row, ['expected_prefix' => $expectedPrefix], ['open_record']);
		}
	}

	// A file is only a "variant" of another (and never listed as its own
	// orphan) when a base file with the same stem exists — see
	// docs/STICKER-MULTI-RESOLUTION-PLAN.md's "Variant detection rule". This
	// runs as a standing scan, not just at initial add, so a `_1024` sibling
	// dropped next to a sticker that's been live for months is picked up the
	// same way a brand-new one would be, and surfaces as `variant_available`
	// on the existing row rather than a fresh orphan.
	private function findOrphans($knownUrls, &$issues)
	{
		$root = $this->paths->managedRoot($this->assetType);
		if (!is_dir($root)) return;
		$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));

		// Multi-resolution variants are a sticker-only concept (see
		// docs/STICKER-MULTI-RESOLUTION-PLAN.md's Scope) — every other asset
		// type keeps the plain orphan-only scan it always had.
		$variantAware = $this->assetType === 'sticker';

		$plainFiles = [];
		$variantsByBaseUrl = [];
		foreach ($iterator as $file) {
			if (!$file->isFile() || strpos($file->getPathname(), DIRECTORY_SEPARATOR . '.thumbs' . DIRECTORY_SEPARATOR) !== false) continue;
			$extension = strtolower($file->getExtension());
			if (!isset($this->config['allowed_asset_types'][$extension])) continue;

			$directory = dirname($file->getPathname());
			$filename = $file->getFilename();
			$parsed = $variantAware ? $this->variants->parseVariantFilename($filename) : null;
			if (!$parsed) {
				$plainFiles[] = $file;
				continue;
			}

			// The base file may not exist (that's exactly the orphaned_variant
			// case), so its URL is derived from this file's own real URL
			// rather than resolved through fileToUrl(), which requires the
			// path it's given to exist on disk.
			$url = $this->paths->fileToUrl($file->getPathname(), $this->assetType);
			$baseUrl = substr($url, 0, strrpos($url, '/') + 1) . $parsed['baseStem'] . '.' . $extension;
			$baseExists = $this->variants->baseFileExists($directory, $parsed['baseStem'], $extension) || isset($knownUrls[$baseUrl]);
			if (!$baseExists) {
				$issues[] = [
					'issue' => 'orphaned_variant',
					'severity' => $this->severity('orphaned_variant'),
					'asset_type' => $this->assetType,
					'id' => null,
					'name' => basename($url),
					'url' => $url,
					'thumbnail_url' => $url,
					'category' => null,
					'details' => ['expected_base' => $baseUrl],
					'actions' => [],
				];
				continue;
			}
			$dimensions = @getimagesize($file->getPathname());
			if (!$dimensions) continue;
			$width = (int)$dimensions[0];
			$variantsByBaseUrl[$baseUrl][(string)$width] = ['url' => $url, 'width' => $width, 'height' => (int)$dimensions[1]];
		}

		foreach ($plainFiles as $file) {
			$url = $this->paths->fileToUrl($file->getPathname(), $this->assetType);
			$detectedVariants = $variantsByBaseUrl[$url] ?? [];
			if (isset($knownUrls[$url])) {
				$row = $knownUrls[$url][0];
				$newVariants = array_diff_key($detectedVariants, $this->variants->decodeVariantUrls($row['variant_urls'] ?? null));
				if (!$newVariants) continue;
				$issues[] = [
					'issue' => 'variant_available',
					'severity' => $this->severity('variant_available'),
					'asset_type' => $this->assetType,
					'id' => (int)$row['id'],
					'name' => $row['name'],
					'url' => $url,
					'thumbnail_url' => $url,
					'category' => $row['category_name'] ?? null,
					'details' => ['variants' => $newVariants],
					'actions' => ['attach_variants'],
				];
				continue;
			}
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
				'details' => ['bytes' => (int)$file->getSize(), 'variants' => $detectedVariants],
				'actions' => ['review_add'],
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
			'thumbnail_url' => $preview ? $row['url'] : null,
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

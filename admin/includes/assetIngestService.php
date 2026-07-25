<?php

require_once(__DIR__ . '/assetPathService.php');

class AssetIngestService
{
	private $db;
	private $config;
	private $paths;

	public function __construct($db, $config)
	{
		$this->db = $db;
		$this->config = $config;
		$this->paths = new AssetPathService($config);
	}

	public function receive($assetType, $file, $analyze, $batchId = null)
	{
		$inspection = $this->paths->inspectUpload($file);
		$hash = md5_file($file['tmp_name']);
		$duplicate = $this->findDuplicate($assetType, $hash);
		if ($duplicate) {
			return ['success' => true, 'duplicate' => true, 'existing' => $duplicate];
		}
		$batchId = $batchId ?: $this->uuid();
		$directory = $this->paths->incomingDirectory($assetType, $batchId);
		if (!is_dir($directory) && !mkdir($directory, 0775, true)) {
			throw new RuntimeException('Could not create incoming directory');
		}
		$base = $this->paths->sanitizeFilename($file['name'], $assetType);
		$filename = $this->paths->collisionSafeFilename($directory, $base, $inspection['extension']);
		$destination = $directory . DIRECTORY_SEPARATOR . $filename;
		if (!move_uploaded_file($file['tmp_name'], $destination)) {
			throw new RuntimeException('Could not store incoming file');
		}
		$suggestedName = ucwords(str_replace('-', ' ', $base));
		$stmt = $this->db->prepare(
			'INSERT INTO asset_ingest
			 (batch_id, asset_type, incoming_filename, original_filename, file_hash, status, suggested_name, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
			'sssssss',
			[$batchId, $assetType, $filename, (string)$file['name'], $hash, 'analyzing', $suggestedName]
		);
		$stmt->close();
		$id = $this->db->lastInsertId();
		try {
			$analysis = $analyze($destination);
			$thumbnail = $this->generateThumbnail($destination);
			$stmt = $this->db->prepare(
				'UPDATE asset_ingest SET status = ?, analysis_json = ?, suggested_tags_json = ?, thumbnail_url = ?, updated_at = NOW() WHERE id = ?',
				'ssssi',
				[
					'ready',
					json_encode($analysis['normalized'], JSON_UNESCAPED_SLASHES),
					json_encode($analysis['suggested_tags'] ?? [], JSON_UNESCAPED_SLASHES),
					$thumbnail ? basename($thumbnail) : null,
					$id,
				]
			);
			$stmt->close();
		} catch (Throwable $error) {
			$stmt = $this->db->prepare(
				'UPDATE asset_ingest SET status = ?, error = ?, updated_at = NOW() WHERE id = ?',
				'ssi',
				['failed', $error->getMessage(), $id]
			);
			$stmt->close();
		}
		return ['success' => true, 'batch_id' => $batchId, 'item' => $this->get($id)];
	}

	public function list($assetType = null, $status = null)
	{
		$where = [];
		$types = '';
		$params = [];
		if ($assetType !== null) {
			$where[] = 'asset_type = ?';
			$types .= 's';
			$params[] = $assetType;
		}
		if ($status !== null) {
			$where[] = 'status = ?';
			$types .= 's';
			$params[] = $status;
		}
		$sql = 'SELECT * FROM asset_ingest' . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY created_at DESC, id DESC';
		$stmt = $this->db->prepare($sql, $types, $params);
		$result = $stmt->get_result();
		$rows = [];
		while ($row = $result->fetch_assoc()) $rows[] = $this->format($row);
		$stmt->close();
		return $rows;
	}

	public function get($id)
	{
		$stmt = $this->db->prepare('SELECT * FROM asset_ingest WHERE id = ?', 'i', [(int)$id]);
		$row = $stmt->get_result()->fetch_assoc();
		$stmt->close();
		if (!$row) throw new InvalidArgumentException('Ingest item not found');
		return $this->format($row);
	}

	public function update($id, $data)
	{
		$allowed = [
			'suggested_name' => 's',
			'suggested_category_id' => 'i',
			'suggested_tags_json' => 's',
		];
		$fields = [];
		$types = '';
		$params = [];
		foreach ($allowed as $field => $type) {
			if (!array_key_exists($field, $data)) continue;
			$fields[] = "$field = ?";
			$types .= $type;
			$params[] = $field === 'suggested_tags_json' && is_array($data[$field])
				? json_encode($data[$field])
				: $data[$field];
		}
		if (!$fields) throw new InvalidArgumentException('No ingest fields to update');
		$fields[] = 'updated_at = NOW()';
		$types .= 'i';
		$params[] = (int)$id;
		$stmt = $this->db->prepare(
			'UPDATE asset_ingest SET ' . implode(', ', $fields) . ' WHERE id = ?',
			$types,
			$params
		);
		$stmt->close();
		return ['success' => true, 'item' => $this->get($id)];
	}

	public function mark($id, $status, $error = null)
	{
		if (!in_array($status, ['uploaded', 'analyzing', 'ready', 'approved', 'rejected', 'failed'], true)) {
			throw new InvalidArgumentException('Invalid ingest state');
		}
		$stmt = $this->db->prepare(
			'UPDATE asset_ingest SET status = ?, error = ?, updated_at = NOW() WHERE id = ?',
			'ssi',
			[$status, $error, (int)$id]
		);
		$stmt->close();
	}

	public function incomingPath($item)
	{
		return $this->paths->incomingDirectory($item['asset_type'], $item['batch_id']) .
			DIRECTORY_SEPARATOR . $item['incoming_filename'];
	}

	private function findDuplicate($assetType, $hash)
	{
		$table = $this->config['asset_types'][$assetType]['table'];
		$stmt = $this->db->prepare("SELECT id, name, url FROM $table WHERE file_hash = ? LIMIT 1", 's', [$hash]);
		$row = $stmt->get_result()->fetch_assoc();
		$stmt->close();
		if ($row) return ['kind' => 'published', 'id' => (int)$row['id'], 'name' => $row['name'], 'url' => $row['url']];
		$stmt = $this->db->prepare(
			"SELECT id, original_filename FROM asset_ingest WHERE asset_type = ? AND file_hash = ? AND status NOT IN ('rejected', 'failed') LIMIT 1",
			'ss',
			[$assetType, $hash]
		);
		$row = $stmt->get_result()->fetch_assoc();
		$stmt->close();
		return $row ? ['kind' => 'incoming', 'id' => (int)$row['id'], 'name' => $row['original_filename']] : null;
	}

	private function format($row)
	{
		foreach (['id', 'suggested_category_id'] as $field) {
			$row[$field] = $row[$field] === null ? null : (int)$row[$field];
		}
		$row['analysis'] = json_decode((string)$row['analysis_json'], true);
		$row['suggested_tags'] = json_decode((string)$row['suggested_tags_json'], true) ?: [];
		unset($row['analysis_json'], $row['suggested_tags_json']);
		return $row;
	}

	private function uuid()
	{
		$bytes = random_bytes(16);
		$bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
		$bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
		return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
	}

	private function generateThumbnail($sourcePath)
	{
		$info = @getimagesize($sourcePath);
		if (!$info) return null;
		$loaders = [
			IMAGETYPE_GIF => 'imagecreatefromgif',
			IMAGETYPE_PNG => 'imagecreatefrompng',
			IMAGETYPE_JPEG => 'imagecreatefromjpeg',
		];
		if (!isset($loaders[$info[2]]) || !($source = @$loaders[$info[2]]($sourcePath))) return null;
		$max = (int)$this->config['thumbnail_max_size'];
		$scale = min(1, $max / max(imagesx($source), imagesy($source)));
		$width = max(1, (int)round(imagesx($source) * $scale));
		$height = max(1, (int)round(imagesy($source) * $scale));
		$thumb = imagecreatetruecolor($width, $height);
		imagealphablending($thumb, false);
		imagesavealpha($thumb, true);
		imagefill($thumb, 0, 0, imagecolorallocatealpha($thumb, 0, 0, 0, 127));
		imagecopyresampled($thumb, $source, 0, 0, 0, 0, $width, $height, imagesx($source), imagesy($source));
		$path = $sourcePath . '.thumb.png';
		$written = imagepng($thumb, $path);
		imagedestroy($source);
		imagedestroy($thumb);
		return $written ? $path : null;
	}
}

<?php

class AssetPathService
{
	private $config;
	private $projectRoot;

	public function __construct($config)
	{
		$this->config = $config;
		$this->projectRoot = realpath(__DIR__ . '/../..');
	}

	public function validateAssetType($assetType)
	{
		if (!isset($this->config['managed_asset_roots'][$assetType])) {
			throw new InvalidArgumentException('Invalid asset type');
		}
		return $assetType;
	}

	public function validateSlug($slug)
	{
		$slug = (string)$slug;
		if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $slug)) {
			throw new InvalidArgumentException('Category slug may contain lowercase letters, numbers, and single hyphens only');
		}
		return $slug;
	}

	public function sanitizeFilename($filename, $fallback = 'asset')
	{
		$name = strtolower(pathinfo((string)$filename, PATHINFO_FILENAME));
		$name = trim(preg_replace('/[^a-z0-9]+/', '-', $name), '-');
		return $name ?: $fallback;
	}

	public function managedRoot($assetType)
	{
		$this->validateAssetType($assetType);
		return $this->projectRoot . DIRECTORY_SEPARATOR .
			str_replace('/', DIRECTORY_SEPARATOR, $this->config['managed_asset_roots'][$assetType]);
	}

	public function categoryDirectory($assetType, $slug)
	{
		return $this->managedRoot($assetType) . DIRECTORY_SEPARATOR . $this->validateSlug($slug);
	}

	public function categoryUrl($assetType, $slug)
	{
		$this->validateAssetType($assetType);
		if (!preg_match('/^[a-zA-Z0-9_-]+$/', (string)$slug)) {
			throw new InvalidArgumentException('Category slug is not a safe path segment');
		}
		return $this->config['managed_asset_roots'][$assetType] . '/' . $slug . '/';
	}

	public function urlToFile($url, $assetType = null, $mustExist = false)
	{
		$relative = str_replace('\\', '/', ltrim((string)$url, '/\\'));
		if (!$relative || preg_match('#(?:^|/)\.\.(?:/|$)#', $relative)) {
			throw new InvalidArgumentException('Invalid asset URL');
		}
		if ($assetType !== null) {
			$prefix = $this->config['managed_asset_roots'][$this->validateAssetType($assetType)] . '/';
			if (strpos($relative, $prefix) !== 0) {
				throw new InvalidArgumentException('URL is outside the managed asset root');
			}
		}
		$file = $this->projectRoot . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
		$ancestor = file_exists($file) ? realpath($file) : realpath(dirname($file));
		if ($ancestor !== false && $ancestor !== $this->projectRoot && strpos($ancestor, $this->projectRoot . DIRECTORY_SEPARATOR) !== 0) {
			throw new InvalidArgumentException('URL resolves outside the project');
		}
		if ($mustExist && !is_file($file)) {
			throw new InvalidArgumentException('Asset file does not exist');
		}
		return $file;
	}

	public function fileToUrl($file, $assetType = null)
	{
		$resolved = realpath($file);
		if ($resolved === false || strpos($resolved, $this->projectRoot . DIRECTORY_SEPARATOR) !== 0) {
			throw new InvalidArgumentException('File is outside the project');
		}
		$url = str_replace('\\', '/', substr($resolved, strlen($this->projectRoot) + 1));
		if ($assetType !== null) {
			$this->urlToFile($url, $assetType, true);
		}
		return $url;
	}

	public function collisionSafeFilename($directory, $base, $extension)
	{
		$base = $this->sanitizeFilename($base);
		$extension = strtolower(ltrim($extension, '.'));
		$filename = $base . '.' . $extension;
		for ($suffix = 2; file_exists($directory . DIRECTORY_SEPARATOR . $filename); $suffix++) {
			$filename = $base . '-' . $suffix . '.' . $extension;
		}
		return $filename;
	}

	public function incomingDirectory($assetType, $batchId)
	{
		$this->validateAssetType($assetType);
		if (!preg_match('/^[a-zA-Z0-9-]{8,64}$/', $batchId)) {
			throw new InvalidArgumentException('Invalid ingest batch');
		}
		return $this->projectRoot . DIRECTORY_SEPARATOR .
			str_replace('/', DIRECTORY_SEPARATOR, $this->config['incoming_root']) .
			DIRECTORY_SEPARATOR . $assetType . DIRECTORY_SEPARATOR . $batchId;
	}

	public function inspectUpload($file)
	{
		if (!isset($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
			throw new InvalidArgumentException('No valid upload received');
		}
		if ((int)($file['size'] ?? 0) <= 0 || (int)$file['size'] > $this->config['upload_max_bytes']) {
			throw new InvalidArgumentException('File is empty or exceeds the upload size limit');
		}
		$finfo = new finfo(FILEINFO_MIME_TYPE);
		$mime = $finfo->file($file['tmp_name']);
		$extension = strtolower(pathinfo((string)$file['name'], PATHINFO_EXTENSION));
		$rule = $this->config['allowed_asset_types'][$extension] ?? null;
		if (!$rule || !in_array($mime, $rule['mime'], true)) {
			throw new InvalidArgumentException('File extension and content type do not match an allowed image format');
		}
		if (@getimagesize($file['tmp_name']) === false) {
			throw new InvalidArgumentException('Image is unreadable');
		}
		return ['extension' => $extension === 'jpeg' ? 'jpg' : $extension, 'mime' => $mime];
	}
}

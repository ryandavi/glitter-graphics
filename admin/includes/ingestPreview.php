<?php
require_once(__DIR__ . '/config.php');
require_once(__DIR__ . '/auth.php');
require_once(__DIR__ . '/database.php');
require_once(__DIR__ . '/assetIngestService.php');

requireAuth('api');
$assetType = $_GET['type'] ?? '';
if (!isset($CONFIG['asset_types'][$assetType])) {
	http_response_code(404);
	exit;
}

try {
	$db = new Database($CONFIG);
	$service = new AssetIngestService($db, $CONFIG);
	$item = $service->get((int)($_GET['id'] ?? 0));
	if ($item['asset_type'] !== $assetType || in_array($item['status'], ['approved', 'rejected'], true)) {
		throw new RuntimeException('Preview unavailable');
	}
	$path = $service->incomingPath($item);
	if (!empty($item['thumbnail_url'])) {
		$thumbnail = dirname($path) . DIRECTORY_SEPARATOR . basename($item['thumbnail_url']);
		if (is_file($thumbnail)) $path = $thumbnail;
	}
	if (!is_file($path)) throw new RuntimeException('Preview unavailable');
	$mime = (new finfo(FILEINFO_MIME_TYPE))->file($path);
	header('Content-Type: ' . $mime);
	header('Content-Length: ' . filesize($path));
	header('Cache-Control: private, max-age=60');
	readfile($path);
} catch (Throwable $error) {
	http_response_code(404);
}

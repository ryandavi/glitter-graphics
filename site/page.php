<?php
if (!isset($slug)) {
	http_response_code(404);
	exit;
}

$site = json_decode(file_get_contents(__DIR__ . '/generated.json'), true, 512, JSON_THROW_ON_ERROR);
$error = $slug === 'error';
$page = null;
foreach ($site['pages'] as $candidate) {
	if ($candidate['slug'] === $slug) $page = $candidate;
}
if ($error) {
	$status = (int) ($_SERVER['REDIRECT_STATUS'] ?? 404);
	http_response_code($status >= 400 && $status <= 599 ? $status : 404);
	$page = ['slug' => 'error', 'title' => 'Page unavailable', 'description' => 'This page could not be loaded.', 'kinds' => ['document']];
}
if (!$page) {
	http_response_code(404);
	exit;
}

// SCRIPT_NAME preserves the mount path on production, staging and local hosts.
$base = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME']));
if (!$error) $base = str_replace('\\', '/', dirname($base));
$base = rtrim($base, '/') . '/';
$canonical = $site['origin'] . $page['slug'] . '/';
function page_escape($value) {
	return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
require __DIR__ . '/layout.php';

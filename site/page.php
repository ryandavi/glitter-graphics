<?php
if (!isset($slug)) {
	http_response_code(404);
	exit;
}

$site = json_decode(file_get_contents(__DIR__ . '/generated.json'), true, 512, JSON_THROW_ON_ERROR);
$error = $slug === 'error';
$home = $slug === 'home';
$page = $home ? $site['home'] : null;
foreach ($site['pages'] as $candidate) {
	if ($candidate['slug'] === $slug) $page = $candidate;
}
if ($error) {
	// .htaccess rewrites missing pages here (REDIRECT_STATUS 200), so anything
	// that isn't an error status reads as a 404.
	$status = (int) ($_SERVER['REDIRECT_STATUS'] ?? 404);
	if ($status < 400 || $status > 599) $status = 404;
	http_response_code($status);
	$page = $status === 404
		? ['slug' => 'error', 'title' => 'Page not found', 'description' => 'There is no page at this address. It may have moved, or the link may have a typo.']
		: ['slug' => 'error', 'title' => 'Error', 'description' => 'This page could not be loaded. Try again in a moment.'];
}
if (!$page) {
	http_response_code(404);
	exit;
}

// SCRIPT_NAME preserves the mount path on production, staging and local hosts.
$base = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME']));
// The homepage is the mount root itself; article pages sit one folder down.
if (!$error && !$home) $base =str_replace('\\', '/', dirname($base));
$base = rtrim($base, '/') . '/';
$canonical = $site['origin'] . ($home ? '' : $page['slug'] . '/');
function page_escape($value) {
	return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
require __DIR__ . '/layout.php';

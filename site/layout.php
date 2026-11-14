<?php if (!isset($page)) exit; ?>
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
	<title><?= page_escape($home ? $site['siteName'] : $page['title'] . ' | ' . $site['siteName']) ?></title>
	<meta name="description" content="<?= page_escape($page['description']) ?>">
<?php if ($error): ?>
	<meta name="robots" content="noindex">
<?php else: ?>
	<link rel="canonical" href="<?= page_escape($canonical) ?>">
	<meta property="og:url" content="<?= page_escape($canonical) ?>">
<?php endif; ?>
	<meta property="og:site_name" content="<?= page_escape($site['siteName']) ?>">
	<meta property="og:title" content="<?= page_escape($page['title']) ?>">
	<meta property="og:description" content="<?= page_escape($page['description']) ?>">
	<meta property="og:type" content="<?= ($home || ($page['source'] ?? '') === 'releases') ? 'website' : 'article' ?>">
	<meta property="og:image" content="<?= page_escape($site['origin']) ?>images/etc/preview-image.gif">
	<meta name="twitter:card" content="summary_large_image">
	<link rel="stylesheet" href="<?= page_escape($base . $site['stylesheet']) ?>">
	<noscript><style>.advanced-disclosure > .advanced-disclosure-content { display: flex; }</style></noscript>
	<link rel="icon" href="<?= page_escape($base . $site['favicon']) ?>" type="image/x-icon">
</head>
<body class="content-page<?= $home ? ' home-page' : '' ?>">
<?php readfile(__DIR__ . '/sprite.html'); ?>
<?php require __DIR__ . '/header.php'; ?>
	<div class="content-page-scroll">
<?php if ($home): ?>
<?php require __DIR__ . '/home.php'; ?>
<?php else: ?>
		<main class="doc-page-main <?= page_escape(implode(' ', array_map(function ($kind) { return 'doc-page-' . $kind; }, $page['kinds']))) ?>" id="main">
			<article class="doc-content">
<?php if ($error): ?>
<h1>Page unavailable</h1>
<p>Check the address or try again later.</p>
<?php else: ?>
<?php readfile(dirname(__DIR__) . '/' . $page['slug'] . '/content.html'); ?>
<?php endif; ?>
			</article>
		</main>
<?php endif; ?>
<?php require __DIR__ . '/footer.php'; ?>
	</div>
<?php foreach ($home ? array_merge($site['scripts'], $site['homeScripts']) : $site['scripts'] as $script): ?>
	<script src="<?= page_escape($base . $script) ?>"></script>
<?php endforeach; ?>
<?php readfile(__DIR__ . '/analytics.html'); ?>
</body>
</html>

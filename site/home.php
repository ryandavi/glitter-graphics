<?php if (!isset($page)) exit; ?>
<?php
// The homepage body. Its data (tiles, credits, counts, release) comes from
// generated.json, built by tools/build-pages.js from the Library's data files.
$reading = array_values(array_filter($site['pages'], function ($item) { return $item['source'] !== 'releases'; }));
$updates = array_values(array_filter($site['pages'], function ($item) { return $item['source'] === 'releases'; }))[0] ?? null;
?>
		<main class="home-main" id="main">
<?php $hero = $page; $heroWord = 'Glitter'; require __DIR__ . '/home-hero.php'; ?>

			<section class="home-intro">
				<p class="home-lead">Glitter Editor makes glitter graphics: sparkly text, stickers and animated GIFs, built from the glitter tiles people made and traded online around the turn of the millennium.</p>
				<p>The Library holds <?= number_format($page['counts']['glitter']) ?> glitter tiles and <?= number_format($page['counts']['stickers']) ?> stickers. The archival sets are credited to the people who made them, like the glitter fill tiles above. Everything runs in your browser, and the images you load or export stay there.</p>
				<div class="home-actions">
					<a class="btn-text-with-icon primary" href="<?= page_escape($base) ?>studio/">Open the Editor</a>
					<a class="btn-text-with-icon" href="<?= page_escape($base) ?>guide/">Read the Guide</a>
				</div>
			</section>

			<section class="home-reading" aria-labelledby="homeReadingTitle">
				<h2 id="homeReadingTitle">Reading</h2>
				<ul class="home-reading-list">
<?php foreach ($reading as $item): ?>
					<li>
						<a class="home-reading-row" href="<?= page_escape($base . $item['slug']) ?>/">
							<span class="home-reading-icon icon-wrapper" aria-hidden="true"><svg class="icon"><use href="#icon-<?= page_escape($item['icon']) ?>"></use></svg></span>
							<span class="home-reading-title"><?= page_escape($item['title']) ?></span>
							<span class="home-reading-description"><?= page_escape($item['description']) ?></span>
						</a>
					</li>
<?php endforeach; ?>
				</ul>
<?php if ($updates): ?>
				<p class="home-release"><span class="badge is-version">v<?= page_escape($page['release']['version']) ?></span> <?= page_escape($page['release']['name']) ?> came out <?= page_escape($page['release']['dateLabel']) ?>. <a href="<?= page_escape($base . $updates['slug']) ?>/">See every update</a>.</p>
<?php endif; ?>
			</section>
		</main>

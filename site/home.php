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
				<p class="home-lead">Glitter Editor is a free graphic editor for making sparkly text, sticker collages and animated GIFs right in your browser, without downloading or installing an app.</p>
				<p>Glitter is at the heart of the editor, alongside a wider mix of web aesthetics from the early 2000s through the late 2010s. You can work with glitter fills, pixel art and dreamy photo edits, drawing from a Library of <?= number_format($page['counts']['glitter']) ?> glitter tiles and <?= number_format($page['counts']['stickers']) ?> stickers. Archival sets are credited to the people who made them, including the glitter tiles you can try above.</p>
				<p>Your images and edits are processed on your device and are never uploaded to our servers. We don’t collect your pictures or use them for anything, and the files you save or export go straight to your device.</p>
				<div class="home-actions">
					<a class="btn-text-with-icon primary" href="<?= page_escape($base) ?>studio/">Open the Editor</a>
					<a class="btn-text-with-icon" href="<?= page_escape($base) ?>guide/">Read the Guide</a>
				</div>
				<p class="home-maker"><span>by</span> <a href="https://ryandavi.com/"><img src="<?= page_escape($base) ?>images/branding/rybaby.png" alt="Rybaby" width="100" height="28"></a></p>
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

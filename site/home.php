<?php if (!isset($page)) exit; ?>
<?php
// The homepage body. Its data (tiles, credits, counts, release) comes from
// generated.json, built by tools/build-pages.js from the Library's data files.
// Each visit starts the wordmark on a different tile.
$swatches = $page['swatches'];
$start = array_rand($swatches);
$stickers = $page['stickerPresets'] ? $page['stickerPresets'][array_rand($page['stickerPresets'])] : [];
// A root-relative URL: a url() inside a custom property would otherwise resolve
// against the stylesheet that reads it.
function home_tile_style($swatch, $base) {
	return '--tile: url("' . $base . $swatch['url'] . '"); --tile-w: ' . (int) $swatch['width'] . '; --tile-h: ' . (int) $swatch['height'] . ';';
}
function home_credit($swatch, $set) {
	$author = $set['authorUrl']
		? '<a href="' . page_escape($set['authorUrl']) . '">' . page_escape($set['author']) . '</a>'
		: page_escape($set['author']);
	return page_escape($swatch['name']) . ', from <a href="' . page_escape($set['sourceUrl']) . '">' . page_escape($set['name']) . '</a> by ' . $author;
}
$reading = array_values(array_filter($site['pages'], function ($item) { return $item['source'] !== 'releases'; }));
$updates = array_values(array_filter($site['pages'], function ($item) { return $item['source'] === 'releases'; }))[0] ?? null;
?>
		<main class="home-main" id="main">
			<section class="home-hero" aria-labelledby="homeTitle">
				<div class="home-canvas" id="homeCanvas" style="<?= page_escape(home_tile_style($swatches[$start], $base)) ?>">
					<svg class="home-alias-filter" width="0" height="0" aria-hidden="true" focusable="false"><filter id="homeAlias" x="-0.1" y="-0.5" width="1.2" height="2" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer></filter></svg>
					<div class="home-canvas-object">
						<h1 class="home-wordmark" id="homeTitle">Glitter</h1>
<?php foreach ($stickers as $sticker): ?>
						<img class="home-sticker" src="<?= page_escape($base . $sticker['url']) ?>" alt="" title="<?= page_escape($sticker['name']) ?>" width="<?= (int) $sticker['width'] ?>" height="<?= (int) $sticker['height'] ?>" style="--w: <?= (int) $sticker['width'] ?>; --x: <?= (float) $sticker['x'] ?>; --y: <?= (float) $sticker['y'] ?>; --r: <?= (float) $sticker['rotate'] ?>">
<?php endforeach; ?>
						<span class="home-canvas-handles" aria-hidden="true">
							<span class="transform-handle transform-handle-corner"></span><span class="transform-handle transform-handle-corner"></span><span class="transform-handle transform-handle-corner"></span><span class="transform-handle transform-handle-corner"></span>
						</span>
					</div>
				</div>
				<div class="home-fill">
					<div class="home-swatches" role="group" aria-label="Fill the wordmark with a glitter tile">
<?php foreach ($swatches as $index => $swatch): $set = $page['sets'][$swatch['set']]; ?>
						<button class="home-swatch" type="button" aria-pressed="<?= $index === $start ? 'true' : 'false' ?>" aria-label="<?= page_escape($swatch['name']) ?>" title="<?= page_escape($swatch['name']) ?>" style="<?= page_escape(home_tile_style($swatch, $base)) ?>" data-credit="<?= page_escape(home_credit($swatch, $set)) ?>"></button>
<?php endforeach; ?>
					</div>
					<p class="home-credit" id="homeCredit" aria-live="polite"><?= home_credit($swatches[$start], $page['sets'][$swatches[$start]['set']]) ?></p>
				</div>
			</section>

			<section class="home-intro">
				<p class="home-lead">Glitter Editor makes glitter graphics: sparkly text, stickers and animated GIFs, built from the glitter tiles people made and traded online around the turn of the millennium.</p>
				<p>The Library holds <?= number_format($page['counts']['glitter']) ?> glitter tiles and <?= number_format($page['counts']['stickers']) ?> stickers. The archival sets are credited to the people who made them, like the tile above. Everything runs in your browser, and the images you load or export stay there.</p>
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

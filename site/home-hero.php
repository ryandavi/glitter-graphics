<?php if (!isset($hero, $heroWord)) exit; ?>
<?php
// The homepage hero: a word as a selected text layer on the canvas, filled
// with a Library tile the reader can swap. site/home.php shows "Glitter"; the
// error page shows its status code. $hero is generated.json's home data.
// Each visit starts the word on a different tile.
$swatches = $hero['swatches'];
$start = array_rand($swatches);
$stickers = $hero['stickerPresets'] ? $hero['stickerPresets'][array_rand($hero['stickerPresets'])] : [];
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
?>
			<section class="home-hero" aria-labelledby="homeTitle">
				<div class="home-canvas" id="homeCanvas" style="<?= page_escape(home_tile_style($swatches[$start], $base)) ?>">
					<svg class="home-alias-filter" width="0" height="0" aria-hidden="true" focusable="false"><filter id="homeAlias" x="-0.1" y="-0.5" width="1.2" height="2" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer></filter></svg>
					<div class="home-canvas-object">
						<h1 class="home-wordmark" id="homeTitle"><?= page_escape($heroWord) ?></h1>
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
<?php foreach ($swatches as $index => $swatch): $set = $hero['sets'][$swatch['set']]; ?>
						<button class="home-swatch" type="button" aria-pressed="<?= $index === $start ? 'true' : 'false' ?>" aria-label="<?= page_escape($swatch['name']) ?>" title="<?= page_escape($swatch['name']) ?>" style="<?= page_escape(home_tile_style($swatch, $base)) ?>" data-credit="<?= page_escape(home_credit($swatch, $set)) ?>"></button>
<?php endforeach; ?>
					</div>
					<p class="home-credit" id="homeCredit" aria-live="polite"><?= home_credit($swatches[$start], $hero['sets'][$swatches[$start]['set']]) ?></p>
				</div>
			</section>

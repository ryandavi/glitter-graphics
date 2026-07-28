<?php

require_once(__DIR__ . '/../admin/includes/config.php');
require_once(__DIR__ . '/../admin/includes/assetPathService.php');
require_once(__DIR__ . '/../admin/includes/tagTaxonomyService.php');
require_once(__DIR__ . '/../admin/includes/assetAnalysisResult.php');
require_once(__DIR__ . '/../admin/includes/assetNaming.php');
require_once(__DIR__ . '/../admin/includes/gifAnalyzer.php');

function assertTrue($condition, $label)
{
	if (!$condition) {
		fwrite(STDERR, "FAIL $label\n");
		exit(1);
	}
	echo "PASS $label\n";
}

function assertThrows($callback, $label)
{
	try {
		$callback();
	} catch (Throwable $error) {
		echo "PASS $label\n";
		return;
	}
	fwrite(STDERR, "FAIL $label\n");
	exit(1);
}

$paths = new AssetPathService($CONFIG);
assertTrue($paths->validateSlug('sparkle-2') === 'sparkle-2', 'safe category slug');
assertThrows(function () use ($paths) {
	$paths->validateSlug('Frame');
}, 'category slug requires lowercase');
assertThrows(function () use ($paths) {
	$paths->validateSlug('../escape');
}, 'path traversal slug rejected');
assertThrows(function () use ($paths) {
	$paths->urlToFile('images/glitter/../../config.php', 'glitter');
}, 'URL traversal rejected');
assertThrows(function () use ($paths) {
	$paths->urlToFile('images/stickers/animals/bird.gif', 'glitter');
}, 'cross-root URL rejected');
assertTrue(
	TagTaxonomyService::normalize('  Birds!!!  ') === 'birds',
	'tag normalization trims case, spacing, and punctuation'
);

$limited = AssetAnalysisResult::classifyPalette([
	['hex' => '#E03080', 'weight' => 0.82],
	['hex' => '#F7C2D9', 'weight' => 0.12],
], [], $CONFIG);
assertTrue($limited['type'] === 'dominant-color', 'dominant illustration palette');

$neutral = AssetAnalysisResult::classifyPalette([
	['hex' => '#F2F2F2', 'weight' => 0.55],
	['hex' => '#555555', 'weight' => 0.35],
], [], $CONFIG);
assertTrue($neutral['type'] === 'neutral', 'neutral palette');

$warmNeutral = AssetAnalysisResult::classifyPalette([
	['hex' => '#E2E2D8', 'weight' => 0.75],
	['hex' => '#B4AD9B', 'weight' => 0.20],
], [], $CONFIG);
assertTrue($warmNeutral['type'] === 'neutral', 'warm low-chroma palette');

$complex = AssetAnalysisResult::classifyPalette([
	['hex' => '#030203', 'weight' => 0.33],
	['hex' => '#D26BA7', 'weight' => 0.19],
	['hex' => '#C00072', 'weight' => 0.17],
	['hex' => '#FF007F', 'weight' => 0.12],
	['hex' => '#FFFFFF', 'weight' => 0.08],
	['hex' => '#210112', 'weight' => 0.06],
], [], $CONFIG);
assertTrue($complex['type'] !== 'photographic', 'complex palette avoids subject-matter claim');

$rainbow = AssetAnalysisResult::classifyPalette([
	['hex' => '#E22B2B', 'weight' => 0.16],
	['hex' => '#EE8B25', 'weight' => 0.16],
	['hex' => '#E7D62B', 'weight' => 0.16],
	['hex' => '#2DAA53', 'weight' => 0.16],
	['hex' => '#2784D4', 'weight' => 0.16],
	['hex' => '#913FCC', 'weight' => 0.16],
], [], $CONFIG);
assertTrue($rainbow['type'] === 'rainbow', 'rainbow palette');

// A hand-edited color list is re-read by the same classifier, so removing
// colors moves the type the editor reports.
$editedRainbow = [
	['hex' => '#D82727', 'weight' => 0.09],
	['hex' => '#E87522', 'weight' => 0.07],
	['hex' => '#E7C925', 'weight' => 0.06],
	['hex' => '#2AA84A', 'weight' => 0.06],
	['hex' => '#2387CE', 'weight' => 0.07],
	['hex' => '#873BC1', 'weight' => 0.06],
	['hex' => '#D63D91', 'weight' => 0.07],
];
assertTrue(
	AssetAnalysisResult::typeFromPalette($editedRainbow, $CONFIG) === 'rainbow',
	'edited palette classified as rainbow'
);
assertTrue(
	AssetAnalysisResult::typeFromPalette(array_slice($editedRainbow, 0, 2), $CONFIG) === 'gradient',
	'removing colors moves the palette type'
);
assertTrue(AssetAnalysisResult::typeFromPalette([], $CONFIG) === null, 'empty palette has no type');

$names = [
	'bear_blue-heart_glitter.gif' => 'Bear Blue Heart Glitter',
	'skull-crossbones_pink-glitter_2.gif' => 'Skull Crossbones Pink Glitter (2)',
	'less-than-three_emo_pink.gif' => 'Less Than Three Emo Pink',
	'FadetoPurple.gif' => 'Fade to Purple',
	'fran-black2.gif' => 'Fran Black (2)',
	'tiedye-01.gif' => 'Tie Dye (1)',
	'DCglit103.gif' => 'DCglit (103)',
	'images/stickers/animal/two-birds_kiss_blue-pink.gif' => 'Two Birds Kiss Blue Pink',
];
foreach ($names as $filename => $expected) {
	$actual = AssetNaming::displayName($filename, $CONFIG);
	assertTrue($actual === $expected, "name from $filename ($actual)");
}
assertTrue(AssetNaming::displayName('', $CONFIG, 'asset') === 'asset', 'nameless file falls back');

// The rename control derives a filename from the display name, so spaces have
// to land on `_` and an intra-segment hyphen has to survive.
$filenames = [
	'Bear Blue-heart Glitter' => 'bear_blue-heart_glitter',
	'Happy New Year Silver Glitter' => 'happy_new_year_silver_glitter',
	'Skull Crossbones Pink Glitter (2)' => 'skull_crossbones_pink_glitter_2',
	'  Spaced   Out  ' => 'spaced_out',
	'!!!' => '',
];
foreach ($filenames as $displayName => $expected) {
	$actual = AssetNaming::filename($displayName);
	assertTrue($actual === $expected, "filename from \"$displayName\" ($actual)");
}
assertTrue(AssetNaming::filename('', 'asset') === 'asset', 'nameless display name falls back');

// Sanitizing keeps both library separators so an existing name survives a
// round trip through the ingest and rename paths unchanged.
$sanitized = [
	'bear_blue-heart_glitter.gif' => 'bear_blue-heart_glitter',
	'My Photo (final).PNG' => 'my-photo-final',
	'__weird---name__.gif' => 'weird-name',
	'11.png' => '11',
];
foreach ($sanitized as $filename => $expected) {
	$actual = $paths->sanitizeFilename($filename);
	assertTrue($actual === $expected, "sanitized $filename ($actual)");
}
assertTrue($paths->sanitizeFilename('***', 'asset') === 'asset', 'unusable filename falls back');

// A glitter overlay is a scattered grey ramp over artwork. It collapses into
// one palette entry — unless there is no artwork under it, in which case the
// ramp is the subject (chrome, silver) and every step stays.
function ditheredGif($path, $withColor)
{
	$size = 64;
	$image = imagecreatetruecolor($size, $size);
	// Spaced far enough apart in L* to clear cluster_merge_distance_neutral, so
	// the ramp only collapses when the overlay rule fires rather than because
	// the steps were too close to survive on their own.
	$greys = [
		imagecolorallocate($image, 0x00, 0x00, 0x00),
		imagecolorallocate($image, 0x80, 0x80, 0x80),
		imagecolorallocate($image, 0xFF, 0xFF, 0xFF),
	];
	$red = imagecolorallocate($image, 0xE0, 0x10, 0x10);
	$blue = imagecolorallocate($image, 0x10, 0x10, 0xE0);
	for ($y = 0; $y < $size; $y++) {
		for ($x = 0; $x < $size; $x++) {
			$ground = $withColor
				? ($x < $size / 2 ? $red : $blue)
				: $greys[2];
			// Every fifth pixel by a hash: scattered enough that no overlay
			// pixel has a like neighbour, which is what marks it as sparkle.
			$speckle = (($x * 7) + ($y * 11)) % 5 === 0;
			imagesetpixel($image, $x, $y, $speckle ? $greys[($x + $y) % 3] : $ground);
		}
	}
	imagegif($image, $path);
	imagedestroy($image);
}

function neutralCount($colorCodes)
{
	$neutral = 0;
	foreach (array_filter(explode(',', (string)$colorCodes)) as $hex) {
		$rgb = hexToRgb($hex);
		$lab = rgbToLab($rgb[0], $rgb[1], $rgb[2]);
		if (sqrt(pow($lab[1], 2) + pow($lab[2], 2)) < 10) {
			$neutral++;
		}
	}
	return $neutral;
}

$overlayPath = sys_get_temp_dir() . '/glitter-overlay-test.gif';
$rampPath = sys_get_temp_dir() . '/glitter-ramp-test.gif';
ditheredGif($overlayPath, true);
ditheredGif($rampPath, false);
try {
	$overlay = (new GifAnalyzer($overlayPath, $CONFIG))->analyze();
	$ramp = (new GifAnalyzer($rampPath, $CONFIG))->analyze();
	assertTrue(
		neutralCount($overlay['color_codes']) === 1,
		'scattered grey ramp over colour folds to one entry (' . $overlay['color_codes'] . ')'
	);
	assertTrue(
		neutralCount($ramp['color_codes']) >= 3,
		'the same ramp with no colour under it is kept (' . $ramp['color_codes'] . ')'
	);
} finally {
	@unlink($overlayPath);
	@unlink($rampPath);
}

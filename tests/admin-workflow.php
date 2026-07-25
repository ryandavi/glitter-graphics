<?php

require_once(__DIR__ . '/../admin/includes/config.php');
require_once(__DIR__ . '/../admin/includes/assetPathService.php');
require_once(__DIR__ . '/../admin/includes/tagTaxonomyService.php');
require_once(__DIR__ . '/../admin/includes/assetAnalysisResult.php');

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

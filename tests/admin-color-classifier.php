<?php

require_once(__DIR__ . '/../admin/includes/config.php');
require_once(__DIR__ . '/../admin/includes/colorClassifier.php');

function cluster($hex, $coverage)
{
	$rgb = hexToRgb($hex);
	return [
		'rgb' => $rgb,
		'coverage' => $coverage,
		'sparkle' => false,
	];
}

function assertName($actual, $expected, $label)
{
	if ($actual !== $expected) {
		fwrite(STDERR, "FAIL $label: expected \"$expected\", got \"$actual\"\n");
		exit(1);
	}
	echo "PASS $label: $actual\n";
}

$classifier = new ColorClassifier($CONFIG);

assertName($classifier->classify([cluster('#B44F20', 0.72)])['name'], 'Burnt Orange', 'burnt orange');
assertName($classifier->classify([cluster('#8B0A1A', 0.72)])['name'], 'Ruby Red', 'ruby red');
assertName($classifier->classify([cluster('#145F55', 0.72)])['name'], 'Dark Blue-Green', 'dark blue-green');
assertName($classifier->classify([cluster('#A66A32', 0.72)])['name'], 'Bronze', 'bronze');
assertName($classifier->classify([cluster('#C49A6C', 0.72)])['name'], 'Tan', 'tan');

$rainbow = [
	cluster('#D82727', 0.09),
	cluster('#E87522', 0.07),
	cluster('#E7C925', 0.06),
	cluster('#2AA84A', 0.06),
	cluster('#2387CE', 0.07),
	cluster('#873BC1', 0.06),
	cluster('#D63D91', 0.07),
];
assertName($classifier->classify($rainbow)['name'], 'Rainbow', 'distributed rainbow');

$patriotic = [
	cluster('#C92332', 0.34),
	cluster('#F7F7F7', 0.28),
	cluster('#254A9B', 0.31),
];
assertName($classifier->classify($patriotic)['name'], 'Red, White, and Blue', 'red white and blue');

$burntGradient = [
	cluster('#330000', 0.72),
	cluster('#782A06', 0.14),
	cluster('#D57C11', 0.13),
];
assertName($classifier->classify($burntGradient)['name'], 'Burnt Orange', 'dark burnt-orange gradient');

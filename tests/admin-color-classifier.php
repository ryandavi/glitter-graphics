<?php

require_once(__DIR__ . '/../admin/includes/config.php');
require_once(__DIR__ . '/../admin/includes/colorClassifier.php');
require_once(__DIR__ . '/../admin/includes/gifAnalyzer.php');
require_once(__DIR__ . '/../admin/includes/stickerAPI.php');

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

function assertType($actual, $expected, $label)
{
	assertName($actual['palette_type'], $expected, $label);
}

// A near-black cluster average carries a strong HSV saturation and an
// arbitrary hue, so an outline used to found a hue family with half the image
// behind it — here it would have outvoted the eight real colors.
$outlinedRainbow = array_merge([cluster('#010101', 0.49)], array_map(function ($hex) {
	return cluster($hex, 0.062);
}, ['#FF000A', '#0D00FF', '#49FF00', '#DFFF00', '#FF8A00', '#0088FF', '#A100FF', '#00FFE1']));
assertType($classifier->classify($outlinedRainbow), 'rainbow', 'black outline does not found a hue family');

// Dither speckle and antialiased edges scatter trace coverage over hues the
// artwork does not really use; only families holding a real share count.
$twoToneWithSpeckle = [
	cluster('#096ED3', 0.24),
	cluster('#EB4A8A', 0.19),
	cluster('#0532A5', 0.09),
	cluster('#EBD755', 0.04),
	cluster('#067C7C', 0.04),
	cluster('#E36607', 0.03),
];
assertType($classifier->classify($twoToneWithSpeckle), 'two-tone', 'trace hue families are not a rainbow');

// A glint of colour on an otherwise grey asset does not make it a coloured
// asset: a silver rhinestone with a gold highlight read as "Tan" before the
// coloured share had to clear a floor of its own.
$silverWithGlint = [
	cluster('#D6D9D8', 0.56),
	cluster('#3C3C3B', 0.21),
	cluster('#858687', 0.18),
	cluster('#C9A263', 0.04),
];
assertName($classifier->classify($silverWithGlint)['name'], 'Off-White', 'a glint does not name a neutral asset');
assertType($classifier->classify($silverWithGlint), 'neutral', 'a glint does not colour a neutral asset');

// The floor is a floor, not a veto — real colour over a neutral ground still
// names the asset after the colour.
$colouredOverGrey = [
	cluster('#6A6A6A', 0.55),
	cluster('#C92332', 0.30),
	cluster('#F2F2F2', 0.15),
];
assertType($classifier->classify($colouredOverGrey), 'single', 'colour above the floor still names the asset');

foreach (['#8BC43E', '#4CAF50', '#2E7D32'] as $green) {
	$rgb = hexToRgb($green);
	list($hue) = rgbToHSV($rgb[0], $rgb[1], $rgb[2]);
	assertName(hueFamily($hue), 'green', "$green matches green family");
}

$neutralBands = $CONFIG['neutral_tag_words'];
foreach (['#010201' => 'black', '#FFFFFF' => 'white', '#808080' => 'gray'] as $hex => $expected) {
	$rgb = hexToRgb($hex);
	list($hue, $saturation, $value) = rgbToHSV($rgb[0], $rgb[1], $rgb[2]);
	$actual = $saturation < $CONFIG['naming_min_saturation'] || $value < $CONFIG['naming_min_value']
		? neutralTagWord($value, $neutralBands)
		: hueFamily($hue);
	assertName($actual, $expected, "$hex neutral tag band");
}

function coherentAndScatteredFixture($path)
{
	$image = imagecreatetruecolor(100, 100);
	$green = imagecolorallocate($image, 0x4C, 0xAF, 0x50);
	$white = imagecolorallocate($image, 0xFF, 0xFF, 0xFF);
	$red = imagecolorallocate($image, 0xD8, 0x27, 0x27);
	imagefill($image, 0, 0, $green);
	imagefilledrectangle($image, 0, 0, 29, 9, $white);
	for ($y = 20; $y < 60; $y += 2) {
		for ($x = 0; $x < 10; $x += 2) {
			imagesetpixel($image, $x, $y, $red);
		}
	}
	imagepng($image, $path);
	imagedestroy($image);
}

$clusterPath = sys_get_temp_dir() . '/admin-solid-cluster-test.png';
coherentAndScatteredFixture($clusterPath);
try {
	$analysis = (new GifAnalyzer($clusterPath, $CONFIG))->analyze();
	$colors = explode(',', $analysis['color_codes']);
	assertName(in_array('#FFFFFF', $colors, true) ? 'kept' : 'cut', 'kept', 'solid sub-5% cluster survives');
	assertName(in_array('#D82727', $colors, true) ? 'kept' : 'cut', 'cut', 'scattered sub-5% cluster is cut');
	assertName(
		json_encode((new GifAnalyzer($clusterPath, $CONFIG))->analyze()),
		json_encode($analysis),
		'repeated analysis is deterministic'
	);
} finally {
	@unlink($clusterPath);
}

class SuggestedTagProbe extends StickerAPI
{
	public function __construct($config)
	{
		$this->config = $config;
		$this->assetType = 'sticker';
	}

	public function getTags()
	{
		return [
			['id' => 22, 'name' => 'green', 'aliases' => [], 'hex_color' => '#00FF00'],
			['id' => 107, 'name' => 'black', 'aliases' => [], 'hex_color' => '#000000'],
			['id' => 108, 'name' => 'white', 'aliases' => [], 'hex_color' => '#FFFFFF'],
			['id' => 109, 'name' => 'gold', 'aliases' => [], 'hex_color' => '#FFD700'],
			['id' => 110, 'name' => 'glitter', 'aliases' => [], 'hex_color' => null],
			['id' => 111, 'name' => 'violet', 'aliases' => ['purple'], 'hex_color' => null],
		];
	}

	public function suggestions($analysis)
	{
		return $this->enrichSuggestedTags($analysis)['suggested_tags'];
	}
}

function suggestedTagNames($suggestions)
{
	return array_values(array_column($suggestions, 'name'));
}

$tagProbe = new SuggestedTagProbe($CONFIG);
$alienTags = suggestedTagNames($tagProbe->suggestions([
	'color_codes' => '#8BC43E,#010201,#FFFFFF',
	'color_weights' => '0.57,0.39,0.05',
	'sparkle_coverage' => 0.049,
	'is_animated' => 0,
	'normalized' => ['palette' => ['type' => 'limited']],
]));
assertName(implode(',', $alienTags), 'green,black', 'family tags aggregate before matching');

$aliasTags = suggestedTagNames($tagProbe->suggestions([
	'color_codes' => '#873BC1',
	'color_weights' => '0.20',
	'sparkle_coverage' => 0,
	'is_animated' => 0,
	'normalized' => ['palette' => ['type' => 'limited']],
]));
assertName(implode(',', $aliasTags), 'violet', 'family tags match managed aliases');

$staticTags = suggestedTagNames($tagProbe->suggestions([
	'color_codes' => '#F9F9F9,#030201,#FCCC08,#C83032',
	'color_weights' => '0.38,0.33,0.29,0.01',
	'sparkle_coverage' => 0.382,
	'is_animated' => 0,
	'normalized' => ['palette' => ['type' => 'limited']],
]));
assertName(in_array('glitter', $staticTags, true) ? 'suggested' : 'not suggested', 'not suggested', 'static highlights do not suggest glitter');

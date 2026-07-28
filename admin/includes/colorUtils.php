<?php

function rgbToHex($r, $g, $b)
{
	return sprintf('#%02X%02X%02X', max(0, min(255, round($r))), max(0, min(255, round($g))), max(0, min(255, round($b))));
}

function hexToRgb($hex)
{
	$hex = ltrim((string)$hex, '#');
	if (strlen($hex) !== 6 || !ctype_xdigit($hex)) {
		return null;
	}

	return [
		hexdec(substr($hex, 0, 2)),
		hexdec(substr($hex, 2, 2)),
		hexdec(substr($hex, 4, 2)),
	];
}

function rgbToHSV($r, $g, $b)
{
	$r /= 255;
	$g /= 255;
	$b /= 255;
	$max = max($r, $g, $b);
	$min = min($r, $g, $b);
	$delta = $max - $min;
	$value = $max * 100;
	$saturation = $max == 0 ? 0 : ($delta / $max) * 100;

	if ($delta == 0) {
		$hue = 0;
	} elseif ($max == $r) {
		$hue = 60 * fmod((($g - $b) / $delta), 6);
	} elseif ($max == $g) {
		$hue = 60 * ((($b - $r) / $delta) + 2);
	} else {
		$hue = 60 * ((($r - $g) / $delta) + 4);
	}

	return [$hue < 0 ? $hue + 360 : $hue, $saturation, $value];
}

function hueFamily($hue)
{
	if ($hue < 15 || $hue >= 345) return 'red';
	if ($hue < 45) return 'orange';
	if ($hue < 75) return 'yellow';
	if ($hue < 165) return 'green';
	if ($hue < 200) return 'teal';
	if ($hue < 260) return 'blue';
	if ($hue < 315) return 'purple';
	return 'pink';
}

function simpleFamilyName($family)
{
	$names = [
		'red' => 'Red',
		'orange' => 'Orange',
		'yellow' => 'Yellow',
		'green' => 'Green',
		'teal' => 'Teal',
		'blue' => 'Blue',
		'purple' => 'Purple',
		'pink' => 'Pink',
	];
	return $names[$family] ?? ucfirst($family);
}

function neutralTagWord($value, $bands)
{
	$word = null;
	$minimum = -INF;
	foreach ($bands as $candidate => $candidateMinimum) {
		if ($value >= $candidateMinimum && $candidateMinimum > $minimum) {
			$word = $candidate;
			$minimum = $candidateMinimum;
		}
	}
	return $word;
}

function rgbToLab($r, $g, $b)
{
	$channels = [$r / 255, $g / 255, $b / 255];
	foreach ($channels as &$channel) {
		$channel = $channel > 0.04045
			? pow(($channel + 0.055) / 1.055, 2.4)
			: $channel / 12.92;
	}
	unset($channel);

	$x = ($channels[0] * 0.4124 + $channels[1] * 0.3576 + $channels[2] * 0.1805) / 0.95047;
	$y = ($channels[0] * 0.2126 + $channels[1] * 0.7152 + $channels[2] * 0.0722);
	$z = ($channels[0] * 0.0193 + $channels[1] * 0.1192 + $channels[2] * 0.9505) / 1.08883;
	$convert = function ($value) {
		return $value > 0.008856 ? pow($value, 1 / 3) : (7.787 * $value) + (16 / 116);
	};
	$x = $convert($x);
	$y = $convert($y);
	$z = $convert($z);

	return [(116 * $y) - 16, 500 * ($x - $y), 200 * ($y - $z)];
}

// CIE76. Kept for callers that want a cheap straight-line Lab distance;
// prefer deltaE2000 for any "do these look the same" decision, because
// CIE76 exaggerates differences in saturated regions.
function deltaE($labA, $labB)
{
	return sqrt(
		pow($labA[0] - $labB[0], 2) +
		pow($labA[1] - $labB[1], 2) +
		pow($labA[2] - $labB[2], 2)
	);
}

// CIEDE2000. Perceptually uniform: it compresses distances at high chroma,
// so two saturated pinks that read as one color score close together where
// CIE76 would rate them far apart and keep them as separate clusters.
function deltaE2000($labA, $labB)
{
	list($l1, $a1, $b1) = $labA;
	list($l2, $a2, $b2) = $labB;

	$c1 = sqrt($a1 * $a1 + $b1 * $b1);
	$c2 = sqrt($a2 * $a2 + $b2 * $b2);
	$cBar = ($c1 + $c2) / 2;
	$cBar7 = pow($cBar, 7);
	$g = 0.5 * (1 - sqrt($cBar7 / ($cBar7 + pow(25, 7))));

	$a1p = (1 + $g) * $a1;
	$a2p = (1 + $g) * $a2;
	$c1p = sqrt($a1p * $a1p + $b1 * $b1);
	$c2p = sqrt($a2p * $a2p + $b2 * $b2);

	$h1p = ($a1p == 0.0 && $b1 == 0.0) ? 0.0 : fmod(rad2deg(atan2($b1, $a1p)) + 360, 360);
	$h2p = ($a2p == 0.0 && $b2 == 0.0) ? 0.0 : fmod(rad2deg(atan2($b2, $a2p)) + 360, 360);

	$deltaL = $l2 - $l1;
	$deltaC = $c2p - $c1p;

	if ($c1p * $c2p == 0.0) {
		$deltahp = 0.0;
	} elseif (abs($h2p - $h1p) <= 180) {
		$deltahp = $h2p - $h1p;
	} elseif ($h2p - $h1p > 180) {
		$deltahp = $h2p - $h1p - 360;
	} else {
		$deltahp = $h2p - $h1p + 360;
	}
	$deltaH = 2 * sqrt($c1p * $c2p) * sin(deg2rad($deltahp) / 2);

	$lBarP = ($l1 + $l2) / 2;
	$cBarP = ($c1p + $c2p) / 2;

	if ($c1p * $c2p == 0.0) {
		$hBarP = $h1p + $h2p;
	} elseif (abs($h1p - $h2p) <= 180) {
		$hBarP = ($h1p + $h2p) / 2;
	} elseif ($h1p + $h2p < 360) {
		$hBarP = ($h1p + $h2p + 360) / 2;
	} else {
		$hBarP = ($h1p + $h2p - 360) / 2;
	}

	$t = 1
		- 0.17 * cos(deg2rad($hBarP - 30))
		+ 0.24 * cos(deg2rad(2 * $hBarP))
		+ 0.32 * cos(deg2rad(3 * $hBarP + 6))
		- 0.20 * cos(deg2rad(4 * $hBarP - 63));

	$deltaTheta = 30 * exp(-pow(($hBarP - 275) / 25, 2));
	$cBarP7 = pow($cBarP, 7);
	$rc = 2 * sqrt($cBarP7 / ($cBarP7 + pow(25, 7)));
	$sl = 1 + (0.015 * pow($lBarP - 50, 2)) / sqrt(20 + pow($lBarP - 50, 2));
	$sc = 1 + 0.045 * $cBarP;
	$sh = 1 + 0.015 * $cBarP * $t;
	$rt = -sin(deg2rad(2 * $deltaTheta)) * $rc;

	return sqrt(
		pow($deltaL / $sl, 2) +
		pow($deltaC / $sc, 2) +
		pow($deltaH / $sh, 2) +
		$rt * ($deltaC / $sc) * ($deltaH / $sh)
	);
}

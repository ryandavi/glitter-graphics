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

function deltaE($labA, $labB)
{
	return sqrt(
		pow($labA[0] - $labB[0], 2) +
		pow($labA[1] - $labB[1], 2) +
		pow($labA[2] - $labB[2], 2)
	);
}

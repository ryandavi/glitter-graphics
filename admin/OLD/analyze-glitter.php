<!DOCTYPE html>
<html lang="en">

<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Analyze Glitter Swatches</title>
	<style>
		body {
			font-family: Arial, sans-serif;
			padding: 20px;
			max-width: 1400px;
			margin: 0 auto;
			background: #1a1a1a;
			color: #ccc;
		}

		.success {
			background: #d4edda;
			border: 1px solid #c3e6cb;
			color: #155724;
			padding: 12px;
			margin: 10px 0;
		}

		.error {
			background: #f8d7da;
			border: 1px solid #f5c6cb;
			color: #721c24;
			padding: 12px;
			margin: 10px 0;
		}

		.info {
			background: #fff3cd;
			border: 1px solid #ffc107;
			color: #856404;
			padding: 12px;
			margin: 10px 0;
		}

		.warning {
			background: #fff3cd;
			border: 1px solid #ffc107;
			color: #856404;
			padding: 12px;
			margin: 10px 0;
		}

		button {
			padding: 10px 20px;
			background: #007bff;
			color: white;
			border: none;
			border-radius: 4px;
			cursor: pointer;
			font-size: 14px;
		}

		button:hover {
			background: #0056b3;
		}

		button:disabled {
			background: #6c757d;
			cursor: not-allowed;
		}

		table {
			width: 100%;
			border-collapse: collapse;
			margin: 20px 0;
			background: #2a2a2a;
		}

		th,
		td {
			padding: 10px;
			border: 1px solid #444;
			text-align: left;
		}

		th {
			background: #333;
			font-weight: 600;
		}

		.thumbnail {
			width: 60px;
			height: 60px;
			object-fit: cover;
			image-rendering: pixelated;
		}

		.color-swatch {
			display: inline-block;
			width: 30px;
			height: 30px;
			border: 1px solid #666;
			margin-right: 5px;
			vertical-align: middle;
			cursor: help;
		}

		td:nth-child(5) .color-swatch {
			width: 20px;
			height: 20px;
			margin-right: 3px;
		}

		.tag {
			display: inline-block;
			padding: 3px 8px;
			margin: 2px;
			border-radius: 3px;
			font-size: 12px;
			background: #444;
		}

		.tag.existing {
			background: #555;
			color: #aaa;
		}

		.tag.new {
			background: #28a745;
			color: white;
			font-weight: 600;
		}

		.progress {
			margin: 20px 0;
			padding: 10px;
			background: #333;
			border-radius: 4px;
		}

		h1,
		h2 {
			color: #fff;
		}

		.step {
			margin: 30px 0;
			padding: 20px;
			background: #2a2a2a;
			border-radius: 4px;
		}
	</style>
</head>

<body>

	<?php
	session_start();

	// ============================================
	// DATABASE CONFIGURATION
	// ============================================
	define('DB_HOST', '127.0.0.1');
	define('DB_USER', 'root');
	define('DB_PASS', '');
	define('DB_NAME', 'glitter');
	define('BASE_PATH', __DIR__ . '/..');

	// ============================================
	// ANALYSIS CONFIGURATION
	// ============================================

	// ──────────────────────────────────────────
	// SPARKLE/HIGHLIGHT REMOVAL
	// ──────────────────────────────────────────
	// Remove bright highlights/sparkles from analysis
	define('SPARKLE_THRESHOLD', 240);           // Skip pixels brighter than this (0-255)
	define('FILTER_LIGHTEST_COLOR', true);      // Also filter out the single lightest color
	define('LIGHTEST_COLOR_THRESHOLD', 235);    // Only filter lightest color if it's brighter than this

	// ──────────────────────────────────────────
	// COLOR EXTRACTION
	// ──────────────────────────────────────────
	define('COLOR_ROUNDING', 15);               // Round RGB values to this interval (reduces variation)
	define('MIN_COLOR_PERCENTAGE', 2.0);        // Minimum % of pixels to be considered a color
	define('COLOR_SIMILARITY_DISTANCE', 50);    // RGB distance to group similar colors together

	// ──────────────────────────────────────────
	// REPRESENTATIVE COLOR SELECTION
	// ──────────────────────────────────────────
	define('REP_COLOR_DISTANCE', 80);           // Colors must be this different to be separate
	define('REP_COLOR_MIN_PERCENTAGE', 15.0);   // Secondary colors must be at least this % of top color
	define('SIMILAR_COLOR_THRESHOLD', 35.0);    // Colors within this % of top color are considered similar (for brightness selection)

	// ──────────────────────────────────────────
	// BRIGHTNESS/TONE THRESHOLDS
	// ──────────────────────────────────────────
	define('DARK_THRESHOLD', 0.24);             // Below this = dark (0-1 scale)
	define('LIGHT_THRESHOLD', 0.71);            // Above this = light (0-1 scale)

	// ──────────────────────────────────────────
	// COLOR HUE RANGES (in degrees 0-360)
	// ──────────────────────────────────────────
	define('HUE_RED_START', 345);
	define('HUE_RED_END', 15);
	define('HUE_ORANGE_START', 15);
	define('HUE_ORANGE_END', 45);
	define('HUE_YELLOW_START', 45);
	define('HUE_YELLOW_END', 75);
	define('HUE_GREEN_START', 75);
	define('HUE_GREEN_END', 150);
	define('HUE_BLUE_START', 150);
	define('HUE_BLUE_END', 250);                // Extended to avoid blue->purple confusion
	define('HUE_PURPLE_START', 250);
	define('HUE_PURPLE_END', 290);
	define('HUE_PINK_START', 290);
	define('HUE_PINK_END', 345);

	define('MIN_SATURATION_FOR_COLOR', 15);     // Minimum saturation to detect a color (exclude grays)

	// ──────────────────────────────────────────
	// PASTEL DETECTION
	// ──────────────────────────────────────────
	define('PASTEL_MAX_SATURATION', 35);        // Maximum saturation for pastel
	define('PASTEL_MIN_VALUE', 75);             // Minimum brightness for pastel (must be light)
	define('PASTEL_MIN_SATURATION', 10);        // Must have SOME color (exclude pure grays)

	// ──────────────────────────────────────────
	// NEON DETECTION (specific hue ranges only)
	// ──────────────────────────────────────────
	define('NEON_MIN_SATURATION', 85);          // Very high saturation required
	define('NEON_MIN_VALUE', 70);               // High brightness required
	// Only these specific hues are considered neon
	define('NEON_HUE_RANGES', [
		[165, 195], // Cyan/turquoise
		[60, 80],   // Lime green
		[290, 320], // Magenta/hot pink
		[180, 210]  // Electric blue
	]);

	// ──────────────────────────────────────────
	// JEWEL TONE DETECTION
	// ──────────────────────────────────────────
	define('JEWEL_MIN_SATURATION', 70);         // Rich, saturated colors
	define('JEWEL_MIN_VALUE', 45);              // Medium-low brightness
	define('JEWEL_MAX_VALUE', 70);

	// ──────────────────────────────────────────
	// COLOR TEMPERATURE (warm/cool/neutral)
	// ──────────────────────────────────────────
	define('WARM_HUE_START', 330);              // Warm colors: reds, oranges, yellows
	define('WARM_HUE_END', 60);                 // Wraps around: 330-360, 0-60
	define('COOL_HUE_START', 150);              // Cool colors: blues, greens, purples
	define('COOL_HUE_END', 270);
	define('TEMP_MIN_SATURATION', 15);          // Need some color to detect temperature

	// ──────────────────────────────────────────
	// SATURATION LEVELS (vivid/muted/grayscale)
	// ──────────────────────────────────────────
	define('VIVID_MIN_SATURATION', 70);         // High saturation = vivid
	define('MUTED_MAX_SATURATION', 70);         // Low-medium saturation = muted
	define('MUTED_MIN_SATURATION', 20);         // Must have some color
	define('GRAYSCALE_MAX_SATURATION', 10);     // Barely any color = grayscale

	// ──────────────────────────────────────────
	// METAL DETECTION (gold, silver, bronze)
	// ──────────────────────────────────────────
	// Gold
	define('GOLD_HUE_START', 45);
	define('GOLD_HUE_END', 60);
	define('GOLD_MIN_SAT', 70);
	define('GOLD_MIN_VAL', 70);

	// Silver
	define('SILVER_MAX_SAT', 20);
	define('SILVER_MIN_VAL', 70);
	define('SILVER_MAX_VAL', 95);

	// Bronze
	define('BRONZE_HUE_START', 15);
	define('BRONZE_HUE_END', 45);
	define('BRONZE_MIN_SAT', 40);
	define('BRONZE_MIN_VAL', 40);
	define('BRONZE_MAX_VAL', 70);

	// ──────────────────────────────────────────
	// MULTICOLOR DETECTION
	// ──────────────────────────────────────────
	define('MULTICOLOR_MIN_PERCENTAGE', 20.0);      // Each color must be at least this % of pixels
	define('MULTICOLOR_MIN_HUE_DIFF', 60);          // Minimum hue difference between colors
	define('MULTICOLOR_ADJACENT_THRESHOLD', 60);    // Below this = adjacent colors (not multicolor)
	define('MULTICOLOR_SAME_SHADE_THRESHOLD', 30);  // Below this = same color different shade
	define('MULTICOLOR_MAX_VALUE_DIFF', 25);        // Similar brightness = likely same color family

	// ============================================
	// HELPER FUNCTIONS
	// ============================================

	function connectDB()
	{
		try {
			return new PDO(
				"mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4",
				DB_USER,
				DB_PASS,
				[
					PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
					PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
				]
			);
		} catch (PDOException $e) {
			throw new Exception("Database connection failed: " . $e->getMessage());
		}
	}


	function analyzeGIFFrameInfo($filepath)
	{
		// Count frames and extract frame delays by reading GIF structure
		$fileContent = file_get_contents($filepath);
		$frameDelays = [];
		$pos = 0;

		while ($pos < strlen($fileContent)) {
			// Look for Graphics Control Extension
			$pos = strpos($fileContent, "\x21\xF9\x04", $pos);
			if ($pos === false) break;

			// Frame delay is at offset +4 and +5 (little endian, in centiseconds)
			if ($pos + 7 < strlen($fileContent)) {
				$delay = ord($fileContent[$pos + 4]) + (ord($fileContent[$pos + 5]) * 256);
				$frameDelays[] = $delay;
			}

			$pos += 3;
		}

		if (empty($frameDelays)) {
			return ['count' => 1, 'most_common_delay' => 10, 'is_variable' => false];
		}

		// Find most common delay
		$delayCounts = array_count_values($frameDelays);
		arsort($delayCounts);
		$mostCommonDelay = key($delayCounts);

		// Check if variable (more than one unique delay value)
		$isVariable = count($delayCounts) > 1;

		return [
			'count' => count($frameDelays),
			'most_common_delay' => $mostCommonDelay,
			'is_variable' => $isVariable
		];
	}

	function analyzeGIF($filepath)
	{
		if (!file_exists($filepath)) {
			return ['error' => 'File not found'];
		}

		// Get frame info
		$frameInfo = analyzeGIFFrameInfo($filepath);

		// Load first frame using GD
		$image = @imagecreatefromgif($filepath);
		if (!$image) {
			return ['error' => 'Could not read GIF'];
		}

		$width = imagesx($image);
		$height = imagesy($image);

		// PASS 1: Find the lightest color (for filtering)
		$allPixelColors = [];
		for ($y = 0; $y < $height; $y++) {
			for ($x = 0; $x < $width; $x++) {
				$rgb = imagecolorat($image, $x, $y);
				$colors = imagecolorsforindex($image, $rgb);

				$brightness = ($colors['red'] + $colors['green'] + $colors['blue']) / 3;
				$allPixelColors[] = $brightness;
			}
		}

		// Find the brightest color
		$lightestBrightness = max($allPixelColors);

		// PASS 2: Extract colors, filtering out sparkles and optionally the lightest color (if bright)
		$colorCounts = [];
		$totalPixels = 0;

		for ($y = 0; $y < $height; $y++) {
			for ($x = 0; $x < $width; $x++) {
				$rgb = imagecolorat($image, $x, $y);
				$colors = imagecolorsforindex($image, $rgb);

				$r = $colors['red'];
				$g = $colors['green'];
				$b = $colors['blue'];

				// Skip sparkle pixels (bright highlights)
				if ($r > SPARKLE_THRESHOLD && $g > SPARKLE_THRESHOLD && $b > SPARKLE_THRESHOLD) {
					continue;
				}

				// Skip the lightest color ONLY if it's actually bright (like white/light gray)
				if (FILTER_LIGHTEST_COLOR && $lightestBrightness > LIGHTEST_COLOR_THRESHOLD) {
					$brightness = ($r + $g + $b) / 3;
					if (abs($brightness - $lightestBrightness) < 5) {
						continue;
					}
				}

				$totalPixels++;

				// Round colors to reduce variation
				$r = round($r / COLOR_ROUNDING) * COLOR_ROUNDING;
				$g = round($g / COLOR_ROUNDING) * COLOR_ROUNDING;
				$b = round($b / COLOR_ROUNDING) * COLOR_ROUNDING;

				// Clamp to valid range
				$r = max(0, min(255, $r));
				$g = max(0, min(255, $g));
				$b = max(0, min(255, $b));

				$colorKey = "$r,$g,$b";
				if (!isset($colorCounts[$colorKey])) {
					$colorCounts[$colorKey] = 0;
				}
				$colorCounts[$colorKey]++;
			}
		}

		imagedestroy($image);

		if ($totalPixels == 0) {
			return ['error' => 'No valid colors found'];
		}

		// Get all dominant colors (up to 10) ordered by frequency
		$minColorCount = $totalPixels * (MIN_COLOR_PERCENTAGE / 100);
		arsort($colorCounts);
		$allColors = [];
		$processedColors = [];

		foreach ($colorCounts as $colorKey => $count) {
			if ($count < $minColorCount) {
				continue;
			}

			list($r, $g, $b) = explode(',', $colorKey);
			$r = (int)$r;
			$g = (int)$g;
			$b = (int)$b;

			// Check if similar color already processed
			$isSimilar = false;
			foreach ($processedColors as $pc) {
				$distance = sqrt(pow($r - $pc[0], 2) + pow($g - $pc[1], 2) + pow($b - $pc[2], 2));
				if ($distance < COLOR_SIMILARITY_DISTANCE) {
					$isSimilar = true;
					break;
				}
			}

			if (!$isSimilar) {
				$allColors[] = ['rgb' => [$r, $g, $b], 'count' => $count];
				$processedColors[] = [$r, $g, $b];

				if (count($allColors) >= 10) {
					break;
				}
			}
		}

		if (empty($allColors)) {
			return ['error' => 'No colors extracted'];
		}

		// Detect if multicolor first
		$isMulticolor = detectMulticolor($allColors, $totalPixels);

		// Pick representative colors (1 if not multicolor, multiple if multicolor)
		$representativeColors = pickRepresentativeColors($allColors, $isMulticolor);

		// Calculate brightness from representative color (0-1 scale)
		$repColor = $representativeColors[0];
		list($hue, $sat, $val) = rgbToHSV($repColor[0], $repColor[1], $repColor[2]);
		$colorValue = round($val / 100, 2); // Convert to 0-1 scale

		// Calculate hue for sorting (0-1 scale, rotated 15° so red at start)
		if ($isMulticolor) {
			// Multicolor at the very end
			$hueValue = 1.200;
		} elseif ($sat < 30) {  // Neutrals: whites, greys, blacks, browns, tans
			// All low-saturation colors = neutrals
			$hueValue = 1.100;
		} else {
			// Normal colors
			// Pink hues (290-345°) should group with reds at the start
			if ($hue >= HUE_PINK_START && $hue < HUE_RED_START) {
				// Map pink 290-345° to 30-85° (after red's 0-30° range)
				$adjustedHue = ($hue - 290) + 30; // 290° becomes 30°, 344° becomes 84°
			} else {
				// Red consolidates at start: rotate spectrum by 15°
				$adjustedHue = ($hue + 15) % 360; // Red 345-15° becomes 0-30°
			}
			$hueValue = round($adjustedHue / 360, 3); // 0.000-1.000
		}

		// Generate tags (need this for color name generation)
		$suggestedTags = generateTags($colorValue, $representativeColors, $isMulticolor);

		// Generate color name
		$generatedName = generateColorName($colorValue, $hue, $sat, $val, $suggestedTags, $isMulticolor);

		// Calculate sort_order for visual sorting
		if (in_array('pattern', $suggestedTags)) {
			$sortOrder = 6000; // Patterns last
		} elseif ($isMulticolor) {
			$sortOrder = 5000; // Multicolor second-to-last
		} elseif ($sat < 30) {
			// NEUTRALS (includes browns, tans, grays, whites, blacks)
			$sortOrder = 4000 + (int)((1 - $colorValue) * 999);
		} elseif ($sat < 50 && $val > 70) {
			// PASTELS (light + medium-low saturation)
			$sortOrder = 3000 + (int)($hueValue * 900) + (int)((1 - $colorValue) * 99);
		} elseif ($sat < 50) {
			// MUTED (medium saturation)
			$sortOrder = 2000 + (int)($hueValue * 900) + (int)((1 - $colorValue) * 99);
		} else {
			// VIVID (high saturation) - The main rainbow
			$sortOrder = 1000 + (int)($hueValue * 900) + (int)((1 - $colorValue) * 99);
		}

		return [
			'frame_count' => $frameInfo['count'],
			'frame_rate' => $frameInfo['most_common_delay'],
			'is_variable_framerate' => $frameInfo['is_variable'],
			'color_value' => $colorValue,
			'hue' => $hueValue,
			'sort_order' => $sortOrder,  // ← ADD THIS
			'generated_name' => $generatedName,
			'all_colors' => $allColors,
			'representative_colors' => $representativeColors,
			'is_multicolor' => $isMulticolor,
			'total_pixels' => $totalPixels
		];
	}

	function detectMulticolor($allColors, $totalPixels)
	{
		if (count($allColors) < 2) {
			return false;
		}

		$topColor = $allColors[0];
		$secondColor = $allColors[1];

		// Both must be at least 20% of pixels
		$topPercent = ($topColor['count'] / $totalPixels) * 100;
		$secondPercent = ($secondColor['count'] / $totalPixels) * 100;

		if ($topPercent < MULTICOLOR_MIN_PERCENTAGE || $secondPercent < MULTICOLOR_MIN_PERCENTAGE) {
			return false;
		}

		// Get HSV for both colors
		$topRgb = $topColor['rgb'];
		$secondRgb = $secondColor['rgb'];

		list($hue1, $sat1, $val1) = rgbToHSV($topRgb[0], $topRgb[1], $topRgb[2]);
		list($hue2, $sat2, $val2) = rgbToHSV($secondRgb[0], $secondRgb[1], $secondRgb[2]);

		// Calculate hue difference (accounting for wrap-around at 360°)
		$hueDiff = abs($hue1 - $hue2);
		if ($hueDiff > 180) {
			$hueDiff = 360 - $hueDiff;
		}

		// Calculate value (brightness) difference
		$valDiff = abs($val1 - $val2);

		// Colors must be from different families (not adjacent colors)
		$isAdjacent = ($hueDiff < MULTICOLOR_ADJACENT_THRESHOLD);

		// Check if it's just a dark/light version of same color
		$isSameColorDifferentShade = ($hueDiff < MULTICOLOR_SAME_SHADE_THRESHOLD);

		// Special case: Blue and green with similar brightness should NOT be multicolor
		$isBlueGreenSimilarValue = (
			($hue1 >= HUE_BLUE_START && $hue1 < HUE_GREEN_END &&
				$hue2 >= HUE_BLUE_START && $hue2 < HUE_GREEN_END) &&
			$valDiff < MULTICOLOR_MAX_VALUE_DIFF
		);

		if (!$isAdjacent && !$isSameColorDifferentShade && !$isBlueGreenSimilarValue) {
			return true;
		}

		return false;
	}

	function pickRepresentativeColors($allColors, $isMulticolor)
	{
		if (empty($allColors)) {
			return [];
		}

		// If NOT multicolor, pick middle brightness color if similar percentages
		if (!$isMulticolor) {
			// Check if any colors are similar in percentage (within threshold of top color)
			$topCount = $allColors[0]['count'];
			$similarColors = [$allColors[0]];

			// Check ALL colors for similar percentages
			for ($i = 1; $i < count($allColors); $i++) {
				$percentDiff = abs(($allColors[$i]['count'] - $topCount) / $topCount) * 100;
				if ($percentDiff < SIMILAR_COLOR_THRESHOLD) {
					$similarColors[] = $allColors[$i];
				}
			}

			// If multiple similar colors, pick the one with middle brightness
			if (count($similarColors) > 1) {
				// Sort by brightness (darkest to lightest)
				usort($similarColors, function ($a, $b) {
					$brightnessA = ($a['rgb'][0] + $a['rgb'][1] + $a['rgb'][2]) / 3;
					$brightnessB = ($b['rgb'][0] + $b['rgb'][1] + $b['rgb'][2]) / 3;
					return $brightnessA <=> $brightnessB;
				});

				// Pick middle color (or second if even number)
				$middleIndex = floor(count($similarColors) / 2);
				return [$similarColors[$middleIndex]['rgb']];
			}

			// Otherwise use most common color
			return [$allColors[0]['rgb']];
		}

		// If multicolor, pick the main colors (2-3)
		$representative = [$allColors[0]['rgb']];

		if (count($allColors) == 1) {
			return $representative;
		}

		$firstColor = $allColors[0]['rgb'];

		for ($i = 1; $i < count($allColors); $i++) {
			$currentColor = $allColors[$i]['rgb'];

			// Calculate color distance
			$distance = sqrt(
				pow($firstColor[0] - $currentColor[0], 2) +
					pow($firstColor[1] - $currentColor[1], 2) +
					pow($firstColor[2] - $currentColor[2], 2)
			);

			// If drastically different and significant enough
			$percentageOfTop = $allColors[$i]['count'] / $allColors[0]['count'];

			if ($distance > REP_COLOR_DISTANCE && $percentageOfTop > (REP_COLOR_MIN_PERCENTAGE / 100)) {
				$representative[] = $currentColor;

				// Max 3 representative colors
				if (count($representative) >= 3) {
					break;
				}
			}
		}

		return $representative;
	}

	function rgbToHex($r, $g, $b)
	{
		// Ensure values are integers in valid range
		$r = max(0, min(255, (int)$r));
		$g = max(0, min(255, (int)$g));
		$b = max(0, min(255, (int)$b));
		return sprintf("#%02X%02X%02X", $r, $g, $b);
	}

	function rgbToHSV($r, $g, $b)
	{
		$r /= 255;
		$g /= 255;
		$b /= 255;

		$max = max($r, $g, $b);
		$min = min($r, $g, $b);
		$diff = $max - $min;

		// Hue
		if ($diff == 0) {
			$h = 0;
		} elseif ($max == $r) {
			$h = 60 * fmod((($g - $b) / $diff), 6);
		} elseif ($max == $g) {
			$h = 60 * ((($b - $r) / $diff) + 2);
		} else {
			$h = 60 * ((($r - $g) / $diff) + 4);
		}

		if ($h < 0) {
			$h += 360;
		}

		// Saturation
		$s = ($max == 0) ? 0 : ($diff / $max);

		// Value
		$v = $max;

		return [$h, $s * 100, $v * 100];
	}

	function isNeonHue($hue)
	{
		foreach (NEON_HUE_RANGES as $range) {
			if ($hue >= $range[0] && $hue <= $range[1]) {
				return true;
			}
		}
		return false;
	}

	function generateColorName($colorValue, $hue, $sat, $val, $colorTags, $isMulticolor)
	{
		// Multicolor
		if ($isMulticolor) {
			// Filter to only color tags (not modifiers)
			$colorOnlyTags = array_diff($colorTags, [
				'light',
				'dark',
				'pastel',
				'neon',
				'jewel',
				'vivid',
				'muted',
				'warm',
				'cool',
				'neutral',
				'multicolor',
				'pattern',
				'grayscale',
				'gold',
				'silver',
				'bronze'
			]);

			$colorCount = count($colorOnlyTags);

			if ($colorCount >= 5) {
				// Only call it Rainbow if 5+ major colors
				return "Rainbow";
			} elseif ($colorCount == 4) {
				$colors = array_map('ucfirst', array_values($colorOnlyTags));
				return $colors[0] . ", " . $colors[1] . ", " . $colors[2] . ", and " . $colors[3];
			} elseif ($colorCount == 3) {
				$colors = array_map('ucfirst', array_values($colorOnlyTags));
				return $colors[0] . ", " . $colors[1] . ", and " . $colors[2];
			} elseif ($colorCount == 2) {
				$colors = array_map('ucfirst', array_values($colorOnlyTags));
				return $colors[0] . " and " . $colors[1];
			}
		}

		// Neutrals/Grayscale
		if ($sat < GRAYSCALE_MAX_SATURATION) {
			if ($colorValue > 0.9) return "White";
			if ($colorValue > 0.7) return "Light Gray";
			if ($colorValue > 0.4) return "Gray";
			if ($colorValue > 0.2) return "Dark Gray";
			return "Black";
		}

		// Get primary color
		$primaryColor = 'Unknown';
		if (!empty($colorTags)) {
			// Filter out non-color tags
			$colorOnlyTags = array_diff($colorTags, [
				'light',
				'dark',
				'pastel',
				'neon',
				'jewel',
				'vivid',
				'muted',
				'warm',
				'cool',
				'neutral',
				'multicolor',
				'pattern',
				'grayscale'
			]);
			if (!empty($colorOnlyTags)) {
				$primaryColor = reset($colorOnlyTags);
			}
		}

		// Build name with modifiers
		$modifiers = [];

		// Special tone modifiers (highest priority)
		if ($sat > NEON_MIN_SATURATION && $val > NEON_MIN_VALUE && isNeonHue($hue)) {
			$modifiers[] = "Neon";
		} elseif ($sat > JEWEL_MIN_SATURATION && $val >= JEWEL_MIN_VALUE && $val <= JEWEL_MAX_VALUE) {
			$modifiers[] = "Jewel Tone";
		} elseif ($sat > PASTEL_MIN_SATURATION && $sat < PASTEL_MAX_SATURATION && $val > PASTEL_MIN_VALUE) {
			$modifiers[] = "Pastel";
		} elseif ($sat > VIVID_MIN_SATURATION) {
			$modifiers[] = "Vivid";
		} elseif ($sat >= MUTED_MIN_SATURATION && $sat <= MUTED_MAX_SATURATION) {
			$modifiers[] = "Muted";
		} else {
			// Default brightness modifier (only if no tone modifier)
			if ($colorValue > 0.75) {
				$modifiers[] = "Light";
			} elseif ($colorValue < 0.3) {
				$modifiers[] = "Dark";
			}
		}

		return implode(" ", $modifiers) . ($modifiers ? " " : "") . ucfirst($primaryColor);
	}

	function generateTags($colorValue, $representativeColors, $isMulticolor)
	{
		$suggestedTags = [];

		// Brightness tags using config thresholds (0-1 scale)
		if ($colorValue < DARK_THRESHOLD) {
			$suggestedTags[] = 'dark';
		} elseif ($colorValue > LIGHT_THRESHOLD) {
			$suggestedTags[] = 'light';
		}

		// Analyze each representative color
		$colorTags = [];
		$hasPastel = false;
		$hasNeon = false;
		$hasJewelTone = false;

		// Temperature and saturation tracking
		$warmCount = 0;
		$coolCount = 0;
		$vividCount = 0;
		$mutedCount = 0;
		$grayscaleCount = 0;

		foreach ($representativeColors as $color) {
			list($r, $g, $b) = $color;
			list($hue, $sat, $val) = rgbToHSV($r, $g, $b);

			// Color detection by hue (only if saturated enough)
			if ($sat > MIN_SATURATION_FOR_COLOR) {
				if (($hue >= HUE_RED_START) || ($hue < HUE_RED_END)) {
					$colorTags[] = 'red';
				} elseif ($hue >= HUE_ORANGE_START && $hue < HUE_ORANGE_END) {
					$colorTags[] = 'orange';
				} elseif ($hue >= HUE_YELLOW_START && $hue < HUE_YELLOW_END) {
					$colorTags[] = 'yellow';
				} elseif ($hue >= HUE_GREEN_START && $hue < HUE_GREEN_END) {
					$colorTags[] = 'green';
				} elseif ($hue >= HUE_BLUE_START && $hue < HUE_BLUE_END) {
					$colorTags[] = 'blue';
				} elseif ($hue >= HUE_PURPLE_START && $hue < HUE_PURPLE_END) {
					$colorTags[] = 'purple';
				} elseif ($hue >= HUE_PINK_START && $hue < HUE_PINK_END) {
					$colorTags[] = 'pink';
				}
			}

			// Color temperature detection (only if saturated enough)
			if ($sat > TEMP_MIN_SATURATION) {
				if (($hue >= WARM_HUE_START) || ($hue <= WARM_HUE_END)) {
					$warmCount++;
				} elseif ($hue >= COOL_HUE_START && $hue <= COOL_HUE_END) {
					$coolCount++;
				}
			}

			// Saturation level detection
			if ($sat > VIVID_MIN_SATURATION) {
				$vividCount++;
			} elseif ($sat >= MUTED_MIN_SATURATION && $sat <= MUTED_MAX_SATURATION) {
				$mutedCount++;
			} elseif ($sat < GRAYSCALE_MAX_SATURATION) {
				$grayscaleCount++;
			}

			// Pastel: Light colors with low saturation (must have SOME color, not pure gray)
			if ($sat > PASTEL_MIN_SATURATION && $sat < PASTEL_MAX_SATURATION && $val > PASTEL_MIN_VALUE) {
				$hasPastel = true;
			}

			// Neon: Only specific hue ranges (cyan, magenta, lime green, electric blue)
			if ($sat > NEON_MIN_SATURATION && $val > NEON_MIN_VALUE) {
				foreach (NEON_HUE_RANGES as $range) {
					if ($hue >= $range[0] && $hue <= $range[1]) {
						$hasNeon = true;
						break;
					}
				}
			}

			// Jewel tone: Rich, deep colors - high saturation, medium-low brightness
			if ($sat > JEWEL_MIN_SATURATION && $val >= JEWEL_MIN_VALUE && $val <= JEWEL_MAX_VALUE) {
				$hasJewelTone = true;
			}

			// Metal detection
			if ($hue >= GOLD_HUE_START && $hue < GOLD_HUE_END && $sat > GOLD_MIN_SAT && $val > GOLD_MIN_VAL) {
				$suggestedTags[] = 'gold';
			}
			if ($sat < SILVER_MAX_SAT && $val > SILVER_MIN_VAL && $val < SILVER_MAX_VAL) {
				$suggestedTags[] = 'silver';
			}
			if ($hue >= BRONZE_HUE_START && $hue < BRONZE_HUE_END && $sat > BRONZE_MIN_SAT && $val > BRONZE_MIN_VAL && $val < BRONZE_MAX_VAL) {
				$suggestedTags[] = 'bronze';
			}
		}

		// Add unique color tags
		$colorTags = array_unique($colorTags);
		$suggestedTags = array_merge($suggestedTags, $colorTags);

		// Add multicolor tag if detected
		if ($isMulticolor) {
			$suggestedTags[] = 'multicolor';
		}

		// Temperature tags (based on majority of representative colors)
		if ($warmCount > $coolCount && $warmCount > 0) {
			$suggestedTags[] = 'warm';
		} elseif ($coolCount > $warmCount && $coolCount > 0) {
			$suggestedTags[] = 'cool';
		} elseif ($grayscaleCount > 0) {
			// If grayscale, tag as neutral
			$suggestedTags[] = 'neutral';
		}

		// Saturation tags (based on majority of representative colors)
		if ($vividCount > 0 && $vividCount >= $mutedCount) {
			$suggestedTags[] = 'vivid';
		} elseif ($mutedCount > 0 && $mutedCount > $vividCount) {
			$suggestedTags[] = 'muted';
		} elseif ($grayscaleCount > 0) {
			$suggestedTags[] = 'grayscale';
		}

		// Add tone tags
		if ($hasPastel) {
			$suggestedTags[] = 'pastel';
		}
		if ($hasNeon) {
			$suggestedTags[] = 'neon';
		}
		if ($hasJewelTone) {
			$suggestedTags[] = 'jewel';
		}

		return array_unique($suggestedTags);
	}

	function getExistingTags($pdo, $swatchId)
	{
		$stmt = $pdo->prepare("
        SELECT t.slug 
        FROM swatch_tags st 
        JOIN tags t ON st.tag_id = t.id 
        WHERE st.swatch_id = ?
    ");
		$stmt->execute([$swatchId]);
		return array_column($stmt->fetchAll(), 'slug');
	}

	function getTagId($pdo, $tagSlug)
	{
		$stmt = $pdo->prepare("SELECT id FROM tags WHERE slug = ?");
		$stmt->execute([$tagSlug]);
		$result = $stmt->fetch();
		return $result ? $result['id'] : null;
	}

	function getCategoryIdBySlug($pdo, $slug)
	{
		$stmt = $pdo->prepare("SELECT id FROM categories WHERE slug = ?");
		$stmt->execute([$slug]);
		$result = $stmt->fetch();
		return $result ? $result['id'] : null;
	}

	function createCategory($pdo, $name)
	{
		$slug = strtolower(str_replace(' ', '-', $name));

		// Get max sort order
		$stmt = $pdo->query("SELECT MAX(sort_order) as max_order FROM categories");
		$result = $stmt->fetch();
		$sortOrder = ($result['max_order'] ?? 0) + 1;

		$stmt = $pdo->prepare("INSERT INTO categories (name, slug, sort_order) VALUES (?, ?, ?)");
		$stmt->execute([$name, $slug, $sortOrder]);
		return $pdo->lastInsertId();
	}

	// ============================================
	// MAIN LOGIC
	// ============================================

	try {
		$pdo = connectDB();

		// Handle form submission
		if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
			if ($_POST['action'] === 'scan_new') {
				echo '<div class="step">';
				echo '<h2>Scanning for New Glitter Files...</h2>';

				// Get all subdirectories in the glitter directory
				$glitterDir = BASE_PATH . '/images/glitter';
				$subdirs = glob($glitterDir . '/*', GLOB_ONLYDIR);

				echo '<div class="progress">';
				echo 'Found ' . count($subdirs) . ' subdirectories...<br><br>';

				// Get existing URLs from database
				$stmt = $pdo->query("SELECT url FROM swatches");
				$existingUrls = array_column($stmt->fetchAll(), 'url');

				$newFiles = [];
				$brokenFiles = [];
				$totalFiles = 0;

				foreach ($subdirs as $subdir) {
					$categoryName = basename($subdir);
					$files = glob($subdir . '/*.gif');
					$totalFiles += count($files);

					echo "<strong>Category: $categoryName</strong> (" . count($files) . " files)<br>";

					foreach ($files as $filepath) {
						$filename = basename($filepath);
						$relativeUrl = 'images/glitter/' . $categoryName . '/' . $filename;

						// Check if already in database
						if (in_array($relativeUrl, $existingUrls)) {
							continue;
						}

						// Try to analyze the file to see if it's valid
						$image = @imagecreatefromgif($filepath);
						if (!$image) {
							$brokenFiles[] = [
								'filename' => $filename,
								'filepath' => $filepath,
								'category' => $categoryName
							];
							echo "&nbsp;&nbsp;<span style='color: #dc3545;'>✗ BROKEN: $filename</span><br>";
							continue;
						}
						imagedestroy($image);

						// Extract name from filename (after underscore, replace hyphens with spaces)
						$namePart = $filename;
						if (strpos($filename, '_') !== false) {
							$parts = explode('_', $filename, 2);
							$namePart = $parts[1];
						}

						// Remove .gif extension and replace hyphens with spaces
						$name = str_replace('-', ' ', pathinfo($namePart, PATHINFO_FILENAME));
						$name = ucwords($name); // Capitalize words

						$newFiles[] = [
							'filename' => $filename,
							'url' => $relativeUrl,
							'name' => $name,
							'filepath' => $filepath,
							'category' => $categoryName
						];

						echo "&nbsp;&nbsp;<span style='color: #28a745;'>✓ NEW: $filename → \"$name\"</span><br>";
					}

					echo "<br>";
				}

				echo '</div>';

				echo '<div class="info">';
				echo 'Scanned ' . $totalFiles . ' total files across ' . count($subdirs) . ' categories.<br>';
				echo 'Found <strong>' . count($newFiles) . '</strong> new files and <strong>' . count($brokenFiles) . '</strong> broken files.';
				echo '</div>';

				// Show broken files
				if (!empty($brokenFiles)) {
					echo '<div class="warning">';
					echo '<h3>Broken Files Found (' . count($brokenFiles) . ')</h3>';
					echo '<form method="post">';
					echo '<input type="hidden" name="action" value="delete_broken">';
					foreach ($brokenFiles as $file) {
						echo '<input type="hidden" name="broken_files[]" value="' . htmlspecialchars($file['filepath']) . '">';
						echo '<strong>' . htmlspecialchars($file['category']) . ':</strong> ' . htmlspecialchars($file['filename']) . '<br>';
					}
					echo '<button type="submit" style="background: #dc3545; margin-top: 10px;">Delete Broken Files</button>';
					echo '</form>';
					echo '</div>';
				}

				// Show new files
				if (!empty($newFiles)) {
					$_SESSION['new_files'] = $newFiles;

					echo '<div class="success">';
					echo '<h3>Found ' . count($newFiles) . ' New Files</h3>';
					echo '<table>';
					echo '<tr><th>Category</th><th>Filename</th><th>Extracted Name</th><th>Preview</th></tr>';
					foreach ($newFiles as $file) {
						echo '<tr>';
						echo '<td><strong>' . htmlspecialchars($file['category']) . '</strong></td>';
						echo '<td>' . htmlspecialchars($file['filename']) . '</td>';
						echo '<td>' . htmlspecialchars($file['name']) . '</td>';
						echo '<td><img src="../' . htmlspecialchars($file['url']) . '" class="thumbnail"></td>';
						echo '</tr>';
					}
					echo '</table>';
					echo '<form method="post">';
					echo '<input type="hidden" name="action" value="add_new">';
					echo '<button type="submit">Add These Files to Database</button>';
					echo '</form>';
					echo '</div>';
				} else {
					echo '<div class="info">';
					echo 'No new files found. All GIF files are already in the database.';
					echo '</div>';
				}

				echo '</div>';
			} elseif ($_POST['action'] === 'delete_broken') {
				echo '<div class="step">';
				echo '<h2>Deleting Broken Files...</h2>';

				$deleted = 0;
				if (isset($_POST['broken_files']) && is_array($_POST['broken_files'])) {
					foreach ($_POST['broken_files'] as $filepath) {
						if (file_exists($filepath) && unlink($filepath)) {
							echo '<div class="success">Deleted: ' . htmlspecialchars(basename($filepath)) . '</div>';
							$deleted++;
						} else {
							echo '<div class="error">Failed to delete: ' . htmlspecialchars(basename($filepath)) . '</div>';
						}
					}
				}

				echo '<div class="info">Deleted ' . $deleted . ' broken file(s).</div>';
				echo '<a href="analyze-glitter.php"><button>Back to Analyzer</button></a>';
				echo '</div>';
			} elseif ($_POST['action'] === 'add_new') {
				if (!isset($_SESSION['new_files'])) {
					throw new Exception('No new files found. Please scan first.');
				}

				echo '<div class="step">';
				echo '<h2>Adding New Files to Database...</h2>';

				$newFiles = $_SESSION['new_files'];
				$pdo->beginTransaction();

				$added = 0;
				$categoriesCreated = [];

				foreach ($newFiles as $file) {
					// Get or create category
					$categoryName = $file['category'];
					$categorySlug = strtolower(str_replace(' ', '-', $categoryName));

					$categoryId = getCategoryIdBySlug($pdo, $categorySlug);
					if (!$categoryId) {
						$categoryId = createCategory($pdo, $categoryName);
						$categoriesCreated[] = $categoryName;
						echo '<div class="info">Created category: ' . htmlspecialchars($categoryName) . '</div>';
					}

					// Analyze the file
					$analysis = analyzeGIF($file['filepath']);

					if (isset($analysis['error'])) {
						echo '<div class="error">' . htmlspecialchars($file['name']) . ': ' . $analysis['error'] . '</div>';
						continue;
					}

					// Convert representative colors to hex
					$representativeHex = [];
					foreach ($analysis['representative_colors'] as $color) {
						$representativeHex[] = rgbToHex($color[0], $color[1], $color[2]);
					}
					$colorCodes = implode(',', $representativeHex);

					// Insert into database
					$stmt = $pdo->prepare("
                    INSERT INTO swatches (
                        name, url, category_id, color_value, hue, generated_name, 
                        color_codes, frame_count, frame_rate, is_variable_framerate, 
                        is_pixelated, is_active
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
                ");

					$stmt->execute([
						$file['name'],
						$file['url'],
						$categoryId,
						$analysis['color_value'],
						$analysis['hue'],
						$analysis['generated_name'],
						$colorCodes,
						$analysis['frame_count'],
						$analysis['frame_rate'],
						$analysis['is_variable_framerate'] ? 1 : 0
					]);

					$swatchId = $pdo->lastInsertId();

					// Add auto-generated tags
					$suggestedTags = generateTags(
						$analysis['color_value'],
						$analysis['representative_colors'],
						$analysis['is_multicolor']
					);

					foreach ($suggestedTags as $tagSlug) {
						$tagId = getTagId($pdo, $tagSlug);
						if ($tagId) {
							$stmt = $pdo->prepare("
                            INSERT INTO swatch_tags (swatch_id, tag_id, is_auto_generated) 
                            VALUES (?, ?, 1)
                        ");
							$stmt->execute([$swatchId, $tagId]);
						}
					}

					echo '<div class="success"><strong>' . htmlspecialchars($file['category']) . ':</strong> ' . htmlspecialchars($file['name']) . '</div>';
					$added++;
				}

				$pdo->commit();

				echo '<div class="info">';
				echo 'Added ' . $added . ' new swatch(es) to database.<br>';
				if (!empty($categoriesCreated)) {
					echo 'Created ' . count($categoriesCreated) . ' new categories: ' . implode(', ', $categoriesCreated);
				}
				echo '</div>';

				// Clear session
				unset($_SESSION['new_files']);

				echo '<a href="analyze-glitter.php"><button>Run Full Analysis</button></a>';
				echo '</div>';
			} elseif ($_POST['action'] === 'analyze') {
				echo '<div class="step">';
				echo '<h2>Step 1: Analyzing Glitter Files...</h2>';

				// Fetch all swatches
				$stmt = $pdo->query("SELECT id, name, url FROM swatches WHERE is_active = 1 ORDER BY id");
				$swatches = $stmt->fetchAll();

				$results = [];
				$errors = [];

				echo '<div class="progress">';
				echo 'Processing ' . count($swatches) . ' swatches...<br>';

				foreach ($swatches as $swatch) {
					$filepath = BASE_PATH . '/' . $swatch['url'];

					echo "Analyzing {$swatch['name']}... ";
					flush();
					ob_flush();

					$analysis = analyzeGIF($filepath);

					if (isset($analysis['error'])) {
						$errors[] = "{$swatch['name']}: {$analysis['error']}";
						echo "<span style='color: #dc3545;'>ERROR</span><br>";
					} else {
						// Convert ALL colors to hex for display
						$allHexColors = [];
						foreach ($analysis['all_colors'] as $colorData) {
							$rgb = $colorData['rgb'];
							$allHexColors[] = [
								'hex' => rgbToHex($rgb[0], $rgb[1], $rgb[2]),
								'count' => $colorData['count'],
								'percentage' => round(($colorData['count'] / $analysis['total_pixels']) * 100, 1)
							];
						}

						// Representative colors to hex
						$representativeHex = [];
						foreach ($analysis['representative_colors'] as $color) {
							$representativeHex[] = rgbToHex($color[0], $color[1], $color[2]);
						}

						// Generate suggested tags (already calculated in analyzeGIF but we need it here)
						$suggestedTags = generateTags(
							$analysis['color_value'],
							$analysis['representative_colors'],
							$analysis['is_multicolor']
						);

						// Get existing tags
						$existingTags = getExistingTags($pdo, $swatch['id']);

						// Filter out existing tags
						$newTags = array_diff($suggestedTags, $existingTags);

$results[] = [
    'id' => $swatch['id'],
    'name' => $swatch['name'],
    'url' => $swatch['url'],
    'color_value' => $analysis['color_value'],
    'hue' => $analysis['hue'],
    'sort_order' => $analysis['sort_order'],  // ← ADD THIS
    'generated_name' => $analysis['generated_name'],
    'all_colors' => $allHexColors,
    'color_codes' => implode(',', $representativeHex),
    'frame_count' => $analysis['frame_count'],
    'frame_rate' => $analysis['frame_rate'],
    'is_variable_framerate' => $analysis['is_variable_framerate'],
    'is_multicolor' => $analysis['is_multicolor'],
    'existing_tags' => $existingTags,
    'new_tags' => $newTags
];

						echo "<span style='color: #28a745;'>OK</span><br>";
					}

					flush();
					ob_flush();
				}

				echo '</div>';

				if (!empty($errors)) {
					echo '<div class="warning">';
					echo '<strong>Errors:</strong><br>';
					foreach ($errors as $error) {
						echo htmlspecialchars($error) . '<br>';
					}
					echo '</div>';
				}

				// Store results in session for next step
				$_SESSION['analysis_results'] = $results;

				echo '</div>';

				// Display results table
				if (!empty($results)) {
					echo '<div class="step">';
					echo '<h2>Step 2: Review Changes</h2>';

					echo '<div class="info">';
					echo '<strong>Column Explanation:</strong><br>';
					echo '<strong>Your Name:</strong> The name you originally gave this swatch.<br>';
					echo '<strong>Generated Name:</strong> Programmatically created name (e.g., "Light Red", "Neon Pink", "Red and Green").<br>';
					echo '<strong>Hue:</strong> Color position 0-1 (red→orange→yellow→green→blue→purple→pink, neutrals=1.1).<br>';
					echo '<strong>Brightness:</strong> 0-1 scale based on representative color.<br>';
					echo '<strong>All Colors:</strong> Up to 10 most common colors (hover for percentage).<br>';
					echo '<strong>Representative:</strong> Colors saved to database (green border). 1 color normally, multiple if multicolor.<br>';
					echo '<strong>Frame Rate:</strong> Most common delay in centiseconds (cs). Variable = has different delays.<br>';
					echo '</div>';

					echo '<table>';
					echo '<tr>';
					echo '<th>ID</th>';
					echo '<th>Your Name</th>';
					echo '<th>Generated Name</th>';
					echo '<th>Preview</th>';
					echo '<th>Hue</th>';
					echo '<th>Brightness</th>';
					echo '<th>All Colors</th>';
					echo '<th>Representative</th>';
					echo '<th>Multi?</th>';
					echo '<th>Frames</th>';
					echo '<th>FPS (cs)</th>';
					echo '<th>Var?</th>';
					echo '<th>Current Tags</th>';
					echo '<th>New Tags</th>';
					echo '</tr>';

					foreach ($results as $result) {
						echo '<tr>';
						echo '<td>' . $result['id'] . '</td>';
						echo '<td>' . htmlspecialchars($result['name']) . '</td>';
						echo '<td><strong>' . htmlspecialchars($result['generated_name']) . '</strong></td>';
						echo '<td><img src="../' . htmlspecialchars($result['url']) . '" class="thumbnail"></td>';
						echo '<td>' . $result['hue'] . '</td>';
						echo '<td>' . $result['color_value'] . '</td>';

						// All colors column
						echo '<td>';
						foreach ($result['all_colors'] as $colorInfo) {
							echo '<span class="color-swatch" style="background-color: ' . htmlspecialchars($colorInfo['hex']) . '" title="' . $colorInfo['percentage'] . '% (' . $colorInfo['count'] . ' pixels)"></span>';
						}
						echo '</td>';

						// Representative colors (saved to DB)
						echo '<td>';
						$colors = explode(',', $result['color_codes']);
						foreach ($colors as $color) {
							echo '<span class="color-swatch" style="background-color: ' . htmlspecialchars($color) . '; border: 2px solid #28a745;"></span>';
						}
						echo '</td>';

						// Multicolor status
						echo '<td>' . ($result['is_multicolor'] ? '✓' : '') . '</td>';

						// Frame info
						echo '<td>' . $result['frame_count'] . '</td>';
						echo '<td>' . $result['frame_rate'] . '</td>';
						echo '<td>' . ($result['is_variable_framerate'] ? '✓' : '') . '</td>';

						// Tags
						echo '<td>';
						foreach ($result['existing_tags'] as $tag) {
							echo '<span class="tag existing">' . htmlspecialchars($tag) . '</span>';
						}
						echo '</td>';
						echo '<td>';
						if (empty($result['new_tags'])) {
							echo '<em>None</em>';
						} else {
							foreach ($result['new_tags'] as $tag) {
								echo '<span class="tag new">' . htmlspecialchars($tag) . '</span>';
							}
						}
						echo '</td>';
						echo '</tr>';
					}

					echo '</table>';

					echo '<form method="post">';
					echo '<input type="hidden" name="action" value="apply">';
					echo '<button type="submit">Apply Changes to Database</button>';
					echo '</form>';

					echo '</div>';
				}
			} elseif ($_POST['action'] === 'apply') {
				if (!isset($_SESSION['analysis_results'])) {
					throw new Exception('No analysis results found. Please run analysis first.');
				}

				$results = $_SESSION['analysis_results'];

				echo '<div class="step">';
				echo '<h2>Step 3: Applying Changes...</h2>';

				$pdo->beginTransaction();

				$updated = 0;
				$tagsAdded = 0;

				foreach ($results as $result) {
					// Update swatch columns
$stmt = $pdo->prepare("
    UPDATE swatches 
    SET color_value = ?, hue = ?, sort_order = ?, generated_name = ?, color_codes = ?, frame_count = ?, frame_rate = ?, is_variable_framerate = ?
    WHERE id = ?
");
$stmt->execute([
    $result['color_value'],
    $result['hue'],
    $result['sort_order'],  // ← ADD THIS
    $result['generated_name'],
    $result['color_codes'],
    $result['frame_count'],
    $result['frame_rate'],
    $result['is_variable_framerate'] ? 1 : 0,
    $result['id']
]);
					$updated++;

					// Add new tags
					foreach ($result['new_tags'] as $tagSlug) {
						$tagId = getTagId($pdo, $tagSlug);
						if ($tagId) {
							// Check if relationship already exists
							$stmt = $pdo->prepare("
                            SELECT id FROM swatch_tags 
                            WHERE swatch_id = ? AND tag_id = ?
                        ");
							$stmt->execute([$result['id'], $tagId]);

							if (!$stmt->fetch()) {
								$stmt = $pdo->prepare("
                                INSERT INTO swatch_tags (swatch_id, tag_id, is_auto_generated) 
                                VALUES (?, ?, 1)
                            ");
								$stmt->execute([$result['id'], $tagId]);
								$tagsAdded++;
							}
						}
					}
				}

				$pdo->commit();

				echo '<div class="success">';
				echo "Updated $updated swatches<br>";
				echo "Added $tagsAdded new tag relationships<br>";
				echo '</div>';

				// Regenerate swatches.json
				echo '<h3>Regenerating swatches.json...</h3>';

				$sql = "
					SELECT 
						s.id,
						s.name,
						s.url,
						s.is_pixelated,
						s.hue,
						s.color_value,
						s.sort_order,
						s.generated_name,
						s.color_codes,
						s.frame_count,
						s.frame_rate,
						s.is_variable_framerate,
						c.name AS category,
						GROUP_CONCAT(t.slug ORDER BY t.slug ASC SEPARATOR ',') AS tags
					FROM swatches s
					INNER JOIN categories c ON s.category_id = c.id
					LEFT JOIN swatch_tags st ON s.id = st.swatch_id
					LEFT JOIN tags t ON st.tag_id = t.id
					WHERE s.is_active = 1
					GROUP BY s.id, s.name, s.url, s.is_pixelated, c.name
					ORDER BY s.sort_order ASC
				";

				$stmt = $pdo->query($sql);
				$swatches = $stmt->fetchAll();

				$glitterGifs = [];
				foreach ($swatches as $swatch) {
					$glitterGifs[] = [
						'id' => $swatch['id'],
						'url' => $swatch['url'],
						'name' => $swatch['name'],
						'generatedName' => $swatch['generated_name'],
						'category' => $swatch['category'],
						'hue' => (float) $swatch['hue'],
						'brightness' => (float) $swatch['color_value'],
						'colorCodes' => $swatch['color_codes'] ? explode(',', $swatch['color_codes']) : [],
						'frameCount' => (int) $swatch['frame_count'],
						'frameRate' => (int) $swatch['frame_rate'],
						'isVariableFramerate' => (bool) $swatch['is_variable_framerate'],
						'sortOrder' => (int) $swatch['sort_order'],
						'isPixelated' => (bool) $swatch['is_pixelated'],
						'tags' => $swatch['tags'] ? explode(',', $swatch['tags']) : []
					];
				}

				$outputFile = BASE_PATH . '/data/swatches.json';
				$jsonOutput = json_encode($glitterGifs, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

				if (file_put_contents($outputFile, $jsonOutput) !== false) {
					echo '<div class="success">';
					echo 'swatches.json regenerated successfully!';
					echo '</div>';
				} else {
					echo '<div class="error">';
					echo 'Failed to write swatches.json';
					echo '</div>';
				}

				echo '</div>';

				// Clear session
				unset($_SESSION['analysis_results']);

				echo '<a href="analyze-glitter.php"><button>Run Analysis Again</button></a>';
			}
		} else {
			// Initial page load
			echo '<h1>Glitter Swatch Analyzer</h1>';

			echo '<div class="info">';
			echo '<strong>Configuration:</strong> All detection thresholds can be adjusted at the top of this PHP file (lines 5-120).<br><br>';
			echo 'This tool will analyze all glitter GIF files and:<br>';
			echo '• Calculate hue (0-1) and brightness (0-1) from representative color<br>';
			echo '• Generate programmatic color name (e.g., "Light Red", "Neon Pink", "Jewel Tone Purple")<br>';
			echo '• Extract dominant color codes (1 if solid, multiple if multicolor)<br>';
			echo '• Count animation frames and detect frame rate<br>';
			echo '• Filter out sparkles AND lightest color (only if bright)<br>';
			echo '• Suggest new tags based on analysis<br>';
			echo '• Create categories from subfolder names<br><br>';
			echo '<strong>Current Settings:</strong><br>';
			echo 'Sparkle Threshold: ' . SPARKLE_THRESHOLD . ' | ';
			echo 'Filter Lightest Color: ' . (FILTER_LIGHTEST_COLOR ? 'Yes' : 'No') . ' (if >' . LIGHTEST_COLOR_THRESHOLD . ') | ';
			echo 'Dark: <' . DARK_THRESHOLD . ' | ';
			echo 'Light: >' . LIGHT_THRESHOLD . '<br>';
			echo '<strong>Sorting:</strong> ORDER BY hue ASC, color_value DESC (rainbow order, light to dark)';
			echo '</div>';

			// NEW: Scan for new files section
			echo '<div class="step">';
			echo '<h2>1. Scan for New Files</h2>';
			echo '<p>Scans <code>/images/glitter/*/</code> subdirectories for GIF files. Each subfolder becomes a category.</p>';
			echo '<p><strong>Example:</strong> <code>/images/glitter/sparkle/001_red.gif</code> → Category: "Sparkle", Name: "Red"</p>';
			echo '<form method="post">';
			echo '<input type="hidden" name="action" value="scan_new">';
			echo '<button type="submit">Scan for New Files</button>';
			echo '</form>';
			echo '</div>';

			echo '<div class="step">';
			echo '<h2>2. Analyze Existing Swatches</h2>';
			echo '<p>Re-analyze all swatches currently in the database and update their properties.</p>';
			echo '<form method="post">';
			echo '<input type="hidden" name="action" value="analyze">';
			echo '<button type="submit">Analyze All Swatches</button>';
			echo '</form>';
			echo '</div>';
		}
	} catch (Exception $e) {
		echo '<div class="error">';
		echo 'Error: ' . htmlspecialchars($e->getMessage());
		echo '</div>';
	}

	?>

</body>

</html>
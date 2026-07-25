<?php

require_once(__DIR__ . '/colorUtils.php');

class AssetAnalysisResult
{
	public static function fromAnalyzer($analysis, $filePath, $config)
	{
		$colors = self::csv((string)($analysis['color_codes'] ?? ''));
		$weights = array_map('floatval', self::csv((string)($analysis['color_weights'] ?? '')));
		$palette = [];
		foreach ($colors as $index => $color) {
			$palette[] = [
				'hex' => strtoupper($color),
				'weight' => round((float)($weights[$index] ?? 0), 4),
			];
		}
		$classification = self::classificationFrom($analysis, $palette, $config);
		$info = @getimagesize($filePath);
		$mime = $info['mime'] ?? (new finfo(FILEINFO_MIME_TYPE))->file($filePath);
		$frameCount = (int)($analysis['frame_count'] ?? 1);
		$frameRate = (int)($analysis['frame_rate'] ?? 0);

		return [
			'version' => (int)$config['analysis_version'],
			'file_hash' => hash_file('sha256', $filePath),
			'analyzed_at' => gmdate('c'),
			'dimensions' => [
				'width' => (int)($info[0] ?? $analysis['width'] ?? 0),
				'height' => (int)($info[1] ?? $analysis['height'] ?? 0),
			],
			'file' => [
				'bytes' => (int)filesize($filePath),
				'mime' => (string)$mime,
				'extension' => strtolower(pathinfo($filePath, PATHINFO_EXTENSION)),
			],
			'animation' => [
				'animated' => $frameCount > 1,
				'frame_count' => $frameCount,
				'frame_rate' => $frameRate,
				'variable_rate' => (bool)($analysis['is_variable_framerate'] ?? false),
				'duration_ms' => $frameCount * $frameRate * 10,
			],
			'alpha' => [
				'has_transparency' => (bool)($analysis['has_transparency'] ?? false),
				'opaque_coverage' => round((float)($analysis['opaque_coverage'] ?? 1), 4),
			],
			'palette' => [
				'type' => $classification['type'],
				'colors' => array_slice($palette, 0, $classification['limit']),
				'entropy' => $classification['entropy'],
				'hue_family_count' => $classification['families'],
				'confidence' => $classification['confidence'],
				'explanation' => $classification['explanation'],
			],
			'effects' => [
				'sparkle_coverage' => round((float)($analysis['sparkle_coverage'] ?? 0), 4),
			],
		];
	}

	public static function decode($json)
	{
		$value = is_array($json) ? $json : json_decode((string)$json, true);
		if (!is_array($value) || !isset($value['version'], $value['palette'])) {
			return null;
		}
		return $value;
	}

	private static function csv($value)
	{
		return $value === '' ? [] : array_values(array_filter(array_map('trim', explode(',', $value)), 'strlen'));
	}

	// ColorClassifier runs over every cluster the analyzer found, including
	// those below color_threshold, so it sees hue families that never reach
	// the exported palette. Prefer its verdict; classifyPalette() below is
	// only the fallback for analysis payloads written before it existed.
	private static function classificationFrom($analysis, $palette, $config)
	{
		if (empty($analysis['palette_type'])) {
			return self::classifyPalette($palette, $analysis, $config);
		}
		$type = (string)$analysis['palette_type'];
		return [
			'type' => $type,
			'limit' => in_array($type, ['complex-palette', 'multicolor', 'rainbow', 'gradient'], true)
				? $config['palette_sample_limit']
				: $config['palette_limited_limit'],
			'entropy' => round((float)($analysis['color_entropy'] ?? 0), 3),
			'families' => (int)($analysis['hue_family_count'] ?? 0),
			'confidence' => round((float)($analysis['color_confidence'] ?? 0), 2),
			'explanation' => self::explainType($type),
		];
	}

	private static function explainType($type)
	{
		$explanations = [
			'rainbow' => 'Several balanced hue families span the color wheel.',
			'multicolor' => 'Several materially represented hue families are present.',
			'complex-palette' => 'Many representative colors share the visible area.',
			'gradient' => 'Two neighbouring hue families blend across the image.',
			'neutral' => 'Most visible pixels have low chroma.',
			'dominant-color' => 'One color dominates the visible pixels.',
		];
		return $explanations[$type] ?? 'A small set of representative colors describes this image.';
	}

	public static function classifyPalette($palette, $analysis, $config)
	{
		$families = [];
		$entropy = 0;
		$weightTotal = array_sum(array_column($palette, 'weight'));
		$neutralWeight = 0;
		foreach ($palette as $color) {
			$rgb = hexToRgb($color['hex']);
			if (!$rgb) continue;
			list($hue, $saturation) = rgbToHSV($rgb[0], $rgb[1], $rgb[2]);
			$weight = $color['weight'];
			if ($saturation / 100 < $config['palette_neutral_chroma']) {
				$neutralWeight += $weight;
				continue;
			}
			$family = (int)floor(fmod($hue + 15, 360) / 30);
			$families[$family] = ($families[$family] ?? 0) + $weight;
		}
		if (count($palette) > 1 && $weightTotal > 0) {
			foreach ($palette as $color) {
				$share = $color['weight'] / $weightTotal;
				if ($share > 0) $entropy -= $share * log($share);
			}
			$entropy /= log(count($palette));
		}
		$familyCount = count(array_filter($families, function ($weight) use ($config) {
			return $weight >= $config['color_tag_min_family_weight'];
		}));
		$dominant = (float)($palette[0]['weight'] ?? 0);
		$type = 'limited';
		$explanation = 'A small set of representative colors describes this image.';
		if ($weightTotal > 0 && $neutralWeight / $weightTotal >= 0.8) {
			$type = 'neutral';
			$explanation = 'Most visible pixels have low chroma.';
		} elseif ($familyCount >= $config['rainbow_min_families'] && $entropy >= $config['rainbow_min_entropy']) {
			$type = 'rainbow';
			$explanation = 'Several balanced hue families span the color wheel.';
		} elseif ($entropy >= $config['palette_photographic_entropy'] && count($palette) >= 6) {
			$type = 'complex-palette';
			$explanation = 'Many representative colors share the visible area.';
		} elseif ($familyCount >= $config['palette_multicolor_families']) {
			$type = 'multicolor';
			$explanation = 'Several materially represented hue families are present.';
		} elseif (count($palette) === 1 || $dominant >= 0.75) {
			$type = 'dominant-color';
			$explanation = 'One color dominates the visible pixels.';
		}
		return [
			'type' => $type,
			'limit' => in_array($type, ['complex-palette', 'multicolor', 'rainbow'], true)
				? $config['palette_sample_limit']
				: $config['palette_limited_limit'],
			'entropy' => round($entropy, 3),
			'families' => $familyCount,
			'confidence' => round(min(1, max(0.35, abs($dominant - 0.5) + 0.45)), 2),
			'explanation' => $explanation,
		];
	}
}

<?php

require_once(__DIR__ . '/colorUtils.php');

class ColorClassifier
{
	private $config;

	public function __construct($config)
	{
		$this->config = $config;
	}

	public function classify($clusters)
	{
		$profile = $this->buildProfile($clusters);
		// Measurements ride on every verdict, so the naming rules below only
		// have to return the verdict itself.
		return array_merge($this->describeProfile($profile), [
			'family_count' => count($profile['families']),
			'entropy' => $profile['entropy'],
		]);
	}

	private function describeProfile($profile)
	{
		// A trace of color does not make an asset colored: a glint, a stray
		// antialiased edge, or one warm cluster in a grayscale ramp would
		// otherwise name the whole thing after a few percent of its pixels.
		if (!$profile['colored'] || $profile['colored_coverage'] < $this->config['naming_min_colored_coverage']) {
			$neutral = $profile['neutral'][0] ?? null;
			return [
				'name' => $neutral ? $this->describeNeutral($neutral['value']) : 'Transparent',
				'palette_type' => 'neutral',
				'confidence' => $neutral ? min(1, $neutral['coverage'] / 0.5) : 0,
			];
		}

		// Already gated to families holding a material share, largest first.
		$families = $profile['families'];
		$familyCount = count($families);
		$dominantShare = $families[0]['coverage'] / max(0.0001, $profile['colored_coverage']);
		$rainbow = (
			$familyCount >= $this->config['rainbow_min_families']
			&& $profile['entropy'] >= $this->config['rainbow_min_entropy']
		) || (
			$familyCount >= $this->config['rainbow_balanced_min_families']
			&& $profile['entropy'] >= $this->config['rainbow_balanced_min_entropy']
			&& $dominantShare <= $this->config['rainbow_max_dominant_share']
			&& $profile['colored_coverage'] >= $this->config['rainbow_min_colored_coverage']
		);

		if ($rainbow) {
			return [
				'name' => 'Rainbow',
				'palette_type' => 'rainbow',
				'confidence' => min(1, ($profile['entropy'] + min(1, $familyCount / 6)) / 2),
			];
		}

		if ($familyCount === 2 && $this->familiesAdjacent($families[0]['family'], $families[1]['family'])) {
			$average = $this->salientAverage($profile['colored']);
			return [
				'name' => $this->describeColor($average['hue'], $average['saturation'], $average['value']),
				'palette_type' => 'gradient',
				'confidence' => min(1, 1 - ($profile['entropy'] * 0.2)),
			];
		}

		$significantFamilies = array_values(array_filter($families, function ($family) {
			return $family['coverage'] >= $this->config['compound_color_min_coverage'];
		}));
		$whiteCoverage = $profile['white_coverage'];
		if (count($significantFamilies) >= 2 && $whiteCoverage >= $this->config['compound_white_min_coverage']) {
			$firstTwo = array_column(array_slice($significantFamilies, 0, 2), 'family');
			$names = in_array('red', $firstTwo, true) && in_array('blue', $firstTwo, true)
				? ['Red', 'White', 'Blue']
				: [
					$this->simpleFamilyName($significantFamilies[0]['family']),
					'White',
					$this->simpleFamilyName($significantFamilies[1]['family']),
				];
			return [
				'name' => $this->joinNames($names),
				'palette_type' => 'multicolor',
				'confidence' => min(1, array_sum(array_column(array_slice($significantFamilies, 0, 2), 'coverage')) + $whiteCoverage),
			];
		}

		if ($familyCount >= 3 || ($familyCount >= 2 && $profile['dominant']['coverage'] < $this->config['single_color_min_dominance'])) {
			$names = array_map(function ($family) {
				return $this->simpleFamilyName($family['family']);
			}, array_slice($families, 0, 3));
			return [
				'name' => count($names) <= 3 ? $this->joinNames($names) : 'Multicolor',
				'palette_type' => 'multicolor',
				'confidence' => min(1, $profile['entropy'] + 0.15),
			];
		}

		if (count($significantFamilies) >= 2) {
			return [
				'name' => $this->joinNames([
					$this->simpleFamilyName($significantFamilies[0]['family']),
					$this->simpleFamilyName($significantFamilies[1]['family']),
				]),
				'palette_type' => 'two-tone',
				'confidence' => min(1, $significantFamilies[0]['coverage'] + $significantFamilies[1]['coverage']),
			];
		}

		$dominant = $profile['dominant'];
		return [
			'name' => $this->describeColor($dominant['hue'], $dominant['saturation'], $dominant['value']),
			'palette_type' => 'single',
			'confidence' => min(1, $dominantShare),
		];
	}

	private function buildProfile($clusters)
	{
		$colored = [];
		$neutral = [];
		$families = [];
		$whiteCoverage = 0;
		foreach ($clusters as $cluster) {
			if ($cluster['coverage'] < $this->config['naming_min_coverage']) {
				continue;
			}
			list($hue, $saturation, $value) = rgbToHSV($cluster['rgb'][0], $cluster['rgb'][1], $cluster['rgb'][2]);
			$entry = array_merge($cluster, [
				'hue' => $hue,
				'saturation' => $saturation,
				'value' => $value,
			]);
			if ($saturation < $this->config['naming_min_saturation'] || $value < $this->config['naming_min_value']) {
				$neutral[] = $entry;
				if ($value >= 88) {
					$whiteCoverage += $cluster['coverage'];
				}
				continue;
			}
			$entry['family'] = $this->hueFamily($hue);
			$colored[] = $entry;
			if (!isset($families[$entry['family']])) {
				$families[$entry['family']] = ['family' => $entry['family'], 'coverage' => 0];
			}
			$families[$entry['family']]['coverage'] += $cluster['coverage'];
		}
		usort($neutral, function ($a, $b) {
			return $b['coverage'] <=> $a['coverage'];
		});

		$families = $this->qualifyFamilies($families, array_sum(array_column($colored, 'coverage')));
		// Trace families are noise, so nothing downstream — naming averages,
		// dominance, entropy — may see the clusters that formed them.
		$kept = array_flip(array_column($families, 'family'));
		$colored = array_values(array_filter($colored, function ($entry) use ($kept) {
			return isset($kept[$entry['family']]);
		}));
		usort($colored, function ($a, $b) {
			return $b['coverage'] <=> $a['coverage'];
		});
		$coloredCoverage = array_sum(array_column($colored, 'coverage'));
		$entropy = 0;
		if (count($families) > 1 && $coloredCoverage > 0) {
			foreach ($families as $family) {
				$share = $family['coverage'] / $coloredCoverage;
				$entropy -= $share * log($share);
			}
			$entropy /= log(count($families));
		}

		return [
			'colored' => $colored,
			'neutral' => $neutral,
			'families' => $families,
			'colored_coverage' => $coloredCoverage,
			'white_coverage' => $whiteCoverage,
			'entropy' => round($entropy, 3),
			'dominant' => $colored[0] ?? null,
		];
	}

	// A family earns its place by holding a material share of the colored
	// area, measured both absolutely and relative to that area. Below those
	// floors it is dither speckle, an antialiased edge, or a gradient step.
	// If nothing clears the bar the largest family still stands in, so a
	// thinly-colored image is named rather than treated as colorless.
	private function qualifyFamilies($families, $coloredCoverage)
	{
		$floor = max(
			$this->config['family_min_coverage'],
			$this->config['family_min_share'] * $coloredCoverage
		);
		$qualified = array_values(array_filter($families, function ($family) use ($floor) {
			return $family['coverage'] >= $floor;
		}));
		if (!$qualified && $families) {
			$qualified = [array_reduce($families, function ($best, $family) {
				return $best === null || $family['coverage'] > $best['coverage'] ? $family : $best;
			})];
		}
		usort($qualified, function ($a, $b) {
			return $b['coverage'] <=> $a['coverage'];
		});
		return $qualified;
	}

	private function hueFamily($hue)
	{
		return hueFamily($hue);
	}

	private function simpleFamilyName($family)
	{
		return simpleFamilyName($family);
	}

	private function describeColor($hue, $saturation, $value)
	{
		if ($hue >= 345 || $hue < 10) {
			if ($value < 25) return 'Deep Burgundy';
			if ($value < 62 && $saturation >= 50) return $value < 42 ? 'Dark Ruby Red' : 'Ruby Red';
			return $this->withTone('Red', $saturation, $value);
		}
		if ($hue < 36) {
			if ($value < 30) return 'Dark Brown';
			if ($hue < 26 && $saturation >= 45 && $value <= 72) return 'Burnt Orange';
			if ($saturation <= 55 && $value >= 60) return 'Tan';
			if ($hue >= 26 && $value <= 72) return $value < 50 ? 'Dark Bronze' : 'Bronze';
			if ($value < 58) return $saturation < 45 ? 'Brown' : 'Dark Bronze';
			return $this->withTone('Orange', $saturation, $value);
		}
		if ($hue < 52) {
			if ($value < 38) return 'Dark Brown';
			if ($saturation <= 58 && $value >= 62) return 'Tan';
			if ($value <= 72) return $value < 52 ? 'Dark Bronze' : 'Bronze';
			return $this->withTone('Golden Orange', $saturation, $value);
		}
		if ($hue < 72) return $this->withTone('Yellow', $saturation, $value);
		if ($hue < 105) return $this->withTone('Yellow-Green', $saturation, $value);
		if ($hue < 150) return $this->withTone('Green', $saturation, $value);
		if ($hue < 178) return $this->withTone('Blue-Green', $saturation, $value);
		if ($hue < 202) return $this->withTone('Teal', $saturation, $value);
		if ($hue < 250) return $this->withTone('Blue', $saturation, $value);
		if ($hue < 275) return $this->withTone('Indigo', $saturation, $value);
		if ($hue < 315) return $this->withTone('Purple', $saturation, $value);
		if ($hue < 335) return $this->withTone('Magenta', $saturation, $value);
		if ($value < 60 && $saturation >= 45) return $value < 42 ? 'Dark Ruby Red' : 'Ruby Red';
		return $this->withTone('Pink', $saturation, $value);
	}

	private function familiesAdjacent($first, $second)
	{
		$order = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];
		$firstIndex = array_search($first, $order, true);
		$secondIndex = array_search($second, $order, true);
		$distance = abs($firstIndex - $secondIndex);
		return $distance === 1 || $distance === count($order) - 1;
	}

	private function salientAverage($colors)
	{
		$x = 0;
		$y = 0;
		$saturation = 0;
		$value = 0;
		$total = 0;
		foreach ($colors as $color) {
			$weight = sqrt($color['coverage'])
				* (0.25 + ($color['value'] / 100))
				* (0.5 + ($color['saturation'] / 200));
			$radians = deg2rad($color['hue']);
			$x += cos($radians) * $weight;
			$y += sin($radians) * $weight;
			$saturation += $color['saturation'] * $weight;
			$value += $color['value'] * $weight;
			$total += $weight;
		}
		$hue = rad2deg(atan2($y, $x));
		if ($hue < 0) $hue += 360;
		return [
			'hue' => $hue,
			'saturation' => $saturation / max(0.0001, $total),
			'value' => $value / max(0.0001, $total),
		];
	}

	private function withTone($name, $saturation, $value)
	{
		if ($value < 28) return 'Deep ' . $name;
		if ($value < 48) return 'Dark ' . $name;
		if ($saturation < 30 && $value > 72) return 'Muted ' . $name;
		if ($value > 88 && $saturation < 65) return 'Light ' . $name;
		if ($value > 78 && $saturation > 82) return 'Vivid ' . $name;
		return $name;
	}

	private function describeNeutral($value)
	{
		if ($value > 95) return 'White';
		if ($value > 84) return 'Off-White';
		if ($value > 68) return 'Light Gray';
		if ($value > 45) return 'Gray';
		if ($value > 25) return 'Dark Gray';
		if ($value > 12) return 'Charcoal';
		return 'Black';
	}

	private function joinNames($names)
	{
		$names = array_values(array_unique($names));
		if (count($names) === 1) return $names[0];
		if (count($names) === 2) return $names[0] . ' and ' . $names[1];
		$last = array_pop($names);
		return implode(', ', $names) . ', and ' . $last;
	}
}

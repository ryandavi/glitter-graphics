<?php

require_once(__DIR__ . '/colorUtils.php');
require_once(__DIR__ . '/colorClassifier.php');

class GifAnalyzer
{
	private $imagePath;
	private $config;

	public function __construct($imagePath, $config)
	{
		$this->imagePath = $imagePath;
		$this->config = $config;
	}

	public function analyze()
	{
		if (!file_exists($this->imagePath)) {
			throw new Exception('File not found: ' . $this->imagePath);
		}

		return array_merge($this->extractFrameData(), $this->extractColorData());
	}

	private function extractFrameData()
	{
		$imageInfo = @getimagesize($this->imagePath);
		if ($imageInfo && $imageInfo[2] !== IMAGETYPE_GIF) {
			return ['frame_count' => 1, 'frame_rate' => 0, 'is_variable_framerate' => 0];
		}

		$content = file_get_contents($this->imagePath);
		$delays = [];
		$position = 0;
		while (($position = strpos($content, "\x21\xF9\x04", $position)) !== false) {
			if ($position + 7 < strlen($content)) {
				$delays[] = ord($content[$position + 4]) + (ord($content[$position + 5]) * 256);
			}
			$position += 3;
		}
		if (!$delays) {
			return ['frame_count' => 1, 'frame_rate' => 0, 'is_variable_framerate' => 0];
		}
		$counts = array_count_values($delays);
		arsort($counts);

		return [
			'frame_count' => count($delays),
			'frame_rate' => (int)key($counts),
			'is_variable_framerate' => count($counts) > 1 ? 1 : 0,
		];
	}

	private function extractColorData()
	{
		$buckets = [];
		$opaquePixels = 0;
		$brightnessSum = 0;
		$hasTransparency = false;
		$frames = $this->loadSampleFrames();

		foreach ($frames as $image) {
			$width = imagesx($image);
			$height = imagesy($image);
			for ($y = 0; $y < $height; $y++) {
				for ($x = 0; $x < $width; $x++) {
					$rgba = imagecolorsforindex($image, imagecolorat($image, $x, $y));
					if ($rgba['alpha'] >= 127) {
						$hasTransparency = true;
						continue;
					}
					$r = $rgba['red'];
					$g = $rgba['green'];
					$b = $rgba['blue'];
					$key = ($r >> 4) . ':' . ($g >> 4) . ':' . ($b >> 4);
					if (!isset($buckets[$key])) {
						$buckets[$key] = ['count' => 0, 'r' => 0, 'g' => 0, 'b' => 0];
					}
					$buckets[$key]['count']++;
					$buckets[$key]['r'] += $r;
					$buckets[$key]['g'] += $g;
					$buckets[$key]['b'] += $b;
					$opaquePixels++;
					$brightnessSum += ($r + $g + $b) / 3;
				}
			}
			imagedestroy($image);
		}

		if (!$opaquePixels) {
			return [
				'color_codes' => '',
				'color_weights' => '',
				'color_value' => 0,
				'hue' => 1.1,
				'generated_name' => 'Transparent',
				'sparkle_coverage' => 0,
				'suggested_tags' => [],
				'has_transparency' => 1,
			];
		}

		uasort($buckets, function ($a, $b) {
			return $b['count'] <=> $a['count'];
		});
		$clusters = [];
		foreach ($buckets as $bucket) {
			$centroid = [
				$bucket['r'] / $bucket['count'],
				$bucket['g'] / $bucket['count'],
				$bucket['b'] / $bucket['count'],
			];
			$lab = rgbToLab($centroid[0], $centroid[1], $centroid[2]);
			// Nearest cluster, not merely the first within range: greedy
			// first-match let a bucket land in a worse-fitting cluster that
			// happened to be created earlier.
			$match = null;
			$bestDistance = INF;
			foreach ($clusters as $index => $cluster) {
				$distance = deltaE2000($lab, $cluster['lab']);
				if ($distance < $this->config['cluster_merge_distance'] && $distance < $bestDistance) {
					$bestDistance = $distance;
					$match = $index;
				}
			}
			if ($match === null) {
				$clusters[] = [
					'count' => $bucket['count'],
					'r' => $bucket['r'],
					'g' => $bucket['g'],
					'b' => $bucket['b'],
					'lab' => $lab,
				];
				continue;
			}
			$clusters[$match]['count'] += $bucket['count'];
			$clusters[$match]['r'] += $bucket['r'];
			$clusters[$match]['g'] += $bucket['g'];
			$clusters[$match]['b'] += $bucket['b'];
			$count = $clusters[$match]['count'];
			$clusters[$match]['lab'] = rgbToLab(
				$clusters[$match]['r'] / $count,
				$clusters[$match]['g'] / $count,
				$clusters[$match]['b'] / $count
			);
		}

		$clusters = $this->consolidateClusters($clusters);

		foreach ($clusters as &$cluster) {
			$count = $cluster['count'];
			$cluster['rgb'] = [$cluster['r'] / $count, $cluster['g'] / $count, $cluster['b'] / $count];
			$cluster['coverage'] = $count / $opaquePixels;
			$cluster['lab'] = rgbToLab($cluster['rgb'][0], $cluster['rgb'][1], $cluster['rgb'][2]);
			$cluster['sparkle'] = $cluster['lab'][0] > $this->config['sparkle_lightness']
				&& sqrt(pow($cluster['lab'][1], 2) + pow($cluster['lab'][2], 2)) < $this->config['sparkle_chroma'];
		}
		unset($cluster);
		usort($clusters, function ($a, $b) {
			return $b['coverage'] <=> $a['coverage'];
		});

		// Classify before thresholding: a rainbow spreads its coverage across
		// many small clusters, so the type must be read from the full set.
		$classification = (new ColorClassifier($this->config))->classify($clusters);

		// Spread palettes keep a lower floor, otherwise a genuine rainbow
		// exports as the two or three families that happened to clear 5%.
		$isSpread = in_array($classification['palette_type'], ['rainbow', 'multicolor', 'complex-palette', 'gradient'], true);
		$threshold = ($isSpread ? $this->config['palette_spread_threshold'] : $this->config['color_threshold']) / 100;
		$kept = array_values(array_filter($clusters, function ($cluster) use ($threshold) {
			return $cluster['coverage'] >= $threshold;
		}));
		if (!$kept) {
			$kept = array_slice($clusters, 0, 3);
		}
		$kept = array_slice($kept, 0, $this->config['max_colors']);
		$codes = [];
		$weights = [];
		$sparkleCoverage = array_reduce($clusters, function ($total, $cluster) {
			return $total + ($cluster['sparkle'] ? $cluster['coverage'] : 0);
		}, 0);
		foreach ($kept as $cluster) {
			$codes[] = rgbToHex($cluster['rgb'][0], $cluster['rgb'][1], $cluster['rgb'][2]);
			$weights[] = number_format(max(0.01, round($cluster['coverage'], 2)), 2, '.', '');
		}

		$dominant = null;
		foreach ($clusters as $cluster) {
			if (!$cluster['sparkle']) {
				$dominant = $cluster;
				break;
			}
		}
		$dominant = $dominant ?: $clusters[0];
		list($hue, $saturation, $value) = rgbToHSV($dominant['rgb'][0], $dominant['rgb'][1], $dominant['rgb'][2]);
		$colorValue = round(array_sum($dominant['rgb']) / (3 * 255), 2);

		return [
			'color_codes' => implode(',', $codes),
			'color_weights' => implode(',', $weights),
			'color_value' => $colorValue,
			'hue' => $saturation < 10 ? 1.1 : round(fmod($hue + 15, 360) / 360, 3),
			'generated_name' => $classification['name'],
			'palette_type' => $classification['palette_type'],
			'color_confidence' => round($classification['confidence'], 2),
			'color_entropy' => $classification['entropy'],
			'hue_family_count' => $classification['family_count'],
			'sparkle_coverage' => round($sparkleCoverage, 3),
			'suggested_tags' => $this->suggestPatternTag($clusters),
			'has_transparency' => $hasTransparency ? 1 : 0,
		];
	}

	// A cluster's centroid moves as it absorbs buckets, so two clusters that
	// were far apart when seeded can end up perceptually adjacent. Repeatedly
	// fuse the closest pair still inside the merge threshold until stable —
	// without this, one color family still exports as several near-identical
	// entries and its true coverage stays split across them.
	private function consolidateClusters($clusters)
	{
		$threshold = $this->config['cluster_merge_distance'];
		$changed = true;
		while ($changed && count($clusters) > 1) {
			$changed = false;
			$closest = null;
			$bestDistance = $threshold;
			$keys = array_keys($clusters);
			foreach ($keys as $i => $keyA) {
				for ($j = $i + 1; $j < count($keys); $j++) {
					$distance = deltaE2000($clusters[$keyA]['lab'], $clusters[$keys[$j]]['lab']);
					if ($distance < $bestDistance) {
						$bestDistance = $distance;
						$closest = [$keyA, $keys[$j]];
					}
				}
			}
			if (!$closest) {
				break;
			}
			list($into, $from) = $closest;
			// Keep the larger cluster as the survivor so the anchor colour
			// stays the one with the most pixels behind it.
			if ($clusters[$from]['count'] > $clusters[$into]['count']) {
				list($into, $from) = [$from, $into];
			}
			foreach (['count', 'r', 'g', 'b'] as $field) {
				$clusters[$into][$field] += $clusters[$from][$field];
			}
			$count = $clusters[$into]['count'];
			$clusters[$into]['lab'] = rgbToLab(
				$clusters[$into]['r'] / $count,
				$clusters[$into]['g'] / $count,
				$clusters[$into]['b'] / $count
			);
			unset($clusters[$from]);
			$changed = true;
		}

		return array_values($clusters);
	}

	private function loadSampleFrames()
	{
		if (extension_loaded('imagick')) {
			try {
				$sequence = new Imagick($this->imagePath);
				$sequence = $sequence->coalesceImages();
				$count = $sequence->getNumberImages();
				$sampleCount = min($count, $this->config['sample_frame_count']);
				$indices = [];
				for ($i = 0; $i < $sampleCount; $i++) {
					$indices[] = $sampleCount === 1 ? 0 : (int)round($i * ($count - 1) / ($sampleCount - 1));
				}
				$frames = [];
				foreach (array_unique($indices) as $index) {
					$sequence->setIteratorIndex($index);
					$sequence->setImageFormat('png');
					$frame = imagecreatefromstring($sequence->getImageBlob());
					if ($frame) {
						$frames[] = $frame;
					}
				}
				$sequence->clear();
				if ($frames) {
					return $frames;
				}
			} catch (Throwable $error) {
				// GD remains the deterministic fallback when Imagick cannot decode a file.
			}
		}

		$info = @getimagesize($this->imagePath);
		if (!$info) {
			throw new Exception('Could not read image file');
		}
		$loaders = [
			IMAGETYPE_GIF => 'imagecreatefromgif',
			IMAGETYPE_PNG => 'imagecreatefrompng',
			IMAGETYPE_JPEG => 'imagecreatefromjpeg',
		];
		if (!isset($loaders[$info[2]])) {
			throw new Exception('Unsupported image type. Only GIF, PNG, and JPG are supported.');
		}
		$image = @$loaders[$info[2]]($this->imagePath);
		if (!$image) {
			throw new Exception('Could not create image from file');
		}

		return [$image];
	}

	private function suggestPatternTag($clusters)
	{
		$hues = [];
		foreach ($clusters as $cluster) {
			if ($cluster['sparkle'] || $cluster['coverage'] < $this->config['pattern_min_coverage']) {
				continue;
			}
			list($hue, $saturation) = rgbToHSV($cluster['rgb'][0], $cluster['rgb'][1], $cluster['rgb'][2]);
			if ($saturation >= 20) {
				$hues[] = $hue;
			}
		}
		if (count($hues) < $this->config['pattern_min_clusters']) {
			return [];
		}
		$spread = 0;
		foreach ($hues as $a) {
			foreach ($hues as $b) {
				$spread = max($spread, min(abs($a - $b), 360 - abs($a - $b)));
			}
		}

		return $spread > $this->config['pattern_hue_spread']
			? [['tag_id' => null, 'name' => 'pattern', 'reason' => count($hues) . ' hues >= 10%']]
			: [];
	}

}

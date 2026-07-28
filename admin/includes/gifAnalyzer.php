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
			// The bucket key of every pixel, kept for one pass so each bucket can
			// also record how scattered its pixels are. Transparent pixels hold
			// -1, which matches no bucket and so never counts as a neighbour.
			$grid = [];
			for ($y = 0; $y < $height; $y++) {
				$row = [];
				for ($x = 0; $x < $width; $x++) {
					$rgba = imagecolorsforindex($image, imagecolorat($image, $x, $y));
					if ($rgba['alpha'] >= 127) {
						$hasTransparency = true;
						$row[$x] = -1;
						continue;
					}
					$r = $rgba['red'];
					$g = $rgba['green'];
					$b = $rgba['blue'];
					$key = (($r >> 4) << 8) | (($g >> 4) << 4) | ($b >> 4);
					$row[$x] = $key;
					if (!isset($buckets[$key])) {
						$buckets[$key] = ['count' => 0, 'r' => 0, 'g' => 0, 'b' => 0, 'isolated' => 0];
					}
					$buckets[$key]['count']++;
					$buckets[$key]['r'] += $r;
					$buckets[$key]['g'] += $g;
					$buckets[$key]['b'] += $b;
					$opaquePixels++;
					$brightnessSum += ($r + $g + $b) / 3;
				}
				$grid[$y] = $row;
			}
			// A pixel with at most one like neighbour is speckle, not part of a
			// region. Dithered mixtures score near 1, flat fills near 0, and the
			// ratio survives clustering because it is summed alongside the count.
			for ($y = 0; $y < $height; $y++) {
				for ($x = 0; $x < $width; $x++) {
					$key = $grid[$y][$x];
					if ($key < 0) {
						continue;
					}
					$like = 0;
					foreach ([[0, -1], [0, 1], [-1, 0], [1, 0]] as $step) {
						if (($grid[$y + $step[1]][$x + $step[0]] ?? -1) === $key) {
							$like++;
						}
					}
					if ($like <= 1) {
						$buckets[$key]['isolated']++;
					}
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
				if ($distance < $this->mergeThreshold($lab, $cluster['lab']) && $distance < $bestDistance) {
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
					'isolated' => $bucket['isolated'],
					'lab' => $lab,
				];
				continue;
			}
			$clusters[$match]['count'] += $bucket['count'];
			$clusters[$match]['r'] += $bucket['r'];
			$clusters[$match]['g'] += $bucket['g'];
			$clusters[$match]['b'] += $bucket['b'];
			$clusters[$match]['isolated'] += $bucket['isolated'];
			$count = $clusters[$match]['count'];
			$clusters[$match]['lab'] = rgbToLab(
				$clusters[$match]['r'] / $count,
				$clusters[$match]['g'] / $count,
				$clusters[$match]['b'] / $count
			);
		}

		$clusters = $this->consolidateClusters($clusters);
		$clusters = $this->foldDitherBlends($clusters, $opaquePixels);
		$clusters = $this->foldGlitterOverlay($clusters, $opaquePixels);

		foreach ($clusters as &$cluster) {
			$count = $cluster['count'];
			$cluster['rgb'] = [$cluster['r'] / $count, $cluster['g'] / $count, $cluster['b'] / $count];
			$cluster['coverage'] = $count / $opaquePixels;
			$cluster['lab'] = rgbToLab($cluster['rgb'][0], $cluster['rgb'][1], $cluster['rgb'][2]);
			$cluster['chroma'] = $this->chroma($cluster['lab']);
			$cluster['scatter'] = $this->scatter($cluster);
		}
		unset($cluster);
		// A glint is bright and colorless; an overlay step is any scattered
		// neutral once the artwork underneath carries real color. Both are the
		// animation rather than the subject, so neither may name the asset.
		$overlaid = $this->chromaticCoverage($clusters, $opaquePixels) >= $this->config['glitter_overlay_min_chromatic_coverage'];
		foreach ($clusters as &$cluster) {
			$cluster['sparkle'] = ($cluster['lab'][0] > $this->config['sparkle_lightness']
					&& $cluster['chroma'] < $this->config['sparkle_chroma'])
				|| ($overlaid
					&& $cluster['chroma'] < $this->config['neutral_chroma_max']
					&& $cluster['scatter'] >= $this->config['glitter_overlay_min_scatter']);
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
			// Coherent fills are materials even when small; scatter, not size,
			// separates them from dither speckle and antialiased blends.
			return $cluster['coverage'] >= $threshold
				|| ($cluster['coverage'] >= $this->config['solid_cluster_min_coverage']
					&& $cluster['scatter'] <= $this->config['solid_cluster_max_scatter']);
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

	private function chroma($lab)
	{
		return sqrt(pow($lab[1], 2) + pow($lab[2], 2));
	}

	// Share of the cluster's pixels that had at most one like neighbour.
	private function scatter($cluster)
	{
		return $cluster['count'] > 0 ? $cluster['isolated'] / $cluster['count'] : 0;
	}

	private function chromaticCoverage($clusters, $opaquePixels)
	{
		if ($opaquePixels <= 0) {
			return 0;
		}
		$coverage = 0;
		foreach ($clusters as $cluster) {
			if ($this->chroma($cluster['lab']) >= $this->config['neutral_chroma_max']) {
				$coverage += $cluster['count'] / $opaquePixels;
			}
		}

		return $coverage;
	}

	// dE2000 compresses chroma differences but leaves lightness alone, so a
	// fixed distance between two grays reads as one material where the same
	// distance between two hues reads as two colors. Neutral pairs therefore
	// merge on a longer leash than colored ones.
	private function mergeThreshold($labA, $labB)
	{
		return max($this->chroma($labA), $this->chroma($labB)) < $this->config['neutral_chroma_max']
			? $this->config['cluster_merge_distance_neutral']
			: $this->config['cluster_merge_distance'];
	}

	// A cluster's centroid moves as it absorbs buckets, so two clusters that
	// were far apart when seeded can end up perceptually adjacent. Repeatedly
	// fuse the closest pair still inside the merge threshold until stable —
	// without this, one color family still exports as several near-identical
	// entries and its true coverage stays split across them.
	private function consolidateClusters($clusters)
	{
		$changed = true;
		while ($changed && count($clusters) > 1) {
			$changed = false;
			$closest = null;
			$bestDistance = INF;
			$keys = array_keys($clusters);
			foreach ($keys as $i => $keyA) {
				for ($j = $i + 1; $j < count($keys); $j++) {
					$labA = $clusters[$keyA]['lab'];
					$labB = $clusters[$keys[$j]]['lab'];
					$distance = deltaE2000($labA, $labB);
					// Each pair is judged against its own threshold, so a
					// neutral pair is not held to the colored one's leash.
					if ($distance < $this->mergeThreshold($labA, $labB) && $distance < $bestDistance) {
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
			foreach (['count', 'r', 'g', 'b', 'isolated'] as $field) {
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

	// Dithered fills, antialiased edges and gradient ramps all mix two colors,
	// and the mixture reads as its own cluster: a two-color sticker exports as
	// eight shades and classifies as a rainbow. A blend sits on the Lab
	// segment between the two colors it mixes and never out-saturates both of
	// them, which is what separates it from a genuine third color. Anchors are
	// read once, before any folding, so the result never depends on the order
	// clusters happen to be in — exports have to stay byte-stable.
	private function foldDitherBlends($clusters, $opaquePixels)
	{
		$tolerance = $this->config['dither_blend_distance'];
		if ($tolerance <= 0 || $opaquePixels <= 0 || count($clusters) < 3) {
			return $clusters;
		}
		$anchors = [];
		foreach ($clusters as $index => $cluster) {
			if ($cluster['count'] / $opaquePixels >= $this->config['dither_anchor_min_coverage']) {
				$anchors[$index] = $cluster['lab'];
			}
		}
		if (count($anchors) < 2) {
			return $clusters;
		}
		$folded = false;
		foreach ($clusters as $index => $cluster) {
			if (isset($anchors[$index])) {
				continue;
			}
			// Size alone used to decide what could be a blend, which let a large
			// but fully scattered mixture survive as its own color. A cluster
			// that exists only as speckle is a blend at any coverage.
			if ($cluster['count'] / $opaquePixels > $this->config['dither_blend_max_coverage']
				&& $this->scatter($cluster) < $this->config['dither_blend_min_scatter']) {
				continue;
			}
			$target = $this->blendAnchor($cluster['lab'], $anchors, $tolerance);
			if ($target === null) {
				continue;
			}
			foreach (['count', 'r', 'g', 'b', 'isolated'] as $field) {
				$clusters[$target][$field] += $cluster[$field];
			}
			unset($clusters[$index]);
			$folded = true;
		}
		if (!$folded) {
			return $clusters;
		}
		foreach ($anchors as $index => $lab) {
			if (!isset($clusters[$index])) {
				continue;
			}
			$count = $clusters[$index]['count'];
			$clusters[$index]['lab'] = rgbToLab(
				$clusters[$index]['r'] / $count,
				$clusters[$index]['g'] / $count,
				$clusters[$index]['b'] / $count
			);
		}

		return array_values($clusters);
	}

	// An animated glitter overlay scatters a gray ramp across the artwork, and
	// every step of that ramp lands as its own cluster: measured on a flowered
	// branch, four gray entries held 43% of the palette while the flowers, the
	// branch and the bird shared the rest. The steps collapse into one entry.
	// The chromatic gate is what keeps chrome and silver intact — with no real
	// color underneath, the ramp is the subject rather than an overlay, and a
	// material's shading is exactly what its palette should show.
	private function foldGlitterOverlay($clusters, $opaquePixels)
	{
		if ($opaquePixels <= 0 || count($clusters) < 2) {
			return $clusters;
		}
		if ($this->chromaticCoverage($clusters, $opaquePixels) < $this->config['glitter_overlay_min_chromatic_coverage']) {
			return $clusters;
		}
		$overlay = [];
		foreach ($clusters as $index => $cluster) {
			if ($this->chroma($cluster['lab']) < $this->config['neutral_chroma_max']
				&& $this->scatter($cluster) >= $this->config['glitter_overlay_min_scatter']) {
				$overlay[] = $index;
			}
		}
		if (count($overlay) < 2) {
			return $clusters;
		}
		// The largest step survives, so the entry keeps the most pixels behind
		// it and the fold cannot depend on cluster ordering.
		$into = $overlay[0];
		foreach ($overlay as $index) {
			if ($clusters[$index]['count'] > $clusters[$into]['count']) {
				$into = $index;
			}
		}
		foreach ($overlay as $index) {
			if ($index === $into) {
				continue;
			}
			foreach (['count', 'r', 'g', 'b', 'isolated'] as $field) {
				$clusters[$into][$field] += $clusters[$index][$field];
			}
			unset($clusters[$index]);
		}
		$count = $clusters[$into]['count'];
		$clusters[$into]['lab'] = rgbToLab(
			$clusters[$into]['r'] / $count,
			$clusters[$into]['g'] / $count,
			$clusters[$into]['b'] / $count
		);

		return array_values($clusters);
	}

	// Nearest anchor of the closest-fitting anchor pair, or null when the
	// color is not a mixture of any pair.
	private function blendAnchor($lab, $anchors, $tolerance)
	{
		$chroma = sqrt(pow($lab[1], 2) + pow($lab[2], 2));
		$target = null;
		$bestDistance = $tolerance;
		$indices = array_keys($anchors);
		foreach ($indices as $position => $first) {
			for ($next = $position + 1; $next < count($indices); $next++) {
				$second = $indices[$next];
				$firstChroma = sqrt(pow($anchors[$first][1], 2) + pow($anchors[$first][2], 2));
				$secondChroma = sqrt(pow($anchors[$second][1], 2) + pow($anchors[$second][2], 2));
				if ($chroma > max($firstChroma, $secondChroma)) {
					continue;
				}
				// Endpoints and their immediate neighbourhood belong to
				// cluster_merge_distance; only the span between counts.
				for ($step = 2; $step <= 8; $step++) {
					$ratio = $step / 10;
					$point = [
						$anchors[$first][0] + (($anchors[$second][0] - $anchors[$first][0]) * $ratio),
						$anchors[$first][1] + (($anchors[$second][1] - $anchors[$first][1]) * $ratio),
						$anchors[$first][2] + (($anchors[$second][2] - $anchors[$first][2]) * $ratio),
					];
					$distance = deltaE2000($lab, $point);
					if ($distance >= $bestDistance) {
						continue;
					}
					$bestDistance = $distance;
					$target = deltaE2000($lab, $anchors[$first]) <= deltaE2000($lab, $anchors[$second])
						? $first
						: $second;
				}
			}
		}

		return $target;
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

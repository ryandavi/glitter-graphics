<?php

class ManifestLibraryService
{
	private $root;
	private $library;
	private $manifestPath;

	public function __construct($library)
	{
		$definitions = [
			'fonts' => 'data/fonts.json',
			'shapes' => 'data/shapes.json',
		];
		if (!isset($definitions[$library])) {
			throw new InvalidArgumentException('Invalid manifest library');
		}

		$this->root = dirname(__DIR__, 2);
		$this->library = $library;
		$this->manifestPath = $this->root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $definitions[$library]);
	}

	public function get()
	{
		if (!is_file($this->manifestPath)) {
			throw new RuntimeException('Manifest file is missing');
		}
		$manifest = json_decode(file_get_contents($this->manifestPath), true, 512, JSON_THROW_ON_ERROR);
		$this->validate($manifest);
		return [
			'library' => $this->library,
			'manifest' => $manifest,
			'health' => $this->healthFor($manifest),
		];
	}

	public function save($manifest)
	{
		$this->validate($manifest);
		$encoded = json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
		$encoded = preg_replace_callback('/^( +)/m', function ($match) {
			return str_repeat("\t", intdiv(strlen($match[1]), 4));
		}, $encoded) . "\n";
		if (file_put_contents($this->manifestPath, $encoded, LOCK_EX) === false) {
			throw new RuntimeException('Could not write manifest');
		}
		return $this->get() + ['success' => true];
	}

	private function validate($manifest)
	{
		if ($this->library === 'fonts') {
			$this->validateFonts($manifest);
			return;
		}
		$this->validateShapes($manifest);
	}

	private function validateFonts($manifest)
	{
		if (!is_array($manifest) || !array_is_list($manifest['tagGroups'] ?? null) || !array_is_list($manifest['fonts'] ?? null)) {
			throw new InvalidArgumentException('Fonts manifest must contain tagGroups and fonts arrays');
		}
		$tagIds = [];
		$groupIds = [];
		foreach ($manifest['tagGroups'] as $groupIndex => $group) {
			$groupId = $this->requireId($group['id'] ?? null, 'Font tag group ' . ($groupIndex + 1));
			if (isset($groupIds[$groupId])) throw new InvalidArgumentException("Duplicate font tag group \"$groupId\"");
			if (trim((string)($group['label'] ?? '')) === '') throw new InvalidArgumentException("Font tag group \"$groupId\" needs a label");
			if (!array_is_list($group['tags'] ?? null)) throw new InvalidArgumentException("Font tag group \"$groupId\" needs a tags array");
			$groupIds[$groupId] = true;
			foreach ($group['tags'] as $tagIndex => $tag) {
				$tagId = $this->requireId($tag['id'] ?? null, "Tag " . ($tagIndex + 1) . " in \"$groupId\"");
				if (isset($tagIds[$tagId])) throw new InvalidArgumentException("Duplicate font tag \"$tagId\"");
				if (trim((string)($tag['label'] ?? '')) === '') throw new InvalidArgumentException("Font tag \"$tagId\" needs a label");
				$tagIds[$tagId] = true;
			}
		}

		$fonts = $manifest['fonts'];
		$ids = [];
		$names = [];
		foreach ($fonts as $index => $font) {
			$label = 'Font ' . ($index + 1);
			$id = $this->requireId($font['id'] ?? null, $label);
			$name = trim((string)($font['name'] ?? ''));
			if ($name === '') throw new InvalidArgumentException("$label name is required");
			if (isset($ids[$id])) throw new InvalidArgumentException("Duplicate font id \"$id\"");
			if (isset($names[strtolower($name)])) throw new InvalidArgumentException("Duplicate font name \"$name\"");
			$ids[$id] = true;
			$names[strtolower($name)] = true;

			$weight = (int)($font['weight'] ?? 0);
			if ($weight < 100 || $weight > 900 || $weight % 100 !== 0) {
				throw new InvalidArgumentException("Font \"$id\" weight must be 100 through 900");
			}
			if (empty($font['scripts']) || !is_array($font['scripts'])) {
				throw new InvalidArgumentException("Font \"$id\" needs at least one script");
			}
			foreach ($font['scripts'] as $script) {
				if (!preg_match('/^[a-z]{2,12}$/', (string)$script)) {
					throw new InvalidArgumentException("Font \"$id\" has an invalid script");
				}
			}
			if (!array_is_list($font['tags'] ?? null)) {
				throw new InvalidArgumentException("Font \"$id\" needs a tags array");
			}
			foreach ($font['tags'] as $tagId) {
				if (!isset($tagIds[$tagId])) {
					throw new InvalidArgumentException("Font \"$id\" has unknown tag \"$tagId\"");
				}
			}

			if (!empty($font['system'])) {
				if (trim((string)($font['family'] ?? '')) === '') {
					throw new InvalidArgumentException("System font \"$id\" needs a family stack");
				}
				continue;
			}
			$file = $this->normalizeRelativePath($font['file'] ?? '');
			if (!preg_match('#^fonts/[^/].*\.(woff2?|ttf|otf)$#i', $file)) {
				throw new InvalidArgumentException("Font \"$id\" has an invalid file path");
			}
		}
		foreach ($fonts as $font) {
			$fallbackId = trim((string)($font['fallbackFontId'] ?? ''));
			if ($fallbackId !== '' && !isset($ids[$fallbackId])) {
				throw new InvalidArgumentException("Font \"{$font['id']}\" has an unknown fallback font id");
			}
		}
	}

	private function validateShapes($manifest)
	{
		if (!is_array($manifest) || !array_is_list($manifest['categories'] ?? null) || !array_is_list($manifest['shapes'] ?? null)) {
			throw new InvalidArgumentException('Shapes manifest must contain categories and shapes arrays');
		}
		$categoryIds = [];
		foreach ($manifest['categories'] as $index => $category) {
			$id = $this->requireId($category['id'] ?? null, 'Shape category ' . ($index + 1));
			if (isset($categoryIds[$id])) throw new InvalidArgumentException("Duplicate shape category \"$id\"");
			if (trim((string)($category['label'] ?? '')) === '') throw new InvalidArgumentException("Shape category \"$id\" needs a label");
			$categoryIds[$id] = true;
		}

		$ids = [];
		$shapeOrders = [];
		$brushOrders = [];
		$allowedUses = ['shape', 'brush'];
		$allowedPrimitives = ['circle', 'square', 'calligraphy'];
		foreach ($manifest['shapes'] as $index => $shape) {
			$id = $this->requireShapeId($shape['id'] ?? null, 'Shape ' . ($index + 1));
			if (isset($ids[$id])) throw new InvalidArgumentException("Duplicate shape id \"$id\"");
			$ids[$id] = true;
			if (trim((string)($shape['label'] ?? '')) === '') throw new InvalidArgumentException("Shape \"$id\" needs a label");
			if (!is_numeric($shape['viewBox'] ?? null) || (float)$shape['viewBox'] <= 0) {
				throw new InvalidArgumentException("Shape \"$id\" needs a positive viewBox");
			}
			$uses = array_values(array_unique($shape['uses'] ?? []));
			if (!$uses || array_diff($uses, $allowedUses)) {
				throw new InvalidArgumentException("Shape \"$id\" has invalid usage");
			}
			$primitive = $shape['primitive'] ?? null;
			$svgPath = trim((string)($shape['svgPath'] ?? ''));
			if (($primitive && !in_array($primitive, $allowedPrimitives, true)) || (!$primitive && $svgPath === '')) {
				throw new InvalidArgumentException("Shape \"$id\" needs a supported primitive or SVG path");
			}

			if (in_array('shape', $uses, true)) {
				if (!isset($categoryIds[$shape['category'] ?? ''])) {
					throw new InvalidArgumentException("Shape \"$id\" needs a valid category");
				}
				$this->validateOrder($shape['shapeOrder'] ?? null, $shapeOrders, $id, 'shape');
			}
			if (in_array('brush', $uses, true)) {
				$this->validateOrder($shape['brushOrder'] ?? null, $brushOrders, $id, 'brush');
			}
		}
		if (!isset($ids['circle'])) throw new InvalidArgumentException('Shapes manifest must include circle');
	}

	private function validateOrder($value, &$orders, $id, $usage)
	{
		if (!is_int($value) || $value < 0) {
			throw new InvalidArgumentException("Shape \"$id\" needs a non-negative $usage order");
		}
		if (isset($orders[$value])) {
			throw new InvalidArgumentException("Shapes \"$id\" and \"{$orders[$value]}\" share $usage order $value");
		}
		$orders[$value] = $id;
	}

	private function requireId($value, $label)
	{
		$id = trim((string)$value);
		if (!preg_match('/^[a-z][a-z0-9-]*$/', $id)) {
			throw new InvalidArgumentException("$label needs a lowercase kebab-case id");
		}
		return $id;
	}

	private function requireShapeId($value, $label)
	{
		$id = trim((string)$value);
		if (!preg_match('/^[a-z][A-Za-z0-9-]*$/', $id)) {
			throw new InvalidArgumentException("$label needs a stable camelCase or kebab-case id");
		}
		return $id;
	}

	private function normalizeRelativePath($path)
	{
		$path = str_replace('\\', '/', trim((string)$path));
		if ($path === '' || str_contains($path, '..') || str_starts_with($path, '/')) {
			throw new InvalidArgumentException('Manifest contains an unsafe file path');
		}
		return $path;
	}

	private function healthFor($manifest)
	{
		if ($this->library === 'shapes') {
			return [
				'issues' => [],
				'registered' => count($manifest['shapes']),
				'categories' => count($manifest['categories']),
			];
		}

		$registered = [];
		foreach ($manifest['fonts'] as $font) {
			if (!empty($font['system'])) continue;
			$registered[$this->normalizeRelativePath($font['file'])] = $font;
		}
		$files = [];
		$fontRoot = $this->root . DIRECTORY_SEPARATOR . 'fonts';
		$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($fontRoot, FilesystemIterator::SKIP_DOTS));
		foreach ($iterator as $file) {
			if (!$file->isFile() || !preg_match('/\.(woff2?|ttf|otf)$/i', $file->getFilename())) continue;
			$relative = 'fonts/' . str_replace('\\', '/', substr($file->getPathname(), strlen($fontRoot) + 1));
			$files[$relative] = true;
		}

		$issues = [];
		foreach ($registered as $path => $font) {
			if (isset($files[$path])) continue;
			$issues[] = [
				'issue' => 'missing_file',
				'id' => $font['id'],
				'name' => $font['name'],
				'file' => $path,
			];
		}
		foreach (array_keys($files) as $path) {
			if (isset($registered[$path])) continue;
			$issues[] = [
				'issue' => 'unregistered_file',
				'id' => null,
				'name' => pathinfo($path, PATHINFO_FILENAME),
				'file' => $path,
			];
		}
		return [
			'issues' => $issues,
			'registered' => count($manifest['fonts']),
			'files' => count($files),
			'tags' => array_sum(array_map(function ($group) {
				return count($group['tags']);
			}, $manifest['tagGroups'])),
		];
	}
}

<?php

class TagTaxonomyService
{
	private $db;
	private $tables;
	private $assetType;

	public function __construct($db, $tables, $assetType)
	{
		$this->db = $db;
		$this->tables = $tables;
		$this->assetType = $assetType;
	}

	public static function normalize($value)
	{
		$value = strtolower(trim((string)$value));
		$value = preg_replace('/[\p{P}\p{S}]+/u', ' ', $value);
		return trim(preg_replace('/\s+/', ' ', $value));
	}

	public function tags()
	{
		$tagIdField = $this->assetType . '_tag_id';
		$tagCategoryIdField = $this->assetType . '_tag_category_id';
		$assetIdField = $this->assetType . '_id';
		$sql = "
			SELECT t.*, tc.name AS category_name, COUNT(DISTINCT tm.$assetIdField) AS usage_count,
				GROUP_CONCAT(DISTINCT ta.alias ORDER BY ta.alias SEPARATOR '||') AS aliases
			FROM {$this->tables['tags_table']} t
			JOIN {$this->tables['tag_categories_table']} tc ON tc.id = t.$tagCategoryIdField
			LEFT JOIN {$this->tables['tags_map_table']} tm ON tm.$tagIdField = t.id
			LEFT JOIN {$this->tables['tag_aliases_table']} ta ON ta.$tagIdField = t.id
			GROUP BY t.id
			ORDER BY tc.sort_order, t.name
		";
		$result = $this->db->query($sql);
		$rows = [];
		while ($row = $result->fetch_assoc()) {
			$row['id'] = (int)$row['id'];
			$row['usage_count'] = (int)$row['usage_count'];
			$row['aliases'] = $row['aliases'] ? explode('||', $row['aliases']) : [];
			$rows[] = $row;
		}
		return $rows;
	}

	public function addAlias($tagId, $alias)
	{
		$normalized = self::normalize($alias);
		if ($normalized === '') throw new InvalidArgumentException('Alias is required');
		$this->assertAvailable($normalized, (int)$tagId);
		$tagIdField = $this->assetType . '_tag_id';
		$stmt = $this->db->prepare(
			"INSERT INTO {$this->tables['tag_aliases_table']} ($tagIdField, alias, normalized_alias, created_at) VALUES (?, ?, ?, NOW())",
			'iss',
			[(int)$tagId, trim((string)$alias), $normalized]
		);
		$stmt->close();
		return ['success' => true, 'id' => $this->db->lastInsertId()];
	}

	public function duplicateCandidates()
	{
		$tags = $this->tags();
		$candidates = [];
		foreach ($tags as $index => $tag) {
			foreach (array_slice($tags, $index + 1) as $other) {
				$a = self::normalize($tag['name']);
				$b = self::normalize($other['name']);
				$exact = $a === $b;
				$plural = self::safePluralPair($a, $b);
				if (!$exact && !$plural) continue;
				$candidates[] = [
					'target' => strlen($a) <= strlen($b) ? $tag : $other,
					'source' => strlen($a) <= strlen($b) ? $other : $tag,
					'reason' => $exact ? 'normalized duplicate' : 'possible singular/plural pair',
					'auto_selected' => $exact,
				];
			}
		}
		return $candidates;
	}

	public function merge($targetId, $sourceIds)
	{
		$targetId = (int)$targetId;
		$sourceIds = array_values(array_diff(array_unique(array_map('intval', $sourceIds)), [$targetId]));
		if (!$targetId || !$sourceIds) throw new InvalidArgumentException('Choose a target and at least one source tag');
		$tagIdField = $this->assetType . '_tag_id';
		$assetIdField = $this->assetType . '_id';
		$sourceList = implode(',', $sourceIds);
		$this->db->beginTransaction();
		try {
			$result = $this->db->query("SELECT id, name FROM {$this->tables['tags_table']} WHERE id IN ($sourceList)");
			$sources = [];
			while ($row = $result->fetch_assoc()) $sources[] = $row;
			foreach ($sources as $source) {
				$normalized = self::normalize($source['name']);
				$this->assertAvailable($normalized, $targetId, $sourceIds);
				$stmt = $this->db->prepare(
					"INSERT IGNORE INTO {$this->tables['tag_aliases_table']} ($tagIdField, alias, normalized_alias, created_at) VALUES (?, ?, ?, NOW())",
					'iss',
					[$targetId, $source['name'], $normalized]
				);
				$stmt->close();
			}
			$aliasResult = $this->db->query(
				"SELECT alias, normalized_alias FROM {$this->tables['tag_aliases_table']} WHERE $tagIdField IN ($sourceList)"
			);
			while ($alias = $aliasResult->fetch_assoc()) {
				$stmt = $this->db->prepare(
					"INSERT IGNORE INTO {$this->tables['tag_aliases_table']} ($tagIdField, alias, normalized_alias, created_at) VALUES (?, ?, ?, NOW())",
					'iss',
					[$targetId, $alias['alias'], $alias['normalized_alias']]
				);
				$stmt->close();
			}
			$this->db->query("DELETE FROM {$this->tables['tag_aliases_table']} WHERE $tagIdField IN ($sourceList)");
			$this->db->query(
				"INSERT IGNORE INTO {$this->tables['tags_map_table']} ($assetIdField, $tagIdField)
				 SELECT $assetIdField, $targetId FROM {$this->tables['tags_map_table']} WHERE $tagIdField IN ($sourceList)"
			);
			$this->db->query("DELETE FROM {$this->tables['tags_map_table']} WHERE $tagIdField IN ($sourceList)");
			$this->db->query("DELETE FROM {$this->tables['tags_table']} WHERE id IN ($sourceList)");
			$this->db->commit();
			return ['success' => true, 'target_id' => $targetId, 'merged_ids' => $sourceIds];
		} catch (Throwable $error) {
			$this->db->rollback();
			throw $error;
		}
	}

	private function assertAvailable($normalized, $tagId, $ignoredIds = [])
	{
		$result = $this->db->query("SELECT id, name FROM {$this->tables['tags_table']}");
		while ($row = $result->fetch_assoc()) {
			if ((int)$row['id'] === $tagId || in_array((int)$row['id'], $ignoredIds, true)) continue;
			if (self::normalize($row['name']) === $normalized) {
				throw new InvalidArgumentException('Alias conflicts with canonical tag "' . $row['name'] . '"');
			}
		}
		$tagIdField = $this->assetType . '_tag_id';
		$stmt = $this->db->prepare(
			"SELECT $tagIdField FROM {$this->tables['tag_aliases_table']} WHERE normalized_alias = ? LIMIT 1",
			's',
			[$normalized]
		);
		$row = $stmt->get_result()->fetch_assoc();
		$stmt->close();
		if ($row && (int)$row[$tagIdField] !== $tagId) {
			throw new InvalidArgumentException('Alias is already assigned to another tag');
		}
	}

	private static function safePluralPair($a, $b)
	{
		$short = strlen($a) <= strlen($b) ? $a : $b;
		$long = $short === $a ? $b : $a;
		if (preg_match('/(?:ss|us|is)$/', $short)) return false;
		return $long === $short . 's'
			|| (substr($short, -1) === 'y' && $long === substr($short, 0, -1) . 'ies')
			|| (preg_match('/(?:s|x|z|ch|sh)$/', $short) && $long === $short . 'es');
	}
}

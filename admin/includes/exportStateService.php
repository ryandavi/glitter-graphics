<?php

class ExportStateService
{
	private $db;

	public function __construct($db)
	{
		$this->db = $db;
	}

	public function markDirty($assetType)
	{
		$stmt = $this->db->prepare(
			'INSERT INTO admin_export_state (asset_type, dirty_since) VALUES (?, NOW())
			 ON DUPLICATE KEY UPDATE dirty_since = COALESCE(dirty_since, NOW())',
			's',
			[(string)$assetType]
		);
		$stmt->close();
	}

	public function markCurrent($assetType, $hash)
	{
		$stmt = $this->db->prepare(
			'INSERT INTO admin_export_state (asset_type, dirty_since, last_exported_at, last_export_hash)
			 VALUES (?, NULL, NOW(), ?)
			 ON DUPLICATE KEY UPDATE dirty_since = NULL, last_exported_at = NOW(), last_export_hash = VALUES(last_export_hash)',
			'ss',
			[(string)$assetType, (string)$hash]
		);
		$stmt->close();
	}

	public function status($assetType = null)
	{
		if ($assetType !== null) {
			$stmt = $this->db->prepare(
				'SELECT * FROM admin_export_state WHERE asset_type = ?',
				's',
				[(string)$assetType]
			);
			$result = $stmt->get_result();
			$row = $result->fetch_assoc();
			$stmt->close();
			return $this->format($row);
		}
		$result = $this->db->query('SELECT * FROM admin_export_state ORDER BY asset_type');
		$rows = [];
		while ($row = $result->fetch_assoc()) {
			$rows[$row['asset_type']] = $this->format($row);
		}
		return $rows;
	}

	private function format($row)
	{
		if (!$row) return null;
		return [
			'asset_type' => $row['asset_type'],
			'current' => $row['dirty_since'] === null,
			'dirty_since' => $row['dirty_since'],
			'last_exported_at' => $row['last_exported_at'],
		];
	}
}


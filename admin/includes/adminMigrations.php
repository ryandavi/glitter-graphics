<?php

class AdminMigrations
{
	public static function run($connection, $config)
	{
		self::ensureAssetColumns($connection, $config);
		self::ensureWorkflowTables($connection, $config);
		self::ensureStickerFacets($connection);
	}

	private static function columnExists($connection, $config, $table, $column)
	{
		$stmt = $connection->prepare(
			'SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?'
		);
		$stmt->bind_param('sss', $config['db_name'], $table, $column);
		$stmt->execute();
		$stmt->bind_result($exists);
		$stmt->fetch();
		$stmt->close();
		return (bool)$exists;
	}

	private static function indexExists($connection, $config, $table, $index)
	{
		$stmt = $connection->prepare(
			'SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?'
		);
		$stmt->bind_param('sss', $config['db_name'], $table, $index);
		$stmt->execute();
		$stmt->bind_result($exists);
		$stmt->fetch();
		$stmt->close();
		return (bool)$exists;
	}

	private static function ensureAssetColumns($connection, $config)
	{
		$columns = [
			'glitter' => [
				'color_weights' => 'VARCHAR(255) NULL AFTER color_codes',
				'file_hash' => 'CHAR(32) NULL',
				'analysis_json' => 'LONGTEXT NULL',
				'analysis_version' => 'INT NULL',
				'analyzed_at' => 'DATETIME NULL',
				'palette_override_json' => 'TEXT NULL',
				'palette_type_override' => 'VARCHAR(32) NULL',
				'thumbnail_url' => 'VARCHAR(255) NULL',
				'approved_at' => 'DATETIME NULL',
				'approved_by' => 'VARCHAR(100) NULL',
				'original_filename' => 'VARCHAR(255) NULL',
				'original_ingest_id' => 'BIGINT UNSIGNED NULL',
				'updated_at' => 'DATETIME NULL',
			],
			'stickers' => [
				// Defaults to 1 so the whole existing library keeps the crisp
				// upscaling it has always rendered with; smooth art is opt-in.
				'is_pixelated' => 'TINYINT(1) NOT NULL DEFAULT 1',
				'thumbnail_url' => 'VARCHAR(255) NULL',
				'file_hash' => 'CHAR(32) NULL',
				'analysis_json' => 'LONGTEXT NULL',
				'analysis_version' => 'INT NULL',
				'analyzed_at' => 'DATETIME NULL',
				'palette_override_json' => 'TEXT NULL',
				'palette_type_override' => 'VARCHAR(32) NULL',
				'approved_at' => 'DATETIME NULL',
				'approved_by' => 'VARCHAR(100) NULL',
				'original_filename' => 'VARCHAR(255) NULL',
				'original_ingest_id' => 'BIGINT UNSIGNED NULL',
				'updated_at' => 'DATETIME NULL',
			],
		];
		foreach ($columns as $table => $tableColumns) {
			foreach ($tableColumns as $column => $definition) {
				if (!self::columnExists($connection, $config, $table, $column)) {
					// Identifiers and definitions are constants in the migration map above; SQL
					// parameters cannot represent identifiers or column definitions.
					if (!$connection->query("ALTER TABLE `$table` ADD COLUMN `$column` $definition")) {
						throw new Exception('Migration failed: ' . $connection->error);
					}
				}
			}
		}
	}

	private static function ensureWorkflowTables($connection, $config)
	{
		$connection->query("
			CREATE TABLE IF NOT EXISTS asset_ingest (
				id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
				batch_id CHAR(36) NOT NULL,
				asset_type VARCHAR(20) NOT NULL,
				incoming_filename VARCHAR(255) NOT NULL,
				original_filename VARCHAR(255) NOT NULL,
				file_hash CHAR(32) NOT NULL,
				status VARCHAR(20) NOT NULL DEFAULT 'uploaded',
				analysis_json LONGTEXT NULL,
				suggested_name VARCHAR(255) NULL,
				suggested_category_id INT NULL,
				suggested_tags_json TEXT NULL,
				thumbnail_url VARCHAR(255) NULL,
				created_at DATETIME NOT NULL,
				updated_at DATETIME NOT NULL,
				error TEXT NULL,
				INDEX idx_ingest_queue (asset_type, status, created_at),
				INDEX idx_ingest_hash (asset_type, file_hash)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
		");
		$connection->query("
			CREATE TABLE IF NOT EXISTS admin_events (
				id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
				subject_type VARCHAR(40) NOT NULL,
				subject_id VARCHAR(64) NULL,
				event_type VARCHAR(60) NOT NULL,
				summary_json TEXT NULL,
				created_at DATETIME NOT NULL,
				admin_identifier VARCHAR(100) NULL,
				INDEX idx_admin_events_created (created_at),
				INDEX idx_admin_events_subject (subject_type, subject_id)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
		");
		$connection->query("
			CREATE TABLE IF NOT EXISTS admin_export_state (
				asset_type VARCHAR(20) PRIMARY KEY,
				dirty_since DATETIME NULL,
				last_exported_at DATETIME NULL,
				last_export_hash CHAR(64) NULL
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
		");

		foreach ($config['asset_types'] as $type => $tables) {
			$aliasTable = $tables['tag_aliases_table'];
			$tagsTable = $tables['tags_table'];
			$tagIdField = $type . '_tag_id';
			$connection->query("
				CREATE TABLE IF NOT EXISTS `$aliasTable` (
					id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
					`$tagIdField` INT NOT NULL,
					alias VARCHAR(100) NOT NULL,
					normalized_alias VARCHAR(100) NOT NULL,
					created_at DATETIME NOT NULL,
					UNIQUE KEY uq_normalized_alias (normalized_alias),
					INDEX idx_alias_tag (`$tagIdField`)
				) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
			");
			if (!self::indexExists($connection, $config, $tagsTable, 'uq_normalized_tag_slug')) {
				// Existing duplicate slugs remain visible to the merge workflow; the unique index is added after cleanup.
			}
			$connection->query(
				"INSERT IGNORE INTO admin_export_state (asset_type, dirty_since) VALUES ('" .
				$connection->real_escape_string($type) . "', NOW())"
			);
		}
	}

	private static function ensureStickerFacets($connection)
	{
		$connection->query("UPDATE sticker_tag_categories SET name = 'Mood / Theme', slug = 'mood-theme', sort_order = 6 WHERE slug = 'vibe'");
		$connection->query("UPDATE sticker_tag_categories SET name = 'Style / Finish', slug = 'style-finish', sort_order = 4 WHERE slug = 'attribute'");
		$connection->query("UPDATE sticker_tag_categories SET name = 'Internal', slug = 'internal', sort_order = 99 WHERE slug = 'meta'");
		$facets = [
			['Subject', 'subject', 1],
			['Text', 'text', 2],
			['Color', 'color', 3],
			['Style / Finish', 'style-finish', 4],
			['Action', 'action', 5],
			['Mood / Theme', 'mood-theme', 6],
			['Structure', 'structure', 7],
			['Internal', 'internal', 99],
		];
		foreach ($facets as $facet) {
			$name = $facet[0];
			$slug = $facet[1];
			$order = (int)$facet[2];
			$stmt = $connection->prepare(
				'INSERT INTO sticker_tag_categories (name, slug, description, sort_order)
				 SELECT ?, ?, NULL, ?
				 WHERE NOT EXISTS (SELECT 1 FROM sticker_tag_categories WHERE slug = ?)'
			);
			$stmt->bind_param('ssis', $name, $slug, $order, $slug);
			$stmt->execute();
			$stmt->close();
			$stmt = $connection->prepare('UPDATE sticker_tag_categories SET sort_order = ? WHERE slug = ?');
			$stmt->bind_param('is', $order, $slug);
			$stmt->execute();
			$stmt->close();
		}
	}
}

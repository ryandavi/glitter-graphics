<?php

class AdminEventService
{
	private $db;

	public function __construct($db)
	{
		$this->db = $db;
	}

	public function record($subjectType, $subjectId, $eventType, $summary = [])
	{
		if (session_status() === PHP_SESSION_NONE) {
			@session_start();
		}
		$admin = $_SESSION['admin_username'] ?? 'local-admin';
		$stmt = $this->db->prepare(
			'INSERT INTO admin_events (subject_type, subject_id, event_type, summary_json, created_at, admin_identifier) VALUES (?, ?, ?, ?, NOW(), ?)',
			'sssss',
			[
				(string)$subjectType,
				$subjectId === null ? null : (string)$subjectId,
				(string)$eventType,
				json_encode($summary, JSON_UNESCAPED_SLASHES),
				(string)$admin,
			]
		);
		$stmt->close();
	}

	public function recent($limit = 15)
	{
		$limit = max(1, min(50, (int)$limit));
		$result = $this->db->query(
			"SELECT id, subject_type, subject_id, event_type, summary_json, created_at, admin_identifier
			 FROM admin_events ORDER BY created_at DESC, id DESC LIMIT $limit"
		);
		$events = [];
		while ($row = $result->fetch_assoc()) {
			$row['id'] = (int)$row['id'];
			$row['summary'] = json_decode((string)$row['summary_json'], true) ?: [];
			unset($row['summary_json']);
			$events[] = $row;
		}
		return $events;
	}
}


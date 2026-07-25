<?php

error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);

require_once('auth.php');
require_once('manifestLibraryService.php');

requireAuth('api');
header('Content-Type: application/json');

$library = $_GET['library'] ?? '';
$action = $_GET['action'] ?? 'get';

try {
	$service = new ManifestLibraryService($library);
	if ($action === 'get') {
		echo json_encode($service->get());
	} elseif ($action === 'save') {
		requireCsrfToken('api');
		$payload = json_decode(file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR);
		echo json_encode($service->save($payload['manifest'] ?? null));
	} else {
		throw new InvalidArgumentException('Invalid manifest action');
	}
} catch (Throwable $error) {
	http_response_code(400);
	echo json_encode([
		'success' => false,
		'error' => [
			'code' => strtoupper(preg_replace('/[^A-Z0-9]+/i', '_', get_class($error))),
			'message' => $error->getMessage(),
		],
	]);
}

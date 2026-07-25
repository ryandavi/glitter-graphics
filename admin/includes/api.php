<?php
// Enable error reporting for debugging
error_reporting(E_ALL);
ini_set('display_errors', 0); // Don't display errors in output
ini_set('log_errors', 1);

// ============================================
// UNIFIED API HANDLER
// Supports both glitter and stickers
// ============================================

include_once('config.php');
include_once('auth.php');
include_once('database.php');
include_once('assetAPI.php');
include_once('glitterAPI.php');
include_once('stickerAPI.php');

requireAuth('api');

// Determine asset type from request
$assetType = $_GET['type'] ?? 'glitter'; // Default to glitter for backwards compatibility

// Validate asset type
if (!isset($CONFIG['asset_types'][$assetType])) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid asset type']);
    exit;
}

// Create database connection
$db = new Database($CONFIG);

// Create appropriate API instance
if ($assetType === 'glitter') {
    $api = new GlitterAPI($db, $CONFIG);
} else {
    $api = new StickerAPI($db, $CONFIG);
}

// Handle request
$action = $_GET['action'] ?? '';
header('Content-Type: application/json');

$mutatingActions = [
    'update',
    'delete',
    'add',
    'reorder',
    'analyze',
    'analyze_all',
    'save_export',
    'save_categories_export',
    'add_category',
    'delete_category',
    'update_category',
    'reorder_categories',
    'add_tag',
    'delete_tag',
    'upload',
    'ingest_upload',
    'ingest_update',
    'ingest_approve',
    'ingest_reject',
    'register_existing',
    'tag_alias_add',
    'tag_update',
    'tag_merge',
    'reject',
];

if (in_array($action, $mutatingActions, true)) {
    requireCsrfToken('api');
}

try {
    switch ($action) {
        // ===== ASSET OPERATIONS =====
        case 'list':
            echo json_encode($api->listAssets());
            break;

        case 'get':
            $id = (int)$_GET['id'];
            echo json_encode($api->getAsset($id));
            break;

        case 'update':
            $data = json_decode(file_get_contents('php://input'), true);
            echo json_encode($api->updateAsset($data));
            break;

        case 'delete':
            $id = (int)$_POST['id'];
            echo json_encode($api->deleteAsset($id));
            break;

        case 'add':
            $data = json_decode(file_get_contents('php://input'), true);
            echo json_encode($api->addAsset($data));
            break;

        case 'reorder':
            $data = json_decode(file_get_contents('php://input'), true);
            echo json_encode($api->reorderAssets($data));
            break;

        case 'analyze':
            $id = (int)$_GET['id'];
            echo json_encode($api->analyzeAsset($id));
            break;

        case 'analyze_all':
            $data = json_decode(file_get_contents('php://input'), true) ?: [];
            echo json_encode($api->analyzeAllAssets(
                $data['ids'] ?? null,
                !array_key_exists('include_colors', $data) || (bool)$data['include_colors']
            ));
            break;

        case 'upload':
        case 'ingest_upload':
            echo json_encode($api->ingestUpload($_FILES['file'] ?? [], $_POST['batch_id'] ?? null));
            break;

        case 'reject':
            echo json_encode($api->rejectAsset((int)($_POST['id'] ?? 0)));
            break;

        case 'ingest_list':
            echo json_encode($api->ingestList($_GET['status'] ?? null));
            break;

        case 'ingest_update':
            $data = json_decode(file_get_contents('php://input'), true) ?: [];
            echo json_encode($api->ingestUpdate($data));
            break;

        case 'ingest_approve':
            $data = json_decode(file_get_contents('php://input'), true) ?: [];
            echo json_encode($api->ingestApprove($data));
            break;

        case 'ingest_reject':
            $data = json_decode(file_get_contents('php://input'), true) ?: [];
            echo json_encode($api->ingestReject((int)($data['id'] ?? 0), (string)($data['reason'] ?? '')));
            break;

        case 'register_existing':
            $data = json_decode(file_get_contents('php://input'), true) ?: [];
            echo json_encode($api->registerExisting($data));
            break;

        case 'health':
            echo json_encode($api->healthReport());
            break;

        case 'analysis_view':
            echo json_encode($api->storedAnalysis((int)($_GET['id'] ?? 0)));
            break;

        case 'export_status':
            echo json_encode((new ExportStateService($db))->status($assetType));
            break;

        case 'recent_activity':
            echo json_encode((new AdminEventService($db))->recent((int)($_GET['limit'] ?? 15)));
            break;

        // ===== EXPORT OPERATIONS =====
        case 'export':
            echo json_encode($api->exportAssets());
            break;

        case 'save_export':
            echo json_encode($api->saveExport());
            break;

        case 'export_categories':
            echo json_encode($api->exportCategories());
            break;

        case 'save_categories_export':
            echo json_encode($api->saveCategoriesExport());
            break;

        // ===== CATEGORY OPERATIONS =====
        case 'categories':
            echo json_encode($api->getCategories());
            break;

        case 'add_category':
            $data = json_decode(file_get_contents('php://input'), true);
            echo json_encode($api->addCategory($data));
            break;

        case 'delete_category':
            $id = (int)$_POST['id'];
            echo json_encode($api->deleteCategory($id));
            break;

        case 'update_category':
            $data = json_decode(file_get_contents('php://input'), true);
            echo json_encode($api->updateCategory($data));
            break;

        case 'reorder_categories':
            $data = json_decode(file_get_contents('php://input'), true);
            echo json_encode($api->reorderCategories($data['order'] ?? []));
            break;

        // ===== TAG OPERATIONS =====
        case 'tags':
            echo json_encode($api->getTags());
            break;

        case 'tag_categories':
            echo json_encode($api->getTagCategories());
            break;

        case 'add_tag':
            $data = json_decode(file_get_contents('php://input'), true);
            echo json_encode($api->addTag($data));
            break;

        case 'delete_tag':
            $id = (int)$_POST['id'];
            echo json_encode($api->deleteTag($id));
            break;

        case 'tag_alias_add':
            $data = json_decode(file_get_contents('php://input'), true) ?: [];
            echo json_encode($api->addTagAlias($data));
            break;

        case 'tag_update':
            $data = json_decode(file_get_contents('php://input'), true) ?: [];
            echo json_encode($api->updateTag($data));
            break;

        case 'tag_duplicate_candidates':
            echo json_encode($api->tagDuplicateCandidates());
            break;

        case 'tag_merge':
            $data = json_decode(file_get_contents('php://input'), true) ?: [];
            echo json_encode($api->mergeTags($data));
            break;

        default:
            throw new Exception('Invalid action');
    }
} catch (Exception $e) {
    http_response_code(400);
    $message = $e->getMessage();
    $field = null;
    $code = strtoupper(preg_replace('/[^A-Z0-9]+/i', '_', get_class($e)));
    if (stripos($message, 'slug') !== false) {
        $field = 'slug';
        $code = stripos($message, 'already exists') !== false ? 'CATEGORY_SLUG_EXISTS' : 'CATEGORY_SLUG_INVALID';
    } elseif (stripos($message, 'category') !== false) {
        $field = 'category_id';
    } elseif (stripos($message, 'name is required') !== false) {
        $field = 'name';
    }
    echo json_encode([
        'success' => false,
        'error' => [
            'code' => $code,
            'message' => $message,
            'field' => $field,
            'details' => new stdClass(),
        ],
    ]);
}
exit;

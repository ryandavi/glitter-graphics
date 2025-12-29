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
include_once('database.php');
include_once('assetAPI.php');
include_once('glitterAPI.php');
include_once('stickerAPI.php');

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
} else if ($assetType === 'sticker') {
    $api = new StickerAPI($db, $CONFIG);
}

// Handle request
$action = $_GET['action'] ?? '';
header('Content-Type: application/json');

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
            if ($assetType === 'glitter') {
                echo json_encode($api->updateGlitter($data));
            } else {
                echo json_encode($api->updateSticker($data));
            }
            break;

        case 'delete':
            $id = (int)$_POST['id'];
            if ($assetType === 'glitter') {
                echo json_encode($api->deleteGlitter($id));
            } else {
                echo json_encode($api->deleteSticker($id));
            }
            break;

        case 'add':
            $data = json_decode(file_get_contents('php://input'), true);
            if ($assetType === 'glitter') {
                echo json_encode($api->addGlitter($data));
            } else {
                echo json_encode($api->addSticker($data));
            }
            break;

        case 'reorder':
            $data = json_decode(file_get_contents('php://input'), true);
            if ($assetType === 'glitter') {
                echo json_encode($api->reorderGlitter($data));
            } else {
                echo json_encode($api->reorderStickers($data));
            }
            break;

case 'analyze':
    $id = (int)$_GET['id'];
    if ($assetType === 'glitter') {
        echo json_encode($api->analyzeGlitter($id));
    } else if ($assetType === 'sticker') {
        echo json_encode($api->analyzeSticker($id));
    } else {
        throw new Exception('Analyze not available for this asset type');
    }
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

        default:
            throw new Exception('Invalid action');
    }
} catch (Exception $e) {
    http_response_code(400);
    echo json_encode(['error' => $e->getMessage()]);
}
exit;
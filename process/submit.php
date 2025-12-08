<?php
// ============================================
// CONFIGURATION
// ============================================

// Database
define('DB_HOST', '127.0.0.1');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_NAME', 'glitter');

// File Upload Paths
define('UPLOAD_DIR', __DIR__ . '/uploads/'); // Physical directory to save files
define('THUMBNAIL_DIR', __DIR__ . '/uploads/thumbnails/'); // Physical directory for thumbnails
define('UPLOAD_URL_PATH', '/glitter/uploads/'); // Public URL path to uploads
define('BASE_URL', 'https://ryandavi.com'); // Your domain (no trailing slash)

// File Upload Settings
define('MAX_FILE_SIZE', 10 * 1024 * 1024); // 10MB in bytes
define('ALLOWED_TYPES', ['image/gif']); // Only GIFs
define('ALLOWED_EXTENSIONS', ['gif']);
define('FILENAME_PREFIX', 'glitter_'); // Prefix for uploaded files

// Artwork Settings
define('AUTO_TITLE_PREFIX', 'Glitter Art '); // Prefix for auto-generated titles
define('AUTO_TITLE_DATE_FORMAT', 'M j, Y g:i A'); // Date format for titles (e.g. "Dec 15, 2023 2:30 PM")

// Anonymous User Settings
define('ANONYMOUS_EMAIL_PREFIX', 'anonymous_'); // Prefix for anonymous user emails
define('ANONYMOUS_EMAIL_DOMAIN', '@glitter.local'); // Domain for anonymous user emails

// Rate Limiting
define('RATE_LIMIT_SECONDS', 300); // 5 minutes = 300 seconds

// Email Notification
define('SEND_EMAIL', true);
define('ADMIN_EMAIL', 'glitter@ryandavi.com');
define('EMAIL_FROM', 'noreply@ryandavi.com');
define('EMAIL_SUBJECT', 'New Glitter Artwork Submitted');

// CORS - adjust for production
define('ALLOW_CORS', true);
define('ALLOWED_ORIGINS', [
    'http://localhost',
    'http://127.0.0.1',
    'https://ryandavi.com',
    'https://www.ryandavi.com'
]);

// Security
define('DEBUG_MODE', false); // Set to false in production

// ============================================
// CORS Headers with Origin Validation
// ============================================
if (ALLOW_CORS) {
    $origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
    
    // Check if origin is allowed
    $allowedOrigin = '*';
    foreach (ALLOWED_ORIGINS as $allowed) {
        if (strpos($origin, $allowed) === 0) {
            $allowedOrigin = $origin;
            break;
        }
    }
    
    header('Access-Control-Allow-Origin: ' . $allowedOrigin);
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Allow-Credentials: true');
}

header('Content-Type: application/json');

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// ============================================
// Helper Functions
// ============================================

function sendError($message, $code = 400, $data = null) {
    http_response_code($code);
    $response = ['success' => false, 'error' => $message];
    if ($data && DEBUG_MODE) {
        $response['debug'] = $data;
    }
    echo json_encode($response);
    exit;
}

function sendSuccess($message, $data = null) {
    http_response_code(200);
    $response = ['success' => true, 'message' => $message];
    if ($data) {
        $response['data'] = $data;
    }
    echo json_encode($response);
    exit;
}

function getClientIP() {
    if (!empty($_SERVER['HTTP_CLIENT_IP'])) {
        return $_SERVER['HTTP_CLIENT_IP'];
    } elseif (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        return explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0];
    } else {
        return $_SERVER['REMOTE_ADDR'];
    }
}

function generateUniqueFilename($extension) {
    return FILENAME_PREFIX . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.' . $extension;
}

// ============================================
// Validate Request Method
// ============================================
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendError('Only POST requests are allowed', 405);
}

// ============================================
// Create Upload Directories
// ============================================
if (!is_dir(UPLOAD_DIR)) {
    if (!mkdir(UPLOAD_DIR, 0755, true)) {
        sendError('Failed to create upload directory', 500);
    }
}
if (!is_dir(THUMBNAIL_DIR)) {
    if (!mkdir(THUMBNAIL_DIR, 0755, true)) {
        sendError('Failed to create thumbnail directory', 500);
    }
}

// ============================================
// Validate File Upload
// ============================================
if (!isset($_FILES['artwork']) || $_FILES['artwork']['error'] !== UPLOAD_ERR_OK) {
    $errorMsg = 'No file uploaded';
    if (isset($_FILES['artwork']['error'])) {
        switch ($_FILES['artwork']['error']) {
            case UPLOAD_ERR_INI_SIZE:
            case UPLOAD_ERR_FORM_SIZE:
                $errorMsg = 'File too large';
                break;
            case UPLOAD_ERR_PARTIAL:
                $errorMsg = 'File partially uploaded';
                break;
        }
    }
    sendError($errorMsg, 400);
}

$file = $_FILES['artwork'];

// Check file size
if ($file['size'] > MAX_FILE_SIZE) {
    sendError('File too large. Maximum size: ' . (MAX_FILE_SIZE / 1024 / 1024) . 'MB', 400);
}

// Validate MIME type
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mimeType = finfo_file($finfo, $file['tmp_name']);
finfo_close($finfo);

if (!in_array($mimeType, ALLOWED_TYPES)) {
    sendError('Invalid file type. Only GIF files are allowed.', 400);
}

// Validate extension
$extension = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
if (!in_array($extension, ALLOWED_EXTENSIONS)) {
    sendError('Invalid file extension. Only .gif files are allowed.', 400);
}

// ============================================
// Get Swatch Data (optional)
// ============================================
$swatchesData = [];
if (isset($_POST['swatches']) && !empty($_POST['swatches'])) {
    $swatchesJson = $_POST['swatches'];
    $swatchesData = json_decode($swatchesJson, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        sendError('Invalid swatches data', 400);
    }
}

// ============================================
// Connect to Database
// ============================================
try {
    $pdo = new PDO(
        "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4",
        DB_USER,
        DB_PASS,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
        ]
    );
} catch (PDOException $e) {
    sendError('Database connection failed', 500, DEBUG_MODE ? $e->getMessage() : null);
}

// ============================================
// Rate Limiting Check
// ============================================
$clientIP = getClientIP();

try {
    $stmt = $pdo->prepare("
        SELECT created_at 
        FROM artwork 
        WHERE ip_address = ? 
        ORDER BY created_at DESC 
        LIMIT 1
    ");
    $stmt->execute([$clientIP]);
    $lastSubmission = $stmt->fetch();

    if ($lastSubmission) {
        $lastTime = strtotime($lastSubmission['created_at']);
        $timeDiff = time() - $lastTime;
        
        if ($timeDiff < RATE_LIMIT_SECONDS) {
            $waitTime = RATE_LIMIT_SECONDS - $timeDiff;
            $minutes = floor($waitTime / 60);
            $seconds = $waitTime % 60;
            sendError(
                "Please wait {$minutes}m {$seconds}s before submitting again.", 
                429,
                ['wait_seconds' => $waitTime]
            );
        }
    }
} catch (PDOException $e) {
    sendError('Rate limit check failed', 500, DEBUG_MODE ? $e->getMessage() : null);
}

// ============================================
// Get or Create Anonymous User
// ============================================
try {
    // Use IP-based anonymous users
    $anonymousEmail = ANONYMOUS_EMAIL_PREFIX . md5($clientIP) . ANONYMOUS_EMAIL_DOMAIN;
    
    $stmt = $pdo->prepare("SELECT id FROM users WHERE email = ?");
    $stmt->execute([$anonymousEmail]);
    $user = $stmt->fetch();

    if ($user) {
        $userId = $user['id'];
        $stmt = $pdo->prepare("UPDATE users SET last_login_at = NOW(), ip_address = ? WHERE id = ?");
        $stmt->execute([$clientIP, $userId]);
    } else {
        $stmt = $pdo->prepare("INSERT INTO users (email, ip_address, created_at) VALUES (?, ?, NOW())");
        $stmt->execute([$anonymousEmail, $clientIP]);
        $userId = $pdo->lastInsertId();
    }
} catch (PDOException $e) {
    sendError('User lookup failed', 500, DEBUG_MODE ? $e->getMessage() : null);
}

// ============================================
// Save File
// ============================================
$filename = generateUniqueFilename($extension);
$filepath = UPLOAD_DIR . $filename;

if (!move_uploaded_file($file['tmp_name'], $filepath)) {
    sendError('Failed to save file', 500);
}

// Get image dimensions
$imageInfo = getimagesize($filepath);
$width = $imageInfo[0] ?? null;
$height = $imageInfo[1] ?? null;
$fileSize = filesize($filepath);

// Generate auto-title
$autoTitle = AUTO_TITLE_PREFIX . date(AUTO_TITLE_DATE_FORMAT);

// ============================================
// Insert Artwork
// ============================================
try {
    $pdo->beginTransaction();

    $stmt = $pdo->prepare("
        INSERT INTO artwork 
        (user_id, ip_address, filename, title, description, file_size, width, height, created_at, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    ");
    
    $stmt->execute([
        $userId,
        $clientIP,
        $filename,
        $autoTitle,
        null, // No description
        $fileSize,
        $width,
        $height
    ]);

    $artworkId = $pdo->lastInsertId();

    // Insert swatches if provided
    if (!empty($swatchesData)) {
        $stmt = $pdo->prepare("
            INSERT INTO artwork_swatches 
            (artwork_id, swatch_id, created_at) 
            VALUES (?, ?, NOW())
        ");

        foreach ($swatchesData as $swatchData) {
            if (is_numeric($swatchData)) {
                $swatchId = (int)$swatchData;
            } elseif (is_array($swatchData) && isset($swatchData['swatch_id'])) {
                $swatchId = (int)$swatchData['swatch_id'];
            } else {
                continue;
            }

            $stmt->execute([$artworkId, $swatchId]);
        }
    }

    $pdo->commit();

} catch (PDOException $e) {
    $pdo->rollBack();
    // Delete uploaded file on database error
    if (file_exists($filepath)) {
        unlink($filepath);
    }
    sendError('Failed to save artwork', 500, DEBUG_MODE ? $e->getMessage() : null);
}

// ============================================
// Send Email Notification
// ============================================
if (SEND_EMAIL) {
    $emailBody = "New glitter artwork submitted!\n\n";
    $emailBody .= "Artwork ID: {$artworkId}\n";
    $emailBody .= "Title: {$autoTitle}\n";
    $emailBody .= "Filename: {$filename}\n";
    $emailBody .= "File Size: " . number_format($fileSize / 1024, 2) . " KB\n";
    $emailBody .= "Dimensions: {$width}x{$height}\n";
    $emailBody .= "IP Address: {$clientIP}\n";
    $emailBody .= "Submitted: " . date('Y-m-d H:i:s') . "\n";
    
    if (!empty($swatchesData)) {
        $emailBody .= "Swatches Used: " . count($swatchesData) . "\n";
    }
    
    $emailBody .= "\nView at: " . BASE_URL . UPLOAD_URL_PATH . $filename . "\n";

    $headers = "From: " . EMAIL_FROM . "\r\n";
    $headers .= "Reply-To: " . EMAIL_FROM . "\r\n";
    $headers .= "X-Mailer: PHP/" . phpversion();

    @mail(ADMIN_EMAIL, EMAIL_SUBJECT, $emailBody, $headers);
}

// ============================================
// Success Response
// ============================================
sendSuccess('Artwork uploaded successfully', [
    'artwork_id' => $artworkId,
    'filename' => $filename,
    'file_size' => $fileSize,
    'width' => $width,
    'height' => $height,
    'url' => UPLOAD_URL_PATH . $filename
]);
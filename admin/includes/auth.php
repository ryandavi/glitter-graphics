<?php

function ensureAdminSessionStarted()
{
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
}

function getAdminCredentials()
{
    static $credentials = null;

    if ($credentials !== null) {
        return $credentials;
    }

    $credentialsPath = __DIR__ . '/credentials.php';
    if (!is_file($credentialsPath)) {
        throw new Exception('Missing admin/includes/credentials.php. Copy credentials.example.php and set a password hash.');
    }

    $credentials = require $credentialsPath;
    if (
        !is_array($credentials) ||
        empty($credentials['username']) ||
        empty($credentials['password_hash'])
    ) {
        throw new Exception('Admin credentials file is invalid.');
    }

    return $credentials;
}

function isAuthEnabled()
{
    return getAdminCredentials()['auth_enabled'] ?? true;
}

function isAdminAuthenticated()
{
    ensureAdminSessionStarted();
    return !empty($_SESSION['admin_authed']);
}

function getCsrfToken()
{
    ensureAdminSessionStarted();

    if (empty($_SESSION['admin_csrf_token'])) {
        $_SESSION['admin_csrf_token'] = bin2hex(random_bytes(32));
    }

    return $_SESSION['admin_csrf_token'];
}

function loginAdmin($username, $password)
{
    ensureAdminSessionStarted();

    $credentials = getAdminCredentials();
    $expectedUsername = (string)$credentials['username'];
    $passwordHash = (string)$credentials['password_hash'];

    if (!hash_equals($expectedUsername, (string)$username)) {
        return false;
    }

    if (!password_verify((string)$password, $passwordHash)) {
        return false;
    }

    session_regenerate_id(true);
    $_SESSION['admin_authed'] = true;
    $_SESSION['admin_username'] = $expectedUsername;
    $_SESSION['admin_csrf_token'] = bin2hex(random_bytes(32));

    return true;
}

function logoutAdmin()
{
    ensureAdminSessionStarted();
    $_SESSION = [];

    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            time() - 42000,
            $params['path'],
            $params['domain'],
            $params['secure'],
            $params['httponly']
        );
    }

    session_destroy();
}

function requireAuth($mode = 'page')
{
    if (!isAuthEnabled()) {
        return;
    }

    if (isAdminAuthenticated()) {
        return;
    }

    if ($mode === 'api') {
        header('Content-Type: application/json');
        http_response_code(401);
        echo json_encode(['error' => 'unauthorized']);
        exit;
    }

    $returnTo = $_SERVER['REQUEST_URI'] ?? '/admin/';
    header('Location: login.php?return=' . rawurlencode($returnTo));
    exit;
}

function requireCsrfToken($mode = 'api')
{
    if (!isAuthEnabled()) {
        return;
    }

    ensureAdminSessionStarted();

    $providedToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $expectedToken = $_SESSION['admin_csrf_token'] ?? '';

    if ($expectedToken !== '' && hash_equals($expectedToken, $providedToken)) {
        return;
    }

    if ($mode === 'api') {
        header('Content-Type: application/json');
        http_response_code(403);
        echo json_encode(['error' => 'forbidden']);
        exit;
    }

    http_response_code(403);
    exit('Forbidden');
}

<?php
require_once('includes/auth.php');

ensureAdminSessionStarted();

if (isAdminAuthenticated()) {
    header('Location: index.php');
    exit;
}

$error = '';
$returnTo = $_GET['return'] ?? $_POST['return'] ?? 'index.php';
if (strpos($returnTo, '/admin/') !== false) {
    $returnTo = preg_replace('#^.*/admin/#', '', $returnTo);
}
if (
    $returnTo === '' ||
    strpos($returnTo, '://') !== false ||
    strpos($returnTo, '//') === 0 ||
    strpos($returnTo, '..') !== false
) {
    $returnTo = 'index.php';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = $_POST['username'] ?? '';
    $password = $_POST['password'] ?? '';

    try {
        if (loginAdmin($username, $password)) {
            header('Location: ' . ($returnTo ?: 'index.php'));
            exit;
        }

        $error = 'Invalid username or password.';
    } catch (Exception $e) {
        $error = $e->getMessage();
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Login</title>
    <link rel="stylesheet" href="css/swatch_admin.css?v=2">
</head>
<body>
    <div class="container" style="min-height: 100vh; align-items: center; justify-content: center;">
        <div class="modal-content" style="display: block; max-width: 420px; width: 100%;">
            <div class="modal-header">
                <h3>Admin Login</h3>
            </div>
            <form method="post" class="modal-body">
                <input type="hidden" name="return" value="<?php echo htmlspecialchars($returnTo, ENT_QUOTES, 'UTF-8'); ?>">
                <?php if ($error): ?>
                    <p style="color: var(--status-error); margin-bottom: 16px;">
                        <?php echo htmlspecialchars($error, ENT_QUOTES, 'UTF-8'); ?>
                    </p>
                <?php endif; ?>
                <div class="form-group">
                    <label for="username">Username</label>
                    <input type="text" id="username" name="username" autocomplete="username" required>
                </div>
                <div class="form-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" name="password" autocomplete="current-password" required>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" type="submit">Log In</button>
                </div>
            </form>
        </div>
    </div>
</body>
</html>

<?php
require_once('includes/config.php');
require_once('includes/auth.php');

requireAuth('page');
$adminCsrfToken = getCsrfToken();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Glitter Admin</title>
    <link rel="stylesheet" href="css/swatch_admin.css">
</head>
<body>
    <div class="container">
       
        <!-- Header -->
        <div class="header">
            <h1><a href="index.php">Glitter Admin</a></h1>
            <ul>
                <li><a href="glitter.php">Glitter</a></li>
                <li><a href="sticker.php">Stickers</a></li>
            </ul>
        </div>

    </div>

    <script>
        const CONFIG = <?php echo json_encode($CONFIG); ?>;
        const ADMIN_CSRF_TOKEN = <?php echo json_encode($adminCsrfToken); ?>;
    </script>
    <script src="js/admin_api.js"></script>
</body>
</html>

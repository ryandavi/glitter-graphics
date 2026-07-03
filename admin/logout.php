<?php
require_once('includes/auth.php');

logoutAdmin();
header('Location: login.php');
exit;

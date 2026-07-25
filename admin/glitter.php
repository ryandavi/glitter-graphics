<?php
require_once('includes/config.php');
require_once('includes/auth.php');
require_once('includes/adminModals.php');

requireAuth('page');
$adminCsrfToken = getCsrfToken();
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
?>
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Glitter Admin</title>
	<script>(function(){try{var s=JSON.parse(localStorage.getItem('glitterEditorSettings')||'{}');document.documentElement.dataset.theme=s.interfaceTheme||'dark';}catch(e){document.documentElement.dataset.theme='dark';}}());</script>
	<link rel="stylesheet" href="css/swatch_admin.css?v=19">
</head>
<body class="admin-tool">
	<div class="container">
		<header class="header">
			<h1><a href="index.php">Glitter Admin</a> / Glitter</h1>
			<nav aria-label="Admin"><ul><li><a href="index.php">Admin</a></li><li class="current">Glitter</li><li><a href="sticker.php">Stickers</a></li></ul></nav>
		</header>

		<aside class="sidebar">
			<div class="sidebar-header">
				<h2>Glitter</h2>
				<button type="button" class="btn btn-primary add-swatch-btn" onclick="app.showAddModal()">Add assets</button>
				<div class="sidebar-action-row">
					<button type="button" class="btn btn-secondary sidebar-action" onclick="app.showManageCategoriesModal()">Categories</button>
					<button type="button" class="btn btn-secondary sidebar-action" onclick="app.showManageTagsModal()">Tags</button>
				</div>
				<div class="sidebar-bulk-action">
					<button type="button" class="btn btn-secondary bulk-analyze-button" onclick="app.analyzeBulk()" title="Refresh technical metadata and stored analysis without replacing chosen colors">Analyze all</button>
				</div>
			</div>
			<div class="swatch-list" id="swatchList"></div>
		</aside>

		<main class="main-content">
			<div class="content-scroll" id="contentScroll">
				<div class="empty-state" id="emptyState">
					<h2>Select a glitter to edit</h2>
					<p>Choose a glitter from the list or add assets for review.</p>
				</div>
				<div id="editorContent" class="editor-content"></div>
			</div>
			<footer class="fixed-footer">
				<span class="status-message" id="statusMessage"></span>
				<div class="button-group">
					<button type="button" class="btn btn-secondary" onclick="app.exportJSON()">Export JSON</button>
					<button type="button" class="btn btn-danger" onclick="app.deleteAsset()">Delete</button>
					<button type="button" class="btn btn-primary" onclick="app.saveAsset()">Save</button>
				</div>
			</footer>
		</main>
	</div>

	<?php renderAdminManagementModals('Glitter'); ?>
	<script>
		const CONFIG = <?php echo json_encode($CONFIG); ?>;
		const ADMIN_CSRF_TOKEN = <?php echo json_encode($adminCsrfToken); ?>;
	</script>
	<script src="js/admin_api.js?v=5"></script>
	<script src="js/asset_admin.js?v=21"></script>
	<script src="js/category_manager.js?v=8"></script>
	<script src="js/tag_manager.js?v=7"></script>
	<script src="js/ingest_review.js?v=13"></script>
	<script src="js/glitter_admin.js?v=11"></script>
</body>
</html>

<?php

require_once('auth.php');

function renderManifestAdminPage($library, $title, $itemLabel)
{
	requireAuth('page');
	$adminCsrfToken = getCsrfToken();
	header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
	header('Pragma: no-cache');
	$config = [
		'library' => $library,
		'title' => $title,
		'itemLabel' => $itemLabel,
		'imageBasePath' => '../',
	];
	?>
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title><?php echo htmlspecialchars($title); ?> Admin</title>
	<script>(function(){try{var s=JSON.parse(localStorage.getItem('glitterEditorSettings')||'{}');document.documentElement.dataset.theme=s.interfaceTheme||'dark';}catch(e){document.documentElement.dataset.theme='dark';}}());</script>
	<link rel="stylesheet" href="css/swatch_admin.css?v=21">
</head>
<body class="admin-tool manifest-admin">
	<div class="container">
		<header class="header">
			<h1><a href="index.php">Glitter Admin</a> / <?php echo htmlspecialchars($title); ?></h1>
			<nav aria-label="Admin">
				<ul>
					<li><a href="index.php">Admin</a></li>
					<li><a href="glitter.php">Glitter</a></li>
					<li><a href="sticker.php">Stickers</a></li>
					<li class="<?php echo $library === 'fonts' ? 'current' : ''; ?>"><?php echo $library === 'fonts' ? 'Fonts' : '<a href="fonts.php">Fonts</a>'; ?></li>
					<li class="<?php echo $library === 'shapes' ? 'current' : ''; ?>"><?php echo $library === 'shapes' ? 'Shapes' : '<a href="shapes.php">Shapes</a>'; ?></li>
				</ul>
			</nav>
		</header>

		<aside class="sidebar">
			<div class="sidebar-header">
				<h2><?php echo htmlspecialchars($title); ?></h2>
				<button type="button" class="btn btn-primary add-swatch-btn" id="addManifestItem">Add <?php echo strtolower(htmlspecialchars($itemLabel)); ?></button>
				<div class="sidebar-bulk-action">
					<button type="button" class="btn btn-secondary bulk-analyze-button" id="manageManifestCategories"><?php echo $library === 'fonts' ? 'Tags' : 'Categories'; ?></button>
				</div>
				<?php if ($library === 'shapes') { ?>
					<div class="sidebar-bulk-action">
						<select id="shapeUsageFilter" aria-label="Shape usage filter">
							<option value="all">All shapes</option>
							<option value="shape">Shape picker</option>
							<option value="brush">Brush picker</option>
							<option value="brush-only">Brush only</option>
						</select>
					</div>
				<?php } ?>
				<div id="libraryHealth" class="page-context">Checking manifest…</div>
			</div>
			<div class="swatch-list" id="libraryList"></div>
		</aside>

		<main class="main-content">
			<div class="content-scroll">
				<div class="empty-state" id="emptyState">
					<h2>Select a <?php echo strtolower(htmlspecialchars($itemLabel)); ?> to edit</h2>
					<p>This page writes the same JSON manifest used by the editor.</p>
				</div>
				<div id="editorContent" class="editor-content"></div>
			</div>
			<footer class="fixed-footer">
				<span class="status-message" id="statusMessage"></span>
				<div class="button-group">
					<button type="button" class="btn btn-danger" id="deleteManifestItem" disabled>Delete</button>
					<button type="button" class="btn btn-primary" id="saveManifestItem" disabled>Save manifest</button>
				</div>
			</footer>
		</main>
	</div>

	<div class="modal" id="manifestCategoriesModal">
		<div class="modal-content modal-width-md">
			<div class="modal-header">
				<h3><?php echo $library === 'fonts' ? 'Font Tags' : 'Shape Categories'; ?></h3>
				<button type="button" class="close-btn" data-close-categories aria-label="Close">&times;</button>
			</div>
			<div class="modal-body">
				<div class="modal-body-content">
					<p class="property-hint"><?php echo $library === 'fonts'
						? 'Organize reusable tags into groups. Removing a tag that is assigned to a font will fail validation when the manifest is saved.'
						: 'Categories organize the Shape picker. Removing a category that is assigned to a shape will fail validation when the manifest is saved.'; ?></p>
					<div class="manifest-taxonomy-editor" id="manifestTaxonomyEditor"></div>
					<button type="button" class="btn btn-secondary btn-sm manifest-taxonomy-add" id="addManifestTaxonomy"><?php echo $library === 'fonts' ? 'Add tag group' : 'Add category'; ?></button>
				</div>
			</div>
			<div class="modal-footer">
				<button type="button" class="btn btn-secondary" data-close-categories>Cancel</button>
				<button type="button" class="btn btn-primary" id="saveManifestCategories">Apply</button>
			</div>
		</div>
	</div>

	<div class="toast-host" id="toastHost" aria-live="polite"></div>
	<script>
		const CONFIG = <?php echo json_encode($config); ?>;
		const ADMIN_CSRF_TOKEN = <?php echo json_encode($adminCsrfToken); ?>;
	</script>
	<script src="js/admin_api.js?v=5"></script>
	<script src="js/manifest_admin.js?v=6"></script>
</body>
</html>
	<?php
}

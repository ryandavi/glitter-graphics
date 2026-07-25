<?php
require_once('includes/config.php');
require_once('includes/auth.php');

requireAuth('page');
$adminCsrfToken = getCsrfToken();
$browserConfig = [
	'asset_types' => array_keys($CONFIG['asset_types']),
	'health_severity' => $CONFIG['health_severity'],
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Admin — Glitter</title>
	<script>(function(){try{var s=JSON.parse(localStorage.getItem('glitterEditorSettings')||'{}');document.documentElement.dataset.theme=s.interfaceTheme||'dark';}catch(e){document.documentElement.dataset.theme='dark';}}());</script>
	<link rel="stylesheet" href="css/swatch_admin.css?v=19">
</head>
<body class="admin-tool">
	<div class="container admin-shell">
		<header class="header admin-shell-header">
			<h1><a href="index.php">Glitter Admin</a></h1>
			<nav aria-label="Admin">
				<ul>
					<li class="current">Admin</li>
					<li><a href="glitter.php">Glitter</a></li>
					<li><a href="sticker.php">Stickers</a></li>
				</ul>
			</nav>
		</header>

		<main class="admin-dashboard">
			<header class="page-header">
				<div>
					<h2>Library health</h2>
					<p class="page-intro">Review incoming files, repair library issues, and keep published data current.</p>
					<p id="healthCheckedAt" class="page-context">Health check not yet run</p>
					<div id="exportStatus" class="export-status"></div>
				</div>
				<div class="page-actions">
					<button type="button" class="btn btn-quiet" id="refreshHealth">Refresh</button>
					<a class="btn btn-secondary" href="glitter.php?ingest=new">Add glitter</a>
					<a class="btn btn-secondary" href="sticker.php?ingest=new">Add stickers</a>
				</div>
			</header>

			<div class="dashboard-filters" role="group" aria-label="Asset type">
				<button type="button" class="filter-chip selected" data-filter="all">All</button>
				<button type="button" class="filter-chip" data-filter="glitter">Glitter</button>
				<button type="button" class="filter-chip" data-filter="sticker">Stickers</button>
			</div>

			<section class="dashboard-section dashboard-overview" aria-labelledby="overviewHeading">
				<div class="section-heading-row">
					<h3 id="overviewHeading">Overview</h3>
				</div>
				<div class="overview-strip" id="healthOverview"></div>
			</section>

			<section class="dashboard-section" aria-labelledby="attentionHeading">
				<div class="section-heading-row">
					<h3 id="attentionHeading">Needs attention</h3>
					<button type="button" class="btn btn-quiet btn-sm" id="showAllChecks">Show all checks</button>
				</div>
				<div id="healthQueue" class="issue-list" aria-live="polite">
					<div class="loading-state">Checking assets…</div>
				</div>
			</section>

			<section class="dashboard-section" aria-labelledby="activityHeading">
				<div class="section-heading-row">
					<h3 id="activityHeading">Recent activity</h3>
				</div>
				<div id="recentActivity" class="activity-list">
					<div class="loading-state">Loading activity…</div>
				</div>
			</section>
		</main>
		<div class="toast-host" id="toastHost" aria-live="polite"></div>
	</div>

	<script>
		const CONFIG = <?php echo json_encode($browserConfig); ?>;
		const ADMIN_CSRF_TOKEN = <?php echo json_encode($adminCsrfToken); ?>;
	</script>
	<script src="js/admin_api.js?v=5"></script>
	<script src="js/admin_dashboard.js?v=5"></script>
	<script>new AdminDashboard().init();</script>
</body>
</html>

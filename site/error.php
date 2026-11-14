<?php if (!isset($page)) exit; ?>
<?php
// The error page body (404.php, and any status .htaccess sends there): the
// homepage hero with the status code as the word, then a way back.
?>
		<main class="home-main" id="main">
<?php $hero = $site['home']; $heroWord = (string) $status; require __DIR__ . '/home-hero.php'; ?>

			<section class="home-intro">
				<p class="home-lead"><?= page_escape($page['description']) ?></p>
				<div class="home-actions">
					<a class="btn-text-with-icon primary" href="<?= page_escape($base) ?>">Go to the homepage</a>
					<a class="btn-text-with-icon" href="<?= page_escape($base) ?>studio/">Open the Editor</a>
				</div>
			</section>
		</main>

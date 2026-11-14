<?php if (!isset($page)) exit; ?>
	<footer class="content-page-footer">
		<ul class="content-page-footer-links">
			<li><a href="<?= page_escape($base) ?>studio/">Editor</a></li>
<?php foreach ($site['pages'] as $item): ?>
			<li><a href="<?= page_escape($base . $item['slug']) ?>/"<?= $item['slug'] === $page['slug'] ? ' aria-current="page"' : '' ?>><?= page_escape($item['title']) ?></a></li>
<?php endforeach; ?>
		</ul>
		<p class="content-page-copyright"><?= page_escape($site['copyright']) ?></p>
	</footer>

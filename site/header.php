<?php if (!isset($page)) exit; ?>
	<header class="app-header content-page-header">
		<div class="app-header-left">
			<a href="https://ryandavi.com" class="app-header-logo" target="_blank" rel="noopener noreferrer" aria-label="Visit ryandavi.com"><span class="logo" aria-hidden="true"></span></a>
			<a class="app-header-title" href="<?= page_escape($base) ?>studio/" title="Open the editor">RYBABY LABS</a>
		</div>
		<div class="app-header-center"><span class="app-header-page-title"><?= page_escape($page['title']) ?></span></div>
		<div class="app-header-right">
			<a class="btn-text-with-icon primary content-page-editor-link" href="<?= page_escape($base) ?>studio/">Open Editor</a>
			<nav class="app-menu" id="appMenu" aria-label="Pages">
				<button class="btn-icon-simple icon-wrapper app-menu-trigger" id="appMenuBtn" type="button" title="Menu" aria-label="Menu" aria-haspopup="menu" aria-expanded="false" aria-controls="appMenuPanel">
					<svg class="icon"><use href="#icon-ellipsis-vertical"></use></svg><span class="name">Menu</span>
				</button>
				<div class="app-menu-panel" id="appMenuPanel" role="menu" aria-labelledby="appMenuBtn" hidden>
<?php foreach ($site['pages'] as $item): ?>
					<a class="app-menu-item" role="menuitem" href="<?= page_escape($base . $item['slug']) ?>/"<?= $item['slug'] === $page['slug'] ? ' aria-current="page"' : '' ?>>
						<span class="app-menu-item-icon icon-wrapper sm"><svg class="icon"><use href="#icon-<?= page_escape($item['icon']) ?>"></use></svg></span>
						<span class="app-menu-item-label"><?= page_escape($item['title']) ?></span>
					</a>
<?php endforeach; ?>
				</div>
			</nav>
		</div>
	</header>

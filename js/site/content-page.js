'use strict';

// The few behaviors a standalone page adds on top of its HTML (see
// tools/build-pages.js). Everything a reader needs is already in the page;
// this is the header menu, Mac key labels in the guide, and the release-note
// disclosures. Loaded after js/ui/menu-popover.js and js/core/key-labels.js.
(() => {
	setupMenuPopover({
		root: document.getElementById('appMenu'),
		trigger: document.getElementById('appMenuBtn'),
		panel: document.getElementById('appMenuPanel')
	});

	localizeKeyLabels(document.querySelector('.doc-content'));

	// Release notes are built open so they read without JavaScript. With it,
	// they collapse to the newest, the same as in the editor.
	document.querySelectorAll('.advanced-disclosure').forEach((disclosure, index) => {
		const toggle = disclosure.querySelector(':scope > [data-advanced-toggle]');
		const setOpen = (open) => {
			disclosure.classList.toggle('is-open', open);
			toggle?.setAttribute('aria-expanded', String(open));
		};
		if (!document.querySelector('.doc-page-updates')) setOpen(index === 0);
		toggle?.addEventListener('click', () => setOpen(!disclosure.classList.contains('is-open')));
	});
})();

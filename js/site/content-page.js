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

	const article = document.querySelector('.doc-content');
	localizeKeyLabels(article);

	// The Preservation timeline's filters are editor code (site.json lists the
	// scripts for that page). The build leaves the controls as templates so the
	// page reads without JavaScript; with it, show them and start the filters.
	if (article && typeof initPreservationTimeline === 'function') {
		article.querySelectorAll('template[data-modal-only]').forEach(template => template.replaceWith(template.content));
		initPreservationTimeline(article);
	}

	// The article wiring the editor runs when it opens the same document as a
	// modal (js/editor/modals-wiring.js registerDocumentModal): numbered
	// reference links and tooltips. The build loads those scripts only on
	// articles (tools/build-pages.js articleUiScripts).
	if (article && typeof initModalReferences === 'function') {
		// The numbered list; a document's general references follow it unnumbered.
		const references = article.querySelector('ol[id$="ReferencesList"]:not([id$="GeneralReferencesList"])');
		if (references) initModalReferences(article, { referenceListSelector: `ol#${references.id}` });
	}
	if (article && typeof initTooltipsInContainer === 'function') {
		initTooltipsInContainer(article);
		// The page scrolls inside .content-page-scroll, not the window, so the
		// tooltip manager's window scroll listener never hears it.
		document.querySelector('.content-page-scroll')?.addEventListener('scroll', () => initTooltips().dismissAll(), { passive: true });
	}

	// When the window has room beside the reading column, the contents list
	// moves into a sticky column on the left; otherwise it stays in the article.
	const toc = article?.querySelector(':scope > .toc');
	const main = document.querySelector('.doc-page-main');
	if (toc && main) {
		const wide = window.matchMedia('(min-width: 1360px)');
		const marker = document.createComment('contents');
		const side = document.createElement('aside');
		side.className = 'content-page-toc';
		side.setAttribute('aria-label', 'Contents');
		toc.before(marker);
		main.prepend(side);
		const place = () => {
			if (wide.matches) side.append(toc);
			else marker.after(toc);
			main.classList.toggle('has-side-toc', wide.matches);
		};
		wide.addEventListener('change', place);
		place();
	}

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

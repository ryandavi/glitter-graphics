const initModalReferences = (modalBody, options = {}) => {
	if (!modalBody) return;

	const config = {
		referenceListSelector: options.referenceListSelector || 'ol',
		highlightDuration: options.highlightDuration || 2000
	};

	// Utility: Remove highlights
	const clearHighlights = () => {
		modalBody.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));
	};

	// Utility: Scroll element into view inside modal
	const scrollToElement = (el, block = 'start') => {
		el.scrollIntoView({ behavior: 'smooth', block, inline: 'nearest' });
	};

	// --- Reference Highlighting ---
	const sups = modalBody.querySelectorAll('sup');
	sups.forEach((sup, index) => {
		const match = sup.textContent.match(/\d+/);
		if (!match) return;

		const refNum = match[0];
		sup.id = `ref-link-${refNum}-${index}`;
		sup.classList.add(`ref-${refNum}`);
		sup.style.cursor = 'pointer';

		sup.addEventListener('click', e => {
			e.preventDefault();
			const targetRef = modalBody.querySelector(`#ref-${refNum}`);
			if (!targetRef) return;

			clearHighlights();
			targetRef.classList.add('highlight');
			scrollToElement(targetRef, 'center');
			setTimeout(() => targetRef.classList.remove('highlight'), config.highlightDuration);
		});
	});

	// --- Reference List Highlighting ---
	const refList = modalBody.querySelector(config.referenceListSelector);
	if (refList) {
		refList.querySelectorAll('li').forEach((item, index) => {
			const refNum = index + 1;
			item.id = `ref-${refNum}`;
			item.style.cursor = 'pointer';

			item.addEventListener('click', e => {
				if (e.target.tagName === 'A') return;
				e.preventDefault();

				const targetSups = modalBody.querySelectorAll(`sup.ref-${refNum}`);
				if (!targetSups.length) return;

				clearHighlights();
				targetSups.forEach(sup => sup.classList.add('highlight'));
				scrollToElement(targetSups[0], 'center');
				setTimeout(() => targetSups.forEach(sup => sup.classList.remove('highlight')), config.highlightDuration);
			});
		});
	}
};

const initModalSmoothScroll = (modal) => {
	if (!modal) return;

	// Utility: Scroll element into view
	const scrollToElement = (el, block = 'start') => {
		el.scrollIntoView({ behavior: 'smooth', block, inline: 'nearest' });
	};

	// Handle all anchor links
	modal.querySelectorAll('a[href^="#"]').forEach(link => {
		// Skip reference links (handled by initModalReferences)
		if (link.getAttribute('href').match(/^#ref-/)) return;

		link.addEventListener('click', e => {
			const targetId = link.getAttribute('href').slice(1);
			const targetEl = modal.querySelector(`#${targetId}`);
			if (!targetEl) return;

			e.preventDefault();
			scrollToElement(targetEl, 'start');
		});
	});
};

const initDocumentModalNavigation = (modal) => {
	if (!modal) return;

	const nav = modal.querySelector('.document-nav');
	const modalBody = modal.querySelector('.modal-body');
	if (!nav || !modalBody || nav.dataset.initialized === 'true') return;

	const searchInput = nav.querySelector('.document-search-input');
	const searchResults = nav.querySelector('.document-search-results');
	const searchStatus = nav.querySelector('.document-search-status');
	const tocButton = nav.querySelector('.document-toc-toggle');
	const tocPanel = nav.querySelector('.document-toc-panel');
	const topButton = nav.querySelector('.document-back-to-top');
	const toc = modalBody.querySelector('.toc');
	if (!searchInput || !searchResults || !searchStatus || !tocButton || !tocPanel || !topButton || !toc) return;

	nav.dataset.initialized = 'true';
	toc.classList.add('document-toc-menu');
	tocPanel.replaceChildren(toc);
	nav.hidden = false;

	const closeToc = ({ restoreFocus = false } = {}) => {
		tocPanel.hidden = true;
		tocButton.setAttribute('aria-expanded', 'false');
		if (restoreFocus) tocButton.focus({ preventScroll: true });
	};
	const closeResults = () => {
		searchResults.hidden = true;
	};
	const focusDocumentTarget = (target) => {
		if (!(target instanceof HTMLElement)) return;
		target.tabIndex = -1;
		target.focus({ preventScroll: true });
		target.classList.add('document-search-hit');
		target.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
		window.setTimeout(() => target.classList.remove('document-search-hit'), 1200);
	};

	tocButton.addEventListener('click', () => {
		const willOpen = tocPanel.hidden;
		closeResults();
		tocPanel.hidden = !willOpen;
		tocButton.setAttribute('aria-expanded', String(willOpen));
		if (willOpen) tocPanel.querySelector('a[href^="#"]')?.focus({ preventScroll: true });
	});

	tocPanel.addEventListener('click', (event) => {
		const link = event.target.closest('a[href^="#"]');
		if (!link) return;

		const target = modal.querySelector(link.getAttribute('href'));
		closeToc();
		requestAnimationFrame(() => focusDocumentTarget(target));
	});

	const searchable = [];
	let currentHeading = '';
	modalBody.querySelectorAll('h2, h3, h4, h5, p, li').forEach(element => {
		if (element.closest('.toc')) return;
		const text = element.textContent.replace(/\s+/g, ' ').trim();
		if (!text) return;

		if (element.matches('h2, h3, h4, h5')) currentHeading = text;
		searchable.push({
			element,
			heading: currentHeading || text,
			text,
			normalized: text.toLocaleLowerCase()
		});
	});

	const renderSearchResults = () => {
		const query = searchInput.value.trim().toLocaleLowerCase();
		searchResults.replaceChildren();

		if (query.length < 2) {
			searchStatus.textContent = query ? 'Type at least two characters to search.' : '';
			closeResults();
			return;
		}

		const matches = searchable.filter(record => record.normalized.includes(query));
		searchStatus.textContent = `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`;

		if (matches.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'document-search-empty';
			empty.textContent = `No matches for “${searchInput.value.trim()}”.`;
			searchResults.append(empty);
		}

		matches.slice(0, 8).forEach(record => {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'document-search-result';

			const title = document.createElement('span');
			title.className = 'document-search-result-title';
			title.textContent = record.heading;

			const excerpt = document.createElement('span');
			excerpt.className = 'document-search-result-excerpt';
			excerpt.textContent = record.text;

			button.append(title);
			if (record.text !== record.heading) button.append(excerpt);
			button.addEventListener('click', () => {
				closeResults();
				focusDocumentTarget(record.element);
			});
			searchResults.append(button);
		});

		if (matches.length > 8) {
			const overflow = document.createElement('div');
			overflow.className = 'document-search-overflow';
			overflow.textContent = `${matches.length - 8} more matches. Refine your search to narrow the list.`;
			searchResults.append(overflow);
		}

		searchResults.hidden = false;
		closeToc();
	};

	searchInput.addEventListener('input', renderSearchResults);
	searchInput.addEventListener('focus', () => {
		if (searchInput.value.trim().length >= 2) renderSearchResults();
	});

	topButton.addEventListener('click', () => {
		closeResults();
		closeToc();
		modalBody.scrollTo({ top: 0, behavior: 'smooth' });
	});

	modalBody.addEventListener('scroll', () => {
		closeResults();
		closeToc();
		topButton.hidden = modalBody.scrollTop < 240;
	}, { passive: true });

	nav.addEventListener('keydown', (event) => {
		if (event.key !== 'Escape' || (tocPanel.hidden && searchResults.hidden)) return;
		event.preventDefault();
		event.stopPropagation();
		closeResults();
		closeToc({ restoreFocus: true });
	});

	modal.addEventListener('click', (event) => {
		if (nav.contains(event.target)) return;
		closeResults();
		closeToc();
	});
};

const initPixelScalerInContainer = (container = document) => {
	const images = container.querySelectorAll('img[data-pixel-scale]');
	if (images.length === 0) return;

	const scaleImages = () => {
		images.forEach(img => {
			// Ensure image is loaded before calculating
			if (!img.complete || img.naturalWidth === 0) {
				img.onload = scaleImages;
				return;
			}

			const scale = Number(img.dataset.pixelScale) || 1;
			const targetWidth = img.naturalWidth * scale;

			// Set the "ideal" width. 
			// The CSS max-width: 100% will automatically shrink it 
			// if the parent is smaller than this value.
			img.style.width = `${targetWidth}px`;
		});
	};

	// Initial Run
	scaleImages();
};

// ============================================
// PIXEL SCALER (Global initialization)
// Delegates to initPixelScalerInContainer and re-runs on resize
// ============================================
const initPixelScaler = () => {
	const debounce = (func, wait) => {
		let timeout;
		return (...args) => {
			clearTimeout(timeout);
			timeout = setTimeout(() => func.apply(this, args), wait);
		};
	};

	initPixelScalerInContainer(document);
	window.addEventListener('resize', debounce(() => initPixelScalerInContainer(document), 150));
};


// ============================================
// TOOLTIP MANAGER CLASS
// ============================================


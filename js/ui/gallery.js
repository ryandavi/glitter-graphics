// Shared Library reveal path for primary asset Change buttons and armed
// paint-slot pickers. Mobile uses the Library drawer; desktop uses the same
// accordion section and scroll target for every asset manager.
function revealAssetBrowser(editor, manager = null, assetId = null) {
	const revealRequestedGallery = () => {
		// Gallery panels own their scrolling. scrollIntoView can also scroll the
		// document, pulling all three editor columns underneath the fixed header.
		const scrollContainer = manager?.browser?.scrollContainer || manager?.ui?.panel;
		scrollContainer?.scrollTo?.({ top: 0, behavior: 'smooth' });
	};
	if (editor.mobileManager?.isMobile) {
		editor.mobileManager.openDrawer('design');
	} else {
		editor.setCollapsibleSectionOpen?.('designGallery', true, true);
	}
	// Align the requested browser after the accordion or drawer has completed
	// its layout instead of accepting a partially-visible `nearest` result.
	if (assetId != null) {
		// navigateToItem owns the inner item scroll and centers the selection.
		// Resetting the same container afterward would immediately hide it again.
		Promise.resolve(manager?.browser?.navigateToItem(assetId));
	} else {
		requestAnimationFrame(() => requestAnimationFrame(revealRequestedGallery));
	}
}

// The Library shows one asset kind at a time: an armed picker's kind (a
// glitter slot picker unless the strip names another library), else the
// panel's home kind (LAYER_UI_CONFIG `library`). The section header names it;
// with no kind (nothing selected, or a layer type with no library)
// syncNoLayerPanelState owns the title.
function syncLibraryView() {
	const section = document.getElementById('designGallerySection');
	if (!section) return null;
	const home = document.getElementById('designPanel')?.dataset.homeLibrary || '';
	const kind = section.dataset.pickerLibrary || (section.classList.contains('picker-mode') ? 'glitter' : home);
	const schema = kind ? getAssetBrowserSchema(kind) : null;
	if (schema) section.dataset.library = schema.prefix;
	else delete section.dataset.library;
	ASSET_BROWSERS.forEach((entry) => {
		const active = entry === schema;
		[entry.searchHost, entry.browserHost].forEach((id) => {
			const host = document.getElementById(id);
			if (!host) return;
			host.style.display = active ? '' : 'none';
			host.classList.toggle('visible', active);
		});
	});
	const title = document.getElementById('designGalleryTitleText');
	if (schema && title) title.textContent = schema.title;
	const recolor = document.getElementById('recolorGlitterBtn');
	if (recolor) {
		recolor.hidden = schema?.prefix !== 'glitter';
		recolor.classList.toggle('visible', !recolor.hidden);
	}
	const upload = document.getElementById('uploadStickerBtn');
	if (upload) {
		upload.hidden = !['sticker', 'glitter'].includes(schema?.prefix);
		const label = schema?.prefix === 'glitter' ? 'Upload fill tile' : 'Upload sticker';
		upload.title = label;
		upload.setAttribute('aria-label', label);
		upload.querySelector('.name').textContent = label;
	}
	syncLibrarySearchState();
	return schema?.prefix || null;
}

// What the folded search row still has to say, as classes the stylesheet
// reads: `has-filter-summary` on a search host with chips to show, and
// `has-active-query` on the header search button while the showing kind is
// searched or filtered.
function syncLibrarySearchState() {
	const section = document.getElementById('designGallerySection');
	if (!section) return;
	let active = false;
	section.querySelectorAll('.gallery-search-section').forEach((host) => {
		const search = host.querySelector(':scope > .glitter-search');
		const summary = search?.querySelector('.active-filter-summary');
		host.classList.toggle('has-filter-summary', Boolean(summary && !summary.hidden));
		if (host.classList.contains('visible') && search?.matches('.has-active-search, .has-active-filters')) active = true;
	});
	document.getElementById('librarySearchToggle')?.classList.toggle('has-active-query', active);
}

// Single source for ShapeLibrary cards used by the shape tool picker and the
// Library. `tag` 'div' builds a non-button card (a Library card holds its own
// favorite button).
function createShapeCard(shapeId, label, { className = 'brush-shape-option', title = label, tag = 'button' } = {}) {
	let card = tplClone('tpl-shape-card');
	if (tag !== 'button') {
		const box = document.createElement(tag);
		box.className = card.className;
		box.append(...card.childNodes);
		card = box;
	}
	card.classList.add(...className.split(/\s+/).filter(Boolean));
	card.dataset.shape = shapeId;
	card.title = title;
	card.setAttribute('aria-label', title);
	const icon = card.querySelector('.brush-shape-option-icon');
	// ShapeLibrary icons are developer-authored SVG source, not asset data.
	icon.innerHTML = ShapeLibrary.getIconSvg(shapeId);
	card.querySelector('.brush-shape-option-name').textContent = label;
	return card;
}

function setCollapsibleSectionState(section, content, toggle, isOpen) {
	section?.classList.toggle('is-open', isOpen);
	content?.classList.toggle('visible', isOpen);
	toggle?.classList.toggle('collapsed', !isOpen);
}

// ============================================
// VALUE + UNIT FORMATTING
// ============================================
// Render a numeric setting value with its unit in a muted, smaller span (same
// look as .input-unit-suffix). Reusable for any value display — assign the
// result to element.innerHTML. Units: 'px', '%', '°' etc. An empty unit (e.g.
// Threshold, which is a unitless tolerance) renders just the number.
function formatPickerTarget(layerName, typeWord) {
	if (layerName) return `Applying to “${layerName}”`;
	const label = typeWord.replace(/\b\w/g, (letter) => letter.toUpperCase());
	return `Current ${label}${/\blayer\b/i.test(typeWord) ? '' : ' Layer'}`;
}

function formatPickerStripText(layer, slot, typeWord) {
	return {
		title: `Choosing ${getPaintSlotLabel(layer.type, slot)} glitter`,
		detail: formatPickerTarget(layer.name, typeWord)
	};
}

function formatAssetPickerStripText(assetType, layerName) {
	const label = assetType.charAt(0).toUpperCase() + assetType.slice(1);
	return {
		title: `Choosing ${assetType}`,
		detail: layerName ? `Replacing “${layerName}”` : `Current ${label} Layer`
	};
}

// Shared gallery reveal path for primary asset Change buttons and armed
// paint-slot pickers. Mobile uses the Design drawer; desktop uses the same
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
	// The Design section can contain more than one gallery (Shape layers show
	// Shapes before Glitter). Align the requested gallery after the accordion or
	// drawer has completed its layout instead of accepting a partially-visible
	// `nearest` result that leaves the preceding gallery at the top.
	if (assetId != null) {
		// navigateToItem owns the inner item scroll and centers the selection.
		// Resetting the same container afterward would immediately hide it again.
		Promise.resolve(manager?.browser?.navigateToItem(assetId));
	} else {
		requestAnimationFrame(() => requestAnimationFrame(revealRequestedGallery));
	}
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

function formatPickerStripText(slot, layerName, typeWord) {
	return {
		title: `Choosing ${slot} glitter`,
		detail: formatPickerTarget(layerName, typeWord)
	};
}

function formatAssetPickerStripText(assetType, layerName) {
	const label = assetType.charAt(0).toUpperCase() + assetType.slice(1);
	return {
		title: `Choosing ${assetType}`,
		detail: layerName ? `Replacing “${layerName}”` : `Current ${label} Layer`
	};
}


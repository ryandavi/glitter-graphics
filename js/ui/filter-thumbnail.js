'use strict';

function renderFilterCssThumbnail(element, value, strength = 1) {
	if (!element) return;
	const data = GlitterFilter.normalizeFilterData(value);
	const resolved = GlitterFilter.resolve(data);
	GlitterFilter.FILTER_TYPES.forEach((type) => element.classList.remove(`filter-css-thumbnail-${type}`));
	element.classList.add('filter-css-thumbnail', `filter-css-thumbnail-${data.type}`);
	element.style.opacity = Math.max(0, Math.min(1, Number(strength) || 0));
	element.replaceChildren();

	const base = document.createElement('span');
	base.className = 'filter-css-thumbnail-base';
	const toneFilter = GlitterToneAdjust.toneCssFilterString(resolved.tone);
	if (toneFilter) base.style.filter = toneFilter;
	if (resolved.blur) base.style.filter = `${base.style.filter} ${GlitterBlur.cssBlurString(resolved.blur, 1)}`.trim();
	element.appendChild(base);

	resolved.ops.forEach((op) => {
		const overlay = document.createElement('span');
		overlay.className = `filter-css-thumbnail-overlay filter-css-thumbnail-${op.kind}`;
		overlay.style.mixBlendMode = op.mode;
		overlay.style.opacity = op.kind === 'grain' ? op.amount : op.opacity;
		if (op.kind === 'fill') overlay.style.background = op.color;
		else if (op.kind === 'gradient') overlay.style.backgroundImage = GlitterFilter.gradientCss(op.gradient);
		element.appendChild(overlay);
	});
}

GlitterFilter.renderCssThumbnail = renderFilterCssThumbnail;

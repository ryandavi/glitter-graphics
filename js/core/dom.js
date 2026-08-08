'use strict';

function el(id, { required = true } = {}) {
	const node = document.getElementById(id);
	if (!node && required && CONFIG.debug.enabled) {
		console.warn(`[dom] missing element #${id}`, new Error().stack);
	}
	return node;
}

function els(ids, options = {}) {
	return Object.fromEntries(
		Object.entries(ids).map(([key, id]) => [key, el(id, options)])
	);
}

// Markup lives in the index.html `tpl-*` <template>s; builders clone instead of
// writing HTML strings so asset-derived text only ever lands in textContent.
function tplClone(templateId) {
	return document.getElementById(templateId).content.firstElementChild.cloneNode(true);
}

// `<svg class="icon"><use href="#icon-NAME"></use></svg>`. Cloned rather than
// constructed because SVG children need createElementNS to be live elements.
function createIcon(name) {
	const svg = tplClone('tpl-icon');
	svg.querySelector('use').setAttribute('href', `#icon-${name}`);
	return svg;
}

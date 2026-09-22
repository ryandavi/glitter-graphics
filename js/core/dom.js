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

const SCRIPT_LOADS = new Map();

function loadScriptOnce(src) {
	if (SCRIPT_LOADS.has(src)) return SCRIPT_LOADS.get(src);
	const existing = Array.from(document.scripts).find((script) => script.src === new URL(src, document.baseURI).href);
	if (existing?.dataset.loaded === 'true') return Promise.resolve(existing);
	const promise = new Promise((resolve, reject) => {
		const script = existing || document.createElement('script');
		script.addEventListener('load', () => {
			script.dataset.loaded = 'true';
			resolve(script);
		}, { once: true });
		script.addEventListener('error', () => {
			SCRIPT_LOADS.delete(src);
			reject(new Error(`Could not load script: ${src}`));
		}, { once: true });
		if (!existing) {
			script.src = src;
			document.head.appendChild(script);
		}
	});
	SCRIPT_LOADS.set(src, promise);
	return promise;
}

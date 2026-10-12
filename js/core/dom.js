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
			script.remove();
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

const SCRIPT_GROUP_LOADS = new Map();
const SCRIPT_GROUP_EXPORTS = new Map();

function loadScriptGroup(id) {
	if (!Object.hasOwn(SCRIPT_GROUP_URLS, id)) return Promise.reject(new Error(`Unknown script group: ${id}`));
	if (id === 'head' || id === 'boot') return Promise.reject(new Error(`Script group ${id} is loaded by the shell`));
	if (!SCRIPT_GROUP_LOADS.has(id)) {
		const promise = (async () => {
			for (const src of SCRIPT_GROUP_URLS[id]) await loadScriptOnce(src);
			return SCRIPT_GROUP_EXPORTS.get(id) || {};
		})().catch((error) => { SCRIPT_GROUP_LOADS.delete(id); throw error; });
		SCRIPT_GROUP_LOADS.set(id, promise);
	}
	return SCRIPT_GROUP_LOADS.get(id);
}

async function loadImageElement(url) {
	const image = new Image();
	image.crossOrigin = 'anonymous';
	await new Promise((resolve, reject) => {
		image.onload = resolve;
		image.onerror = () => reject(new Error(`Could not load image: ${url}`));
		image.src = url;
	});
	await image.decode();
	return image;
}

const DECODED_THUMBNAILS = new Set();

// The browser holds prefetched images until their visible batch is ready.
// Other hosts reveal themselves and skip entrance for cached decodes.
function createLoadingImage({ src, alt = '', placeholderColor }) {
	const image = document.createElement('img');
	image.alt = alt;
	image.decoding = 'async';
	image.draggable = false;
	image.loadingState = DECODED_THUMBNAILS.has(src) ? 'cached' : 'pending';
	image.revealLoading = () => {
		const host = image.parentElement;
		if (!host) return;
		host.classList.add('loading-image-host');
		host.classList.toggle('is-entry-reveal', Boolean(image.revealOnEntry));
		host.classList.toggle('is-waiting-reveal', Boolean(image.holdLoadingReveal));
		if (placeholderColor) host.style.setProperty('--tile-placeholder', placeholderColor);
		const visibleState = image.holdLoadingReveal && image.loadingState !== 'failed' ? 'pending' : image.loadingState;
		for (const state of ['pending', 'ready', 'failed']) host.classList.toggle(`is-${state}`, visibleState === state || (state === 'ready' && visibleState === 'cached'));
		host.classList.toggle('is-cached', image.loadingState === 'cached');
	};
	// An entrance plays once: a later class change on the host must not replay it.
	image.addEventListener('animationend', () => {
		if (image.loadingState !== 'ready' && !image.revealOnEntry) return;
		image.loadingState = 'cached';
		image.revealOnEntry = false;
		image.revealLoading();
	});
	image.loadingReady = new Promise(resolve => {
		const settle = state => {
			image.onload = image.onerror = null;
			image.loadingState = state;
			if (state !== 'failed') DECODED_THUMBNAILS.add(src);
			else DECODED_THUMBNAILS.delete(src);
			if (!image.holdLoadingReveal || state === 'cached') image.revealLoading();
			resolve();
		};
		image.onload = async () => {
			try {
				await image.decode();
				settle(image.loadingState === 'cached' ? 'cached' : 'ready');
			} catch { settle('failed'); }
		};
		image.onerror = () => settle('failed');
		image.src = src;
		if (image.complete && image.naturalWidth) image.loadingState = 'cached';
		queueMicrotask(() => image.revealLoading());
	});
	return image;
}

// Hands the main thread back so progress can paint and Cancel can land. A
// message task, never requestAnimationFrame: a frame callback waits for the
// next screen refresh (twice as long in iOS Low Power Mode) and does not fire
// in a hidden tab, so an export paced by it idles most of its time or stalls.
function yieldToEventLoop() {
	return new Promise((resolve) => {
		const { port1, port2 } = new MessageChannel();
		port1.onmessage = () => {
			port1.close();
			port2.close();
			resolve();
		};
		port2.postMessage(null);
	});
}

function blobToDataUrl(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => reject(reader.error || new Error('Could not read file data.'));
		reader.readAsDataURL(blob);
	});
}

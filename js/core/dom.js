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

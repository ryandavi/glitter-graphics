'use strict';

class MemoryLedger {
	constructor() {
		this.entries = new Map();
		this.canvases = [];
		this.overlay = null;
		this.overlayTimer = null;
		this.nextCanvasId = 1;
	}

	register({ id, label = id, category = 'Other', measure }) {
		if (!id || typeof measure !== 'function') return () => {};
		this.entries.set(id, { id, label, category, measure });
		return () => this.entries.delete(id);
	}

	trackCanvas(canvas, owner = 'Canvas') {
		const record = { id: `canvas:${this.nextCanvasId++}`, owner, ref: typeof WeakRef === 'function' ? new WeakRef(canvas) : { deref: () => canvas } };
		this.canvases.push(record);
		return canvas;
	}

	snapshot() {
		const items = [];
		for (const entry of this.entries.values()) {
			let bytes = 0;
			try { bytes = Math.max(0, Number(entry.measure()) || 0); } catch (error) { if (typeof dbg === 'function') dbg('[Memory] Measurement failed', entry.id, error); }
			items.push({ id: entry.id, label: entry.label, category: entry.category, bytes });
		}
		let canvasArea = 0;
		this.canvases = this.canvases.filter((record) => {
			const canvas = record.ref.deref();
			if (!canvas) return false;
			const pixels = Math.max(0, Number(canvas.width) || 0) * Math.max(0, Number(canvas.height) || 0);
			canvasArea += pixels;
			items.push({ id: record.id, label: record.owner, category: 'Canvas backing stores', bytes: pixels * 4 });
			return true;
		});
		const categories = {};
		items.forEach((item) => { categories[item.category] = (categories[item.category] || 0) + item.bytes; });
		const total = items.reduce((sum, item) => sum + item.bytes, 0);
		return {
			total,
			canvasArea,
			categories,
			top: [...items].sort((a, b) => b.bytes - a.bytes).slice(0, 5),
			items,
			jsHeap: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null
		};
	}

	toggleOverlay() {
		if (this.overlay) {
			clearInterval(this.overlayTimer);
			this.overlay.remove();
			this.overlay = null;
			return;
		}
		const overlay = document.createElement('pre');
		overlay.className = 'memory-overlay ui-ignore-gestures';
		overlay.setAttribute('role', 'status');
		document.body.appendChild(overlay);
		this.overlay = overlay;
		const render = () => {
			const data = this.snapshot();
			const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
			overlay.textContent = [
				`App estimate  ${mb(data.total)}`,
				`Canvas area   ${data.canvasArea.toLocaleString()} px (${mb(data.canvasArea * 4)})`,
				...Object.entries(data.categories).sort((a, b) => b[1] - a[1]).map(([name, bytes]) => `${name}  ${mb(bytes)}`),
				...(data.jsHeap ? [`JS heap  ${mb(data.jsHeap.used)} / ${mb(data.jsHeap.total)}`] : []),
				'',
				'Top items',
				...data.top.map((item) => `${item.label}  ${mb(item.bytes)}`)
			].join('\n');
		};
		render();
		this.overlayTimer = setInterval(render, 1000);
	}
}

const APP_MEMORY_LEDGER = new MemoryLedger();
window.glitterMemory = () => APP_MEMORY_LEDGER.snapshot();

function isIOSDevice() {
	return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Byte budgets for this device, from CONFIG.memory. Browsers can't report
// real memory limits, so iOS and devices reporting 4 GB or less get the
// constrained set.
function getMemoryBudget() {
	const constrained = isIOSDevice() || (Number(navigator.deviceMemory) > 0 && navigator.deviceMemory <= 4);
	const budget = CONFIG.memory.budgets[constrained ? 'constrained' : 'standard'];
	const megabyte = 1024 * 1024;
	return {
		constrained,
		historyBytes: budget.historyMB * megabyte,
		paintHistoryBytes: budget.paintHistoryMB * megabyte,
		previewCacheBytes: budget.previewCacheMB * megabyte,
		exportBytes: budget.exportMB * megabyte
	};
}

// Preview caches hold results that can always be rebuilt. They share one
// byte budget: past it, the least recently used entries across all of them
// are dropped (never the one just written).
const PREVIEW_CACHE_POOL = {
	caches: new Set(),
	clock: 0,
	enforce() {
		const budget = getMemoryBudget().previewCacheBytes;
		const entries = [];
		let total = 0;
		this.caches.forEach((cache) => cache.map.forEach((entry, key) => {
			const bytes = cache.measure(entry.value);
			total += bytes;
			entries.push({ cache, key, entry, bytes });
		}));
		if (total <= budget) return;
		entries.sort((a, b) => a.entry.used - b.entry.used);
		for (const item of entries) {
			if (total <= budget) break;
			if (item.entry.used === this.clock) continue;
			item.cache.map.delete(item.key);
			total -= item.bytes;
		}
	}
};

// A Map-like cache in the shared preview budget. `measure(value)` returns the
// bytes one value holds; it runs when the budget is checked, so values that
// grow after being stored (a canvas attached later) are still counted.
class ByteBudgetCache {
	constructor({ id, label, measure }) {
		this.map = new Map();
		this.measure = measure;
		PREVIEW_CACHE_POOL.caches.add(this);
		APP_MEMORY_LEDGER.register({ id, label, category: 'Preview caches', measure: () => this.bytes() });
	}

	get(key) {
		const entry = this.map.get(key);
		if (!entry) return undefined;
		entry.used = ++PREVIEW_CACHE_POOL.clock;
		return entry.value;
	}

	has(key) { return this.map.has(key); }

	set(key, value) {
		this.map.set(key, { value, used: ++PREVIEW_CACHE_POOL.clock });
		PREVIEW_CACHE_POOL.enforce();
		return this;
	}

	delete(key) { return this.map.delete(key); }

	// Drop every entry whose key matches (for example all of one layer's).
	deleteWhere(predicate) {
		Array.from(this.map.keys()).forEach((key) => {
			if (predicate(key)) this.map.delete(key);
		});
	}

	clear() { this.map.clear(); }

	get size() { return this.map.size; }

	keys() { return this.map.keys(); }

	*values() {
		for (const entry of this.map.values()) yield entry.value;
	}

	bytes() {
		let total = 0;
		this.map.forEach((entry) => { total += this.measure(entry.value); });
		return total;
	}
}

const canvasBytes = (canvas) => (canvas ? (Number(canvas.width) || 0) * (Number(canvas.height) || 0) * 4 : 0);

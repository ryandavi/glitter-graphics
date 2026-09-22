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

// ============================================
// PIXEL GRID OVERLAY
// Draws the zoomed-in pixel grid on an unscaled canvas in device pixels.
// ============================================
// The rendered preview canvas is the single source of truth: its bounding rect
// gives the grid origin, displayed size, and source-pixel spacing, so the grid
// cannot disagree with the artwork about where it is. Each boundary comes from
// the absolute formula `left + i * renderedWidth / sourceWidth` (never an
// accumulated cell size) and is snapped once to a device pixel.
class PixelGridOverlay {
	constructor(previewContainer, previewWrapper) {
		this.container = previewContainer;
		this.artwork = previewWrapper.querySelector('.preview-canvas');
		this.canvas = document.createElement('canvas');
		this.canvas.className = 'pixel-grid-overlay';
		this.canvas.setAttribute('aria-hidden', 'true');
		this.canvas.hidden = true;
		previewWrapper.after(this.canvas);
		this.ctx = this.canvas.getContext('2d');
		this.visible = false;
		// Sub-pixel shift last applied to line the overlay up with device pixels.
		this.shiftX = 0;
		this.shiftY = 0;

		// Container size, page position, and devicePixelRatio all change the
		// device-pixel mapping without going through the viewport transform.
		const redraw = () => this.redraw();
		new ResizeObserver(redraw).observe(this.container);
		window.addEventListener('resize', redraw);
	}

	setVisible(visible) {
		this.visible = visible;
		this.redraw();
	}

	redraw() {
		const source = this.artwork;
		if (!this.visible || !source?.width || !source.height) {
			this.canvas.hidden = true;
			return;
		}

		const canvas = this.canvas;
		canvas.hidden = false;
		const dpr = window.devicePixelRatio || 1;

		// The overlay's own untransformed origin, in device pixels, pinned to a
		// whole device pixel so one backing pixel is exactly one device pixel.
		const ownRect = canvas.getBoundingClientRect();
		const originX = (ownRect.left - this.shiftX) * dpr;
		const originY = (ownRect.top - this.shiftY) * dpr;
		const snapX = Math.round(originX);
		const snapY = Math.round(originY);
		this.shiftX = (snapX - originX) / dpr;
		this.shiftY = (snapY - originY) / dpr;

		const width = Math.ceil(this.container.clientWidth * dpr);
		const height = Math.ceil(this.container.clientHeight * dpr);
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
		canvas.style.width = `${width / dpr}px`;
		canvas.style.height = `${height / dpr}px`;
		canvas.style.transform = `translate(${this.shiftX}px, ${this.shiftY}px)`;

		// Rendered artwork bounds in device pixels, relative to the overlay.
		const art = source.getBoundingClientRect();
		const artLeft = art.left * dpr - snapX;
		const artTop = art.top * dpr - snapY;
		const stepX = (art.width * dpr) / source.width;
		const stepY = (art.height * dpr) / source.height;
		// Device column/row where source pixel `i` begins. Rounding matches
		// nearest-neighbor sampling at device-pixel centers.
		const colAt = (i) => Math.round(artLeft + i * stepX);
		const rowAt = (i) => Math.round(artTop + i * stepY);

		const left = colAt(0);
		const right = colAt(source.width);
		const top = rowAt(0);
		const bottom = rowAt(source.height);

		const ctx = this.ctx;
		ctx.clearRect(0, 0, width, height);

		// Only visit boundaries that land inside the overlay.
		const firstCol = Math.max(0, Math.floor(-artLeft / stepX));
		const lastCol = Math.min(source.width, Math.ceil((width - artLeft) / stepX));
		const firstRow = Math.max(0, Math.floor(-artTop / stepY));
		const lastRow = Math.min(source.height, Math.ceil((height - artTop) / stepY));

		// One path of same-winding rects fills as a union, so crossings are not
		// darkened by double alpha. The far edges sit on the artwork's last
		// device column/row so all four borders stay inside the canvas bounds.
		ctx.beginPath();
		for (let i = firstCol; i <= lastCol; i++) {
			const x = i === source.width ? right - 1 : colAt(i);
			ctx.rect(x, top, 1, bottom - top);
		}
		for (let i = firstRow; i <= lastRow; i++) {
			const y = i === source.height ? bottom - 1 : rowAt(i);
			ctx.rect(left, y, right - left, 1);
		}
		ctx.fillStyle = CONFIG.ui.zoom.pixelGridColor;
		ctx.fill();
	}
}

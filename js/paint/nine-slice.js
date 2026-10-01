'use strict';

// Preview and export must use identical source/destination boundaries.
function normalizeSlice(slice, assetWidth, assetHeight) {
	if (!slice || !Number.isFinite(assetWidth) || !Number.isFinite(assetHeight) || assetWidth <= 0 || assetHeight <= 0) return null;
	const result = {};
	for (const side of ['top', 'right', 'bottom', 'left']) {
		if (!Number.isInteger(slice[side]) || slice[side] < 0) return null;
		result[side] = slice[side];
	}
	if (!['stretch', 'round'].includes(slice.mode)) return null;
	if (result.left + result.right >= assetWidth || result.top + result.bottom >= assetHeight) return null;
	if (!result.left && !result.right && !result.top && !result.bottom) return null;
	result.mode = slice.mode;
	return result;
}

function scaleSliceInsets(slice, baseWidth, baseHeight, srcWidth, srcHeight) {
	if (!slice || !(baseWidth > 0) || !(baseHeight > 0) || !(srcWidth > 0) || !(srcHeight > 0)) return null;
	return {
		top: slice.top * srcHeight / baseHeight,
		right: slice.right * srcWidth / baseWidth,
		bottom: slice.bottom * srcHeight / baseHeight,
		left: slice.left * srcWidth / baseWidth,
		mode: slice.mode
	};
}

function getSliceScale(slice, { scaleX = 1, scaleY = 1, fixedScale, pixelated = false, boxWidth, boxHeight }) {
	const x = slice.left + slice.right;
	const y = slice.top + slice.bottom;
	let scale = fixedScale === undefined ? (x && y ? Math.min(Math.abs(scaleX), Math.abs(scaleY)) : x ? Math.abs(scaleY) : Math.abs(scaleX)) : fixedScale;
	if (!Number.isFinite(scale) || scale < 0) scale = 0;
	if (pixelated && scale >= 1) scale = Math.floor(scale);
	if (x && Number.isFinite(boxWidth)) scale = Math.min(scale, Math.max(0, boxWidth) / x);
	if (y && Number.isFinite(boxHeight)) scale = Math.min(scale, Math.max(0, boxHeight) / y);
	return scale;
}

function getSliceRects(slice, srcWidth, srcHeight, boxWidth, boxHeight, scale, { pixelated = false } = {}) {
	if (!slice || !(srcWidth > 0) || !(srcHeight > 0) || !(boxWidth > 0) || !(boxHeight > 0)) return [];
	scale = getSliceScale(slice, { fixedScale: scale, pixelated, boxWidth, boxHeight });
	const sx = [0, slice.left, srcWidth - slice.right, srcWidth];
	const sy = [0, slice.top, srcHeight - slice.bottom, srcHeight];
	const boundaries = (size, start, end) => {
		const first = Math.min(size, Math.max(0, Math.round(start * scale)));
		return [0, first, Math.max(first, Math.min(size, Math.round(size - end * scale))), size];
	};
	const dx = boundaries(boxWidth, slice.left, slice.right);
	const dy = boundaries(boxHeight, slice.top, slice.bottom);
	const cells = [];
	for (let row = 0; row < 3; row++) {
		for (let col = 0; col < 3; col++) {
			const sw = sx[col + 1] - sx[col], sh = sy[row + 1] - sy[row];
			const dw = dx[col + 1] - dx[col], dh = dy[row + 1] - dy[row];
			if (!(sw > 0 && sh > 0 && dw > 0 && dh > 0)) continue;
			const round = slice.mode === 'round' && scale > 0;
			cells.push({ sx: sx[col], sy: sy[row], sw, sh, dx: dx[col], dy: dy[row], dw, dh,
				nx: round && col === 1 && (slice.left || slice.right) ? Math.max(1, Math.round(dw / (sw * scale))) : 1,
				ny: round && row === 1 && (slice.top || slice.bottom) ? Math.max(1, Math.round(dh / (sh * scale))) : 1 });
		}
	}
	const maxTiles = CONFIG.tools.nineSlice.maxTiles;
	let count = cells.reduce((sum, cell) => sum + cell.nx * cell.ny, 0);
	if (count > maxTiles) {
		const factor = Math.sqrt(maxTiles / count);
		for (const cell of cells) {
			cell.nx = Math.max(1, Math.floor(cell.nx * factor));
			cell.ny = Math.max(1, Math.floor(cell.ny * factor));
		}
		count = cells.reduce((sum, cell) => sum + cell.nx * cell.ny, 0);
	}
	while (count > maxTiles) {
		const cell = cells.reduce((largest, current) => current.nx * current.ny > largest.nx * largest.ny ? current : largest);
		if (cell.nx >= cell.ny && cell.nx > 1) cell.nx--;
		else if (cell.ny > 1) cell.ny--;
		else break;
		count = cells.reduce((sum, current) => sum + current.nx * current.ny, 0);
	}
	const rects = [];
	for (const cell of cells) {
		for (let y = 0; y < cell.ny; y++) {
			for (let x = 0; x < cell.nx; x++) {
				const left = cell.dx + Math.round(cell.dw * x / cell.nx);
				const top = cell.dy + Math.round(cell.dh * y / cell.ny);
				const right = x + 1 === cell.nx ? cell.dx + cell.dw : cell.dx + Math.round(cell.dw * (x + 1) / cell.nx);
				const bottom = y + 1 === cell.ny ? cell.dy + cell.dh : cell.dy + Math.round(cell.dh * (y + 1) / cell.ny);
				if (right > left && bottom > top) rects.push({ sx: cell.sx, sy: cell.sy, sw: cell.sw, sh: cell.sh, dx: left, dy: top, dw: right - left, dh: bottom - top });
			}
		}
	}
	return rects;
}

function drawSlicedImage(ctx, image, rects) {
	for (const rect of rects) ctx.drawImage(image, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
}

function sliceSpanStyle(rect, srcWidth, srcHeight) {
	const scaleX = rect.dw / rect.sw, scaleY = rect.dh / rect.sh;
	return {
		left: `${rect.dx}px`, top: `${rect.dy}px`, width: `${rect.dw}px`, height: `${rect.dh}px`,
		backgroundSize: `${srcWidth * scaleX}px ${srcHeight * scaleY}px`,
		backgroundPosition: `${-rect.sx * scaleX}px ${-rect.sy * scaleY}px`
	};
}

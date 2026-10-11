'use strict';

// All generators paint one periodic cell. Preview and export reuse its pixels.
function drawPatternPixels(ctx, size, pattern, coverage) {
	const image = ctx.getImageData(0, 0, size, size);
	const color = parseHexColor(pattern.color);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const alpha = coverage((x + 0.5) / size, (y + 0.5) / size, pattern);
			if (!alpha) continue;
			const i = (y * size + x) * 4;
			const oldAlpha = image.data[i + 3] / 255;
			const nextAlpha = alpha + oldAlpha * (1 - alpha);
			for (let c = 0; c < 3; c++) image.data[i + c] = (color[c] * alpha + image.data[i + c] * oldAlpha * (1 - alpha)) / nextAlpha;
			image.data[i + 3] = nextAlpha * 255;
		}
	}
	ctx.putImageData(image, 0, 0);
}

const PATTERN_TYPES = Object.freeze(Object.fromEntries([
	{ id: 'checker', baseTile: 32, fields: [], coverage: (x, y) => (x < 0.5) === (y < 0.5) ? 1 : 0 },
	{ id: 'gingham', baseTile: 32, fields: [], coverage: (x, y) => 1 - (x < 0.5 ? 0.5 : 1) * (y < 0.5 ? 0.5 : 1) },
	{ id: 'grid', baseTile: 32, fields: ['thickness'], coverage: (x, y, p) => x < p.thickness / 100 || y < p.thickness / 100 ? 1 : 0 },
	{ id: 'brick', baseTile: 48, fields: ['thickness'], coverage: (x, y, p) => {
		const shifted = (x + (y < 0.5 ? 0 : 0.5)) % 1;
		return y % 0.5 < p.thickness / 200 || shifted < p.thickness / 100 ? 1 : 0;
	} },
	{ id: 'stripes', baseTile: 32, fields: ['thickness', 'direction'], coverage: (x, y, p) => {
		const position = { horizontal: y, vertical: x, 'diagonal-up': x + y, 'diagonal-down': x - y + 1 }[p.direction];
		return position % 1 < p.thickness / 100 ? 1 : 0;
	} },
	{ id: 'zigzag', baseTile: 32, fields: ['thickness'], coverage: (x, y, p) => ((y - Math.abs(x * 2 - 1) / 2 + 1) % 1) < p.thickness / 100 ? 1 : 0 },
	{ id: 'motif', baseTile: 48, fields: ['shapeId', 'shapeSize', 'rotation', 'stagger'], draw(ctx, size, p) {
		const cell = p.stagger ? size / 2 : size;
		for (let row = -2; row <= 3; row++) {
			for (let column = -2; column <= 3; column++) {
				ctx.save();
				ctx.translate((column + 0.5 + (p.stagger && row % 2 ? 0.5 : 0)) * cell, (row + 0.5) * cell);
				ctx.rotate(p.rotation * Math.PI / 180);
				ShapeLibrary.trace(p.shapeId, ctx, cell * p.shapeSize / 200, cell * p.shapeSize / 200);
				ctx.restore();
			}
		}
	} }
].map((type) => {
	const label = getOptions('patternType').find((option) => option.value === type.id).label;
	return [type.id, Object.freeze({ ...type, label, fields: Object.freeze(type.fields), draw: type.draw || ((ctx, size, p) => drawPatternPixels(ctx, size, p, type.coverage)) })];
})));

function normalizeEffectPattern(value) {
	const data = value && typeof value === 'object' ? value : {};
	const defaults = CONFIG.rendering.pattern;
	const result = {};
	['type', 'direction', 'scroll'].forEach((key) => {
		const list = { type: 'patternType', direction: 'patternDirection', scroll: 'patternScroll' }[key];
		result[key] = isOptionValue(list, data[key]) ? data[key] : defaults[key];
	});
	['color', 'backgroundColor'].forEach((key) => { result[key] = /^#[0-9a-f]{6}$/i.test(data[key]) ? data[key].toLowerCase() : defaults[key]; });
	['transparentBackground', 'stagger'].forEach((key) => { result[key] = typeof data[key] === 'boolean' ? data[key] : defaults[key]; });
	result.shapeId = ShapeLibrary.FILL_SHAPES.some((shape) => shape.id === data.shapeId) ? data.shapeId : CONFIG.tools.shapes.defaultShapeId;
	Object.entries({ thickness: 'patternThickness', shapeSize: 'patternShapeSize', rotation: 'patternRotation', scrollCycleMs: 'patternScrollCycle' }).forEach(([key, field]) => {
		const spec = FIELDS[field];
		const number = data[key] == null ? NaN : Number(data[key]);
		result[key] = Number.isFinite(number) ? Math.min(spec.max, Math.max(spec.min, number)) : spec.value;
	});
	return result;
}

function getPatternTileSize(pattern, scalePercent) {
	const data = normalizeEffectPattern(pattern);
	const scale = Number.isFinite(Number(scalePercent)) ? Number(scalePercent) : FIELDS.textureScale.value;
	return Math.max(2, Math.min(CONFIG.rendering.pattern.maxTilePx, Math.round(PATTERN_TYPES[data.type].baseTile * scale / 100)));
}

const PATTERN_TILE_CACHE = new ByteBudgetCache({ id: 'pattern-tiles', label: 'Pattern tiles', measure: (tile) => canvasBytes(tile.canvas) + tile.url.length * 2 });

function getPatternTile(pattern, scalePercent) {
	const data = normalizeEffectPattern(pattern);
	const type = PATTERN_TYPES[data.type];
	const size = getPatternTileSize(data, scalePercent);
	const key = JSON.stringify([data.type, data.color, data.backgroundColor, data.transparentBackground, size, ...type.fields.map((field) => data[field]), CONFIG.rendering.crispMaskEdges]);
	const cached = PATTERN_TILE_CACHE.get(key);
	if (cached) return cached;
	const canvas = createAppCanvas(size, size, 'paint/pattern-source');
	const ctx = canvas.getContext('2d');
	if (!data.transparentBackground) {
		ctx.fillStyle = data.backgroundColor;
		ctx.fillRect(0, 0, size, size);
	}
	ctx.fillStyle = data.color;
	type.draw(ctx, size, data);
	if (data.transparentBackground && CONFIG.rendering.crispMaskEdges) binarizeCanvasAlpha(ctx);
	const tile = { canvas, url: canvas.toDataURL(), size };
	PATTERN_TILE_CACHE.set(key, tile);
	return tile;
}

function describeEffectPattern(pattern) {
	return PATTERN_TYPES[normalizeEffectPattern(pattern).type].label;
}

function getPatternScrollOffset(pattern, tileSize, timeMs, periodMs) {
	const data = normalizeEffectPattern(pattern);
	const direction = getOptions('patternScroll').find((option) => option.value === data.scroll);
	const period = periodMs || data.scrollCycleMs;
	const phase = ((timeMs % period) + period) % period / period;
	const distance = Math.floor(phase * tileSize);
	return { x: distance * direction.x, y: distance * direction.y };
}

function getPatternTextureOrigin(maskCanvas, source, layer, options) {
	const origin = getSlotTexturePatternOrigin(maskCanvas, source, layer, options);
	return { x: Math.round(origin.x), y: Math.round(origin.y) };
}

function applyPatternTileStyle(element, pattern, scale) {
	const tile = getPatternTile(pattern, scale);
	element.style.backgroundImage = `url(${tile.url})`;
	element.style.backgroundSize = `${tile.size}px ${tile.size}px`;
	element.style.backgroundRepeat = 'repeat';
	return tile;
}

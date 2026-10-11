'use strict';

// All generators paint one periodic cell. Preview and export reuse its pixels.
function drawPatternPixels(ctx, size, pattern, coverage) {
	const image = ctx.getImageData(0, 0, size, size);
	const color = parseHexColor(pattern.color);
	const samples = shouldUseCrispMaskEdges() ? 1 : CONFIG.rendering.pattern.edgeSamples;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			let alpha = 0;
			for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
				alpha += coverage((x + (sx + 0.5) / samples) / size, (y + (sy + 0.5) / samples) / size, pattern) / (samples * samples);
			}
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
	{ id: 'motif', baseTile: 48, fields: ['shapeId', 'shapeSize', 'rotation', 'spacing', 'tileType', 'brickOffset', 'overlap'], draw(ctx, size, p) {
		const geometry = getPatternMotifGeometry(size, p);
		const { columns, rows, width, height } = geometry;
		const cellX = width / columns, cellY = height / rows;
		const half = size / (p.tileType === 'grid' ? 1 : 2) / (1 + p.spacing / 100) * p.shapeSize / 200;
		const cells = [];
		for (let row = -4; row <= rows + 4; row++) for (let column = -4; column <= columns + 4; column++) cells.push({ row, column });
		cells.sort((a, b) => {
			const columnFirst = p.overlap.startsWith('column');
			const order = columnFirst ? a.column - b.column || a.row - b.row : a.row - b.row || a.column - b.column;
			return p.overlap.endsWith('reverse') ? -order : order;
		});
		const offset = p.tileType.startsWith('hex') ? 0.5 : Number(p.brickOffset);
		for (const { row, column } of cells) {
			const shiftX = p.tileType.endsWith('row') ? ((row * offset) % 1 + 1) % 1 : 0;
			const shiftY = p.tileType.endsWith('column') ? ((column * offset) % 1 + 1) % 1 : 0;
			ctx.save();
			ctx.translate((column + 0.5 + shiftX) * cellX, (row + 0.5 + shiftY) * cellY);
			ctx.rotate(p.rotation * Math.PI / 180);
			ShapeLibrary.trace(p.shapeId, ctx, half, half);
			ctx.restore();
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
	['type', 'direction', 'scroll', 'tileType', 'brickOffset', 'overlap'].forEach((key) => {
		const list = { type: 'patternType', direction: 'patternDirection', scroll: 'patternScroll', tileType: 'patternTileType', brickOffset: 'patternBrickOffset', overlap: 'patternOverlap' }[key];
		result[key] = isOptionValue(list, data[key]) ? data[key] : defaults[key];
	});
	['color', 'backgroundColor'].forEach((key) => { result[key] = /^#[0-9a-f]{6}$/i.test(data[key]) ? data[key].toLowerCase() : defaults[key]; });
	['transparentBackground', 'stagger'].forEach((key) => { result[key] = typeof data[key] === 'boolean' ? data[key] : defaults[key]; });
	if (!data.tileType && typeof data.stagger === 'boolean') result.tileType = data.stagger ? 'brick-row' : 'grid';
	result.shapeId = ShapeLibrary.FILL_SHAPES.some((shape) => shape.id === data.shapeId) ? data.shapeId : CONFIG.tools.shapes.defaultShapeId;
	Object.entries({ thickness: 'patternThickness', shapeSize: 'patternShapeSize', rotation: 'patternRotation', spacing: 'patternSpacing', scrollCycleMs: 'patternScrollCycle' }).forEach(([key, field]) => {
		const spec = FIELDS[field];
		const number = data[key] == null ? NaN : Number(data[key]);
		result[key] = Number.isFinite(number) ? Math.min(spec.max, Math.max(spec.min, number)) : spec.value;
	});
	return result;
}

function getPatternTileSize(pattern, scalePercent) {
	const data = normalizeEffectPattern(pattern);
	const scale = Number.isFinite(Number(scalePercent)) ? Number(scalePercent) : FIELDS.textureScale.value;
	return Math.max(2, Math.min(CONFIG.rendering.pattern.maxTilePx, Math.round(PATTERN_TYPES[data.type].baseTile * scale / 100 * (data.type === 'motif' ? 1 + data.spacing / 100 : 1))));
}

function getPatternMotifGeometry(size, p) {
	const count = p.tileType.startsWith('hex') ? 2 : Number(p.brickOffset) === 0.5 ? 2 : [0.25, 0.75].includes(Number(p.brickOffset)) ? 4 : 3;
	const columns = p.tileType.endsWith('column') ? count : p.tileType === 'grid' ? 1 : 2;
	const rows = p.tileType.endsWith('row') ? count : p.tileType === 'grid' ? 1 : 2;
	const cell = size / (p.tileType === 'grid' ? 1 : 2);
	return { columns, rows, width: Math.max(2, Math.round(columns * cell * (p.tileType === 'hex-column' ? Math.sqrt(3) / 2 : 1))), height: Math.max(2, Math.round(rows * cell * (p.tileType === 'hex-row' ? Math.sqrt(3) / 2 : 1))) };
}

const PATTERN_TILE_CACHE = new ByteBudgetCache({ id: 'pattern-tiles', label: 'Pattern tiles', measure: (tile) => canvasBytes(tile.canvas) + tile.url.length * 2 });

function getPatternTile(pattern, scalePercent) {
	const data = normalizeEffectPattern(pattern);
	const type = PATTERN_TYPES[data.type];
	const size = getPatternTileSize(data, scalePercent);
	const key = JSON.stringify([data.type, data.color, data.backgroundColor, data.transparentBackground, size, ...type.fields.map((field) => data[field]), shouldUseCrispMaskEdges()]);
	const cached = PATTERN_TILE_CACHE.get(key);
	if (cached) return cached;
	const dimensions = data.type === 'motif' ? getPatternMotifGeometry(size, data) : { width: size, height: size };
	const canvas = createAppCanvas(dimensions.width, dimensions.height, 'paint/pattern-source');
	const ctx = canvas.getContext('2d');
	if (!data.transparentBackground) {
		ctx.fillStyle = data.backgroundColor;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
	}
	ctx.fillStyle = data.color;
	if (data.type === 'motif') {
		const foreground = createAppCanvas(canvas.width, canvas.height, 'paint/pattern-motif');
		const paint = foreground.getContext('2d');
		paint.fillStyle = data.color;
		type.draw(paint, size, data);
		if (shouldUseCrispMaskEdges()) binarizeCanvasAlpha(paint);
		ctx.drawImage(foreground, 0, 0);
	} else {
		type.draw(ctx, size, data);
		if (data.transparentBackground && shouldUseCrispMaskEdges()) binarizeCanvasAlpha(ctx);
	}
	const tile = { canvas, url: canvas.toDataURL(), size, width: canvas.width, height: canvas.height };
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
	const width = typeof tileSize === 'number' ? tileSize : tileSize.width;
	const height = typeof tileSize === 'number' ? tileSize : tileSize.height;
	return { x: Math.floor(phase * width) * direction.x, y: Math.floor(phase * height) * direction.y };
}

function getPatternTextureOrigin(maskCanvas, source, layer, options) {
	const origin = getSlotTexturePatternOrigin(maskCanvas, source, layer, options);
	return { x: Math.round(origin.x), y: Math.round(origin.y) };
}

function applyPatternTileStyle(element, pattern, scale) {
	const tile = getPatternTile(pattern, scale);
	element.style.backgroundImage = `url(${tile.url})`;
	element.style.backgroundSize = `${tile.width}px ${tile.height}px`;
	element.style.backgroundRepeat = 'repeat';
	return tile;
}

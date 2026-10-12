'use strict';

const { chromium } = require('playwright');

(async () => {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		await page.goto(process.env.GLITTER_URL || 'http://localhost/glitter/');
		await page.waitForFunction(() => window.editor);
		const result = await page.evaluate(async () => {
			const assert = (value, message) => { if (!value) throw Error(message); };
			const fields = { thickness: 'patternThickness', shapeSize: 'patternShapeSize', rotation: 'patternRotation', spacing: 'patternSpacing', scrollCycleMs: 'patternScrollCycle' };
			const defaults = normalizeEffectPattern(null);
			const bad = normalizeEffectPattern({ type: 'bad', direction: 'bad', scroll: 'bad', color: 'red', backgroundColor: '#fff', shapeId: 'bad', thickness: -10, shapeSize: 999, rotation: Infinity, scrollCycleMs: NaN });
			assert(bad.type === defaults.type && bad.color === defaults.color && bad.backgroundColor === defaults.backgroundColor, 'Invalid identifiers and colors must fall back');
			assert(bad.thickness === FIELDS.patternThickness.min && bad.shapeSize === FIELDS.patternShapeSize.max && bad.rotation === defaults.rotation, 'Invalid numbers must clamp or fall back');
			for (const type of Object.values(PATTERN_TYPES)) {
				assert(normalizeEffectPattern({ type: type.id }).type === type.id, `${type.id} did not normalize`);
				for (const field of type.fields) assert(fields[field] || getOptions(`pattern${field.charAt(0).toUpperCase()}${field.slice(1)}`).length || ['shapeId'].includes(field), `Undeclared ${field}`);
				const pattern = normalizeEffectPattern({ type: type.id, transparentBackground: true, rotation: 45, shapeSize: 100 });
				const tile = getPatternTile(pattern, 100);
				assert(tile === getPatternTile({ ...pattern, scroll: 'right', scrollCycleMs: 1000 }, 100), 'Scroll must not regenerate tiles');
				assert(tile === getPatternTile(structuredClone(pattern), 100), 'Equal values must reuse tiles');
				assert(getPatternTileSize(pattern, -1) === 2 && getPatternTileSize(pattern, 1e9) === CONFIG.rendering.pattern.maxTilePx, 'Tile bounds failed');
				const pixels = tile.canvas.getContext('2d').getImageData(0, 0, tile.size, tile.size).data;
				assert(pixels.some((value, i) => i % 4 === 3 && value === 255), `${type.id} is empty`);
				assert(pixels.every((value, i) => i % 4 !== 3 || value === 0 || value === 255), `${type.id} has alpha fringes`);
				// Motifs crossing a cell edge must match an unclipped neighboring cell.
				if (type.id === 'motif') {
					const canvas = createAppCanvas(tile.size * 2, tile.size, 'tests/pattern-seams');
					const ctx = canvas.getContext('2d');
					ctx.fillStyle = pattern.color;
					type.draw(ctx, tile.size, pattern);
					binarizeCanvasAlpha(ctx);
					const left = ctx.getImageData(0, 0, tile.size, tile.size).data;
					const right = ctx.getImageData(tile.size, 0, tile.size, tile.size).data;
					assert(left.every((v, i) => i % 4 === 3 ? v === right[i] : Math.abs(v - right[i]) <= 2), `Staggered rotated motifs fail to wrap at ${left.findIndex((v, i) => v !== right[i])}: ${left[left.findIndex((v, i) => v !== right[i])]} vs ${right[left.findIndex((v, i) => v !== right[i])]}`);
				}
				// Pixel generators partition an exact integer period, including odd sizes.
				for (const scale of [37, 100, 137]) {
					const cell = getPatternTile(pattern, scale);
					const canvas = createAppCanvas(cell.size * 2, cell.size * 2, 'tests/pattern-period');
					const ctx = canvas.getContext('2d');
					ctx.fillStyle = ctx.createPattern(cell.canvas, 'repeat');
					ctx.fillRect(0, 0, canvas.width, canvas.height);
					const first = ctx.getImageData(0, 0, cell.size, cell.size).data;
					const diagonal = ctx.getImageData(cell.size, cell.size, cell.size, cell.size).data;
					assert(first.every((v, i) => v === diagonal[i]), `${type.id} has a discontinuous period`);
				}
			}
			for (const type of ['grid', 'brick', 'stripes', 'zigzag']) {
				assert(normalizeEffectPattern({ type, thickness: 8 }).spacing === 92, `${type} legacy gap must be preserved when spacing is missing`);
				const directions = type === 'stripes' ? getOptions('patternDirection').map(option => option.value) : ['horizontal'];
				for (const direction of directions) for (const thickness of [1, 8, 25, 50, 99]) for (const scale of [37, 100, 137]) for (const crisp of [true, false]) {
					PREFERENCES.set('crispMaskEdges', crisp);
					for (const transparentBackground of [true, false]) {
						const tile = getPatternTile({ type, direction, thickness, spacing: 0, transparentBackground, color: '#000000', backgroundColor: '#ffffff' }, scale);
						const pixels = tile.canvas.getContext('2d').getImageData(0, 0, tile.width, tile.height).data;
						assert(pixels.every((v, i) => v === (i % 4 === 3 ? 255 : 0)), `${type}/${direction} at thickness ${thickness}, scale ${scale}, crisp ${crisp} has a gap at 0%`);
					}
				}
				PREFERENCES.set('crispMaskEdges', true);
				const pattern = { type, direction: 'horizontal', thickness: 25, transparentBackground: true };
				const original = getPatternTile(pattern, 100);
				for (const spacing of [75, 100, 200]) {
					const spaced = getPatternTile({ ...pattern, spacing }, 100);
					assert(spaced.size === PATTERN_TYPES[type].baseTile * (pattern.thickness + spacing) / 100, `${type} repeat distance must equal line thickness plus gap`);
					const linePixels = (tile) => {
						const pixels = tile.canvas.getContext('2d').getImageData(tile.width - 1, 0, 1, tile.height).data;
						return pixels.filter((v, i) => i % 4 === 3 && v === 255).length;
					};
					assert(linePixels(spaced) === linePixels(original), `${type} spacing must preserve line thickness`);
					assert(spaced === getPatternTile({ ...pattern, spacing }, 100), `${type} spaced tile must be cached`);
				}
			}
			for (const type of ['stripes', 'zigzag']) {
				for (const direction of getOptions('patternDirection').map(option => option.value)) for (const spacing of [25, 50, 75, 100, 125, 200]) {
					const tile = getPatternTile({ type, direction, thickness: 25, spacing, transparentBackground: true }, 100);
					const pixels = tile.canvas.getContext('2d').getImageData(0, 0, tile.width, tile.height).data;
					for (let column = 0; column < tile.width; column++) {
						let stroke = 0;
						for (let row = 0; row < tile.height; row++) {
							const index = type === 'stripes' && direction === 'vertical' ? column * tile.width + row : row * tile.width + column;
							if (pixels[index * 4 + 3] === 255) stroke++;
						}
						assert(stroke === 8, `${type}/${direction} at spacing ${spacing}, column ${column} changed the 8px stroke to ${stroke}px`);
					}
				}
			}
			for (const option of getOptions('patternScroll')) {
				const pattern = { scroll: option.value };
				assert(JSON.stringify(getPatternScrollOffset(pattern, 31, 0)) === JSON.stringify(getPatternScrollOffset(pattern, 31, defaults.scrollCycleMs)), 'Scroll loop does not close');
				for (const time of [1, 100, 999, 1999, -1]) {
					const offset = getPatternScrollOffset(pattern, 31, time);
					assert(Number.isInteger(offset.x) && Number.isInteger(offset.y), 'Scroll must land on whole pixels');
				}
			}
			assert(normalizeEffectPattern({ stagger: false }).tileType === 'grid', 'Legacy grid motif changed');
			const motif = { type: 'motif', shapeId: 'circle', rotation: 17, shapeSize: 73, transparentBackground: true };
			PREFERENCES.set('crispMaskEdges', true);
			const crisp = getPatternTile(motif, 100);
			PREFERENCES.set('crispMaskEdges', false);
			const smooth = getPatternTile(motif, 100);
			assert(crisp !== smooth, 'Edge preference must invalidate the tile cache');
			const pixels = smooth.canvas.getContext('2d').getImageData(0, 0, smooth.width, smooth.height).data;
			assert(pixels.some((v, i) => i % 4 === 3 && v > 0 && v < 255), 'Smooth motifs must retain antialiasing');
			PREFERENCES.set('crispMaskEdges', true);
			const opaque = getPatternTile({ ...motif, transparentBackground: false, color: '#000000', backgroundColor: '#ffffff' }, 100);
			assert(opaque.canvas.getContext('2d').getImageData(0, 0, opaque.width, opaque.height).data.every((v, i) => i % 4 === 3 || v === 0 || v === 255), 'Opaque motifs must also respect crisp edges');
			await editor.loadBlankImage(200, 160, '#ffffff');
			let shape = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 100, height: 80 });
			editor.layerManager.insertLayer(shape);
			editor.layerManager.restoreSelectionState(shape.id);
			editor.saveState('Pattern fixture');
			const source = document.querySelector('#shapeFillSection select[aria-label="Fill source"]');
			assert(source.options.length === 6, 'Fill source must expose all six modes in its dropdown');
			source.value = 'pattern'; source.dispatchEvent(new Event('change', { bubbles: true }));
			assert(shape.shapeData.fill.mode === 'pattern', 'Pattern source control did not apply');
			const type = document.getElementById('shapeFillPatternType');
			const spacing = document.getElementById('shapeFillPatternSpacing');
			for (const value of ['grid', 'brick', 'stripes', 'zigzag']) {
				type.value = value; type.dispatchEvent(new Event('change', { bubbles: true }));
				assert(!spacing.closest('.property-row').hidden, `${value} spacing control is hidden`);
				assert(shape.shapeData.fill.pattern.spacing === 50 && spacing.value === '50', `${value} must initialize its original gap`);
				assert(document.getElementById('resetShapeFillPatternSpacing').disabled, `${value} initial gap must be the reset default`);
			}
			const spacingHistory = editor.historyManager.history.length;
			spacing.value = '100'; spacing.dispatchEvent(new Event('input', { bubbles: true }));
			spacing.dispatchEvent(new Event('change', { bubbles: true }));
			await new Promise(resolve => setTimeout(resolve, 100));
			assert(shape.shapeData.fill.pattern.spacing === 100 && editor.historyManager.history.length === spacingHistory + 1, 'Line spacing must apply with one undo step');
			await editor.historyManager.undo();
			assert(editor.layers.find(layer => layer.id === shape.id).shapeData.fill.pattern.spacing === 50, 'Undo must restore line spacing');
			await editor.historyManager.redo();
			assert(editor.layers.find(layer => layer.id === shape.id).shapeData.fill.pattern.spacing === 100, 'Redo must restore line spacing');
			await editor.historyManager.undo();
			spacing.value = '0'; spacing.dispatchEvent(new Event('input', { bubbles: true })); spacing.dispatchEvent(new Event('change', { bubbles: true }));
			await new Promise(resolve => setTimeout(resolve, 100));
			assert(editor.layers.find(layer => layer.id === shape.id).shapeData.fill.pattern.spacing === 0, 'Explicit zero gap must remain available');
			document.getElementById('resetShapeFillPatternSpacing').click();
			await new Promise(resolve => setTimeout(resolve, 100));
			assert(editor.layers.find(layer => layer.id === shape.id).shapeData.fill.pattern.spacing === 50, 'Spacing reset must restore the original line gap');
			const patternPresets = document.querySelector('[data-pattern-editor="shapeFill"] [data-pattern-presets]');
			for (const id of ['scanlines', 'userbar-lines', 'stripes', 'zigzag']) {
				const entry = PATTERN_PRESETS.entries.find(entry => entry.id === id);
				patternPresets._choosePattern(entry);
				const expected = normalizeEffectPattern(entry.value);
				assert(spacing.value === String(expected.spacing) && document.getElementById('shapeFillPatternThickness').value === String(expected.thickness), `${id} sliders must show the applied preset values`);
				assert(document.getElementById('shapeFillPatternSpacingValue').textContent === `${expected.spacing}%`, `${id} spacing readout is stale`);
				assert(document.getElementById('resetShapeFillPatternSpacing').disabled, `${id} must use its original gap as the reset default`);
			}
			type.value = 'checker'; type.dispatchEvent(new Event('change', { bubbles: true }));
			assert(spacing.closest('.property-row').hidden, 'Checker must hide unused spacing');
			shape = editor.layers.find(layer => layer.id === shape.id);
			type.value = 'motif'; type.dispatchEvent(new Event('change', { bubbles: true }));
			assert(shape.shapeData.fill.pattern.type === 'motif', 'Declared type select did not apply');
			assert(shape.shapeData.fill.pattern.spacing === 0 && spacing.value === '0', 'Motif must initialize its original spacing');
			assert(!document.getElementById('shapeFillPatternShapeSize').closest('.property-row').hidden, 'Motif row is hidden');
			assert(document.getElementById('shapeFillPatternThickness').closest('.property-row').hidden, 'Unused row leaked');
			const color = document.getElementById('shapeFillPatternColor');
			const colorHistory = editor.historyManager.history.length;
			for (const value of ['#112233', '#445566', '#778899']) { color.value = value; color.dispatchEvent(new Event('input', { bubbles: true })); }
			color.dispatchEvent(new Event('change', { bubbles: true }));
			await new Promise(resolve => requestAnimationFrame(resolve));
			assert(shape.shapeData.fill.pattern.color === '#778899' && editor.historyManager.history.length === colorHistory + 1, 'Color picker must flush its newest color and commit once');
			const scroll = document.getElementById('shapeFillPatternScroll');
			scroll.value = 'right'; scroll.dispatchEvent(new Event('change', { bubbles: true }));
			const procedural = editor.sceneCompositor._collectProceduralSources([shape]);
			assert(procedural.length === 1 && procedural[0].naturalPeriod === defaults.scrollCycleMs, 'Pattern scroll is absent from the timeline');
			assert(procedural[0].sampleAt(1000, 4000).time === 500, 'Fitted pattern clock did not map to its own cycle');
			shape.locked = true;
			assert(editor.sceneCompositor._collectProceduralSources([shape])[0].setPeriod === null, 'Locked pattern cycle can be refitted');
			shape.locked = false;
			const before = editor.historyManager.history.length;
			const size = document.getElementById('shapeFillPatternShapeSize');
			size.value = '75'; size.dispatchEvent(new Event('input', { bubbles: true }));
			size.value = '80'; size.dispatchEvent(new Event('input', { bubbles: true }));
			size.dispatchEvent(new Event('change', { bubbles: true }));
			await new Promise(resolve => setTimeout(resolve, 100));
			assert(shape.shapeData.fill.pattern.shapeSize === 80, 'Declared pattern slider did not apply');
			assert(editor.historyManager.history.length === before + 1, 'Slider drag must create one undo step');
			await editor.historyManager.undo();
			assert(editor.layers.find(layer => layer.id === shape.id).shapeData.fill.pattern.shapeSize === 60, 'Undo did not restore the pattern');
			await editor.historyManager.redo();
			assert(editor.layers.find(layer => layer.id === shape.id).shapeData.fill.pattern.shapeSize === 80, 'Redo did not restore the pattern');
			const saved = await editor.projectSerializer.serialize();
			editor.isSaved = true;
			await editor.projectSerializer.load(saved);
			assert(editor.layers.find(layer => layer.id === shape.id).shapeData.fill.pattern.scroll === 'right', 'Pattern did not survive reopen');
			const base = editor.layerManager.getBaseLayer();
			editor.layerManager.restoreSelectionState(base.id);
			document.getElementById('baseBackgroundPattern').click();
			const baseType = document.getElementById('baseBackgroundPatternType');
			baseType.value = 'grid'; baseType.dispatchEvent(new Event('change', { bubbles: true }));
			const thickness = document.getElementById('baseBackgroundPatternThickness');
			thickness.value = '10'; thickness.dispatchEvent(new Event('input', { bubbles: true })); thickness.dispatchEvent(new Event('change', { bubbles: true }));
			await new Promise(resolve => setTimeout(resolve, 100));
			assert(base.background.pattern.thickness === 10 && base.background.pattern.type === 'grid', 'Canvas pattern controls did not apply');
			const layers = [base, ...editor.layers.filter(layer => layer !== base), editor.textGlitterManager.createLayer({ text: 'Pattern' }), editor.pathLayerManager.createLayer(), editor.glitterManager.createLayer(), editor.frameLayerManager.createLayer()];
			let count = 0;
			for (const layer of layers) {
				for (const definition of LAYER_UI_CONFIG[layer.type].paintSlots) {
					if (!definition.modes.includes('pattern')) continue;
					let data = readFieldPath(layer, definition.pathKeys);
					if (!data) data = getLayerManagerForType(editor, layer.type).fieldHost.ensureSlot(layer, definition.key);
					data.mode = 'pattern';
					const entry = getLayerPaintSlots(layer).find(entry => entry.key === definition.key);
					assert(resolvePaintSlotSource(layer, entry).mode === 'pattern', `${layer.type}.${definition.key} cannot resolve Pattern`);
					count++;
				}
			}
			assert(count >= 20, 'Not enough layer slots were covered');
			return `${Object.keys(PATTERN_TYPES).length} types, zero-gap endpoints, independent thickness, cache, alpha, seams and ${getOptions('patternScroll').length} scroll directions`;
		});
		console.log(`PASS pattern source: ${result}`);
	} finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });

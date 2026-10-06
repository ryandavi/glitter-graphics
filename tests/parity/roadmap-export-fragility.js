'use strict';

// The export fragility routine (CONTRIBUTING.md) over the effects the feature
// roadmap added: sticker outline, bevel, glow spread, Sparkles and Kira Kira
// slots, text warp, a pinned frame, the whole-picture Sparkles layer, and CSS
// and pixel filter looks. Back-to-back exports and edit -> undo -> export must
// be byte-identical, matte and transparent.

const { chromium } = require('playwright');
const { assertByteIdentity, exportSnapshot } = require('./export-harness');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';
const MIN_LAYERS = 8;

async function openEditor(page) {
	await page.goto(APP_URL, { waitUntil: 'networkidle' });
	await page.evaluate(() => {
		document.querySelectorAll('.modal-overlay.visible').forEach((node) => node.classList.remove('visible'));
	});
	await page.evaluate(() => window.editor.loadBlankImage(320, 240, '#ffffff'));
	await page.waitForFunction(() => Boolean(window.editor?.originalImage) && window.editor.originalCanvas?.width === 320);
}

async function buildComposition(page) {
	return page.evaluate(async () => {
		const editor = window.editor;
		const insert = (layer) => {
			if (!layer) throw new Error('A layer could not be created');
			editor.layerManager.insertLayer(layer);
			return layer;
		};
		// A style preset applied the way the Style grid applies it.
		const applyStyle = (manager, layer, presetId) => {
			const entry = STYLE_PRESETS[layer.type].get(presetId);
			if (!entry) throw new Error(`Missing ${layer.type} style preset ${presetId}`);
			STYLE_PRESETS[layer.type].apply(entry, {
				layer,
				context: {
					getSlotDefaults: (key) => manager.fieldHost.getSlotDefaults(key),
					glitterAvailable: (glitterId) => Boolean(editor.glitterLibrary.getItemById(glitterId)),
					onSlotDisabled: () => {}
				}
			});
		};
		const addSparkles = (manager, layer, presetId) => {
			SPARKLE_PRESETS.apply(presetId, manager.fieldHost.ensureSlot(layer, 'sparkles'));
		};

		const animatedSticker = editor.stickerLibrary.content.find((item) => item.isAnimated);
		if (!animatedSticker) throw new Error('Need an animated sticker for fragility coverage');

		// Animated sticker: outline + glow (Neon Glow), bevel, Kira Kira.
		const sticker = insert(editor.stickerManager.createLayer(animatedSticker.id));
		sticker.transform.position = { x: 90, y: 80 };
		applyStyle(editor.stickerManager, sticker, 'neon-glow');
		sticker.stickerData.bevel.enabled = true;
		addSparkles(editor.stickerManager, sticker, 'kira-kira');
		editor.stickerManager.renderLayer(sticker);

		// Warped text with a bevel style and scattered sparkles.
		const text = insert(editor.textGlitterManager.createLayer({ text: 'Roadmap \uD83D\uDE00', position: { x: 170, y: 150 }, align: 'center' }));
		applyStyle(editor.textGlitterManager, text, 'chrome-bevel');
		WARP_PRESETS.apply('arc', text.textData);
		text.textData.decoration = { underline: true, strikethrough: true };
		addSparkles(editor.textGlitterManager, text, 'blingee-sparkle');
		await editor.textGlitterManager.refreshLayer(text, { saveHistory: false });

		// Shape with a glow spread shadow.
		const shape = insert(editor.shapeGlitterManager.createLayer({ shapeId: 'heart', width: 70, height: 60, position: { x: 250, y: 70 } }));
		applyStyle(editor.shapeGlitterManager, shape, 'neon-pop');
		editor.shapeGlitterManager.renderLayer(shape);

		// Pinned bevel frame and whole-picture weather.
		const frame = insert(editor.frameLayerManager.createLayer());
		FRAME_PRESETS.apply('raised', frame.frameData);
		insert(editor.sparkleLayerManager.createLayer());

		// A CSS-tier look and two pixel looks on top.
		['scanlines', 'jpeg-crunch', 'rgb-split'].forEach((type) => {
			const filter = editor.filterLayerManager.createLayer({ filterData: { type } });
			filter.name = `Fragility ${type}`;
			insert(filter);
		});

		editor.layerManager.renderLayersList();
		editor.updatePreview();
		editor.saveState();
		return editor.layerManager.layers.map((layer) => layer.type);
	});
}

// One committed edit, then undo: the export must return to the reference.
async function editAndUndo(page, mutate) {
	await page.evaluate(mutate);
	await page.evaluate(async () => {
		window.editor.saveState();
		await window.editor.undo();
	});
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await openEditor(page);
		const types = await buildComposition(page);
		console.log(`Composition: ${types.join(', ')}`);

		const settings = {
			// Eight frames keep twelve exports of a heavy scene within one run.
			matte: { transparency: false, matteColor: '#ffffff', maxFrames: 8 },
			transparent: { transparency: true, matteColor: '#ffffff', maxFrames: 8 }
		};
		const reference = {};
		for (const [name, overrides] of Object.entries(settings)) {
			const first = await exportSnapshot(page, overrides, { minLayers: MIN_LAYERS });
			const second = await exportSnapshot(page, overrides, { minLayers: MIN_LAYERS });
			assertByteIdentity(first, second, `Back-to-back ${name} export`);
			reference[name] = first;
			console.log(`PASS Back-to-back ${name} exports matched (${first.bytes.length} bytes, sha256 ${first.hash})`);
		}

		const edits = [
			['sticker outline width', () => {
				const editor = window.editor;
				const layer = editor.layerManager.layers.find((entry) => entry.type === LayerType.STICKER);
				layer.stickerData.border.widthPx += 3;
				editor.stickerManager.renderLayer(layer);
			}],
			['text warp bend', async () => {
				const editor = window.editor;
				const layer = editor.layerManager.layers.find((entry) => entry.type === LayerType.TEXT_GLITTER);
				layer.textData.warp.bend = -40;
				await editor.textGlitterManager.refreshLayer(layer, { saveHistory: false });
			}],
			['frame style', () => {
				const editor = window.editor;
				const layer = editor.layerManager.layers.find((entry) => entry.type === LayerType.FRAME);
				layer.frameData.style = 'groove';
				editor.updatePreview();
			}],
			['JPEG Crunch filter', () => {
				const editor = window.editor;
				const layer = editor.layerManager.layers.find((entry) => entry.type === LayerType.FILTER && entry.filterData.type === 'jpeg-crunch');
				layer.filterData = GlitterFilter.normalizeFilterData({ type: 'deep-fry' });
				editor.updatePreview();
			}]
		];
		for (const [label, mutate] of edits) {
			await editAndUndo(page, mutate);
			for (const [name, overrides] of Object.entries(settings)) {
				const after = await exportSnapshot(page, overrides, { minLayers: MIN_LAYERS });
				assertByteIdentity(reference[name], after, `Edit ${label} -> undo -> ${name} export`);
			}
			console.log(`PASS Edit ${label} -> undo -> matte and transparent exports matched the originals`);
		}

		if (errors.length) throw new Error(`Page errors: ${errors.join(' | ')}`);
		console.log('\nRoadmap export fragility finished with all checks passing.');
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error?.stack || String(error));
	process.exit(1);
});

'use strict';

// The gallery order reserves cells for the deferred lit perspective 3D looks.
// Samples use the real slot masks at 64px, with no document mutation.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
	const out = path.resolve(process.argv[2] || 'docs/local/wordart-preview');
	fs.mkdirSync(out, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1900, height: 1000 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(process.env.GLITTER_URL || 'http://localhost/glitter/', { waitUntil: 'networkidle' });
		const samples = await page.evaluate(async () => {
			const editor = window.editor;
			const manager = editor.textGlitterManager;
			const library = STYLE_PRESETS[LayerType.TEXT_GLITTER];
			const results = {};
			for (const entry of library.entries.filter(entry => entry.group === 'wordart')) {
				const layer = createStylePreviewLayer(manager, LayerType.TEXT_GLITTER, entry);
				layer.textData.text = 'WordArt';
				layer.textData.fontSize = 64;
				library.apply(entry, { layer, context: { getSlotDefaults: key => manager.getEffectDefaults(key), glitterAvailable: id => Boolean(editor.glitterLibrary.getItemById(id)) } });
				await FontLibrary.ensureLoaded(layer.textData.fontId);
				for (const slot of Object.values(entry.value.slots)) if (slot.mode === 'glitter') await editor.glitterLibrary.ensureAssetDetails(slot.glitterId);
				const masks = await manager.renderSlotMasks(layer);
				const canvas = createAppCanvas(masks.renderWidth || masks.fill.width, masks.renderHeight || masks.fill.height, 'test/wordart');
				const surface = createAppCanvas(0, 0, 'test/wordart');
				for (const item of buildSlotStack(layer, slot => resolvePaintSlotPreviewSource(editor, layer, slot))) {
					if (!masks[item.key]) continue;
					if (!await paintStylePreviewSlot(editor, surface, masks[item.key], item.source)) throw new Error(`Missing WordArt paint: ${entry.id}/${item.key}`);
					canvas.getContext('2d').drawImage(surface, 0, 0, canvas.width, canvas.height);
				}
				if (!getStylePreviewInkBox(canvas)) throw new Error(`Empty WordArt render: ${entry.id}`);
				results[entry.id] = { label: entry.label, url: canvas.toDataURL() };
				canvas.width = canvas.height = surface.width = surface.height = 0;
			}
			return results;
		});
		if (errors.length) throw new Error(errors.join('\n'));
		const order = ['outline', 'up', 'arc', 'squeeze', 'inverted-arc', 'basic-stack', 'italic-outline', 'slate', 'mauve', 'graydient', 'red-blue', 'brown-stack', 'radial', 'purple', 'green-marble', 'rainbow', 'aqua', 'texture-stack', 'paper-bag', 'sunset', 'tilt', 'blues', 'yellow-dash', 'green-stack', 'chrome', 'marble-slab', 'gray-block', 'superhero', 'horizon', 'stack-3d'];
		const reference = fs.readFileSync(path.join(__dirname, '../docs/local/WORDART-EXAMPLES.png')).toString('base64');
		const html = `<!doctype html><meta charset="utf-8"><title>WordArt comparison</title><style>body{font:14px Arial;background:#eee;margin:20px}main{display:flex;gap:20px;align-items:flex-start}.grid{display:grid;grid-template-columns:repeat(6,225px);gap:8px}.cell{background:white;padding:8px;height:145px}.cell img{display:block;width:100%;height:115px;object-fit:contain}.pending{color:#777}aside{width:420px}aside img{width:420px}</style><h1>WordArt — 64px samples</h1><p>Original system fonts and Office textures. No aspect stretch. Marble Slab and Gray Block await the deferred lit perspective 3D engine; Stack 3D and Superhero use flat extrusion.</p><main><div class="grid">${order.map((id, index) => `<div class="cell ${samples[id] ? '' : 'pending'}">${index + 1}. ${samples[id]?.label || id}${samples[id] ? `<img src="${samples[id].url}">` : '<p>Pending later work package</p>'}</div>`).join('')}</div><aside><img src="data:image/png;base64,${reference}"><p>Original Office gallery</p></aside></main>`;
		fs.writeFileSync(path.join(out, 'comparison.html'), html);
		await page.setContent(html);
		await page.screenshot({ path: path.join(out, 'comparison.png'), fullPage: true });
		process.stdout.write(`PASS ${Object.keys(samples).length} WordArt renders; ${path.join(out, 'comparison.html')}\n`);
	} finally {
		await browser.close();
	}
})().catch(error => { console.error(error); process.exitCode = 1; });

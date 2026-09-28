'use strict';

const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

async function measureDreamyGlowParity(page) {
	await page.evaluate(async () => {
		const canvas = document.createElement('canvas');
		canvas.width = 80;
		canvas.height = 60;
		const context = canvas.getContext('2d');
		context.fillStyle = '#251849';
		context.fillRect(0, 0, 80, 60);
		context.fillStyle = '#e84d82';
		context.fillRect(8, 8, 28, 44);
		context.fillStyle = '#45b9db';
		context.fillRect(38, 5, 34, 24);
		context.fillStyle = '#f2c45e';
		context.fillRect(43, 34, 25, 18);
		window.__dreamyParitySource = context.getImageData(0, 0, 80, 60);
		const stage = document.createElement('div');
		stage.id = 'dreamyParityStage';
		Object.assign(stage.style, { position: 'fixed', left: '0', top: '0', width: '80px', height: '60px', overflow: 'hidden', zIndex: '99999' });
		const image = new Image();
		image.src = canvas.toDataURL();
		await image.decode();
		Object.assign(image.style, { position: 'absolute', inset: '0', width: '80px', height: '60px' });
		stage.appendChild(image);
		GlitterFilter.overlayLayerStyles({ type: 'dreamy-glow' }).forEach((spec) => {
			const overlay = document.createElement('div');
			Object.assign(overlay.style, { position: 'absolute', inset: '0' }, spec.style);
			stage.appendChild(overlay);
		});
		document.body.appendChild(stage);
	});
	const screenshot = await page.locator('#dreamyParityStage').screenshot();
	const [preview, exported] = await Promise.all([
		page.evaluate(async (base64) => {
			const image = new Image();
			image.src = `data:image/png;base64,${base64}`;
			await image.decode();
			const canvas = document.createElement('canvas');
			canvas.width = 80;
			canvas.height = 60;
			canvas.getContext('2d').drawImage(image, 0, 0);
			return [...canvas.getContext('2d').getImageData(0, 0, 80, 60).data];
		}, screenshot.toString('base64')),
		page.evaluate(() => {
			const canvas = document.createElement('canvas');
			canvas.width = 80;
			canvas.height = 60;
			const context = canvas.getContext('2d');
			context.putImageData(window.__dreamyParitySource, 0, 0);
			GlitterFilter.renderToCanvas(context, 80, 60, { type: 'dreamy-glow' }, 1);
			return [...context.getImageData(0, 0, 80, 60).data];
		})
	]);
	let error = 0;
	let samples = 0;
	for (let y = 10; y < 50; y++) for (let x = 10; x < 70; x++) for (let channel = 0; channel < 3; channel++) {
		const index = (y * 80 + x) * 4 + channel;
		error += Math.abs(preview[index] - exported[index]);
		samples++;
	}
	return error / samples;
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	try {
		await page.goto(APP_URL, { waitUntil: 'networkidle' });
		await page.evaluate(async () => {
			document.querySelectorAll('.modal-overlay.visible').forEach((node) => node.classList.remove('visible'));
			await window.editor.loadBlankImage(320, 240, '#6a3f88');
		});
		await page.waitForFunction(() => Boolean(window.editor?.originalImage));
		const result = await page.evaluate(async () => {
			const editor = window.editor;
			const layer = editor.filterLayerManager.createLayer();
			editor.layerManager.insertLayer(layer);
			editor.layerManager.setActiveLayer(layer.id);
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			const ids = [...document.querySelectorAll('#filterLooksPicker .preset-grid-option')].map((node) => node.dataset.presetId);
			const looksGrid = document.getElementById('filterLooksPicker');
			const firstThumbnail = looksGrid.querySelector('.preset-grid-thumbnail');
			if (firstThumbnail.getBoundingClientRect().height < 40) throw new Error('Look thumbnails collapsed instead of showing their previews');
			if (parseFloat(getComputedStyle(looksGrid).paddingLeft) <= 0) throw new Error('Looks scrollbox has no interior spacing');
			const output = { ids, tiers: {}, canvasesChanged: {} };
			const settings = {
				scanlines: ['filterLookStrength', 'filterScanlineSpacing'],
				'light-leak': ['filterLookStrength', 'filterLightLeakSize'],
				'dreamy-glow': ['filterLookStrength', 'filterDreamyGlowRadius']
			};
			for (const type of ['scanlines', 'light-leak', 'dreamy-glow']) {
				const entry = GlitterFilters.looksLibrary.get(type);
				editor.filterLayerManager.chooseLook(entry);
				await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
				if (layer.filterData.type !== type) throw new Error(`${type} did not apply`);
				if (!document.querySelector(`#filterLooksPicker [data-preset-id="${type}"].active`)) throw new Error(`${type} card is not active`);
				if (document.getElementById('filterCustomize').hidden) throw new Error(`${type} settings are hidden`);
				settings[type].forEach((id) => { if (!document.getElementById(id)) throw new Error(`${type} is missing ${id}`); });
				const styles = GlitterFilter.overlayLayerStyles(layer.filterData, { width: 320, height: 240, seed: layer.id });
				if (!styles.length) throw new Error(`${type} has no CSS preview styles`);
				output.tiers[type] = GlitterFilters.tier(layer.filterData);
				const canvas = document.createElement('canvas');
				canvas.width = 24;
				canvas.height = 24;
				const context = canvas.getContext('2d');
				context.fillStyle = '#6a3f88';
				context.fillRect(0, 0, 24, 24);
				context.fillStyle = '#f2c45e';
				context.fillRect(3, 3, 9, 18);
				const before = [...context.getImageData(0, 0, 24, 24).data];
				GlitterFilter.renderToCanvas(context, 24, 24, layer.filterData, 1, { seed: layer.id });
				const after = [...context.getImageData(0, 0, 24, 24).data];
				output.canvasesChanged[type] = after.some((value, index) => value !== before[index]);
			}
			editor.filterLayerManager.chooseLook(GlitterFilters.looksLibrary.get('basic'));
			if (!document.getElementById('filterBrightness')) throw new Error('Basic controls were not generated from fields');
			if (document.getElementById('filterCustomize').hidden) throw new Error('Basic settings are hidden');
			if (document.getElementById('filterCustomize').classList.contains('advanced-disclosure')) throw new Error('Primary filter settings are still behind a disclosure');
			editor.filterLayerManager.chooseLook(GlitterFilters.looksLibrary.get('instagram'));
			const rio = document.querySelector('#filterCustomizeControls [data-preset-id="rio"]');
			if (!rio?.querySelector('.filter-css-thumbnail')) throw new Error('Instagram preset grid did not render CSS thumbnails');
			if (rio.closest('.advanced-disclosure')) throw new Error('Instagram presets are still behind a disclosure');
			return output;
		});
		if (result.ids.length !== 12 || result.ids.slice(-3).join(',') !== 'scanlines,light-leak,dreamy-glow') throw new Error(`Unexpected looks: ${result.ids.join(',')}`);
		for (const type of ['scanlines', 'light-leak', 'dreamy-glow']) {
			if (result.tiers[type] !== 1) throw new Error(`${type} is not Tier 1`);
			if (!result.canvasesChanged[type]) throw new Error(`${type} export painter did not change pixels`);
		}
		const dreamyGlowError = await measureDreamyGlowParity(page);
		if (dreamyGlowError > 2) throw new Error(`Dreamy Glow preview/export mean channel error is ${dreamyGlowError.toFixed(2)}`);
		if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
		console.log(`Filter Looks grid, generated controls and canvas painters passed; Dreamy Glow parity MAE ${dreamyGlowError.toFixed(2)}`);
	} finally {
		await page.close();
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error?.stack || String(error));
	process.exit(1);
});

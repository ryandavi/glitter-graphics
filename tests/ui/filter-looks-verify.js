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
			const looksGrid = document.getElementById('filterLooksPicker');
			const initialIds = [...looksGrid.querySelectorAll('.preset-grid-option')].map((node) => node.dataset.presetId);
			if (initialIds.join(',') !== 'basic,invert,grayscale,sepia') throw new Error(`Active Adjust group is incorrect: ${initialIds.join(',')}`);
			const groupSelect = document.getElementById('filterLooksGroup');
			if (groupSelect.closest('.property-set')?.querySelector('.property-label')?.textContent !== 'Category') throw new Error('Look category dropdown is not in its own labelled property set');
			if (looksGrid.contains(groupSelect) || looksGrid.closest('.property-set') === groupSelect.closest('.property-set')) throw new Error('Look group dropdown is nested inside the preset grid property set');
			const groupLabels = [...groupSelect.options].map((node) => node.textContent);
			if (groupLabels.join(',') !== 'All,Adjust,Stylize,Web & Film,Instagram') throw new Error(`Unexpected look groups: ${groupLabels.join(',')}`);
			if (groupSelect.value !== 'adjust') throw new Error('Active look group is not synced to Basic');
			if (document.getElementById('filterCurrentLookName')?.textContent !== 'Basic') throw new Error('Current Look summary is not synced to Basic');
			if (document.querySelector('#filterCurrentLookBadges .badge-category')?.textContent !== 'Adjust') throw new Error('Current Look summary is missing its category');
			if (!document.getElementById('filterCurrentLookShow')?.hidden) throw new Error('Show action is visible while the current look is already in view');
			if (document.getElementById('filterCustomizeTitle')?.textContent !== 'Basic Settings') throw new Error('Settings heading does not identify the current look');
			if (looksGrid.querySelector('.preset-grid-heading')) throw new Error('Filtered Looks view repeats the selected category heading');
			groupSelect.value = '';
			groupSelect.dispatchEvent(new Event('change'));
			if (looksGrid.querySelectorAll('.preset-grid-heading').length !== 4) throw new Error('All Looks view is missing category headings');
			const ids = [...looksGrid.querySelectorAll('.preset-grid-option')].map((node) => node.dataset.presetId);
			const firstThumbnail = looksGrid.querySelector('.preset-grid-thumbnail');
			if (Math.abs(firstThumbnail.getBoundingClientRect().height - 36) > 1) throw new Error('Look thumbnails are not approximately 36px tall');
			if (looksGrid.classList.contains('property-scrollbox')) throw new Error('Looks grid still uses nested scrollbox styling');
			if (getComputedStyle(looksGrid).overflowY === 'auto' || getComputedStyle(looksGrid).maxHeight !== 'none') throw new Error('Looks grid still scrolls independently');
			if (getComputedStyle(looksGrid.querySelector('.preset-grid-options')).gridTemplateColumns.split(' ').length !== 3) throw new Error('Looks grid is not three columns wide');
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
				if (groupSelect.value !== '') throw new Error(`Choosing ${type} changed the All browsing category`);
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
			groupSelect.value = 'instagram';
			groupSelect.dispatchEvent(new Event('change'));
			if (looksGrid.querySelector('[data-preset-id="basic"]')) throw new Error('Category filtering did not hide the Basic card');
			if (document.getElementById('filterCurrentLookName').textContent !== 'Basic' || document.getElementById('filterCustomizeTitle').textContent !== 'Basic Settings') throw new Error('Browsing another category obscured the current look context');
			const showCurrent = document.getElementById('filterCurrentLookShow');
			if (showCurrent.hidden) throw new Error('Show action is hidden while the current look is outside the browsed category');
			showCurrent.click();
			if (groupSelect.value !== 'adjust' || !looksGrid.querySelector('[data-preset-id="basic"].active')) throw new Error('Show action did not reveal the current look');
			if (document.activeElement?.dataset.presetId !== 'basic') throw new Error('Show action did not focus the current look');
			groupSelect.value = 'instagram';
			groupSelect.dispatchEvent(new Event('change'));
			const clarendon = looksGrid.querySelector('[data-preset-id="instagram:clarendon"]');
			if (!clarendon?.querySelector('.filter-css-thumbnail')) throw new Error('Instagram look did not render its preset thumbnail');
			clarendon.click();
			if (layer.filterData.type !== 'instagram' || layer.filterData.presetId !== 'clarendon') throw new Error('Instagram look was not applied in one click');
			if (groupSelect.value !== 'instagram') throw new Error('Choosing an Instagram look changed the browsing category');
			if (document.getElementById('filterCurrentLookName').textContent !== 'Clarendon' || document.getElementById('filterCustomizeTitle').textContent !== 'Clarendon Settings') throw new Error('Current Look context did not update to Clarendon');
			if (!looksGrid.querySelector('[data-preset-id="instagram:clarendon"].active')) throw new Error('Instagram look is not active');
			if (document.querySelector('#filterCustomizeControls .preset-grid')) throw new Error('Instagram Settings still render a nested preset grid');
			if (!document.getElementById('filterStrength') || !document.getElementById('filterShowName')) throw new Error('Instagram Settings lost strength or name controls');
			layer.filterData = GlitterFilter.normalizeFilterData({ type: 'instagram', presetId: 'juno' });
			editor.filterLayerManager.loadLayerSettings(layer);
			if (!looksGrid.querySelector('[data-preset-id="instagram:juno"].active')) throw new Error('Loaded Instagram project did not activate its matching look');
			return output;
		});
		if (result.ids.length !== 32 || result.ids[8] !== 'scanlines' || result.ids.at(-1) !== 'instagram:hefe' || result.ids.includes('instagram')) throw new Error(`Unexpected looks: ${result.ids.join(',')}`);
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

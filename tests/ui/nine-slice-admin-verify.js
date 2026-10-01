'use strict';
const { chromium } = require('playwright');
const path = require('path');
async function main() {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto('http://localhost/glitter/');
		await page.setContent('<div id="emptyState"></div><div id="editorContent"></div><div id="statusMessage"></div>');
		await page.evaluate(() => { window.CONFIG = { image_base_path: '', tools: { nineSlice: { maxTiles: 256 } } }; });
		await page.addScriptTag({ path: path.resolve('admin/js/asset_admin.js') });
		await page.evaluate(() => { AssetEditor.prototype.init = () => {}; });
		await page.addScriptTag({ path: path.resolve('js/paint/nine-slice.js') });
		await page.addScriptTag({ path: path.resolve('admin/js/sticker_admin.js') });
		await page.evaluate(() => {
			const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 80;
			const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, 100, 80);
			app.currentAsset = { id: 1, name: 'Fixture', url: canvas.toDataURL(), width: 100, height: 80, is_pixelated: 1, tags: [], slice: {top: 8, right: 12, bottom: 16, left: 10, mode: 'stretch'} };
			app.renderEditor();
		});
		await page.waitForFunction(() => document.querySelector('.slice-source img').complete);
		await page.evaluate(() => {
			const section = document.querySelector('.slice-editor');
			if (section.querySelectorAll('canvas').length !== 2 || section.querySelectorAll('.slice-guide').length !== 4) throw new Error('Slice editor controls missing');
			const input = document.getElementById('slice_left'); input.value = 20; input.dispatchEvent(new Event('input'));
			if (app.getAssetDataFromForm().slice.left !== 20) throw new Error('Fields not saved');
			if (section.querySelector('.slice-guide-left').style.left !== '20%') throw new Error('Guides not synchronized');
			input.value = 100; input.dispatchEvent(new Event('input'));
			if (!section.querySelector('.slice-validation').textContent) throw new Error('Invalid slice missing feedback');
			document.getElementById('sliceEnabled').checked = false;
			if (app.getAssetDataFromForm().slice !== null) throw new Error('Slice disable must clear metadata');
		});
		console.log('PASS admin slice fields, guides, sample boxes, validation, and clearing');
	} finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

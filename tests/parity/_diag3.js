const { chromium } = require('playwright');
const { exportSnapshot } = require('./export-harness');
const APP_URL = 'http://localhost/glitter/';
const src = require('fs').readFileSync(__dirname + '/roadmap-export-fragility.js', 'utf8');
const m = {};
eval(src.slice(src.indexOf('async function openEditor'), src.indexOf('// One committed edit'))
	.replace('async function openEditor', 'm.openEditor = async function')
	.replace('async function buildComposition', 'm.buildComposition = async function'));

(async () => {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
	await m.openEditor(page);
	await m.buildComposition(page);
	await page.evaluate(() => {
		const h = window.editor.historyManager;
		const original = h.saveState.bind(h);
		window.__saves = [];
		h.saveState = (label, options) => { window.__saves.push(`${label} @ ${new Error().stack.split('\n').slice(2, 5).join(' <- ').replace(/\s+/g, ' ')}`); return original(label, options); };
	});
	const hist = (tag) => page.evaluate((tag) => {
		const h = window.editor.historyManager;
		const w = (s) => s.layers.find((l) => l.type === 'sticker')?.stickerData?.border?.widthPx;
		return `${tag}: index ${h.historyIndex}/${h.history.length - 1} widths [${h.history.map(w).join(',')}] saves: ${window.__saves.splice(0).join(' || ')}`;
	}, tag);
	console.log(await hist('after build'));
	await page.waitForTimeout(3000);
	console.log(await hist('after 3s idle'));
	await page.evaluate(() => { const e = window.editor; const l = e.layerManager.layers.find((x) => x.type === LayerType.STICKER); l.stickerData.border.widthPx += 3; e.stickerManager.renderLayer(l); e.saveState(); });
	console.log(await hist('after edit+save'));
	await page.waitForTimeout(3000);
	console.log(await hist('after 3s idle'));
	await exportSnapshot(page, { maxFrames: 4 }, { minLayers: 8 });
	console.log(await hist('after export'));
	await page.evaluate(async () => { await window.editor.undo(); });
	console.log(await hist('after undo'));
	await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

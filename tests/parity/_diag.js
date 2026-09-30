const { chromium } = require('playwright');
const { exportSnapshot, findFirstByteDiff } = require('./export-harness');
const APP_URL = 'http://localhost/glitter/';
const src = require('fs').readFileSync(__dirname + '/roadmap-export-fragility.js', 'utf8');
const m = {};
eval(src.slice(src.indexOf('async function openEditor'), src.indexOf('// One committed edit'))
	.replace('async function openEditor', 'm.openEditor = async function')
	.replace('async function buildComposition', 'm.buildComposition = async function'));

function diffStates(s1, s2) {
	const x = JSON.parse(s1);
	const y = JSON.parse(s2);
	x.forEach((l, i) => {
		const kx = JSON.stringify(l);
		const ky = JSON.stringify(y[i]);
		if (kx === ky) return;
		let j = 0;
		while (kx[j] === ky[j]) j++;
		console.log(l.type, kx.slice(Math.max(0, j - 150), j + 80));
		console.log('  VS', ky.slice(Math.max(0, j - 150), j + 80));
	});
}

(async () => {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
	await m.openEditor(page);
	await m.buildComposition(page);
	const snap = () => page.evaluate(() => JSON.stringify(window.editor.layerManager.layers.map((l) => window.editor.layerManager.serializeLayer(l))));
	const exp = () => exportSnapshot(page, { maxFrames: 8 }, { minLayers: 8 });
	const s1 = await snap();
	const a = await exp();
	await page.evaluate(() => { const e = window.editor; const l = e.layerManager.layers.find((x) => x.type === LayerType.STICKER); l.stickerData.border.widthPx += 3; e.stickerManager.renderLayer(l); e.saveState(); });
	const edited = await exp();
	console.log('A vs edited', findFirstByteDiff(a.bytes, edited.bytes));
	await page.evaluate(async () => { await window.editor.undo(); });
	const s2 = await snap();
	console.log('state same after undo', s1 === s2);
	if (s1 !== s2) diffStates(s1, s2);
	const c = await exp();
	console.log('A vs after-undo', findFirstByteDiff(a.bytes, c.bytes), 'edited vs after-undo', findFirstByteDiff(edited.bytes, c.bytes));
	await page.evaluate(() => { const e = window.editor; e.sceneCompositor.clearCaches?.(); e.sceneCompositor.invalidateCaches?.(); });
	await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

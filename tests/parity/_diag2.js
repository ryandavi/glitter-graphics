const { chromium } = require('playwright');
const { exportSnapshot, findFirstByteDiff } = require('./export-harness');
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
	const exp = (transparency) => exportSnapshot(page, { maxFrames: 8, transparency }, { minLayers: 8 });
	const a = await exp(false);
	await exp(true);
	const b = await exp(false);
	console.log('full scene: matte before vs after a transparent export', findFirstByteDiff(a.bytes, b.bytes));
	await page.evaluate(async () => {
		const e = window.editor;
		const l = e.layerManager.layers.find((x) => x.type === LayerType.STICKER);
		l.stickerData.border.widthPx += 3;
		e.stickerManager.renderLayer(l);
		e.saveState();
		await e.undo();
	});
	const c = await exp(false);
	console.log('full scene: matte after sticker edit+undo vs the matte just before it', findFirstByteDiff(b.bytes, c.bytes));
	await browser.close();
})().catch((e) => { console.error(e?.message || e); process.exit(1); });

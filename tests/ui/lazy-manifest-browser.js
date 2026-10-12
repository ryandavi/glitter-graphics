'use strict';

const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';
const { scriptManifest, bundleConfig } = require('../../tools/script-manifest');

async function verifyShippingSwitch(browser) {
	const base = new URL(APP_URL);
	const remote = new URL(base);
	remote.hostname = 'glitter.test';
	const cases = [
		{ remote: false, query: '', bundle: false },
		{ remote: false, query: `${bundleConfig.bundleParam}=1`, bundle: true },
		{ remote: true, query: '', bundle: true },
		{ remote: true, query: `${bundleConfig.sourceParam}=1`, bundle: false },
		{ remote: true, query: `${bundleConfig.sourceParam}=1&${bundleConfig.bundleParam}=1`, bundle: true }
	];
	for (const entry of cases) {
		const page = await browser.newPage();
		const errors = [];
		const requests = [];
		page.on('pageerror', error => errors.push(error.message));
		page.on('request', request => requests.push(new URL(request.url()).pathname));
		if (entry.remote) {
			// Keep the document's non-local origin while serving the real app under a subfolder.
			await page.route('**/*', async route => {
				const url = new URL(route.request().url());
				if (url.hostname !== remote.hostname) return route.continue();
				url.host = base.host;
				url.protocol = base.protocol;
				url.pathname = url.pathname.replace('/shipping-check/', base.pathname);
				await route.fulfill({ response: await route.fetch({ url: url.href }) });
			});
		}
		const target = new URL(entry.remote ? remote : base);
		if (entry.remote) target.pathname = '/shipping-check/';
		target.search = entry.query;
		await page.goto(target.href, { waitUntil: 'networkidle' });
		await page.waitForFunction(() => window.editor);
		const bundled = requests.filter(file => file.endsWith('/' + bundleConfig.output));
		const sources = requests.filter(file => scriptManifest.boot.some(source => file.endsWith('/' + source)));
		assert(entry.bundle ? bundled.length === 1 && sources.length === 0 : bundled.length === 0 && sources.length === scriptManifest.boot.length,
			`Wrong boot payload for ${target.href}`);
		assert(errors.length === 0, `Boot errors at ${target.href}: ${errors.join(', ')}`);
		await page.close();
	}
	process.stdout.write('Local/remote source and bundle selection under a subfolder passed\n');
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	try {
		await verifyShippingSwitch(browser);
		const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
		await page.addInitScript(() => {
			performance.setResourceTimingBufferSize(2000);
			window.bootScriptOrder = [];
			const appendChild = Node.prototype.appendChild;
			Node.prototype.appendChild = function (node) {
				if (node.tagName === 'SCRIPT' && node.src) node.addEventListener('load', () => window.bootScriptOrder.push(new URL(node.src).pathname));
				return appendChild.call(this, node);
			};
		});
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Network.enable');
		await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
		const manifestRequests = [];
		// Source boot exceeds the browser's default Resource Timing buffer.
		const resourceRequests = [];
		const requestStarts = [];
		page.on('request', (request) => {
			resourceRequests.push(new URL(request.url()).pathname);
			requestStarts.push(request);
			if (/\/data\/(?:shapes|brushes|fonts|glitter\.index|stickers\.index)\.json\?/u.test(request.url())) manifestRequests.push(request.url());
		});
		await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 180000 });
		await page.waitForFunction(() => (
			window.editor?.glitterLibrary.content.length > 0
			&& window.editor?.stickerLibrary.content.length > 0
		));
		const scriptOrder = await page.evaluate(() => ({
			order: window.bootScriptOrder,
			cssEnd: performance.getEntriesByType('resource').find((entry) => new URL(entry.name).pathname.endsWith('/css/style.css')).responseEnd,
			requests: performance.getEntriesByType('resource').filter((entry) => entry.initiatorType === 'script').map((entry) => ({ path: new URL(entry.name).pathname, start: entry.startTime }))
		}));
		const params = new URL(APP_URL).searchParams;
		const bootScripts = params.get(bundleConfig.bundleParam) === '1' ? [bundleConfig.output] : scriptManifest.boot;
		assert(scriptOrder.order.length === bootScripts.length && scriptOrder.order.every((file, i) => file.endsWith('/' + bootScripts[i])), 'Boot scripts did not execute in manifest order');
		assert(scriptOrder.requests.filter((entry) => bootScripts.some((file) => entry.path.endsWith('/' + file))).every((entry) => entry.start >= scriptOrder.cssEnd), 'A boot script started before the stylesheet response ended');
		await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
		for (const file of ['shapes', 'brushes', 'fonts', 'glitter.index', 'stickers.index']) {
			assert(manifestRequests.filter((url) => new URL(url).pathname.endsWith(`/data/${file}.json`)).length === 1,
				`${file} manifest preload was not reused by the loader`);
		}
		const boot = await page.evaluate(() => ({
			fonts: FontLibrary.fonts.length,
			rasterBrushes: Object.keys(BrushLibrary.BRUSHES).length,
			brushes: window.editor.brushTipManager.content.length,
			vectors: ShapeLibrary.BRUSH_SHAPES.length,
			preloads: [...document.querySelectorAll('link[as="fetch"]')].map((link) => link.href)
		}));
		assert(boot.fonts === require('../../data/fonts.json').fonts.length, 'Font boot manifest is incomplete');
		assert(boot.rasterBrushes === require('../../data/brushes.json').brushes.length, 'Raster brush boot manifest is incomplete');
		assert(boot.brushes === boot.rasterBrushes + boot.vectors, 'Concurrent boot lost brush definitions');
		assert(await page.evaluate(() => APP_BOOT.isComplete('interactive') && APP_BOOT.isComplete('library')), 'Editor was exposed before its Library stage completed');
		assert(boot.preloads.every((url) => manifestRequests.includes(url)), 'Preload and loader manifest URLs differ');
		const stage = await page.evaluate(() => ({ origin: performance.timeOrigin, interactive: performance.getEntriesByName('glitter:boot:interactive')[0].startTime }));
		assert(requestStarts.filter((request) => /\/data\/(glitter|stickers)\.index\.json$/u.test(new URL(request.url()).pathname)).every((request) => request.timing().startTime >= stage.origin + stage.interactive), 'A browse index competed with the interactive stage');
		assert(await page.evaluate(() => [editor.glitterLibrary, editor.stickerLibrary, editor.brushTipManager, editor.shapeBrowserManager, editor.fontBrowserManager].every((manager) => !manager.browser.hasView)), 'A hidden Library kind rendered at boot');
		assert(await page.locator('#designGalleryContent .category-card, #designGalleryContent .asset-option').count() === 0, 'Boot created hidden Library thumbnails');

		const lazyScripts = Object.entries(scriptManifest).filter(([id]) => id !== 'head' && id !== 'boot').flatMap(([, files]) => files);
		assert(!resourceRequests.some((url) => lazyScripts.some((file) => url.endsWith('/' + file))), 'A first-use script group was fetched during boot');
		const initialResources = [...resourceRequests];
		const result = await page.evaluate(async () => {
			const glitter = window.editor.glitterLibrary.content.find((asset) => asset._detailLoaded === false);
			const sticker = window.editor.stickerLibrary.content.find((asset) => asset._detailLoaded === false);
			if (!glitter || !sticker) throw new Error('Expected indexed assets with deferred details');
			const initial = {
				glitterId: glitter.id,
				stickerId: sticker.id,
				glitterFillBrightness: glitter.brightness,
				stickerFileSize: sticker.fileSize
			};
			await Promise.all([
				window.editor.glitterLibrary.ensureAssetDetails(glitter),
				window.editor.stickerLibrary.ensureAssetDetails(sticker)
			]);

			await window.editor.loadBlankImage(240, 180, '#ffffff');
			const manager = window.editor.stickerManager;
			const makeStickerUrl = (width, height, color) => {
				const canvas = document.createElement('canvas');
				canvas.width = width;
				canvas.height = height;
				const ctx = canvas.getContext('2d');
				ctx.fillStyle = color;
				ctx.fillRect(0, 0, width, height);
				return canvas.toDataURL('image/png');
			};
			const oldUrl = makeStickerUrl(40, 40, '#ff0000');
			const nextUrl = makeStickerUrl(80, 20, '#0000ff');
			const layer = manager.createLayer();
			layer.stickerSourceId = 'replacement-old';
			Object.assign(layer.stickerData, {
				isEmpty: false,
				url: oldUrl,
				baseUrl: oldUrl,
				name: 'Old sticker',
				width: 40,
				height: 40
			});
			window.editor.layerManager.insertLayer(layer);
			window.editor.layerManager.setActiveLayer(layer.id);
			manager.renderLayer(layer);

			const originalEnsureAssetDetails = window.editor.stickerLibrary.ensureAssetDetails;
			const originalCacheGet = AssetImageCache.get;
			let releasePreload;
			const preload = new Promise((resolve) => { releasePreload = resolve; });
			window.editor.stickerLibrary.ensureAssetDetails = async () => ({
				id: 'replacement-next', name: 'Next sticker', url: nextUrl, source: 'test',
				width: 80, height: 20, isAnimated: false, isPixelated: false, frameCount: 1
			});
			AssetImageCache.get = () => preload;
			const replacement = manager.pickLibrarySticker('replacement-next');
			await Promise.resolve();
			await Promise.resolve();
			const beforePreload = {
				url: layer.stickerData.url,
				width: layer.stickerData.width,
				height: layer.stickerData.height
			};
			releasePreload(null);
			await replacement;
			const afterPreload = {
				url: layer.stickerData.url,
				width: layer.stickerData.width,
				height: layer.stickerData.height
			};
			window.editor.stickerLibrary.ensureAssetDetails = originalEnsureAssetDetails;
			AssetImageCache.get = originalCacheGet;
			return {
				initial,
				glitterLoaded: glitter._detailLoaded,
				stickerLoaded: sticker._detailLoaded,
				glitterFillBrightness: glitter.brightness,
				stickerFileSize: sticker.fileSize,
				replacement: { beforePreload, afterPreload, oldUrl, nextUrl }
			};
		});
		result.initialResources = initialResources;
		result.finalResources = [...resourceRequests];

		assert(result.initialResources.some((path) => path.endsWith('/data/glitter.index.json')), 'Glitter browse index was not loaded');
		assert(result.initialResources.some((path) => path.endsWith('/data/stickers.index.json')), 'Sticker browse index was not loaded');
		assert(!result.initialResources.some((path) => path.endsWith('/data/glitter.json')), 'Full glitter manifest loaded eagerly');
		assert(!result.initialResources.some((path) => path.endsWith('/data/stickers.json')), 'Full sticker manifest loaded eagerly');
		assert(result.initial.glitterFillBrightness == null, 'Glitter detail value was populated before selection');
		assert(result.initial.stickerFileSize === 0, 'Sticker detail value was populated before selection');
		assert(result.glitterLoaded && result.stickerLoaded, 'Asset detail flags were not resolved');
		assert(result.glitterFillBrightness != null, 'Glitter detail record did not merge');
		assert(result.stickerFileSize > 0, 'Sticker detail record did not merge');
		assert(
			result.finalResources.some((path) => path.endsWith(`/data/glitter/${result.initial.glitterId}.json`)),
			'Glitter detail request was not lazy-loaded'
		);
		assert(
			result.finalResources.some((path) => path.endsWith(`/data/stickers/${result.initial.stickerId}.json`)),
			'Sticker detail request was not lazy-loaded'
		);
		assert(
			result.replacement.beforePreload.url === result.replacement.oldUrl
				&& result.replacement.beforePreload.width === 40
				&& result.replacement.beforePreload.height === 40,
			'Sticker geometry changed before its replacement image finished preloading'
		);
		assert(
			result.replacement.afterPreload.url === result.replacement.nextUrl
				&& result.replacement.afterPreload.width === 80
				&& result.replacement.afterPreload.height === 20,
			'Sticker replacement did not commit its source and geometry together after preload'
		);
		process.stdout.write('Lazy asset manifest verification passed\n');
		const views = await page.evaluate(() => {
			const managers = [editor.glitterLibrary, editor.stickerLibrary, editor.brushTipManager, editor.shapeBrowserManager, editor.fontBrowserManager];
			return managers.map((manager, index) => {
				document.getElementById('designGallerySection').dataset.pickerLibrary = manager.browser.prefix;
				syncLibraryView();
				const unchanged = manager.browser.elements.content.firstChild;
				syncLibraryView();
				return {
					prefix: manager.browser.prefix,
					count: manager.ui.panel.querySelectorAll('.category-card, .asset-option').length,
					once: unchanged === manager.browser.elements.content.firstChild,
					pending: managers.slice(index + 1).every((entry) => !entry.browser.hasView),
					decoded: [...manager.ui.panel.querySelectorAll('.category-card img')].every((image) => image.decoding === 'async')
				};
			});
		});
		for (const view of views) assert(view.count > 0 && view.once && view.pending && view.decoded, `${view.prefix} first-use rendering failed: ${JSON.stringify(view)}`);

		const gap = await browser.newPage();
		let releaseLibrary;
		const libraryGate = new Promise((resolve) => { releaseLibrary = resolve; });
		await gap.route('**/data/*.index.json?*', async (route) => { await libraryGate; await route.continue(); });
		await gap.goto(APP_URL, { waitUntil: 'domcontentloaded' });
		await gap.waitForFunction(() => document.body.classList.contains('boot-interactive'));
		assert(await gap.evaluate(() => !window.editor), 'Global editor became visible during the Library gap');
		await gap.locator('#workspaceStart [data-preset-id="classic-blingee"]').click();
		await gap.waitForFunction(() => APP_BOOT.editor.originalImage);
		assert(await gap.evaluate(() => ['textTool', 'shapeTool', 'glitterFillTool', 'brushTool', 'lineTool', 'penTool', 'addLayerBtn'].every((id) => document.getElementById(id).disabled)), 'Asset creation was enabled before Library readiness');
		assert(await gap.evaluate(() => !COMMANDS.toolText.when(APP_BOOT.editor)), 'Asset shortcut bypassed the boot gate');
		await gap.evaluate(() => {
			window.projectLoadStarted = false;
			APP_BOOT.editor.projectSerializer.loadFile = async () => { window.projectLoadStarted = true; return true; };
			window.pendingProjectLoad = APP_BOOT.editor.openProjectFile(new File(['{}'], 'test.glitter.json'));
		});
		assert(await gap.evaluate(() => !window.projectLoadStarted), 'Project loading did not await the Library');
		releaseLibrary();
		await gap.waitForFunction(() => window.editor);
		assert(await gap.evaluate(async () => await window.pendingProjectLoad && window.projectLoadStarted), 'Waiting project load did not resume');
		assert(await gap.evaluate(() => !document.getElementById('textTool').disabled), 'Asset tools did not enable after the Library');
		await gap.close();

		for (const failure of ['shapes', 'glitter']) {
			const failed = await browser.newPage();
			await failed.route(failure === 'shapes' ? '**/data/shapes.json?*' : /\/data\/glitter(?:\.index)?\.json(?:\?.*)?$/u, (route) => route.abort());
			await failed.goto(APP_URL, { waitUntil: 'domcontentloaded' });
			await failed.waitForFunction(() => document.body.classList.contains('boot-failed'));
			assert(await failed.locator('#bootReload').isVisible(), `${failure} failure did not offer Reload`);
			if (failure === 'glitter') {
				await failed.locator('#workspaceStart [data-preset-id="classic-blingee"]').click();
				await failed.waitForFunction(() => APP_BOOT.editor.originalImage);
				assert(await failed.evaluate(() => !document.getElementById('selectTool').disabled), 'Library failure blocked canvas creation');
			} else assert(await failed.evaluate(() => !APP_BOOT.isComplete('interactive')), 'Shape failure enabled the editor');
			await failed.close();
		}
		process.stdout.write('Staged boot gap and failure verification passed\n');
		const firstUse = await browser.newPage();
		const groupRequests = [];
		firstUse.on('request', request => groupRequests.push(new URL(request.url()).pathname));
		const bundledUrl = new URL(APP_URL);
		bundledUrl.searchParams.set(bundleConfig.bundleParam, '1');
		await firstUse.goto(bundledUrl.href, { waitUntil: 'networkidle' });
		await firstUse.waitForFunction(() => window.editor);
		let releaseExport;
		const exportGate = new Promise(resolve => { releaseExport = resolve; });
		await firstUse.route('**/js/export/GifExportEncoder.js?*', async route => { await exportGate; await route.continue(); });
		await firstUse.evaluate(async () => {
			await editor.loadBlankImage(32, 24, '#ff60ba');
		});
		await firstUse.waitForFunction(() => editor.originalImage);
		await firstUse.evaluate(() => {
			setActiveExportTarget(editor.exportSettings, 'still:png');
			window.exportedBytes = [];
			editor.exportResultPresenter.show = async result => { window.exportedBytes.push(Array.from(new Uint8Array(await result.blob.arrayBuffer()))); };
			editor.exportCurrentTarget();
		});
		await firstUse.waitForFunction(() => editor.exportInProgress && document.getElementById('exportProgress').classList.contains('visible'));
		assert(await firstUse.evaluate(() => !SCRIPT_GROUP_EXPORTS.has('export')), 'Export group bypassed the first-use loading wait');
		releaseExport();
		await firstUse.waitForFunction(() => window.exportedBytes.length === 1);
		await firstUse.evaluate(() => editor.exportCurrentTarget());
		await firstUse.waitForFunction(() => window.exportedBytes.length === 2);
		assert(await firstUse.evaluate(() => JSON.stringify(window.exportedBytes[0]) === JSON.stringify(window.exportedBytes[1])), 'First-use export changed repeat output');
		const exporterFiles = require('../../js/script-manifest.json').export;
		assert(exporterFiles.every(file => groupRequests.filter(url => url.endsWith('/' + file)).length === 1), 'Repeated export refetched its code group');
		assert(await firstUse.evaluate(async () => {
			const loads = await Promise.all([loadScriptGroup('export'), loadScriptGroup('export')]);
			return loads[0] === loads[1];
		}), 'Concurrent group loads did not share exports');

		const gifFiles = require('../../js/script-manifest.json')['gif-codec'];
		assert(!groupRequests.some(url => gifFiles.some(file => url.endsWith('/' + file))), 'PNG export downloaded the GIF encoder');
		await firstUse.evaluate(() => { setActiveExportTarget(editor.exportSettings, 'animation:gif'); editor.exportCurrentTarget(); });
		await firstUse.waitForFunction(() => window.exportedBytes.length === 3);
		await firstUse.evaluate(() => editor.exportCurrentTarget());
		await firstUse.waitForFunction(() => window.exportedBytes.length === 4);
		assert(await firstUse.evaluate(() => JSON.stringify(window.exportedBytes[2]) === JSON.stringify(window.exportedBytes[3])), 'First-use GIF changed repeat output');
		assert(gifFiles.every(file => groupRequests.filter(url => url.endsWith('/' + file)).length === 1), 'GIF encoder group was not loaded exactly once');
		let failHtml = true;
		await firstUse.route('**/js/export/HtmlSceneExporter.js?*', route => failHtml ? route.abort() : route.continue());
		assert(await firstUse.evaluate(async () => { try { await loadScriptGroup('html'); return false; } catch { return true; } }), 'A failed code group did not reject');
		failHtml = false;
		assert(await firstUse.evaluate(async () => Boolean((await loadScriptGroup('html')).HtmlSceneExporter)), 'A failed group could not retry');
		await firstUse.close();
		process.stdout.write('First-use script groups, export progress, repeat output and retry verification passed\n');

	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	process.stderr.write(`${error.stack || error}\n`);
	process.exit(1);
});

'use strict';

const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
		const manifestRequests = [];
		// Source boot exceeds the browser's default Resource Timing buffer.
		const resourceRequests = [];
		page.on('request', (request) => {
			resourceRequests.push(new URL(request.url()).pathname);
			if (/\/data\/(?:shapes|brushes|fonts|glitter\.index|stickers\.index)\.json\?/u.test(request.url())) manifestRequests.push(request.url());
		});
		await page.goto(APP_URL, { waitUntil: 'networkidle' });
		await page.waitForFunction(() => (
			window.editor?.glitterLibrary.content.length > 0
			&& window.editor?.stickerLibrary.content.length > 0
		));
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
		assert(boot.preloads.every((url) => manifestRequests.includes(url)), 'Preload and loader manifest URLs differ');

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
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	process.stderr.write(`${error.stack || error}\n`);
	process.exit(1);
});

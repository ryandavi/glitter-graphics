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
		await page.goto(APP_URL, { waitUntil: 'networkidle' });
		await page.waitForFunction(() => (
			window.editor?.glitterManager.content.length > 0
			&& window.editor?.stickerManager.content.length > 0
		));

		const result = await page.evaluate(async () => {
			const glitter = window.editor.glitterManager.content.find((asset) => asset._detailLoaded === false);
			const sticker = window.editor.stickerManager.content.find((asset) => asset._detailLoaded === false);
			if (!glitter || !sticker) throw new Error('Expected indexed assets with deferred details');
			const initialResources = performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname);
			const initial = {
				glitterId: glitter.id,
				stickerId: sticker.id,
				glitterBrightness: glitter.brightness,
				stickerFileSize: sticker.fileSize
			};
			await Promise.all([
				window.editor.glitterManager.ensureAssetDetails(glitter),
				window.editor.stickerManager.ensureAssetDetails(sticker)
			]);
			const finalResources = performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname);
			return {
				initial,
				glitterLoaded: glitter._detailLoaded,
				stickerLoaded: sticker._detailLoaded,
				glitterBrightness: glitter.brightness,
				stickerFileSize: sticker.fileSize,
				initialResources,
				finalResources
			};
		});

		assert(result.initialResources.some((path) => path.endsWith('/data/glitter.index.json')), 'Glitter browse index was not loaded');
		assert(result.initialResources.some((path) => path.endsWith('/data/stickers.index.json')), 'Sticker browse index was not loaded');
		assert(!result.initialResources.some((path) => path.endsWith('/data/glitter.json')), 'Full glitter manifest loaded eagerly');
		assert(!result.initialResources.some((path) => path.endsWith('/data/stickers.json')), 'Full sticker manifest loaded eagerly');
		assert(result.initial.glitterBrightness == null, 'Glitter detail value was populated before selection');
		assert(result.initial.stickerFileSize === 0, 'Sticker detail value was populated before selection');
		assert(result.glitterLoaded && result.stickerLoaded, 'Asset detail flags were not resolved');
		assert(result.glitterBrightness != null, 'Glitter detail record did not merge');
		assert(result.stickerFileSize > 0, 'Sticker detail record did not merge');
		assert(
			result.finalResources.some((path) => path.endsWith(`/data/glitter/${result.initial.glitterId}.json`)),
			'Glitter detail request was not lazy-loaded'
		);
		assert(
			result.finalResources.some((path) => path.endsWith(`/data/stickers/${result.initial.stickerId}.json`)),
			'Sticker detail request was not lazy-loaded'
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

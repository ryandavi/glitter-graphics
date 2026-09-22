'use strict';

const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
		await page.goto(APP_URL, { waitUntil: 'networkidle' });
		await page.evaluate(async () => {
			document.querySelectorAll('.modal-overlay.visible').forEach((node) => node.classList.remove('visible'));
			await editor.loadBlankImage(320, 240, '#ffffff');
			editor.setTool(ToolType.HAND);
		});
		await page.keyboard.press('Control+V');
		assert(await page.evaluate(() => editor.currentTool === ToolType.HAND), 'Ctrl+V hijacked the active tool');
		await page.keyboard.press('Control+B');
		assert(await page.evaluate(() => editor.currentTool === ToolType.HAND), 'Ctrl+B hijacked the active tool');
		await page.keyboard.press('v');
		assert(await page.evaluate(() => editor.currentTool === ToolType.SELECT), 'V did not activate the Select tool');
		process.stdout.write('PASS shortcut dispatch requires exact modifiers\n');
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	process.stderr.write(`${error.stack || error.message}\n`);
	process.exit(1);
});

'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const url = option('--url') || process.env.GLITTER_URL || 'http://localhost/glitter/';

async function measure(browser, throttled) {
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		const cdp = await context.newCDPSession(page);
		await cdp.send('Network.enable');
		if (throttled) {
			await cdp.send('Network.emulateNetworkConditions', {
				offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8,
				uploadThroughput: 750 * 1024 / 8, connectionType: 'cellular4g'
			});
			await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
		}
		await page.addInitScript(() => {
			window.loadReportTasks = [];
			new PerformanceObserver((list) => {
				window.loadReportTasks.push(...list.getEntries().map((entry) => entry.duration));
			}).observe({ type: 'longtask', buffered: true });
		});
		let requests = 0;
		let transferredBytes = 0;
		let cachedResponses = 0;
		cdp.on('Network.requestWillBeSent', () => { requests += 1; });
		cdp.on('Network.loadingFinished', (event) => { transferredBytes += event.encodedDataLength; });
		cdp.on('Network.requestServedFromCache', () => { cachedResponses += 1; });
		const rows = [];
		for (const cache of ['cold', 'warm']) {
			requests = 0;
			transferredBytes = 0;
			cachedResponses = 0;
			if (cache === 'cold') await page.goto(url, { waitUntil: 'load', timeout: 180000 });
			else await page.reload({ waitUntil: 'load', timeout: 180000 });
			await page.waitForFunction(() => window.editor && performance.getEntriesByName('glitter:init-done').length, null, { timeout: 180000 });
			await page.waitForLoadState('networkidle', { timeout: 180000 });
			const timing = await page.evaluate(() => ({
				firstPaintMs: performance.getEntriesByName('first-paint')[0]?.startTime ?? null,
				firstContentfulPaintMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
				initDoneMs: performance.getEntriesByName('glitter:init-done')[0].startTime,
				editorReadyMs: performance.getEntriesByName('glitter:editor-ready')[0].startTime,
				phasesMs: Object.fromEntries(performance.getEntriesByType('mark').filter((entry) => entry.name.startsWith('glitter:')).map((entry) => [entry.name, entry.startTime])),
				longestTaskMs: Math.max(0, ...window.loadReportTasks)
			}));
			rows.push({ profile: throttled ? 'Fast 4G / 4x CPU' : 'unthrottled', cache, requests, transferredBytes, cachedResponses, ...timing });
		}
		return rows;
	} finally {
		await context.close();
	}
}

(async () => {
	const browser = await chromium.launch({ headless: true });
	try {
		const report = { url, measuredAt: new Date().toISOString(), results: [...await measure(browser, false), ...await measure(browser, true)] };
		const output = option('--output');
		if (output) {
			fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
			fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
		}
		process.stdout.write(JSON.stringify(report, null, 2) + '\n');
	} finally {
		await browser.close();
	}
})().catch((error) => { console.error(error); process.exitCode = 1; });

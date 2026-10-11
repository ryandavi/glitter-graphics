'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { CONFIG } = require('./build-modals').getAppRegistries();

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
			window.loadReportShifts = [];
			performance.setResourceTimingBufferSize(2000);
			new PerformanceObserver((list) => {
				window.loadReportShifts.push(...list.getEntries().filter((entry) => !entry.hadRecentInput).map((entry) => entry.value));
			}).observe({ type: 'layout-shift', buffered: true });
			new PerformanceObserver((list) => {
				window.loadReportTasks.push(...list.getEntries().map((entry) => entry.duration));
			}).observe({ type: 'longtask', buffered: true });
		});
		let resources = new Map();
		const resource = (id) => {
			if (!resources.has(id)) resources.set(id, { type: 'Other', bytes: 0, cached: false });
			return resources.get(id);
		};
		cdp.on('Network.requestWillBeSent', (event) => Object.assign(resource(event.requestId), { url: event.request.url, type: event.type }));
		cdp.on('Network.responseReceived', (event) => {
			const entry = resource(event.requestId);
			entry.cached ||= Boolean(event.response.fromDiskCache || event.response.fromServiceWorker);
			entry.encoding = event.response.headers['content-encoding'] || event.response.headers['Content-Encoding'] || 'identity';
		});
		cdp.on('Network.loadingFinished', (event) => Object.assign(resource(event.requestId), { bytes: event.encodedDataLength, finished: true }));
		cdp.on('Network.loadingFailed', (event) => Object.assign(resource(event.requestId), { finished: true, failure: event.errorText }));
		cdp.on('Network.requestServedFromCache', (event) => { resource(event.requestId).cached = true; });
		const rows = [];
		for (const cache of ['cold', 'warm']) {
			resources = new Map();
			if (cache === 'cold') await page.goto(url, { waitUntil: 'load', timeout: 180000 });
			else await page.reload({ waitUntil: 'load', timeout: 180000 });
			await page.waitForFunction(() => window.editor, null, { timeout: 180000 });
			if (CONFIG.app.boot) await page.waitForFunction((id) => performance.getEntriesByName(`glitter:boot:${id}`).length, CONFIG.app.boot.stages.at(-1).id, { timeout: 180000 });
			await page.waitForLoadState('networkidle', { timeout: 180000 });
			const deadline = Date.now() + 180000;
			while ([...resources.values()].some((entry) => entry.url?.startsWith('http') && !entry.finished)) {
				if (Date.now() > deadline) throw new Error('CDP requests did not finish before the next navigation');
				await page.waitForTimeout(100);
			}
			const timing = await page.evaluate(() => ({
				firstPaintMs: performance.getEntriesByName('first-paint')[0]?.startTime ?? null,
				firstContentfulPaintMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
				initDoneMs: performance.getEntriesByName('glitter:boot:library')[0]?.startTime ?? performance.getEntriesByName('glitter:init-done')[0]?.startTime,
				editorReadyMs: performance.getEntriesByName('glitter:boot:library')[0]?.startTime ?? performance.getEntriesByName('glitter:editor-ready')[0]?.startTime,
				shellMs: performance.getEntriesByName('first-paint')[0]?.startTime ?? null,
				interactiveMs: performance.getEntriesByName('glitter:boot:interactive')[0]?.startTime ?? performance.getEntriesByName('glitter:init-done')[0]?.startTime,
				stagesMs: Object.fromEntries((CONFIG.app.boot?.stages || []).map(({ id }) => [id, id === 'shell' ? performance.getEntriesByName('first-paint')[0]?.startTime : performance.getEntriesByName(`glitter:boot:${id}`)[0]?.startTime])),
				layoutShift: window.loadReportShifts.reduce((sum, value) => sum + value, 0),
				phasesMs: Object.fromEntries(performance.getEntriesByType('mark').filter((entry) => entry.name.startsWith('glitter:')).map((entry) => [entry.name, entry.startTime])),
				constructorMs: Object.fromEntries(performance.getEntriesByType('measure').filter((entry) => entry.name.startsWith('glitter:constructor:')).map((entry) => [entry.name.slice('glitter:constructor:'.length), entry.duration])),
				longestTaskMs: Math.max(0, ...window.loadReportTasks)
			}));
			const breakdown = {};
			for (const entry of resources.values()) {
				const group = breakdown[entry.type] ||= { requests: 0, cachedResponses: 0, transferredBytes: 0, rawFinishedBytes: 0 };
				group.requests += 1;
				group.cachedResponses += Number(entry.cached);
				group.rawFinishedBytes += entry.bytes;
				// CDP can report decoded body sizes for cache hits; they are not wire bytes.
				group.transferredBytes += entry.cached ? 0 : entry.bytes;
			}
			const total = (key) => Object.values(breakdown).reduce((sum, group) => sum + group[key], 0);
			rows.push({ profile: throttled ? 'Fast 4G / 4x CPU' : 'unthrottled', profileId: throttled ? 'throttled' : 'unthrottled', cache, requests: total('requests'), transferredBytes: total('transferredBytes'), rawFinishedBytes: total('rawFinishedBytes'), cachedResponses: total('cachedResponses'), breakdown, resources: [...resources.values()], ...timing });
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
		report.budgetFailures = [];
		if (args.includes('--check')) {
			for (const row of report.results) {
				const budgets = CONFIG.app.boot?.budgets?.[`${row.profileId}-${row.cache}`] || {};
				for (const [id, budget] of Object.entries(budgets)) {
					if (row.stagesMs[id] == null || row.stagesMs[id] > budget) report.budgetFailures.push(`${row.profileId}-${row.cache} ${id}: ${row.stagesMs[id]} ms exceeds ${budget} ms`);
				}
			}
			if (report.budgetFailures.length) process.exitCode = 1;
		}
		if (output) {
			fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
			fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
		}
		process.stdout.write(JSON.stringify(report, null, 2) + '\n');
	} finally {
		await browser.close();
	}
})().catch((error) => { console.error(error); process.exitCode = 1; });

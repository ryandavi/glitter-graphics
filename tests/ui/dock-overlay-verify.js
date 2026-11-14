'use strict';

// Compact-desktop overlay: below --canvas-min-width the left dock floats over
// the canvas (js/ui/panel-resize.js). Sweeps the window from 1041 to 1400 with
// the timeline open and checks the switch point, that opening and closing the
// overlay moves neither the canvas nor the timeline, Esc and outside presses,
// and the pin.

const assert = require('node:assert/strict');
const { openApp } = require('../lib/app');

async function main() {
	const { browser, page, errors } = await openApp({ viewport: { width: 1400, height: 900 } });
	try {
		await page.evaluate(async () => {
			editor.modalManager.closeAll({ force: true });
			PREFERENCES.set('reduceMotion', true);
			PREFERENCES.set('showHints', false);
			await editor.loadBlankImage(500, 400, '#ffffff');
			await editor.ensureTimelineDock();
			PREFERENCES.set('timelineOpen', true);
			await editor.updateExportDuration();
		});
		await page.waitForSelector('#timelineDock', { state: 'visible' });
		const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60)))));
		const resize = async width => { await page.setViewportSize({ width, height: 900 }); await settle(); };
		const measure = () => page.evaluate(() => {
			const box = id => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x, w: r.width }; };
			const dock = document.getElementById('layersPanel');
			return {
				overlay: dock.classList.contains('is-dock-overlay'), open: dock.classList.contains('is-dock-overlay-open'),
				visible: getComputedStyle(dock).visibility === 'visible' && dock.getBoundingClientRect().right > document.querySelector('.toolbar').getBoundingClientRect().right,
				canvas: box('previewContainer'), timeline: box('timelineDock'), dock: box('layersPanel'),
				inspector: box('designPanel'), rail: document.querySelector('.toolbar').getBoundingClientRect().right,
				min: getCanvasMinWidth(), gap: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-gap')) || 0, railButton: !document.getElementById('toolbarLayersBtn').hidden
			};
		});
		const same = (a, b, message) => { assert.equal(Math.round(a.canvas.w), Math.round(b.canvas.w), `${message}: canvas width`); assert.equal(Math.round(a.canvas.x), Math.round(b.canvas.x), `${message}: canvas x`); assert.equal(Math.round(a.timeline.w), Math.round(b.timeline.w), `${message}: timeline width`); };

		// The sweep: overlay below one width, docked from there up, never flipping back.
		const samples = [];
		for (let width = 1041; width <= 1400; width += 20) { await resize(width); samples.push({ width, ...(await measure()) }); }
		const first = samples.findIndex(sample => !sample.overlay);
		assert(first > 0, 'The overlay engages at the narrowest desktop width and ends before 1400');
		assert(samples.slice(first).every(sample => !sample.overlay) && samples.slice(0, first).every(sample => sample.overlay), 'The overlay mode switches once across the sweep');
		samples.forEach(sample => {
			assert.equal(sample.railButton, sample.overlay, `${sample.width}: the rail button shows only in overlay mode`);
			assert(sample.canvas.w >= sample.min - 1 || sample.overlay === false, `${sample.width}: overlay mode is for windows whose docks would starve the canvas`);
			if (sample.overlay) {
				assert(!sample.open && !sample.visible, `${sample.width}: the overlay starts closed`);
				// The inset layout keeps one --dock-gap between the cards (0 for flush docks).
				assert(Math.abs(sample.timeline.x - sample.gap - sample.rail) <= 1 && Math.abs(sample.timeline.x + sample.timeline.w + sample.gap - sample.inspector.x) <= 1, `${sample.width}: the timeline spans from the rail to the Inspector`);
			} else {
				assert(sample.canvas.w >= sample.min - 1, `${sample.width}: docked canvas keeps its minimum`);
			}
		});

		// Open and close at a narrow width: the layout never moves.
		await resize(1060);
		const closed = await measure();
		assert(closed.overlay && !closed.open);
		await page.locator('#toolbarLayersBtn').click(); await settle();
		const opened = await measure();
		assert(opened.open && opened.visible, 'The rail button opens the overlay');
		same(closed, opened, 'Opening');
		assert(opened.dock.x >= closed.rail - 1, 'The overlay starts at the rail edge');
		assert.equal(await page.evaluate(() => isDockVisible('layers')), true, 'Opening the overlay is not stored as the docked preference');
		const usable = await page.evaluate(() => editor.viewport.getUsableRect().width);
		assert.equal(Math.round(usable), Math.round(opened.canvas.w), 'The overlay is excluded from the usable rect');
		await page.keyboard.press('Escape'); await settle();
		let now = await measure();
		assert(!now.open && !now.visible, 'Esc closes the overlay'); same(closed, now, 'Esc close');

		await page.locator('#toolbarLayersBtn').click(); await settle();
		await page.mouse.click(opened.canvas.x + opened.canvas.w - 40, 300); await settle();
		now = await measure();
		assert(!now.open, 'A press outside closes the overlay'); same(closed, now, 'Outside close');
		await page.locator('#toolbarLayersBtn').click(); await settle();
		await page.locator('#toolbarLayersBtn').click(); await settle();
		assert(!(await measure()).open, 'The rail button toggles it closed');

		// Pinned: stays through Esc and outside presses, docks when wide, floats again when narrow.
		await page.locator('#toolbarLayersBtn').click(); await settle();
		await page.locator('.dock-pin:visible').click(); await settle();
		await page.keyboard.press('Escape');
		await page.mouse.click(opened.canvas.x + opened.canvas.w - 40, 300); await settle();
		now = await measure();
		assert(now.open && now.visible, 'A pinned overlay ignores Esc and outside presses'); same(closed, now, 'Pinned');
		await resize(1400);
		now = await measure();
		assert(!now.overlay && now.dock.w > 0 && now.visible, 'A wide window docks the dock again');
		assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('layersPanel')).position), 'relative', 'Docked, the dock is back in the layout');
		await resize(1060);
		now = await measure();
		assert(now.overlay && now.open, 'The pin survives the round trip');
		await page.locator('.dock-pin:visible').click(); await settle();
		await page.keyboard.press('Escape'); await settle();
		assert(!(await measure()).open, 'Unpinned, Esc closes it');

		// A picker armed while closed shows the overlay on the Library tab and closes it after.
		const pick = await page.evaluate(() => {
			const dock = document.getElementById('layersPanel');
			setDockPeek('layers', true);
			const shown = dock.classList.contains('is-dock-overlay-open');
			setDockPeek('layers', false);
			return { shown, after: dock.classList.contains('is-dock-overlay-open') };
		});
		assert(pick.shown && !pick.after, 'A pick shows the overlay for its duration');

		// Short viewport: the Inspector keeps a usable height with the timeline open.
		await page.setViewportSize({ width: 1400, height: 520 }); await settle();
		const short = await page.evaluate(() => ({ inspector: document.getElementById('designPanel').getBoundingClientRect().height, timeline: document.getElementById('timelineDock').getBoundingClientRect().height, canvas: document.getElementById('previewContainer').getBoundingClientRect().height }));
		assert(short.inspector >= 300 && short.canvas > 0, `Short viewport keeps the Inspector usable (${JSON.stringify(short)})`);
		assert.deepEqual(errors, []);
		console.log(`switch at ${samples[first].width}px`);
		console.log('PASS overlay engages once across 1041-1400, opens/closes without moving canvas or timeline, Esc/outside/pin, re-docks when wide');
	} finally {
		await browser.close();
	}
}

main().catch(error => { console.error(error); process.exit(1); });

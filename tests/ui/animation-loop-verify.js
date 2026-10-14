const assert = require('assert');
const { openApp } = require('../lib/app');
const fs = require('fs');
const path = require('path');

// Serves the local app under a non-local host name.
async function routeDeployedHost(page) {
	await page.route('http://timeline.test/**', async route => {
		if (process.env.GLITTER_TEST_CSS && route.request().url().includes('/css/style.css')) { await route.fallback(); return; }
		const response = await route.fetch({ url: route.request().url().replace('timeline.test', 'localhost') });
		await route.fulfill({ response });
	});
}

// A routed request still in flight must not fail the run when the browser closes.
async function closeDeployedHost({ browser, page }) {
	await page.unrouteAll({ behavior: 'ignoreErrors' });
	await browser.close();
}

async function verifyTimelineDock() {
	const originalUrl = process.env.GLITTER_URL;
	const localUrl = originalUrl || 'http://localhost/glitter/';
	const { browser, page, errors } = await openApp({ viewport: { width: 1600, height: 900 }, document: { width: 320, height: 240 } });
	try {
		assert(await page.locator('#timelineToggle').isVisible());
		assert.strictEqual(await page.evaluate(() => !!editor.timelineDock), false, 'Closed dock must not load its lazy group');
		const fullHeight = await page.locator('#previewContainer').evaluate(node => node.clientHeight);
		await page.click('#timelineToggle');
		await page.waitForFunction(() => editor.timelineDock?.isOpen);
		await page.waitForTimeout(200);
		await page.evaluate(() => editor.updateExportDuration());
		assert(await page.locator('#timelineDock .timeline-ruler .property-note').isVisible(), 'A document with nothing animated must say so in the ruler band');
		assert(await page.evaluate(() => editor.animationTicker.tickListeners.size === 0 && editor.animationTicker.frameRequest == null), 'An empty dock does not keep the ticker running');
		assert(await page.locator('#timelineDock .timeline-ruler').evaluate(node => !node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 }))), 'An empty timeline also consumes Ctrl-wheel to prevent page zoom');
		assert((await page.locator('#previewContainer').evaluate(node => node.clientHeight)) < fullHeight);
		assert.strictEqual(await page.evaluate(() => editor.viewport.lastViewportHeight), await page.locator('#previewContainer').evaluate(node => node.clientHeight), 'Opening must use the viewport resize path');
		const sources = await page.evaluate(async () => {
			const e = editor;
			const asset = e.stickerLibrary.content.find(item => item.isAnimated);
			await e.stickerLibrary.ensureAssetDetails(asset.id);
			const sticker = e.stickerManager.createLayer(asset.id);
			e.layerManager.insertLayer(sticker);
			sticker.animations = [GlitterAnimation.normalizeAnimation({ type: 'pulse', periodMs: 1400 }), GlitterAnimation.normalizeAnimation({ type: 'rotate', periodMs: 1000, iterations: 1, turns: 0.5, fillMode: 'forwards' })];
			const text = e.textGlitterManager.createLayer({ text: 'hello', position: { x: 160, y: 120 } });
			e.layerManager.insertLayer(text);
			const glitter = e.glitterLibrary.content.find(item => item.isAnimated);
			getLayerFillSlot(text).mode = 'glitter'; getLayerFillSlot(text).glitterId = glitter.id;
			e.textGlitterManager.fieldHost.ensureSlot(text, 'sparkles').enabled = true;
			e.requestPreviewUpdate();
			e.saveState('Timeline fixture');
			await e.updateExportDuration();
			return { stickerId: sticker.id, textId: text.id, count: e.loopEstimate.loopFit.sources.filter(source => source.kind === 'procedural' || Number.isFinite(source.cycleDuration)).length };
		});
		assert.strictEqual(await page.locator('.timeline-group').count(), 3);
		assert.strictEqual(await page.locator('.timeline-row').count(), sources.count);
		assert((await page.locator('.timeline-bar-seam').count()) > 0, 'A held non-rest pose must mark its seam');
		assert((await page.locator('.timeline-bar-marks').count()) >= sources.count);
		await page.locator('.timeline-bar').first().click();
		assert.strictEqual(await page.evaluate(() => editor.activeLayerId), sources.textId);
		await page.evaluate(() => { window.collapseRow = editor.timelineDock.body.querySelector('.timeline-row'); });
		await page.locator('.timeline-group-header button[aria-expanded]').first().click();
		assert(await page.evaluate(() => collapseRow === editor.timelineDock.body.querySelector('.timeline-row')), 'Collapse preserves the existing row nodes');
		await page.evaluate(() => editor.updateExportDuration());
		assert(await page.locator('.timeline-group').first().evaluate(node => node.classList.contains('is-collapsed')));
		assert(await page.evaluate(() => !Object.hasOwn(PREFERENCES.schema, 'timelineCollapsed')), 'Collapse state is not a user preference');
		await page.evaluate(() => { editor.timelineDock.close(); editor.timelineDock.open(); });
		assert(await page.locator('.timeline-group').first().evaluate(node => node.classList.contains('is-collapsed')), 'Collapse state survives closing and reopening this document');
		await page.locator('.timeline-group-header button[aria-expanded]').first().click();
		const gif = await page.locator('.timeline-readout').textContent();
		await page.evaluate(async () => { editor.exportSettings.animationFormat = 'mp4'; editor.exportSettings.type = 'animation'; await editor.updateExportDuration(); });
		assert((await page.locator('.timeline-readout').textContent()).includes('MP4'));
		assert.notStrictEqual(await page.locator('.timeline-readout').textContent(), gif);
		await page.evaluate(async () => { editor.exportSettings.animationFormat = 'gif'; await editor.updateExportDuration(); });
		await page.evaluate(async () => { editor.layerManager.deleteLayer(editor.layers.find(layer => layer.type === LayerType.STICKER).id); await editor.updateExportDuration(); });
		assert.strictEqual(await page.locator('.timeline-group').count(), 2);
		await page.evaluate(async () => { await editor.historyManager.undo(); await editor.updateExportDuration(); });
		assert.strictEqual(await page.locator('.timeline-group').count(), 3);
		await page.evaluate(async () => { await editor.historyManager.redo(); await editor.updateExportDuration(); });
		assert.strictEqual(await page.locator('.timeline-group').count(), 2);
		await page.evaluate(async () => { await editor.historyManager.undo(); await editor.updateExportDuration(); });
		const handle = page.locator('.timeline-resize-handle');
		await handle.focus();
		const initialHeight = await page.locator('#timelineDock').evaluate(node => node.clientHeight);
		await page.keyboard.press('ArrowUp');
		assert((await page.locator('#timelineDock').evaluate(node => node.clientHeight)) > initialHeight);
		const box = await handle.boundingBox();
		const startHeight = await page.locator('#timelineDock').evaluate(node => node.clientHeight);
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 40);
		await page.waitForTimeout(100);
		assert.strictEqual(await page.locator('#timelineDock').evaluate(node => node.clientHeight), startHeight + 40, 'Resize observer must preserve the live drag height');
		await page.keyboard.press('Escape');
		await page.mouse.up();
		assert.strictEqual(await page.locator('#timelineDock').evaluate(node => node.clientHeight), startHeight, 'Escape restores the starting height');
		await page.setViewportSize({ width: 2300, height: 900 });
		const labels = page.locator('.timeline-label-handle');
		await labels.waitFor({ state: 'visible' });
		await labels.focus();
		const labelWidth = Number(await labels.getAttribute('aria-valuenow'));
		await page.keyboard.press('ArrowRight');
		assert.equal(Number(await labels.getAttribute('aria-valuenow')), labelWidth + await page.evaluate(() => CONFIG.ui.panelResize.keyStep));
		await labels.focus();
		await page.keyboard.press('Home');
		assert.equal(Number(await labels.getAttribute('aria-valuenow')), await page.evaluate(() => CONFIG.ui.timeline.labelWidth), 'The shared label separator resets and announces its width');
		await page.setViewportSize({ width: 1600, height: 900 });
		await page.waitForTimeout(250);
		const zoomState = () => page.evaluate(() => ({ disabled: editor.timelineDock.zoom.disabled, value: Number(editor.timelineDock.zoom.value) }));
		assert.deepStrictEqual(await zoomState(), { disabled: false, value: 0 }, 'Fit is the left end of the zoom slider');
		await page.evaluate(() => { const zoom = editor.timelineDock.zoom; zoom.value = 0.5; zoom.dispatchEvent(new Event('input', { bubbles: true })); });
		assert.strictEqual(await page.evaluate(() => typeof PREFERENCES.get('timelineZoom')), 'number');
		assert((await zoomState()).value > 0);
		await page.evaluate(() => editor.timelineDock.setZoom(CONFIG.ui.timeline.pxPerSecondStops.at(-1)));
		assert.strictEqual((await zoomState()).value, 1, 'The final stop is the right end');
		assert(await page.evaluate(() => !editor.timelineDock.showsFrames && !editor.timelineDock.show.frames), 'Close zoom leaves Output frames off');
		await page.evaluate(() => editor.timelineDock.showItems.find(item => item.dataset.show === 'frames').click());
		assert(await page.evaluate(() => editor.timelineDock.showsFrames && editor.timelineDock.body.querySelector('.timeline-cycle-mark')), 'Output frames enables both ruler cells and in-bar marks');
		await page.evaluate(() => editor.timelineDock.showItems.find(item => item.dataset.show === 'frames').click());
		assert(await page.evaluate(() => !editor.timelineDock.showsFrames && !editor.timelineDock.body.querySelector('.timeline-cycle-mark')), 'Turning Output frames off removes the marks at close zoom');
		const ruler = await page.evaluate(() => {
			const dock = editor.timelineDock, probe = Object.create(dock);
			const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
			probe.rulerTicks = { ...dock.rulerTicks, canvas };
			probe.scale = 300; probe.trackWidth = 1440;
			probe.body = { scrollLeft: 0 }; probe.ruler = { clientWidth: 600 + dock.labelColumn };
			probe.model = { ...dock.model, loopMs: 4800, frameStarts: [0, 10, 20, 200, 400] };
			let frames = false;
			Object.defineProperty(probe, 'show', { get: () => ({ frames, nextLoop: false }) });
			let rectangles = [], labels = [];
			const fillRect = ctx.fillRect.bind(ctx), fillText = ctx.fillText.bind(ctx);
			ctx.fillRect = (...args) => { rectangles.push({ args, color: ctx.fillStyle }); fillRect(...args); };
			ctx.fillText = (...args) => { labels.push(args); fillText(...args); };
			probe.paintRuler();
			const off = { rectangles, labels };
			frames = true; rectangles = []; labels = []; probe.paintRuler();
			return { off, on: { rectangles, labels } };
		});
		assert.deepEqual(ruler.off.rectangles.slice(0, 6).map(rect => rect.args), [
			[0, 0, 1, 28], [30, 24, 1, 4], [60, 24, 1, 4], [90, 24, 1, 4], [120, 24, 1, 4], [150, 0, 1, 28]
		], 'Ruler minor ticks divide the labeled half-second evenly');
		assert.deepEqual(ruler.off.labels.slice(0, 3).map(label => label[0]), ['0 s', '0.5 s', '1 s']);
		assert(ruler.off.rectangles.every(rect => rect.args[2] === 1), 'Output frames off leaves only tick lines');
		const cells = ruler.on.rectangles.filter(rect => rect.args[1] === 24);
		assert.deepEqual(cells.slice(-4).map(rect => rect.args), [[0, 24, 6, 4], [6, 24, 54, 4], [60, 24, 60, 4], [120, 24, 1320, 4]], 'Narrow consecutive frames merge into one plain cell');
		assert.notEqual(cells.at(-3).color, cells.at(-2).color, 'Readable output frame cells alternate');
		await page.evaluate(() => editor.timelineDock.zoom.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
		assert.strictEqual(await page.evaluate(() => PREFERENCES.get('timelineZoom')), 'fit', 'Zoom to fit returns to fit');
		const oldLoop = await page.evaluate(() => ({ ...editor.documentLoop }));
		await page.evaluate(async () => { editor.setDocumentLoop({ mode: 'set', durationMs: 20000 }, { commit: false }); await editor.updateExportDuration(); });
		assert(await page.evaluate(() => {
			const dock = editor.timelineDock;
			return dock.scale === CONFIG.ui.timeline.minPxPerSecond && dock.body.scrollWidth > dock.body.clientWidth && Number(dock.zoom.value) === 0;
		}), 'A long loop at fit keeps readable seconds and scrolls');
		await page.evaluate(() => { window.timelineResizeRow = editor.timelineDock.body.querySelector('.timeline-row'); editor.timelineDock.applyHeight(240); });
		await page.waitForTimeout(100);
		assert(await page.evaluate(() => window.timelineResizeRow === editor.timelineDock.body.querySelector('.timeline-row')), 'Height-only resizing keeps the row nodes');
		const minimized = await page.evaluate(() => {
			const dock = editor.timelineDock, row = dock.body.querySelector('.timeline-row'), estimate = editor.loopEstimate;
			dock.minimize.click();
			dock.sync({ ...estimate, renderClock: { ...estimate.renderClock, frameCount: 83 } });
			const result = { same: row === dock.body.querySelector('.timeline-row'), pending: dock.rowsPending,
				readout: dock.readout.textContent, ticks: editor.animationTicker.tickListeners.size };
			dock.minimize.click();
			result.expanded = !dock.rowsPending && row === dock.body.querySelector('.timeline-row');
			dock.close(); result.closedTicks = editor.animationTicker.tickListeners.size;
			dock.open();
			return result;
		});
		assert.deepEqual(minimized, { same: true, pending: true, readout: '83 frames · GIF', ticks: 0, expanded: true, closedTicks: 0 }, 'Minimized estimates update the header, defer rows until expand, and release the display clock');
		const resizing = await page.evaluate(async () => {
			const dock = editor.timelineDock, sync = dock.sync;
			let calls = 0; dock.sync = function (...args) { calls++; return sync.apply(this, args); };
			for (let i = 0; i < 10; i++) dock.requestResync();
			const immediate = calls;
			await new Promise(resolve => requestAnimationFrame(resolve));
			dock.sync = sync; return { immediate, calls };
		});
		assert.deepEqual(resizing, { immediate: 0, calls: 1 }, 'Repeated width refits coalesce into one rebuild per frame');
		const canvasResets = await page.evaluate(() => {
			const dock = editor.timelineDock, canvas = dock.rulerTicks.canvas;
			let resets = 0;
			for (const property of ['width', 'height']) {
				const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, property);
				Object.defineProperty(canvas, property, { configurable: true,
					get() { return descriptor.get.call(this); }, set(value) { resets++; descriptor.set.call(this, value); } });
			}
			dock.paintRuler(); dock.paintRuler();
			delete canvas.width; delete canvas.height;
			return resets;
		});
		assert.equal(canvasResets, 0, 'Repainting the same ruler viewport does not reallocate the canvas');
		await page.locator('#timelineDock .section-header-title').click();
		assert(await page.evaluate(() => !PREFERENCES.get('timelineMinimized')), 'The header title leaves transport expanded');
		await page.click('[aria-label="Timeline options"]');
		assert(await page.getByRole('menuitemcheckbox', { name: 'Follow playhead', exact: true }).isChecked());
		await page.getByRole('menuitemcheckbox', { name: 'Snap', exact: true }).click();
		assert(await page.evaluate(() => !PREFERENCES.get('timelineSnap')), 'Snap is a remembered menu choice');
		await page.evaluate(async oldLoop => { PREFERENCES.reset('timelineSnap'); editor.setDocumentLoop(oldLoop, { commit: false }); await editor.updateExportDuration(); }, oldLoop);
		// A stored choice from before Next pass existed still shows the next pass.
		await page.evaluate(() => PREFERENCES.set('timelineShow', { cycles: true, frames: false, details: true }));
		assert(await page.evaluate(() => editor.timelineDock.show.nextLoop && editor.timelineDock.body.querySelectorAll('.timeline-bar-ghost').length > 0));
		const fitWidth = await page.evaluate(() => editor.timelineDock.trackWidth);
		await page.evaluate(() => editor.timelineDock.showItems.find(item => item.dataset.show === 'nextLoop').click());
		assert.deepStrictEqual(await page.evaluate(() => { const dock = editor.timelineDock; return { ghosts: dock.body.querySelectorAll('.timeline-bar-ghost').length, share: dock.nextLoopShare, loopFills: Math.abs(TimelineView.timeToX(dock.model.loopMs, dock.scale) - dock.trackWidth) < 0.5 }; }),
			{ ghosts: 0, share: 0, loopFills: true }, 'Next pass off ends the track at the loop line');
		assert(Math.abs(await page.evaluate(() => editor.timelineDock.trackWidth) - fitWidth) < 1, 'Fit zoom uses the whole width either way');
		await page.evaluate(() => { editor.applyDefaultPanelLayout(); });
		assert(await page.evaluate(() => editor.timelineDock.show.nextLoop && editor.timelineDock.body.querySelectorAll('.timeline-bar-ghost').length > 0), 'Reset Panels restores the dock view choices');
		await page.setViewportSize({ width: 1100, height: 900 });
		await page.waitForTimeout(250);
		if (process.env.GLITTER_TEST_CSS) {
			assert.strictEqual(await page.locator('.timeline-row-info').first().evaluate(node => getComputedStyle(node).display), 'none');
			assert.strictEqual(await page.locator('.timeline-row-label').first().evaluate(node => getComputedStyle(node).position), 'absolute');
		}
		await page.setViewportSize({ width: 390, height: 844 });
		assert(!(await page.locator('#timelineToggle').isVisible()));
		assert(!(await page.locator('#timelineDock').isVisible()));
		assert(await page.evaluate(() => PREFERENCES.get('timelineOpen')));
		await page.setViewportSize({ width: 1600, height: 900 });
		await page.waitForTimeout(250);
		assert(await page.locator('#timelineDock').isVisible());
		if (process.env.GLITTER_TIMELINE_SHOTS) {
			const beforeDir = path.join(process.env.GLITTER_TIMELINE_SHOTS, 'dock-before');
			const afterDir = path.join(process.env.GLITTER_TIMELINE_SHOTS, 'dock-after');
			fs.mkdirSync(beforeDir, { recursive: true }); fs.mkdirSync(afterDir, { recursive: true });
			const index = [];
			for (const theme of ['default', 'light']) for (const width of [1600, 1280, 1100]) {
				await page.setViewportSize({ width, height: 900 });
				await page.evaluate(theme => { document.documentElement.dataset.theme = theme === 'default' ? 'dark' : theme; }, theme);
				const file = `dock-${width}-${theme}.png`;
				await page.click('#timelineToggle'); await page.waitForTimeout(250);
				await page.screenshot({ path: path.join(beforeDir, file) });
				await page.click('#timelineToggle'); await page.waitForTimeout(250);
				await page.screenshot({ path: path.join(afterDir, file) });
				index.push({ name: `Timeline ${width} ${theme}`, file });
			}
			fs.writeFileSync(path.join(beforeDir, 'index.json'), JSON.stringify(index));
			fs.writeFileSync(path.join(afterDir, 'index.json'), JSON.stringify(index));
			await page.evaluate(() => { document.documentElement.dataset.theme = editor.interfaceTheme; });
			await page.setViewportSize({ width: 1600, height: 900 });
		}

		await page.click('#timelineToggle');
		await page.waitForTimeout(200);
		assert.strictEqual(await page.locator('#previewContainer').evaluate(node => node.clientHeight), fullHeight);
		assert.strictEqual(await page.evaluate(() => editor.viewport.lastViewportHeight), fullHeight, 'Closing must use the viewport resize path');
		await page.evaluate(() => editor.loadBlankImage(32, 24, '#ffffff'));
		assert.equal(await page.evaluate(() => editor.timelineDock.collapsed.size), 0, 'A replacement document clears collapse state');
		assert.deepStrictEqual(errors, []);
	} finally { await browser.close(); }

	try {
		for (const url of [new URL('?bundle=1', localUrl).href, 'http://timeline.test/glitter/', 'http://timeline.test/glitter/?features=timeline']) {
			process.env.GLITTER_URL = url;
			const requested = [];
			const fixture = await openApp({ document: { width: 32, height: 24 }, setup: async page => {
				await page.addInitScript(() => localStorage.setItem('glitter.preferences', JSON.stringify({ timelineOpen: true })));
				page.on('request', request => requested.push(request.url()));
				if (url.includes('timeline.test')) await routeDeployedHost(page);
			} });
			try {
				const allowed = url.includes('localhost') || url.includes('features=timeline');
				if (allowed) await fixture.page.waitForFunction(() => editor.timelineDock?.isOpen);
				assert.strictEqual(await fixture.page.locator('#timelineToggle').isVisible(), allowed);
				assert.strictEqual(await fixture.page.locator('#timelineDock').isVisible(), allowed);
				assert.strictEqual(requested.some(request => /js\/ui\/timeline-(view|dock|group)\.js/.test(request)), allowed);
				assert.deepStrictEqual(fixture.errors, []);
			} finally { await closeDeployedHost(fixture); }
		}
	} finally {
		if (originalUrl === undefined) delete process.env.GLITTER_URL;
		else process.env.GLITTER_URL = originalUrl;
	}
	console.log('PASS dock lazy loading, local/bundle/override gates, responsive layout, source groups, seams, export readout, selection and undo/redo');
}

async function verifyTimingModel() {
	const { browser, page, errors } = await openApp({ document: { width: 64, height: 48 } });
	try {
		const data = await page.evaluate(async () => {
			const e = editor;
			const layer = e.layerManager.addLayer(LayerType.SHAPE);
			getLayerFillSlot(layer).mode = 'solid';
			layer.animations = [GlitterAnimation.normalizeAnimation({ type: 'rotate', periodMs: 1000, turns: 1, fillMode: 'none' })];
			e.animationPanel.load(layer);
			const forever = document.getElementById('shapeAnimPlaysTimes');
			forever.checked = true; forever.dispatchEvent(new Event('change', { bubbles: true }));
			const input = document.getElementById('shapeAnimIterations');
			input.value = '2.5'; input.dispatchEvent(new Event('change', { bubbles: true }));
			const count = layer.animations[0].iterations;
			const source = e.sceneCompositor._createProceduralTimelines(e.sceneCompositor._createLayerAnimationTimelineSources(layer))[0];
			const preview = GlitterAnimation.sampleAt(layer.animations[0], 2250, e.sceneCompositor._buildAnimationSamplingContext(layer));
			const parity = JSON.stringify(preview) === JSON.stringify(source.sampleAt(2250).sample);
			const run = GlitterAnimation.runTiming(layer.animations[0]);
			await e.updateExportDuration();
			const finiteDuration = e.loopEstimate.duration;
			const start = e.historyManager.historyIndex;
			e.setDocumentLoop({ mode: 'set', durationMs: 3004 });
			const set = { ...e.documentLoop };
			const step = e.historyManager.historyIndex - start;
			await e.undo(); const automatic = { ...e.documentLoop };
			await e.redo();
			const project = JSON.parse(JSON.stringify(await e.projectSerializer.serialize()));
			e.isSaved = true; await e.projectSerializer.load(project); await e.updateExportDuration();
			const restored = { ...e.documentLoop };
			const loadedRepeats = e.layers.find(layer => layer.type === LayerType.SHAPE).animations[0].iterations;
			const mode = e.loopEstimate.loopMode;
			e.openAnimationLoop(); await e.updateExportDuration();
			const select = document.getElementById('animationLoopCandidate');
			const selected = select.value;
			select.value = 'auto'; select.dispatchEvent(new Event('change', { bubbles: true }));
			await e.updateExportDuration();
			const automaticOption = select.options[0].textContent;
			const autoSelected = select.value;
			delete project.loop;
			e.isSaved = true; await e.projectSerializer.load(project);
			const legacy = { ...e.documentLoop };
			e.setDocumentLoop({ mode: 'set', durationMs: 4000 });
			await e.loadBlankImage(64, 48, '#ffffff');
			const newDocument = { ...e.documentLoop };
			return { count, run, parity, finiteDuration, set, step, automatic, restored, loadedRepeats, mode, selected, automaticOption, autoSelected, legacy, newDocument, project: { ...project, loop: set } };
		});
		assert.strictEqual(data.count, 2.5);
		assert.strictEqual(data.loadedRepeats, 2.5);
		assert.strictEqual(data.run.end, 2500);
		assert.strictEqual(data.finiteDuration, 2500);
		assert(data.parity, 'Fractional repeat preview and export sampler must agree');
		assert.deepStrictEqual(data.set, { mode: 'set', durationMs: 3000 });
		assert.strictEqual(data.step, 1);
		assert.deepStrictEqual(data.automatic, { mode: 'auto', durationMs: null });
		assert.deepStrictEqual(data.restored, data.set);
		assert.strictEqual(data.mode, 'set');
		assert.strictEqual(data.selected, '3000');
		assert.strictEqual(data.automaticOption, 'Automatic');
		assert.strictEqual(data.autoSelected, 'auto');
		assert.deepStrictEqual(data.legacy, data.automatic);
		assert.deepStrictEqual(data.newDocument, data.automatic);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.evaluate(async () => {
			const layer = editor.layerManager.addLayer(LayerType.SHAPE);
			getLayerFillSlot(layer).mode = 'solid'; layer.animations = [GlitterAnimation.normalizeAnimation({ type: 'pulse' })];
			editor.openAnimationLoop(); await editor.updateExportDuration();
		});
		await page.waitForFunction(() => editor.mobileManager.sheetSection?.element.id === 'animationLoopSection');
		assert.strictEqual(await page.locator('#animationLoopCandidate').getAttribute('aria-label'), 'Loop length');
		assert(await page.locator('#animationLoopCandidate').isVisible());
		await page.selectOption('#animationLoopCandidate', { index: 1 });
		assert.strictEqual(await page.evaluate(() => editor.documentLoop.mode), 'set');
		assert.strictEqual(await page.evaluate(() => !!editor.timelineDock), false, 'Timing fields must work without loading the dock');
		assert.deepStrictEqual(errors, []);

		const originalUrl = process.env.GLITTER_URL;
		try {
			process.env.GLITTER_URL = 'http://timeline.test/glitter/';
			const deployed = await openApp({ document: { width: 64, height: 48 }, setup: async page => {
				await routeDeployedHost(page);
			} });
			try {
				const result = await deployed.page.evaluate(async project => {
					editor.isSaved = true; await editor.projectSerializer.load(project); await editor.updateExportDuration();
					const { plan } = await editor.sceneCompositor.planAnimation({ ...editor.getSceneSnapshotParams(editor.layers.filter(layer => layer.visible)), exportSettings: { ...editor.exportSettings, watermarkEnabled: false }, schedule: true });
					return { loop: editor.documentLoop, duration: plan.totalDuration, label: document.getElementById('animationLoopCandidate').getAttribute('aria-label'), options: Array.from(document.getElementById('animationLoopCandidate').options).map(option => option.textContent) };
				}, data.project);
				assert.deepStrictEqual(result.loop, data.set);
				assert.strictEqual(result.duration, 3000, 'Saved loop must export on a non-local host');
				assert.strictEqual(result.label, 'Fit to');
				assert(!result.options.includes('Automatic'));
				assert.deepStrictEqual(deployed.errors, []);
			} finally { await closeDeployedHost(deployed); }
		} finally {
			if (originalUrl === undefined) delete process.env.GLITTER_URL;
			else process.env.GLITTER_URL = originalUrl;
		}
		console.log('PASS loop persistence, Automatic undo, optional-key loading, fractional repeats, phone fields and stored timing on a non-local host');
	} finally { await browser.close(); }
}

async function verifyGifCycle() {
	const { browser, page, errors } = await openApp({ viewport: { width: 1600, height: 900 }, document: { width: 200, height: 160 } });
	let stickerIds = [];
	const readPreview = () => page.evaluate(async (ids) => Promise.all(ids.map(async (id) => {
		const image = editor.stickerManager.layerElements.get(id).querySelector('img.sticker-image');
		const timing = readGifTiming(await fetchGifBytes(image.src));
		return { src: image.getAttribute('src'), delays: timing.frameDelays, cycle: timing.frameDelays.reduce((sum, delay) => sum + delay, 0) };
	})), stickerIds);
	const exportPlan = () => page.evaluate(async () => {
		const { plan } = await editor.sceneCompositor.planAnimation({ ...editor.getSceneSnapshotParams(editor.layers.filter(layer => layer.visible)), exportSettings: { ...editor.exportSettings, watermarkEnabled: false }, schedule: true });
		return { duration: plan.totalDuration, exact: plan.loopSeam.exact };
	});
	try {
		const fixture = await page.evaluate(async () => {
			const e = editor;
			const asset = e.stickerLibrary.content.find(item => item.isAnimated);
			await e.stickerLibrary.ensureAssetDetails(asset.id);
			const sticker = e.stickerManager.createLayer(asset.id);
			e.layerManager.insertLayer(sticker);
			e.layerManager.setActiveLayer(sticker.id);
			e.stickerManager.renderLayer(sticker);
			const image = e.stickerManager.layerElements.get(sticker.id).querySelector('img.sticker-image');
			window.stickerSources = [image.getAttribute('src')];
			new MutationObserver(() => window.stickerSources.push(image.getAttribute('src'))).observe(image, { attributes: true, attributeFilter: ['src'] });
			e.saveState('Sticker fixture');
			await e.updateExportDuration();
			const source = e.loopEstimate.loopFit.sources.find(entry => entry.key === sticker.id);
			const slider = document.getElementById('stickerGifCycle');
			return {
				id: sticker.id, assetId: asset.id, url: sticker.stickerData.url, kind: source.kind, native: source.cycleDuration, file: source.fileCycleDuration,
				range: source.periodRange, settable: typeof source.setPeriod === 'function',
				row: !slider.closest('[data-gif-cycle-set]').hidden,
				slider: { min: Number(slider.min), max: Number(slider.max), value: Number(slider.value) }
			};
		});
		stickerIds = [fixture.id];
		assert.strictEqual(fixture.kind, 'authored', 'A GIF must stay an authored source');
		assert(fixture.settable && fixture.file === fixture.native, 'An animated sticker must offer its cycle');
		assert(fixture.row, 'The Cycle row must show for an animated sticker');
		assert.deepStrictEqual(fixture.slider, { min: fixture.range.min / 1000, max: fixture.range.max / 1000, value: fixture.native / 1000 });
		assert.strictEqual((await exportPlan()).duration, fixture.native);

		// Fit stretches the sticker to the chosen loop, in one step.
		const target = Math.ceil(fixture.native * 1.05 / 10) * 10;
		const fitted = await page.evaluate(async ({ id, target }) => {
			const e = editor;
			e.setDocumentLoop({ mode: 'set', durationMs: target });
			await e.updateExportDuration();
			const note = document.getElementById('animationLoopChanges').textContent;
			const start = e.historyManager.historyIndex;
			e.fitAnimationsToLoop();
			const steps = e.historyManager.historyIndex - start;
			await e.updateExportDuration();
			await new Promise(resolve => requestAnimationFrame(resolve));
			await e.animationPanel.retimedPreviewsSettled();
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			const layer = e.layerManager.getLayerById(id);
			const source = e.loopEstimate.loopFit.sources.find(entry => entry.key === id);
			return {
				note, steps, stored: layer.stickerData.gifCycleMs, before: layer.loopOriginalPeriods?.[id], exact: e.loopEstimate.exact, duration: e.loopEstimate.duration,
				delays: source.frameDurations, kind: source.kind, value: Number(document.getElementById('stickerGifCycle').value),
				readout: document.getElementById('stickerGifCycleValue').textContent, revert: !document.getElementById('resetStickerGifCycle').disabled,
				sources: window.stickerSources.slice()
			};
		}, { id: fixture.id, target });
		assert(fitted.note.includes(`${(fixture.native / 1000).toFixed(2)} s to ${(target / 1000).toFixed(2)} s`), `Fit must list the GIF change: ${fitted.note}`);
		assert.strictEqual(fitted.steps, 1);
		assert.strictEqual(fitted.stored, target);
		assert.strictEqual(fitted.before, fixture.native);
		assert(fitted.exact && fitted.duration === target, 'The fitted loop must read Seamless');
		assert.strictEqual(fitted.kind, 'authored');
		assert.strictEqual(fitted.value, target / 1000);
		assert(fitted.readout.includes((target / 1000).toFixed(2)) && fitted.readout.includes(`(${Math.round(target / fixture.native * 100)}%)`), `Readout must show the cycle and the change: ${fitted.readout}`);
		assert(fitted.revert, 'A stretched GIF must offer its revert');
		const stretched = await exportPlan();
		assert(stretched.duration === target && stretched.exact, 'The export must run the stretched cycle');
		const [preview] = await readPreview();
		assert(preview.src.startsWith('blob:'), 'The preview must play the retimed copy');
		assert.deepStrictEqual(preview.delays, fitted.delays, 'Preview file and export timing source must hold the same delays');
		assert.strictEqual(preview.cycle, target);
		assert.deepStrictEqual(fitted.sources, [fixture.url, preview.src], 'The preview must swap once, straight from the file to the decoded copy');

		// The same sticker on a second layer keeps its own cycle.
		const second = await page.evaluate(async ({ assetId, cycle }) => {
			const e = editor;
			const sticker = e.stickerManager.createLayer(assetId);
			e.layerManager.insertLayer(sticker);
			e.saveState('Second sticker');
			await e.updateExportDuration();
			e.loopEstimate.loopFit.sources.find(entry => entry.key === sticker.id).setPeriod(cycle);
			e.requestPreviewUpdate();
			e.saveState('Change animation speed');
			await e.updateExportDuration();
			await new Promise(resolve => requestAnimationFrame(resolve));
			await e.animationPanel.retimedPreviewsSettled();
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			return { id: sticker.id, stored: sticker.stickerData.gifCycleMs, keys: e.loopEstimate.loopFit.sources.map(entry => entry.key) };
		}, { assetId: fixture.assetId, cycle: fixture.range.max });
		stickerIds = [fixture.id, second.id];
		assert.strictEqual(second.stored, fixture.range.max);
		assert(second.keys.includes(fixture.id) && second.keys.includes(second.id), 'Each use of a GIF must be its own timeline');
		const pair = await readPreview();
		assert.deepStrictEqual(pair.map(entry => entry.cycle), [target, fixture.range.max], 'Two uses of one GIF must keep two cycle lengths');
		assert.notStrictEqual(pair[0].src, pair[1].src);

		const project = await page.evaluate(async () => JSON.parse(JSON.stringify(await editor.projectSerializer.serialize())));
		const saved = project.layers.filter(layer => layer.type === 'sticker').map(layer => layer.stickerData.gifCycleMs);
		assert.deepStrictEqual(saved.slice().sort(), [target, fixture.range.max].sort(), 'The cycle must be saved with the layer');

		// The panel field: one step, and its revert clears the stored cycle.
		const edited = await page.evaluate(async ({ id, seconds }) => {
			const e = editor;
			e.layerManager.setActiveLayer(id);
			await e.updateExportDuration();
			const slider = document.getElementById('stickerGifCycle');
			const start = e.historyManager.historyIndex;
			slider.value = String(seconds);
			slider.dispatchEvent(new Event('input', { bubbles: true }));
			slider.dispatchEvent(new Event('change', { bubbles: true }));
			await new Promise(resolve => setTimeout(resolve, 500));
			const stored = e.layerManager.getLayerById(id).stickerData.gifCycleMs;
			const steps = e.historyManager.historyIndex - start;
			await e.updateExportDuration();
			document.getElementById('resetStickerGifCycle').click();
			await new Promise(resolve => setTimeout(resolve, 500));
			await e.updateExportDuration();
			return { stored, steps, cleared: !('gifCycleMs' in e.layerManager.getLayerById(id).stickerData), revert: document.getElementById('resetStickerGifCycle').disabled };
		}, { id: fixture.id, seconds: fixture.range.min / 1000 });
		assert.strictEqual(edited.stored, fixture.range.min);
		assert.strictEqual(edited.steps, 1, 'A Cycle edit must be one history step');
		assert(edited.cleared && edited.revert, 'The row revert must clear the stored cycle');
		await page.evaluate(async () => {
			await editor.undo();
			await editor.undo();
			await editor.updateExportDuration();
		});
		assert.strictEqual(await page.evaluate(id => editor.layerManager.getLayerById(id).stickerData.gifCycleMs, fixture.id), target, 'Undo must bring the cycle back');

		// Restore previous timing puts the fitted GIF back on the file.
		const restored = await page.evaluate(async (id) => {
			const e = editor;
			e.resetAnimationLoop();
			await e.updateExportDuration();
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			const layer = e.layerManager.getLayerById(id);
			return { stored: layer.stickerData.gifCycleMs, src: e.stickerManager.layerElements.get(id).querySelector('img.sticker-image').getAttribute('src'), cycle: e.loopEstimate.loopFit.sources.find(entry => entry.key === id).cycleDuration };
		}, fixture.id);
		assert.strictEqual(restored.stored, undefined, 'Restore must clear the fitted cycle');
		assert.strictEqual(restored.cycle, fixture.native);
		assert.strictEqual(restored.src, fixture.url, 'Restore must show the file again');
		assert.deepStrictEqual(errors, []);

		// A deployed host hides the control and still honors the stored cycle.
		const originalUrl = process.env.GLITTER_URL;
		try {
			process.env.GLITTER_URL = 'http://timeline.test/glitter/';
			const deployed = await openApp({ document: { width: 200, height: 160 }, setup: async page => {
				await routeDeployedHost(page);
			} });
			try {
				const result = await deployed.page.evaluate(async (project) => {
					const e = editor;
					e.isSaved = true;
					await e.projectSerializer.load(project);
					await e.updateExportDuration();
					const stickers = e.layers.filter(layer => layer.type === LayerType.STICKER);
					const { plan } = await e.sceneCompositor.planAnimation({ ...e.getSceneSnapshotParams([stickers[0]]), exportSettings: { ...e.exportSettings, watermarkEnabled: false }, schedule: true });
					e.requestPreviewUpdate();
					await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
					await e.animationPanel.retimedPreviewsSettled();
					await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
					return {
						stored: stickers.map(layer => layer.stickerData.gifCycleMs), first: stickers[0].stickerData.gifCycleMs, duration: plan.totalDuration,
						settable: e.loopEstimate.loopFit.sources.some(source => typeof source.setPeriod === 'function'),
						fixed: e.loopEstimate.loopFit.fixed.length, control: Boolean(document.getElementById('stickerGifCycle')),
						src: e.stickerManager.layerElements.get(stickers[0].id).querySelector('img.sticker-image').getAttribute('src')
					};
				}, { ...project, loop: { mode: 'auto', durationMs: null } });
				assert.deepStrictEqual(result.stored, saved, 'A stored cycle must load on a non-local host');
				assert.strictEqual(result.duration, result.first, 'A stored cycle must export on a non-local host');
				assert(!result.settable && result.fixed === 2, 'A non-local host must leave GIFs fixed in Fit');
				assert(!result.control, 'A non-local host must not build the Cycle row');
				assert(result.src.startsWith('blob:'), 'A stored cycle must preview on a non-local host');
				assert.deepStrictEqual(deployed.errors, []);
			} finally { await closeDeployedHost(deployed); }
		} finally {
			if (originalUrl === undefined) delete process.env.GLITTER_URL;
			else process.env.GLITTER_URL = originalUrl;
		}
		console.log('PASS GIF cycle: Fit and Restore, matching preview and export delays, one swap, per-use cycles, panel field, saved projects and a non-local host');
	} finally { await browser.close(); }
}

(async () => {
	const { browser, page, errors } = await openApp({ viewport: { width: 1280, height: 800 }, document: { width: 32, height: 24, color: '#a348cd' } });
	try {
		await page.evaluate(async () => { editor.openAnimationLoop(); await editor.updateExportDuration(); });
		assert(await page.locator('#animationLoopStatus').isVisible());
		for (const id of ['animationLoopSourceSet', 'animationLoopLengthSet', 'animationLoopChangeSet']) {
			assert(!(await page.locator(`#${id}`).isVisible()), `${id} must be hidden with no animation sources`);
		}
		const replay = await page.evaluate(async () => {
			const e = editor;
			const layer = e.layerManager.addLayer(LayerType.SHAPE);
			getLayerFillSlot(layer).mode = 'solid';
			layer.animations = [GlitterAnimation.normalizeAnimation({ type: 'tada', periodMs: 1000, iterations: 1, delayMs: 2000 })];
			e.shapeGlitterManager.renderLayer(layer);
			await e.updateExportDuration();
			e.animationTicker.stop();
			const ticker = e.animationTicker;
			const wrapper = ticker.targets.get(layer.id).target.getWrapper();
			const start = ticker.timelineStartedAt;
			ticker._paint(start + 2250);
			const first = wrapper.style.transform;
			ticker._paint(start + e.loopEstimate.duration + 2250);
			const second = wrapper.style.transform;
			ticker._paint(start + e.loopEstimate.duration + 1500);
			const rest = wrapper.style.transform;
			ticker.timelineStartedAt = performance.now() - e.loopEstimate.duration - 2250;
			const current = ticker.getCurrentTime();
			const result = { duration: e.loopEstimate.duration, replays: first === second && first !== rest, current,
				badge: document.getElementById('animationLoopStatus').textContent };
			e.layerManager.deleteLayer(layer.id, { skipHistory: true });
			return result;
		});
		assert.strictEqual(replay.duration, 3000);
		assert(replay.replays, 'Finite motion must move again after the loop wraps');
		assert(replay.current >= 2250 && replay.current < 2300, 'Current frame must use wrapped time');
		assert(replay.badge.includes('Seamless'), 'Returning finite motion must show a seamless badge');
		const timings = await page.evaluate(async () => {
			const e = editor;
			const scan = e.layerManager.addLayer(LayerType.FILTER);
			scan.filterData = GlitterFilter.normalizeFilterData({ type: 'scanlines', spacing: 4, crawl: 'medium' });
			const source = e.sceneCompositor._createFilterTimelineSources(scan)[0];
			const samples = [0, 100, 200, 300, 400].map((timestamp) => source.sampleAt(timestamp).frameIndex);
			const node = e.filterLayerManager.renderLayer(scan);
			e.animationTicker.stop();
			const ticker = e.animationTicker.targets.get(`filter-animation-${scan.id}`);
			ticker.target.paint(200);
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const offset = getComputedStyle(node.querySelector('.filter-layer-gradient')).backgroundPositionY;
			ticker.target.paint(0);
			const off = e.sceneCompositor._createFilterTimelineSources({ ...scan, filterData: GlitterFilter.normalizeFilterData({ type: 'scanlines' }) }).length;
			e.layerManager.deleteLayer(scan.id, { skipHistory: true });
			const hue = e.layerManager.addLayer(LayerType.FILTER);
			hue.filterData = GlitterFilter.normalizeFilterData({ type: 'hue-cycle', speed: 0.8 });
			clearTimeout(e.filterLayerManager.snapshotTimers.get(hue.id));
			await e.filterLayerManager.renderSnapshot(hue, true);
			const output = e.filterLayerManager.snapshotOutputs.get(hue.id);
			const index = Math.floor(output.frames.length / 2);
			const preview = output.frames[index].getContext('2d').getImageData(0, 0, 32, 24).data;
			const exported = await e.sceneCompositor.composeFrameAt({ ...e.getSceneSnapshotParams(e.layers), timestamp: index * output.frameDuration });
			const parity = Array.from(preview).every((value, i) => value === exported.imageData.data[i]);
			const changesHue = preview[0] !== e.originalImageData.data[0];
			e.layerManager.deleteLayer(hue.id, { skipHistory: true });
			return { samples, offset, off, parity, changesHue, frames: output.frames.length };
		});
		assert.deepStrictEqual(timings.samples, [0, 2, 4, 6, 0]);
		if (process.env.GLITTER_TEST_CSS) assert.strictEqual(timings.offset, '2px', 'CSS crawl and export must have the same pixel offset');
		assert.strictEqual(timings.off, 0);
		assert(timings.parity && timings.changesHue && timings.frames > 1, 'Hue snapshots must animate and match export pixels');
		const fitting = await page.evaluate(async () => {
			const e = editor;
			const fixed = e.layerManager.addLayer(LayerType.FILTER);
			fixed.filterData = GlitterFilter.normalizeFilterData({ type: 'dither', shimmer: true, palette: 'bw' });
			const hue = e.layerManager.addLayer(LayerType.FILTER);
			hue.filterData = GlitterFilter.normalizeFilterData({ type: 'hue-cycle', speed: 1.4 });
			const shape = e.layerManager.addLayer(LayerType.SHAPE);
			getLayerFillSlot(shape).mode = 'solid';
			shape.animations = [GlitterAnimation.normalizeAnimation({ type: 'wobble', periodMs: 1400 })];
			e.saveState('Loop fixture');
			e.modalManager.open('exportSettingsModal');
			document.getElementById('openAnimationLoop').click();
			if (document.getElementById('exportSettingsModal').classList.contains('visible') || document.getElementById('animationLoopSection').classList.contains('is-collapsed')) throw new Error('Animation Loop button must close the modal and expand the panel');
			await e.updateExportDuration();
			const candidate = e.loopEstimate.loopFit.candidates.find((entry) => entry.duration === 800);
			document.getElementById('animationLoopCandidate').value = '800'; document.getElementById('animationLoopCandidate').dispatchEvent(new Event('change', { bubbles: true })); await e.updateExportDuration();
			const beforeUi = {
				fit: !document.getElementById('fitAnimationsToLoop').hidden,
				length: !document.getElementById('animationLoopLengthSet').hidden,
				restore: !document.getElementById('resetAnimationLoop').hidden
			};
			const beforeColumns = document.getElementById('animationLoopSources').tHead.rows[0].cells.length;
			const before = e.historyManager.historyIndex;
			e.fitAnimationsToLoop();
			const fitted = { hue: hue.filterData.speed, motion: shape.animations[0].periodMs, history: e.historyManager.historyIndex - before };
			await e.historyManager.undo();
			const undone = e.layers.find((layer) => layer.id === hue.id).filterData.speed;
			await e.historyManager.redo();
			await e.updateExportDuration();
			const refitted = e.layers.find((layer) => layer.id === hue.id).filterData.speed;
			const seam = e.loopEstimate.exact;
			const selected = document.getElementById('animationLoopSources').querySelectorAll('button').length;
			const staleCandidate = e.loopEstimate;
			e.saveState('Invalidate loop');
			const fittedColumns = document.getElementById('animationLoopSources').tHead.rows[0].cells.length;
			const badge = document.querySelector('#animationLoopStatus .badge').textContent;
			return { fitted, undone, refitted, seam, selected, beforeUi, beforeColumns, fittedColumns, badge, candidate: candidate.exact, staleCleared: !e.loopEstimate && !!staleCandidate };
		});
		assert(fitting.candidate && fitting.seam);
		assert.deepStrictEqual(fitting.fitted, { hue: 0.8, motion: 800, history: 1 });
		assert.strictEqual(fitting.undone, 1.4); assert.strictEqual(fitting.refitted, 0.8);
		assert(fitting.selected >= 3 && fitting.staleCleared);
		assert.deepStrictEqual(fitting.beforeUi, { fit: true, length: true, restore: false });
		assert.strictEqual(fitting.beforeColumns, 2);
		assert.strictEqual(fitting.fittedColumns, 3);
		assert.strictEqual(fitting.badge, 'Seamless');
		assert.strictEqual(await page.locator('#animationLoopStatus').innerText(), '0.80 s loop\nSeamless');
		assert(await page.locator('#animationLoopChangeSet').isVisible(), 'Already fitted timing belongs below the source table');
		assert.strictEqual(await page.locator('#animationLoopChanges').innerText(), 'Timing already fits.');
		assert.strictEqual(await page.locator('#animationLoopSources td[aria-label="No saved timing"]').innerText(), '-');
		assert(await page.locator('#animationLoopSourceSet').isVisible());
		assert(await page.locator('#animationLoopLengthSet').isVisible(), 'The local loop length control must remain available after fitting');
		assert(!(await page.locator('#fitAnimationsToLoop').isVisible()), 'An unavailable fit action must be hidden');
		assert(await page.locator('#resetAnimationLoop').isVisible(), 'Saved timing must remain available to restore');
		const restored = await page.evaluate(async () => {
			await editor.updateExportDuration();
			const table = document.getElementById('animationLoopSources');
			const row = Array.from(table.tBodies[0].rows).find((entry) => entry.cells[0].textContent.includes('Hue Cycle'));
			const times = Array.from(row.cells).slice(1).map((cell) => cell.textContent);
			const hueId = editor.layers.find((layer) => layer.filterData?.type === 'hue-cycle').id;
			row.querySelector('th button').click();
			const navigates = editor.layerManager.getActiveLayer().id === hueId;
			editor.openAnimationLoop();
			await editor.updateExportDuration();
			const before = editor.historyManager.historyIndex;
			const saved = editor.layers.filter((layer) => layer.loopOriginalPeriods).map((layer) => editor.layerManager.serializeLayer(layer));
			const roundTrips = await Promise.all(saved.map((layer) => editor.layerManager.deserializeLayer(layer)));
			const persists = roundTrips.every((layer, index) => JSON.stringify(layer.loopOriginalPeriods) === JSON.stringify(saved[index].loopOriginalPeriods));
			document.getElementById('resetAnimationLoop').click();
			const hue = editor.layers.find((layer) => layer.filterData?.type === 'hue-cycle');
			const shape = editor.layers.find((layer) => layer.type === LayerType.SHAPE);
			const result = { hue: hue.filterData.speed, motion: shape.animations[0].periodMs, history: editor.historyManager.historyIndex - before, persists, cleared: !hue.loopOriginalPeriods && !shape.loopOriginalPeriods, times, navigates };
			await editor.historyManager.undo();
			result.undo = editor.layers.find((layer) => layer.id === hue.id).filterData.speed;
			await editor.historyManager.redo();
			result.redo = editor.layers.find((layer) => layer.id === hue.id).filterData.speed;
			return result;
		});
		assert.deepStrictEqual(restored, { hue: 1.4, motion: 1400, history: 1, persists: true, cleared: true, undo: 0.8, redo: 1.4, times: ['0.80 s', '1.40 s'], navigates: true });
		const slow = await page.evaluate(() => {
			const data = GlitterFilter.normalizeFilterData({ type: 'scanlines', spacing: 4, crawl: 'slow' });
			const animation = GlitterFilter.animation(data);
			return Array.from({ length: animation.frames + 1 }, (_, index) => GlitterFilter.resolve(data, index).ops[0].gradient.offset);
		});
		assert.deepStrictEqual(slow, [...Array.from({ length: 16 }, (_, index) => index / 4), 0], 'Slow crawl must advance uniformly through the wrap');
		await verifyTimelineDock();
		await verifyTimingModel();
		await verifyGifCycle();
		await page.setViewportSize({ width: 390, height: 844 });
		await page.waitForFunction(() => editor.mobileManager.isMobile);
		await page.evaluate(() => editor.openAnimationLoop());
		await page.waitForFunction(() => editor.mobileManager.sheetSection?.element.id === 'animationLoopSection');
		assert(await page.locator('#animationLoopStatus').isVisible(), 'Phone helper must mount its section into the sheet');
		await page.evaluate(() => editor.openAnimationLoop());
		assert(await page.locator('#animationLoopStatus').isVisible(), 'Opening the current helper must keep it open');
		assert.deepStrictEqual(errors, []);
		console.log('PASS animated filter timing, crawl CSS steps, hue pixel parity, loop fit, one-step undo/redo, and stale estimate invalidation');
	} finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });

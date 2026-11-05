'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium, webkit } = require('playwright');
const browserType = process.env.GLITTER_BROWSER === 'webkit' ? webkit : chromium;

const css = process.env.GLITTER_TEST_CSS;
const output = path.resolve('.tmp/inspector-completion');
const wait = (page) => page.waitForTimeout(400);

async function press(page, title) {
	await page.evaluate((name) => {
		const mobile = window.editor.mobileManager;
		mobile.chipBar.render();
		const entry = mobile.chipBar.entries.find((candidate) => candidate.title === name);
		if (!entry) throw new Error(`Missing chip: ${name}`);
		mobile.chipBar.pressChip(entry);
	}, title);
	await wait(page);
}

async function swipe(page, start, end) {
	const session = await page.context().newCDPSession(page);
	const touch = (x, y) => [{ x, y, id: 1 }];
	await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(start.x, start.y) });
	for (let step = 1; step <= 12; step++) {
		await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(start.x + (end.x - start.x) * step / 12, start.y) });
		await page.waitForTimeout(16);
	}
	await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await session.detach();
}

async function verifyCanvasCentering(page) {
	await page.evaluate(() => window.editor.setTool(ToolType.HAND));
	for (const zoom of [0.5, 4]) {
		const before = await page.evaluate(value => {
			const viewport = window.editor.viewport;
			viewport.setZoom(value);
			viewport.panBy(73, 61);
			return { x: viewport.panX, y: viewport.panY };
		}, zoom);
		await page.locator('#centerCanvasHorizontal').click();
		await wait(page);
		assert.equal(await page.evaluate(() => window.editor.viewport.panY), before.y, 'Center H preserves vertical pan');
		const centeredX = await page.evaluate(() => window.editor.viewport.panX);
		await page.locator('#centerCanvasVertical').click();
		await wait(page);
		assert.equal(await page.evaluate(() => window.editor.viewport.panX), centeredX, 'Center V preserves horizontal pan');
		assert(await page.evaluate(value => {
			const viewport = window.editor.viewport;
			const area = viewport.getUsableRect();
			const workspace = window.editor.previewContainer.getBoundingClientRect();
			const canvas = window.editor.previewWrapper.getBoundingClientRect();
			return viewport.currentZoom === value
				&& Math.abs(canvas.left + canvas.width / 2 - workspace.left - area.left - area.width / 2) < 1
				&& Math.abs(canvas.top + canvas.height / 2 - workspace.top - area.top - area.height / 2) < 1;
		}, zoom), 'Hand controls center the actual canvas in the usable area at small and oversized zoom');
	}
}

async function main() {
	fs.mkdirSync(output, { recursive: true });
	const browser = await browserType.launch();
	try {
		const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
		const page = await context.newPage();
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		if (css) await page.route('**/css/style.css*', (route) => route.fulfill({ contentType: 'text/css', body: fs.readFileSync(css) }));
		await page.goto(process.env.GLITTER_URL || 'http://localhost/glitter/', { waitUntil: 'networkidle' });
		await page.evaluate(async () => {
			window.editor.modalManager.closeAll({ force: true });
			await window.editor.loadBlankImage(300, 240, '#ffffff');
			window.editor.setTool(ToolType.SELECT);
		});
		await wait(page);
		assert.deepEqual(await page.evaluate(() => window.editor.mobileManager.chipBar.entries.filter((entry) => entry.button).map((entry) => entry.title)), ['Sticker', 'Fill Layer', 'Shape', 'Text']);
		assert(await page.locator('.mobile-layers-swatch').evaluate((node) => node.classList.contains('is-unset')));
		assert(await page.locator('.phone-chip.is-add').count() === 4);
		assert(await page.locator('#quickActionAddSparkles').count() === 1, 'Sparkles remains available in Quick Add');
		assert(await page.locator('#quickActionAddPhotoShape').count() === 1, 'Photo in Shape remains available in Quick Add');
		for (let run = 0; browserType === chromium && run < 3; run++) {
			await page.locator('#phoneChipBar').evaluate((node) => { node.scrollLeft = 0; });
			const rect = await page.locator('#phoneChipBar').boundingBox();
			await swipe(page, { x: rect.x + rect.width - 35, y: rect.y + rect.height / 2 }, { x: rect.x + 25, y: rect.y + rect.height / 2 });
			assert(await page.locator('#phoneChipBar').evaluate((node) => node.scrollLeft > 50), 'Native chip swipe must scroll every time');
		}
		console.log(`PASS permanent phone bar, ordered Add chips and unset swatch${browserType === chromium ? ', with repeated native scrolling' : ' (native swipe covered in Chromium)'}`);
		await page.screenshot({ path: path.join(output, 'phone-canvas-bar.png') });

		await page.evaluate(() => window.editor.viewport.setZoom(1.25));
		const samples = await page.evaluate(async () => {
			const editor = window.editor;
			const mobile = editor.mobileManager;
			const entry = mobile.chipBar.entries.find((candidate) => candidate.title === 'Size');
			const samples = [];
			const sample = (phase) => new Promise((resolve) => {
				const start = performance.now();
				const frame = () => {
					const tween = editor.viewport.viewTween;
					samples.push({ phase, time: performance.now() - start, shown: tween?.shown.zoom ?? editor.viewport.currentZoom, target: editor.viewport.currentZoom, transform: editor.previewWrapper.style.transform, sheet: document.getElementById('designPanel').getBoundingClientRect().top });
					if (performance.now() - start < 360) requestAnimationFrame(frame);
					else resolve();
				};
				requestAnimationFrame(frame);
			});
			mobile.chipBar.pressChip(entry);
			await sample('open');
			mobile.closeAllDrawers();
			await sample('close');
			return samples;
		});
		fs.writeFileSync(path.join(output, 'animation.json'), JSON.stringify(samples, null, 2));
		for (const phase of ['open', 'close']) {
			const frames = samples.filter((sample) => sample.phase === phase);
			assert(frames.some((frame) => frame.time > 120 && frame.time < 200 && Math.abs(frame.shown - frame.target) > 0.005), `${phase} must keep animating past the pixel-zoom debounce`);
			assert(frames.every((frame) => Math.abs(Number(frame.transform.match(/scale\(([^)]+)\)/)[1]) - frame.shown) < 0.0001), `${phase} transform must follow the animated view every frame`);
		}
		console.log('PASS canvas and sheet keep animating together on open and close');

		const textId = await page.evaluate(async () => {
			const editor = window.editor;
			const layer = editor.textGlitterManager.createLayer({ text: 'Hello', position: { x: 150, y: 120 } });
			editor.layerManager.insertLayer(layer);
			editor.layerManager.setActiveLayer(layer.id);
			await editor.textGlitterManager.refreshLayer(layer, { saveHistory: false });
			return layer.id;
		});
		await wait(page);
		await press(page, 'Type');
		assert(await page.evaluate(() => {
			const editor = window.editor;
			const box = getLayersCanvasBox(editor, editor.layerManager.getSelectedLayers(), { visual: true });
			const rect = editor.viewport.getUsableRect();
			const padding = CONFIG.ui.mobile.editingViewportPadding;
			const expected = Math.max(CONFIG.ui.zoom.levels[0], Math.min(CONFIG.ui.zoom.levels.at(-1),
				(rect.width - padding) / (box.right - box.left), (rect.height - padding) / (box.bottom - box.top)));
			return Math.abs(editor.viewport.currentZoom - expected) < 0.001;
		}), 'The selected object fits the available editing area with padding');
		assert(await page.evaluate(() => {
			const box = getLayersCanvasBox(window.editor, window.editor.layerManager.getSelectedLayers(), { visual: true });
			const state = window.editor.viewport.captureViewState();
			return Math.abs(state.focusX - (box.left + box.right) / 2) < 1 && Math.abs(state.focusY - (box.top + box.bottom) / 2) < 1;
		}), 'The edited object is centered above the sheet');
		const editingView = await page.evaluate(() => window.editor.viewport.captureViewState());
		if (css) assert.equal(await page.locator('[data-panel-resize="inspector"]').evaluate((node) => getComputedStyle(node).display), 'none', 'Desktop panel resize handle is hidden on mobile');
		await page.evaluate(() => window.editor.fontBrowserManager.openPicker());
		await wait(page);
		const libraryView = await page.evaluate(() => window.editor.viewport.captureViewState());
		assert.equal(libraryView.zoom, editingView.zoom, 'Switching to Library preserves zoom');
		assert(Math.abs(libraryView.focusX - editingView.focusX) < 1 && Math.abs(libraryView.focusY - editingView.focusY) < 1, 'Switching to Library preserves focus');
		assert(await page.evaluate(() => window.editor.fontBrowserManager.browser.rail.selection.root === LIBRARY_ALL_ID), 'Default font opens All');
		assert(await page.locator('#libraryBack').isVisible(), 'Font Library must have Back');
		await page.locator('#libraryBack').click();
		await wait(page);
		assert.equal(await page.locator('#inspectorTitleText').textContent(), 'Type');
		await press(page, 'Fill');
		await page.evaluate(() => window.editor.textGlitterManager.armPicker('fill'));
		await wait(page);
		assert(await page.evaluate(() => window.editor.glitterLibrary.browser.rail.selection.root === LIBRARY_ALL_ID), 'Default fill opens All');
		await page.locator('#libraryBack').click();
		await wait(page);
		assert(await page.locator('#flyoutSection').isVisible());
		await page.screenshot({ path: path.join(output, 'phone-fill-back.png') });
		console.log('PASS Library Back returns to both inline and flyout sections');
		if (css) {
			await press(page, 'Style');
			assert.equal(await page.locator('#libraryWindow').evaluate((node) => getComputedStyle(node).boxShadow), 'none', 'Flyout sheets share the Inspector shadow');
			assert.equal(await page.locator('#textStylePresets').evaluate((node) => getComputedStyle(node).overflowY), 'visible', 'Style uses the pane scroller');
			await page.screenshot({ path: path.join(output, 'phone-style.png') });
		}

		await page.evaluate(() => {
			window.editor.mobileManager.closeAllDrawers({ immediate: true });
			window.editor.setTool(ToolType.TEXT);
			window.editor.mobileManager.chipBar.render();
		});
		await press(page, 'Type');
		const count = await page.evaluate(() => window.editor.layers.length);
		await page.touchscreen.tap(180, 160);
		assert.equal(await page.evaluate(() => window.editor.layers.length), count, 'Hidden Text tool must not create a layer');
		assert(await page.evaluate(() => window.editor.isCanvasToolSuspended()));
		await page.evaluate(() => window.editor.mobileManager.closeAllDrawers({ immediate: true }));
		assert(!await page.evaluate(() => window.editor.isCanvasToolSuspended()));
		console.log('PASS hidden tools suspend canvas actions and resume when the sheet closes');

		await page.setViewportSize({ width: 390, height: 500 });
		await wait(page);
		await press(page, 'Transform');
		assert(await page.locator('#inspectorClose').isVisible());
		await page.locator('#textRotation').evaluate((node) => {
			node.value = '30';
			node.dispatchEvent(new Event('input', { bubbles: true }));
			node.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await wait(page);
		assert(await page.locator('#inspectorReset').isEnabled());
		await page.locator('#inspectorReset').click();
		await wait(page);
		assert.equal(await page.evaluate(() => window.editor.layerManager.getInspectedLayer().transform.rotation), 0, 'Sheet header must forward the Transform reset');
		await page.screenshot({ path: path.join(output, 'phone-short-transform.png') });
		await page.goBack();
		await wait(page);
		assert.equal(await page.evaluate(() => window.editor.mobileManager.activeDrawer), null, 'Browser Back must dismiss the sheet');
		await page.goForward();
		await wait(page);
		assert.equal(await page.evaluate(() => window.editor.mobileManager.activeDrawer), null, 'Forward must not revive a dismissed picker');
		await press(page, 'Transform');
		await page.keyboard.press('Escape');
		await wait(page);
		assert.equal(await page.evaluate(() => window.editor.mobileManager.activeDrawer), null, 'Escape must dismiss inline sheets');
		console.log('PASS browser Back, Forward and Escape dismiss sheets without stale sessions');
		await verifyCanvasCentering(page);
		await press(page, 'Transform');
		await verifyCanvasCentering(page);
		await page.keyboard.press('Escape');
		await wait(page);
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.waitForTimeout(800);
		await verifyCanvasCentering(page);
		console.log('PASS Hand centering keeps zoom and the other axis on phone and desktop, including oversized canvases');
		await page.evaluate((id) => { window.editor.setTool(ToolType.SELECT); window.editor.layerManager.setActiveLayer(id); window.editor.viewport.zoomToFill(); }, textId);
		// The flyout floats: opening, closing and switching it moves no dock.
		await page.evaluate(async () => { await editor.ensureTimelineDock(); PREFERENCES.set('timelineOpen', true); await editor.updateExportDuration(); });
		await wait(page);
		const layout = () => page.evaluate(() => ({
			rect: window.editor.previewContainer.getBoundingClientRect().toJSON(),
			timeline: document.getElementById('timelineDock').getBoundingClientRect().toJSON(),
			usable: window.editor.viewport.getUsableRect(),
			flyout: window.editor.libraryWindow.flyoutOpen
		}));
		const closed = await layout();
		assert(closed.timeline.width > 0, 'The timeline dock is showing for the layout check');
		assert.equal(await page.locator('#flyoutToggle').count(), 0, 'The flyout has no collapse chevron');
		await page.evaluate(() => window.editor.pickers.toggleFlyout('Style'));
		await wait(page);
		const floating = await layout();
		assert(floating.flyout, 'Pressing a line opens the floating flyout');
		assert.deepEqual(floating.rect, closed.rect, 'Opening the flyout must not resize the canvas area');
		assert.deepEqual(floating.timeline, closed.timeline, 'Opening the flyout must not resize the timeline dock');
		assert.deepEqual(floating.usable, closed.usable, 'Opening the flyout leaves the usable rect alone');
		const placed = await page.evaluate(() => {
			const box = document.getElementById('flyoutWindow').getBoundingClientRect();
			const inspector = document.getElementById('designPanel').getBoundingClientRect();
			const canvas = document.getElementById('previewContainer').getBoundingClientRect();
			const line = document.querySelector('.property-line.is-flyout-open').getBoundingClientRect();
			return { position: getComputedStyle(document.getElementById('flyoutWindow')).position, box: box.toJSON(), inspectorLeft: inspector.left, canvas: canvas.toJSON(), lineTop: line.top };
		});
		if (css) {
			assert.equal(placed.position, 'absolute', 'The flyout floats out of the layout');
			assert(placed.box.right <= placed.inspectorLeft + 0.5 && placed.inspectorLeft - placed.box.right < 40, 'The flyout sits against the Inspector edge');
			assert(placed.box.top >= placed.canvas.top - 0.5 && placed.box.bottom <= placed.canvas.bottom + 0.5, 'The flyout stays inside the canvas area');
			assert(placed.box.top <= placed.lineTop + 0.5 || placed.box.bottom >= placed.canvas.bottom - 40, 'The flyout lines up with the row that opened it unless clamped');
			assert.notEqual(await page.locator('#flyoutWindow').evaluate((node) => getComputedStyle(node).boxShadow), 'none', 'The floating flyout has window chrome');
		}
		await page.keyboard.press('Escape');
		await wait(page);
		const escaped = await layout();
		assert(!escaped.flyout && !await page.locator('#flyoutWindow').isVisible(), 'Escape closes the flyout');
		assert.deepEqual([escaped.rect, escaped.timeline], [closed.rect, closed.timeline], 'Closing the flyout leaves the canvas and timeline alone');
		await page.evaluate(() => window.editor.pickers.toggleFlyout('Style'));
		await wait(page);
		await page.locator('#flyoutHeader').click({ position: { x: 4, y: 4 } });
		assert(await page.evaluate(() => window.editor.libraryWindow.flyoutOpen), 'A press inside the flyout keeps it open');
		const stage = await page.locator('#previewContainer').boundingBox();
		await page.mouse.move(stage.x + 30, stage.y + 30);
		await page.mouse.down();
		await page.mouse.up();
		await wait(page);
		assert(!await page.evaluate(() => window.editor.libraryWindow.flyoutOpen), 'A press outside closes the flyout');
		await page.evaluate((id) => { window.editor.setTool(ToolType.SELECT); window.editor.layerManager.setActiveLayer(id); window.editor.pickers.toggleFlyout('Style'); }, textId);
		await wait(page);
		await page.locator('#flyoutClose').click();
		await wait(page);
		const afterClose = await layout();
		assert(!afterClose.flyout, 'Close closes the flyout');
		assert.deepEqual([afterClose.rect, afterClose.timeline], [closed.rect, closed.timeline], 'Open and close leave the canvas and timeline where they were');
		console.log('PASS the desktop flyout floats beside the Inspector without moving the canvas or timeline; Esc, outside press and Close dismiss it');
		// A fill arms the Library in the left dock: nothing on the right reflows.
		const before = await layout();
		const dockLayout = () => page.evaluate(() => ({
			library: window.editor.libraryWindow.isOpen,
			libraryShowing: document.getElementById('libraryWindow').getBoundingClientRect().height > 0,
			layersShowing: document.getElementById('layersList').getBoundingClientRect().height > 0,
			activeTab: document.querySelector('#layersPanel [data-dock-tab].active')?.dataset.dockTab,
			dockRight: document.getElementById('layersPanel').getBoundingClientRect().right,
			inspectorLeft: document.getElementById('designPanel').getBoundingClientRect().left,
			flyoutRight: document.getElementById('flyoutWindow').getBoundingClientRect().right
		}));
		assert.equal((await dockLayout()).activeTab, 'layers', 'Layers is the left dock default');
		await page.evaluate(() => window.editor.pickers.toggleFlyout('fill'));
		await wait(page);
		const after = await layout();
		assert.deepEqual(after.rect, before.rect, 'Arming a glitter picker must not resize the canvas area');
		assert.deepEqual(after.timeline, before.timeline, 'Arming a glitter picker must not resize the timeline');
		assert.deepEqual(after.usable, before.usable, 'Arming a glitter picker leaves the usable rect alone');
		const armed = await dockLayout();
		assert(armed.library && armed.libraryShowing && !armed.layersShowing && armed.activeTab === 'library', 'An armed picker shows the Library tab in the left dock');
		assert(armed.flyoutRight <= armed.inspectorLeft + 0.5 && armed.inspectorLeft - armed.flyoutRight < 40, 'The flyout stays against the Inspector edge while the Library is armed');
		assert(await page.locator('#layersPanel #libraryWindow').count() === 1, 'The Library lives in the left dock');
		assert(await page.locator('#layersPanel').isVisible(), 'The left dock stays');
		await page.screenshot({ path: path.join(output, 'desktop-overlay.png') });
		// Ending the pick restores Layers; a hidden left dock shows for the pick only.
		await page.evaluate(() => { window.editor.pickers.flyout = null; window.editor.pickers.closeAll(); });
		await wait(page);
		assert.equal((await dockLayout()).activeTab, 'layers', 'Ending the pick restores the Layers tab');
		assert.deepEqual((await layout()).rect, before.rect, 'Ending the pick leaves the canvas area alone');
		await page.evaluate(() => setDockVisible('layers', false));
		await wait(page);
		assert(!await page.locator('#layersPanel').isVisible(), 'View hides the left dock');
		await page.evaluate(() => window.editor.pickers.toggleFlyout('fill'));
		await wait(page);
		assert((await dockLayout()).libraryShowing && await page.locator('#layersPanel').isVisible(), 'A picker armed with the left dock hidden shows it for the pick');
		await page.evaluate(() => { window.editor.pickers.flyout = null; window.editor.pickers.closeAll(); });
		await wait(page);
		assert(!await page.locator('#layersPanel').isVisible() && await page.evaluate(() => isDockVisible('layers')) === false, 'The dock hides again and the temporary show is not stored');
		await page.evaluate(() => setDockVisible('layers', true));
		// Browsing by hand: the Library tab with a kind chooser, no picker armed.
		const tabsRect = () => page.evaluate(() => {
			const shown = Array.from(document.querySelectorAll('#layersPanel .dock-tabs')).filter((node) => node.getBoundingClientRect().width > 0);
			const r = shown[0].getBoundingClientRect();
			return { count: shown.length, x: r.x, y: r.y, width: r.width, height: r.height };
		});
		const tabsBefore = await tabsRect();
		assert.equal(tabsBefore.count, 1, 'One copy of the dock tabs shows');
		await page.locator('#layersPanel .dock-tabs [data-dock-tab="library"]:visible').click();
		await wait(page);
		assert.deepEqual(await tabsRect(), tabsBefore, 'Switching to the Library leaves the tabs where they were');
		const browsing = await dockLayout();
		assert(browsing.libraryShowing && !browsing.layersShowing && browsing.library && !await page.evaluate(() => Boolean(window.editor.pickers.active)), 'The Library tab opens by hand without arming a picker');
		await page.selectOption('#libraryBrowseKind', 'sticker');
		await wait(page);
		assert.equal(await page.evaluate(() => document.getElementById('designGallerySection').dataset.library), 'sticker', 'The kind chooser picks the browsed Library');
		assert.deepEqual(await tabsRect(), tabsBefore, 'Switching the kind leaves the tabs where they were');
		assert.deepEqual((await layout()).rect, before.rect, 'Browsing the Library leaves the canvas area alone');
		// Free browsing: a press replaces on a sticker layer, and adds a sticker layer otherwise.
		const freePress = (kind) => page.evaluate(async (which) => {
			const library = which === 'sticker' ? editor.stickerLibrary : editor.glitterLibrary;
			await library.selectItem(library.getAllContent()[0]);
			return { count: editor.layerManager.layers.length, type: editor.layerManager.getActiveLayer()?.type };
		}, kind);
		await page.evaluate((id) => editor.layerManager.setActiveLayer(id), textId);
		const layerCount = await page.evaluate(() => editor.layerManager.layers.length);
		const added = await freePress('sticker');
		assert(added.count === layerCount + 1 && added.type === 'sticker', 'A free-browse sticker press with a text layer selected adds a sticker layer');
		const replaced = await freePress('sticker');
		assert(replaced.count === added.count && replaced.type === 'sticker', 'With a sticker layer selected it replaces');
		await page.evaluate((id) => editor.layerManager.setActiveLayer(id), textId);
		const filled = await freePress('glitter');
		assert(filled.count === replaced.count && filled.type === 'text-glitter', 'A free-browse glitter press on a text layer replaces its fill');
		await page.locator('#layersPanel .dock-tabs [data-dock-tab="layers"]:visible').click();
		await wait(page);
		assert.deepEqual(await tabsRect(), tabsBefore, 'Returning to Layers leaves the tabs where they were');
		assert.equal((await dockLayout()).activeTab, 'layers', 'The Layers tab returns by hand');
		await page.evaluate(() => window.editor.pickers.toggleFlyout('fill'));
		await wait(page);
		if (css) {
			assert(await page.evaluate(() => {
				const rect = document.getElementById('viewMenu').getBoundingClientRect();
				const workspace = document.getElementById('previewContainer').getBoundingClientRect();
				const area = editor.viewport.getOverlayRect();
				const viewButton = document.getElementById('pauseMotionTool');
				const contextButton = document.querySelector('#panControls .btn-icon');
				return Math.abs(rect.x + rect.width / 2 - workspace.x - area.left - area.width / 2) < 1
					&& getComputedStyle(viewButton).height === getComputedStyle(contextButton).height;
			}), 'View menu shares the workspace center and context button scale');
			await page.evaluate(() => document.getElementById('textFillGradient').click());
			await wait(page);
			const presets = page.locator('[data-gradient-editor="textFill"][data-gradient-part="presets"]');
			assert(await presets.evaluate((node) => node.classList.contains('is-collapsed')));
			assert((await presets.boundingBox()).height < 50, 'Closed presets reserve only their title');
			await presets.locator('[data-set-toggle]').click();
			assert.equal(await presets.locator('.property-scrollbox').evaluate((node) => getComputedStyle(node).height), '232px', 'Gradient presets keep their fixed height');
			await page.screenshot({ path: path.join(output, 'desktop-gradient-presets.png') });
			console.log('PASS shared sheet shadow, pane scrolling and collapsible preset sizing');
		}
		// Undo keeps the Library armed for the open section: the session is not
		// ended and re-armed, so the Library is not revealed a second time.
		const undone = await page.evaluate(async () => {
			const editor = window.editor;
			const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60))));
			editor.pickers.flyout = null;
			editor.pickers.closeAll();
			const shape = editor.layerManager.addLayer(LayerType.SHAPE);
			await frames();
			editor.pickers.flyout = null;
			editor.pickers.closeAll();
			editor.pickers.toggleFlyout('fill');
			await frames();
			let reveals = 0;
			const reveal = window.revealAssetBrowser;
			window.revealAssetBrowser = (...args) => { reveals += 1; return reveal(...args); };
			editor.saveState('before');
			shape.opacity = 0.5;
			editor.saveState('after');
			await editor.undo();
			await frames();
			window.revealAssetBrowser = reveal;
			const session = editor.pickers.active?.pickerSession;
			return { reveals, flyout: editor.pickers.flyout, kind: session?.kind, slot: session?.slot, layer: session?.layerId === shape.id };
		});
		assert.deepEqual(undone, { reveals: 0, flyout: 'fill', kind: 'paint', slot: 'fill', layer: true }, 'Undo with Fill open keeps its session and leaves the Library still');
		// A panel showing its empty state lists no sections, so the phone bar has
		// no chips for controls that are hidden.
		const emptied = await page.evaluate(() => {
			const editor = window.editor;
			editor.pickers.flyout = null;
			editor.pickers.closeAll();
			const sticker = editor.layerManager.addLayer(LayerType.STICKER);
			const host = document.getElementById('stickerSettingsSection');
			const withSource = getPanelSectionIndex(host).length;
			sticker.stickerSourceId = null;
			editor.refreshInspector();
			return { withSource: withSource > 0, sections: getPanelSectionIndex(host).length, empty: document.getElementById('stickerSettingsEmpty').classList.contains('visible') };
		});
		assert.deepEqual(emptied, { withSource: true, sections: 0, empty: true }, 'A sticker with no source shows its empty state and no sections');
		console.log('PASS undo keeps an open section armed, and an empty panel lists no sections');
		assert.deepEqual(errors, []);
		console.log('PASS short screen, breakpoint cleanup and desktop workspace overlay; no page errors');
	} finally {
		await browser.close();
	}
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

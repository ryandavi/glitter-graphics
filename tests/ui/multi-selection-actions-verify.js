'use strict';

const assert = require('assert');
const { openApp } = require('../lib/app');

async function verify(touch) {
	const { browser, page, errors } = await openApp({
		viewport: touch ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
		touch,
		document: { width: 500, height: 400 }
	});
	try {
		await page.evaluate(async () => {
			const e = editor;
			const check = (condition, label) => { if (!condition) throw new Error(label); };
			const a = e.layerManager.addLayer(LayerType.SHAPE);
			const b = e.layerManager.addLayer(LayerType.SHAPE);
			a.shapeData.width = 100; a.shapeData.height = 80;
			b.shapeData.width = 160; b.shapeData.height = 120;
			a.transform.proportionalScale = false;
			[a, b].forEach(layer => e.shapeGlitterManager.renderLayer(layer));
			e.layerManager.setSelection([a.id, b.id], { activeLayerId: b.id });
			e.saveState('Multi-selection fixture');
			const ids = [a.id, b.id];
			const layers = () => ids.map(id => e.layerManager.getLayerById(id));
			const snapshot = () => JSON.stringify(layers().map(layer => e.layerManager.serializeLayer(layer)));
			const click = async id => {
				const button = document.getElementById(id);
				check(button && !button.disabled, `${id} is available`);
				const before = snapshot();
				const index = e.historyManager.historyIndex;
				button.click();
				while (e._multiSelectionActionActive) await new Promise(resolve => setTimeout(resolve, 10));
				const after = snapshot();
				check(e.historyManager.historyIndex === index + 1, `${id} saves one step`);
				await e.undo();
				await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
				check(snapshot() === before, `${id} undo restores both layers`);
				await e.redo();
				await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
				check(snapshot() === after, `${id} redo restores both layers`);
				check(ids.every(id => e.layerManager.isLayerSelected(id)), `${id} preserves selection`);
			};
			await click('multiSelectionMatchWidth');
			check(layers()[0].shapeData.width === 160 && layers()[0].shapeData.height === 80, 'Match width keeps unlocked height');
			layers()[0].transform.proportionalScale = true;
			e.saveState('Aspect lock fixture');
			await click('multiSelectionMatchHeight');
			check(layers()[0].shapeData.height === 120 && layers()[0].shapeData.width === 240, 'Match height respects aspect lock');
			const anchors = layers().map(layer => getLayerAnchorPoint(e, layer));
			await click('multiSelectionFlipX');
			await click('multiSelectionFlipY');
			check(layers().every(layer => layer.transform.flipX && layer.transform.flipY), `Both flips apply to every selected layer: ${JSON.stringify(layers().map(layer => layer.transform))}`);
			check(JSON.stringify(layers().map(layer => getLayerAnchorPoint(e, layer))) === JSON.stringify(anchors), 'Flips preserve layer anchors');
			await click('multiSelectionHide');
			check(layers().every(layer => !layer.visible), 'Hide applies to all');
			await click('multiSelectionFlipX');
			check(layers().every(layer => !layer.transform.flipX), 'Hidden layers can still be flipped');
			await click('multiSelectionShow');
			check(layers().every(layer => layer.visible), 'Show applies to all');
			const show = document.getElementById('multiSelectionShow');
			check(!show.disabled && show.getAttribute('aria-pressed') === 'true', 'Active visibility segment stays enabled');
			const noOpHistory = e.historyManager.historyIndex;
			show.click();
			while (e._multiSelectionActionActive) await new Promise(resolve => setTimeout(resolve, 10));
			check(e.historyManager.historyIndex === noOpHistory, 'Clicking active state does not add history');
			await click('multiSelectionLock');
			check(layers().every(layer => layer.locked), 'Lock applies to all');
			check(document.getElementById('multiSelectionMatchWidth').disabled && document.getElementById('multiSelectionFlipX').disabled, 'Locks disable transforms');
			await click('multiSelectionUnlock');
			check(layers().every(layer => !layer.locked), 'Unlock applies to all');
			check(!document.getElementById('multiSelectionUnlock').disabled, 'Active lock segment stays enabled');
			const source = layers()[1];
			source.shapeData.fill.mode = 'solid'; source.shapeData.fill.color = '#ff1234';
			source.opacity = 65; source.blendMode = 'screen';
			e.saveState('Appearance fixture');
			const geometry = layers().map(layer => [layer.shapeData.width, layer.shapeData.height, layer.transform.position]);
			await click('multiSelectionCopyAppearance');
			check(layers()[0].shapeData.fill.color === '#ff1234' && layers()[0].opacity === 65 && layers()[0].blendMode === 'screen', 'Copy appearance applies paint, opacity and blend');
			check(JSON.stringify(layers().map(layer => [layer.shapeData.width, layer.shapeData.height, layer.transform.position])) === JSON.stringify(geometry), 'Copy appearance preserves geometry');
			check(layers()[0].shapeData.fill !== layers()[1].shapeData.fill, 'Copied paint is independent');
			const base = e.layers.find(layer => layer.type === LayerType.BASE_IMAGE);
			e.layerManager.setSelection([base.id, a.id]);
			document.getElementById('multiSelectionLock').click();
			while (e._multiSelectionActionActive) await new Promise(resolve => setTimeout(resolve, 10));
			document.getElementById('multiSelectionUnlock').click();
			while (e._multiSelectionActionActive) await new Promise(resolve => setTimeout(resolve, 10));
			check(base.locked, 'Base Image remains protected');
			check(document.getElementById('multiSelectionCopyAppearance').disabled, 'Incompatible source disables copying');
			const textSource = e.textGlitterManager.createLayer({ text: 'Source' });
			const textTarget = e.textGlitterManager.createLayer({ text: 'Keep my words' });
			const lockedTarget = e.textGlitterManager.createLayer({ text: 'Locked' });
			for (const layer of [textSource, textTarget, lockedTarget]) {
				e.layerManager.insertLayer(layer);
				await e.textGlitterManager.refreshLayer(layer, { saveHistory: false });
			}
			textSource.textData.fill.mode = 'solid'; textSource.textData.fill.color = '#12ab34';
			lockedTarget.locked = true;
			e.layerManager.setSelection([textSource.id, textTarget.id, lockedTarget.id, b.id], { activeLayerId: textSource.id });
			e.saveState('Text appearance fixture');
			const lockedBefore = JSON.stringify(e.layerManager.serializeLayer(lockedTarget));
			const shapeBefore = JSON.stringify(e.layerManager.serializeLayer(e.layerManager.getLayerById(b.id)));
			const textHistory = e.historyManager.historyIndex;
			document.getElementById('multiSelectionCopyAppearance').click();
			while (e._multiSelectionActionActive) await new Promise(resolve => setTimeout(resolve, 10));
			check(textTarget.textData.text === 'Keep my words' && textTarget.textData.fill.color === '#12ab34', 'Text paint copies without changing words');
			check(JSON.stringify(e.layerManager.serializeLayer(lockedTarget)) === lockedBefore, 'Locked appearance target stays unchanged');
			check(JSON.stringify(e.layerManager.serializeLayer(e.layerManager.getLayerById(b.id))) === shapeBefore, 'Incompatible appearance target stays unchanged');
			check(e.historyManager.historyIndex === textHistory + 1, 'Text appearance uses one history step');
			const imageTarget = e.layerManager.getLayerById(a.id);
			imageTarget.shapeData.fill.mode = 'image';
			e.layerManager.setSelection([imageTarget.id, b.id], { activeLayerId: b.id });
			await e.copyMultiSelectionAppearance();
			check(imageTarget.shapeData.fill.mode === 'image', 'Image fills remain unchanged when copying solid paint');
		});
		assert.deepStrictEqual(errors, [], 'No browser errors');
		console.log(`PASS multi-selection actions, history, aspect locks and protected layers (${touch ? 'phone' : 'desktop'})`);
	} finally {
		await browser.close();
	}
}

(async () => {
	await verify(false);
	await verify(true);
})().catch(error => { console.error(error); process.exit(1); });

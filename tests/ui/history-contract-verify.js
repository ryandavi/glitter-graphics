'use strict';

const assert = require('assert');
const { chromium } = require('playwright');

async function main() {
	const browser = await chromium.launch();
	const failures = [];
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(process.env.GLITTER_URL || 'http://localhost/glitter/');
		await page.waitForFunction(() => window.editor && APP_BOOT.isComplete('library'));
		await page.evaluate(async () => {
			document.querySelectorAll('.modal-overlay.visible').forEach(node => node.classList.remove('visible'));
			await FontLibrary.ensureLoaded(CONFIG.tools.text.defaultFontId);
			window.historyAudit = {
				async reset() {
					editor.textGlitterManager.endTextEdit();
					await editor.loadBlankImage(160, 120, '#ffffff');
					while (!editor.originalImage) await new Promise(resolve => setTimeout(resolve, 10));
					editor.setTool(ToolType.SELECT);
					document.activeElement?.blur();
				},
				shape() { return editor.layerManager.addLayer(LayerType.SHAPE); },
				document() {
					const state = editor.historyManager.createStateSnapshot();
					return JSON.stringify({ layers: state.layers, canvas: state.canvas && { width: state.canvas.width, height: state.canvas.height, pixels: Array.from(state.canvas.imageData.data) } });
				},
				stroke(finish = true) {
					const rect = editor.previewWrapper.getBoundingClientRect();
					if (!editor.maskEditor._startStrokeFromScreenPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)) throw new Error('Stroke failed to start');
					if (finish) editor.maskEditor._finishStroke();
				},
				key(key, extra = {}) { return editor.handleKeyboard(new KeyboardEvent('keydown', { key, cancelable: true, ...extra })); }
			};
		});
		const rows = [
			['Add fill', '', 'editor.layerManager.addLayer(LayerType.GLITTER_FILL)'],
			['Add shape', '', 'historyAudit.shape()'],
			['Add filter', '', 'editor.layerManager.addLayer(LayerType.FILTER)'],
			['Shape click', 'editor.setTool(ToolType.SHAPE)', 'TOOLS[ToolType.SHAPE].onCanvasAction(editor, { x: 80, y: 60, hitCanvas: true })'],
			['Line drag', 'editor.setTool(ToolType.LINE)', 'TOOLS[ToolType.LINE].onCanvasDrag(editor, { isClick: false, start: { x: 20, y: 20 }, end: { x: 100, y: 60 } })'],
			['Text creation', 'editor.setTool(ToolType.TEXT)', 'await createTextAt(editor, { position: { x: 20, y: 40 } }); editor.textGlitterManager.applyTextEdit(editor.layerManager.getActiveLayer(), "Words"); editor.textGlitterManager.endTextEdit()'],
			['Hide layer', 'historyAudit.shape()', 'editor.layerManager.toggleLayerVisibility(editor.activeLayerId)'],
			['Show layer', 'historyAudit.shape(); editor.layerManager.toggleLayerVisibility(editor.activeLayerId)', 'editor.layerManager.toggleLayerVisibility(editor.activeLayerId)'],
			['Lock layer', 'historyAudit.shape()', 'editor.layerManager.toggleLayerLock(editor.activeLayerId)'],
			['Unlock layer', 'historyAudit.shape(); editor.layerManager.toggleLayerLock(editor.activeLayerId)', 'editor.layerManager.toggleLayerLock(editor.activeLayerId)'],
			['Duplicate layer', 'historyAudit.shape()', 'editor.layerManager.cloneLayer(editor.activeLayerId)'],
			['Delete layer', 'historyAudit.shape()', 'editor.layerManager.deleteLayer(editor.activeLayerId)'],
			['Brush from shape selection', 'historyAudit.shape(); editor.setTool(ToolType.BRUSH)', 'historyAudit.stroke()'],
			['Fill first click', 'historyAudit.shape(); editor.setTool(ToolType.GLITTER_FILL)', 'editor.handleColorPickAction(80, 60)'],
			['Remove color', 'editor.setTool(ToolType.GLITTER_FILL); editor.handleColorPickAction(80, 60)', 'editor.removeColorSelection(0)'],
			['Immediate nudge', 'historyAudit.shape()', 'historyAudit.key("ArrowRight")'],
			['Opacity range', 'editor.layerManager.addLayer(LayerType.GLITTER_FILL)', 'const input = document.getElementById("opacity"); input.value = "50"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }))']
		];
		for (const [name, setup, action] of rows) {
			try {
				await page.evaluate(() => historyAudit.reset());
				const result = await page.evaluate(async ({ setup, action }) => {
					await new Function(`return (async () => { ${setup} })()`)();
					await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
					const before = historyAudit.document(), start = editor.historyManager.historyIndex;
					await new Function(`return (async () => { ${action} })()`)();
					const after = historyAudit.document(), tool = editor.currentTool;
					await editor.undo();
					const undone = historyAudit.document(), undoTool = editor.currentTool;
					const step = editor.historyManager.history[editor.historyManager.historyIndex + 1];
					await editor.redo();
					return { before, after, undone, redone: historyAudit.document(), tool, undoTool, redoTool: editor.currentTool, delta: editor.historyManager.historyIndex - start, label: step?.label };
				}, { setup, action });
				assert.equal(result.delta, 1, 'action must add one step');
				assert.notEqual(result.before, result.after, 'action must change document');
				assert.equal(result.undone, result.before, 'undo document');
				assert.equal(result.redone, result.after, 'redo document');
				assert.equal(result.undoTool, result.tool, 'undo tool');
				assert.equal(result.redoTool, result.tool, 'redo tool');
				assert(result.label && !['Edit layers', 'Edit document', 'Paint mask'].includes(result.label), `retired label: ${result.label}`);
				console.log(`PASS ${name}`);
			} catch (error) { failures.push(`${name}: ${error.message.split('\n')[0]}`); }
		}
		const probes = [
			['Typing keeps edit session', async () => {
				await page.evaluate(() => createTextAt(editor, { position: { x: 20, y: 40 } }));
				await page.locator('#canvasTextInput').pressSequentially('one two three');
				await page.keyboard.press('Control+z');
				assert(await page.evaluate(() => Boolean(editor.textGlitterManager.editSession)), 'canvas typing ended');
				assert.equal(await page.locator('#canvasTextInput').inputValue(), 'one two ');
				await page.keyboard.press('Control+z');
				assert.equal(await page.locator('#canvasTextInput').inputValue(), 'one ');
				await page.keyboard.press('Control+Shift+z');
				assert.equal(await page.locator('#canvasTextInput').inputValue(), 'one two ');
			}],
			['Free text keeps native undo', async () => {
				const result = await page.evaluate(() => {
					historyAudit.shape();
					const input = document.createElement('input'); input.type = 'search'; document.body.append(input); input.focus();
					const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
					input.dispatchEvent(event); input.remove(); return event.defaultPrevented;
				});
				assert.equal(result, false, 'document command claimed search undo');
			}],
			['Restore queue', async () => {
				assert(await page.evaluate(async () => {
					for (let i = 0; i < 3; i++) historyAudit.shape();
					const h = editor.historyManager, restore = h.restoreState.bind(h);
					let active = 0, max = 0;
					h.restoreState = async (...args) => { max = Math.max(max, ++active); await new Promise(resolve => setTimeout(resolve, h.historyIndex === 2 ? 80 : 5)); await restore(...args); active--; };
					try { await Promise.all([editor.undo(), editor.undo()]); return max === 1 && historyAudit.document() === JSON.stringify({ layers: h.history[h.historyIndex].layers, canvas: { width: 160, height: 120, pixels: Array.from(editor.originalImageData.data) } }); }
					finally { h.restoreState = restore; }
				}), 'overlapping restores');
			}],
			['Coalescing closes on restore', async () => {
				assert(await page.evaluate(async () => {
					historyAudit.shape(); const layer = editor.layerManager.getActiveLayer();
					layer.opacity = 0.8; editor.saveState('Change opacity', { coalesceKey: 'probe' });
					layer.opacity = 0.6; editor.saveState('Change opacity'); await editor.undo();
					const index = editor.historyManager.historyIndex; editor.layerManager.getActiveLayer().opacity = 0.4; editor.saveState('Change opacity', { coalesceKey: 'probe' });
					return editor.historyManager.historyIndex === index + 1;
				}), 'edit overwrote state landed on');
			}],
			['Modal blocks history', async () => {
				assert(await page.evaluate(async () => {
					historyAudit.shape(); await editor.modalManager.open('settingsModal');
					const index = editor.historyManager.historyIndex; historyAudit.key('z', { ctrlKey: true });
					await new Promise(resolve => setTimeout(resolve, 100)); await editor.modalManager.close('settingsModal', { force: true });
					return editor.historyManager.historyIndex === index;
				}), 'document changed under modal');
			}],
			['Undo cancels brush drag only', async () => {
				assert(await page.evaluate(async () => {
					historyAudit.shape(); editor.setTool(ToolType.BRUSH); historyAudit.stroke(false);
					const index = editor.historyManager.historyIndex; await editor.undo();
					return !editor.maskEditor.strokeActive && editor.historyManager.historyIndex === index;
				}), 'undo also stepped document during drag');
			}],
			['Touched selection', async () => {
				assert(await page.evaluate(async () => {
					const x = historyAudit.shape(), y = historyAudit.shape();
					editor.layerManager.setSelection([x.id]); historyAudit.key('ArrowRight');
					await new Promise(resolve => setTimeout(resolve, CONFIG.ui.history.coalesceMs + 20));
					editor.layerManager.setSelection([y.id]); await editor.undo(); return editor.activeLayerId === x.id;
				}), 'undo selected previous snapshot instead of touched layer');
			}]
		];
		for (const [name, run] of probes) {
			try { await page.evaluate(() => historyAudit.reset()); await run(); console.log(`PASS ${name}`); }
			catch (error) { failures.push(`${name}: ${error.message.split('\n')[0]}`); }
		}
		assert.deepEqual(errors, [], 'browser errors');
		for (const failure of failures) console.error(`FAIL ${failure}`);
		assert.equal(failures.length, 0, `${failures.length} history contract rows failed`);
		console.log(`PASS History contract: ${rows.length + probes.length} rows`);
	} finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

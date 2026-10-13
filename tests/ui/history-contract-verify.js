'use strict';

const assert = require('assert');
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const { assertByteIdentity, exportSnapshot } = require('../parity/export-harness');

async function main() {
	const browser = await chromium.launch();
	const failures = [];
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		// Replay the audit against an earlier revision without changing the tree.
		if (process.env.HISTORY_BASELINE) {
			const revision = process.env.HISTORY_BASELINE;
			const paths = execFileSync('git', ['diff', '--name-only', revision, '--', 'js'], { encoding: 'utf8' }).trim().split('\n');
			const sources = new Map(paths.filter(path => path.endsWith('.js')).map(path => [path, execFileSync('git', ['show', `${revision}:${path}`], { maxBuffer: 10 * 1024 * 1024 })]));
			await page.route('**/js/**', route => {
				const path = new URL(route.request().url()).pathname.replace(/^.*?\/js\//u, 'js/');
				return sources.has(path) ? route.fulfill({ contentType: 'text/javascript', body: sources.get(path) }) : route.continue();
			});
		}
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
				change(id, value) {
					const input = document.getElementById(id);
					if (input.type === 'checkbox') input.checked = value; else input.value = value;
					input.dispatchEvent(new Event('input', { bubbles: true }));
					input.dispatchEvent(new Event('change', { bubbles: true }));
				},
				point(x, y) {
					const rect = editor.previewWrapper.getBoundingClientRect();
					return { clientX: rect.left + x * editor.viewport.currentZoom, clientY: rect.top + y * editor.viewport.currentZoom, pointerType: 'mouse', button: 0 };
				},
				shape() { return editor.layerManager.addLayer(LayerType.SHAPE); },
				document() {
					const state = editor.historyManager.createStateSnapshot();
					return JSON.stringify({ layers: state.layers, loop: state.loop, canvas: state.canvas && { width: state.canvas.width, height: state.canvas.height, pixels: Array.from(state.canvas.imageData.data) } });
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
			['Replace base image', '', 'const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 120; const ctx = canvas.getContext("2d"); ctx.fillStyle = "#00ff00"; ctx.fillRect(0, 0, 160, 120); const blob = await new Promise(resolve => canvas.toBlob(resolve)); await editor.replaceBaseImageFile(new File([blob], "replacement.png", { type: "image/png" }))'],
			['Duplicate selection', 'historyAudit.shape(); historyAudit.shape(); editor.layerManager.setSelection(editor.layers.slice(1).map(layer => layer.id))', 'editor.layerManager.cloneLayers([...editor.selectedLayerIds])'],
			['Delete selection', 'historyAudit.shape(); historyAudit.shape(); editor.layerManager.setSelection(editor.layers.slice(1).map(layer => layer.id))', 'editor.layerManager.deleteLayers([...editor.selectedLayerIds])'],
			['Brush from sticker selection', 'editor.layerManager.addLayer(LayerType.STICKER); editor.setTool(ToolType.BRUSH)', 'historyAudit.stroke()'],
			['Fill from sticker selection', 'editor.layerManager.addLayer(LayerType.STICKER); editor.setTool(ToolType.GLITTER_FILL)', 'editor.handleColorPickAction(80, 60)'],
			['Select stays selected over empty fill restore', 'editor.layerManager.addLayer(LayerType.GLITTER_FILL); editor.setTool(ToolType.SELECT)', 'historyAudit.shape()'],
			['Color control', 'editor.layerManager.setSelection([editor.layers[0].id])', 'historyAudit.change("baseBackgroundColor", "#ff0000")'],
			['Add frame', '', 'editor.layerManager.addLayer(LayerType.FRAME)'],
			['Add sparkles', '', 'editor.layerManager.addLayer(LayerType.SPARKLES)'],
			['Add sticker', '', 'editor.layerManager.addLayer(LayerType.STICKER)'],
			['Reorder layers', 'historyAudit.shape(); historyAudit.shape()', 'const lm = editor.layerManager; lm.draggedLayerId = editor.layers[1].id; lm.dropTargetId = editor.layers[2].id; lm.dropInsertAbove = true; lm.handleLayerDrop({ preventDefault() {} })'],
			['Rename layer', 'historyAudit.shape()', 'document.querySelector(`[data-layer-id="${editor.activeLayerId}"] .layer-name`).dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); const input = document.querySelector(".layer-name-input"); input.value = "Renamed"; input.blur()'],
			['Loop length', '', "editor.setDocumentLoop({ mode: 'set', durationMs: 3000 })"],
			['Number control', 'historyAudit.shape()', 'historyAudit.change("shapePosX", "90")'],
			['Toggle control', 'historyAudit.shape()', 'historyAudit.change("shapeFlipX", true)'],
			['Select control', 'historyAudit.shape()', 'historyAudit.change("shapeTransformAnchor", "0,0")'],
			['Erase stroke', 'editor.setTool(ToolType.BRUSH); historyAudit.stroke(); editor.maskEditor.setMode("sub")', 'historyAudit.stroke()'],
			['Clear paint', 'editor.setTool(ToolType.BRUSH); editor.maskEditor.setMode("add"); historyAudit.stroke()', 'const confirm = editor.confirmAction; editor.confirmAction = async () => true; document.getElementById("clearMaskPaint").click(); await new Promise(resolve => setTimeout(resolve, 0)); editor.confirmAction = confirm'],
			['Pen first two points', 'editor.setTool(ToolType.PEN); editor.layerManager.clearSelection()', 'editor.pathEdit.press(historyAudit.point(20, 20)); editor.pathEdit.release(historyAudit.point(20, 20)); editor.pathEdit.press(historyAudit.point(100, 60)); editor.pathEdit.release(historyAudit.point(100, 60))'],
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
					const undoStatus = document.getElementById('statusText').textContent;
					const step = editor.historyManager.history[editor.historyManager.historyIndex + 1];
					await editor.redo();
					return { before, after, undone, redone: historyAudit.document(), tool, undoTool, redoTool: editor.currentTool, delta: editor.historyManager.historyIndex - start, label: step?.label, undoStatus, redoStatus: document.getElementById('statusText').textContent };
				}, { setup, action });
				assert.equal(result.delta, 1, 'action must add one step');
				assert.notEqual(result.before, result.after, 'action must change document');
				assert.equal(result.undone, result.before, 'undo document');
				if (process.env.HISTORY_DIAGNOSTICS && result.redone !== result.after) console.log(name, JSON.stringify({ after: JSON.parse(result.after).layers, redone: JSON.parse(result.redone).layers }));
				assert.equal(result.redone, result.after, 'redo document');
				assert.equal(result.undoTool, result.tool, 'undo tool');
				assert.equal(result.redoTool, result.tool, 'redo tool');
				assert(result.label && !['Edit layers', 'Edit document', 'Paint mask'].includes(result.label), `retired label: ${result.label}`);
				assert.equal(result.undoStatus, `Undo: ${result.label}`, 'undo feedback');
				assert.equal(result.redoStatus, `Redo: ${result.label}`, 'redo feedback');
				console.log(`PASS ${name}`);
			} catch (error) { failures.push(`${name}: ${error.message.split('\n')[0]}`); }
		}
		const probes = [
			['Failed project decode preserves document and history', async () => {
				assert(await page.evaluate(async () => {
					historyAudit.shape();
					const project = await editor.projectSerializer.serialize();
					const layer = editor.glitterManager.createLayer();
					project.layers.push(editor.layerManager.serializeLayer(layer));
					project.masks[layer.id] = { add: 'data:image/png;base64,broken' };
					const before = historyAudit.document(), index = editor.historyManager.historyIndex;
					editor.isSaved = true;
					try { await editor.projectSerializer.load(project); return false; }
					catch { return before === historyAudit.document() && index === editor.historyManager.historyIndex; }
				}), 'failed load changed live document');
			}],
			...['canvas', 'image', 'project'].map(target => [`Replace document during ${target === 'image' ? 'path' : 'text'} edit (${target})`, async () => {
				assert(await page.evaluate(async target => {
					const e = editor;
					const project = target === 'project' ? await e.projectSerializer.serialize() : null;
					if (target === 'image') {
						e.setTool(ToolType.PEN);
						e.pathEdit.press(historyAudit.point(20, 20)); e.pathEdit.release(historyAudit.point(20, 20));
						e.pathEdit.press(historyAudit.point(100, 60)); e.pathEdit.release(historyAudit.point(100, 60));
					} else {
						await createTextAt(e, { position: { x: 20, y: 40 } });
						e.textGlitterManager.applyTextEdit(e.layerManager.getActiveLayer(), 'Unfinished text');
					}
					const tool = e.currentTool;
					if (target === 'canvas') await e.loadBlankImage(200, 150, '#ffffff');
					else if (target === 'project') { e.isSaved = true; await e.projectSerializer.load(project); }
					else {
						const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 150;
						const blob = await new Promise(resolve => canvas.toBlob(resolve));
						await e.loadImageFile(new File([blob], 'replacement.png', { type: 'image/png' }));
					}
					return e.currentTool === tool && !e.getActiveSession() && !e.historyManager.canUndo()
						&& !e.textGlitterManager.editSession && !e.pathEdit.session;
				}, target), 'replacement retained a stale session, tool or undo step');
			}]),
			['Ten queued undos and redos', async () => {
				assert(await page.evaluate(async () => {
					const index = editor.historyManager.historyIndex;
					for (let i = 0; i < 10; i++) historyAudit.shape();
					const after = historyAudit.document(), tool = editor.currentTool;
					await Promise.all(Array.from({ length: 10 }, () => editor.undo()));
					if (editor.historyManager.historyIndex !== index || editor.layers.length !== 1 || editor.currentTool !== tool) return false;
					await Promise.all(Array.from({ length: 10 }, () => editor.redo()));
					return historyAudit.document() === after && editor.currentTool === tool;
				}), 'queued steps did not return to the same document');
			}],
			['Text pause, caret and branching', async () => {
				await page.evaluate(() => createTextAt(editor, { position: { x: 20, y: 40 } }));
				const initialText = await page.locator('#canvasTextInput').inputValue();
				await page.locator('#canvasTextInput').pressSequentially('ab');
				await page.waitForTimeout(await page.evaluate(() => CONFIG.ui.history.textPauseMs + 20));
				await page.locator('#canvasTextInput').pressSequentially('cd');
				await page.keyboard.press('Control+z');
				assert.equal(await page.locator('#canvasTextInput').inputValue(), 'ab');
				assert.deepEqual(await page.evaluate(() => { const s = editor.textGlitterManager.editSession; return [s.selectionStart, s.selectionEnd]; }), [2, 2]);
				await page.locator('#canvasTextInput').pressSequentially('e');
				assert.equal(await page.evaluate(() => editor.historyManager.canRedo()), false);
				await page.keyboard.press('Control+z'); assert.equal(await page.locator('#canvasTextInput').inputValue(), 'ab');
				await page.keyboard.press('Control+z'); assert.equal(await page.locator('#canvasTextInput').inputValue(), initialText);
				await page.keyboard.press('Control+z');
				assert.equal(await page.evaluate(() => editor.textGlitterManager.editSession), null, 'exhausted session falls through');
				assert.equal(await page.evaluate(() => editor.layers.filter(layer => layer.textData).length), 0);
			}],
			['Path nudges split across pauses', async () => {
				assert(await page.evaluate(async () => {
					editor.setTool(ToolType.LINE); TOOLS[ToolType.LINE].onCanvasDrag(editor, { isClick: false, start: { x: 20, y: 20 }, end: { x: 100, y: 60 } });
					editor.pathEdit.begin(editor.layerManager.getActiveLayer()); editor.pathEdit.session.selection = new Set(['0:1']);
					const index = editor.historyManager.historyIndex;
					editor.pathEdit.nudge({ key: 'ArrowRight' }); await new Promise(resolve => setTimeout(resolve, CONFIG.ui.history.coalesceMs + 20));
					editor.pathEdit.nudge({ key: 'ArrowRight' }); return editor.historyManager.historyIndex === index + 2;
				}), 'path nudges across a pause merged');
			}],
			['Pending panel text commits before undo', async () => {
				assert(await page.evaluate(async () => {
					await createTextAt(editor, { position: { x: 20, y: 40 } });
					const manager = editor.textGlitterManager;
					manager.applyTextEdit(editor.layerManager.getActiveLayer(), 'Before'); manager.endTextEdit();
					manager.applyTextEdit(editor.layerManager.getActiveLayer(), 'After'); await editor.undo();
					await new Promise(resolve => setTimeout(resolve, CONFIG.ui.live.settleMs + 50));
					return editor.layerManager.getActiveLayer().textData.text === 'Before' && editor.historyManager.canRedo();
				}), 'pending text was lost or its timer cleared redo');
			}],
			['Nudge pauses split bursts', async () => {
				assert(await page.evaluate(async () => {
					historyAudit.shape(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
					const index = editor.historyManager.historyIndex;
					historyAudit.key('ArrowRight'); await new Promise(resolve => setTimeout(resolve, CONFIG.ui.history.coalesceMs + 20));
					historyAudit.key('ArrowRight'); await new Promise(resolve => setTimeout(resolve, CONFIG.ui.history.coalesceMs + 20));
					return editor.historyManager.historyIndex === index + 2;
				}), 'nudges across a pause merged');
			}],
			['Crop session steps', async () => {
				assert(await page.evaluate(async () => {
					editor.setTool(ToolType.CROP); const bounds = editor.canvasBounds;
					const before = JSON.stringify(bounds.snapshot()), index = editor.historyManager.historyIndex;
					bounds.setRect({ x: 10, y: 10, width: 100, height: 80 }); const after = JSON.stringify(bounds.snapshot());
					if (bounds.undoStack.length !== 1) return false;
					if (!bounds.undoStack.at(-1).label) throw new Error('Crop session step has no label');
					await editor.undo(); if (JSON.stringify(bounds.snapshot()) !== before || editor.currentTool !== ToolType.CROP) return false;
					await editor.redo(); return JSON.stringify(bounds.snapshot()) === after && editor.historyManager.historyIndex === index && editor.currentTool === ToolType.CROP;
				}), 'crop session leaked into document history');
			}],
			['Polygon area session', async () => {
				assert(await page.evaluate(async () => {
					editor.setTool(ToolType.AREA); const index = editor.historyManager.historyIndex;
					for (const [x, y] of [[20, 20], [100, 20], [100, 80]]) editor.areaSelect.addPolygonCorner(historyAudit.point(x, y));
					if (editor.areaSelection.history.undoStack.length) return false;
					editor.areaSelect.closePolygon(); const after = JSON.stringify(editor.areaSelection.ops);
					if (editor.areaSelection.history.undoStack.length !== 1 || !editor.areaSelection.history.undoStack.at(-1).label) return false;
					await editor.undo(); if (!editor.areaSelection.isEmpty) return false;
					await editor.redo(); return JSON.stringify(editor.areaSelection.ops) === after && editor.historyManager.historyIndex === index && editor.currentTool === ToolType.AREA;
				}), 'polygon corners must commit one area step on closure');
			}],
			['Modify Area session', async () => {
				assert(await page.evaluate(async () => {
					editor.setTool(ToolType.AREA); editor.areaSelection.apply([[{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 70 }, { x: 20, y: 70 }]]);
					const area = editor.areaSelection, index = editor.historyManager.historyIndex, before = JSON.stringify(area.ops), steps = area.history.undoStack.length;
					editor.areaSelect.beginModify(Object.keys(AREA_MODIFIERS)[0]); editor.areaSelect.setModifyAmount(8);
					if (area.history.undoStack.length !== steps) return false;
					editor.areaSelect.applyModify(); const after = JSON.stringify(area.ops);
					if (after === before || area.history.undoStack.length !== steps + 1 || !area.history.undoStack.at(-1).label) return false;
					await editor.undo(); if (JSON.stringify(area.ops) !== before) return false;
					await editor.redo(); return JSON.stringify(area.ops) === after && editor.historyManager.historyIndex === index && editor.currentTool === ToolType.AREA;
				}), 'area modifications must commit one area step on Apply');
			}],
			['Select Area session steps', async () => {
				assert(await page.evaluate(async () => {
					editor.setTool(ToolType.AREA); const area = editor.areaSelection, index = editor.historyManager.historyIndex;
					area.apply([[{ x: 10, y: 10 }, { x: 80, y: 10 }, { x: 80, y: 70 }, { x: 10, y: 70 }]]);
					const after = JSON.stringify(area.ops); if (area.history.undoStack.length !== 1) return false;
					await editor.undo(); if (!area.isEmpty || editor.currentTool !== ToolType.AREA) return false;
					await editor.redo(); return JSON.stringify(area.ops) === after && editor.historyManager.historyIndex === index && editor.currentTool === ToolType.AREA;
				}), 'area session undo/redo');
			}],
			['Auto Glitter blocks document history', async () => {
				assert(await page.evaluate(async () => {
					historyAudit.shape(); editor.autoGlitterManager.startSession();
					const before = historyAudit.document(), index = editor.historyManager.historyIndex, tool = editor.currentTool;
					await editor.undo(); await editor.redo();
					return historyAudit.document() === before && editor.historyManager.historyIndex === index && editor.currentTool === tool;
				}), 'history changed during Auto Glitter');
				await page.evaluate(() => { editor.autoGlitterManager.session = null; });
			}],
			['Number and color fields use document history', async () => {
				for (const kind of ['number', 'color', 'hex', 'readout']) {
					assert(await page.evaluate(async kind => {
						historyAudit.shape(); const index = editor.historyManager.historyIndex;
						const control = document.createElement(kind === 'readout' ? 'span' : 'input');
						if (kind === 'readout') { control.contentEditable = 'true'; control.setAttribute('role', 'spinbutton'); }
						else control.type = kind === 'hex' ? 'text' : kind;
						if (kind === 'hex') control.className = 'color-hex-input';
						document.body.append(control); control.focus();
						const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }); control.dispatchEvent(event);
						await editor.historyManager.restoreQueue; control.remove();
						return event.defaultPrevented && editor.historyManager.historyIndex === index - 1;
					}, kind), `${kind} kept native undo`);
				}
			}],
			['Native field undo changes typing only', async () => {
				await page.evaluate(() => { historyAudit.shape(); const field = document.createElement('input'); field.id = 'historyNativeField'; field.type = 'search'; document.body.append(field); });
				const before = await page.evaluate(() => historyAudit.document());
				await page.locator('#historyNativeField').pressSequentially('Search words');
				await page.keyboard.press('Control+z');
				assert.notEqual(await page.locator('#historyNativeField').inputValue(), 'Search words');
				assert.equal(await page.evaluate(() => historyAudit.document()), before);
				await page.locator('#historyNativeField').evaluate(node => node.remove());
			}],
			['Pointer path drag cancels before history', async () => {
				assert(await page.evaluate(async () => {
					editor.setTool(ToolType.PEN); editor.pathEdit.press(historyAudit.point(20, 20)); editor.pathEdit.release(historyAudit.point(20, 20));
					editor.pathEdit.press(historyAudit.point(100, 60)); const index = editor.historyManager.historyIndex;
					await editor.undo(); return !editor.pathEdit.session?.drag && editor.historyManager.historyIndex === index;
				}), 'path drag survived or document stepped');
			}],
			['Pointer area drag cancels before history', async () => {
				assert(await page.evaluate(async () => {
					historyAudit.shape(); editor.setTool(ToolType.AREA); editor.areaSelect.press(historyAudit.point(20, 20)); editor.areaSelect.move(historyAudit.point(100, 60));
					const index = editor.historyManager.historyIndex; await editor.undo();
					return !editor.areaSelect.drag && editor.historyManager.historyIndex === index;
				}), 'area drag survived or document stepped');
			}],
			['Navigation and selection are not document steps', async () => {
				assert(await page.evaluate(() => {
					historyAudit.shape(); const before = historyAudit.document(), index = editor.historyManager.historyIndex;
					editor.setTool(ToolType.SELECT); TOOLS[ToolType.SELECT].onCanvasAction(editor, { x: 1, y: 1, hitCanvas: true });
					const point = historyAudit.point(80, 60);
					editor.setTool(ToolType.HAND); TOOLS[ToolType.HAND].onCanvasAction(editor, point); editor.viewport.endPan();
					editor.setTool(ToolType.ZOOM); TOOLS[ToolType.ZOOM].onCanvasAction(editor, { ...point, options: {} });
					return historyAudit.document() === before && editor.historyManager.historyIndex === index;
				}), 'view or selection entered history');
			}],
			['Animated sticker export survives undo', async () => {
				await page.evaluate(() => { editor.layerManager.addLayer(LayerType.STICKER); editor.updatePreview(); });
				const first = await exportSnapshot(page, { maxFrames: 2 }, { minLayers: 2 });
				const second = await exportSnapshot(page, { maxFrames: 2 }, { minLayers: 2 });
				assertByteIdentity(first, second, 'Repeat animated sticker export');
				await page.evaluate(async () => { editor.layerManager.toggleLayerVisibility(editor.activeLayerId); await editor.undo(); });
				assertByteIdentity(first, await exportSnapshot(page, { maxFrames: 2 }, { minLayers: 2 }), 'Edit undo animated sticker export');
			}],
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
					try { await Promise.all([editor.undo(), editor.undo()]); return max === 1 && historyAudit.document() === JSON.stringify({ layers: h.history[h.historyIndex].layers, loop: h.history[h.historyIndex].loop, canvas: { width: 160, height: 120, pixels: Array.from(editor.originalImageData.data) } }); }
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

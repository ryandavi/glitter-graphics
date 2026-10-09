'use strict';

// Crop routes pointer gestures to the pending canvas bounds model.
class CropEditSession {
	constructor(editor) {
		this.editor = editor;
		this.chrome = null;
		this.drag = null;
		this.viewState = null;
		this.fitFrame = null;
		this.syncChrome = () => this.render();
		editor.previewContainer.addEventListener('dblclick', (event) => {
			if (editor.getActiveSession() === 'crop' && this.chrome?.hitTest(event.clientX, event.clientY) === 'move') editor.applyCanvasBounds();
		});
	}
	activate() {
		const editor = this.editor;
		if (!editor.originalImage || !editor.documentSize) return;
		this.viewState = {
			...editor.viewport.captureViewState(),
			width: editor.viewport.canvasWidth, height: editor.viewport.canvasHeight
		};
		editor.canvasBounds?.clear();
		editor.setDocumentSizeMode('canvas');
		const session = getSessionDefinition(editor);
		editor.notifications.setMode({ ...session.mode, exitLabel: 'Cancel crop (Esc)', onExit: () => editor.cancelCanvasBounds(), confirmLabel: 'Apply crop (Enter)', onConfirm: () => editor.applyCanvasBounds() });
		editor.syncCanvasBoundsViews();
		this.fitFrame = requestAnimationFrame(() => {
			this.fitFrame = null;
			this.fitView();
		});
	}
	fitView() {
		const editor = this.editor;
		const viewport = editor.viewport;
		const usable = viewport.getUsableRect();
		const workspace = editor.previewContainer.getBoundingClientRect();
		const rail = document.querySelector('.toolbar')?.getBoundingClientRect();
		const topControls = document.getElementById('previewControls')?.getBoundingClientRect();
		const cropControls = document.getElementById('cropEditControls')?.getBoundingClientRect();
		const left = Math.max(usable.left, rail?.width ? rail.right - workspace.left : usable.left);
		const top = Math.max(usable.top, topControls?.height ? topControls.bottom - workspace.top : usable.top);
		const right = usable.left + usable.width;
		const bottom = Math.min(usable.top + usable.height, cropControls?.height ? cropControls.top - workspace.top : usable.top + usable.height);
		viewport.zoomToFit({
			animate: true, padding: CONFIG.ui.zoom.cropPadding,
			rect: { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
		});
	}
	end() {
		cancelAnimationFrame(this.fitFrame);
		this.fitFrame = null;
		this.cancelDrag();
		this.editor.canvasBounds?.clear();
		this.editor.notifications.setMode(null);
		this.editor.syncCanvasBoundsViews();
		const viewport = this.editor.viewport;
		if (this.viewState?.width === viewport.canvasWidth && this.viewState.height === viewport.canvasHeight) {
			viewport.restoreViewState(this.viewState, { animate: true });
		}
		this.viewState = null;
	}
	render() {
		const editor = this.editor;
		const bounds = editor.canvasBounds;
		if (!bounds || !bounds.validate().ok) {
			this.chrome?.remove(); this.chrome = null;
			editor.viewport.selectionOverlay.removeSyncer(this.syncChrome);
			return;
		}
		const readOnly = editor.currentTool !== ToolType.CROP;
		if (!this.chrome?.element.isConnected || this.chrome.readOnly !== readOnly) {
			this.chrome?.remove();
			this.chrome = new SelectionChrome(editor.viewport.selectionOverlay, {
				layerId: 'canvas-bounds', readOnly,
				className: 'transform-handles canvas-bounds-chrome',
				handles: readOnly ? [] : ['corner-tl', 'corner-tr', 'corner-br', 'corner-bl', 'edge-top', 'edge-right', 'edge-bottom', 'edge-left'],
				titles: { corner: 'Resize · Shift toggles ratio · Alt from center · Ctrl bypasses snapping', edge: 'Resize · Shift toggles ratio · Alt from center · Ctrl bypasses snapping', move: 'Move crop bounds' }
			});
			this.chrome.onPointerDown((_handle, event) => this.handlePointerDown(event));
			editor.viewport.selectionOverlay.addSyncer(this.syncChrome);
		}
		const { x, y, width, height } = bounds.rect;
		this.chrome.render({ frame: { centerX: x + width / 2, centerY: y + height / 2, width, height, rotation: 0 }, shade: !readOnly, guides: readOnly ? null : 'thirds', badge: { text: `${width} × ${height}`, mode: 'size' } });
	}
	press(input) {
		if (!this.editor.canvasBounds) this.activate();
		if (!this.editor.canvasBounds) return;
		const point = this.editor.viewport.screenToCanvas(input.clientX, input.clientY);
		const handle = this.chrome?.hitTest(input.clientX, input.clientY, input.pointerType) || 'draw';
		const rect = { ...this.editor.canvasBounds.rect };
		const metrics = { corners: [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height }], centerX: rect.x + rect.width / 2, centerY: rect.y + rect.height / 2 };
		this.drag = { handle, rect, point, client: { x: input.clientX, y: input.clientY }, handleStart: getFrameHandlePoint(metrics, handle) };
	}
	move(input) {
		const drag = this.drag;
		if (!drag || !hasPassedDragThreshold(drag.client, input)) return;
		const editor = this.editor;
		const point = editor.viewport.screenToCanvas(input.clientX, input.clientY);
		const bounds = editor.canvasBounds;
		if (!bounds) return;
		bounds.beginStep();
		const locked =resolveAspectLock({ proportionalScale: Boolean(bounds.ratio) }, input);
		const ratio = locked ? bounds.ratio || { w: drag.rect.width, h: drag.rect.height } : null;
		if (drag.handle === 'move') {
			const moved = { x: drag.rect.x + point.x - drag.point.x, y: drag.rect.y + point.y - drag.point.y };
			const snapped = editor.snapTransformPosition({
				getFrameMetrics: () => ({ minX: drag.rect.x, maxX: drag.rect.x + drag.rect.width, minY: drag.rect.y, maxY: drag.rect.y + drag.rect.height }),
				getTransform: () => ({ position: { x: drag.rect.x, y: drag.rect.y } })
			}, moved, { ctrlKey: input.ctrlKey, kind: 'crop', excludedIds: [] });
			bounds.setRect({ ...drag.rect, x: snapped.x, y: snapped.y });
		} else if (drag.handle === 'draw') {
			const snapped = editor.snapScalePoint(null, point, { ctrlKey: input.ctrlKey, kind: 'crop', excludedIds: [] });
			let width = Math.abs(snapped.x - drag.point.x), height = Math.abs(snapped.y - drag.point.y);
			if (ratio) height = width * ratio.h / ratio.w;
			bounds.setRect({ x: input.altKey ? drag.point.x - width : snapped.x < drag.point.x ? drag.point.x - width : drag.point.x, y: input.altKey ? drag.point.y - height : snapped.y < drag.point.y ? drag.point.y - height : drag.point.y, width: Math.max(1, width * (input.altKey ? 2 : 1)), height: Math.max(1, height * (input.altKey ? 2 : 1)) });
		} else {
			const target = anchoredHandlePoint(drag.handleStart, drag.point, point);
			const horizontal = drag.handle.startsWith('corner-') || ['edge-left', 'edge-right'].includes(drag.handle);
			const vertical = drag.handle.startsWith('corner-') || ['edge-top', 'edge-bottom'].includes(drag.handle);
			const center = { x: drag.rect.x + drag.rect.width / 2, y: drag.rect.y + drag.rect.height / 2 };
			const origin = input.altKey ? center : { x: center.x * 2 - drag.handleStart.x, y: center.y * 2 - drag.handleStart.y };
			const line = ratio && horizontal && vertical ? { origin, dir: { x: Math.sign(drag.handleStart.x - center.x) * ratio.w, y: Math.sign(drag.handleStart.y - center.y) * ratio.h } } : null;
			const snapped = editor.snapScalePoint(null, target, { ctrlKey: input.ctrlKey, kind: 'crop', axes: horizontal && vertical ? 'xy' : horizontal ? 'x' : 'y', excludedIds: [], line });
			bounds.setRect(resizeRectFromHandle(drag.rect, drag.handle, snapped, { ratio, fromCenter: input.altKey }));
		}
	}
	release(input) { if (input) this.move(input); this.drag = null; this.editor.canvasBounds?.endStep(); this.editor.clearSmartGuides(); }
	cancelDrag() {
		this.drag = null; this.editor.canvasBounds?.cancelStep(); this.editor.clearSmartGuides();
	}
	handlePointerDown(event) {
		if (event.pointerType === 'touch' || event.button !== 0 || this.editor.currentTool !== ToolType.CROP || event.target.closest('.ui-ignore-gestures')) return;
		event.preventDefault(); event.stopPropagation();
		this.press(event);
		const node = event.currentTarget;
		node.setPointerCapture?.(event.pointerId);
		const move = (next) => this.move(next);
		const end = (next) => { this.release(next); cleanup(); };
		const cancel = () => { this.cancelDrag(); cleanup(); };
		const cleanup = () => { node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', end); node.removeEventListener('pointercancel', cancel); };
		node.addEventListener('pointermove', move); node.addEventListener('pointerup', end); node.addEventListener('pointercancel', cancel);
	}
	nudge(event) {
		const bounds = this.editor.canvasBounds;
		if (!bounds) return;
		const step = event.shiftKey ? CONFIG.ui.nudge.fastStep : CONFIG.ui.nudge.step;
		bounds.setRect({ ...bounds.rect, x: bounds.rect.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y: bounds.rect.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) }, 'nudge');
	}
}

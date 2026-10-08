// ============================================
// TOOLS
// The tool registry: one entry per canvas tool.
// ============================================
// Each entry holds every fact about a tool, so adding one means adding an
// entry here (plus its command in COMMANDS):
// - name, buttonLabel, icon: the toolbar button (rendered from this table in
//   toolbar order), the helpful-message chip and the guide.
// - command: the COMMANDS id whose key goes in the button title.
// - titleNote: extra button-title text after the shortcut.
// - groups: capability groups (TOOL_GROUPS) for focused editor modes.
// - touchRoute: how a touch on the canvas starts this tool's action.
// - available(editor, state): whether the button is enabled.
// - containerClass / wrapperClass: canvas cursor classes while active.
// - onCanvasAction(editor, action): a click or tap on the workspace. `action`
//   is { x, y, clientX, clientY, hitCanvas, event, options }.
// - onCanvasDrag(editor, drag): a drag that makes something (the creation
//   gesture, mouse and touch). `drag` is { box, isClick, start, end,
//   shiftKey }; `dragPreview: 'line'` previews it as a line, not a box.
// - onCanvasPointerDown(editor, event): the tool takes mouse and pen presses
//   on the workspace itself (the Pen). With `touchRoute: 'toolDrag'` its
//   onTouchDragStart / Move / End / Cancel(editor, { clientX, clientY })
//   receive a one-finger drag, and onCanvasAction a tap.
// - onActivate(editor) / onDeactivate(editor, nextTool): entering and leaving
//   the tool. Neither runs for the temporary Hand (Space).

const ToolType = {
	SELECT: 'select',
	TEXT: 'text',
	SHAPE: 'shape',
	LINE: 'line',
	PEN: 'pen',
	HAND: 'hand',
	GLITTER_FILL: 'glitterFill',
	BRUSH: 'brush',
	ZOOM: 'zoom'
};

// Editing tools are unavailable before an image exists and while Auto Glitter
// previews; navigation only needs an image.
const editingAvailable = (_editor, { hasImage, autoPreviewActive }) => hasImage && !autoPreviewActive;
const navigationAvailable = (_editor, { hasImage }) => hasImage;

const TOOLS = {
	[ToolType.SELECT]: {
		name: 'Select',
		buttonLabel: 'Select',
		icon: 'hand-pointer',
		hintName: 'Select Tool',
		command: 'toolSelect',
		toolbarGroup: 'arrange',
		groups: ['selection', 'contentEditing'],
		available: editingAvailable,
		onCanvasAction(editor, { x, y, hitCanvas, event }) {
			if (hitCanvas) {
				editor.handleLayerSelectAction(x, y, {
					toggleSelection: Boolean(event?.shiftKey),
					cycleDeep: Boolean(event?.altKey)
				});
			} else {
				editor.layerManager.clearSelection();
			}
		}
	},
	[ToolType.HAND]: {
		name: 'Hand',
		buttonLabel: 'Move',
		icon: 'hand',
		hintName: 'Hand Tool',
		command: 'toolHand',
		toolbarGroup: 'view',
		groups: ['navigation'],
		available: navigationAvailable,
		containerClass: 'hand-cursor',
		onCanvasAction(editor, { clientX, clientY }) {
			editor.viewport.startPan(clientX, clientY);
		}
	},
	[ToolType.ZOOM]: {
		name: 'Zoom',
		buttonLabel: 'Zoom',
		icon: 'magnifying-glass',
		hintName: 'Zoom Tool',
		command: 'toolZoom',
		toolbarGroup: 'view',
		groups: ['navigation'],
		available: navigationAvailable,
		containerClass: 'zoom-cursor',
		onCanvasAction(editor, { clientX, clientY, options }) {
			if (!editor.originalImage) return;
			editor.handleZoomAction(clientX, clientY, { zoomOut: options.zoomOut || false });
		}
	},
	[ToolType.GLITTER_FILL]: {
		name: 'Glitter Fill',
		buttonLabel: 'Glitter Fill',
		icon: 'paint-bucket',
		hintName: 'Glitter Fill',
		command: 'toolGlitterFill',
		toolbarGroup: 'create',
		groups: ['paint', 'contentEditing'],
		available: editingAvailable,
		wrapperClass: 'color-picker-mode',
		onCanvasAction(editor, { x, y, hitCanvas, event }) {
			if (hitCanvas) {
				editor.handleColorPickAction(x, y, event);
			} else {
				editor.setTool(ToolType.SELECT);
			}
		}
	},
	[ToolType.BRUSH]: {
		name: 'Glitter Brush',
		buttonLabel: 'Glitter Brush',
		icon: 'brush',
		// The chip follows the brush's Paint/Erase mode.
		hintInfo: (editor) => (editor.maskEditor?.mode === 'sub'
			? { icon: 'eraser', name: 'Eraser Tool' }
			: { icon: 'brush', name: 'Glitter Brush' }),
		command: 'toolBrush',
		toolbarGroup: 'create',
		titleNote: ' — Paint/Erase in the context bar, or X to swap',
		groups: ['paint', 'contentEditing'],
		// The mask editor decides (a glitter fill layer must be active).
		available: (editor, { autoPreviewActive }) => Boolean(editor.maskEditor?.canActivate()) && !autoPreviewActive
		// Painting is handled by MaskEditor's own pointer listeners.
	},
	[ToolType.TEXT]: {
		name: 'Text',
		buttonLabel: 'Text',
		icon: 'text',
		hintName: 'Text Tool',
		command: 'toolText',
		toolbarGroup: 'create',
		groups: ['creation', 'contentEditing'],
		touchRoute: 'creationDrag',
		available: editingAvailable,
		onCanvasDrag(editor, { box, isClick, start }) {
			if (isClick) return this.onCanvasAction(editor, { x: start.x, y: start.y, hitCanvas: true });
			return createTextAt(editor, { position: { x: box.left, y: box.top }, boxMode: 'fixed', boxWidth: Math.max(CONFIG.tools.text.minBoxSize, box.width), boxHeight: Math.max(FIELDS.textFontSize.value * FIELDS.textLineHeight.value / 100, box.height) });
		},
		onCanvasAction(editor, { x, y, hitCanvas }) {
			if (!hitCanvas) return;
			// Figma parity: clicking existing text with the text tool edits it;
			// any other layer under the click is no obstacle — text goes on top.
			const hitLayer = editor.layerManager.getTopVisibleLayerAtPoint?.(x, y, { includeBase: false });
			if (hitLayer?.type === LayerType.TEXT_GLITTER) {
				editor.layerManager.selectLayerFromCanvas(hitLayer.id);
				editor.textGlitterManager?.beginTextEdit(hitLayer);
				return;
			}

			return createTextAt(editor, { position: { x, y }, boxMode: 'point' });
		}
	},
	[ToolType.SHAPE]: {
		name: 'Shape',
		buttonLabel: 'Shape',
		icon: 'square',
		hintName: 'Shape Tool',
		command: 'toolShape',
		toolbarGroup: 'create',
		groups: ['creation', 'contentEditing'],
		touchRoute: 'creationDrag',
		available: editingAvailable,
		// Clicks and touch taps use the same default-size creation path.
		onCanvasDrag(editor, { box, isClick, start }) {
			const layer = editor.layerManager.addLayer(LayerType.SHAPE, { shapeLayer: { shapeId: editor.shapeGlitterManager.getActiveShapeId(), position: isClick ? start : { x: box.centerX, y: box.centerY }, ...(isClick ? {} : { width: box.width, height: box.height }) } });
			editor.finishLayerCreation(layer);
			return layer;
		},
		onCanvasAction(editor, { x, y, hitCanvas }) {
			if (!hitCanvas || !editor.originalImage) return;
			const layer = editor.layerManager.addLayer(LayerType.SHAPE, {
				shapeLayer: {
					shapeId: editor.shapeGlitterManager.getActiveShapeId(),
					position: { x, y }
				}
			});
			editor.finishLayerCreation(layer);
		}
	},
	[ToolType.LINE]: {
		name: 'Line',
		buttonLabel: 'Line',
		icon: 'line',
		hintName: 'Line Tool',
		command: 'toolLine',
		toolbarGroup: 'create',
		groups: ['creation', 'contentEditing'],
		touchRoute: 'creationDrag',
		dragPreview: 'line',
		available: editingAvailable,
		// A drag runs from its start to its end; a click or tap makes a line of
		// the default length centered there.
		onCanvasDrag(editor, { isClick, start, end }) {
			const half = CONFIG.tools.path.line.defaultLength / 2;
			const from = isClick ? { x: start.x - half, y: start.y } : start;
			const to = isClick ? { x: start.x + half, y: start.y } : end;
			const layer = editor.layerManager.addLayer(LayerType.PATH, { pathLayer: {
				name: 'Line',
				subpaths: [{ closed: false, points: [{ x: Math.round(from.x), y: Math.round(from.y) }, { x: Math.round(to.x), y: Math.round(to.y) }] }]
			} });
			editor.finishLayerCreation(layer);
			return layer;
		}
	},
	[ToolType.PEN]: {
		name: 'Pen',
		buttonLabel: 'Pen',
		icon: 'pen',
		hintName: 'Pen Tool',
		command: 'toolPen',
		toolbarGroup: 'create',
		groups: ['creation', 'contentEditing'],
		touchRoute: 'toolDrag',
		available: editingAvailable,
		// The point editor (js/ui/path-edit.js) owns every press.
		onActivate: (editor) => editor.pathEdit.onToolActivated(),
		onDeactivate: (editor) => editor.pathEdit.end(),
		onCanvasPointerDown: (editor, event) => editor.pathEdit.handlePointerDown(event),
		onCanvasAction: (editor, action) => { if (action.options?.source === 'touch') editor.pathEdit.handleTap(action); },
		onTouchDragStart: (editor, point) => editor.pathEdit.beginTouchDrag(point),
		onTouchDragMove: (editor, point) => editor.pathEdit.moveTouchDrag(point),
		onTouchDragEnd: (editor, point) => editor.pathEdit.endTouchDrag(point),
		onTouchDragCancel: (editor) => editor.pathEdit.cancelDrag()
	}
};

// Toolbar order is the registry's insertion order.
const TOOL_ORDER = Object.freeze([
	ToolType.SELECT,
	ToolType.TEXT,
	ToolType.SHAPE,
	ToolType.LINE,
	ToolType.PEN,
	ToolType.GLITTER_FILL,
	ToolType.BRUSH,
	ToolType.HAND,
	ToolType.ZOOM
]);

function getToolButtonId(tool) {
	return `${tool}Tool`;
}

// Reusable capability groups for focused editor modes. A preview session can
// permit whole groups and add individual tool exceptions through one policy.
const TOOL_GROUPS = Object.freeze({
	...Object.fromEntries(['navigation', 'selection', 'creation', 'paint', 'contentEditing'].map((group) => [
		group,
		Object.freeze(TOOL_ORDER.filter((tool) => TOOLS[tool].groups.includes(group)))
	])),
	all: Object.freeze(Object.values(ToolType))
});

function toolAllowedByAccess(tool, access = {}) {
	const tools = Array.isArray(access.tools) ? access.tools : [];
	const groups = Array.isArray(access.groups) ? access.groups : [];
	return tools.includes(tool) || groups.some((name) => TOOL_GROUPS[name]?.includes(tool));
}

const TOOL_TOUCH_ROUTES = Object.freeze(Object.fromEntries(
	TOOL_ORDER.filter((tool) => TOOLS[tool].touchRoute).map((tool) => [tool, TOOLS[tool].touchRoute])
));

// Button title: "Name (Key)" plus any note, with the key read from COMMANDS.
function getToolTitle(tool) {
	const definition = TOOLS[tool];
	const key = COMMANDS[definition.command]?.displayKey;
	return `${definition.name}${key ? ` (${key})` : ''}${definition.titleNote || ''}`;
}

// { icon: 'icon-…', name } for the helpful-message chip.
function getToolHintInfo(editor, tool) {
	const definition = TOOLS[tool];
	if (!definition) return { icon: '', name: '' };
	const info = definition.hintInfo?.(editor) || { icon: definition.icon, name: definition.hintName || definition.name };
	return { icon: `icon-${info.icon}`, name: info.name };
}

// Render the toolbar's tool buttons from the registry. Buttons start disabled
// (except Select) until updateContextToolbars applies each tool's availability.
function renderToolButtons(container) {
	if (!container) return;
	const prerenderedButtons = container.querySelectorAll('button[data-tool]');
	if (prerenderedButtons.length === TOOL_ORDER.length
		&& TOOL_ORDER.every((tool) => container.querySelector(`#${getToolButtonId(tool)}`))) return;
	let previousGroup = null;
	const children = [];
	TOOL_ORDER.forEach((tool) => {
		const definition = TOOLS[tool];
		if (previousGroup && definition.toolbarGroup !== previousGroup) {
			const separator = document.createElement('span');
			separator.className = 'toolbar-tool-separator';
			separator.setAttribute('aria-hidden', 'true');
			children.push(separator);
		}
		const button = document.createElement('button');
		button.className = 'btn-icon icon-wrapper';
		button.id = getToolButtonId(tool);
		button.type = 'button';
		button.dataset.tool = tool;
		button.title = getToolTitle(tool);
		button.disabled = tool !== ToolType.SELECT;
		button.innerHTML = `<svg class="icon"><use href="#icon-${definition.icon}"></use></svg><span class="name"></span>`;
		button.querySelector('.name').textContent = definition.buttonLabel;
		children.push(button);
		previousGroup = definition.toolbarGroup;
	});
	container.replaceChildren(...children);
}

function createTextAt(editor, options = {}) {
	const position = options.position || { x: editor.originalCanvas.width / 2, y: editor.originalCanvas.height / 2 };
	const placeholder = options.text === undefined;
	const layer = editor.layerManager.addLayer(LayerType.TEXT_GLITTER, { skipHistory: true, textLayer: { ...options, text: placeholder ? CONFIG.tools.text.placeholderText : options.text, position, align: 'left' } });
	if (!layer) return null;
	editor.finishLayerCreation(layer);
	const manager = editor.textGlitterManager;
	const placeText = () => {
		const entry = manager.getMeasurementEntry(layer);
		if (layer.textData.boxMode === 'point') manager.setTextOriginWorldPosition(layer, position, entry);
		else manager.setWorldPointFromLocal(layer.transform, { x: entry.layoutOffsetX - entry.width / 2, y: entry.layoutOffsetY - entry.height / 2 }, position);
	};
	placeText();
	manager.beginTextEdit(layer, { created: true, selectAll: placeholder });
	FontLibrary.ensureLoaded(layer.textData.fontId).then(() => {
		if (!editor.layers.includes(layer)) return;
		placeText();
		manager.renderTextSelection();
	}).catch(error => manager.reportFontLoadError(error));
	return layer;
}

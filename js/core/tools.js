// ============================================
// TOOLS
// The tool registry: one entry per canvas tool.
// ============================================
// Each entry holds every fact about a tool, so adding one means adding an
// entry here, including its key and preferred panel:
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
	AREA: 'area',
	CROP: 'crop',
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
		key: 'v',
		panel: () => null,
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
		key: 'h',
		panel: () => null,
		name: 'Hand',
		buttonLabel: 'Hand',
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
		key: 'z',
		panel: () => null,
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
		key: 'i',
		panel: (_editor, layer) => layer?.type === LayerType.GLITTER_FILL ? 'layerSettings' : null,
		name: 'Glitter Fill',
		buttonLabel: 'Glitter Fill',
		icon: 'paint-bucket',
		hintName: 'Glitter Fill',
		command: 'toolGlitterFill',
		toolbarGroup: 'paint',
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
		key: 'b',
		panel: () => 'brushSettings',
		name: 'Glitter Brush',
		buttonLabel: 'Glitter Brush',
		icon: 'brush',
		// The chip follows the brush's Paint/Erase mode.
		hintInfo: (editor) => (editor.maskEditor?.mode === 'sub'
			? { icon: 'eraser', name: 'Eraser Tool' }
			: { icon: 'brush', name: 'Glitter Brush' }),
		command: 'toolBrush',
		shortcuts: [{ key: 'e', command: 'toolEraser', label: 'Mask Eraser Tool', run: (editor) => { editor.setTool(ToolType.BRUSH); editor.maskEditor?.setMode('sub'); } }],
		onShortcut: (editor) => editor.maskEditor?.setMode('add'),
		toolbarGroup: 'paint',
		titleNote: ' — Paint/Erase in the context bar, or X to swap',
		groups: ['paint', 'contentEditing'],
		available: editingAvailable,
		onActivate: editor => editor.maskEditor.enterEditMode(),
		onDeactivate: (editor, _nextTool, options = {}) => editor.maskEditor.exitEditMode({ switchTool: false, commitStroke: options.commitStroke !== false }),
		onCanvasPointerDown: (editor, event) => editor.maskEditor._handlePointerDown(event)
	},
	[ToolType.AREA]: {
		key: 'm',
		panel: (_editor, layer) => layer?.type === LayerType.GLITTER_FILL ? 'layerSettings' : null,
		name: 'Select Area',
		buttonLabel: 'Select Area',
		icon: 'area-select',
		hintName: 'Select Area Tool',
		command: 'toolArea',
		toolbarGroup: 'paint',
		groups: ['paint', 'contentEditing'],
		touchRoute: 'toolDrag',
		available: editingAvailable,
		containerClass: 'area-cursor',
		// The area outlives the tool, so the brush can paint inside it; leaving
		// only drops a drag in progress. The session (js/ui/area-select.js) owns
		// every press.
		onDeactivate: (editor) => editor.areaSelect.cancelDrag(),
		onCanvasPointerDown: (editor, event) => editor.areaSelect.handlePointerDown(event),
		onCanvasAction: (editor, action) => { if (action.options?.source === 'touch') editor.areaSelect.handleTap(); },
		onTouchDragStart: (editor, point) => editor.areaSelect.press(point),
		onTouchDragMove: (editor, point) => editor.areaSelect.move(point),
		onTouchDragEnd: (editor, point) => editor.areaSelect.release(point),
		onTouchDragCancel: (editor) => editor.areaSelect.cancelDrag()
	},
	[ToolType.TEXT]: {
		key: 't',
		panel: () => null,
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
		key: 'u',
		panel: () => null,
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
		key: 'l',
		panel: () => null,
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
	[ToolType.CROP]: {
		name: 'Crop', buttonLabel: 'Crop', icon: 'crop', command: 'toolCrop', key: 'c',
		panel: () => 'baseLayerSettings', toolbarGroup: 'canvas', groups: ['contentEditing'],
		touchRoute: 'toolDrag', available: editingAvailable,
		onActivate: (editor) => editor.cropEdit.activate(), onDeactivate: (editor) => editor.cropEdit.end(),
		onCanvasPointerDown: (editor, event) => editor.cropEdit.handlePointerDown(event),
		onTouchDragStart: (editor, point) => editor.cropEdit.press({ ...point, pointerType: 'touch' }),
		onTouchDragMove: (editor, point) => editor.cropEdit.move({ ...point, pointerType: 'touch' }),
		onTouchDragEnd: (editor, point) => editor.cropEdit.release(point),
		onTouchDragCancel: (editor) => editor.cropEdit.cancelDrag()
	},
	[ToolType.PEN]: {
		key: 'p',
		panel: () => null,
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

// Selection, painting, creation, canvas editing, then navigation.
const TOOL_ORDER = Object.freeze([
	ToolType.SELECT,
	ToolType.BRUSH,
	ToolType.GLITTER_FILL,
	ToolType.AREA,
	ToolType.TEXT,
	ToolType.SHAPE,
	ToolType.LINE,
	ToolType.PEN,
	ToolType.CROP,
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

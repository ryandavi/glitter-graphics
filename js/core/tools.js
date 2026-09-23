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

const ToolType = {
	SELECT: 'select',
	TEXT: 'text',
	SHAPE: 'shape',
	HAND: 'hand',
	COLOR_PICKER: 'colorPicker',
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
		groups: ['navigation'],
		available: navigationAvailable,
		containerClass: 'zoom-cursor',
		onCanvasAction(editor, { clientX, clientY, options }) {
			if (!editor.originalImage) return;
			editor.handleZoomAction(clientX, clientY, { zoomOut: options.zoomOut || false });
		}
	},
	[ToolType.COLOR_PICKER]: {
		name: 'Color Fill',
		buttonLabel: 'Color Fill',
		icon: 'paint-bucket',
		hintName: 'Color Fill',
		command: 'toolColorFill',
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
		name: 'Mask Brush',
		buttonLabel: 'Mask Brush',
		icon: 'brush',
		// The chip follows the brush's Paint/Erase mode.
		hintInfo: (editor) => (editor.maskEditor?.mode === 'sub'
			? { icon: 'eraser', name: 'Eraser Tool' }
			: { icon: 'brush', name: 'Mask Brush' }),
		command: 'toolBrush',
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
		groups: ['creation', 'contentEditing'],
		touchRoute: 'tapCreate',
		available: editingAvailable,
		onCanvasAction(editor, { x, y, hitCanvas }) {
			if (!hitCanvas) return;
			// Figma parity: clicking existing text with the text tool edits it;
			// any other layer under the click is no obstacle — text goes on top.
			const hitLayer = editor.layerManager.getTopVisibleLayerAtPoint?.(x, y, { includeBase: false });
			if (hitLayer?.type === LayerType.TEXT_GLITTER) {
				editor.layerManager.selectLayerFromCanvas(hitLayer.id);
				editor.textGlitterManager?.focusTextInput(true);
				return;
			}

			const layer = editor.layerManager.addLayer(LayerType.TEXT_GLITTER, {
				textLayer: {
					position: { x, y },
					align: 'left',
					anchorPosition: { x, y },
					boxMode: 'auto'
				}
			});

			editor.finishLayerCreation(layer, {
				onDesktopReload: () => editor.textGlitterManager?.focusTextInput(true)
			});
		}
	},
	[ToolType.SHAPE]: {
		name: 'Shape',
		buttonLabel: 'Shape',
		icon: 'square',
		hintName: 'Shape Tool',
		command: 'toolShape',
		groups: ['creation', 'contentEditing'],
		touchRoute: 'creationDrag',
		available: editingAvailable,
		// Tap-to-create parity with desktop's plain click (startShapeDrag's
		// isClick path); drag-to-size stays desktop-only (mouse pointerdown).
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
	}
};

// Toolbar order is the registry's insertion order.
const TOOL_ORDER = Object.freeze(Object.keys(TOOLS));

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
	container.replaceChildren(...TOOL_ORDER.map((tool) => {
		const definition = TOOLS[tool];
		const button = document.createElement('button');
		button.className = 'btn-icon icon-wrapper';
		button.id = getToolButtonId(tool);
		button.type = 'button';
		button.dataset.tool = tool;
		button.title = getToolTitle(tool);
		button.disabled = tool !== ToolType.SELECT;
		button.innerHTML = `<svg class="icon"><use href="#icon-${definition.icon}"></use></svg><span class="name"></span>`;
		button.querySelector('.name').textContent = definition.buttonLabel;
		return button;
	}));
}

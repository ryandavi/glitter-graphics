'use strict';

const HINT_RULES = [
	{
		id: 'brush-editing',
		tool: true,
		when: (editor, { layer }) => editor.maskEditor?.isEditing && layer?.type === LayerType.GLITTER_FILL,
		hint: (editor) => editor.maskEditor.mode === 'sub' ? 'Drag to erase glitter from this layer' : 'Drag to paint glitter directly onto this layer',
		context: {
			desktop: 'Press X to swap Paint/Erase, use [ or ] to resize the brush, and press Esc or change tools to exit the Mask Brush.',
			mobile: 'Tap once for a single stamp. Use two fingers to pan or zoom, and switch Paint/Erase to add or remove glitter.'
		}
	},
	{
		id: 'brush-needs-layer',
		tool: true,
		when: (editor) => editor.maskEditor?.isEditing,
		hint: (editor, { isMobile }) => editor.maskEditor.mode === 'sub'
			? 'Select a glitter layer to erase from'
			: isMobile ? 'Drag here to create a new glitter layer and start painting' : 'Paint here to create a new glitter layer automatically',
		context: (editor) => editor.maskEditor.mode === 'sub'
			? 'There\'s nothing here for the Eraser to remove.'
			: 'The Mask Brush targets glitter layers. Starting a stroke on another layer creates a new glitter layer for you.'
	},
	{ id: 'layer-locked', when: (editor, { layer }) => editor.isLayerContentLocked(layer), hint: 'This layer is locked', context: 'Its settings are available to inspect. Unlock it in the Layers panel to make changes.' },
	{ id: 'sticker-empty', when: (_editor, { layer }) => layer?.type === LayerType.STICKER && !layer.stickerSourceId, hint: 'No sticker chosen—select a sticker from the gallery to place on your canvas' },
	{ id: 'text-empty', when: (_editor, { layer }) => layer?.type === LayerType.TEXT_GLITTER && !layer.textData.text.trim(), hint: 'This text layer is empty - type something in the Text section to reveal the glitter fill', context: 'Choose a font, adjust spacing and alignment, and pick a glitter in the browser for the fill.' },
	{ id: 'glitter-missing-source', when: (_editor, { layer }) => layer?.type === LayerType.GLITTER_FILL && hasMaskContent(layer) && !layer.selectedGlitterId, hint: 'No glitter selected—choose a glitter style from the gallery to apply it' },
	{
		id: 'glitter-empty',
		when: (_editor, { layer, tool }) => layer?.type === LayerType.GLITTER_FILL && !hasMaskContent(layer) && tool !== ToolType.COLOR_PICKER,
		hint: (_editor, { isMobile }) => `This glitter layer is empty—use the ${isMobile ? 'color fill' : 'Color Fill'} or Mask Brush to add glitter`,
		context: { desktop: 'Click colors to build a selection, or paint directly with the Mask Brush.', mobile: 'Tap colors to build a selection, or paint directly in the editor.' }
	},
	{ id: 'zoom', tool: true, when: (_editor, { tool }) => tool === ToolType.ZOOM, hint: (_editor, { isMobile }) => isMobile ? 'Pinch to zoom in and out' : 'Click to zoom in • Shift+click to zoom out' },
	{ id: 'hand', tool: true, when: (_editor, { tool }) => tool === ToolType.HAND, hint: (_editor, { isMobile }) => isMobile ? 'Use one or two fingers to pan around the canvas' : 'Click and drag to move around the canvas' },
	{ id: 'text-tool', tool: true, when: (_editor, { tool }) => tool === ToolType.TEXT, hint: 'Click empty canvas space to create a point-text layer', context: 'The click becomes the text anchor. Existing layers stay put until you switch back to Select.' },
	{ id: 'shape-tool', tool: true, when: (_editor, { tool }) => tool === ToolType.SHAPE, hint: 'Drag on the canvas to draw a shape at that size', context: 'Hold Shift to keep it square. A single click makes a default-size shape. Pick the shape and its fill/border/shadow in Shape Properties.' },
	{
		id: 'brush-tool',
		tool: true,
		when: (_editor, { tool }) => tool === ToolType.BRUSH,
		hint: (editor) => editor.maskEditor?.mode === 'sub' ? 'Select a glitter layer, then drag to erase glitter' : 'Select a glitter layer, then drag to paint glitter',
		context: 'Press X to swap Paint and Erase. Use [ or ] to resize the brush.'
	},
	{
		id: 'color-fill',
		tool: true,
		when: (_editor, { tool }) => tool === ToolType.COLOR_PICKER,
		resolve(editor, { layer }) {
			if (!layer || layer.type === LayerType.BASE_IMAGE) return { hint: 'Click anywhere on your image to create a glitter fill layer', context: 'Glitter fills are based on color selection from your base image.' };
			if (layer.type === LayerType.STICKER) return { hint: 'Switch to select tool to move stickers, or add a glitter layer' };
			if (layer.type === LayerType.TEXT_GLITTER) return { hint: 'Switch to the Select tool to move glitter text, or choose a glitter in the browser for the fill' };
			if (layer.type !== LayerType.GLITTER_FILL) return null;
			if (!hasMaskContent(layer)) {
				return layer.selectedGlitterId
					? { hint: 'Click colors on your image to select areas for glitter, or use the Mask Brush (B) to paint directly', context: 'Threshold determines how similar colors need to be to get selected together.' }
					: { hint: 'Choose a glitter style from the gallery, then click colors or paint to fill' };
			}
			if (el('multiSelect', { required: false })?.checked && layer.selections.length === 1) return { hint: 'Multi-select is on—click more colors to expand your selection' };
			return { hint: 'Click again to change the color selection, or adjust settings to refine', context: 'Threshold controls color tolerance. Feather softens edges.' };
		}
	},
	{
		id: 'select-tool',
		tool: true,
		when: (_editor, { tool }) => tool === ToolType.SELECT,
		resolve(_editor, { layer, isMobile }) {
			if (!layer) return { hint: 'Add a sticker layer to move items around, or use color fill for glitter' };
			if (layer.type === LayerType.STICKER && layer.stickerSourceId) return isMobile
				? { hint: 'Drag to move, pinch to scale and rotate', context: 'Or tap settings button to adjust position, flip, and opacity.' }
				: { hint: 'Drag to move your sticker', context: 'Use the settings panel to rotate, scale, flip, or adjust opacity.' };
			if (layer.type === LayerType.TEXT_GLITTER) return isMobile
				? { hint: 'Drag to move, pinch to scale and rotate your glitter text', context: 'Use the Text section for copy, font, alignment, texture scale, and opacity.' }
				: { hint: 'Drag to move your glitter text', context: 'Use the Text section to change the copy, font, size, spacing, alignment, and fill texture.' };
			if (layer.type === LayerType.GLITTER_FILL || layer.type === LayerType.BASE_IMAGE) return { hint: 'Switch to the color fill or Mask Brush to add or modify glitter, or add a sticker layer' };
			return null;
		}
	},
	{
		id: 'glitter-refine',
		when: (_editor, { layer }) => layer?.type === LayerType.GLITTER_FILL && hasMaskContent(layer) && layer.selectedGlitterId,
		hint: (_editor, { isMobile }) => isMobile ? 'Tap settings to adjust scale, opacity, or refine your selection' : 'Use the settings panel to adjust scale, opacity, threshold, or feather — or paint with the Mask Brush',
		context: (_editor, { isMobile }) => isMobile ? 'Threshold controls color tolerance—higher values select more similar colors.' : 'Threshold controls color tolerance. Feather softens edges. The Mask Brush adds painted detail.'
	},
	{ id: 'text-refine', when: (_editor, { layer }) => layer?.type === LayerType.TEXT_GLITTER && layer.textData.text.trim(), hint: 'Use the Text section to edit the copy, font, spacing, and alignment', context: 'The glitter browser controls the fill, and texture scale and opacity change the motion inside the letters.' }
];

function resolveHintField(field, editor, context) {
	if (typeof field === 'function') return field(editor, context);
	if (field && typeof field === 'object') return context.isMobile ? field.mobile : field.desktop;
	return field || '';
}

function getHintToolInfo(editor, tool) {
	const toolMap = {
		[ToolType.SELECT]: { icon: 'icon-hand-pointer', name: 'Select Tool' },
		[ToolType.TEXT]: { icon: 'icon-hand-pointer', name: 'Text Tool' },
		[ToolType.SHAPE]: { icon: 'icon-square', name: 'Shape Tool' },
		[ToolType.COLOR_PICKER]: { icon: 'icon-paint-bucket', name: 'Color Fill' },
		[ToolType.BRUSH]: editor.maskEditor?.mode === 'sub' ? { icon: 'icon-eraser', name: 'Eraser Tool' } : { icon: 'icon-brush', name: 'Mask Brush' },
		[ToolType.HAND]: { icon: 'icon-hand', name: 'Hand Tool' },
		[ToolType.ZOOM]: { icon: 'icon-magnifying-glass', name: 'Zoom Tool' }
	};
	return toolMap[tool] || { icon: '', name: '' };
}

function updateHelpfulMessageFromRules(editor) {
	const message = el('helpfulMessage');
	if (!message) return;
	if (!editor.showHints || !editor.originalImage) {
		message.classList.remove('visible');
		return;
	}
	const context = {
		layer: editor.layerManager.getActiveLayer(),
		tool: editor.currentTool,
		isMobile: Boolean(editor.mobileManager?.isMobile)
	};
	const rule = HINT_RULES.find((candidate) => candidate.when(editor, context));
	const resolved = rule?.resolve?.(editor, context);
	const hint = resolved?.hint || resolveHintField(rule?.hint, editor, context);
	const detail = resolved?.context || resolveHintField(rule?.context, editor, context);
	const toolLabel = el('helpfulMessageToolContext');
	const icon = el('helpfulMessageIcon');
	if (rule?.tool) {
		const toolInfo = getHintToolInfo(editor, context.tool);
		icon?.setAttribute('href', `#${toolInfo.icon}`);
		const toolName = el('helpfulMessageToolName');
		if (toolName) toolName.textContent = toolInfo.name;
		if (toolLabel) toolLabel.style.display = 'flex';
	} else {
		icon?.setAttribute('href', '#icon-circle-info');
		if (toolLabel) toolLabel.style.display = 'none';
	}
	if (hint && !editor.currentHintDismissed) {
		el('helpfulMessageText').textContent = hint;
		el('helpfulMessageDescription').textContent = detail;
		message.classList.add('visible');
	} else {
		message.classList.remove('visible');
	}
}

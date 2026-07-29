const LAYER_CLIPBOARD_KIND = 'glitter-layers';
const CLIPBOARD_COPY = Object.freeze({
	copied: (count) => `${count} layer${count === 1 ? '' : 's'} copied`,
	pasted: (count) => `${count} layer${count === 1 ? '' : 's'} pasted`,
	missingBase: 'Add or paste a base image before pasting layers',
	imageName: 'clipboard-image.png'
});

function isClipboardTextTarget(target) {
	return target instanceof HTMLElement && (
		target.isContentEditable
		|| ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
	);
}

async function copySelectedLayers(editor) {
	const layers = editor.getSelectedActionableLayers();
	if (!layers.length) return false;
	const masks = await editor.projectSerializer.serializeMasks();
	const payload = {
		kind: LAYER_CLIPBOARD_KIND,
		version: 1,
		layers: layers.map((layer) => editor.layerManager.serializeLayer(layer, { includeMaskVersion: false })),
		masks: Object.fromEntries(layers.filter((layer) => masks[layer.id]).map((layer) => [layer.id, masks[layer.id]]))
	};
	const serialized = JSON.stringify(payload);
	window.__glitterLayerClipboard = serialized;
	try {
		await navigator.clipboard?.writeText(serialized);
	} catch {
		// The in-page clipboard remains available when browser permission is denied.
	}
	editor.updateStatus(CLIPBOARD_COPY.copied(layers.length));
	return true;
}

async function pasteLayerPayload(editor, payload) {
	if (payload?.kind !== LAYER_CLIPBOARD_KIND || !Array.isArray(payload.layers)) return false;
	if (!editor.originalImage) {
		editor.showError(CLIPBOARD_COPY.missingBase);
		return true;
	}
	const gate = editor.layerManager.canAddLayers(payload.layers.length);
	if (!gate.ok) {
		editor.showError(gate.reason);
		return true;
	}

	const pastedIds = [];
	for (const layerData of payload.layers) {
		const sourceId = layerData.id;
		const layer = await editor.layerManager.deserializeLayer(layerData);
		if (!layer || layer.type === LayerType.BASE_IMAGE) continue;
		layer.id = editor.layerManager.generateLayerId();
		layer.locked = false;
		const transform = isTransformableLayerType(layer.type) ? getLayerTransform(layer) : null;
		if (transform) {
			transform.position.x += 20;
			transform.position.y += 20;
		}
		layer.maskVersion = 0;
		editor.layerManager.insertLayer(layer, { suppressDesignGalleryFocus: true });
		const mask = payload.masks?.[sourceId];
		if (layer.type === LayerType.GLITTER_FILL && (mask?.add || mask?.sub)) {
			const paint = editor.glitterManager.ensurePaintMask(layer.id);
			await editor.projectSerializer.drawMaskData(paint.add, mask.add);
			await editor.projectSerializer.drawMaskData(paint.sub, mask.sub);
			editor.glitterManager.commitPaintState(layer);
		}
		pastedIds.push(layer.id);
	}
	if (!pastedIds.length) return true;
	editor.layerManager.setSelection(pastedIds, { activeLayerId: pastedIds[pastedIds.length - 1] });
	editor.layerManager.reorderLayers();
	editor.saveState('Paste layers');
	editor.requestPreviewUpdate();
	editor.updateActionButtons();
	editor.updateStatus(CLIPBOARD_COPY.pasted(pastedIds.length));
	return true;
}

function installClipboardHandlers(editor) {
	document.addEventListener('paste', async (event) => {
		if (isClipboardTextTarget(event.target)) return;
		const image = [...(event.clipboardData?.items || [])].find((item) => item.type.startsWith('image/'));
		if (image) {
			event.preventDefault();
			const file = image.getAsFile();
			if (!file) return;
			if (editor.originalImage) {
				await editor.replaceBaseImageFile(file);
			} else {
				await editor.loadImageFile(file, {
					fileName: file.name || CLIPBOARD_COPY.imageName,
					source: { kind: 'clipboard', file }
				});
			}
			return;
		}

		const text = event.clipboardData?.getData('text/plain') || window.__glitterLayerClipboard || '';
		let payload = null;
		try {
			payload = JSON.parse(text);
		} catch {
			return;
		}
		if (payload?.kind !== LAYER_CLIPBOARD_KIND) return;
		event.preventDefault();
		await pasteLayerPayload(editor, payload);
	});
}

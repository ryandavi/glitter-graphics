'use strict';

// Order matters: an SVG is also an image, and a project replaces the document.
const FILE_HANDLERS = Object.freeze([
	{ match: (file) => file.type === 'application/json' || /\.json$/i.test(file.name), open: (editor, file) => editor.openProjectFile(file) },
	{ match: (file) => file.type === 'image/svg+xml' || /\.svg$/i.test(file.name), open: importSvgFile },
	{ match: (file) => file.type.startsWith('image/'), open: openImageAssetFile }
]);

async function openImageAssetFile(editor, file, { uploadLibrary = null, asDocument = false } = {}) {
	if (asDocument || !editor.originalImage) return editor.loadImage({ target: { files: [file] } });
	if (!editor.layerManager.requireLayerCapacity()) return false;
	const library = uploadLibrary || editor.stickerManager;
	const item = await library.handleUserUpload(file, { navigate: false });
	if (!item || item.error) return false;
	if (library === editor.stickerManager) return editor.stickerManager.createStickerLayer(item.id);
	if (editor.originalImage) return library.handleItemClick(item);
	return item;
}

async function importSvgFile(editor, file, options = {}) {
	const done = editor.beginActivity('svg-import', 'Importing SVG');
	try {
		let parsed;
		try { parsed = parseSvgDocument(await file.text()); }
		catch (error) {
			const image = file.type === 'image/svg+xml' ? file : new File([file], file.name, { type: 'image/svg+xml' });
			const result = await openImageAssetFile(editor, image, options);
			if (result !== false) editor.updateStatus(`SVG opened as an image: ${error.message}.`);
			return result;
		}
		if (!editor.originalImage) {
			const valid = validateCanvasSize(Math.ceil(parsed.width), Math.ceil(parsed.height));
			if (!valid.ok) { editor.showError(valid.message); return false; }
			await editor.loadBlankImage(Math.ceil(parsed.width), Math.ceil(parsed.height), 'transparent');
			if (!editor.originalImage) return false;
		}
		if (!editor.layerManager.requireLayerCapacity()) return false;
		let items = parsed.items;
		const merged = !editor.layerManager.canAddLayers(items.length).ok;
		if (merged) items = [{ ...items[0], subpaths: items.flatMap((item) => item.subpaths) }];
		const canvas = editor.originalCanvas;
		const scale = Math.min(1,canvas.width/parsed.width,canvas.height/parsed.height);
		const matrix = [scale,0,0,scale,(canvas.width-parsed.width*scale)/2,(canvas.height-parsed.height*scale)/2];
		for (const item of items) {
			SvgImport.mapSubpaths(item.subpaths,matrix);
			if (item.stroke) item.stroke.widthPx *= scale;
			const layer = editor.layerManager.addLayer(LayerType.PATH, { skipHistory: true, pathLayer: { ...item, name: item.name || file.name.replace(/\.svg$/i,'') } });
			if (layer) { layer.pathData.fillRule=item.fillRule; layer.opacity=item.opacity; }
		}
		editor.requestPreviewUpdate();
		editor.saveState('Import SVG');
		editor.updateExportActionUI();
		editor.updateStatus(merged ? 'SVG imported as one compound path to fit the layer limit; the first paint is used.' : `SVG imported as ${items.length} path ${items.length === 1 ? 'layer' : 'layers'}.`);
		return true;
	} finally { done(); }
}

async function openEditorFiles(editor, files, options = {}) {
	const project = files.find((file) => FILE_HANDLERS[0].match(file));
	if (project) return FILE_HANDLERS[0].open(editor,project,options);
	for (const file of files) {
		const handler = FILE_HANDLERS.find((entry) => entry.match(file));
		if (!handler) { editor.showError('Choose an image, SVG or saved Glitter project.'); continue; }
		try { if (await handler.open(editor,file,options) === false) break; }
		catch (error) { editor.showError(`Could not open ${file.name}: ${error.message}`); break; }
	}
}

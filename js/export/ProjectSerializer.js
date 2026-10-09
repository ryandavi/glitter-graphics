class ProjectSerializer {
	static FORMAT = 'glitter-project';
	static FORMAT_VERSION = 6;

	/*
	Before launch, keep format 6, update the shipped templates with format changes,
	and ship no migrations. At launch reset the version to 1 and restamp templates
	and release metadata. Thereafter renamed or redefined keys need a version bump
	and a migration; optional keys with defaults do not. Unknown keys are ignored.
	The migration table starts empty at launch.
	*/
	static MIGRATIONS = {};

	constructor(editor) {
		this.editor = editor;
	}

	async serialize() {
		const layers = this.editor.layers.filter((layer) => !layer.isPreview).map((layer) =>
			this.editor.layerManager.serializeLayer(layer, { includeMaskVersion: false })
		);

		return {
			format: ProjectSerializer.FORMAT,
			version: ProjectSerializer.FORMAT_VERSION,
			// Which editor build wrote the file. Optional with a sensible default, so
			// per the rules above this does not bump FORMAT_VERSION. Readers ignore it;
			// it exists so a project someone sends in can be traced to a release.
			appVersion: CONFIG.app.version,
			savedAt: new Date().toISOString(),
			name: this.editor.projectName || '',
			canvas: {
				width: this.editor.originalCanvas.width,
				height: this.editor.originalCanvas.height
			},
			baseImage: await this.serializeBaseImage(),
			layers,
			activeLayerId: this.editor.activeLayerId,
			masks: await this.serializeMasks(),
			shapeFillImages: this.serializeShapeFillImages(layers),
			customStickers: await this.serializeCustomStickers(layers),
			customGlitter: await this.serializeCustomGlitter(layers)
		};
	}

	async serializeToBlob() {
		const data = await this.serialize();
		return new Blob([JSON.stringify(data, null, '\t')], { type: 'application/json' });
	}

	async loadFile(file) {
		const rawText = await file.text();
		let data;
		try {
			data = JSON.parse(rawText);
		} catch (error) {
			throw new Error(`That project file is not valid JSON. ${error.message}`);
		}

		await this.load(data);
	}

	async load(data) {
		this.validateProjectData(data);
		const migrated = this.runMigrations(data);
		const report = await this.preflight(migrated);
		if (report.issues.length) {
			const newerVersion = migrated.version > ProjectSerializer.FORMAT_VERSION;
			const confirmed = await this.editor.confirmAction({
				title: newerVersion ? 'Newer Project Version' : 'Project Asset Preflight',
				message: newerVersion
					? `${migrated.name || 'Untitled project'} was created by a newer version of Glitter.`
					: `${migrated.name || 'Untitled project'} has unavailable content.`,
				details: report.issues.map((issue) => issue.message),
				outro: newerVersion
					? 'Open anyway? Avoid overwriting the original file because newer-only data may be lost when you save.'
					: 'Open with the listed substitutions?',
				confirmLabel: 'Open Anyway'
			});
			if (!confirmed) return false;
			this.applyPreflightSubstitutions(migrated, report);
		}

		if ((this.editor.originalImage || this.editor.historyManager.canUndo()) && !this.editor.isSaved) {
			const action = await this.editor.chooseAction({
				title: 'Replace Current Project',
				message: 'Save your current project before opening this project?',
				tone: 'danger',
				actions: [
					{ id: 'discard', label: "Don't Save", tone: 'danger' },
					{ id: 'cancel', label: 'Cancel' },
					{ id: 'save', label: 'Save', primary: true }
				]
			});
			if (!action || action === 'cancel') return false;
			if (action === 'save') {
				await this.editor.saveProjectFile();
				if (!this.editor.isSaved) return false;
			}
		}
		this.editor.textGlitterManager.closePickerSession();
		this.editor.shapeGlitterManager.closePickerSession();
		this.editor.stickerManager.closePickerSession();
		this.editor.glitterManager.closePickerSession();
		this.editor.baseBackgroundManager.closePickerSession();

		await this.loadBaseImage(migrated);
		// Base-image loading resets manager state, so embedded assets must bind after it.
		await this.registerCustomStickers(migrated.customStickers || {});
		await this.registerCustomGlitter(migrated.customGlitter || {});
		this.editor.shapeGlitterManager.clearImageFillAssets();
		await this.registerShapeFillImages(migrated.shapeFillImages || {});

		this.editor.layers = [];
		for (const layerData of migrated.layers) {
			const layer = await this.editor.layerManager.deserializeLayer(layerData);
			if (layer) {
				this.editor.layers.push(layer);
			}
		}

		await this.restoreMasks(migrated.masks || {});

		const activeLayer = this.editor.layerManager.getLayerById(migrated.activeLayerId);
		this.editor.layerManager.restoreSelectionState(activeLayer ? activeLayer.id : null);
		this.editor.setProjectName(migrated.name || '', { markDirty: false });
		this.editor.historyManager.reset(this.editor.historyManager.createStateSnapshot());
		this.editor.isSaved = true;
		this.editor.openedFromNewerProjectVersion = migrated.version > ProjectSerializer.FORMAT_VERSION;
		this.editor.updateSidePanelUI();
		this.editor.layerManager.renderLayersList();
		this.editor.updatePreview();
		this.editor.loadActiveLayerSettings();
		this.editor.syncTransformHandlesForActiveLayer?.();
		this.editor.updateActionButtons();
		this.editor.updateGlitterSelection();
		this.editor.updateSelectedColorsDisplay?.();
		this.editor.updateStatusBar();
		this.editor.updateHelpfulMessage();
		this.editor.updateStatus('Project loaded');
		return true;
	}

	async preflight(data) {
		await FontLibrary.loadManifest();
		const issues = [];
		if (data.version > ProjectSerializer.FORMAT_VERSION) {
			issues.push({
				kind: 'version',
				message: `Project version ${data.version} is newer than this editor's version ${ProjectSerializer.FORMAT_VERSION}. Unknown fields will be ignored and unknown layer types will be skipped.`
			});
		}
		const embedded = data.customStickers || {};
		const knownTypes = new Set(Object.values(LayerType));
		(data.layers || []).forEach((layer, index) => {
			const label = layer.name || `Layer ${index + 1}`;
			if (!knownTypes.has(layer.type)) {
				issues.push({ kind: 'layer', index, message: `${label}: unknown layer type “${layer.type}” — the layer will be skipped` });
				return;
			}
			const available = {
				sticker: id => embedded[id] || this.editor.stickerManager.getItemById(id),
				font: id => FontLibrary.has(id),
				shape: id => ShapeLibrary.FILL_SHAPES.some(shape => shape.id === id),
				image: id => data.shapeFillImages?.[id]?.data || this.editor.shapeGlitterManager.getImageFillAsset(id)
			};
			for (const { kind, id } of getLayerAssetRefs(layer)) {
				if (!available[kind](id)) issues.push({ kind, index, id, message: `${label}: ${kind} "${id}" is unavailable; the default or an empty source will be used` });
			}
			const visit = (value) => {
				if (!value || typeof value !== 'object') return;
				Object.entries(value).forEach(([key, child]) => {
					const custom = data.customGlitter?.[child];
					const hasCustom = custom?.data || (custom?.recipe && this.editor.glitterLibrary.getItemById(custom.recipe.sourceId));
					if (key === 'glitterId' && child && !hasCustom && !this.editor.glitterLibrary.getItemById(child)) {
						issues.push({ kind: 'glitter', index, id: child, key, message: `${label}: glitter “${child}” is unavailable — default glitter will be substituted` });
					} else if (typeof child === 'object') visit(child);
				});
			};
			visit(layer);
		});
		return { issues };
	}

	applyPreflightSubstitutions(data, report) {
		report.issues.forEach((issue) => {
			const layer = data.layers[issue.index];
			if (!layer) return;
			layer._missingAssets = [...(layer._missingAssets || []), `${issue.kind} ${issue.id || ''}`.trim()];
			if (issue.kind === 'font') layer.textData.fontId = CONFIG.tools.text.defaultFontId;
			if (issue.kind === 'shape') layer.shapeData.shapeId = ShapeLibrary.FILL_SHAPES[0].id;
			if (issue.kind === 'glitter') {
				// Each declared slot (and its parked draft) knows which default
				// glitter replaces a missing one. Anything else falls back to fill.
				const definitionBySlot = new Map(getLayerPaintSlots(layer, { includeDrafts: true })
					.map((entry) => [entry.data, entry.definition]));
				const defaultGlitterFor = (slot) => getPaintSlotDefaultGlitterId(layer.type, definitionBySlot.get(slot));
				const replace = (value) => {
					if (!value || typeof value !== 'object') return;
					Object.entries(value).forEach(([key, child]) => {
						if (key === 'glitterId' && child === issue.id) value[key] = defaultGlitterFor(value);
						else if (typeof child === 'object') replace(child);
					});
				};
				replace(layer);
			}
		});
		data.layers = data.layers.filter((layer) => Object.values(LayerType).includes(layer.type));
	}

	validateProjectData(data) {
		if (!data || typeof data !== 'object') {
			throw new Error('That project file is empty or invalid.');
		}

		if (data.format !== ProjectSerializer.FORMAT) {
			throw new Error('That file is not a Glitter project.');
		}

		if (!Number.isInteger(data.version) || data.version < 1) {
			throw new Error('That project file has an invalid version.');
		}

		const width = data.canvas?.width;
		const height = data.canvas?.height;
		const sizeValidation = validateCanvasSize(width, height);
		if (!sizeValidation.ok) throw new Error(`That project file has invalid canvas dimensions. ${sizeValidation.message}`);

		if (!Array.isArray(data.layers)) {
			throw new Error('That project file is missing its layers.');
		}

		if (!data.baseImage || typeof data.baseImage !== 'object') {
			throw new Error('That project file is missing its base image.');
		}
	}

	runMigrations(data) {
		const migrated = JSON.parse(JSON.stringify(data));
		while (migrated.version < ProjectSerializer.FORMAT_VERSION) {
			const migrate = ProjectSerializer.MIGRATIONS[migrated.version];
			if (typeof migrate !== 'function') {
				throw new Error(`No migration available for project version ${migrated.version}.`);
			}
			migrate(migrated);
		}
		return migrated;
	}

	async serializeBaseImage() {
		const source = this.editor.baseImageSource;
		const baseImage = {
			mimeType: null,
			data: null,
			preset: null,
			hasBaseImage: this.editor.baseBackgroundManager?.hasBaseImage() ?? true
		};

		if (source?.kind === 'preset') {
			baseImage.preset = { ...source.preset };
		} else if (source?.file) {
			baseImage.mimeType = source.file.type || 'application/octet-stream';
			baseImage.data = await this.blobToDataUrl(source.file);
		}

		const sourceWidth = source?.renderedWidth ?? source?.preset?.width ?? this.editor.originalCanvas.width;
		const sourceHeight = source?.renderedHeight ?? source?.preset?.height ?? this.editor.originalCanvas.height;
		if (sourceWidth !== this.editor.originalCanvas.width || sourceHeight !== this.editor.originalCanvas.height) {
			baseImage.canvasData = this.editor.originalCanvas.toDataURL('image/png');
		}

		return baseImage;
	}

	async serializeMasks() {
		const masks = {};

		for (const layer of this.editor.layers) {
			if (layer.type !== LayerType.GLITTER_FILL) continue;

			const paint = this.editor.paintMaskStore.getPaintMask(layer.id);
			if (paint?.hasContent) {
				masks[layer.id] = {
					add: paint.add.toDataURL('image/png'),
					sub: paint.sub.toDataURL('image/png')
				};
				continue;
			}

			const snapshot = layer.maskVersion
				? this.editor.paintMaskStore.findPaintSnapshot(layer.id, layer.maskVersion)
				: null;
			if (!snapshot?.hasContent) {
				continue;
			}

			masks[layer.id] = {
				add: this.alphaSnapshotToDataUrl(snapshot.add),
				sub: this.alphaSnapshotToDataUrl(snapshot.sub)
			};
		}

		return masks;
	}

	async serializeCustomStickers(layers) {
		const customStickers = {};
		const usedIds = new Set(layers.flatMap(getLayerAssetRefs).filter(ref => ref.kind === 'sticker' && String(ref.id).startsWith('user-upload-')).map(ref => ref.id));

		for (const stickerId of usedIds) {
			const sticker = this.editor.stickerManager.getItemById(stickerId);
			if (!sticker?.url) continue;
			const blob = await fetch(sticker.url).then((response) => response.blob());
			customStickers[stickerId] = {
				name: sticker.name || 'Sticker',
				fileName: sticker.filename || `${sticker.name || stickerId}.png`,
				mimeType: sticker.mimeType || blob.type || 'image/png',
				backgroundRemoved: sticker.backgroundRemoved === true,
				data: await this.blobToDataUrl(blob)
			};
		}

		return customStickers;
	}

	serializeShapeFillImages(layers) {
		const images = {};
		const usedRefs = new Set(layers.flatMap(getLayerAssetRefs).filter(ref => ref.kind === 'image').map(ref => ref.id));
		usedRefs.forEach((imageRef) => {
			const asset = this.editor.shapeGlitterManager.getImageFillAsset(imageRef);
			if (!asset?.dataUrl) return;
			images[imageRef] = {
				name: asset.name,
				mimeType: asset.mimeType,
				data: asset.dataUrl
			};
		});
		return images;
	}

	async registerShapeFillImages(images) {
		for (const [imageRef, payload] of Object.entries(images || {})) {
			if (!payload?.data) continue;
			await this.editor.shapeGlitterManager.registerImageFillAsset(imageRef, {
				dataUrl: payload.data,
				name: payload.name,
				mimeType: payload.mimeType
			});
		}
	}

	async registerCustomStickers(customStickers) {
		const entries = Object.entries(customStickers || {});
		for (const [id, payload] of entries) {
			await this.editor.stickerManager.registerEmbeddedSticker({
				id,
				...payload
			});
		}
	}

	async serializeCustomGlitter(layers) {
		const embedded = {};
		const ids = new Set(layers.flatMap(layer => getLayerPaintSlots(layer, { includeDrafts: true }).map(({ data }) => data?.glitterId)));
		for (const id of ids) {
			const item = this.editor.glitterLibrary.getItemById(id);
			if (item?.source === 'user-upload') {
				const blob = await fetch(item.url).then(response => response.blob());
				embedded[id] = { upload: { name: item.name, fileName: item.filename, mimeType: item.mimeType }, data: await this.blobToDataUrl(blob) };
				continue;
			}
			if (!item?.recipe) continue;
			embedded[id] = {
				recipe: item.recipe,
				data: await this.blobToDataUrl(new Blob([item.gifBytes], { type: 'image/gif' })),
				sourceData: item.sourceBytes ? await this.blobToDataUrl(new Blob([item.sourceBytes], { type: 'image/gif' })) : null
			};
		}
		return embedded;
	}

	async registerCustomGlitter(embedded) {
		for (const [id, payload] of Object.entries(embedded)) {
			if (payload.upload) { await this.editor.glitterLibrary.registerEmbeddedGlitter(id, payload); continue; }
			await this.editor.glitterLibrary.registerCustomGlitter(payload.recipe, { data: payload.data, sourceData: payload.sourceData });
		}
	}

	async loadBaseImage(projectData) {
		const { baseImage } = projectData;
		if (baseImage.canvasData) {
			const blob = this.dataUrlToBlob(baseImage.canvasData);
			const loaded = await this.editor.loadImageFromBlob(blob, {
				fileName: `${projectData.name || 'project'}-canvas.png`,
				source: {
					kind: 'serialized-canvas',
					hasBaseImage: baseImage.hasBaseImage ?? !baseImage.preset
				}
			});
			if (!loaded) throw new Error('Could not load the project base image.');
			return;
		}

		if (baseImage.preset) {
			const loaded = await this.editor.loadBlankImage(
				baseImage.preset.width,
				baseImage.preset.height,
				baseImage.preset.color,
				{ preserveProjectName: true }
			);
			if (!loaded) throw new Error('Could not load the project base image.');
			return;
		}

		if (baseImage.data) {
			const blob = this.dataUrlToBlob(baseImage.data);
			const extension = (baseImage.mimeType || 'image/png').split('/')[1] || 'bin';
			const loaded = await this.editor.loadImageFromBlob(blob, {
				fileName: `${projectData.name || 'project-base'}.${extension}`,
				source: {
					kind: 'project-file',
					hasBaseImage: true
				}
			});
			if (!loaded) throw new Error('Could not load the project base image.');
			return;
		}

		throw new Error('That project file does not contain a usable base image.');
	}

	async restoreMasks(maskMap) {
		for (const layer of this.editor.layers) {
			if (layer.type !== LayerType.GLITTER_FILL) continue;
			const maskEntry = maskMap[layer.id];
			if (!maskEntry?.add && !maskEntry?.sub) {
				layer.maskVersion = 0;
				layer.maskHasContent = false;
				continue;
			}

			const paint = this.editor.paintMaskStore.ensurePaintMask(layer.id);
			await this.drawMaskData(paint.add, maskEntry.add);
			await this.drawMaskData(paint.sub, maskEntry.sub);
			this.editor.paintMaskStore.commitPaintState(layer);
		}
	}

	alphaSnapshotToDataUrl(alphaData) {
		const canvas = createAppCanvas(0, 0, 'export/ProjectSerializer');
		canvas.width = this.editor.originalCanvas.width;
		canvas.height = this.editor.originalCanvas.height;
		this.editor.paintMaskStore.blitAlphaToCanvas(canvas, alphaData);
		return canvas.toDataURL('image/png');
	}

	async drawMaskData(canvas, dataUrl) {
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (!dataUrl) {
			return;
		}

		const img = await this.decodeImage(dataUrl);
		ctx.drawImage(img, 0, 0);
	}

	decodeImage(src) {
		return loadImageElement(src);
	}

	blobToDataUrl(blob) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result);
			reader.onerror = () => reject(new Error('Failed to read project data.'));
			reader.readAsDataURL(blob);
		});
	}

	dataUrlToBlob(dataUrl) {
		const [meta, payload] = dataUrl.split(',');
		const mimeMatch = meta.match(/data:(.*?)(;base64)?$/);
		const mimeType = mimeMatch?.[1] || 'application/octet-stream';
		const bytes = atob(payload || '');
		const array = new Uint8Array(bytes.length);
		for (let i = 0; i < bytes.length; i++) {
			array[i] = bytes.charCodeAt(i);
		}
		return new Blob([array], { type: mimeType });
	}
}

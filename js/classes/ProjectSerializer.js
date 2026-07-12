class ProjectSerializer {
	static FORMAT = 'glitter-project';
	static FORMAT_VERSION = 1;

	/*
	Format rules:
	- Adding an optional key with a sensible default does not bump the version.
	- Renaming, re-typing, or re-meaning a key bumps the version and ships a migration.
	- Never repurpose an old key name.
	- Unknown keys are ignored for forward-tolerance.
	*/
	static MIGRATIONS = {};

	constructor(editor) {
		this.editor = editor;
	}

	async serialize() {
		const layers = this.editor.layers.map((layer) =>
			this.editor.layerManager.serializeLayer(layer, { includeMaskVersion: false })
		);

		return {
			format: ProjectSerializer.FORMAT,
			version: ProjectSerializer.FORMAT_VERSION,
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
			customStickers: await this.serializeCustomStickers(layers)
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
			const confirmed = await this.editor.confirmAction({
				title: 'Replace Current Project',
				message: 'Your current project has unsaved changes. Open this project instead?',
				confirmLabel: 'Open Project'
			});
			if (!confirmed) {
				return false;
			}
		}
		this.editor.textGlitterManager.pickerSession = null;
		this.editor.shapeGlitterManager.pickerSession = null;
		this.editor.stickerManager.pickerSession = null;
		this.editor.glitterManager.pickerSession = null;
		document.getElementById('designGallerySection')?.classList.remove('picker-mode');

		await this.loadBaseImage(migrated);
		// Base-image loading resets manager state, so embedded assets must bind after it.
		await this.registerCustomStickers(migrated.customStickers || {});

		this.editor.layers = [];
		for (const layerData of migrated.layers) {
			const layer = await this.editor.layerManager.deserializeLayer(layerData);
			if (layer) {
				this.editor.layers.push(layer);
			}
		}

		await this.restoreMasks(migrated.masks || {});

		const activeLayer = this.editor.layers.find((layer) => layer.id === migrated.activeLayerId);
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
		await this.editor.textGlitterManager.loadFontsManifest();
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
			if (layer.type === LayerType.STICKER && layer.stickerSourceId && !embedded[layer.stickerSourceId] && !this.editor.stickerManager.getItemById(layer.stickerSourceId)) {
				issues.push({ kind: 'sticker', index, id: layer.stickerSourceId, message: `${label}: sticker “${layer.stickerSourceId}” is missing — the layer will load empty` });
			}
			if (layer.type === LayerType.TEXT_GLITTER && layer.textData?.fontId && !this.editor.textGlitterManager.fontsById.has(layer.textData.fontId)) {
				issues.push({ kind: 'font', index, id: layer.textData.fontId, message: `${label}: font “${layer.textData.fontId}” is unavailable — the default font will be used` });
			}
			if (layer.type === LayerType.SHAPE && !ShapeLibrary.FILL_SHAPES.some((shape) => shape.id === layer.shapeData?.shapeId)) {
				issues.push({ kind: 'shape', index, id: layer.shapeData?.shapeId, message: `${label}: shape “${layer.shapeData?.shapeId}” is unavailable — the default shape will be used` });
			}
			const visit = (value) => {
				if (!value || typeof value !== 'object') return;
				Object.entries(value).forEach(([key, child]) => {
					if ((key === 'glitterId' || key === 'selectedGlitterId') && child && !this.editor.glitterManager.getItemById(child)) {
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
				const replace = (value, path = '') => {
					if (!value || typeof value !== 'object') return;
					Object.entries(value).forEach(([key, child]) => {
						if ((key === 'glitterId' || key === 'selectedGlitterId') && child === issue.id) {
							value[key] = path.includes('border') ? CONFIG.tools.glitter.defaults.borderGlitterId
								: path.includes('shadow') ? CONFIG.tools.glitter.defaults.shadowGlitterId
									: CONFIG.tools.glitter.defaults.fillGlitterId;
						} else if (typeof child === 'object') replace(child, `${path}.${key}`);
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
		if (!Number.isInteger(width) || !Number.isInteger(height) ||
			width < 1 || height < 1 ||
			width > CONFIG.canvas.limits.maxWidth || height > CONFIG.canvas.limits.maxHeight) {
			throw new Error('That project file has invalid canvas dimensions.');
		}

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
			preset: null
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

			const paint = this.editor.glitterManager.getPaintMask(layer.id);
			if (paint?.hasContent) {
				masks[layer.id] = {
					add: paint.add.toDataURL('image/png'),
					sub: paint.sub.toDataURL('image/png')
				};
				continue;
			}

			const snapshot = layer.maskVersion
				? this.editor.glitterManager.findPaintSnapshot(layer.id, layer.maskVersion)
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
		const usedIds = new Set(
			layers
				.filter((layer) => layer?.type === LayerType.STICKER && String(layer.stickerSourceId || '').startsWith('user-upload-'))
				.map((layer) => layer.stickerSourceId)
		);

		for (const stickerId of usedIds) {
			const sticker = this.editor.stickerManager.getItemById(stickerId);
			if (!sticker?.url) continue;
			const blob = await fetch(sticker.url).then((response) => response.blob());
			customStickers[stickerId] = {
				name: sticker.name || 'Sticker',
				fileName: sticker.filename || `${sticker.name || stickerId}.png`,
				mimeType: sticker.mimeType || blob.type || 'image/png',
				data: await this.blobToDataUrl(blob)
			};
		}

		return customStickers;
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

	async loadBaseImage(projectData) {
		const { baseImage } = projectData;
		if (baseImage.canvasData) {
			const blob = this.dataUrlToBlob(baseImage.canvasData);
			const loaded = await this.editor.loadImageFromBlob(blob, {
				fileName: `${projectData.name || 'project'}-canvas.png`,
				source: {
					kind: 'serialized-canvas'
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
					kind: 'project-file'
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

			const paint = this.editor.glitterManager.ensurePaintMask(layer.id);
			await this.drawMaskData(paint.add, maskEntry.add);
			await this.drawMaskData(paint.sub, maskEntry.sub);
			this.editor.glitterManager.commitPaintState(layer);
		}
	}

	alphaSnapshotToDataUrl(alphaData) {
		const canvas = document.createElement('canvas');
		canvas.width = this.editor.originalCanvas.width;
		canvas.height = this.editor.originalCanvas.height;
		this.editor.glitterManager.blitAlphaToCanvas(canvas, alphaData);
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
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error('Failed to decode embedded image data.'));
			img.src = src;
		});
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

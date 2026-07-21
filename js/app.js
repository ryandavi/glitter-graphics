// ============================================
// GLITTER EDITOR CLASS
// Contains all the logic for the glitter editor - UI and functionality
// ============================================

class GlitterEditor {
	constructor() {
		// ============================================================================
		// DOM REFERENCES
		// ============================================================================
		this.originalCanvas = document.getElementById('originalCanvas');
		this.previewCanvas = document.getElementById('previewCanvas');
		this.previewContainer = document.getElementById('previewContainer');
		this.previewWrapper = document.getElementById('previewWrapper');
		this.canvasElementsContainer = document.getElementById('canvasElementsContainer');

		// ============================================================================
		// CANVAS SETUP
		// ============================================================================
		this.previewCanvas.style.zIndex = '1';
		this.canvasElementsContainer.style.zIndex = '10';
		this.canvasElementsContainer.style.pointerEvents = 'none'; // Allows clicking through to canvas

		this.originalCtx = this.originalCanvas.getContext('2d', { willReadFrequently: true });
		this.previewCtx = this.previewCanvas.getContext('2d', { willReadFrequently: true });

		// ============================================================================
		// IMAGE DATA
		// ============================================================================
		this.originalImage = null;
		this.originalImageData = null;
		this.originalAlphaChannel = null;

		// ============================================================================
		// CONTENT & LAYERS
		// ============================================================================
		this.content = [];
		this.selectedLayerIds = new Set();

		// ============================================================================
		// TOOL & HISTORY
		// ============================================================================
		this.currentTool = null;

		// ============================================================================
		// DISPLAY SETTINGS
		// ============================================================================
		this.showAllLayers = true;
		this.showHints = CONFIG.ui.hints.enabledByDefault;
		this.currentHintDismissed = false;

		// ============================================================================
		// STATE FLAGS
		// ============================================================================
		this.isSaved = false;
		this.projectName = '';
		this.baseImageSource = null;
		this.touchGestureActive = false;
		this.justCompletedDrag = false; // Flag to prevent layer picking immediately after drag
		this.pendingConfirmationResolve = null;
		this.pendingConfirmationValue = false;
		this.pendingAutoGlitterTool = null;
		this.autoGlitterToolPrompt = null;

		// ============================================================================
		// EXPORT STATE
		// ============================================================================
		this.exportStartTime = 0;
		this.exportCancelled = false;

		// Render schema-driven panel sections (js/ui/panel-renderer.js +
		// PANEL_SCHEMAS), then the shared transform panels into the hosts the
		// schemas created, BEFORE manager setup — every manager binds against
		// one generated DOM structure, built once (never re-rendered after
		// boot; rebuilding would orphan listeners). MobileManager later moves
		// these same nodes into drawers, so bindings survive re-parenting.
		renderPanelSections(this);
		this.renderTransformPanels();
		this.contextToolbarRenderer = new ContextToolbarRenderer(this);
		this.contextToolbarRenderer.render();

		// ============================================================================
		// MANAGERS
		// ============================================================================
		this.viewport = new ViewportManager(this.previewContainer, this.previewWrapper);
		this.viewport.editor = this;
		this.layerManager = new LayerManager(this);
		this.stickerManager = new StickerManager(this);
		this.glitterManager = new GlitterManager(this);
		this.baseBackgroundManager = new BaseBackgroundManager(this);
		this.autoGlitterManager = new AutoGlitterManager(this);
		this.textGlitterManager = new TextGlitterManager(this);
		this.shapeGlitterManager = new ShapeGlitterManager(this);
		this.groupTransformManager = new GroupTransformManager(this);
		this.mobileManager = new MobileManager(this);
		this.maskCompositor = new MaskCompositor(this);
		this.maskEditor = new MaskEditor(this);
		this.historyManager = new HistoryManager(this);
		this.projectSerializer = new ProjectSerializer(this);

		// ============================================================================
		// INITIALIZATION
		// ============================================================================
		this.initializeProjectNameInput();
		const rememberedTool = sessionStorage.getItem('glitter:lastTool');
		const initialTool = Object.values(ToolType).includes(rememberedTool) ? rememberedTool : CONFIG.app.startup.tool;
		this.setTool(this.mobileManager.isMobile && initialTool === ToolType.HAND ? ToolType.SELECT : initialTool);
		this.setupEventListeners();
		this.initializeAltDuplicateFeedback();
		this.initializeCollapsibleSections();
		this.initializeAdvancedDisclosures();
		this.initializeShortcutsModal();
		this.initializeExportSettings();
	}

	initializeAltDuplicateFeedback() {
		const sync = (armed) => this.previewContainer?.classList.toggle(
			'alt-duplicate-armed', Boolean(armed) && this.currentTool === ToolType.SELECT
		);
		document.addEventListener('keydown', (event) => {
			if (event.key === 'Alt' && !event.repeat) sync(true);
		});
		document.addEventListener('keyup', (event) => {
			if (event.key === 'Alt') sync(false);
		});
		window.addEventListener('blur', () => {
			sync(false);
			this.endTemporaryHandTool();
		});
		document.getElementById('statusZoom')?.addEventListener('dblclick', () => {
			if (this.originalImage) this.viewport.resetZoom({ animate: true });
		});
		this.previewContainer?.addEventListener('dblclick', (event) => {
			if (this.currentTool !== ToolType.SELECT || !event.target.closest(TRANSFORMABLE_LAYER_ELEMENT_SELECTOR)) return;
			const layer = this.layerManager.getActiveLayer();
			if (layer?.type !== LayerType.TEXT_GLITTER) return;
			this.textGlitterManager?.focusTextInput?.(true);
		});
	}

	setDuplicateDragFeedback(active, count = 1) {
		this.previewContainer?.classList.toggle('duplicate-drag-active', Boolean(active));
		this.duplicateDragStatus = active ? (count > 1 ? `Duplicating ${count} layers` : 'Duplicating layer') : '';
		const status = document.getElementById('statusText');
		if (status) status.textContent = this.duplicateDragStatus;
	}

	addDuplicateGhost(sourceTransform, targetTransform) {
		if (!sourceTransform?.element || !targetTransform || targetTransform.refreshElementReference?.()) return null;
		const ghost = sourceTransform.element.cloneNode(true);
		ghost.removeAttribute('id');
		ghost.removeAttribute('data-layer-id');
		ghost.querySelectorAll?.('[id], [data-layer-id]').forEach((node) => {
			node.removeAttribute('id');
			node.removeAttribute('data-layer-id');
		});
		ghost.dataset.duplicateGhost = '';
		ghost.style.pointerEvents = 'none';
		sourceTransform.element.parentElement?.appendChild(ghost);
		this._duplicateGhosts ||= new Map();
		this._duplicateGhosts.set(targetTransform, ghost);
		this.syncDuplicateGhost(targetTransform);

		let frames = 0;
		const retireWhenReady = () => {
			if (!ghost.isConnected) return;
			if (targetTransform.refreshElementReference?.() || frames++ > 300) {
				ghost.remove();
				this._duplicateGhosts?.delete(targetTransform);
				return;
			}
			requestAnimationFrame(retireWhenReady);
		};
		requestAnimationFrame(retireWhenReady);
		return ghost;
	}

	syncDuplicateGhost(targetTransform) {
		const ghost = this._duplicateGhosts?.get(targetTransform);
		if (!ghost?.isConnected) return;
		targetTransform.applyTransform(ghost, targetTransform.getDimensions());
		ghost.style.pointerEvents = 'none';
	}

	syncDuplicateGhosts() {
		this._duplicateGhosts?.forEach((_ghost, transform) => this.syncDuplicateGhost(transform));
	}

	// ===== DEBUG CONFIGURATION LOADER =====
	async loadDebugConfig() {
		if (!DEBUG_CONFIG.enabled) return;


		// 1. Load blank canvas
		await this.loadBlankImage(
			DEBUG_CONFIG.canvas.width,
			DEBUG_CONFIG.canvas.height,
			DEBUG_CONFIG.canvas.color
		);

		// Wait for image to fully load
		await new Promise(resolve => {
			const checkImage = setInterval(() => {
				if (this.originalImage) {
					clearInterval(checkImage);
					resolve();
				}
			}, 50);
		});

		// 2. Load each sticker preset
		for (const stickerPreset of DEBUG_CONFIG.stickers) {
			const stickerId = stickerPreset.id;
			const stickerInfo = this.stickerManager.getItemById(stickerId);

			if (!stickerInfo) {
				console.warn(`[DEBUG] Sticker ID ${stickerId} not found, skipping`);
				continue;
			}

			// Create the sticker layer with default settings
			const layer = this.stickerManager.createLayer(stickerId);

			// Override position from preset
			layer.stickerData.transform.position.x = stickerPreset.x;
			layer.stickerData.transform.position.y = stickerPreset.y;

			// Insert layer
			this.layerManager.insertLayer(layer);

			// Render the sticker
			this.stickerManager.renderLayer(layer);

			dbg(`[DEBUG] Loaded sticker: ${stickerInfo.name} at (${stickerPreset.x}, ${stickerPreset.y})`);
		}

		// 3. Update UI
		this.layerManager.renderLayersList();
		this.updatePreview();
		this.updateActionButtons();
		this.saveState();

	}

	// ===== UTILITY METHODS =====

	// Execute async function with element disabled
	async withDisabled(element, asyncFn) {
		if (!element) return;
		element.disabled = true;
		try {
			await asyncFn();
		} finally {
			element.disabled = false;
		}
	}

	initializeProjectNameInput() {
		const input = document.getElementById('projectNameInput');
		if (!input) return;

		input.placeholder = 'Name...';
		input.value = this.projectName;
		input.addEventListener('input', () => {
			this.setProjectName(input.value, { markDirty: true, syncInput: false });
		});
	}

	setProjectName(name, options = {}) {
		const {
			markDirty = true,
			syncInput = true
		} = options;
		this.projectName = typeof name === 'string' ? name : '';

		if (syncInput) {
			const input = document.getElementById('projectNameInput');
			if (input && input.value !== this.projectName) {
				input.value = this.projectName;
			}
		}

		if (markDirty && (this.originalImage || this.historyManager.canUndo())) {
			this.isSaved = false;
		}
	}

	getProjectFileName(ext) {
		const baseName = sanitizeFileName(this.projectName) || CONFIG.export.core.defaultBaseName;
		return `${baseName}.${ext}`;
	}

	getProjectDownloadName() {
		const baseName = sanitizeFileName(this.projectName);
		if (!baseName) return `${CONFIG.export.core.defaultBaseName}.${CONFIG.project.extension}`;
		const suffix = sanitizeFileName(CONFIG.project.fileNameSuffix) || '';
		return `${baseName}${suffix}.${CONFIG.project.extension}`;
	}

	// Common layer update pattern
	updateLayerAndSave(updatePreview = true) {
		this.saveActiveLayerSettings();
		if (updatePreview) {
			this.updatePreview();
		}
		this.saveState();
	}

	// Layer type helpers
	isGlitterLayer(layer) {
		return layer && layer.type === LayerType.GLITTER_FILL;
	}

	isStickerLayer(layer) {
		return layer && layer.type === LayerType.STICKER;
	}

	isTextLayer(layer) {
		return layer && layer.type === LayerType.TEXT_GLITTER;
	}

	// ===== GETTERS & SETTERS =====
	get layers() {
		return this.layerManager.layers;
	}

	set layers(value) {
		this.layerManager.layers = value;
	}

	get activeLayerId() {
		return this.layerManager.activeLayerId;
	}

	set activeLayerId(value) {
		this.layerManager.activeLayerId = value;
	}

	// ===== INITIALIZATION =====

	async init() {
		this.exporter = new GifExporter();
		this.mp4Exporter = new Mp4Exporter(this.exporter);
		await this.stickerManager.init();
		await this.glitterManager.init(); // NEW
		await this.textGlitterManager.init();
		this.updateSidePanelUI(null);
	}

	// ===== SETTINGS PERSISTENCE =====

	saveSettingsToStorage() {
		const settings = {
			exportFormat: this.exportSettings.format,
			exportMp4LengthMode: this.exportSettings.mp4LengthMode,
			exportMp4TargetDuration: this.exportSettings.mp4TargetDuration,
			exportMp4LoopCount: this.exportSettings.mp4LoopCount,
			exportMp4Quality: this.exportSettings.mp4Quality,
			exportQuality: this.exportSettings.quality,
			exportDitherEnabled: this.exportSettings.ditherEnabled,
			exportDitherType: this.exportSettings.ditherType,
			exportFrameDelay: this.exportSettings.frameDelay,
			exportMaxFrames: this.exportSettings.maxFrames,
			exportTransparency: this.exportSettings.transparency,
			exportMatteColor: this.exportSettings.matteColor,
			exportWatermarkEnabled: this.exportSettings.watermarkEnabled,
			exportFrameSkip: this.exportSettings.exportFrameSkip,
			exportReverse: this.exportSettings.exportReverse,
			exportSmartFrameReduction: this.exportSettings.smartFrameReduction,
			exportOptimizationPreset: this.exportSettings.optimizationPreset,
			exportMaxSamplingFps: this.exportSettings.maxSamplingFps,
			exportBaseImage: this.exportSettings.baseImage,
			showHelpfulHints: this.showHints,
			showWelcomeOnStartup: this.showWelcomeOnStartup,
			confirmDestructiveActions: this.confirmDestructiveActions,
			interfaceTheme: this.interfaceTheme,
			autoSelect: CONFIG.app.behavior.autoSelect
		};

		try {
			localStorage.setItem('glitterEditorSettings', JSON.stringify(settings));
		} catch (e) {
			console.warn('Failed to save settings to localStorage:', e);
		}
	}

	loadSettingsFromStorage() {
		try {
			const saved = localStorage.getItem('glitterEditorSettings');
			if (saved) {
				return JSON.parse(saved);
			}
		} catch (e) {
			console.warn('Failed to load settings from localStorage:', e);
		}
		return null;
	}


	// ===== EXPORT SETTINGS =====

initializeExportSettings() {
	const savedSettings = this.loadSettingsFromStorage();
	let welcomeWasSuppressed = false;
	try {
		welcomeWasSuppressed = localStorage.getItem('glitterEditor_welcomeModalSeen') === 'true';
	} catch (error) {
		console.warn('Failed to read welcome-screen preference:', error);
	}

	// Initialize export settings with saved values or defaults
	this.exportSettings = {
		format: savedSettings?.exportFormat ?? CONFIG.export.defaults.format,
		mp4LengthMode: savedSettings?.exportMp4LengthMode ?? CONFIG.export.mp4.lengthMode,
		mp4TargetDuration: savedSettings?.exportMp4TargetDuration ?? CONFIG.export.mp4.targetDurationSeconds,
		mp4LoopCount: savedSettings?.exportMp4LoopCount ?? CONFIG.export.mp4.loopCount,
		mp4Quality: savedSettings?.exportMp4Quality ?? CONFIG.export.mp4.defaultQuality,
		quality: savedSettings?.exportQuality ?? CONFIG.export.defaults.quality,
		ditherEnabled: savedSettings?.exportDitherEnabled ?? CONFIG.export.defaults.ditherEnabled,
		ditherType: savedSettings?.exportDitherType ?? CONFIG.export.defaults.ditherType,
		baseImage: savedSettings?.exportBaseImage ?? CONFIG.export.defaults.baseImage,
		frameDelay: savedSettings?.exportFrameDelay ?? CONFIG.export.defaults.frameDelay,
		maxFrames: savedSettings?.exportMaxFrames ?? CONFIG.export.defaults.maxFrames,
		transparency: savedSettings?.exportTransparency ?? CONFIG.export.defaults.transparency,
		matteColor: savedSettings?.exportMatteColor ?? CONFIG.export.defaults.matteColor,
		watermarkEnabled: savedSettings?.exportWatermarkEnabled ?? CONFIG.export.defaults.watermarkEnabled,
		exportFrameSkip: savedSettings?.exportFrameSkip ?? CONFIG.export.defaults.frameSkip,
		exportReverse: savedSettings?.exportReverse ?? CONFIG.export.defaults.reverse,
		smartFrameReduction: savedSettings?.exportSmartFrameReduction ?? CONFIG.export.defaults.smartFrameReduction,
		optimizationPreset: savedSettings?.exportOptimizationPreset ?? CONFIG.export.defaults.optimizationPreset,
		maxSamplingFps: savedSettings?.exportMaxSamplingFps ?? CONFIG.export.defaults.maxSamplingFps
	};

	// Update this.showHints
	this.showHints = savedSettings?.showHelpfulHints ?? CONFIG.ui.hints.enabledByDefault;
	this.showWelcomeOnStartup = savedSettings?.showWelcomeOnStartup ?? !welcomeWasSuppressed;
	this.confirmDestructiveActions = savedSettings?.confirmDestructiveActions ?? true;
	CONFIG.app.behavior.autoSelect = savedSettings?.autoSelect ?? CONFIG.app.behavior.autoSelect;
	this.interfaceTheme = CONFIG.ui.themes.includes(savedSettings?.interfaceTheme) ? savedSettings.interfaceTheme : 'dark';
	this.applyInterfaceTheme();

	// Sync UI to match exportSettings
	this.syncExportSettingsToUI();

	// Setup listeners
	this.setupExportSettingsListeners();
	this.setupSettingsResetListeners(); // ADD THIS LINE
}

	syncExportSettingsToUI() {
		const uiElements = {
			exportMp4LengthMode: { value: this.exportSettings.mp4LengthMode },
			exportMp4TargetDuration: { value: this.exportSettings.mp4TargetDuration },
			exportMp4LoopCount: { value: this.exportSettings.mp4LoopCount },
			exportMp4Quality: { value: this.exportSettings.mp4Quality },
			exportQuality: { value: this.exportSettings.quality },
			exportDitherEnabled: { checked: this.exportSettings.ditherEnabled },
			exportDitherType: { value: this.exportSettings.ditherType },
			exportBaseImage: { checked: this.exportSettings.baseImage },
			exportTransparency: { checked: this.exportSettings.transparency },
			exportMatteColor: { value: this.exportSettings.matteColor },
			exportFrameDelay: { value: this.exportSettings.frameDelay },
			exportMaxFrames: { value: this.exportSettings.maxFrames },
			exportWatermarkEnabled: { checked: this.exportSettings.watermarkEnabled },
			exportFrameSkip: { value: this.exportSettings.exportFrameSkip },
			exportReverse: { checked: this.exportSettings.exportReverse },
			exportSmartFrameReduction: { checked: this.exportSettings.smartFrameReduction },
			exportOptimizationPreset: { value: this.exportSettings.optimizationPreset },
			exportMaxSamplingFps: { value: this.exportSettings.maxSamplingFps },
			showHelpfulHints: { checked: this.showHints },
			showWelcomeOnStartup: { checked: this.showWelcomeOnStartup },
			confirmDestructiveActions: { checked: this.confirmDestructiveActions },
			interfaceTheme: { value: this.interfaceTheme }
		};

		Object.entries(uiElements).forEach(([id, props]) => {
			const element = document.getElementById(id);
			if (!element) return;

			if ('value' in props) element.value = props.value;
			if ('checked' in props) element.checked = props.checked;
		});

		// Update visibility states
		const ditherTypeRow = document.getElementById('ditherTypeRow');
		if (ditherTypeRow) {
			ditherTypeRow.classList.toggle('disabled', !this.exportSettings.ditherEnabled);
		}

		const matteColorRow = document.getElementById('matteColorRow');
		if (matteColorRow) {
			matteColorRow.classList.toggle('disabled', this.exportSettings.format !== 'mp4' && this.exportSettings.transparency);
		}
		this.updateExportFormatUI();
	}


	setupExportSettingsListeners() {
		// Map UI elements to exportSettings properties
		const settingsMap = [
			{ id: 'exportMp4LengthMode', prop: 'mp4LengthMode', parse: (v) => v },
			{ id: 'exportMp4TargetDuration', prop: 'mp4TargetDuration', parse: (v) => parseFloat(v) },
			{ id: 'exportMp4LoopCount', prop: 'mp4LoopCount', parse: (v) => parseInt(v) },
			{ id: 'exportMp4Quality', prop: 'mp4Quality', parse: (v) => v },
			{ id: 'exportQuality', prop: 'quality', parse: (v) => parseInt(v) },
			{ id: 'exportDitherEnabled', prop: 'ditherEnabled', parse: (v) => v },
			{ id: 'exportDitherType', prop: 'ditherType', parse: (v) => v },
			{ id: 'exportBaseImage', prop: 'baseImage', parse: (v) => v },
			{ id: 'exportTransparency', prop: 'transparency', parse: (v) => v },
			{ id: 'exportMatteColor', prop: 'matteColor', parse: (v) => v },
			{ id: 'exportFrameDelay', prop: 'frameDelay', parse: (v) => parseInt(v) },
			{ id: 'exportMaxFrames', prop: 'maxFrames', parse: (v) => v === 'unlimited' ? CONFIG.export.limits.maxFramesHardLimit : parseInt(v) },
			{ id: 'exportWatermarkEnabled', prop: 'watermarkEnabled', parse: (v) => v },
			{ id: 'exportFrameSkip', prop: 'exportFrameSkip', parse: (v) => parseInt(v) },
			{ id: 'exportReverse', prop: 'exportReverse', parse: (v) => v },
			{ id: 'exportSmartFrameReduction', prop: 'smartFrameReduction', parse: (v) => v },
			{ id: 'exportOptimizationPreset', prop: 'optimizationPreset', parse: (v) => v },
			{ id: 'exportMaxSamplingFps', prop: 'maxSamplingFps', parse: (v) => parseInt(v) }
		];

		settingsMap.forEach(({ id, prop, parse }) => {
			const element = document.getElementById(id);
			if (!element) return;

			element.addEventListener('change', (e) => {
				const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
				this.exportSettings[prop] = parse(value);
				this.saveSettingsToStorage();
				this.updateExportDuration();

				// Update dependent UI states
				if (id === 'exportDitherEnabled') {
					const ditherTypeRow = document.getElementById('ditherTypeRow');
					if (ditherTypeRow) ditherTypeRow.classList.toggle('disabled', !value);
				}
				if (id === 'exportTransparency') {
					this.updateExportFormatUI();
				}
				if (id === 'exportMp4LengthMode') {
					this.updateExportFormatUI();
				}
			});
		});

		// Delegate live repeat changes so the duration remains bound even if modal
		// controls are reinitialized or replaced in a responsive UI rebuild.
		document.addEventListener('input', (event) => {
			if (!['exportMp4LoopCount', 'exportMp4TargetDuration'].includes(event.target?.id)) return;
			const value = event.target.valueAsNumber;
			if (Number.isFinite(value)) {
				if (event.target.id === 'exportMp4LoopCount') this.exportSettings.mp4LoopCount = value;
				else this.exportSettings.mp4TargetDuration = value;
			}
			this.updateExportDuration();
		});

		document.querySelectorAll('#exportFormatControl [data-export-format]').forEach((button) => {
			button.addEventListener('click', () => {
				if (button.disabled) return;
				this.exportSettings.format = button.dataset.exportFormat;
				this.updateExportFormatUI();
				this.saveSettingsToStorage();
			});
		});

		Mp4Exporter.isSupported().then((supported) => {
			this.mp4ExportSupported = supported;
			if (!supported && this.exportSettings.format === 'mp4') this.exportSettings.format = CONFIG.export.defaults.format;
			this.updateExportFormatUI();
		}).catch(() => {
			this.mp4ExportSupported = false;
			if (this.exportSettings.format === 'mp4') this.exportSettings.format = CONFIG.export.defaults.format;
			this.updateExportFormatUI();
		});

		// Helpful hints setting
		const showHintsInput = document.getElementById('showHelpfulHints');
		if (showHintsInput) {
			showHintsInput.addEventListener('change', (e) => {
				this.showHints = e.target.checked;
				this.updateHelpfulMessage();
				this.saveSettingsToStorage();
			});
		}

		const welcomeInput = document.getElementById('showWelcomeOnStartup');
		welcomeInput?.addEventListener('change', (e) => {
			this.showWelcomeOnStartup = e.target.checked;
			if (this.showWelcomeOnStartup) localStorage.removeItem('glitterEditor_welcomeModalSeen');
			else localStorage.setItem('glitterEditor_welcomeModalSeen', 'true');
			this.saveSettingsToStorage();
		});

		const confirmInput = document.getElementById('confirmDestructiveActions');
		confirmInput?.addEventListener('change', (e) => {
			this.confirmDestructiveActions = e.target.checked;
			this.saveSettingsToStorage();
		});

		const themeInput = document.getElementById('interfaceTheme');
		themeInput?.addEventListener('change', (e) => {
			this.interfaceTheme = CONFIG.ui.themes.includes(e.target.value) ? e.target.value : 'dark';
			this.applyInterfaceTheme();
			this.saveSettingsToStorage();
		});
	}

	updateExportFormatUI() {
		const isMp4 = this.exportSettings.format === 'mp4' && this.mp4ExportSupported === true;
		const activeFormat = isMp4 ? 'mp4' : 'gif';
		const formatDescription = document.getElementById('exportFormatDescription');
		if (formatDescription) {
			formatDescription.textContent = this.mp4ExportSupported === true
				? 'Choose an animated GIF or a broadly compatible MP4 video.'
				: 'Export an animated GIF.';
		}
		document.querySelectorAll('#exportFormatControl [data-export-format]').forEach((button) => {
			const format = button.dataset.exportFormat;
			button.classList.toggle('active', format === activeFormat);
			button.setAttribute('aria-pressed', String(format === activeFormat));
			if (format === 'mp4') {
				const supported = this.mp4ExportSupported === true;
				button.hidden = !supported;
				button.disabled = !supported;
				button.title = supported ? '' : 'MP4 export requires WebCodecs H.264 support in this browser.';
			}
		});
		document.querySelectorAll('[data-export-format-section="gif"]').forEach((row) => row.hidden = isMp4);
		document.querySelectorAll('[data-export-format-section="mp4"]').forEach((row) => row.hidden = !isMp4);
		const usesTargetDuration = this.exportSettings.mp4LengthMode === 'duration';
		const targetDurationRow = document.getElementById('exportMp4TargetDurationRow');
		const loopCountRow = document.getElementById('exportMp4LoopCountRow');
		if (targetDurationRow) targetDurationRow.hidden = !isMp4 || !usesTargetDuration;
		if (loopCountRow) loopCountRow.hidden = !isMp4 || usesTargetDuration;
		const transparency = document.getElementById('exportTransparency');
		if (transparency) transparency.disabled = isMp4;
		const matteColorRow = document.getElementById('matteColorRow');
		const matteColor = document.getElementById('exportMatteColor');
		const matteDisabled = !isMp4 && this.exportSettings.transparency;
		matteColorRow?.classList.toggle('disabled', matteDisabled);
		if (matteColor) matteColor.disabled = matteDisabled;
		const buttonName = document.querySelector('#exportGif .name');
		if (buttonName) buttonName.textContent = isMp4 ? 'Export MP4' : 'Export GIF';
		this.updateExportDuration();
	}

	async updateExportDuration() {
		const output = document.getElementById('exportMp4Duration');
		if (!output) return;
		const requestId = (this.exportDurationRequestId || 0) + 1;
		this.exportDurationRequestId = requestId;
		const usesTargetDuration = this.exportSettings.mp4LengthMode === 'duration';
		const enteredDuration = document.getElementById('exportMp4TargetDuration')?.valueAsNumber;
		const targetDuration = Math.min(
			CONFIG.export.mp4.maxDurationSeconds,
			Math.max(
				CONFIG.export.mp4.minDurationSeconds,
				Number.isFinite(enteredDuration) ? enteredDuration : this.exportSettings.mp4TargetDuration
			)
		);
		const enteredLoops = document.getElementById('exportMp4LoopCount')?.valueAsNumber;
		const loopCount = Math.min(
			CONFIG.export.mp4.maxLoopCount,
			Math.max(CONFIG.export.mp4.minLoopCount, Number.isFinite(enteredLoops) ? enteredLoops : this.exportSettings.mp4LoopCount)
		);
		const formatSeconds = (seconds) => {
			if (seconds >= 60) {
				const minutes = Math.floor(seconds / 60);
				const remainder = Math.round((seconds % 60) * 10) / 10;
				return remainder > 0 ? `${minutes} min ${remainder} sec` : `${minutes} min`;
			}
			const rounded = Math.round(seconds * 10) / 10;
			return `${rounded} ${rounded === 1 ? 'second' : 'seconds'}`;
		};

		if (usesTargetDuration) {
			output.textContent = `${formatSeconds(targetDuration)}. The animation repeats as needed and ends at that time.`;
		} else {
			output.textContent = 'Calculating from the source animation timing…';
		}

		if (!this.exporter || !this.glitterManager?.content) return;
		const visibleLayers = this.layers.filter((layer) => layer.visible && layerHasVisibleContent(layer));
		if (!visibleLayers.length) return;

		try {
			const estimate = await this.exporter.estimateLoopDuration({
				layers: visibleLayers,
				library: this.glitterManager.content,
				fallbackDuration: this.exportSettings.frameDelay,
				parseGif: (url) => this.glitterManager.parseGifFromUrl(url)
			});
			if (requestId !== this.exportDurationRequestId) return;
			const loopDurationSeconds = estimate.duration / 1000;
			if (usesTargetDuration) {
				const repeats = targetDuration / loopDurationSeconds;
				const completeRepeats = Math.round(repeats);
				const isCompleteLoop = Math.abs(repeats - completeRepeats) < 0.001;
				output.textContent = isCompleteLoop
					? `${formatSeconds(targetDuration)}. ${completeRepeats} complete ${completeRepeats === 1 ? 'loop' : 'loops'}.`
					: `${formatSeconds(targetDuration)}. About ${repeats.toFixed(repeats >= 10 ? 1 : 2)} loops; the video ends at the requested time.`;
			} else {
				output.textContent = `${formatSeconds(loopDurationSeconds * loopCount)}. ${loopCount} complete ${loopCount === 1 ? 'loop' : 'loops'}.`;
			}
		} catch (error) {
			if (requestId !== this.exportDurationRequestId) return;
			console.warn('Export duration estimate failed:', error);
			if (!usesTargetDuration) output.textContent = 'Could not load an animation source to estimate the duration. Export will try again.';
		}
	}

	applyInterfaceTheme() {
		document.documentElement.dataset.theme = this.interfaceTheme || 'dark';
	}

setupSettingsResetListeners() {
	// Per-section reset buttons
	document.querySelectorAll('.reset-section-btn').forEach(btn => {
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			const section = btn.dataset.section;
			this.resetSettingsSection(section);
		});
	});

	// Reset all button
	const resetExportBtn = document.querySelector('.reset-export-settings-btn');
	if (resetExportBtn) {
		resetExportBtn.addEventListener('click', () => {
			this.resetExportSettings();
		});
	}

	const resetAllBtn = document.querySelector('.reset-all-settings-btn');
	if (resetAllBtn) {
		resetAllBtn.addEventListener('click', () => {
			this.resetAllSettings();
		});
	}

	document.getElementById('resetToolSettings')?.addEventListener('click', () => this.resetToolSettings());
	document.getElementById('resetPanelLayout')?.addEventListener('click', () => this.resetPanelLayout());
}

async resetToolSettings() {
	const confirmed = await this.confirmSettingsAction({
		title: 'Reset Brush & Eraser',
		message: 'Saved Brush and Eraser settings will be restored to their defaults.',
		confirmLabel: 'Reset Tools'
	});
	if (!confirmed) return;
	this.maskEditor?.resetToolSettingsToDefaults();
	this.updateStatus('Brush and Eraser settings reset');
}

async resetPanelLayout() {
	const confirmed = await this.confirmSettingsAction({
		title: 'Reset Panel Layout',
		message: 'All collapsible property and tool groups will be expanded.',
		confirmLabel: 'Reset Panels'
	});
	if (!confirmed) return;
	this.applyDefaultPanelLayout();
	this.updateStatus('Panel layout reset');
}

applyDefaultPanelLayout() {
	localStorage.removeItem('glitter.panelGroups');
	document.querySelectorAll('[data-panel-group].collapsed').forEach((group) => group.classList.remove('collapsed'));
}

async confirmSettingsAction(options) {
	const confirmed = await this.confirmAction(options);
	await this.modalManager?.open('settingsModal');
	return confirmed;
}

async resetSettingsSection(section) {
	const sectionName = this.getSectionDisplayName(section);

	const confirmed = await this.confirmSettingsAction({
		title: `Reset ${sectionName}`,
		message: 'These settings will be restored to their defaults.',
		confirmLabel: 'Reset'
	});
	if (!confirmed) {
		return;
	}

	switch(section) {
		case 'interface':
			this.showHints = CONFIG.ui.hints.enabledByDefault;
			this.showWelcomeOnStartup = true;
			this.confirmDestructiveActions = true;
			this.interfaceTheme = 'dark';
			this.applyInterfaceTheme();
			localStorage.removeItem('glitterEditor_welcomeModalSeen');
			localStorage.removeItem('glitterEditor_welcomeLastSeenRelease');
			break;

		case 'export':
			this.exportSettings.format = CONFIG.export.defaults.format;
			this.exportSettings.mp4LengthMode = CONFIG.export.mp4.lengthMode;
			this.exportSettings.mp4TargetDuration = CONFIG.export.mp4.targetDurationSeconds;
			this.exportSettings.mp4LoopCount = CONFIG.export.mp4.loopCount;
			this.exportSettings.mp4Quality = CONFIG.export.mp4.defaultQuality;
			this.exportSettings.baseImage = CONFIG.export.defaults.baseImage;
			this.exportSettings.transparency = CONFIG.export.defaults.transparency;
			this.exportSettings.matteColor = CONFIG.export.defaults.matteColor;
			this.exportSettings.watermarkEnabled = CONFIG.export.defaults.watermarkEnabled;
			break;

		case 'encoding':
			this.exportSettings.ditherEnabled = CONFIG.export.defaults.ditherEnabled;
			this.exportSettings.ditherType = CONFIG.export.defaults.ditherType;
			this.exportSettings.quality = CONFIG.export.defaults.quality;
			break;

		case 'framecontrol':
			this.exportSettings.frameDelay = CONFIG.export.defaults.frameDelay;
			this.exportSettings.maxFrames = CONFIG.export.defaults.maxFrames;
			this.exportSettings.smartFrameReduction = CONFIG.export.defaults.smartFrameReduction;
			this.exportSettings.optimizationPreset = CONFIG.export.defaults.optimizationPreset;
			this.exportSettings.maxSamplingFps = CONFIG.export.defaults.maxSamplingFps;
			this.exportSettings.exportFrameSkip = CONFIG.export.defaults.frameSkip;
			this.exportSettings.exportReverse = CONFIG.export.defaults.reverse;
			break;
	}

	this.syncExportSettingsToUI();
	this.saveSettingsToStorage();
}

async resetAllSettings() {
	const confirmed = await this.confirmSettingsAction({
		title: 'Reset All Settings',
		message: 'Export settings, interface preferences, and everything else will be restored to their defaults.',
		confirmLabel: 'Reset'
	});
	if (!confirmed) {
		return;
	}

	// Reset all export settings
	this.exportSettings = {
		format: CONFIG.export.defaults.format,
		mp4LengthMode: CONFIG.export.mp4.lengthMode,
		mp4TargetDuration: CONFIG.export.mp4.targetDurationSeconds,
		mp4LoopCount: CONFIG.export.mp4.loopCount,
		mp4Quality: CONFIG.export.mp4.defaultQuality,
		quality: CONFIG.export.defaults.quality,
		ditherEnabled: CONFIG.export.defaults.ditherEnabled,
		ditherType: CONFIG.export.defaults.ditherType,
		baseImage: CONFIG.export.defaults.baseImage,
		transparency: CONFIG.export.defaults.transparency,
		matteColor: CONFIG.export.defaults.matteColor,
		frameDelay: CONFIG.export.defaults.frameDelay,
		maxFrames: CONFIG.export.defaults.maxFrames,
		watermarkEnabled: CONFIG.export.defaults.watermarkEnabled,
		exportFrameSkip: CONFIG.export.defaults.frameSkip,
		exportReverse: CONFIG.export.defaults.reverse,
		smartFrameReduction: CONFIG.export.defaults.smartFrameReduction,
		optimizationPreset: CONFIG.export.defaults.optimizationPreset,
		maxSamplingFps: CONFIG.export.defaults.maxSamplingFps
	};

	// Reset UI preferences
	this.showHints = CONFIG.ui.hints.enabledByDefault;
	this.showWelcomeOnStartup = true;
	this.confirmDestructiveActions = true;
	this.interfaceTheme = 'dark';
	this.applyInterfaceTheme();
	localStorage.removeItem('glitterEditor_welcomeModalSeen');
	localStorage.removeItem('glitterEditor_welcomeLastSeenRelease');
	this.maskEditor?.resetToolSettingsToDefaults();
	this.applyDefaultPanelLayout();

	this.syncExportSettingsToUI();
	this.saveSettingsToStorage();
}

	async resetExportSettings() {
		const confirmed = await this.confirmAction({
			title: 'Reset Export Settings',
			message: 'Export, encoding, and frame-control settings will be restored to their defaults.',
			confirmLabel: 'Reset'
		});
		if (!confirmed) return;

		this.exportSettings = {
			format: CONFIG.export.defaults.format,
			mp4LengthMode: CONFIG.export.mp4.lengthMode,
			mp4TargetDuration: CONFIG.export.mp4.targetDurationSeconds,
			mp4LoopCount: CONFIG.export.mp4.loopCount,
			mp4Quality: CONFIG.export.mp4.defaultQuality,
			quality: CONFIG.export.defaults.quality,
			ditherEnabled: CONFIG.export.defaults.ditherEnabled,
			ditherType: CONFIG.export.defaults.ditherType,
			baseImage: CONFIG.export.defaults.baseImage,
			transparency: CONFIG.export.defaults.transparency,
			matteColor: CONFIG.export.defaults.matteColor,
			frameDelay: CONFIG.export.defaults.frameDelay,
			maxFrames: CONFIG.export.defaults.maxFrames,
			watermarkEnabled: CONFIG.export.defaults.watermarkEnabled,
			exportFrameSkip: CONFIG.export.defaults.frameSkip,
			exportReverse: CONFIG.export.defaults.reverse,
			smartFrameReduction: CONFIG.export.defaults.smartFrameReduction,
			optimizationPreset: CONFIG.export.defaults.optimizationPreset,
			maxSamplingFps: CONFIG.export.defaults.maxSamplingFps
		};
		this.syncExportSettingsToUI();
		this.saveSettingsToStorage();
	}

	getSectionDisplayName(section) {
		const names = {
			'interface': 'Interface Settings',
			'export': 'Export Settings',
			'encoding': 'Encoding Settings',
			'framecontrol': 'Frame Control Settings'
		};
		return names[section] || 'Settings';
	}


	setupExportListeners() {
		const exportGif = document.getElementById('exportGif');
		if (exportGif) {
			exportGif.addEventListener('click', () => this.exportAnimatedGif());
		}

		const saveProject = document.getElementById('saveProject');
		if (saveProject) {
			saveProject.addEventListener('click', () => this.saveProjectFile());
		}
	}

	isLayerContentLocked(layer) {
		return Boolean(layer?.locked && layer.type !== LayerType.BASE_IMAGE);
	}

	canEditLayer(layer, options = {}) {
		const editable = Boolean(layer) && !this.isLayerContentLocked(layer);
		if (!editable && options.notify) {
			this.updateStatus('Unlock this layer to edit it');
		}
		return editable;
	}

	syncLockedLayerUI(layer) {
		const locked = this.isLayerContentLocked(layer) && !this.layerManager.hasMultiSelection();
		const propertySectionIds = [
			'glitterSettingsSection',
			'layerSettingsSection',
			'stickerSettingsSection',
			'textSettingsSection',
			'shapeSettingsSection'
		];
		propertySectionIds.forEach((id) => {
			const section = document.getElementById(id);
			if (!section) return;
			const sectionLocked = locked && section.classList.contains('visible');
			section.classList.toggle('is-layer-edit-locked', sectionLocked);
			const content = section.querySelector(':scope > .section-content');
			if (content) {
				content.inert = sectionLocked;
				content.setAttribute('aria-disabled', String(sectionLocked));
				content.title = sectionLocked ? 'Unlock this layer to edit its properties' : '';
			}
			const title = section.querySelector(':scope > .section-header .section-header-title');
			let badge = title?.querySelector('.locked-layer-badge');
			if (sectionLocked && title && !badge) {
				badge = document.createElement('span');
				badge.className = 'locked-layer-badge';
				badge.textContent = 'Locked';
				title.appendChild(badge);
			} else if (!sectionLocked) {
				badge?.remove();
			}
		});

		['centerLayerHorizontal', 'centerLayerVertical', 'duplicateLayerSelection'].forEach((id) => {
			const button = document.getElementById(id);
			if (button) button.disabled = locked;
		});
	}

	updateSidePanelUI(layer) {
		const hasMultiSelection = this.layerManager?.hasMultiSelection?.() ?? false;

		// 1. Define ALL possible sections to hide them first
		const allSections = [
			'welcomeSection',
			'noLayerSettingsSection',
			'autoGlitterSettingsSection',
			'baseLayerSettingsSection',
			'glitterSettingsSection',
			'layerSettingsSection',
			'glitterOptions',
			'glitterSearchSection',
			'stickerSettingsSection',
			'textSettingsSection',
			'shapeSettingsSection',
			'stickersOptions',
			'stickersSearchSection',
			'shapesOptions'
		];

		// 2. Hide everything
		allSections.forEach(id => {
			const el = document.getElementById(id);
			if (el) {
				el.classList.remove('visible');
				el.style.display = '';
			}
		});

		// 3. Determine which config to use
		let config;
		if (this.autoGlitterManager?.isSessionActive()) {
			config = LAYER_UI_CONFIG.AUTO_GLITTER;
		} else if (!this.originalImage) {
			config = LAYER_UI_CONFIG.NO_IMAGE;
		} else if (hasMultiSelection || !layer) {
			config = LAYER_UI_CONFIG.NO_LAYER;
		} else {
			config = LAYER_UI_CONFIG[layer.type];
		}

		// 4. Show the appropriate sections
		if (config) {
			config.designPanelSections.forEach(id => {
				const el = document.getElementById(id);
				if (el) el.classList.add('visible');
			});

			// 5. Set panel mode
			const designPanel = document.getElementById('designPanel');
			if (designPanel) {
				designPanel.dataset.panelMode = config.panelMode;
			}
		}

		if (this.syncCollapsibleSections) {
			this.syncCollapsibleSections(this.getPreferredDesignSection(layer));
		}

		this.syncNoLayerPanelState();
		this.syncLockedLayerUI(layer);

		// D-1c: keep the gallery picker strip in sync when the active layer
		// changes to any type. The glitter, shape, text, and sticker managers each
		// drive it for their own layer type and otherwise leave the active owner
		// alone (the text manager performs the initial hide for non-text layers).
		this.textGlitterManager?.updatePickerStrip();
		this.shapeGlitterManager?.updatePickerStrip();
		this.stickerManager?.updatePickerStrip();
		this.glitterManager?.updatePickerStrip();
		this.baseBackgroundManager?.updatePickerStrip();

		// Canvas Size belongs to Canvas Background; drop its temporary preview
		// when editing any content layer or when no image is loaded.
		if ((layer && layer.type !== LayerType.BASE_IMAGE) || hasMultiSelection || !this.originalImage) {
			this.hideCanvasResizePreview();
		}
	}

	// Shared tail end of "create a layer via a tool" (Text/Shape click-to-create):
	// select it, and reload the side panel to show its Properties - except on
	// mobile, where LAYER_UI_CONFIG[type].mobileCreateBehavior.skipReload opts out
	// (reopening the panel on every tap is Design-drawer noise, not a Settings ask).
	finishLayerCreation(layer, { onDesktopReload } = {}) {
		if (!layer) return;
		this.setTool(ToolType.SELECT);

		const skipReload = this.mobileManager?.isMobile
			&& LAYER_UI_CONFIG[layer.type]?.mobileCreateBehavior?.skipReload;
		if (skipReload) return;

		setTimeout(() => {
			this.updateSidePanelUI(layer);
			this.loadActiveLayerSettings();
			onDesktopReload?.();
		}, 0);
	}

	// The single source of truth for "which accordion section should be open".
	// Model: tool-scoped settings win while a settings tool (Brush/Eraser) is
	// active (Photoshop Options-bar behavior); otherwise the SELECTED layer's
	// Properties; otherwise the Design Gallery (nothing to edit / browse mode).
	getPreferredDesignSection(layer) {
		// Tool settings take focus when the active layer can use that tool.
		if (this.currentTool === ToolType.BRUSH) {
			return 'brushSettings';
		}
		if (this.currentTool === ToolType.COLOR_PICKER && layer?.type === LayerType.GLITTER_FILL) {
			return 'layerSettings';
		}

		// An armed glitter pick-session keeps the gallery focused (Done returns you).
		if (this.glitterManager?.hasActivePickerSession?.() || this.baseBackgroundManager?.hasActivePickerSession?.() || this.textGlitterManager?.pickerSession || this.shapeGlitterManager?.pickerSession || this.stickerManager?.pickerSession) {
			return 'designGallery';
		}

		if (!this.originalImage || this.layerManager?.hasMultiSelection?.() || !layer) {
			return 'designGallery';
		}

		if (layer.type === LayerType.TEXT_GLITTER) {
			return 'textSettings';
		}

		if (layer.type === LayerType.BASE_IMAGE) {
			return 'baseLayerSettings';
		}

		if (layer.type === LayerType.STICKER) {
			return 'stickerSettings';
		}

		if (layer.type === LayerType.SHAPE) {
			return 'shapeSettings';
		}

		return 'glitterSettings';
	}

	updateZoomUI() {
		const percentage = this.viewport.getZoomPercentage();
		// Zoom context toolbar reads with the muted-unit treatment like the panels.
		this.contextToolbarRenderer?.setValue('zoomPercentage', `${percentage}%`);
		document.getElementById('statusZoom').innerHTML = formatUnit(percentage, '%');


		this.contextToolbarRenderer?.setEnabled('zoomOut', this.viewport.currentZoomIndex > 0);
		document.getElementById('zoomIn').disabled = this.viewport.currentZoomIndex >= CONFIG.ui.zoom.levels.length - 1;

		// Update cursor
		this.previewContainer.classList.remove('zoom-cursor', 'hand-cursor');
		if (this.currentTool === ToolType.ZOOM) {
			this.previewContainer.classList.add('zoom-cursor');
		} else if (this.currentTool === ToolType.HAND) {
			this.previewContainer.classList.add('hand-cursor');
		}
	}

	updateTransparencyGrid() {
		if (!this.previewContainer.classList.contains('transparent-bg')) return;

		const baseSize = CONFIG.canvas.grid.baseSize;
		const size = baseSize * this.viewport.currentZoom;
		const half = size / 2;

		this.previewWrapper.style.backgroundSize = `${size}px ${size}px`;
		this.previewWrapper.style.backgroundPosition =
			`${this.viewport.panX}px ${this.viewport.panY}px, ${this.viewport.panX}px ${this.viewport.panY + half}px, ${this.viewport.panX + half}px ${this.viewport.panY - half}px, ${this.viewport.panX - half}px ${this.viewport.panY}px`;
	}

	// ===== UX: EMPTY STATE MANAGEMENT =====

	setSettingsEmptyState(prefix, visible, { title, subtext } = {}) {
		const empty = document.getElementById(`${prefix}Empty`);
		const controls = document.getElementById(`${prefix}Controls`);
		const emptyText = document.getElementById(`${prefix}EmptyText`);
		const emptySubtext = document.getElementById(`${prefix}EmptySubtext`);
		empty?.classList.toggle('visible', visible);
		controls?.classList.toggle('visible', !visible);
		if (emptyText && title !== undefined) emptyText.textContent = title;
		if (emptySubtext && subtext !== undefined) emptySubtext.textContent = subtext;
	}

	collapseSettingsSection(prefix) {
		document.getElementById(`${prefix}Content`)?.classList.remove('visible');
		document.getElementById(`${prefix}Toggle`)?.classList.add('collapsed');
	}

	showLayerSettingsEmptyState(title = 'No layer selected', subtext = '') {
		this.setSettingsEmptyState('layerSettings', true, { title, subtext });
	}

	hideLayerSettingsEmptyState() {
		this.setSettingsEmptyState('layerSettings', false);
	}

	showGlitterSettingsEmptyState() {
		this.setSettingsEmptyState('glitterSettings', true);
	}

	hideGlitterSettingsEmptyState() {
		this.setSettingsEmptyState('glitterSettings', false);
	}

	collapseLayerSettings() {
		this.collapseSettingsSection('layerSettings');
	}

	collapseGlitterSettings() {
		this.collapseSettingsSection('glitterSettings');
	}

	updateGlitterOptionsState() {
		const hasActiveLayer = this.activeLayerId !== null;
		document.querySelectorAll('.asset-option').forEach(opt => {
			if (hasActiveLayer) {
				opt.classList.remove('disabled');
			} else {
				opt.classList.add('disabled');
			}
		});
	}

	showStickerSettingsEmptyState() {
		this.setSettingsEmptyState('stickerSettings', true);
	}

	hideStickerSettingsEmptyState() {
		this.setSettingsEmptyState('stickerSettings', false);
	}

	syncNoLayerPanelState() {
		const selectedLayers = this.layerManager?.getSelectedLayers?.() || [];
		const multiCount = selectedLayers.length;
		const canTransform = this.layerManager?.canTransformMultiSelection?.() || false;
		const defaultGroups = document.getElementById('noLayerDefaultGroups');
		const multiGroup = document.getElementById('multiLayerSelectionGroup');
		const emptyText = document.getElementById('noLayerEmptyText');
		const emptySubtext = document.getElementById('noLayerEmptySubtext');

		if (multiCount > 1) {
			if (defaultGroups) defaultGroups.hidden = true;
			if (multiGroup) multiGroup.hidden = false;
			if (emptyText) emptyText.textContent = `${multiCount} layers selected`;
			if (emptySubtext) emptySubtext.textContent = canTransform
				? 'Drag the shared box to move them. Shift+click changes the selection; use Align and Actions below.'
				: 'Selected together for layer actions. Movement and alignment are unavailable while the selection includes a locked, Base Image, or Glitter Fill layer.';
			document.querySelectorAll('#multiSelectionAlignScope button, [data-multi-align]').forEach((button) => { button.disabled = !canTransform; });
			document.querySelectorAll('[data-multi-distribute]').forEach((button) => { button.disabled = !canTransform || multiCount < 3; });
			const canChangeLayers = selectedLayers.every((layer) => layer.type !== LayerType.BASE_IMAGE && !layer.locked);
			const duplicate = document.getElementById('multiSelectionDuplicateBtn');
			const remove = document.getElementById('multiSelectionDeleteBtn');
			if (duplicate) duplicate.disabled = !canChangeLayers || this.layers.length + multiCount > CONFIG.app.limits.maxLayers;
			if (remove) remove.disabled = !canChangeLayers;
			return;
		}

		if (defaultGroups) defaultGroups.hidden = false;
		if (multiGroup) multiGroup.hidden = true;
		if (emptyText) emptyText.textContent = 'Canvas';
		if (emptySubtext) emptySubtext.textContent = 'Select a layer to edit it, or add new content below.';
	}

	collapseStickerSettings() {
		this.collapseSettingsSection('stickerSettings');
	}



	updateAssetInfo(asset, type) {
		if (!asset) return;

		const config = ASSET_TYPE_CONFIG[type];
		if (!config) {
			console.warn(`Unknown asset type: ${type}`);
			return;
		}

		const { prefix, managerKey, renderThumbnail, getExtraBadges } = config;
		const manager = this[managerKey];

		const thumbnail = document.getElementById(`${prefix}Thumbnail`);
		const name = document.getElementById(`${prefix}Name`);
		const badges = document.getElementById(`${prefix}Badges`);
			const size = document.getElementById(`${prefix}Size`);
			const frames = document.getElementById(`${prefix}Frames`);
			const change = document.getElementById(`${prefix}Change`);
			const revealAsset = () => {
				if (type === 'glitter' && manager?.armAssetPicker) {
					manager.armAssetPicker();
					return;
				}
				if (type === 'sticker' && manager?.armAssetPicker) {
					manager.armAssetPicker();
					return;
				}
				revealAssetBrowser(this, manager, asset.id);
			};

		// Thumbnail with click handler
		if (thumbnail) {
			renderThumbnail(thumbnail, asset);
			thumbnail.style.cursor = 'pointer';

			// Remove old listeners and add new one
			thumbnail.replaceWith(thumbnail.cloneNode(true));
			const newThumbnail = document.getElementById(`${prefix}Thumbnail`);

			// Re-render after cloning
			renderThumbnail(newThumbnail, asset);

				newThumbnail.addEventListener('click', revealAsset);
			}

			if (change) {
				change.replaceWith(change.cloneNode(true));
				document.getElementById(`${prefix}Change`)?.addEventListener('click', revealAsset);
			}

		// Name
		if (name) name.textContent = asset.name || 'Undefined';

		this.renderAssetBadges(badges, asset, manager, getExtraBadges);

		// Size + frames use the shared formatters so Glitter Properties, Sticker
		// Properties, and the text Fill/Border/Shadow pickers all read identically.
		if (size) size.innerHTML = this.formatAssetSize(asset);
		if (frames) frames.innerHTML = this.formatAssetFrames(asset);
	}

	// ===== Shared asset-info formatting (one place to change size/frames text) =====

	formatAssetSize(asset) {
		if (asset?.width && asset?.height) {
			return formatDimensions(asset.width, asset.height);
		}
		return 'Undefined';
	}

	formatAssetFrames(asset) {
		if (asset?.frameCount === undefined || asset?.frameCount === null) {
			return 'Undefined';
		}
		if (asset.frameCount <= 1 && !asset.isAnimated) {
			return 'Static';
		}
		const rate = asset.isVariableFramerate
			? 'Variable'
			: asset.frameRate || 'Unknown';
		return `${asset.frameCount}<span class="setting-separator"> @ </span>${rate}<span class="setting-unit">FPS</span>`;
	}

	// Populate a glitter asset-info block (thumbnail + name + badges + size +
	// frames) from a glitter library item. Reused by the text Fill/Border/Shadow
	// source cards so their glitter display matches Glitter Properties' Asset
	// section exactly. `els` holds the target elements (any may be omitted).
	renderGlitterAssetDisplay(els, glitter, colorAdjust = null) {
		if (!glitter) return;
		if (els.thumbnail) {
			els.thumbnail.classList.add('glitter-bg');
			els.thumbnail.style.backgroundImage = `url(${glitter.url})`;
			els.thumbnail.style.backgroundColor = 'transparent';
			// Mirror the slot's hue/sat/bright so the chip matches the canvas.
			els.thumbnail.style.filter = buildCssColorFilter(colorAdjust);
		}
		if (els.name) {
			els.name.textContent = glitter.name;
			els.name.title = glitter.name;
		}
		if (els.badges) {
			this.renderAssetBadges(els.badges, glitter, this.glitterManager, () => []);
		}
		if (els.size) els.size.innerHTML = this.formatAssetSize(glitter);
		if (els.frames) els.frames.innerHTML = this.formatAssetFrames(glitter);
	}

	// Shared by Glitter/Sticker asset info (updateAssetInfo) and the Text
	// layer's Fill/Border/Shadow glitter pickers — same badge vocabulary
	// (category/animated/transparency/variable-fps) wherever a glitter or
	// sticker asset is shown.
	renderAssetBadges(badgesEl, asset, manager, getExtraBadges) {
		if (!badgesEl) return;

		const badgeHTML = [];

		// Category badge reveals the asset in its gallery/category.
		if (asset.category) {
			const categoryName = asset.category.charAt(0).toUpperCase() + asset.category.slice(1);
			badgeHTML.push(`<button type="button" class="asset-info-badge badge-category" data-category="${asset.category}" title="Show ${categoryName} in Design">${categoryName}</button>`);
		}

		// Animated badge
		if (asset.isAnimated) {
			badgeHTML.push('<span class="asset-info-badge badge-animated" title="This asset contains animation frames">Animated</span>');
		}

		// Transparency badge
		if (asset.hasTransparency) {
			badgeHTML.push('<span class="asset-info-badge badge-transparency" title="This asset contains transparent pixels">Transparent</span>');
		}

		// Variable frame rate badge
		if (asset.isVariableFramerate) {
			badgeHTML.push('<span class="asset-info-badge badge-variable-fps" title="Animation frames use variable timing">Variable FPS</span>');
		}

		// Type-specific badges
		if (getExtraBadges) {
			const extraBadges = getExtraBadges(asset);
			extraBadges.forEach(badge => {
				badgeHTML.push(`<span class="asset-info-badge ${badge.class}" title="Asset property">${badge.text}</span>`);
			});
		}

		badgesEl.innerHTML = badgeHTML.join('');

		// Add click listener to category badge
		const categoryBadge = badgesEl.querySelector('.badge-category');
		if (categoryBadge) {
			categoryBadge.addEventListener('click', () => {
				if (!manager?.browser) return;
				revealAssetBrowser(this, manager);
				manager.browser.navigateToCategory(asset.category);
			});
		}
	}

	// Convenience wrappers
	updateGlitterAssetInfo(glitter) {
		this.updateAssetInfo(glitter, 'glitter');
	}

	updateStickerAssetInfo(sticker) {
		this.updateAssetInfo(sticker, 'sticker');
	}


	loadActiveLayerSettings() {
		if (this.layerManager.hasMultiSelection()) return;

		const layer = this.layerManager.getActiveLayer();
		if (!layer) return;

		// Handle different layer types
		if (layer.type === LayerType.STICKER) {
			// Load sticker settings
			this.loadStickerSettings(layer);
			return;
		}

		if (layer.type === LayerType.TEXT_GLITTER) {
			this.textGlitterManager.loadLayerSettings(layer);
			return;
		}

		if (layer.type === LayerType.BASE_IMAGE) {
			this.baseBackgroundManager?.loadLayerSettings(layer);
			return;
		}

		// Load glitter layer settings (existing code)
		const s = layer.settings;

		const contiguous = document.getElementById('contiguous');
		const invert = document.getElementById('invert');
		const multiSelect = document.getElementById('multiSelect');
		const threshold = document.getElementById('threshold');
		const thresholdValue = document.getElementById('thresholdValue');
		const feather = document.getElementById('feather');
		const featherValue = document.getElementById('featherValue');
		const scale = document.getElementById('scale');
		const scaleValue = document.getElementById('scaleValue');
		const opacity = document.getElementById('opacity');
		const opacityValue = document.getElementById('opacityValue');

		if (contiguous) contiguous.checked = s.contiguous;
		if (invert) invert.checked = s.invert;
		if (multiSelect) multiSelect.checked = s.multiSelect;

		if (threshold && thresholdValue) {
			threshold.value = s.threshold;
			thresholdValue.textContent = s.threshold;
			this.updateResetButton('threshold');
		}

		if (feather && featherValue) {
			feather.value = s.feather;
			featherValue.textContent = s.feather;
			this.updateResetButton('feather');
		}

		if (scale && scaleValue) {
			scale.value = s.scale;
			scaleValue.innerHTML = formatUnit(s.scale, '%');
			this.updateResetButton('scale');
		}

		if (opacity && opacityValue) {
			opacity.value = s.opacity;
			opacityValue.innerHTML = formatUnit(s.opacity, '%');
			this.updateResetButton('opacity');
		}

		// Color adjust (WP4): populate the Advanced HSB sliders from this layer.
		this.applyColorAdjustToSliders('glitter', s.colorAdjust);

		if (layer.selectedGlitterId) {
			const glitter = this.glitterManager.getItemById(layer.selectedGlitterId);
			if (glitter) {
				this.updateGlitterAssetInfo(glitter);
			}
		}
		const fillMode = layer.fill?.mode || 'glitter';
		syncPaintSlotSourceUI(document.getElementById('glitterFillGlitter'), fillMode);

		// Tint the asset-info thumbnail (and list/mobile swatches) to match the hue.
		this.refreshGlitterSwatchVisuals(layer);

		this.updateSelectedColorsDisplay();
		this.maskEditor?.loadLayer(layer);
	}

	loadStickerSettings(layer) {
		if (!layer || layer.type !== LayerType.STICKER) return;

		this.loadTransformSettings(layer, 'sticker');
		this.stickerManager.loadLayerSettings(layer);

		// Update sticker asset info
		if (layer.stickerSourceId) {
			const sticker = this.stickerManager.getItemById(layer.stickerSourceId);
			if (sticker) {
				this.updateStickerAssetInfo(sticker);
			}
		}
	}

	saveActiveLayerSettings() {
		const settings = {
			threshold: parseInt(document.getElementById('threshold').value),
			feather: parseInt(document.getElementById('feather').value),
			scale: parseInt(document.getElementById('scale').value),
			opacity: parseInt(document.getElementById('opacity').value),
			contiguous: document.getElementById('contiguous').checked,
			invert: document.getElementById('invert').checked,
			multiSelect: document.getElementById('multiSelect').checked,
			// Color adjust (WP4). Always an identity object for untouched layers, so
			// export stays byte-identical (isIdentityColorAdjust short-circuits it).
			colorAdjust: this.readColorAdjust('glitter')
		};

		const activeLayer = this.layerManager.getActiveLayer();
		// Only apply to active layer if it is a Glitter Fill layer
		if (activeLayer && activeLayer.type === LayerType.GLITTER_FILL) {
			activeLayer.settings = settings;
			this.maskCompositor.invalidate(activeLayer.id);
		}

	}

	updateGlitterSelection() {
		const layer = this.layerManager.getActiveLayer();
		const selectedGlitterId = layer?.type === LayerType.TEXT_GLITTER
			? this.textGlitterManager?.resolveSelectedGlitterId(layer)
			: layer?.type === LayerType.SHAPE
				? this.shapeGlitterManager?.resolveSelectedGlitterId(layer)
				: layer?.type === LayerType.STICKER
					? layer.stickerData?.[this.stickerManager.getGlitterSelectionTarget(layer)]?.glitterId
				: layer?.selectedGlitterId;

		// Query all glitter options in BOTH traditional grid AND asset browser
		const glitterOptions = document.querySelectorAll(
			'.asset-options .asset-option, #glitterItemGrid .asset-option, #glitterSearchResults .asset-option'
		);

		glitterOptions.forEach(opt => {
			const isSelected = layer && (layer.type === LayerType.GLITTER_FILL || layer.type === LayerType.TEXT_GLITTER || layer.type === LayerType.SHAPE || layer.type === LayerType.STICKER) &&
				parseInt(opt.dataset.id, 10) === selectedGlitterId;
			opt.classList.toggle('selected', isSelected);
		});

		// Update helpful message
		this.updateHelpfulMessage();

	}

	updateStickerSelection() {
		const layer = this.layerManager.getActiveLayer();

		// Get all sticker options (from asset browser)
		const stickerOptions = document.querySelectorAll('.asset-options .asset-option');

		// Early return if no sticker layer is active
		if (!layer || layer.type !== LayerType.STICKER || !layer.stickerSourceId) {
			// Clear all selections
			stickerOptions.forEach(opt => opt.classList.remove('selected'));
			return;
		}

		// Mark the matching sticker as selected
		stickerOptions.forEach(opt => {
			// Convert both to strings for comparison (or both to numbers)
			const isSelected = String(opt.dataset.id) === String(layer.stickerSourceId);
			opt.classList.toggle('selected', isSelected);
		});
	}

	// ===== INITIALIZATION =====
	initializeCollapsibleSections() {
		const sections = ['designGallery', 'autoGlitterSettings', 'baseLayerSettings', 'layerSettings', 'glitterSettings', 'stickerSettings', 'textSettings', 'shapeSettings', 'brushSettings'];

			const setOpen = (name, isOpen, accordion = false) => {
				const section = document.getElementById(`${name}Section`);
				const content = document.getElementById(`${name}Content`);
				const toggle = document.getElementById(`${name}Toggle`);
				setCollapsibleSectionState(section, content, toggle, isOpen);

			if (isOpen && accordion && CONFIG.layers.ui.designPanelAccordion) {
				const isMobile = this.mobileManager?.isMobile;
				sections.forEach((other) => {
					if (other === name) return;
					// On mobile, the Design Gallery lives in its own tab/drawer,
					// separate from the settings sections' drawer — opening one
					// shouldn't collapse the other.
					if (isMobile && (other === 'designGallery' || name === 'designGallery')) return;
					setOpen(other, false, false);
				});
			}
		};
		this.setCollapsibleSectionOpen = setOpen;

		this.syncCollapsibleSections = (preferredName = null) => {
			const visibleSections = sections.filter((name) => {
				const section = document.getElementById(`${name}Section`);
				if (!section) return false;
				return name === 'designGallery' || section.classList.contains('visible');
			});

			if (!visibleSections.length) {
				return;
			}

			const openSections = visibleSections.filter((name) => {
				const content = document.getElementById(`${name}Content`);
				return content?.classList.contains('visible');
			});

			const targetName = visibleSections.includes(preferredName)
				? preferredName
				: (openSections[0] || visibleSections[0]);

			const isMobile = this.mobileManager?.isMobile;
			sections.forEach((name) => {
				// Same mobile scoping as the accordion sweep above: Design Gallery
				// and the settings sections live in separate drawers on mobile, so
				// syncing toward one shouldn't touch the other's open state.
				if (isMobile && (name === 'designGallery') !== (targetName === 'designGallery')) {
					return;
				}
				const shouldOpen = name === targetName;
				setOpen(name, shouldOpen, false);
			});
		};

		sections.forEach((name) => {
			const header = document.getElementById(`${name}Header`);
			const content = document.getElementById(`${name}Content`);
			const toggle = document.getElementById(`${name}Toggle`);
			if (!header || !content || !toggle) return;

			// Start with Design open and the rest collapsed
			setOpen(name, name === 'designGallery');

			header.addEventListener('click', (event) => {
				if (event.target.closest('[data-no-accordion-toggle]')) {
					return;
				}

				// On mobile the design drawer's header closes the drawer
				// (MobileManager) — accordion-collapsing the gallery there would
				// make the next drawer open show a bare header bar.
				if (name === 'designGallery' && this.mobileManager?.isMobile) {
					return;
				}

				const isOpen = !content.classList.contains('visible');
				setOpen(name, isOpen, true);
				if (isOpen) requestAnimationFrame(() => header.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
			});
		});

		this.syncCollapsibleSections('designGallery');
		this.initializeIndependentCollapsibles();

		this.showLayerSettingsEmptyState();
		this.showGlitterSettingsEmptyState();
		this.showStickerSettingsEmptyState();
	}

	// Image and Layers sections collapse independently (both can stay open) —
	// same header/chevron conventions as the design panel, minus the accordion.
	initializeIndependentCollapsibles() {
		CONFIG.ui.independentCollapsibleSections.forEach((name) => {
			const section = document.getElementById(`${name}Section`);
				const header = document.getElementById(`${name}Header`);
				const toggle = document.getElementById(`${name}Toggle`);
				const content = section?.querySelector(':scope > .section-content');
				if (!section || !header || !toggle || !content) return;

				const setOpen = (isOpen) => {
					setCollapsibleSectionState(section, content, toggle, isOpen);
				};
			setOpen(true);

			header.addEventListener('click', (event) => {
				if (event.target.closest('[data-no-accordion-toggle]')) return;
				// On mobile these sections live in drawers with their own header
				// behavior — mirror the design gallery's guard.
				if (this.mobileManager?.isMobile) return;
				const isOpen = !section.classList.contains('is-open');
				setOpen(isOpen);
				if (isOpen) requestAnimationFrame(() => header.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
			});
		});
	}

	// Reusable "Advanced" disclosure (WP4). One delegated click handler drives
	// every `[data-advanced]` block (Glitter Properties, text/shape effect cards),
	// so all instances behave identically. Collapsed by default; open state is
	// intentionally NOT persisted — it resets each session/relayout.
	initializeAdvancedDisclosures() {
		const initializeSubsections = (root = document) => {
			root.querySelectorAll?.('.subsection-content-group > .subsection-title').forEach((title) => {
				const subsection = title.parentElement;
				if (!subsection || subsection.classList.contains('subsection-section-group')) return;
				subsection.dataset.collapsibleSubsection = '';
				title.dataset.subsectionToggle = '';
				title.setAttribute('role', 'button');
				title.setAttribute('tabindex', '0');
				title.setAttribute('aria-expanded', 'true');
				if (!title.querySelector('.subsection-chevron')) {
					title.insertAdjacentHTML('beforeend', '<span class="subsection-chevron icon-wrapper"><svg class="icon"><use href="#icon-chevron-down"></use></svg></span>');
				}
				const enabled = title.querySelector('input[data-effect-toggle]');
				if (enabled) syncPanelEffectToggle(enabled, enabled.checked);
			});
		};
		initializeSubsections();
		new MutationObserver((mutations) => {
			mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
				if (node.nodeType === Node.ELEMENT_NODE) initializeSubsections(node);
			}));
		}).observe(document.body, { childList: true, subtree: true });
		// Disabled effect cards stay collapsible and expose an inert preview when
		// manually expanded.
		const toggleSubsection = (toggle) => {
			const subsection = toggle.closest('[data-collapsible-subsection]');
			if (!subsection) return;
			const isCollapsed = subsection.classList.toggle('is-collapsed');
			toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
		};
		// Every schema effect toggle uses the same expansion/state contract.
		document.addEventListener('change', (event) => {
			const checkbox = event.target;
			if (!checkbox.matches?.('.subsection-title input[data-effect-toggle]')) return;
			syncPanelEffectToggle(checkbox, checkbox.checked);
		});
		// Interactive controls living in the title (Enabled/Global checkboxes,
		// reset chips) must not also collapse the subsection when clicked.
		const isTitleControl = (target) => Boolean(target.closest?.('.checkbox-group, button, input, select'));
		document.addEventListener('click', (event) => {
			const subsectionToggle = event.target.closest('[data-subsection-toggle]');
			if (subsectionToggle) {
				if (isTitleControl(event.target)) return;
				toggleSubsection(subsectionToggle);
				return;
			}
			const toggle = event.target.closest('[data-advanced-toggle]');
			if (!toggle) return;
			const disclosure = toggle.closest('[data-advanced]');
			if (!disclosure) return;
			const isOpen = disclosure.classList.toggle('is-open');
			toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
		});
		document.addEventListener('keydown', (event) => {
			const toggle = event.target.closest?.('[data-subsection-toggle]');
			if (!toggle || (event.key !== 'Enter' && event.key !== ' ')) return;
			if (isTitleControl(event.target)) return;
			event.preventDefault();
			toggleSubsection(toggle);
		});
	}

	// Reads the three HSB sliders for a given prefix ('glitter', or a text slot)
	// into a colorAdjust object. Missing sliders fall back to identity.
	readColorAdjust(prefix) {
		const num = (id, fallback) => {
			const el = document.getElementById(id);
			const value = el ? parseInt(el.value, 10) : NaN;
			return Number.isFinite(value) ? value : fallback;
		};
		const cap = prefix.charAt(0).toUpperCase() + prefix.slice(1);
		return {
			hue: num(prefix + 'Hue', 0),
			saturation: num(prefix + 'Saturation', 100),
			brightness: num(prefix + 'Brightness', 100)
		};
	}

	// Push a colorAdjust object out to the three HSB sliders + value displays for
	// a prefix. Absent adjust reads as identity.
	applyColorAdjustToSliders(prefix, adjust) {
		const a = normalizeColorAdjust(adjust);
		const set = (id, value, suffix) => {
			const slider = document.getElementById(id);
			const display = document.getElementById(id + 'Value');
			if (slider) slider.value = String(value);
			if (display) display.innerHTML = formatUnit(value, suffix);
		};
		set(prefix + 'Hue', a.hue, '°');
		set(prefix + 'Saturation', a.saturation, '%');
		set(prefix + 'Brightness', a.brightness, '%');
		this.updateResetButton(prefix + 'Hue');
		this.updateResetButton(prefix + 'Saturation');
		this.updateResetButton(prefix + 'Brightness');
	}

	// The colorAdjust that tints a layer's layers-list swatch — the FILL slot's,
	// since that's the glitter the swatch shows. Fill aliases layer.settings for
	// glitter-fill + text; shapes keep it on shapeData.fill.
	getLayerFillColorAdjust(layer) {
		if (!layer) return null;
		if (layer.type === LayerType.SHAPE) return layer.shapeData?.fill?.colorAdjust;
		if (layer.type === LayerType.BASE_IMAGE) return layer.background?.colorAdjust;
		return layer.settings?.colorAdjust;
	}

	// Tint the layers-list swatch + mobile swatch for any glitter-bearing layer to
	// match its fill hue. Render paths bake this in too; this is the live-drag path
	// that updates without a full list re-render. Shared by all three layer types.
	refreshLayerSwatchFilter(layer) {
		if (!layer) return;
		const filter = buildCssColorFilter(this.getLayerFillColorAdjust(layer));

		const listSwatch = this.layerManager.layersListContainer
			?.querySelector(`[data-layer-id="${layer.id}"] .layer-swatch`);
		if (listSwatch) listSwatch.style.filter = filter;

		if (this.layerManager.activeLayerId === layer.id) {
			const mobileSwatch = document.querySelector('.mobile-layers-swatch');
			if (mobileSwatch) mobileSwatch.style.filter = filter;
		}
	}

	// Glitter-fill: also tint the Glitter Properties asset-info thumbnail. Text and
	// shape tint their own per-slot chips in their managers (refreshSlotSwatch).
	refreshGlitterSwatchVisuals(layer) {
		if (!layer || layer.type !== LayerType.GLITTER_FILL) return;
		const thumb = document.getElementById('glitterAssetThumbnail');
		if (thumb) thumb.style.filter = buildCssColorFilter(layer.settings?.colorAdjust);
		this.refreshLayerSwatchFilter(layer);
	}

	// Wire the Glitter Properties HSB sliders (fill layers). Each live-updates its
	// display, saves the layer settings (which now carry colorAdjust), refreshes
	// the preview, and records one history entry on release.
	setupColorAdjustListeners() {
		const specs = [
			['glitterHue', '°'],
			['glitterSaturation', '%'],
			['glitterBrightness', '%']
		];

		specs.forEach(([id, suffix]) => {
			const slider = document.getElementById(id);
			const display = document.getElementById(id + 'Value');
			if (!slider) return;

			const resetBtn = document.getElementById('reset' + id.charAt(0).toUpperCase() + id.slice(1));

			bindSlider(slider, display, {
				suffix,
				resetValue: this.getResetValueForSlider(id),
				resetButton: resetBtn,
				apply: () => {
					this.saveActiveLayerSettings();
					this.refreshGlitterSwatchVisuals(this.layerManager.getActiveLayer());
					this.debouncedSliderUpdate();
				},
				onCommit: () => this.saveState()
			});
		});
	}

	initializeShortcutsModal() {
		const list = document.getElementById('shortcutList');
		const gesturePattern = /^(click|drag|resize|rotate|wheel|scroll wheel|double-click)/i;
		const buildShortcutToken = (label) => {
			const token = document.createElement('span');
			const isGesture = gesturePattern.test(label);
			token.className = isGesture ? 'shortcut-gesture' : 'kbd';
			token.textContent = label;
			return token;
		};

		Object.entries(CONFIG.ui.shortcuts).forEach(([category, shortcutArray]) => {
			const group = document.createElement('div');
			group.className = 'shortcut-group';

			const title = document.createElement('div');
			title.className = 'shortcut-group-title';
			title.textContent = category.charAt(0).toUpperCase() + category.slice(1);
			group.appendChild(title);

			shortcutArray.forEach(sc => {
				const item = document.createElement('div');
				item.className = 'shortcut-item';

				const action = document.createElement('div');
				action.className = 'shortcut-action';
				action.textContent = sc.action;

				const keys = document.createElement('div');
				keys.className = 'shortcut-keys shortcut-sequence';

				sc.key.split(' + ').forEach((part) => {
					if (part.startsWith('Hold ')) {
						const instruction = document.createElement('span');
						instruction.className = 'shortcut-instruction';
						instruction.textContent = 'Hold';
						keys.appendChild(instruction);
						keys.appendChild(buildShortcutToken(part.slice(5)));
						return;
					}
					keys.appendChild(buildShortcutToken(part));
				});

				item.appendChild(action);
				item.appendChild(keys);
				group.appendChild(item);
			});

			list.appendChild(group);
		});
	}

	// ===== EVENT LISTENERS =====

	setupEventListeners() {
		this.setupToolbarListeners();
		this.setupAutoSelectListener();
		this.setupColorPickerContextListeners();
		this.setupLayerSettingsListeners();
		this.setupSliderListeners();
		this.setupColorAdjustListeners();
		this.setupMaskEditorListeners();
		this.setupTransformListeners('sticker', LayerType.STICKER, () => this.stickerManager);
		this.setupTransformListeners('text', LayerType.TEXT_GLITTER, () => this.textGlitterManager);
		this.setupTransformListeners('shape', LayerType.SHAPE, () => this.shapeGlitterManager);
		this.setupExportListeners();
		this.setupImageListeners();
		this.setupModalListeners();
		this.setupPreviewListeners();
		this.setupGlobalListeners();
		this.setupHelpfulMessageListeners();
		this.setupCanvasSizeControls();
		this.setupScaleDesignControls();
	}

	setupAutoSelectListener() {
		const toggle = document.getElementById('contextAutoSelect');
		if (!toggle) return;
		toggle.checked = CONFIG.app.behavior.autoSelect;
		toggle.addEventListener('change', () => {
			CONFIG.app.behavior.autoSelect = toggle.checked;
			this.saveSettingsToStorage();
			this.updateStatus(toggle.checked
				? 'Auto-Select on: click an object to select it'
				: 'Auto-Select off: canvas drags keep the selected layer');
		});
	}



	// ===== HELPER: Attach slider with live update and reset =====
	setupSlider(sliderId, valueId, suffix, updateCallback, resetValue) {
		const slider = document.getElementById(sliderId);
		const valueDisplay = document.getElementById(valueId);
		const resetBtn = document.getElementById('reset' + sliderId.charAt(0).toUpperCase() + sliderId.slice(1));

		if (!slider || !valueDisplay) return;

		const appBindingConfig = {
			threshold: {
				onApply: () => {
					this.saveActiveLayerSettings();
					this.debouncedSliderUpdate();
				},
				onCommit: () => this.saveState()
			},
			feather: {
				onApply: () => {
					this.saveActiveLayerSettings();
					this.debouncedSliderUpdate();
				},
				onCommit: () => this.saveState()
			},
			scale: {
				onApply: () => {
					this.saveActiveLayerSettings();
					this.debouncedSliderUpdate();
				},
				onCommit: () => this.saveState()
			},
			opacity: {
				onApply: () => {
					this.saveActiveLayerSettings();
					this.debouncedSliderUpdate();
				},
				onCommit: () => this.saveState()
			}
		};
		const binding = appBindingConfig[sliderId] || null;

		bindSlider(slider, valueDisplay, {
			suffix,
			resetValue,
			resetButton: resetBtn,
			apply: (value, sliderEl, event) => {
				if (typeof updateCallback === 'function') {
					updateCallback(event || { target: sliderEl });
				}
				binding?.onApply?.(value, sliderEl);
			},
			onCommit: binding?.onCommit ? (value, sliderEl, event) => binding.onCommit(value, sliderEl, event) : null
		});
	}

	// ===== HELPER: Attach checkbox that syncs with another checkbox =====
	syncCheckboxes(id1, id2, bidirectional = true) {
		const elem1 = document.getElementById(id1);
		const elem2 = document.getElementById(id2);

		if (!elem1 || !elem2) return;

		let syncing = false;

		elem1.addEventListener('change', (e) => {
			if (syncing) return;
			syncing = true;
			elem2.checked = e.target.checked;
			elem2.dispatchEvent(new Event('change'));
			syncing = false;
		});

		if (bidirectional) {
			elem2.addEventListener('change', (e) => {
				if (syncing) return;
				syncing = true;
				elem1.checked = e.target.checked;
				elem1.dispatchEvent(new Event('change'));
				syncing = false;
			});
		}
	}


	// ===== TOOLBAR LISTENERS =====
	setupToolbarListeners() {
		const tools = [
			{ id: 'selectTool', type: ToolType.SELECT },
			{ id: 'textTool', type: ToolType.TEXT },
			{ id: 'shapeTool', type: ToolType.SHAPE },
			{ id: 'colorPickerTool', type: ToolType.COLOR_PICKER },
			{ id: 'handTool', type: ToolType.HAND },
			{ id: 'zoomTool', type: ToolType.ZOOM }
		];

		tools.forEach(({ id, type }) => {
			const btn = document.getElementById(id);
			if (btn) btn.addEventListener('click', () => this.setTool(type));
		});

		// Brush and Eraser are both the Mask Brush tool with a different paint mode,
		// so each button sets the tool then forces its own mode.
		document.getElementById('brushTool')?.addEventListener('click', () => {
			this.setTool(ToolType.BRUSH);
			this.maskEditor?.setMode('add');
		});
		document.getElementById('eraserTool')?.addEventListener('click', () => {
			this.setTool(ToolType.BRUSH);
			this.maskEditor?.setMode('sub');
		});

		const actions = [
			{ id: 'undoTool', handler: () => this.undo() },
			{ id: 'redoTool', handler: () => this.redo() },
			{ id: 'clearAllTool', handler: () => this.resetAll() }
		];

		actions.forEach(({ id, handler }) => {
			const btn = document.getElementById(id);
			if (btn) btn.addEventListener('click', handler);
		});
	}


	getSelectedActionableLayers() {
		return this.layerManager.getSelectedLayers().filter((layer) => layer.type !== LayerType.BASE_IMAGE);
	}

	cloneSelectedLayers() {
		const allSelectedLayers = this.layerManager.getSelectedLayers();
		if (allSelectedLayers.some((layer) => layer.type === LayerType.BASE_IMAGE || layer.locked)) {
			this.showError('Unlock protected layers or remove them from the selection before duplicating');
			return null;
		}
		const selectedLayers = this.getSelectedActionableLayers();
		if (!selectedLayers.length) return null;

		if (selectedLayers.length > 1) {
			return this.layerManager.cloneLayers(selectedLayers.map((layer) => layer.id));
		}

		return this.layerManager.cloneLayer(selectedLayers[0].id);
	}

	async deleteSelectedLayers() {
		const allSelectedLayers = this.layerManager.getSelectedLayers();
		if (allSelectedLayers.some((layer) => layer.type === LayerType.BASE_IMAGE || layer.locked)) {
			this.showError('Unlock protected layers or remove them from the selection before deleting');
			return false;
		}
		const selectedLayers = this.getSelectedActionableLayers();
		if (!selectedLayers.length) return false;

		const isPlural = selectedLayers.length > 1;
		const confirmed = await this.confirmAction({
			title: isPlural ? 'Delete Layers' : 'Delete Layer',
			message: isPlural
				? 'These layers and everything on them will be permanently removed.'
				: 'This layer and everything on it will be permanently removed.',
			confirmLabel: 'Delete',
			destructive: true
		});
		if (!confirmed) {
			return false;
		}

		if (isPlural) {
			return this.layerManager.deleteLayers(selectedLayers.map((layer) => layer.id));
		}

		return this.layerManager.deleteLayer(selectedLayers[0].id);
	}

	setupColorPickerContextListeners() {
		const contextThreshold = document.getElementById('contextThreshold');
		const contextThresholdValue = document.getElementById('contextThresholdValue');
		const contextMultiSelect = document.getElementById('contextMultiSelect');
		const contextContiguous = document.getElementById('contextContiguous');

		// Threshold slider
		if (contextThreshold && contextThresholdValue) {
			contextThreshold.addEventListener('input', (e) => {
				const value = e.target.value;
				contextThresholdValue.textContent = value;

				// Sync with design panel
				const threshold = document.getElementById('threshold');
				const thresholdValue = document.getElementById('thresholdValue');
				if (threshold) threshold.value = value;
				if (thresholdValue) thresholdValue.textContent = value;

				this.updateResetButton('threshold');

				// Save and debounce preview update
				this.saveActiveLayerSettings();
				this.debouncedSliderUpdate();
			});

			contextThreshold.addEventListener('change', () => {
				this.saveState();
			});
		}

		// Multi-select is handled by bidirectional sync
		if (contextMultiSelect) {
			contextMultiSelect.addEventListener('change', (e) => {
				this.handleMultiSelectChange(e.target.checked);
			});
		}

		// Contiguous is handled by bidirectional sync
		if (contextContiguous) {
			contextContiguous.addEventListener('change', () => {
				this.updateLayerAndSave();
			});
		}
	}

	handleMultiSelectChange(checked) {
		const layer = this.layerManager.getActiveLayer();
		if (!layer) return;

		// Update layer directly
		layer.settings.multiSelect = checked;

		// If turning off multi-select and we have multiple selections, keep only first
		if (!checked && layer.selections && layer.selections.length > 1) {
			layer.selections = [layer.selections[0]];
		}

		// Update the count
		const contextSelectionCount = document.getElementById('contextSelectionCount');
		if (contextSelectionCount) {
			const count = layer.selections ? layer.selections.length : 0;
			contextSelectionCount.textContent = count > 1 ? count : '';
		}

		this.updatePreview();
		this.updateSelectedColorsDisplay();
		this.saveState();
	}


	setupLayerSettingsListeners() {
		const contiguous = document.getElementById('contiguous');
		const invert = document.getElementById('invert');
		const multiSelect = document.getElementById('multiSelect');

		// Sync contiguous checkboxes bidirectionally
		this.syncCheckboxes('contiguous', 'contextContiguous');

		if (contiguous) {
			contiguous.addEventListener('change', () => {
				this.updateLayerAndSave();
			});
		}

		if (invert) {
			invert.addEventListener('change', async () => {
				const layer = this.layerManager.getActiveLayer();
				if (!layer) {
					return;
				}

				if (this.mobileManager?.isMobile) {
					const confirmed = await this.confirmAction({
						title: 'Invert Mask?',
						message: invert.checked
							? 'Invert this layer mask so glitter fills everything except the selected and painted areas?'
							: 'Return this layer mask to its normal, non-inverted state?',
						confirmLabel: 'Apply'
					});
					if (!confirmed) {
						invert.checked = Boolean(layer.settings?.invert);
						this.maskEditor?.loadLayer(layer);
						return;
					}
				}

				this.saveActiveLayerSettings();
				if (layer && layer.type === LayerType.GLITTER_FILL && (layer.maskVersion || this.glitterManager.getPaintMask(layer.id))) {
					this.glitterManager.commitPaintState(layer);
				}
				this.updatePreview();
				this.layerManager.renderLayersList();
				this.updateActionButtons();
				this.maskEditor?.loadLayer(layer);
				this.saveState();
			});
		}

		// Sync multi-select checkboxes bidirectionally
		this.syncCheckboxes('multiSelect', 'contextMultiSelect');

		if (multiSelect) {
			multiSelect.addEventListener('change', (e) => {
				this.handleMultiSelectChange(e.target.checked);
			});
		}

		// Multi-select checkbox
		document.getElementById('multiSelect')?.addEventListener('change', () => {
			this.updateHelpfulMessage();
		});
	}

	setupSliderListeners() {
		// Threshold
		this.setupSlider('threshold', 'thresholdValue', '', (e) => {
			// Sync with context toolbar
			const contextThreshold = document.getElementById('contextThreshold');
			const contextThresholdValue = document.getElementById('contextThresholdValue');
			if (contextThreshold) contextThreshold.value = e.target.value;
			if (contextThresholdValue) contextThresholdValue.textContent = e.target.value;
		}, CONFIG.tools.selection.defaults.threshold);

		this.setupSlider('feather', 'featherValue', '', null, CONFIG.tools.selection.defaults.feather);
		this.setupSlider('scale', 'scaleValue', '%', null, CONFIG.tools.effects.defaults.scale);
		this.setupSlider('opacity', 'opacityValue', '%', null, CONFIG.tools.effects.defaults.opacity);
	}

	setupMaskEditorListeners() {
		this.setupSlider('maskBrushSize', 'maskBrushSizeValue', 'px', () => {
			this.maskEditor?._updateBrushCursorSize();
		}, CONFIG.tools.maskBrush.defaults.size);

		this.setupSlider('maskBrushSoftness', 'maskBrushSoftnessValue', '%', () => {
			this.maskEditor?.renderOverlay();
		}, CONFIG.tools.maskBrush.defaults.softness);

		this.setupSlider('maskBrushFlow', 'maskBrushFlowValue', '%', () => {
			this.maskEditor?.renderOverlay();
		}, CONFIG.tools.maskBrush.defaults.flow);

		// Spacing is a percentage of brush size; it only affects future stamps
		// (the resulting stroke is baked into the mask), so no live re-render.
		this.setupSlider('maskBrushSpacing', 'maskBrushSpacingValue', '%', null,
			Math.round(CONFIG.tools.maskBrush.stroke.stampSpacing * 100));

		// Smoothing (EMA stabilizer); affects the live stroke only, no re-render.
		this.setupSlider('maskBrushSmoothing', 'maskBrushSmoothingValue', '%', null,
			CONFIG.tools.maskBrush.defaults.smoothing ?? 0);

		this.syncQuickSlider('maskBrushSize', 'maskBrushSizeQuick', 'maskBrushSizeQuickValue', 'px');

		this.maskEditor?.setupUIListeners();
	}

	// Mirrors a canonical slider's value onto a compact duplicate (the floating
	// quick-access brush size, mirroring the sidebar's canonical Size slider).
	syncQuickSlider(canonicalId, quickId, quickValueId, suffix) {
		const canonical = document.getElementById(canonicalId);
		const quick = document.getElementById(quickId);
		const quickValue = document.getElementById(quickValueId);
		if (!canonical || !quick) return;

		quick.min = canonical.min;
		quick.max = canonical.max;
		quick.value = canonical.value;
		if (quickValue) quickValue.innerHTML = formatUnit(canonical.value, suffix);

		let syncing = false;
		canonical.addEventListener('input', () => {
			if (syncing) return;
			syncing = true;
			quick.value = canonical.value;
			if (quickValue) quickValue.innerHTML = formatUnit(canonical.value, suffix);
			syncing = false;
		});

		quick.addEventListener('input', () => {
			if (syncing) return;
			syncing = true;
			canonical.value = quick.value;
			if (quickValue) quickValue.innerHTML = formatUnit(quick.value, suffix);
			canonical.dispatchEvent(new Event('input'));
			syncing = false;
		});
	}

	renderTransformPanels() {
		[
			{ hostId: 'stickerTransformPanelHost', prefix: 'sticker', type: LayerType.STICKER },
			{ hostId: 'textTransformPanelHost', prefix: 'text', type: LayerType.TEXT_GLITTER },
			{ hostId: 'shapeTransformPanelHost', prefix: 'shape', type: LayerType.SHAPE }
		].forEach(({ hostId, prefix, type }) => {
			const host = document.getElementById(hostId);
			if (!host) return;

			buildTransformPanel(this, host, prefix, LAYER_UI_CONFIG[type]?.transformCapabilities || {});
		});
		finalizePanelSchemaSections(this);
	}

	getTransformIds(prefix) {
		return getPanelTransformIds(prefix);
	}

	getLayerTransformData(layer) {
		return getLayerTransform(layer);
	}

	// Single source of truth for the three movable/transformable layer types.
	// Anything keyed to "which manager + panel prefix owns this layer's transform"
	// (arrow nudge, centering, panel load/save, context toolbars) resolves through
	// here so sticker/text/shape stay in lockstep — register a new type once.
	getMovableLayerContext(layer) {
		switch (layer?.type) {
			case LayerType.STICKER:
				return { prefix: 'sticker', manager: this.stickerManager };
			case LayerType.TEXT_GLITTER:
				return { prefix: 'text', manager: this.textGlitterManager };
			case LayerType.SHAPE:
				return { prefix: 'shape', manager: this.shapeGlitterManager };
			default:
				return null;
		}
	}

	formatScaleSummary(transform) {
		const x = Math.round(transform.scale.x);
		const y = Math.round(transform.scale.y);
		return x === y
			? formatUnit(x, '%')
			: `${formatUnit(x, '%')} × ${formatUnit(y, '%')}`;
	}

	getScaleSliderValue(transform) {
		const x = Math.round(transform.scale.x || 100);
		const y = Math.round(transform.scale.y || 100);
		return x === y ? x : Math.round((x + y) / 2);
	}

	hasScaleAdjustment(transform) {
		if (!transform?.scale) return false;
		return Math.abs((transform.scale.x || 100) - 100) > 0.5
			|| Math.abs((transform.scale.y || 100) - 100) > 0.5;
	}

	hasResettableTransformAdjustments(transform, options = {}) {
		if (!transform) return false;
		return this.hasScaleAdjustment(transform)
			|| Math.abs(transform.rotation || 0) > 0.5
			|| Boolean(transform.flipX)
			|| Boolean(transform.flipY)
			|| transform.proportionalScale === false;
	}

	// Handlers that bypass loadTransformSettings (rotation slider, flips) still
	// need the Reset Transform enabled state to track the layer.
	syncResetTransformState(prefix, layer) {
		const ids = this.getTransformIds(prefix);
		const resetTransform = document.getElementById(ids.resetTransform);
		if (resetTransform) {
			resetTransform.disabled = !this.hasResettableTransformAdjustments(
				this.getLayerTransformData(layer)
			);
		}
	}

	getTransformSizeState(layer, prefix) {
		const transform = this.getLayerTransformData(layer);
		if (!layer || !transform) return null;

		if (prefix === 'sticker') {
			return {
				visible: true,
				width: Math.max(1, Math.round(layer.stickerData.width * ((transform.scale.x || 100) / 100))),
				height: Math.max(1, Math.round(layer.stickerData.height * ((transform.scale.y || 100) / 100)))
			};
		}

		if (prefix === 'shape') {
			return {
				visible: true,
				width: Math.max(1, Math.round(layer.shapeData.width)),
				height: Math.max(1, Math.round(layer.shapeData.height))
			};
		}

		const frame = this.textGlitterManager?.layerTransforms?.get(layer.id)?.getHandleFrame?.();
		return {
			visible: Boolean(frame),
			width: Math.max(1, Math.round((frame?.width || 1) * ((transform.scale.x || 100) / 100))),
			height: Math.max(1, Math.round((frame?.height || 1) * ((transform.scale.y || 100) / 100)))
		};
	}

	getTransformAlignmentState(layer) {
		if (!layer || !this.originalCanvas) return null;

		let metrics = null;
		try {
			metrics = new LayerTransform(layer, this).getFrameMetrics();
		} catch (error) {
			return null;
		}

		if (!metrics) return null;

		const pickAxisAlignment = (candidates, tolerance = 1) => {
			const best = candidates.reduce((winner, candidate) => {
				if (!winner || candidate.delta < winner.delta) return candidate;
				return winner;
			}, null);
			return best && best.delta <= tolerance ? best.mode : null;
		};

		const canvasWidth = this.originalCanvas.width;
		const canvasHeight = this.originalCanvas.height;
		const midX = (metrics.minX + metrics.maxX) / 2;
		const midY = (metrics.minY + metrics.maxY) / 2;

		return {
			x: pickAxisAlignment([
				{ mode: 'left', delta: Math.abs(metrics.minX) },
				{ mode: 'centerX', delta: Math.abs(midX - (canvasWidth / 2)) },
				{ mode: 'right', delta: Math.abs(metrics.maxX - canvasWidth) }
			]),
			y: pickAxisAlignment([
				{ mode: 'top', delta: Math.abs(metrics.minY) },
				{ mode: 'centerY', delta: Math.abs(midY - (canvasHeight / 2)) },
				{ mode: 'bottom', delta: Math.abs(metrics.maxY - canvasHeight) }
			])
		};
	}

	syncTransformAlignmentButtons(prefix, alignmentState) {
		const ids = this.getTransformIds(prefix);
		[
			['left', ids.alignLeft],
			['centerX', ids.alignCenterX],
			['right', ids.alignRight],
			['top', ids.alignTop],
			['centerY', ids.alignCenterY],
			['bottom', ids.alignBottom]
		].forEach(([mode, id]) => {
			const button = document.getElementById(id);
			if (!button) return;
			const active = mode === 'left' || mode === 'centerX' || mode === 'right'
				? alignmentState?.x === mode
				: alignmentState?.y === mode;
			button.classList.toggle('active', Boolean(active));
		});
	}

	loadTransformSettings(layer, prefix, options = {}) {
		const transform = this.getLayerTransformData(layer);
		if (!transform) return;

		const ids = this.getTransformIds(prefix);
		const preserveInputId = options.preserveInputId || null;

		const posX = document.getElementById(ids.posX);
		const posY = document.getElementById(ids.posY);
		if (posX && posX.id !== preserveInputId) posX.value = Math.round(transform.position.x);
		if (posY && posY.id !== preserveInputId) posY.value = Math.round(transform.position.y);

		const sizeState = this.getTransformSizeState(layer, prefix);
		const sizeGroup = document.getElementById(ids.sizeGroup);
		const sizeWidth = document.getElementById(ids.sizeWidth);
		const sizeHeight = document.getElementById(ids.sizeHeight);
		if (sizeGroup && sizeState) {
			sizeGroup.hidden = !sizeState.visible;
		}
		if (sizeWidth && sizeState?.visible && sizeWidth.id !== preserveInputId) sizeWidth.value = sizeState.width;
		if (sizeHeight && sizeState?.visible && sizeHeight.id !== preserveInputId) sizeHeight.value = sizeState.height;

		const rotation = document.getElementById(ids.rotation);
		const rotationValue = document.getElementById(ids.rotationValue);
		if (rotation && rotationValue) {
			rotation.value = transform.rotation;
			rotationValue.innerHTML = formatUnit(Math.round(transform.rotation), '°');
		}

		const proportional = document.getElementById(ids.proportional);
		if (proportional) {
			proportional.checked = transform.proportionalScale;
		}
		const transformPanel = document.querySelector(`[data-transform-prefix="${prefix}"]`);
		transformPanel?.classList.toggle('is-aspect-locked', Boolean(proportional?.checked));
		const scaleXLabel = transformPanel?.querySelector('.transform-scale-x .setting-label');
		if (scaleXLabel) scaleXLabel.textContent = proportional?.checked ? 'Scale' : 'Scale X';
		const scaleSummary = document.getElementById(ids.scaleSummary);
		if (scaleSummary) {
			scaleSummary.innerHTML = this.formatScaleSummary(transform);
		}
		const scaleSlider = document.getElementById(ids.scaleSlider);
		if (scaleSlider) {
			scaleSlider.value = this.getScaleSliderValue(transform);
		}
		const resetScale = document.getElementById(ids.resetScale);
		if (resetScale) {
			resetScale.disabled = !this.hasScaleAdjustment(transform);
		}
		[
			[ids.scaleX, ids.scaleXValue, ids.resetScaleX, transform.scale.x],
			[ids.scaleY, ids.scaleYValue, ids.resetScaleY, transform.scale.y]
		].forEach(([inputId, valueId, resetId, value]) => {
			const input = document.getElementById(inputId);
			const display = document.getElementById(valueId);
			const reset = document.getElementById(resetId);
			if (input) input.value = value;
			if (display) display.innerHTML = formatUnit(Math.round(value), '%');
			if (reset) reset.disabled = Math.abs(value - 100) < 0.01;
		});

		const opacity = document.getElementById(ids.opacity);
		const opacityValue = document.getElementById(ids.opacityValue);
		if (opacity && opacityValue) {
			opacity.value = transform.opacity;
			opacityValue.innerHTML = formatUnit(Math.round(transform.opacity), '%');
		}

		const flipX = document.getElementById(ids.flipX);
		const flipY = document.getElementById(ids.flipY);
		if (flipX) flipX.checked = transform.flipX;
		if (flipY) flipY.checked = transform.flipY;

		this.syncTransformAlignmentButtons(prefix, this.getTransformAlignmentState(layer));

		this.syncResetTransformState(prefix, layer);
	}

	syncTransformHandlesForActiveLayer() {
		if (!this.stickerManager || !this.textGlitterManager) return;

		const activeLayer = this.layerManager.getActiveLayer();
		if (this.currentTool !== ToolType.SELECT || !activeLayer) {
			this.stickerManager.removeTransformHandles();
			this.textGlitterManager.removeTransformHandles();
			this.shapeGlitterManager?.removeTransformHandles();
			this.groupTransformManager?.removeTransformHandles();
			return;
		}

		if (this.layerManager.hasMultiSelection()) {
			this.stickerManager.removeTransformHandles();
			this.textGlitterManager.removeTransformHandles();
			this.shapeGlitterManager?.removeTransformHandles();
			if (this.layerManager.canTransformMultiSelection()) this.groupTransformManager?.createTransformHandles();
			else this.groupTransformManager?.removeTransformHandles();
			return;
		}

		if (activeLayer.locked) {
			this.stickerManager.removeTransformHandles();
			this.textGlitterManager.removeTransformHandles();
			this.shapeGlitterManager?.removeTransformHandles();
			this.groupTransformManager?.removeTransformHandles();
			return;
		}

		this.groupTransformManager?.removeTransformHandles();

		if (activeLayer.type === LayerType.STICKER) {
			this.stickerManager.createTransformHandles(activeLayer.id);
			this.textGlitterManager.removeTransformHandles();
			this.shapeGlitterManager?.removeTransformHandles();
			return;
		}

		if (activeLayer.type === LayerType.TEXT_GLITTER) {
			this.textGlitterManager.createTransformHandles(activeLayer.id);
			this.stickerManager.removeTransformHandles();
			this.shapeGlitterManager?.removeTransformHandles();
			return;
		}

		if (activeLayer.type === LayerType.SHAPE) {
			this.shapeGlitterManager?.createTransformHandles(activeLayer.id);
			this.stickerManager.removeTransformHandles();
			this.textGlitterManager.removeTransformHandles();
			return;
		}

		this.stickerManager.removeTransformHandles();
		this.textGlitterManager.removeTransformHandles();
		this.shapeGlitterManager?.removeTransformHandles();
	}

	snapTransformPosition(transform, position, options = {}) {
		const config = CONFIG.snapping;
		if (!config.enabled || options.ctrlKey) {
			this.clearSmartGuides();
			return position;
		}
		const metrics = transform.getFrameMetrics?.();
		if (!metrics) return position;
		const current = transform.getTransform().position;
		const dx = position.x - current.x;
		const dy = position.y - current.y;
		const movingX = [metrics.minX + dx, (metrics.minX + metrics.maxX) / 2 + dx, metrics.maxX + dx];
		const movingY = [metrics.minY + dy, (metrics.minY + metrics.maxY) / 2 + dy, metrics.maxY + dy];
		const targetsX = [];
		const targetsY = [];
		if (config.snapToCanvas) {
			targetsX.push(0, this.originalCanvas.width / 2, this.originalCanvas.width);
			targetsY.push(0, this.originalCanvas.height / 2, this.originalCanvas.height);
		}
		if (config.snapToLayers) {
			this.layerManager.layers.forEach((layer) => {
				if (layer.id === transform.layer.id || layer.visible === false || layer.locked) return;
				const other = this.getMovableLayerContext(layer)?.manager?.layerTransforms?.get(layer.id)?.getFrameMetrics?.();
				if (!other) return;
				targetsX.push(other.minX, (other.minX + other.maxX) / 2, other.maxX);
				targetsY.push(other.minY, (other.minY + other.maxY) / 2, other.maxY);
			});
		}
		const threshold = config.threshold / Math.max(0.01, this.viewport.currentZoom);
		const best = (moving, targets) => {
			let result = null;
			moving.forEach((value) => targets.forEach((target) => {
				const delta = target - value;
				if (Math.abs(delta) <= threshold && (!result || Math.abs(delta) < Math.abs(result.delta))) result = { delta, target };
			}));
			return result;
		};
		const x = best(movingX, targetsX);
		const y = best(movingY, targetsY);
		this.renderSmartGuides(x?.target, y?.target);
		return { x: position.x + (x?.delta || 0), y: position.y + (y?.delta || 0) };
	}

	renderSmartGuides(x, y) {
		this.clearSmartGuides();
		if (x == null && y == null) return;
		const add = (axis, value) => {
			const guide = document.createElement('div');
			guide.className = `smart-guide smart-guide-${axis} ui-ignore-gestures`;
			guide.style[axis === 'x' ? 'left' : 'top'] = `${value}px`;
			this.canvasElementsContainer.appendChild(guide);
		};
		if (x != null) add('x', x);
		if (y != null) add('y', y);
	}

	snapGroupDelta(bounds, delta, excludedIds, options = {}) {
		const config = CONFIG.snapping;
		if (!config.enabled || options.ctrlKey || !bounds) { this.clearSmartGuides(); return delta; }
		const targetsX = config.snapToCanvas ? [0, this.originalCanvas.width / 2, this.originalCanvas.width] : [];
		const targetsY = config.snapToCanvas ? [0, this.originalCanvas.height / 2, this.originalCanvas.height] : [];
		if (config.snapToLayers) this.layerManager.layers.forEach((layer) => {
			if (excludedIds.includes(layer.id) || layer.visible === false || layer.locked) return;
			const metrics = this.getMovableLayerContext(layer)?.manager?.layerTransforms?.get(layer.id)?.getFrameMetrics?.();
			if (!metrics) return;
			targetsX.push(metrics.minX, (metrics.minX + metrics.maxX) / 2, metrics.maxX);
			targetsY.push(metrics.minY, (metrics.minY + metrics.maxY) / 2, metrics.maxY);
		});
		const threshold = config.threshold / Math.max(0.01, this.viewport.currentZoom);
		const nearest = (moving, targets) => {
			let result = null;
			moving.forEach((value) => targets.forEach((target) => { const adjustment = target - value; if (Math.abs(adjustment) <= threshold && (!result || Math.abs(adjustment) < Math.abs(result.adjustment))) result = { adjustment, target }; }));
			return result;
		};
		const x = nearest([bounds.left + delta.x, bounds.centerX + delta.x, bounds.right + delta.x], targetsX);
		const y = nearest([bounds.top + delta.y, bounds.centerY + delta.y, bounds.bottom + delta.y], targetsY);
		this.renderSmartGuides(x?.target, y?.target);
		return { x: delta.x + (x?.adjustment || 0), y: delta.y + (y?.adjustment || 0) };
	}

	clearSmartGuides() {
		this.canvasElementsContainer?.querySelectorAll('.smart-guide').forEach((guide) => guide.remove());
	}

	applyTransformSizeFromPanel(prefix, layer, manager, axis, rawValue) {
		const value = Math.max(1, Math.round(rawValue));
		const ids = this.getTransformIds(prefix);
		const lockAspect = Boolean(document.getElementById(ids.proportional)?.checked);

		if (prefix === 'sticker') {
			const nativeWidth = Math.max(1, layer.stickerData.width);
			const nativeHeight = Math.max(1, layer.stickerData.height);
			let nextScaleX = axis === 'width'
				? (value / nativeWidth) * 100
				: getLayerTransform(layer).scale.x;
			let nextScaleY = axis === 'height'
				? (value / nativeHeight) * 100
				: getLayerTransform(layer).scale.y;

			if (lockAspect) {
				const uniform = axis === 'width' ? nextScaleX : nextScaleY;
				nextScaleX = uniform;
				nextScaleY = uniform;
			}

			manager.updateTransform(layer.id, {
				scale: { x: nextScaleX, y: nextScaleY }
			});
			return true;
		}

		if (prefix === 'shape') {
			const aspect = Math.max(0.01, layer.shapeData.width / Math.max(1, layer.shapeData.height));
			let nextWidth = axis === 'width' ? value : layer.shapeData.width;
			let nextHeight = axis === 'height' ? value : layer.shapeData.height;
			if (lockAspect) {
				if (axis === 'width') {
					nextHeight = Math.max(CONFIG.tools.shapes.minSize, Math.round(nextWidth / aspect));
				} else {
					nextWidth = Math.max(CONFIG.tools.shapes.minSize, Math.round(nextHeight * aspect));
				}
			}
			return Boolean(manager.setShapeSize?.(layer, nextWidth, nextHeight));
		}

		if (prefix === 'text' && (layer.textData?.boxMode || 'auto') === 'fixed') {
			const transform = getLayerTransform(layer);
			const scaleX = Math.max(0.01, (transform.scale.x || 100) / 100);
			const scaleY = Math.max(0.01, (transform.scale.y || 100) / 100);
			const currentWidth = Math.max(1, layer.textData.boxWidth || 1);
			const currentHeight = Math.max(1, layer.textData.boxHeight || 1);
			const displayAspect = (currentWidth * scaleX) / Math.max(1, currentHeight * scaleY);
			let nextWidth = axis === 'width' ? value / scaleX : currentWidth;
			let nextHeight = axis === 'height' ? value / scaleY : currentHeight;
			if (lockAspect) {
				if (axis === 'width') nextHeight = (value / displayAspect) / scaleY;
				else nextWidth = (value * displayAspect) / scaleX;
			}
			return Boolean(manager.setBoxSize?.(layer, nextWidth, nextHeight));
		}

		const current = this.getTransformSizeState(layer, prefix);
		if (!current?.visible) return false;
		const transform = getLayerTransform(layer);
		const scale = { ...transform.scale };
		if (axis === 'width') scale.x = clampLayerScale(scale.x * value / current.width);
		else scale.y = clampLayerScale(scale.y * value / current.height);
		manager.updateTransform(layer.id, { scale });
		return true;
	}

	setupTransformListeners(prefix, layerType, getManager) {
		const ids = this.getTransformIds(prefix);
		const activeManager = () => {
			const layer = this.layerManager.getActiveLayer();
			const manager = getManager();
			return (layer && layer.type === layerType && manager) ? { layer, manager } : null;
		};
		const showUnit = (el, num, unit) => { if (el) el.innerHTML = formatUnit(Math.round(num), unit); };
		['Fit', 'Fill'].forEach((mode) => {
			document.getElementById(`${prefix}${mode}Canvas`)?.addEventListener('click', async () => {
				const active = activeManager();
				const transform = active?.manager?.layerTransforms?.get(active.layer.id);
				const metrics = transform?.getFrameMetrics?.();
				if (!active || !metrics) return;
				const factor = (mode === 'Fill' ? Math.max : Math.min)(
					this.originalCanvas.width / Math.max(1, metrics.displayWidth),
					this.originalCanvas.height / Math.max(1, metrics.displayHeight)
				);
				const current = getLayerTransform(active.layer);
				active.manager.updateTransform(active.layer.id, {
					position: { x: this.originalCanvas.width / 2, y: this.originalCanvas.height / 2 },
					scale: { x: clampLayerScale(current.scale.x * factor), y: clampLayerScale(current.scale.y * factor) }
				});
				if (prefix === 'text') await active.manager.commitScaleToFontSize?.(active.layer);
				if (prefix === 'shape') active.manager.commitScale?.(active.layer);
				this.loadTransformSettings(active.layer, prefix);
				this.saveState();
			});
		});
		const bindNumberInput = (id, applyValue) => {
			const input = document.getElementById(id);
			if (!input) return;

			input.addEventListener('input', () => {
				const active = activeManager();
				const value = parseFloat(input.value);
				if (!active || Number.isNaN(value)) return;
				applyValue(value, active);
				this.loadTransformSettings(active.layer, prefix, { preserveInputId: id });
			});

			input.addEventListener('change', () => {
				const active = activeManager();
				if (!active) return;
				this.loadTransformSettings(active.layer, prefix);
				this.saveState();
			});

			input.addEventListener('keydown', (event) => {
				if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
				event.preventDefault();
				const step = event.shiftKey ? 10 : 1;
				const current = parseFloat(input.value || '0');
				const delta = event.key === 'ArrowUp' ? step : -step;
				const min = input.min !== '' ? parseFloat(input.min) : Number.NEGATIVE_INFINITY;
				input.value = String(Math.max(min, Math.round(current + delta)));
				input.dispatchEvent(new Event('input'));
				input.dispatchEvent(new Event('change'));
			});
		};

		bindNumberInput(ids.posX, (value, active) => {
			active.manager.updateTransform(active.layer.id, { position: { x: value } });
		});
		bindNumberInput(ids.posY, (value, active) => {
			active.manager.updateTransform(active.layer.id, { position: { y: value } });
		});
		bindNumberInput(ids.sizeWidth, (value, active) => {
			this.applyTransformSizeFromPanel(prefix, active.layer, active.manager, 'width', value);
		});
		bindNumberInput(ids.sizeHeight, (value, active) => {
			this.applyTransformSizeFromPanel(prefix, active.layer, active.manager, 'height', value);
		});

		// Rotation
		const rotation = document.getElementById(ids.rotation);
		const rotationValue = document.getElementById(ids.rotationValue);
		const resetRotation = document.getElementById(ids.resetRotation);

		if (rotation && rotationValue) {
			rotation.addEventListener('input', (e) => {
				// Shift-drag snaps to 15° increments, mirroring the rotation handle.
				let value = parseFloat(e.target.value);
				if (this.shiftHeld) {
					value = Math.round(value / 15) * 15;
					e.target.value = value;
				}
				showUnit(rotationValue, value, '°');

				const active = activeManager();
				if (active) {
					active.manager.updateTransform(active.layer.id, { rotation: value });
					this.syncResetTransformState(prefix, active.layer);
				}
			});

			rotation.addEventListener('change', () => this.saveState());
		}

		if (resetRotation) {
			resetRotation.addEventListener('click', () => {
				if (rotation) rotation.value = CONFIG.tools.stickers.defaults.transform.rotation;
				showUnit(rotationValue, CONFIG.tools.stickers.defaults.transform.rotation, '°');

				const active = activeManager();
				if (active) {
					active.manager.updateTransform(active.layer.id, { rotation: CONFIG.tools.stickers.defaults.transform.rotation });
					this.syncResetTransformState(prefix, active.layer);
					this.saveState();
				}
			});
		}

		// Opacity
		const opacity = document.getElementById(ids.opacity);
		const opacityValue = document.getElementById(ids.opacityValue);
		const resetOpacity = document.getElementById(ids.resetOpacity);

		if (opacity && opacityValue) {
			opacity.addEventListener('input', (e) => {
				const value = parseFloat(e.target.value);
				showUnit(opacityValue, value, '%');

				const active = activeManager();
				if (active) active.manager.updateTransform(active.layer.id, { opacity: value });
			});

			opacity.addEventListener('change', () => this.saveState());
		}

		if (resetOpacity) {
			resetOpacity.addEventListener('click', () => {
				if (opacity) opacity.value = CONFIG.tools.stickers.defaults.transform.opacity;
				showUnit(opacityValue, CONFIG.tools.stickers.defaults.transform.opacity, '%');

				const active = activeManager();
				if (active) {
					active.manager.updateTransform(active.layer.id, { opacity: CONFIG.tools.stickers.defaults.transform.opacity });
					this.saveState();
				}
			});
		}

		const proportionalScale = document.getElementById(ids.proportional);
		if (proportionalScale) {
			proportionalScale.addEventListener('change', (event) => {
				const active = activeManager();
				if (!active) return;
				const current = getLayerTransform(active.layer);
				active.manager.updateTransform(active.layer.id, {
					proportionalScale: event.target.checked,
					...(event.target.checked ? { scale: { x: current.scale.x, y: current.scale.x } } : {})
				});
				this.loadTransformSettings(active.layer, prefix);
				this.saveState();
			});
		}

		const bindAxisScale = (axis, inputId, valueId, resetId) => {
			const input = document.getElementById(inputId);
			const display = document.getElementById(valueId);
			const reset = document.getElementById(resetId);
			if (!input) return;

			input.addEventListener('input', (event) => {
				const active = activeManager();
				if (!active) return;
				const value = clampLayerScale(parseFloat(event.target.value) || 100);
				const current = getLayerTransform(active.layer);
				const scale = { ...current.scale, [axis]: value };
				if (document.getElementById(ids.proportional)?.checked) {
					const otherAxis = axis === 'x' ? 'y' : 'x';
					const previous = Math.max(0.01, current.scale[axis]);
					scale[otherAxis] = clampLayerScale(current.scale[otherAxis] * value / previous);
				}
				active.manager.updateTransform(active.layer.id, { scale });
				this.loadTransformSettings(active.layer, prefix);
			});
			input.addEventListener('change', () => this.saveState());
			reset?.addEventListener('click', () => {
				const active = activeManager();
				if (!active) return;
				const current = getLayerTransform(active.layer);
				const scale = { ...current.scale, [axis]: 100 };
				if (document.getElementById(ids.proportional)?.checked) scale[axis === 'x' ? 'y' : 'x'] = 100;
				active.manager.updateTransform(active.layer.id, { scale });
				this.loadTransformSettings(active.layer, prefix);
				this.saveState();
			});
		};
		bindAxisScale('x', ids.scaleX, ids.scaleXValue, ids.resetScaleX);
		bindAxisScale('y', ids.scaleY, ids.scaleYValue, ids.resetScaleY);

		const scaleSlider = document.getElementById(ids.scaleSlider);
		const scaleSummary = document.getElementById(ids.scaleSummary);
		if (scaleSlider) {
			scaleSlider.addEventListener('input', (event) => {
				const active = activeManager();
				if (!active) return;
				const value = clampLayerScale(parseFloat(event.target.value) || 100);
				active.manager.updateTransform(active.layer.id, {
					scale: { x: value, y: value }
				});
				if (scaleSummary) {
					scaleSummary.innerHTML = this.formatScaleSummary(this.getLayerTransformData(active.layer));
				}
				this.loadTransformSettings(active.layer, prefix);
			});

			scaleSlider.addEventListener('change', async () => {
				const active = activeManager();
				if (!active) return;
				if (
					prefix === 'text'
					&& (active.layer.textData?.boxMode || 'auto') === 'auto'
					&& active.manager.commitScaleToFontSize
				) {
					await active.manager.commitScaleToFontSize(active.layer);
					this.loadTransformSettings(active.layer, prefix);
				}
				this.saveState();
			});
		}

		const resetScale = document.getElementById(ids.resetScale);
		if (resetScale) {
			resetScale.addEventListener('click', () => {
				const active = activeManager();
				if (!active) return;
				active.manager.updateTransform(active.layer.id, {
					scale: {
						x: CONFIG.tools.stickers.defaults.transform.scale.x,
						y: CONFIG.tools.stickers.defaults.transform.scale.y
					}
				});
				this.loadTransformSettings(active.layer, prefix);
				this.saveState();
			});
		}

		// Flip
		const attachFlip = (checkboxId, property) => {
			const checkbox = document.getElementById(checkboxId);
			if (!checkbox) return;

			checkbox.addEventListener('change', (e) => {
				const active = activeManager();
				if (active) {
					active.manager.updateTransform(active.layer.id, { [property]: e.target.checked });
					this.syncResetTransformState(prefix, active.layer);
					this.saveState();
				}
			});
		};

		attachFlip(ids.flipX, 'flipX');
		attachFlip(ids.flipY, 'flipY');

		[
			['left', ids.alignLeft],
			['centerX', ids.alignCenterX],
			['right', ids.alignRight],
			['top', ids.alignTop],
			['centerY', ids.alignCenterY],
			['bottom', ids.alignBottom]
		].forEach(([mode, id]) => {
			const button = document.getElementById(id);
			if (!button) return;
			button.addEventListener('click', () => {
				const active = activeManager();
				if (!active?.manager?.alignToCanvas) return;
				active.manager.alignToCanvas(active.layer.id, mode);
				this.loadTransformSettings(active.layer, prefix);
			});
		});

		const resetTransform = document.getElementById(ids.resetTransform);
		if (resetTransform) {
			resetTransform.addEventListener('click', () => {
				const active = activeManager();
				if (!active?.manager?.resetTransform) return;
				active.manager.resetTransform(active.layer.id);
				this.loadTransformSettings(active.layer, prefix);
			});
		}
	}

	setupImageListeners() {
		const imageUpload = document.getElementById('imageUpload');
		const projectUpload = document.getElementById('projectUpload');
		const imageDropzone = document.getElementById('imageDropzone');
		const openProjectBtn = document.getElementById('openProjectBtn');
		const openProjectSidebarBtn = document.getElementById('openProjectSidebarBtn');

		// New Canvas button (desktop welcome state + mobile dropzone)
		const openNewCanvasBtn = document.getElementById('openNewCanvasBtn');
		const dropzoneNewCanvasBtn = document.getElementById('dropzoneNewCanvasBtn');
		[openNewCanvasBtn, dropzoneNewCanvasBtn].forEach((button) => {
			if (!button) return;
			button.addEventListener('click', (e) => {
				e.stopPropagation();
				const modal = document.getElementById('newCanvasModal');
				if (modal) {
					modal.classList.add('visible');
					this.initializeNewCanvasModal();
				}
			});
		});

		if (imageUpload) {
			imageUpload.addEventListener('change', (e) => this.loadImage(e));
		}

		if (projectUpload) {
			projectUpload.addEventListener('change', async (e) => {
				const file = e.target.files?.[0];
				if (!file) return;
				await this.openProjectFile(file);
				e.target.value = '';
			});
		}

		[openProjectBtn, openProjectSidebarBtn].forEach((button) => {
			if (button && projectUpload) {
				button.addEventListener('click', () => {
					projectUpload.click();
				});
			}
		});

		if (imageDropzone) {
			imageDropzone.addEventListener('click', () => {
				imageUpload.click();
			});

			imageDropzone.addEventListener('dragover', (e) => {
				e.preventDefault();
				imageDropzone.classList.add('drag-over');
			});

			imageDropzone.addEventListener('dragleave', () => {
				imageDropzone.classList.remove('drag-over');
			});

			imageDropzone.addEventListener('drop', async (e) => {
				e.preventDefault();
				imageDropzone.classList.remove('drag-over');

				const file = e.dataTransfer.files[0];
				if (!file) return;

				const isProjectFile = file.type === 'application/json' ||
					file.name.toLowerCase().endsWith('.json');
				if (isProjectFile) {
					await this.openProjectFile(file);
					return;
				}

				if (file.type.startsWith('image/')) {
					const fakeEvent = { target: { files: [file] } };
					await this.loadImage(fakeEvent);
				}
			});
		}

	}


	initializeNewCanvasModal() {
		const widthInput = document.getElementById('newCanvasWidth');
		const heightInput = document.getElementById('newCanvasHeight');
		const colorInput = document.getElementById('newCanvasColor');
		const presetButtons = document.querySelectorAll('.new-canvas-preset-btn');
		const backgroundRadios = document.querySelectorAll('input[name="canvasBackground"]');
		const colorRow = document.getElementById('canvasColorRow');

		// Reset to defaults
		if (widthInput) widthInput.value = CONFIG.canvas.defaults.blankDocument.width;
		if (heightInput) heightInput.value = CONFIG.canvas.defaults.blankDocument.height;
		if (colorInput) colorInput.value = CONFIG.canvas.defaults.blankDocument.color;

		// Reset background to "Color" option
		const colorRadio = document.querySelector('input[name="canvasBackground"][value="color"]');
		if (colorRadio) colorRadio.checked = true;

		// Enable color row since we default to color background
		if (colorRow) colorRow.classList.remove('disabled');

		// Find and activate matching preset
		let matchingPreset = null;
		presetButtons.forEach(btn => {
			btn.classList.remove('active');
			const width = parseInt(btn.dataset.width);
			const height = parseInt(btn.dataset.height);
			if (width === CONFIG.canvas.defaults.blankDocument.width && height === CONFIG.canvas.defaults.blankDocument.height) {
				matchingPreset = btn;
			}
		});

		if (matchingPreset) {
			matchingPreset.classList.add('active');
		}

		// Update orientation buttons based on default dimensions
		this.updateOrientationButtons(CONFIG.canvas.defaults.blankDocument.width, CONFIG.canvas.defaults.blankDocument.height);
	}

	setupNewCanvasModalListeners() {
		const createBtn = document.getElementById('createCanvasBtn');


		const widthInput = document.getElementById('newCanvasWidth');
		const heightInput = document.getElementById('newCanvasHeight');
		const colorInput = document.getElementById('newCanvasColor');
		const orientationPortrait = document.getElementById('orientationPortrait');
		const orientationLandscape = document.getElementById('orientationLandscape');
		const presetButtons = document.querySelectorAll('.new-canvas-preset-btn');
		const backgroundRadios = document.querySelectorAll('input[name="canvasBackground"]');
		const colorRow = document.getElementById('canvasColorRow');

		// Presets are a shortcut, not a mode: highlight tracks whether the current
		// dimensions exactly match a preset, so editing width/height/orientation
		// deselects and swapping back re-selects.
		const syncPresetHighlight = () => {
			const width = parseInt(widthInput?.value);
			const height = parseInt(heightInput?.value);
			presetButtons.forEach(btn => {
				btn.classList.toggle('active',
					parseInt(btn.dataset.width) === width && parseInt(btn.dataset.height) === height);
			});
		};

		// Preset buttons
		presetButtons.forEach(btn => {
			btn.addEventListener('click', () => {
				const width = parseInt(btn.dataset.width);
				const height = parseInt(btn.dataset.height);

				if (widthInput) widthInput.value = width;
				if (heightInput) heightInput.value = height;

				syncPresetHighlight();
				this.updateOrientationButtons(width, height);
			});
		});

		// Orientation toggle - Portrait
		if (orientationPortrait) {
			orientationPortrait.addEventListener('click', () => {
				const width = parseInt(widthInput.value);
				const height = parseInt(heightInput.value);

				if (width === height) return;

				if (width > height) {
					widthInput.value = height;
					heightInput.value = width;
				}

				syncPresetHighlight();
				this.updateOrientationButtons(parseInt(widthInput.value), parseInt(heightInput.value));
			});
		}

		// Orientation toggle - Landscape
		if (orientationLandscape) {
			orientationLandscape.addEventListener('click', () => {
				const width = parseInt(widthInput.value);
				const height = parseInt(heightInput.value);

				if (width === height) return;

				if (height > width) {
					widthInput.value = height;
					heightInput.value = width;
				}

				syncPresetHighlight();
				this.updateOrientationButtons(parseInt(widthInput.value), parseInt(heightInput.value));
			});
		}

		// Dimension inputs
		if (widthInput && heightInput) {
			const updateOrientation = () => {
				syncPresetHighlight();
				this.updateOrientationButtons(parseInt(widthInput.value), parseInt(heightInput.value));
			};

			widthInput.addEventListener('input', updateOrientation);
			heightInput.addEventListener('input', updateOrientation);
		}

		// Background type toggle
		backgroundRadios.forEach(radio => {
			radio.addEventListener('change', (e) => {
				if (colorRow) {
					colorRow.classList.toggle('disabled', radio.value !== 'color');
				}
			});
		});

		// Create button
		if (createBtn) {
			createBtn.addEventListener('click', async () => {
				const width = parseInt(widthInput.value);
				const height = parseInt(heightInput.value);
				const backgroundType = document.querySelector('input[name="canvasBackground"]:checked').value;
				const color = backgroundType === 'color' ? colorInput.value : 'transparent';

				await this.loadBlankImage(width, height, color);
				this.modalManager.close('newCanvasModal');
			});
		}

	}

	updateOrientationButtons(width, height) {
		const portraitBtn = document.getElementById('orientationPortrait');
		const landscapeBtn = document.getElementById('orientationLandscape');

		if (!portraitBtn || !landscapeBtn) return;

		// Check if square
		const isSquare = width === height;

		// Disable buttons if square
		portraitBtn.disabled = isSquare;
		landscapeBtn.disabled = isSquare;

		// Remove active from both
		portraitBtn.classList.remove('active');
		landscapeBtn.classList.remove('active');

		// Only set active state if not square
		if (!isSquare) {
			if (height > width) {
				portraitBtn.classList.add('active');
			} else if (width > height) {
				landscapeBtn.classList.add('active');
			}
		}
	}

	setupModalListeners() {
		this.modalManager = new ModalManager();

		// Simple modals (inline content)
		this.modalManager
			.register('shortcutsModal', {
				openBtnId: 'shortcutsBtn',
				closeBtnId: 'closeShortcutsModal',
				resetScrollOnOpen: true
			})
			.register('exportSettingsModal', {
				openBtnId: 'exportSettingsBtn',
				closeBtnId: ['closeExportSettingsModal', 'closeExportSettingsModalFooter'],
				resetScrollOnOpen: true,
				onOpen: () => this.updateExportDuration()
			})
			.register('settingsModal', {
				openBtnId: ['settingsBtn', 'mobileAppSettingsBtn'],
				closeBtnId: ['closeSettingsModal', 'closeSettingsModalFooter'],
				resetScrollOnOpen: true
			})
			.register('exportPreviewModal', {  // ADD THIS
				closeBtnId: 'closeExportPreviewModal',
				resetScrollOnOpen: false
			})
			.register('confirmationModal', {
				closeBtnId: ['confirmationModalClose', 'confirmationCancelBtn'],
				resetScrollOnOpen: false,
				initialFocusSelector: '#confirmationConfirmBtn',
				confirmOnEnter: true,
				enterActionSelector: '#confirmationConfirmBtn',
				onClose: () => this.resolvePendingConfirmation(this.pendingConfirmationValue)
			});

		// External content modals with core/utils.js initialization
		this.modalManager
			.register('aboutModal', {
				openBtnId: 'aboutBtn',
				closeBtnId: 'closeAboutModal',
				externalContentUrl: 'modals/about.html?v=5',
				cacheContent: true,
				resetScrollOnOpen: true,
				onContentLoaded: (modalBody) => {
					this.renderVersionHistory(modalBody);
					// Initialize pixel-scaled images
					initPixelScalerInContainer(modalBody);

					// Initialize references (sup ↔ reference list interaction)
					initModalReferences(modalBody, {
						referenceListSelector: 'ol#AboutReferencesList'
					});

					// Initialize smooth scrolling for TOC and anchors
					const modal = document.getElementById('aboutModal');
					initModalSmoothScroll(modal);

					// Initialize tooltips for dynamically loaded content
					initTooltipsInContainer(modalBody);


				}
			})
			.register('guideModal', {
				openBtnId: 'guideBtn',
				closeBtnId: 'closeGuideModal',
				externalContentUrl: 'modals/guide.html?v=34',
				cacheContent: true,
				resetScrollOnOpen: true,
				onContentLoaded: (modalBody) => {
					// Initialize pixel-scaled images (for screenshots)
					initPixelScalerInContainer(modalBody);

					// Initialize smooth scrolling for TOC navigation
					const modal = document.getElementById('guideModal');
					initModalSmoothScroll(modal);
				}
			});




		// Layer type picker modal (no open button - opened programmatically)
		this.modalManager.register('layerTypePickerModal', {
			closeBtnId: 'closeLayerTypePickerModal',
			resetScrollOnOpen: false
		});

		// Sticker upload modal - ONLY uploadStickerBtn opens this
		this.modalManager.register('stickerUploadModal', {
			openBtnId: 'uploadStickerBtn',
			closeBtnId: 'closeStickerUploadModal',
			resetScrollOnOpen: false
		});

		// New canvas modal
		this.modalManager.register('newCanvasModal', {
			closeBtnId: ['closeNewCanvasModal', 'createCanvasCloseBtn'],
			resetScrollOnOpen: true,
			initialFocusSelector: '#newCanvasWidth',
			confirmOnEnter: true,
			enterActionSelector: '#createCanvasBtn',
			onOpen: () => this.initializeNewCanvasModal()
		});

		// Welcome modal is shown automatically and remains available from the header.
		this.modalManager.register('welcomeModal', {
			openBtnId: 'openWelcomeModal',
			closeBtnId: 'closeWelcomeModal',
			externalContentUrl: 'modals/welcome.html?v=3',
			cacheContent: true,
			resetScrollOnOpen: false,
			onContentLoaded: (modalBody) => {
				initPixelScalerInContainer(modalBody);
				this.renderVersionHistory(modalBody, 2);
				this.setupWelcomeModalListeners();
			},
			onOpen: () => {
				const checkbox = document.getElementById('welcomeDontShowAgain');
				if (checkbox) checkbox.checked = !this.showWelcomeOnStartup;
			},
			onClose: () => {
				const checkbox = document.getElementById('welcomeDontShowAgain');
				try {
					localStorage.setItem('glitterEditor_welcomeLastSeenRelease', CONFIG.app.currentRelease);
					if (checkbox?.checked) {
						localStorage.setItem('glitterEditor_welcomeModalSeen', 'true');
						this.showWelcomeOnStartup = false;
					} else {
						localStorage.removeItem('glitterEditor_welcomeModalSeen');
						this.showWelcomeOnStartup = true;
					}
					this.saveSettingsToStorage();
				} catch (e) {
					console.warn('Failed to save welcome modal preference:', e);
				}
			}
		});

		// Check if should show welcome modal on page load
		this.checkWelcomeModal();


		// Setup modal-specific interactions
		this.setupConfirmationModalListeners();
		this.setupLayerTypePickerListeners();
		this.setupLayerPanelListeners();
		this.setupStickerUploadModalListeners();
		this.setupNewCanvasModalListeners();
	}

renderVersionHistory(root, limit = null) {
	const releases = limit == null ? CONFIG.app.releases : CONFIG.app.releases.slice(0, limit);
	root.querySelectorAll('[data-version-history]').forEach((history) => {
		history.replaceChildren(...releases.map((release) => {
			const entry = document.createElement('section');
			entry.className = 'version-history-entry';

			const header = document.createElement('div');
			header.className = 'version-history-header';
			const title = document.createElement('h4');
			title.textContent = `v${release.version} — ${release.name}`;
			const date = document.createElement('time');
			date.dateTime = release.date;
			date.textContent = release.dateLabel;
			header.append(title, date);

			const summary = document.createElement('p');
			summary.textContent = release.summary;
			const features = document.createElement('ul');
			features.append(...release.features.map((feature) => {
				const item = document.createElement('li');
				item.textContent = feature;
				return item;
			}));

			entry.append(header, summary, features);
			return entry;
		}));
	});
}

async checkWelcomeModal() {
	const storageKey = 'glitterEditor_welcomeModalSeen';
	
	try {
		const isSuppressed = localStorage.getItem(storageKey) === 'true';
		const lastSeenRelease = localStorage.getItem('glitterEditor_welcomeLastSeenRelease');
		const showOnStartup = this.showWelcomeOnStartup ?? !isSuppressed;
		const hasUnseenRelease = lastSeenRelease !== CONFIG.app.currentRelease;
		
		if (showOnStartup || hasUnseenRelease) {
			const welcomeConfig = this.modalManager.modals.get('welcomeModal');
			if (welcomeConfig?.externalContentUrl) {
				await this.modalManager.loadExternalContent(welcomeConfig);
			}
			this.modalManager.open('welcomeModal');

			// Warm the guide after the welcome screen is visible so startup never
			// waits on content the user has not requested yet.
			const guideConfig = this.modalManager.modals.get('guideModal');
			if (guideConfig && guideConfig.externalContentUrl) {
				this.modalManager.loadExternalContent(guideConfig).catch((error) => dbg('Guide preload failed:', error));
			}
		}
	} catch (e) {
		console.warn('Failed to check welcome modal status:', e);
	}
}

setupWelcomeModalListeners() {
	const storageKey = 'glitterEditor_welcomeModalSeen';
	
	const takeTourBtn = document.getElementById('welcomeTakeTourBtn');
	const startCreatingBtn = document.getElementById('welcomeStartCreatingBtn');
	const dontShowCheckbox = document.getElementById('welcomeDontShowAgain');
	if (takeTourBtn?.dataset.welcomeBound === 'true') return;
	if (takeTourBtn) takeTourBtn.dataset.welcomeBound = 'true';
	if (startCreatingBtn) startCreatingBtn.dataset.welcomeBound = 'true';
	
	const markAsSeenIfChecked = () => {
		if (dontShowCheckbox && dontShowCheckbox.checked) {
			try {
				localStorage.setItem(storageKey, 'true');
				this.showWelcomeOnStartup = false;
				this.saveSettingsToStorage();
			} catch (e) {
				console.warn('Failed to save welcome modal preference:', e);
			}
		}
	};
	
	if (takeTourBtn) {
		takeTourBtn.addEventListener('click', () => {
			markAsSeenIfChecked();
			this.modalManager.close('welcomeModal');
			this.modalManager.open('guideModal');
		});
	}
	
	if (startCreatingBtn) {
		startCreatingBtn.addEventListener('click', () => {
			markAsSeenIfChecked();
			this.modalManager.close('welcomeModal');
		});
	}
}

	setupConfirmationModalListeners() {
		const confirmBtn = document.getElementById('confirmationConfirmBtn');
		if (confirmBtn) {
			confirmBtn.addEventListener('click', () => {
				this.pendingConfirmationValue = true;
				this.modalManager.close('confirmationModal');
			});
		}
	}

	resolvePendingConfirmation(value) {
		if (!this.pendingConfirmationResolve) {
			this.pendingConfirmationValue = false;
			return;
		}

		const resolve = this.pendingConfirmationResolve;
		this.pendingConfirmationResolve = null;
		this.pendingConfirmationValue = false;
		resolve(Boolean(value));
	}

	confirmAction(options = {}) {
		const {
			title = 'Confirm',
			message = 'Are you sure?',
			confirmLabel = 'Confirm',
			cancelLabel = 'Cancel',
			destructive = false,
			details = [],
			outro = ''
		} = options;

		if (destructive && this.confirmDestructiveActions === false) {
			return Promise.resolve(true);
		}

		if (!this.modalManager || !document.getElementById('confirmationModal')) {
			return Promise.resolve(confirm(message));
		}

		if (this.pendingConfirmationResolve) {
			this.resolvePendingConfirmation(false);
		}

		const titleNode = document.getElementById('confirmationModalTitle');
		const messageNode = document.getElementById('confirmationModalMessage');
		const confirmBtn = document.getElementById('confirmationConfirmBtn');
		const cancelBtn = document.getElementById('confirmationCancelBtn');

		if (titleNode) titleNode.textContent = title;
		if (messageNode) {
			messageNode.replaceChildren();
			const copy = document.createElement('p');
			copy.className = 'confirmation-message-copy';
			copy.textContent = message;
			messageNode.appendChild(copy);
			if (details.length) {
				const list = document.createElement('ul');
				list.className = 'confirmation-message-list';
				details.forEach((detail) => {
					const item = document.createElement('li');
					item.textContent = detail;
					list.appendChild(item);
				});
				messageNode.appendChild(list);
			}
			if (outro) {
				const footerCopy = document.createElement('p');
				footerCopy.className = 'confirmation-message-outro';
				footerCopy.textContent = outro;
				messageNode.appendChild(footerCopy);
			}
		}
		if (confirmBtn) confirmBtn.textContent = confirmLabel;
		if (cancelBtn) cancelBtn.textContent = cancelLabel;

		this.pendingConfirmationValue = false;

		return new Promise((resolve) => {
			this.pendingConfirmationResolve = resolve;
			this.modalManager.open('confirmationModal');
		});
	}

	alertAction(options = {}) {
		const {
			title = 'Notice',
			message = ''
		} = options;

		if (!this.modalManager || !document.getElementById('confirmationModal')) {
			alert(message);
			return Promise.resolve();
		}

		const cancelBtn = document.getElementById('confirmationCancelBtn');
		if (cancelBtn) cancelBtn.style.display = 'none';

		return this.confirmAction({ title, message, confirmLabel: 'OK' }).then(() => {
			if (cancelBtn) cancelBtn.style.display = '';
		});
	}


	setupLayerTypePickerListeners() {
		const optionsContainer = document.querySelector('#layerTypePickerModal .layer-type-options');
		if (!optionsContainer) return;

		this.renderLayerTypePickerOptions(optionsContainer);

		optionsContainer.addEventListener('click', (event) => {
			const button = event.target.closest('.layer-type-option');
			if (!button) return;

			this.modalManager.close('layerTypePickerModal');
			requestAnimationFrame(() => {
				this.createLayerByType(button.dataset.layerType);
			});
		});
	}

	createLayerByType(layerType) {
		if (!LAYER_UI_CONFIG[layerType]?.addableViaModal) {
			dbg(`Unknown add-layer type: ${layerType}`);
			return;
		}

		this.layerManager.addLayer(layerType);
	}

	createLayerTypeOptionButton(type, { iconSizeClass = 'xl', id = null } = {}) {
		const modalConfig = LAYER_UI_CONFIG[type]?.addableViaModal;
		if (!modalConfig) return null;

		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'layer-type-option';
		button.dataset.layerType = type;
		if (id) {
			button.id = id;
		}
		button.innerHTML = `
			<span class="layer-type-icon icon-wrapper ${iconSizeClass}">
				<svg class="icon">
					<use href="#icon-${modalConfig.icon}"></use>
				</svg>
			</span>
			<span class="layer-type-name">${modalConfig.label}</span>
			<span class="layer-type-description">${modalConfig.description}</span>
		`;
		return button;
	}

	renderLayerTypePickerOptions(container, options = {}) {
		container.innerHTML = '';
		const iconSizeClass = options.iconSizeClass || 'xl';
		const idMap = options.idMap || {};

		getAddableLayerTypes().forEach((type) => {
			const id = idMap[type] || null;
			const button = this.createLayerTypeOptionButton(type, { iconSizeClass, id });
			if (button) {
				container.appendChild(button);
			}
		});
	}

	setupStickerUploadModalListeners() {
		// Note: Modal open/close is handled by ModalManager
		// uploadStickerBtn opens the modal via ModalManager.register()

		const dropzone = document.getElementById('stickerUploadDropzone');
		const input = document.getElementById('stickerUploadInput');

		// Dropzone click
		if (dropzone && input) {
			dropzone.addEventListener('click', () => {
				input.click();
			});
		}

		// File selection
		if (input) {
			input.addEventListener('change', async (e) => {
				const file = e.target.files[0];
				if (file) {
					await this.stickerManager.handleUserUpload(file);
					this.modalManager.close('stickerUploadModal');
					input.value = '';
				}
			});
		}

		// Drag and drop
		if (dropzone) {
			dropzone.addEventListener('dragover', (e) => {
				e.preventDefault();
				dropzone.classList.add('drag-over');
			});

			dropzone.addEventListener('dragleave', () => {
				dropzone.classList.remove('drag-over');
			});

			dropzone.addEventListener('drop', async (e) => {
				e.preventDefault();
				dropzone.classList.remove('drag-over');

				const file = e.dataTransfer.files[0];
				if (file) {
					await this.stickerManager.handleUserUpload(file);
					this.modalManager.close('stickerUploadModal');
				}
			});
		}
	}

	setupLayerPanelListeners() {
		// Add layer buttons - open layer type picker
		['addLayerBtn', 'mobileAddLayerBtn'].forEach((id) => {
			const addLayerBtn = document.getElementById(id);
			if (addLayerBtn) addLayerBtn.addEventListener('click', () => {
				this.modalManager.open('layerTypePickerModal');
			});
		});

		const quickAddOptions = document.getElementById('quickAddOptions');
		if (quickAddOptions) {
			this.renderLayerTypePickerOptions(quickAddOptions, {
				iconSizeClass: '',
				idMap: {
					[LayerType.GLITTER_FILL]: 'quickActionAddGlitter',
					[LayerType.STICKER]: 'quickActionAddSticker',
					[LayerType.TEXT_GLITTER]: 'quickActionAddText',
					[LayerType.SHAPE]: 'quickActionAddShape'
				}
			});

			quickAddOptions.addEventListener('click', (event) => {
				const button = event.target.closest('.layer-type-option');
				if (!button) return;
				this.createLayerByType(button.dataset.layerType);
			});
		}

		// Bottom bar quick-add buttons - create layers directly
		const layersBarAddGlitter = document.getElementById('layersBarAddGlitter');
		const layersBarAddSticker = document.getElementById('layersBarAddSticker');
		const layersBarAddText = document.getElementById('layersBarAddText');

		if (layersBarAddGlitter) {
			layersBarAddGlitter.addEventListener('click', () => {
				this.createLayerByType(LayerType.GLITTER_FILL);
			});
		}

		if (layersBarAddSticker) {
			layersBarAddSticker.addEventListener('click', () => {
				this.createLayerByType(LayerType.STICKER);
			});
		}

		if (layersBarAddText) {
			layersBarAddText.addEventListener('click', () => {
				this.createLayerByType(LayerType.TEXT_GLITTER);
			});
		}

		// Bottom bar action buttons
		const layersBarGoToSelected = document.getElementById('layersBarGoToSelected');
		const layersBarCloneSelected = document.getElementById('layersBarCloneSelected');
		const layersBarDeleteSelected = document.getElementById('layersBarDeleteSelected');
		const layersBarClearAll = document.getElementById('layersBarClearAll');

		if (layersBarGoToSelected) {
			layersBarGoToSelected.addEventListener('click', () => {
				const selectedLayer = this.layerManager.getActiveLayer();
				if (!selectedLayer || selectedLayer.type === LayerType.BASE_IMAGE) return;
				this.layerManager.goToLayerSource(selectedLayer.id);
			});
		}

		if (layersBarCloneSelected) {
			layersBarCloneSelected.addEventListener('click', () => {
				this.cloneSelectedLayers();
			});
		}

		if (layersBarDeleteSelected) {
			layersBarDeleteSelected.addEventListener('click', async () => {
				await this.deleteSelectedLayers();
			});
		}
		layersBarClearAll?.addEventListener('click', () => this.resetAll());

		const multiDuplicateBtn = document.getElementById('multiSelectionDuplicateBtn');
		const multiDeleteBtn = document.getElementById('multiSelectionDeleteBtn');
		this.multiSelectionAlignScope = 'canvas';

		if (multiDuplicateBtn) {
			multiDuplicateBtn.addEventListener('click', () => {
				this.cloneSelectedLayers();
			});
		}

		if (multiDeleteBtn) {
			multiDeleteBtn.addEventListener('click', async () => {
				await this.deleteSelectedLayers();
			});
		}

		document.querySelectorAll('#multiSelectionAlignScope [data-scope]').forEach((button) => button.addEventListener('click', () => {
			this.multiSelectionAlignScope = button.dataset.scope;
			document.querySelectorAll('#multiSelectionAlignScope [data-scope]').forEach((item) => item.classList.toggle('active', item === button));
		}));
		document.querySelectorAll('[data-multi-align]').forEach((button) => button.addEventListener('click', () => {
			const method = this.multiSelectionAlignScope === 'selection' ? 'alignToSelection' : 'alignToCanvas';
			this.groupTransformManager?.[method]?.(button.dataset.multiAlign);
		}));
		document.querySelectorAll('[data-multi-distribute]').forEach((button) => button.addEventListener('click', () => {
			this.groupTransformManager?.distribute(button.dataset.multiDistribute);
		}));
	}

	togglePreview() {
		if (this.autoGlitterManager?.isSessionActive()) return;
		this.showAllLayers = !this.showAllLayers;

		const previewToggle = document.getElementById('previewModeToggle');
		if (previewToggle) {
			previewToggle.classList.toggle('active', !this.showAllLayers);
			previewToggle.setAttribute('aria-pressed', String(!this.showAllLayers));
			const name = previewToggle.querySelector('.name');
			if (name) name.textContent = this.showAllLayers ? 'Show Only Selected Layer' : 'Show All Layers';
		}

		this.updatePreview();
		this.updateActionButtons(); // Updates the button title
	}

	setupPreviewListeners() {
		const previewToggle = document.getElementById('previewModeToggle');
		const transparencyToggle = document.getElementById('transparencyToggle');
		const boundsToggle = document.getElementById('boundsToggle');
		const snappingToggle = document.getElementById('snappingToggle');

		if (previewToggle) {
			previewToggle.addEventListener('click', () => this.togglePreview());
		}

		if (transparencyToggle) {
			transparencyToggle.addEventListener('click', () => {
				const isActive = transparencyToggle.classList.toggle('active');
				this.previewContainer.classList.toggle('transparent-bg', isActive);

				if (isActive) {
					this.updateTransparencyGrid();
				} else {
					this.previewContainer.style.backgroundSize = '';
					this.previewContainer.style.backgroundPosition = '';
				}
			});
		}

		if (boundsToggle) {
			boundsToggle.addEventListener('click', () => {
				const isActive = boundsToggle.classList.toggle('active');
				this.previewContainer.classList.toggle('bounds', isActive);
			});
		}
		if (snappingToggle) {
			snappingToggle.classList.toggle('active', CONFIG.snapping.enabled);
			snappingToggle.addEventListener('click', () => {
				CONFIG.snapping.enabled = !CONFIG.snapping.enabled;
				snappingToggle.classList.toggle('active', CONFIG.snapping.enabled);
				this.clearSmartGuides();
			});
		}

		// In setupEventListeners() or wherever you set up preview container events
		this.previewContainer.addEventListener('pointerdown', (e) => {
			if (e.pointerType === 'touch') {
				return;
			}
			if (e.target.closest('.ui-ignore-gestures')) {
				return;
			}
			if (this.currentTool === ToolType.TEXT) {
				return;
			}
			if (this.currentTool === ToolType.SELECT && this.originalImage && e.button === 0 &&
				!e.altKey &&
				!e.target.closest(TRANSFORMABLE_LAYER_ELEMENT_SELECTOR) &&
				!e.target.closest('.group-transform-handles')) {
				this.startSelectionMarquee(e);
				return;
			}
			// Shape tool: drag out the initial size (Photoshop-style); a plain click
			// with no drag falls back to a default-size shape at the click point.
			if (this.currentTool === ToolType.SHAPE && this.originalImage) {
				this.startShapeDrag(e);
				return;
			}
			this.handlePreviewContainerClick(e);
		});

		this.previewContainer.addEventListener('click', (e) => {
			this.handlePreviewContainerClick(e);
		});

		// Prevent right-click context menu on preview area
		this.previewContainer.addEventListener('contextmenu', (e) => {
			// Always prevent on canvas
			if (e.target === this.previewCanvas || e.target === document.getElementById('maskOverlayCanvas')) {
				e.preventDefault();
				return;
			}

			// When zoom tool is active, prevent anywhere in container for zoom out functionality
			if (this.currentTool === ToolType.ZOOM) {
				e.preventDefault();
			}
		});
	}

	startSelectionMarquee(e) {
		const start = { x: e.clientX, y: e.clientY };
		const additive = e.shiftKey;
		const existingIds = additive ? this.layerManager.getSelectedLayers().map((layer) => layer.id) : [];
		const marquee = document.createElement('div');
		marquee.className = 'selection-marquee ui-ignore-gestures';
		this.previewContainer.appendChild(marquee);
		let didMove = false;
		const update = (ev) => {
			const rect = this.previewContainer.getBoundingClientRect();
			const left = Math.min(start.x, ev.clientX) - rect.left;
			const top = Math.min(start.y, ev.clientY) - rect.top;
			const width = Math.abs(ev.clientX - start.x);
			const height = Math.abs(ev.clientY - start.y);
			didMove = didMove || Math.max(width, height) >= 3;
			marquee.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
		};
		const cleanup = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
			marquee.remove();
		};
		const onMove = (ev) => update(ev);
		const onCancel = () => cleanup();
		const onUp = (ev) => {
			cleanup();
			if (!didMove) {
				this.handlePreviewContainerClick(e);
				return;
			}
			const a = this.viewport.screenToCanvas(start.x, start.y);
			const b = this.viewport.screenToCanvas(ev.clientX, ev.clientY);
			const box = { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
			const hits = this.layerManager.layers.filter((layer) => {
				const ctx = this.getMovableLayerContext(layer);
				const transform = ctx?.manager?.layerTransforms?.get(layer.id);
				if (!transform || !layer.visible || layer.locked) return false;
				const metrics = transform.getFrameMetrics();
				return metrics.maxX >= box.left && metrics.minX <= box.right && metrics.maxY >= box.top && metrics.minY <= box.bottom;
			}).map((layer) => layer.id);
			const ids = [...new Set([...existingIds, ...hits])];
			if (ids.length) this.layerManager.setSelection(ids, { activeLayerId: ids[ids.length - 1], source: 'canvas' });
			else if (!additive) this.layerManager.clearSelection();
			this.ignoreNextClick = true;
			setTimeout(() => { this.ignoreNextClick = false; }, 0);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onCancel);
	}

	// Rubber-band shape creation: drag out the box, release to create a shape of
	// that size (Shift constrains to a square). A negligible drag = a plain click,
	// which makes a default-size shape at the click point.
	beginShapeCreationGesture(clientX, clientY, options = {}) {
		if (!this.originalImage || !this.previewContainer) {
			return false;
		}

		this.cancelShapeCreationGesture();

		const rect = this.previewContainer.getBoundingClientRect();
		const preview = document.createElement('div');
		preview.className = 'shape-drag-preview';
		this.previewContainer.appendChild(preview);

		this.shapeCreationGesture = {
			startCanvas: this.viewport.screenToCanvas(clientX, clientY),
			startScreen: { x: clientX - rect.left, y: clientY - rect.top },
			containerRect: rect,
			preview,
			suppressNextClick: options.suppressNextClick !== false
		};

		return true;
	}

	getShapeCreationBox(clientX, clientY, useCanvas = false, shiftKey = false) {
		const session = this.shapeCreationGesture;
		if (!session) {
			return null;
		}

		const pointA = useCanvas ? session.startCanvas : session.startScreen;
		const pointB = useCanvas
			? this.viewport.screenToCanvas(clientX, clientY)
			: {
				x: clientX - session.containerRect.left,
				y: clientY - session.containerRect.top
			};

		let width = Math.abs(pointB.x - pointA.x);
		let height = Math.abs(pointB.y - pointA.y);
		if (shiftKey) {
			width = Math.max(width, height);
			height = width;
		}

		const left = pointB.x < pointA.x ? pointA.x - width : pointA.x;
		const top = pointB.y < pointA.y ? pointA.y - height : pointA.y;
		return {
			left,
			top,
			width,
			height,
			centerX: left + width / 2,
			centerY: top + height / 2
		};
	}

	updateShapeCreationGesture(clientX, clientY, shiftKey = false) {
		const session = this.shapeCreationGesture;
		if (!session) {
			return;
		}

		const box = this.getShapeCreationBox(clientX, clientY, false, shiftKey);
		if (!box) {
			return;
		}

		session.preview.style.left = `${box.left}px`;
		session.preview.style.top = `${box.top}px`;
		session.preview.style.width = `${box.width}px`;
		session.preview.style.height = `${box.height}px`;
	}

	cancelShapeCreationGesture() {
		const session = this.shapeCreationGesture;
		if (!session) {
			return;
		}

		session.preview?.remove();
		this.shapeCreationGesture = null;
	}

	finishShapeCreationGesture(clientX, clientY, options = {}) {
		const session = this.shapeCreationGesture;
		if (!session) {
			return null;
		}

		const box = this.getShapeCreationBox(clientX, clientY, true, Boolean(options.shiftKey));
		const suppressNextClick = options.suppressNextClick ?? session.suppressNextClick;

		this.cancelShapeCreationGesture();

		if (!box) {
			return null;
		}

		const isClick = Math.max(box.width, box.height) < 6;
		const shapeLayer = isClick
			? {
				shapeId: this.shapeGlitterManager.getActiveShapeId(),
				position: { x: session.startCanvas.x, y: session.startCanvas.y }
			}
			: {
				shapeId: this.shapeGlitterManager.getActiveShapeId(),
				position: { x: box.centerX, y: box.centerY },
				width: box.width,
				height: box.height
			};

		const layer = this.layerManager.addLayer(LayerType.SHAPE, { shapeLayer });

		if (suppressNextClick) {
			this.ignoreNextClick = true;
			setTimeout(() => { this.ignoreNextClick = false; }, 0);
		}

		this.finishLayerCreation(layer);
		return layer;
	}

	startShapeDrag(e) {
		if (this.beginShapeCreationGesture(e.clientX, e.clientY, { shiftKey: e.shiftKey, suppressNextClick: true })) {
			const onMove = (ev) => {
				this.updateShapeCreationGesture(ev.clientX, ev.clientY, ev.shiftKey);
			};

			const onUp = (ev) => {
				window.removeEventListener('pointermove', onMove);
				window.removeEventListener('pointerup', onUp);
				window.removeEventListener('pointercancel', onCancel);
				this.finishShapeCreationGesture(ev.clientX, ev.clientY, {
					shiftKey: ev.shiftKey,
					suppressNextClick: true
				});
			};

			const onCancel = () => {
				window.removeEventListener('pointermove', onMove);
				window.removeEventListener('pointerup', onUp);
				window.removeEventListener('pointercancel', onCancel);
				this.cancelShapeCreationGesture();
			};

			window.addEventListener('pointermove', onMove);
			window.addEventListener('pointerup', onUp);
			window.addEventListener('pointercancel', onCancel);
			return;
		}

		const container = this.previewContainer;
		const rect = container.getBoundingClientRect();
		const startCanvas = this.viewport.screenToCanvas(e.clientX, e.clientY);
		const startScreen = { x: e.clientX - rect.left, y: e.clientY - rect.top };

		const preview = document.createElement('div');
		preview.className = 'shape-drag-preview';
		container.appendChild(preview);

		let lastShift = false;

		const boxFromEvent = (ev, useCanvas) => {
			const a = useCanvas ? startCanvas : startScreen;
			const b = useCanvas
				? this.viewport.screenToCanvas(ev.clientX, ev.clientY)
				: { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
			let w = Math.abs(b.x - a.x);
			let h = Math.abs(b.y - a.y);
			if (ev.shiftKey) { w = h = Math.max(w, h); }
			const left = b.x < a.x ? a.x - w : a.x;
			const top = b.y < a.y ? a.y - h : a.y;
			return { left, top, w, h, cx: left + w / 2, cy: top + h / 2 };
		};

		const onMove = (ev) => {
			lastShift = ev.shiftKey;
			const box = boxFromEvent(ev, false);
			preview.style.left = `${box.left}px`;
			preview.style.top = `${box.top}px`;
			preview.style.width = `${box.w}px`;
			preview.style.height = `${box.h}px`;
		};

		const onUp = (ev) => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			preview.remove();

			const box = boxFromEvent(ev, true);
			const isClick = Math.max(box.w, box.h) < 6;
			// A click: no explicit box → createLayer derives an aspect-correct default
			// size. A drag: pass the drawn box (may stretch, Photoshop-style).
			const shapeLayer = isClick
				? { shapeId: this.shapeGlitterManager.getActiveShapeId(), position: { x: startCanvas.x, y: startCanvas.y } }
				: { shapeId: this.shapeGlitterManager.getActiveShapeId(), position: { x: box.cx, y: box.cy }, width: box.w, height: box.h };

			const layer = this.layerManager.addLayer(LayerType.SHAPE, { shapeLayer });

			// Swallow the click that follows this pointerup so it can't double-create.
			this.ignoreNextClick = true;
			setTimeout(() => { this.ignoreNextClick = false; }, 0);

			this.finishLayerCreation(layer);
		};

		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}

	// ===== GLOBAL LISTENERS =====
	setupGlobalListeners() {
		// Keyboard
		document.addEventListener('keydown', (e) => this.handleKeyboard(e));
		document.addEventListener('keyup', (e) => this.handleKeyUp(e));
		// A keyup can be missed if focus leaves the window mid-drag; clear Shift.
		window.addEventListener('blur', () => { this.shiftHeld = false; });

		// Viewport changes
		window.addEventListener('viewportChanged', () => {
			this.updateZoomUI();
			this.updateTransparencyGrid();
			this.updateStatusBar();
			this.maskEditor?._updateBrushCursorSize();
			this.maskEditor?.renderOverlay();
		});

		// Prevent leaving if unsaved
		window.addEventListener('beforeunload', (e) => {
			if ((this.originalImage || this.historyManager.canUndo()) && !this.isSaved) {
				e.preventDefault();
				e.returnValue = '';
			}
		});

		// Scroll zoom
		this.previewContainer.addEventListener('wheel', (e) => {
			if (!this.originalImage) {
				return;
			}

			e.preventDefault();

			if (e.ctrlKey || e.metaKey) {
				if (e.deltaY < 0) {
					this.viewport.zoomIn(e.clientX, e.clientY);
				} else {
					this.viewport.zoomOut(e.clientX, e.clientY);
				}
				return;
			}

			if (e.shiftKey) {
				this.viewport.panBy(-e.deltaY, 0);
				return;
			}

			this.viewport.panBy(0, -e.deltaY);
		}, { passive: false });
	}

	getResetValueForSlider(sliderId) {
		const resetValues = {
			threshold: CONFIG.tools.selection.defaults.threshold,
			feather: CONFIG.tools.selection.defaults.feather,
			scale: CONFIG.tools.effects.defaults.scale,
			opacity: CONFIG.tools.effects.defaults.opacity,
			glitterHue: CONFIG.tools.glitter.defaults.colorAdjust.hue,
			glitterSaturation: CONFIG.tools.glitter.defaults.colorAdjust.saturation,
			glitterBrightness: CONFIG.tools.glitter.defaults.colorAdjust.brightness
		};
		return resetValues[sliderId];
	}

	updateResetButton(sliderId) {
		const resetBtn = document.getElementById('reset' + sliderId.charAt(0).toUpperCase() + sliderId.slice(1));
		const slider = document.getElementById(sliderId);
		const defaultValue = this.getResetValueForSlider(sliderId);
		if (resetBtn && slider && defaultValue !== undefined) {
			resetBtn.disabled = parseInt(slider.value) === defaultValue;
		}
	}

	async loadBlankImage(width, height, color = CONFIG.canvas.defaults.blankDocument.color, options = {}) {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');

		// Handle transparent background
		if (color === 'transparent') {
			// Leave canvas transparent (don't fill)
		} else {
			ctx.fillStyle = color;
			ctx.fillRect(0, 0, width, height);
		}

		const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
		const fileName = color === 'transparent'
			? `blank_${width}x${height}_transparent.png`
			: `blank_${width}x${height}.png`;
		const file = new File([blob], fileName, { type: 'image/png' });

		await this.loadImageFile(file, {
			...options,
			source: {
				kind: 'preset',
				preset: { width, height, color }
			}
		});
		const baseLayer = this.layers.find((layer) => layer.type === LayerType.BASE_IMAGE);
		const normalizedBase = this.baseBackgroundManager?.normalizeLayer(baseLayer);
		if (normalizedBase) {
			normalizedBase.background.mode = color === 'transparent' ? 'none' : 'solid';
			if (color !== 'transparent') normalizedBase.background.color = color;
			// loadImageFile establishes the new project's initial history snapshot;
			// replace it with the authored background mode, not the PNG transport.
			this.historyManager.reset(this.historyManager.createStateSnapshot());
			this.updatePreview();
			this.layerManager.renderLayersList();
		}
		this.updateStatus(`Created ${width}×${height} canvas`);
		return true;
	}

	setTool(tool, options = {}) {
		if (tool === ToolType.BRUSH && !this.maskEditor?.canActivate()) return;

		if (this.currentTool === tool) return;
		if (this.autoGlitterManager?.isSessionActive() && !this.autoGlitterManager.allowsPreviewTool(tool)) {
			this.pendingAutoGlitterTool = tool;
			if (!this.autoGlitterToolPrompt) {
				const temporaryRequest = this.temporaryHandToolActive;
				this.autoGlitterToolPrompt = this.autoGlitterManager.requestDiscardSession().then((discarded) => {
					const targetTool = this.pendingAutoGlitterTool;
					this.pendingAutoGlitterTool = null;
					this.autoGlitterToolPrompt = null;
					if (!discarded || !targetTool) return;
					if (temporaryRequest && targetTool === ToolType.HAND && !this.temporaryHandToolActive) return;
					this.setTool(targetTool);
				});
			}
			return;
		}

		this.currentTool = tool;
		if (!this.temporaryHandToolActive && options.persist !== false) sessionStorage.setItem('glitter:lastTool', tool);
		this.currentHintDismissed = false; // Reset dismissed flag when tool changes


		// Remove all tool classes from body
		document.body.classList.remove('tool-select', 'tool-text', 'tool-shape', 'tool-hand', 'tool-colorPicker', 'tool-zoom', 'tool-brush');

		// Add current tool class
		document.body.classList.add(`tool-${tool}`);

		// 1. Update Toolbar Buttons
		document.querySelectorAll('.toolbar-group button').forEach(btn => {
			btn.classList.remove('active');
		});

		// Fix: The tool name needs to match the button ID exactly
		const toolButtonIds = {
			'select': 'selectTool',
			'text': 'textTool',
			'shape': 'shapeTool',
			'hand': 'handTool',
			'colorPicker': 'colorPickerTool',
			'brush': 'brushTool',
			'zoom': 'zoomTool'
		};

		const activeBtn = document.getElementById(toolButtonIds[tool]);
		if (activeBtn) {
			activeBtn.classList.add('active');
		}

		// 2. Update Cursors
		if (this.previewContainer) {
			this.previewContainer.classList.remove('zoom-cursor', 'hand-cursor', 'zoom-out-mode');
			if (tool === ToolType.ZOOM) {
				this.previewContainer.classList.add('zoom-cursor');
			} else if (tool === ToolType.HAND) {
				this.previewContainer.classList.add('hand-cursor');
			}
		}

		if (this.previewWrapper) {
			this.previewWrapper.classList.remove('color-picker-mode');
			if (tool === ToolType.COLOR_PICKER) {
				this.previewWrapper.classList.add('color-picker-mode');
			}
		}

		// NEW: Handle transform handles visibility
		this.syncTransformHandlesForActiveLayer();

		// Sync mask editing with the active tool (enter/exit brush painting)
		this.maskEditor?.onToolChanged(tool);

		// 3. Update Context Toolbars
		this.updateContextToolbars();

		// Reconcile the sidebar accordion with the new tool: entering Brush/Eraser
		// opens its Settings; leaving a settings tool returns focus to the selected
		// layer's Properties (or the Gallery). Only on an actual tool change (setTool
		// early-returns when unchanged), so it never fights a manual accordion toggle.
		this.syncCollapsibleSections?.(this.getPreferredDesignSection(this.layerManager.getActiveLayer()));

		// Update helpful message
		this.updateHelpfulMessage();

		this.updateStatus(`Active tool: ${tool}`);

	}


	updateContextToolbars() {
		const brushSettingsSection = document.getElementById('brushSettingsSection');
		const toolbarConfigs = CONFIG.ui.contextToolbars || [];
		const toolbars = toolbarConfigs.map((config) => ({
			config,
			element: document.getElementById(config.id)
		}));

		// Hide all first
		toolbars.forEach(({ element }) => element?.classList.remove('visible'));
		if (brushSettingsSection) brushSettingsSection.classList.remove('visible');
		if (!this.originalImage) return;
		if (this.autoGlitterManager?.isSessionActive() && !this.autoGlitterManager.allowsPreviewTool(this.currentTool)) return;

		const layer = this.layerManager.getActiveLayer();
		const hasMultiSelection = this.layerManager.hasMultiSelection();
		const activeToolbar = toolbars.find(({ config, element }) => {
			if (!element || config.tool !== this.currentTool) return false;
			if (hasMultiSelection && config.allowMultiSelection) return true;
			if (config.layerTypes && (!layer || !config.layerTypes.includes(layer.type))) return false;
			if (config.requiresStickerSource && layer?.type === LayerType.STICKER && !layer.stickerSourceId) return false;
			if (config.requiresSelections && !layer?.selections?.length) return false;
			return true;
		});

		activeToolbar?.element.classList.add('visible');
		if (activeToolbar?.config.id === 'layerCenterControls') {
			const canTransformSelection = (hasMultiSelection && this.layerManager.canTransformMultiSelection()) || Boolean(
				layer
				&& isTransformableLayerType(layer.type)
				&& !layer.locked
				&& (layer.type !== LayerType.STICKER || layer.stickerSourceId)
			);
			['centerLayerHorizontal', 'centerLayerVertical', 'duplicateLayerSelection'].forEach((id) => {
				const button = document.getElementById(id);
				if (button) button.hidden = !canTransformSelection;
			});
		}

		if (this.currentTool === ToolType.SELECT && layer?.type === LayerType.STICKER && !hasMultiSelection) {
			if (layer.stickerSourceId) {
				this.hideStickerSettingsEmptyState();
				this.loadStickerSettings(layer);
			} else {
				this.showStickerSettingsEmptyState();
			}
		}
		if (activeToolbar?.config.id === 'colorPickerControls') this.updateColorPickerControls();

		if (this.currentTool === ToolType.BRUSH) {
			if (brushSettingsSection) {
				brushSettingsSection.classList.add('visible');
				this.syncCollapsibleSections?.('brushSettings');
			}
		}

		// On mobile the brush settings section is tool-scoped, so relocate it into
		// the settings drawer while brushing instead of letting it show in the
		// Design drawer (it keeps the .visible class set/cleared just above).
		this.mobileManager?.syncBrushSettingsPlacement?.();
	}

	// ===== HELPFUL MESSAGES =====

	updateHelpfulMessage() {
		const message = document.getElementById('helpfulMessage');
		const text = document.getElementById('helpfulMessageText');
		const description = document.getElementById('helpfulMessageDescription');
		const toolLabel = document.getElementById('helpfulMessageTool');
		const toolIcon = document.getElementById('helpfulMessageToolIcon');
		const toolName = document.getElementById('helpfulMessageToolName');
		const activeLayer = this.layerManager.getActiveLayer();
		const currentTool = this.currentTool;
		const isMobile = this.mobileManager && this.mobileManager.isMobile;

		// Check if hints are enabled
		if (!this.showHints) {
			message.classList.remove('visible');
			return;
		}

		// Don't show hints before image is loaded
		if (!this.originalImage) {
			message.classList.remove('visible');
			return;
		}

		let hint = '';
		let context = '';
		let showTool = false;
		let toolIconId = '';
		let toolLabelText = '';

		// Map tool to icon and name
		const getToolInfo = (tool) => {
			const toolMap = {
				[ToolType.SELECT]: { icon: 'icon-hand-pointer', name: 'Select Tool' },
				[ToolType.TEXT]: { icon: 'icon-hand-pointer', name: 'Text Tool' },
				[ToolType.SHAPE]: { icon: 'icon-square', name: 'Shape Tool' },
				[ToolType.COLOR_PICKER]: { icon: 'icon-paint-bucket', name: 'Color Fill' },
				[ToolType.BRUSH]: this.maskEditor?.mode === 'sub'
					? { icon: 'icon-eraser', name: 'Eraser Tool' }
					: { icon: 'icon-brush', name: 'Mask Brush' },
				[ToolType.HAND]: { icon: 'icon-hand', name: 'Hand Tool' },
				[ToolType.ZOOM]: { icon: 'icon-magnifying-glass', name: 'Zoom Tool' }
			};
			return toolMap[tool] || { icon: '', name: '' };
		};

		// PRIORITY 1: Critical layer states (don't show tool label for these)
		if (this.maskEditor?.isEditing && activeLayer?.type === LayerType.GLITTER_FILL) {
			showTool = true;
			if (isMobile) {
				hint = this.maskEditor.mode === 'sub'
					? 'Drag to erase glitter from this layer'
					: 'Drag to paint glitter directly onto this layer';
				context = 'Tap once for a single stamp. Use two fingers to pan or zoom, and switch Paint/Erase to add or remove glitter.';
			} else {
				hint = this.maskEditor.mode === 'sub'
					? 'Drag to erase glitter from this layer'
					: 'Drag to paint glitter directly onto this layer';
				context = 'Press X to swap Paint/Erase, use [ or ] to resize the brush, and press Esc or change tools to exit the Mask Brush.';
			}
		}
		else if (this.maskEditor?.isEditing) {
			showTool = true;
			if (this.maskEditor.mode === 'sub') {
				hint = 'Select a glitter layer to erase from';
				context = 'There\'s nothing here for the Eraser to remove.';
			} else {
				hint = isMobile
					? 'Drag here to create a new glitter layer and start painting'
					: 'Paint here to create a new glitter layer automatically';
				context = 'The Mask Brush targets glitter layers. Starting a stroke on another layer creates a new glitter layer for you.';
			}
		}

		else if (this.isLayerContentLocked(activeLayer)) {
			hint = 'This layer is locked';
			context = 'Its settings are available to inspect. Unlock it in the Layers panel to make changes.';
		}
		else if (activeLayer && activeLayer.type === LayerType.STICKER && !activeLayer.stickerSourceId) {
			hint = 'No sticker chosen—select a sticker from the gallery to place on your canvas';
		}
		else if (activeLayer && activeLayer.type === LayerType.TEXT_GLITTER && !activeLayer.textData.text.trim()) {
			hint = 'This text layer is empty - type something in the Text section to reveal the glitter fill';
			context = 'Choose a font, adjust spacing and alignment, and pick a glitter in the browser for the fill.';
		}
		else if (activeLayer && activeLayer.type === LayerType.GLITTER_FILL &&
			hasMaskContent(activeLayer) &&
			!activeLayer.selectedGlitterId) {
			hint = 'No glitter selected—choose a glitter style from the gallery to apply it';
		}
		else if (activeLayer && activeLayer.type === LayerType.GLITTER_FILL &&
			!hasMaskContent(activeLayer) &&
			currentTool !== ToolType.COLOR_PICKER) {
			hint = isMobile
				? 'This glitter layer is empty—use the color fill or Mask Brush to add glitter'
				: 'This glitter layer is empty—use the Color Fill or Mask Brush to add glitter';
			context = isMobile
				? 'Tap colors to build a selection, or paint directly in the editor.'
				: 'Click colors to build a selection, or paint directly with the Mask Brush.';
		}

		// PRIORITY 2: Tool-specific actions (SHOW tool label for these)

		else if (currentTool === ToolType.ZOOM) {
			showTool = true;
			if (isMobile) {
				hint = 'Pinch to zoom in and out';
			} else {
				hint = 'Click to zoom in • Shift+click to zoom out';
			}
		}

		else if (currentTool === ToolType.HAND) {
			showTool = true;
			if (isMobile) {
				hint = 'Use one or two fingers to pan around the canvas';
			} else {
				hint = 'Click and drag to move around the canvas';
			}
		}

		else if (currentTool === ToolType.TEXT) {
			showTool = true;
			hint = 'Click empty canvas space to create a point-text layer';
			context = 'The click becomes the text anchor. Existing layers stay put until you switch back to Select.';
		}

		else if (currentTool === ToolType.SHAPE) {
			showTool = true;
			hint = 'Drag on the canvas to draw a shape at that size';
			context = 'Hold Shift to keep it square. A single click makes a default-size shape. Pick the shape and its fill/border/shadow in Shape Properties.';
		}

		else if (currentTool === ToolType.BRUSH) {
			showTool = true;
			hint = this.maskEditor?.mode === 'sub'
				? 'Select a glitter layer, then drag to erase glitter'
				: 'Select a glitter layer, then drag to paint glitter';
			context = 'Press X to swap Paint and Erase. Use [ or ] to resize the brush.';
		}

		else if (currentTool === ToolType.COLOR_PICKER) {
			showTool = true;
			if (!activeLayer || activeLayer.type === LayerType.BASE_IMAGE) {
				hint = 'Click anywhere on your image to create a glitter fill layer';
				context = 'Glitter fills are based on color selection from your base image.';
			} else if (activeLayer.type === LayerType.GLITTER_FILL) {
				if (!hasMaskContent(activeLayer)) {
					if (!activeLayer.selectedGlitterId) {
						hint = 'Choose a glitter style from the gallery, then click colors or paint to fill';
					} else {
						hint = 'Click colors on your image to select areas for glitter, or use the Mask Brush (B) to paint directly';
						context = 'Threshold determines how similar colors need to be to get selected together.';
					}
				} else if (document.getElementById('multiSelect')?.checked && activeLayer.selections.length === 1) {
					hint = 'Multi-select is on—click more colors to expand your selection';
				} else {
					hint = 'Click again to change the color selection, or adjust settings to refine';
					context = 'Threshold controls color tolerance. Feather softens edges.';
				}
			} else if (activeLayer.type === LayerType.STICKER) {
				hint = 'Switch to select tool to move stickers, or add a glitter layer';
			} else if (activeLayer.type === LayerType.TEXT_GLITTER) {
				hint = 'Switch to the Select tool to move glitter text, or choose a glitter in the browser for the fill';
			}
		}

		else if (currentTool === ToolType.SELECT) {
			showTool = true;
			if (!activeLayer) {
				hint = 'Add a sticker layer to move items around, or use color fill for glitter';
			} else if (activeLayer.type === LayerType.STICKER && activeLayer.stickerSourceId) {
				if (isMobile) {
					hint = 'Drag to move, pinch to scale and rotate';
					context = 'Or tap settings button to adjust position, flip, and opacity.';
				} else {
					hint = 'Drag to move your sticker';
					context = 'Use the settings panel to rotate, scale, flip, or adjust opacity.';
				}
			} else if (activeLayer.type === LayerType.TEXT_GLITTER) {
				if (isMobile) {
					hint = 'Drag to move, pinch to scale and rotate your glitter text';
					context = 'Use the Text section for copy, font, alignment, texture scale, and opacity.';
				} else {
					hint = 'Drag to move your glitter text';
					context = 'Use the Text section to change the copy, font, size, spacing, alignment, and fill texture.';
				}
			} else if (activeLayer.type === LayerType.GLITTER_FILL || activeLayer.type === LayerType.BASE_IMAGE) {
				hint = 'Switch to the color fill or Mask Brush to add or modify glitter, or add a sticker layer';
			}
		}

		// PRIORITY 3: Enhancement tips (don't show tool label)

		else if (activeLayer && activeLayer.type === LayerType.GLITTER_FILL &&
			hasMaskContent(activeLayer) &&
			activeLayer.selectedGlitterId) {
			if (isMobile) {
				hint = 'Tap settings to adjust scale, opacity, or refine your selection';
				context = 'Threshold controls color tolerance—higher values select more similar colors.';
			} else {
				hint = 'Use the settings panel to adjust scale, opacity, threshold, or feather — or paint with the Mask Brush';
				context = 'Threshold controls color tolerance. Feather softens edges. The Mask Brush adds painted detail.';
			}
		} else if (activeLayer && activeLayer.type === LayerType.TEXT_GLITTER && activeLayer.textData.text.trim()) {
			hint = 'Use the Text section to edit the copy, font, spacing, and alignment';
			context = 'The glitter browser controls the fill, and texture scale and opacity change the motion inside the letters.';
		}

		// Update tool label
		if (showTool && toolLabel && toolIcon && toolName) {
			const toolInfo = getToolInfo(currentTool);
			toolIcon.setAttribute('href', `#${toolInfo.icon}`);
			toolName.textContent = toolInfo.name;
			toolLabel.style.display = 'flex';
		} else if (toolLabel) {
			toolLabel.style.display = 'none';
		}

		// Update visibility and text
		if (hint && !this.currentHintDismissed) {
			text.textContent = hint;
			description.textContent = context;
			message.classList.add('visible');
		} else {
			message.classList.remove('visible');
		}
	}


	setupHelpfulMessageListeners() {
		const helpfulMessage = document.getElementById('helpfulMessage');

		// Prevent clicks from propagating to canvas/tools below
		if (helpfulMessage) {
			helpfulMessage.addEventListener('mousedown', (e) => {
				e.stopPropagation();
			});
			helpfulMessage.addEventListener('pointerdown', (e) => {
				e.stopPropagation();
			});

			// CLICK-TO-DISMISS: Click anywhere on message to dismiss
			// EXCEPT on the "Don't show hints" button
			helpfulMessage.addEventListener('click', (e) => {
				e.stopPropagation();

				// Don't dismiss if clicking the "Don't show hints" button
				if (e.target.closest('#helpfulMessageDisable')) {
					return; // Let the button handle it
				}

				// Dismiss the current hint
				this.currentHintDismissed = true;
				helpfulMessage.classList.remove('visible');
			});
		}

		// Close button - now redundant but keep for explicit close action
		const closeBtn = document.getElementById('helpfulMessageClose');
		if (closeBtn) {
			closeBtn.addEventListener('click', (e) => {
				e.stopPropagation(); // Prevent double-handling

				// Dismiss the current hint
				this.currentHintDismissed = true;
				helpfulMessage.classList.remove('visible');

				// The parent click handler will dismiss
			});
		}

		// Disable button - turn off hints entirely
		const disableBtn = document.getElementById('helpfulMessageDisable');
		if (disableBtn) {
			disableBtn.addEventListener('click', (e) => {
				e.stopPropagation(); // Prevent the parent click handler

				// Disable hints
				this.showHints = false;

				// Update checkbox in settings
				const showHintsInput = document.getElementById('showHelpfulHints');
				if (showHintsInput) {
					showHintsInput.checked = false;
				}

				// Save to storage
				this.saveSettingsToStorage();

				// Hide message
				helpfulMessage.classList.remove('visible');
			});
		}
	}

	updateColorPickerControls() {
		dbg(`Updating color picker controls`);
		const layer = this.layerManager.getActiveLayer();
		if (!layer || layer.type !== LayerType.GLITTER_FILL) return;

		dbg(`Updating color picker controls for layer ${layer.id}`);

		const contextThreshold = document.getElementById('contextThreshold');
		const contextThresholdValue = document.getElementById('contextThresholdValue');
		const contextMultiSelect = document.getElementById('contextMultiSelect');
		const contextContiguous = document.getElementById('contextContiguous');
		const contextSelectionCount = document.getElementById('contextSelectionCount');

		if (contextThreshold && contextThresholdValue) {
			contextThreshold.value = layer.settings.threshold;
			contextThresholdValue.textContent = layer.settings.threshold;
		}

		if (contextMultiSelect) {
			contextMultiSelect.checked = layer.settings.multiSelect;
		}

		if (contextContiguous) {
			contextContiguous.checked = layer.settings.contiguous;
		}

		if (contextSelectionCount) {
			const count = layer.selections ? layer.selections.length : 0;
			contextSelectionCount.textContent = count > 1 ? count : '';
		}
	}

	handleKeyUp(e) {
		this.shiftHeld = e.shiftKey;
		if (e.code === 'Space' && this.temporaryHandToolActive) {
			this.endTemporaryHandTool();
		}
		if (e.key === 'Alt') {
			if (this.currentTool === ToolType.ZOOM) {
				this.previewContainer.classList.remove('zoom-out-mode');
			}
		}
	}

	endTemporaryHandTool() {
		if (!this.temporaryHandToolActive) return;
		this.temporaryHandToolActive = false;
		if (this.currentTool === ToolType.HAND) {
			this.setTool(this.toolBeforeTemporaryHand || ToolType.SELECT);
		}
		this.toolBeforeTemporaryHand = null;
	}

	handleKeyboard(e) {
		// Track Shift so slider drags (which fire modifier-less 'input' events) can
		// snap — mirrors the rotation handle's Shift-to-snap.
		this.shiftHeld = e.shiftKey;

		// Don't trigger shortcuts when typing in input fields
		const activeElement = document.activeElement;
		const isTyping = activeElement && (
			activeElement.tagName === 'INPUT' ||
			activeElement.tagName === 'TEXTAREA' ||
			activeElement.isContentEditable
		);

		if (e.code === 'Space' && !isTyping && !e.repeat && this.originalImage && !this.temporaryHandToolActive) {
			e.preventDefault();
			this.toolBeforeTemporaryHand = this.currentTool;
			this.temporaryHandToolActive = true;
			this.setTool(ToolType.HAND);
			return;
		}

		// Arrow keys nudge the selected movable layer (sticker/text/shape) before
		// the typing guard runs: a selected layer treats arrows as "move me", the
		// sticker behavior. If focus is parked in the text layer's own content field
		// (post-create / post-edit), blur it so moving takes over — the same as
		// clicking off the field. Arrows in any OTHER input still fall through to the
		// guard for normal caret navigation.
		if (!this.autoGlitterManager?.isSessionActive() && this.tryArrowNudge(e)) return;

		// Allow Escape to work in inputs (to blur/close things)
		// Allow Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl/Cmd+S while typing.
		const isDocumentShortcut = (e.ctrlKey || e.metaKey) &&
			(e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y' || e.key === 's' || e.key === 'S');
		if (isTyping && e.key !== 'Escape' &&
			!isDocumentShortcut) {
			return;
		}

		if (e.key === 'Alt' && this.currentTool === ToolType.ZOOM) {
			this.previewContainer.classList.add('zoom-out-mode');
		}

		if (e.key === 'Escape') {
			if (this.autoGlitterManager?.isSessionActive()) {
				this.autoGlitterManager.requestDiscardSession();
				e.preventDefault();
				return;
			}
			const activeGradientEditor = document.activeElement?.closest?.('.effect-gradient-editor');
			if (activeGradientEditor) {
				document.activeElement.blur();
				e.preventDefault();
				return;
			}
			const glitterPickerOpen = Boolean(this.glitterManager?.hasActivePickerSession?.());
			const textPickerOpen = Boolean(this.textGlitterManager?.pickerSession);
			const shapePickerOpen = Boolean(this.shapeGlitterManager?.pickerSession);
			const stickerPickerOpen = Boolean(this.stickerManager?.pickerSession);
			if (glitterPickerOpen || textPickerOpen || shapePickerOpen || stickerPickerOpen) {
				if (glitterPickerOpen) this.glitterManager.handlePickerDone();
				if (textPickerOpen) {
					const slot = this.textGlitterManager.pickerSession.slot;
					this.textGlitterManager.closePickerSession();
					this.textGlitterManager.returnToTextProperties(slot);
				}
				if (shapePickerOpen) this.shapeGlitterManager.handlePickerDone();
				if (stickerPickerOpen) {
					this.stickerManager.closePicker();
				}
				e.preventDefault();
				return;
			}
			// Let ModalManager handle modal closing
			if (this.modalManager.closeTopModal()) {
				return; // A modal was closed, we're done
			}

			const activeLayer = this.layerManager.getActiveLayer();
			const activeTransform = this.getMovableLayerContext(activeLayer)?.manager?.layerTransforms?.get(activeLayer?.id);
			if (this.groupTransformManager?.cancelActiveDrag?.() || activeTransform?.cancelActiveDrag?.()) {
				e.preventDefault();
				return;
			}

			// No modal was open, switch to select tool
			if (this.layerManager.hasMultiSelection()) this.layerManager.clearSelection();
			this.setTool(ToolType.SELECT);
		}

		if (this.autoGlitterManager?.isSessionActive()) {
			let handled = true;
			if (e.key === 'h' || e.key === 'H') this.setTool(ToolType.HAND);
			else if (!e.ctrlKey && !e.metaKey && (e.key === 'z' || e.key === 'Z')) this.setTool(ToolType.ZOOM);
			else if ((e.ctrlKey || e.metaKey) && e.key === '0') this.viewport.zoomToFit({ animate: true });
			else if ((e.ctrlKey || e.metaKey) && e.key === '1') this.viewport.resetZoom({ animate: true });
			else if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) this.viewport.zoomIn(null, null, { animate: true });
			else if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) this.viewport.zoomOut(null, null, { animate: true });
			else handled = false;
			if (handled || ((e.ctrlKey || e.metaKey) && /[aszy]/i.test(e.key))) e.preventDefault();
			return;
		}

		if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
			e.preventDefault();
			const ids = this.layerManager.layers.filter((layer) => !layer.locked && layer.type !== LayerType.BASE_IMAGE).map((layer) => layer.id);
			if (ids.length) this.layerManager.setSelection(ids, { activeLayerId: ids[ids.length - 1] });
			return;
		}


		if (e.key === 'v' || e.key === 'V') this.setTool(ToolType.SELECT);
		if (e.key === 't' || e.key === 'T') {
			if (this.originalImage) this.setTool(ToolType.TEXT);
		}
		if (e.key === 'i' || e.key === 'I') {
			if (this.originalImage) this.setTool(ToolType.COLOR_PICKER);
		}
		if (e.key === 'b' || e.key === 'B') {
			this.setTool(ToolType.BRUSH); // setTool no-ops if brush can't activate
			this.maskEditor?.setMode('add');
		}
		if (e.key === 'e' || e.key === 'E') {
			// Eraser is the Brush tool in 'sub' mode (shares ToolType.BRUSH).
			this.setTool(ToolType.BRUSH);
			this.maskEditor?.setMode('sub');
		}
		if (e.key === 'u' || e.key === 'U') {
			if (this.originalImage) this.setTool(ToolType.SHAPE);
		}
		if (e.key === 'h' || e.key === 'H') {
			if (this.originalImage) this.setTool(ToolType.HAND);
		}
		if (e.key === 'z' || e.key === 'Z') {
			if (!e.ctrlKey && !e.metaKey && this.originalImage) this.setTool(ToolType.ZOOM);
		}

		if (this.currentTool === ToolType.BRUSH && !e.ctrlKey && !e.metaKey && !e.altKey) {
			if (e.key === 'x' || e.key === 'X') {
				e.preventDefault();
				this.maskEditor?.toggleMode();
				return;
			}

			if (e.code === 'BracketLeft') {
				e.preventDefault();
				this.maskEditor?.adjustBrushSize(e.shiftKey ? -10 : -5);
				return;
			}

			if (e.code === 'BracketRight') {
				e.preventDefault();
				this.maskEditor?.adjustBrushSize(e.shiftKey ? 10 : 5);
				return;
			}
		}

		// Delete or Backspace: Delete selected layer
		if (e.key === 'Delete' || e.key === 'Backspace') {
			const selectedLayers = this.getSelectedActionableLayers();

			// Only delete if a layer is selected and it's not the base image
			if (selectedLayers.length) {
				e.preventDefault(); // Prevent browser back navigation on Backspace

				this.deleteSelectedLayers();
			}
			return;
		}

		// Ctrl/Cmd+D: duplicate the selected layer
		if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
			const selectedLayers = this.getSelectedActionableLayers();
			if (selectedLayers.length) {
				e.preventDefault(); // Prevent the browser's "bookmark this page" dialog
				this.cloneSelectedLayers();
			}
			return;
		}

		if (this.originalImage) {
			if ((e.ctrlKey || e.metaKey) && e.key === '0') {
				e.preventDefault();
				this.viewport.zoomToFit({ animate: true });
			}
			if ((e.ctrlKey || e.metaKey) && e.key === '1') {
				e.preventDefault();
				this.viewport.resetZoom({ animate: true });
			}
			if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
				e.preventDefault();
				this.viewport.zoomIn(null, null, { animate: true });
			}
			if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
				e.preventDefault();
				this.viewport.zoomOut(null, null, { animate: true });
			}
		}

		if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
			e.preventDefault();
			this.saveProjectFile();
			return;
		}

		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
			e.preventDefault();
			this.undo();
		}

		if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'Z' || e.key === 'z')) {
			e.preventDefault();
			this.redo();
		}

		if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
			e.preventDefault();
			this.redo();
		}
	}

	// Arrow-key nudge for the selected movable layer (1px, 10px with Shift).
	// Returns true when it handled the key. Runs ahead of the typing guard so a
	// selected text/shape layer moves like a sticker; the text content field is
	// blurred on the first nudge so continued typing needs a deliberate refocus.
	// Any other focused input keeps its arrows (returns false, falls through).
	tryArrowNudge(e) {
		if (this.currentTool !== ToolType.SELECT) return false;
		if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' &&
			e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false;

		const hasMultiSelection = this.layerManager.hasMultiSelection();
		if (hasMultiSelection && !this.layerManager.canTransformMultiSelection()) {
			e.preventDefault();
			this.updateStatus('This selection cannot move because it includes a locked, Base Image, or Glitter Fill layer');
			return true;
		}
		const layer = this.layerManager.getActiveLayer();
		const ctx = this.getMovableLayerContext(layer);
		const transform = this.getLayerTransformData(layer);
		if (!hasMultiSelection && (!ctx || !ctx.manager || !transform || this.isLayerContentLocked(layer))) return false;

		// Only override input focus for the text layer's own content field —
		// leave unrelated inputs (search boxes, numeric fields) to their carets.
		const active = document.activeElement;
		const isField = active && (active.tagName === 'INPUT' ||
			active.tagName === 'TEXTAREA' || active.isContentEditable);
		if (isField) {
			if (active !== this.textGlitterManager?.ui?.textInput) return false;
			active.blur();
		}

		e.preventDefault();
		const step = e.shiftKey ? 10 : 1;
		const deltaX = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
		const deltaY = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;

		if (hasMultiSelection) {
			this.groupTransformManager?.nudge(deltaX, deltaY);
		} else {
			ctx.manager.updateTransform(layer.id, {
				position: {
					x: transform.position.x + deltaX,
					y: transform.position.y + deltaY
				}
			});

			this.loadTransformSettings(layer, ctx.prefix);
		}
		this.scheduleNudgeSave();
		return true;
	}

	// Collapses a burst of arrow-key nudges (held key / rapid presses) into a
	// single history entry, the same debounce pattern sliders use.
	scheduleNudgeSave() {
		clearTimeout(this._nudgeSaveTimer);
		this._nudgeSaveTimer = setTimeout(() => this.saveState(), CONFIG.tools.selection.timing.sliderDebounceMs);
	}

	// ===== HISTORY =====

	saveState() {
		this.historyManager.saveState();
	}

	async restoreState(state) {
		await this.historyManager.restoreState(state);
	}
	async undo() {
		await this.historyManager.undo();
	}

	async redo() {
		await this.historyManager.redo();
	}

	updateHistoryButtons() {
		this.historyManager.updateButtons();
	}

	updateActionButtons() {
		const hasImage = this.originalImage !== null;
		const autoPreviewActive = Boolean(this.autoGlitterManager?.isSessionActive());

		const hasAnySelection = this.layers.some((layer) => layerHasVisibleContent(layer));
		const selectedLayer = this.layerManager.getActiveLayer();
		const canSoloSelectedLayer = Boolean(selectedLayer?.visible && layerHasVisibleContent(selectedLayer));

		const clearAllTool = document.getElementById('clearAllTool');
		const layersBarClearAll = document.getElementById('layersBarClearAll');
		const exportGif = document.getElementById('exportGif');
		const saveProject = document.getElementById('saveProject');
		const selectTool = document.getElementById('selectTool');
		const textTool = document.getElementById('textTool');
		const shapeTool = document.getElementById('shapeTool');
		const colorPickerTool = document.getElementById('colorPickerTool');
		const handTool = document.getElementById('handTool');
		const zoomTool = document.getElementById('zoomTool');
		const brushTool = document.getElementById('brushTool');
		const eraserTool = document.getElementById('eraserTool');
		const zoomControls = document.getElementById('zoomControls');
		const addBtn = document.getElementById('addLayerBtn');
		const previewToggle = document.getElementById('previewModeToggle');
		const transparencyToggle = document.getElementById('transparencyToggle');
		const boundsToggle = document.getElementById('boundsToggle');

		// --- Reference the container ---
		const previewControls = document.getElementById('previewControls');

		if (clearAllTool) clearAllTool.disabled = !hasImage || autoPreviewActive;
		if (layersBarClearAll) layersBarClearAll.disabled = !hasImage || autoPreviewActive;
		if (exportGif) exportGif.disabled = !hasAnySelection || autoPreviewActive;
		if (saveProject) saveProject.disabled = !hasImage || autoPreviewActive;

		if (transparencyToggle) transparencyToggle.disabled = !hasImage;
		if (boundsToggle) boundsToggle.disabled = !hasImage;

		// --- Toggle visibility of the controls container ---
		if (previewControls) {
			if (hasImage) {
				previewControls.classList.add('visible');
			} else {
				previewControls.classList.remove('visible');
			}
		}

		if (selectTool) selectTool.disabled = !hasImage || autoPreviewActive;
		if (textTool) textTool.disabled = !hasImage || autoPreviewActive;
		if (shapeTool) shapeTool.disabled = !hasImage || autoPreviewActive;
		if (colorPickerTool) colorPickerTool.disabled = !hasImage || autoPreviewActive;
		if (handTool) handTool.disabled = !hasImage;
		if (zoomTool) zoomTool.disabled = !hasImage;
		this.maskEditor?.updateToolButtonState();
		if (brushTool) brushTool.disabled ||= autoPreviewActive;
		if (eraserTool) eraserTool.disabled ||= autoPreviewActive;
		const layersPanel = document.getElementById('layersPanel');
		if (layersPanel) layersPanel.inert = autoPreviewActive;

		// UX: Can't add layers until image is loaded
		if (addBtn) {
			addBtn.disabled = !hasImage || autoPreviewActive || this.layers.length >= CONFIG.app.limits.maxLayers;
			if (!hasImage) {
				addBtn.title = 'Load an image first';
			} else if (autoPreviewActive) {
				addBtn.title = 'Exit Auto Glitter before adding layers';
			} else if (this.layers.length >= CONFIG.app.limits.maxLayers) {
				addBtn.title = `Maximum ${CONFIG.app.limits.maxLayers} layers`;
			} else {
				addBtn.title = 'Add new layer';
			}

			if (!addBtn.disabled) {
				addBtn.classList.add('visible');
			} else {
				addBtn.classList.remove('visible');
			}
		}

		// UX: Disable preview toggle when no selections
		if (previewToggle) {
			previewToggle.disabled = autoPreviewActive || (this.showAllLayers && !canSoloSelectedLayer);
			if (autoPreviewActive) {
				previewToggle.title = 'Layer preview controls are unavailable in Auto Glitter';
			} else if (this.showAllLayers && !canSoloSelectedLayer) {
				previewToggle.title = 'Select a visible layer first';
			} else if (this.showAllLayers) {
				previewToggle.title = 'Show only selected layer';
			} else {
				previewToggle.title = 'Show all layers';
			}
		}

		// UX: Update export tooltip
		if (exportGif) {
			if (autoPreviewActive) {
				exportGif.title = 'Create or exit the Auto Glitter preview before exporting';
			} else if (!hasAnySelection) {
				exportGif.title = 'Add glitter or stickers first';
			} else {
				exportGif.title = 'Export GIF';
			}
		}
	}

	async resetAll() {
		if (!this.originalImage) return;

		const confirmed = await this.confirmAction({
			title: 'Clear All',
			message: 'The image and all layers will be cleared.',
			confirmLabel: 'Clear All',
			destructive: true
		});
		if (confirmed) {
			this.clearImage();
		}
	}

	clearImage() {
		if (this.autoGlitterManager?.isSessionActive()) this.autoGlitterManager.endSessionUI();

		// ======================
		// Core image + data state
		// ======================
		this.exporter?.clearPreviewBlobUrl?.();
		if (this.originalImage && this.originalImage.src.startsWith('blob:')) {
			URL.revokeObjectURL(this.originalImage.src);
		}
		this.originalImage = null;
		this.originalImageData = null;
		this.originalAlphaChannel = null;
		this.baseImageSource = null;
		this.maskEditor?.exitEditMode({ commitStroke: false });
		this.layerManager.clearBaseImageSwatchCache();

		if (this.glitterManager) {
			this.layerManager.layers.forEach(layer => {
				this.glitterManager.releaseLayerResources(layer);
			});
			this.glitterManager.clearAllPaintData();
		}

		this.layerManager.layers = [];
		this.layerManager.activeLayerId = null;

		// Reset history — old states reference layers of the removed image
		this.historyManager.reset();

		// ======================
		// Preview + canvas state
		// ======================
		this.previewWrapper.classList.remove('hasImage');
		this.previewCanvas.classList.remove('selected');
		this.originalCanvas.classList.remove('visible');

		this.clearPreview();
		this.canvasElementsContainer.innerHTML = '';

		// ======================
		// Upload / dropzone UI
		// ======================
		document.getElementById('imageUpload').value = '';
		document.getElementById('imageDropzone').classList.remove('has-image');
		document.getElementById('dropzoneContent').classList.add('visible');

		// ======================
		// Preview container toggles
		// ======================
		this.previewContainer.classList.remove('transparent-bg', 'bounds');
		this.previewContainer.style.backgroundSize = '';
		this.previewContainer.style.backgroundPosition = '';

		const transparencyToggle = document.getElementById('transparencyToggle');
		if (transparencyToggle) transparencyToggle.classList.remove('active');

		const boundsToggle = document.getElementById('boundsToggle');
		if (boundsToggle) boundsToggle.classList.remove('active');

		const previewControls = document.getElementById('previewControls');
		if (previewControls) previewControls.classList.remove('visible');

		// ======================
		// Side panels & empty states
		// ======================
		this.updateSidePanelUI(null);

		this.showLayerSettingsEmptyState();
		this.showGlitterSettingsEmptyState();
		this.collapseLayerSettings();
		this.collapseGlitterSettings();

		// ======================
		// Selected colors
		// ======================
		document.getElementById('selectedColorsEmpty').classList.add('visible');
		document.getElementById('selectedColorsDisplay').innerHTML = '';

		// ======================
		// Managers & viewport
		// ======================
		this.glitterManager.clearFilters();
		this.viewport.resetViewport();
		this.updateZoomUI();
		this.setProjectName('', { markDirty: false });

		// ======================
		// UI refresh + tool state
		// ======================
		this.updateHelpfulMessage();
		this.layerManager.renderLayersList();
		this.updateHistoryButtons();
		this.updateActionButtons();

		this.setTool(ToolType.SELECT);
		this.updateStatus('Load an image to begin');
		this.updateStatusBar();

		// ======================
		// Global event
		// ======================
		window.dispatchEvent(new Event('imageRemoved'));
	}


	debouncedSliderUpdate() {
		clearTimeout(this.sliderTimeout);
		this.sliderTimeout = setTimeout(() => {
			this.updatePreview();
		}, CONFIG.tools.selection.timing.sliderDebounceMs);
	}


	// ===== IMAGE LOADING =====
	async replaceBaseImageFile(file) {
		if (!file || !this.originalImageData) return false;
		if (file.size > CONFIG.canvas.limits.maxFileSizeMB * 1024 * 1024) {
			this.showError(`Image too large. Maximum size is ${CONFIG.canvas.limits.maxFileSizeMB}MB`);
			return false;
		}
		const objectUrl = URL.createObjectURL(file);
		const image = await new Promise((resolve) => {
			const next = new Image();
			next.onload = () => resolve(next);
			next.onerror = () => resolve(null);
			next.src = objectUrl;
		});
		if (!image) {
			URL.revokeObjectURL(objectUrl);
			this.showError('Could not load that image. The file may be corrupt or unsupported.');
			return false;
		}
		if (this.autoGlitterManager?.isSessionActive()) this.autoGlitterManager.endSessionUI();
		let width = image.width;
		let height = image.height;
		if (width > CONFIG.canvas.limits.maxWidth || height > CONFIG.canvas.limits.maxHeight) {
			const scale = Math.min(CONFIG.canvas.limits.maxWidth / width, CONFIG.canvas.limits.maxHeight / height);
			width = Math.floor(width * scale);
			height = Math.floor(height * scale);
		}
		const offsetX = Math.round((width - this.originalCanvas.width) / 2);
		const offsetY = Math.round((height - this.originalCanvas.height) / 2);
		this.resizeCanvas(width, height, offsetX, offsetY, { saveHistory: false, updateStatus: false });
		this.originalCtx.clearRect(0, 0, width, height);
		this.originalCtx.drawImage(image, 0, 0, width, height);
		this.originalImage = image;
		this.originalImageData = this.originalCtx.getImageData(0, 0, width, height);
		this.originalAlphaChannel = new Uint8Array(width * height);
		for (let i = 0; i < this.originalAlphaChannel.length; i++) this.originalAlphaChannel[i] = this.originalImageData.data[i * 4 + 3];
		this.baseImageSource = { kind: 'file', file, renderedWidth: width, renderedHeight: height, hasBaseImage: true };
		this.layerManager.updateBaseImageSwatchCache();
		const layer = this.layers.find((entry) => entry.type === LayerType.BASE_IMAGE);
		if (layer) {
			const normalized = this.baseBackgroundManager?.normalizeLayer(layer);
			if (normalized) normalized.background.mode = 'image';
		}
		this.updatePreview();
		this.layerManager.renderLayersList();
		if (layer) this.baseBackgroundManager?.loadLayerSettings(layer);
		this.saveState();
		this.updateStatus('Base image replaced');
		return true;
	}

	async loadImage(event) {
		const file = event.target.files[0];
		if (!file) return;
		try {
			// Once a project exists, every image-upload surface means “replace the
			// protected background image”; it must never clear the layer stack.
			if (this.originalImage && this.layers?.some((layer) => layer.type === LayerType.BASE_IMAGE)) {
				return await this.replaceBaseImageFile(file);
			}
			return await this.loadImageFile(file);
		} finally {
			if (event.target && 'value' in event.target) event.target.value = '';
		}
		return;

		if (file.size > CONFIG.canvas.limits.maxFileSizeMB * 1024 * 1024) {
			this.showError(`Image too large. Maximum size is ${CONFIG.canvas.limits.maxFileSizeMB}MB`);
			return;
		}

		// Release the previous image's blob URL (its src is referenced by the
		// base-layer swatch CSS, so it can only be revoked once replaced)
		this.exporter?.clearPreviewBlobUrl?.();
		if (this.originalImage && this.originalImage.src.startsWith('blob:')) {
			URL.revokeObjectURL(this.originalImage.src);
		}

		const img = new Image();
		img.onerror = () => {
			URL.revokeObjectURL(img.src);
			this.showError('Could not load that image. The file may be corrupt or unsupported.');
		};
		img.onload = () => {
			let width = img.width, height = img.height;

			if (width > CONFIG.canvas.limits.maxWidth || height > CONFIG.canvas.limits.maxHeight) {
				const scale = Math.min(CONFIG.canvas.limits.maxWidth / width, CONFIG.canvas.limits.maxHeight / height);
				width = Math.floor(width * scale);
				height = Math.floor(height * scale);
			}

			this.originalImage = img;
			this.originalCanvas.width = width;
			this.originalCanvas.height = height;
			this.previewCanvas.width = width;
			this.previewCanvas.height = height;

			this.previewWrapper.style.width = width + 'px';
			this.previewWrapper.style.height = height + 'px';
			this.previewWrapper.classList.add('hasImage');

			this.originalCtx.drawImage(img, 0, 0, width, height);
			this.originalImageData = this.originalCtx.getImageData(0, 0, width, height);

			this.originalAlphaChannel = new Uint8Array(width * height);
			for (let i = 0; i < width * height; i++) {
				this.originalAlphaChannel[i] = this.originalImageData.data[i * 4 + 3];
			}

			this.layerManager.updateBaseImageSwatchCache();

			// Tell viewport about canvas dimensions
			this.viewport.setCanvasDimensions(this.previewCanvas.width, this.previewCanvas.height);
			this.viewport.resetZoomSmart();
			this.updateZoomUI();

			const dropzone = document.getElementById('imageDropzone');
			dropzone.classList.add('has-image');
			document.getElementById('dropzoneContent').classList.remove('visible');
			this.originalCanvas.classList.add('visible');

			// Clear previous layers and glitter
			if (this.glitterManager) {
				this.layerManager.layers.forEach((layer) => {
					this.glitterManager.releaseLayerResources(layer);
				});
				this.glitterManager.clearAllPaintData();
			}
			this.layers = [];
			this.canvasElementsContainer.innerHTML = '';

			// 1. Create Base Image Layer
			if (CONFIG.app.startup.layers.createBaseImage) {
				const layer = this.layerManager.createBaseImageLayer(LayerType.BASE_IMAGE);
				this.layers.push(layer);
				// Set it active immediately
				// this.layerManager.setActiveLayer(layer.id);
			}

			// 2. Create Default Glitter Layer (Optional)
			if (CONFIG.app.startup.layers.createDefaultGlitterFill) {
				const layer = this.createLayer();
				this.layers.push(layer);
				// If created, this becomes the new active layer
				this.layerManager.setActiveLayer(layer.id);
			} else {
				// 3. If NO default layer is created, check if we have a Base Layer
				if (this.layers.length > 0) {
					// Ensure the existing Base Layer stays selected and UI updates
					// this.layerManager.setActiveLayer(this.layers[0].id);
				} else {
					// Only if completely empty do we reset to null
					this.activeLayerId = null;
					this.updateSidePanelUI(null);
				}
			}

			// 4. Reset History
			this.historyManager.reset(this.historyManager.createStateSnapshot());

			// 5. reset saved
			this.isSaved = false;

			this.updateSidePanelUI();
			this.layerManager.renderLayersList();
			this.updateHistoryButtons();
			this.updateActionButtons();
			this.updateStatusBar();
			this.updateHelpfulMessage();

			// 6. Update Preview
			this.previewCtx.putImageData(this.originalImageData, 0, 0);

			// P-1: warm the default font as soon as an image is available, so the
			// first Text tool click almost never races the FontFace load.
			this.textGlitterManager?.ensureFontLoaded(CONFIG.tools.text.defaultFontId).catch(() => {});

			window.dispatchEvent(new Event('imageLoaded'));


		};
		img.src = URL.createObjectURL(file);
	}

	async loadImageFile(file, options = {}) {
		if (!file) return false;

		if (file.size > CONFIG.canvas.limits.maxFileSizeMB * 1024 * 1024) {
			this.showError(`Image too large. Maximum size is ${CONFIG.canvas.limits.maxFileSizeMB}MB`);
			return false;
		}

		return this.loadImageFromBlob(file, {
			...options,
			fileName: options.fileName || file.name,
			source: options.source || {
				kind: 'file',
				file
			}
		});
	}

	async loadImageFromBlob(blob, options = {}) {
		if (!blob) return false;

		const {
			fileName = 'image.png',
			source = null,
			preserveProjectName = false
		} = options;

		this.exporter?.clearPreviewBlobUrl?.();
		if (this.originalImage && this.originalImage.src.startsWith('blob:')) {
			URL.revokeObjectURL(this.originalImage.src);
		}

		const objectUrl = URL.createObjectURL(blob);
		const img = await new Promise((resolve, reject) => {
			const image = new Image();
			image.onerror = () => {
				URL.revokeObjectURL(objectUrl);
				reject(new Error('Could not load that image. The file may be corrupt or unsupported.'));
			};
			image.onload = () => resolve(image);
			image.src = objectUrl;
		}).catch((error) => {
			this.showError(error.message);
			return null;
		});

		if (!img) {
			return false;
		}
		if (this.autoGlitterManager?.isSessionActive()) this.autoGlitterManager.endSessionUI();

		let width = img.width;
		let height = img.height;

		if (width > CONFIG.canvas.limits.maxWidth || height > CONFIG.canvas.limits.maxHeight) {
			const scale = Math.min(CONFIG.canvas.limits.maxWidth / width, CONFIG.canvas.limits.maxHeight / height);
			width = Math.floor(width * scale);
			height = Math.floor(height * scale);
		}

		this.originalImage = img;
		this.originalCanvas.width = width;
		this.originalCanvas.height = height;
		this.previewCanvas.width = width;
		this.previewCanvas.height = height;

		this.previewWrapper.style.width = width + 'px';
		this.previewWrapper.style.height = height + 'px';
		this.previewWrapper.classList.add('hasImage');

		this.originalCtx.drawImage(img, 0, 0, width, height);
		this.originalImageData = this.originalCtx.getImageData(0, 0, width, height);
		this.baseImageSource = source?.kind === 'preset'
			? {
				kind: 'preset',
				preset: { ...source.preset },
				hasBaseImage: false,
				renderedWidth: width,
				renderedHeight: height
			}
			: {
				kind: source?.kind || 'file',
				hasBaseImage: source?.hasBaseImage !== false,
				file: blob instanceof File ? blob : new File([blob], fileName, { type: blob.type || 'image/png' }),
				renderedWidth: width,
				renderedHeight: height
			};

		this.originalAlphaChannel = new Uint8Array(width * height);
		for (let i = 0; i < width * height; i++) {
			this.originalAlphaChannel[i] = this.originalImageData.data[i * 4 + 3];
		}

		this.layerManager.updateBaseImageSwatchCache();
		this.viewport.setCanvasDimensions(this.previewCanvas.width, this.previewCanvas.height);
		this.viewport.resetZoomSmart();
		this.updateZoomUI();

		const dropzone = document.getElementById('imageDropzone');
		dropzone.classList.add('has-image');
		document.getElementById('dropzoneContent').classList.remove('visible');
		this.originalCanvas.classList.add('visible');

		if (this.glitterManager) {
			this.layerManager.layers.forEach((layer) => {
				this.glitterManager.releaseLayerResources(layer);
			});
			this.glitterManager.clearAllPaintData();
		}
		this.layers = [];
		this.canvasElementsContainer.innerHTML = '';

			if (CONFIG.app.startup.layers.createBaseImage) {
			const layer = this.layerManager.createBaseImageLayer(LayerType.BASE_IMAGE);
			this.layers.push(layer);
		}

		if (CONFIG.app.startup.layers.createDefaultGlitterFill) {
			const layer = this.createLayer();
			this.layers.push(layer);
			this.layerManager.setActiveLayer(layer.id);
		} else if (this.layers.length === 0) {
			this.activeLayerId = null;
			this.updateSidePanelUI(null);
		}

		this.historyManager.reset(this.historyManager.createStateSnapshot());
		this.isSaved = false;
		if (!preserveProjectName) {
			this.setProjectName('', { markDirty: false });
		}

		this.updateSidePanelUI();
		this.layerManager.renderLayersList();
		this.updateHistoryButtons();
		this.updateActionButtons();
		this.updateStatusBar();
		this.updateHelpfulMessage();

		this.previewCtx.putImageData(this.originalImageData, 0, 0);
		this.textGlitterManager?.ensureFontLoaded(CONFIG.tools.text.defaultFontId).catch(() => {});
		window.dispatchEvent(new Event('imageLoaded'));
		return true;
	}

	async saveProjectFile() {
		if (!this.originalImage) {
			this.showError('Load an image before saving a project.');
			return;
		}

		try {
			const blob = await this.projectSerializer.serializeToBlob();
			downloadBlob(blob, this.getProjectDownloadName());
			this.isSaved = true;
			this.updateStatus('Project saved');
		} catch (error) {
			console.error('Project save failed:', error);
			this.showError(error.message || 'Failed to save project.');
		}
	}

	async openProjectFile(file) {
		if (!file) return false;
		try {
			return await this.projectSerializer.loadFile(file);
		} catch (error) {
			console.error('Project load failed:', error);
			this.showError(error.message || 'Failed to open project.');
			return false;
		}
	}

	// ===== CANVAS SIZE (Photoshop-style) =====

	// The 9 anchor cells, row-major. `fx`/`fy` are the fraction of the size
	// delta applied as the content offset (0 = pin to that edge, 1 = pin to the
	// opposite edge). `arrow` is the glyph shown in the cell; the active cell is
	// rendered as a filled dot instead.
	static get CANVAS_ANCHORS() {
		return [
			{ fx: 0,   fy: 0,   arrow: '↖' }, { fx: 0.5, fy: 0,   arrow: '↑' }, { fx: 1, fy: 0,   arrow: '↗' },
			{ fx: 0,   fy: 0.5, arrow: '←' }, { fx: 0.5, fy: 0.5, arrow: '•' }, { fx: 1, fy: 0.5, arrow: '→' },
			{ fx: 0,   fy: 1,   arrow: '↙' }, { fx: 0.5, fy: 1,   arrow: '↓' }, { fx: 1, fy: 1,   arrow: '↘' }
		];
	}

	setupCanvasSizeControls() {
		const anchorGrid = document.getElementById('canvasSizeAnchor');
		const widthInput = document.getElementById('canvasSizeWidth');
		const heightInput = document.getElementById('canvasSizeHeight');
		const relativeInput = document.getElementById('canvasSizeRelative');
		const extensionMode = document.getElementById('canvasExtensionMode');
		const applyBtn = document.getElementById('canvasSizeApply');
		const resetBtn = document.getElementById('canvasSizeReset');
		if (!anchorGrid || !widthInput || !heightInput || !applyBtn) return;

		// Center anchor by default.
		this.canvasSizeAnchorIndex = 4;

		anchorGrid.innerHTML = '';
		GlitterEditor.CANVAS_ANCHORS.forEach((anchor, index) => {
			const cell = document.createElement('button');
			cell.type = 'button';
			cell.className = 'anchor-cell';
			cell.dataset.anchorIndex = String(index);
			cell.setAttribute('role', 'radio');
			cell.textContent = index === this.canvasSizeAnchorIndex ? '•' : anchor.arrow;
			cell.classList.toggle('active', index === this.canvasSizeAnchorIndex);
			cell.setAttribute('aria-checked', index === this.canvasSizeAnchorIndex ? 'true' : 'false');
			anchorGrid.appendChild(cell);
		});

		anchorGrid.addEventListener('click', (event) => {
			const cell = event.target.closest('.anchor-cell');
			if (!cell) return;
			this.canvasSizeAnchorIndex = parseInt(cell.dataset.anchorIndex, 10);
			anchorGrid.querySelectorAll('.anchor-cell').forEach((el) => {
				const idx = parseInt(el.dataset.anchorIndex, 10);
				const selected = idx === this.canvasSizeAnchorIndex;
				el.classList.toggle('active', selected);
				el.setAttribute('aria-checked', selected ? 'true' : 'false');
				el.textContent = selected ? '•' : GlitterEditor.CANVAS_ANCHORS[idx].arrow;
			});
			this.updateCanvasResizePreview();
		});

		// Live on-canvas preview of the prospective bounds as the user edits.
		widthInput.addEventListener('input', () => {
			this.updateCanvasSizeValidation();
			this.updateCanvasResizePreview();
		});
		heightInput.addEventListener('input', () => {
			this.updateCanvasSizeValidation();
			this.updateCanvasResizePreview();
		});
		relativeInput?.addEventListener('change', () => {
			this.syncCanvasSizeInputs();
			this.updateCanvasResizePreview();
		});
		extensionMode?.addEventListener('click', (event) => {
			const button = event.target.closest('[data-extension-mode]');
			if (button) this.setCanvasExtensionMode(button.dataset.extensionMode);
		});

		resetBtn?.addEventListener('click', () => {
			this.syncCanvasSizeInputs();
			this.hideCanvasResizePreview();
		});
		applyBtn.addEventListener('click', () => this.applyCanvasSize());

		// Keep the inputs showing the live canvas size whenever an image loads or
		// the panel could become visible.
		window.addEventListener('imageLoaded', () => {
			this.syncCanvasSizeInputs();
			this.syncCanvasExtensionControls();
		});
		this.setupDocumentSizeModeControls();
		this.syncCanvasSizeInputs();
		this.syncCanvasExtensionControls();
	}

	setupDocumentSizeModeControls() {
		const control = document.getElementById('documentSizeMode');
		if (!control) return;
		control.addEventListener('click', (event) => {
			const button = event.target.closest('[data-size-mode]');
			if (button) this.setDocumentSizeMode(button.dataset.sizeMode);
		});
		this.setDocumentSizeMode('image');
	}

	setDocumentSizeMode(mode) {
		const resolved = mode === 'canvas' ? 'canvas' : 'image';
		document.getElementById('scaleDesignPanel').hidden = resolved !== 'image';
		document.getElementById('canvasSizePanel').hidden = resolved !== 'canvas';
		document.querySelectorAll('#documentSizeMode [data-size-mode]').forEach((button) => {
			const active = button.dataset.sizeMode === resolved;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
		});
		if (resolved === 'canvas') this.updateCanvasResizePreview();
		else this.hideCanvasResizePreview();
	}

	setCanvasExtensionMode(mode) {
		this.canvasExtensionMode = mode === 'color' ? 'color' : 'transparent';
		document.querySelectorAll('#canvasExtensionMode [data-extension-mode]').forEach((button) => {
			const active = button.dataset.extensionMode === this.canvasExtensionMode;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
		});
		document.getElementById('canvasExtensionColorRow').hidden = this.canvasExtensionMode !== 'color';
	}

	syncCanvasExtensionControls() {
		if (!this.originalImage) return;
		const presetColor = this.baseImageSource?.preset?.color;
		const backgroundColor = this.layers.find((layer) => layer.type === LayerType.BASE_IMAGE)?.background?.color;
		const colorInput = document.getElementById('canvasExtensionColor');
		if (colorInput) colorInput.value = presetColor || backgroundColor || '#ffffff';
		this.setCanvasExtensionMode(this.baseImageSource?.kind === 'preset' ? 'color' : 'transparent');
	}

	syncCanvasSizeInputs() {
		const widthInput = document.getElementById('canvasSizeWidth');
		const heightInput = document.getElementById('canvasSizeHeight');
		if (!widthInput || !heightInput || !this.originalImage) return;
		const relative = document.getElementById('canvasSizeRelative')?.checked === true;
		widthInput.value = relative ? 0 : this.originalCanvas.width;
		heightInput.value = relative ? 0 : this.originalCanvas.height;
		widthInput.min = relative ? String(1 - this.originalCanvas.width) : '1';
		heightInput.min = relative ? String(1 - this.originalCanvas.height) : '1';
		widthInput.max = relative
			? String(CONFIG.canvas.limits.maxWidth - this.originalCanvas.width)
			: String(CONFIG.canvas.limits.maxWidth);
		heightInput.max = relative
			? String(CONFIG.canvas.limits.maxHeight - this.originalCanvas.height)
			: String(CONFIG.canvas.limits.maxHeight);
		this.updateCanvasSizeValidation();
	}

	getRequestedCanvasSize() {
		const width = Number(document.getElementById('canvasSizeWidth')?.value);
		const height = Number(document.getElementById('canvasSizeHeight')?.value);
		if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
		const relative = document.getElementById('canvasSizeRelative')?.checked === true;
		return {
			width: Math.round(relative ? this.originalCanvas.width + width : width),
			height: Math.round(relative ? this.originalCanvas.height + height : height)
		};
	}

	updateCanvasSizeValidation() {
		const message = document.getElementById('canvasSizeLimitMessage');
		const widthInput = document.getElementById('canvasSizeWidth');
		const heightInput = document.getElementById('canvasSizeHeight');
		if (!message || !widthInput || !heightInput || !this.originalImage) return false;

		const requested = this.getRequestedCanvasSize();
		let error = '';
		if (!requested) {
			error = 'Enter valid width and height values.';
		} else if (requested.width < 1 || requested.height < 1) {
			error = `Canvas dimensions must be at least 1 × 1 px. Requested ${requested.width} × ${requested.height} px.`;
		} else if (requested.width > CONFIG.canvas.limits.maxWidth || requested.height > CONFIG.canvas.limits.maxHeight) {
			error = `Maximum canvas size is ${CONFIG.canvas.limits.maxWidth} × ${CONFIG.canvas.limits.maxHeight} px. Requested ${requested.width} × ${requested.height} px.`;
		}

		message.textContent = error || `Maximum canvas size: ${CONFIG.canvas.limits.maxWidth} × ${CONFIG.canvas.limits.maxHeight} px.`;
		message.classList.toggle('is-error', Boolean(error));
		widthInput.setAttribute('aria-invalid', String(Boolean(error)));
		heightInput.setAttribute('aria-invalid', String(Boolean(error)));
		return !error;
	}

	applyCanvasSize() {
		if (!this.originalImage) return;
		const requested = this.getRequestedCanvasSize();
		if (!requested || !this.updateCanvasSizeValidation()) return;

		const newWidth = requested.width;
		const newHeight = requested.height;

		const anchor = GlitterEditor.CANVAS_ANCHORS[this.canvasSizeAnchorIndex] || GlitterEditor.CANVAS_ANCHORS[4];
		const offsetX = Math.round((newWidth - this.originalCanvas.width) * anchor.fx);
		const offsetY = Math.round((newHeight - this.originalCanvas.height) * anchor.fy);

		const extensionColor = this.canvasExtensionMode === 'color'
			? document.getElementById('canvasExtensionColor')?.value || '#ffffff'
			: null;
		this.resizeCanvas(newWidth, newHeight, offsetX, offsetY, { extensionColor });
		this.syncCanvasSizeInputs();
	}

	setupScaleDesignControls() {
		const widthInput = document.getElementById('scaleDesignWidth');
		const heightInput = document.getElementById('scaleDesignHeight');
		const percentInput = document.getElementById('scaleDesignPercent');
		const presets = document.getElementById('scaleDesignPresets');
		const applyBtn = document.getElementById('scaleDesignApply');
		const resetBtn = document.getElementById('scaleDesignReset');
		if (!widthInput || !heightInput || !percentInput || !presets || !applyBtn) return;

		presets.replaceChildren(...CONFIG.canvas.scalePresets.map((percent) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'segmented-option';
			button.dataset.scalePercent = String(percent);
			button.textContent = `${percent}%`;
			return button;
		}));

		widthInput.addEventListener('input', () => this.updateScaleDesignFromDimension('width'));
		heightInput.addEventListener('input', () => this.updateScaleDesignFromDimension('height'));
		percentInput.addEventListener('input', () => this.updateScaleDesignFromPercent());
		presets.addEventListener('click', (event) => {
			const button = event.target.closest('[data-scale-percent]');
			if (!button) return;
			percentInput.value = button.dataset.scalePercent;
			this.updateScaleDesignFromPercent();
		});
		resetBtn?.addEventListener('click', () => this.syncScaleDesignInputs());
		applyBtn.addEventListener('click', () => this.applyScaleDesign());
		window.addEventListener('imageLoaded', () => this.syncScaleDesignInputs());
		this.syncScaleDesignInputs();
	}

	_formatScaleDesignPercent(percent) {
		return String(Math.round(percent * 100) / 100);
	}

	syncScaleDesignInputs() {
		const widthInput = document.getElementById('scaleDesignWidth');
		const heightInput = document.getElementById('scaleDesignHeight');
		const percentInput = document.getElementById('scaleDesignPercent');
		if (!widthInput || !heightInput || !percentInput || !this.originalImage) return;
		widthInput.value = this.originalCanvas.width;
		heightInput.value = this.originalCanvas.height;
		widthInput.max = String(CONFIG.canvas.limits.maxWidth);
		heightInput.max = String(CONFIG.canvas.limits.maxHeight);
		percentInput.max = this._formatScaleDesignPercent(Math.min(
			CONFIG.canvas.limits.maxWidth / this.originalCanvas.width,
			CONFIG.canvas.limits.maxHeight / this.originalCanvas.height
		) * 100);
		percentInput.value = '100';
		this.updateScaleDesignPresetState(100);
		this.updateScaleDesignPresetAvailability();
	}

	updateScaleDesignFromDimension(axis) {
		if (!this.originalImage) return;
		const input = document.getElementById(axis === 'width' ? 'scaleDesignWidth' : 'scaleDesignHeight');
		const value = Number(input?.value);
		if (!Number.isFinite(value) || value <= 0) return;
		const original = axis === 'width' ? this.originalCanvas.width : this.originalCanvas.height;
		this.updateScaleDesignFields(value / original * 100);
	}

	updateScaleDesignFromPercent() {
		const percent = Number(document.getElementById('scaleDesignPercent')?.value);
		if (!Number.isFinite(percent) || percent <= 0) return;
		this.updateScaleDesignFields(percent);
	}

	updateScaleDesignFields(percent) {
		if (!this.originalImage) return;
		const scale = this.clampDocumentScale(percent / 100);
		const width = Math.max(1, Math.round(this.originalCanvas.width * scale));
		const height = Math.max(1, Math.round(this.originalCanvas.height * scale));
		document.getElementById('scaleDesignWidth').value = width;
		document.getElementById('scaleDesignHeight').value = height;
		document.getElementById('scaleDesignPercent').value = this._formatScaleDesignPercent(scale * 100);
		this.updateScaleDesignPresetState(scale * 100);
		this.updateScaleDesignPresetAvailability();
	}

	updateScaleDesignPresetAvailability() {
		if (!this.originalImage) return;
		const maximum = Math.min(
			CONFIG.canvas.limits.maxWidth / this.originalCanvas.width,
			CONFIG.canvas.limits.maxHeight / this.originalCanvas.height
		) * 100;
		document.querySelectorAll('#scaleDesignPresets [data-scale-percent]').forEach((button) => {
			const unavailable = Number(button.dataset.scalePercent) > maximum + 0.01;
			button.disabled = unavailable;
			button.title = unavailable
				? `Maximum for this design is ${this._formatScaleDesignPercent(maximum)}% (${CONFIG.canvas.limits.maxWidth} × ${CONFIG.canvas.limits.maxHeight} px limit)`
				: '';
		});
	}

	updateScaleDesignPresetState(percent) {
		document.querySelectorAll('#scaleDesignPresets [data-scale-percent]').forEach((button) => {
			const active = Math.abs(Number(button.dataset.scalePercent) - percent) < 0.01;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
		});
	}

	clampDocumentScale(scale) {
		const width = this.originalCanvas.width;
		const height = this.originalCanvas.height;
		const minimum = Math.max(1 / width, 1 / height);
		const maximum = Math.min(CONFIG.canvas.limits.maxWidth / width, CONFIG.canvas.limits.maxHeight / height);
		return Math.max(minimum, Math.min(maximum, scale));
	}

	applyScaleDesign() {
		if (!this.originalImage) return;
		const enteredPercent = Number(document.getElementById('scaleDesignPercent')?.value);
		if (!Number.isFinite(enteredPercent) || enteredPercent <= 0) {
			this.syncScaleDesignInputs();
			return;
		}
		const scale = this.clampDocumentScale(enteredPercent / 100);
		const newWidth = Math.max(1, Math.round(this.originalCanvas.width * scale));
		const newHeight = Math.max(1, Math.round(this.originalCanvas.height * scale));
		this.scaleDocument(newWidth, newHeight, scale, {
			scaleTextures: document.getElementById('scaleDesignTextures')?.checked !== false,
			scaleEffects: document.getElementById('scaleDesignEffects')?.checked !== false
		});
	}

	// Editable document scaling. Base pixels and painted masks are resampled with
	// nearest-neighbor; layer geometry stays live and history retains old buffers.
	scaleDocument(newWidth, newHeight, uniformScale, options = {}) {
		if (!this.originalImage) return;
		const oldWidth = this.originalCanvas.width;
		const oldHeight = this.originalCanvas.height;
		if (newWidth === oldWidth && newHeight === oldHeight) return;

		const scaleX = newWidth / oldWidth;
		const scaleY = newHeight / oldHeight;
		const scaled = document.createElement('canvas');
		scaled.width = newWidth;
		scaled.height = newHeight;
		const scaledCtx = scaled.getContext('2d', { willReadFrequently: true });
		scaledCtx.imageSmoothingEnabled = false;
		scaledCtx.drawImage(this.originalCanvas, 0, 0, newWidth, newHeight);

		this.originalCanvas.width = newWidth;
		this.originalCanvas.height = newHeight;
		this.originalCtx.imageSmoothingEnabled = false;
		this.originalCtx.drawImage(scaled, 0, 0);
		this.originalImageData = this.originalCtx.getImageData(0, 0, newWidth, newHeight);
		this.originalAlphaChannel = new Uint8Array(newWidth * newHeight);
		for (let index = 0; index < newWidth * newHeight; index++) {
			this.originalAlphaChannel[index] = this.originalImageData.data[index * 4 + 3];
		}

		this.previewCanvas.width = newWidth;
		this.previewCanvas.height = newHeight;
		this.previewWrapper.style.width = `${newWidth}px`;
		this.previewWrapper.style.height = `${newHeight}px`;

		this.glitterManager?.scaleForCanvasResize(newWidth, newHeight, scaleX, scaleY, this.layers);
		scaleDocumentLayerStates(this.layers, scaleX, scaleY, uniformScale, options);
		this.baseBackgroundManager?.invalidatePixelEffects();

		this.layers.forEach((layer) => {
			if (layer.type === LayerType.STICKER) this.stickerManager?.renderLayer(layer);
			else if (layer.type === LayerType.TEXT_GLITTER) this.textGlitterManager?.renderLayer(layer);
			else if (layer.type === LayerType.SHAPE) this.shapeGlitterManager?.renderLayer(layer);
		});

		this.layerManager.updateBaseImageSwatchCache();
		this.viewport.setCanvasDimensions(newWidth, newHeight);
		this.viewport.resetZoomSmart();
		this.updateZoomUI();
		if (options.saveHistory !== false) this.historyManager.saveState();
		this.isSaved = false;
		if (options.updateStatus !== false) this.updateStatus(`Design scaled to ${newWidth} × ${newHeight} px`);

		this.hideCanvasResizePreview();
		this.updatePreview();
		this.layerManager.renderLayersList();
		this.loadActiveLayerSettings();
		this.syncTransformHandlesForActiveLayer?.();
		this.syncCanvasSizeInputs();
		this.syncScaleDesignInputs();
		this.updateStatusBar();
		this.updateHistoryButtons();
	}

	// Structural canvas resize (Photoshop "Canvas Size"): change the canvas
	// bounds WITHOUT resampling. Content keeps its pixel size; it's translated by
	// (offsetX, offsetY) — where the old top-left lands in the new canvas — then
	// cropped or extended with transparent or solid-color margins. Crop reuses this exact
	// primitive by passing the crop rect's origin as a negative offset plus the
	// smaller size. Re-anchors every buffer and records an undoable history entry
	// (the snapshot carries the new canvas dims + base pixels; see
	// applyCanvasStateFromHistory), so Ctrl+Z restores the previous size.
	resizeCanvas(newWidth, newHeight, offsetX, offsetY, options = {}) {
		if (!this.originalImage) return;
		newWidth = Math.max(1, Math.round(newWidth));
		newHeight = Math.max(1, Math.round(newHeight));
		offsetX = Math.round(offsetX);
		offsetY = Math.round(offsetY);

		const oldWidth = this.originalCanvas.width;
		const oldHeight = this.originalCanvas.height;
		if (newWidth === oldWidth && newHeight === oldHeight && offsetX === 0 && offsetY === 0) {
			return;
		}

		// 1. Re-anchor the base image pixels onto a new canvas-sized buffer.
		const rebased = document.createElement('canvas');
		rebased.width = newWidth;
		rebased.height = newHeight;
		const rebasedCtx = rebased.getContext('2d', { willReadFrequently: true });
		const extensionSpecified = Object.prototype.hasOwnProperty.call(options, 'extensionColor');
		if (extensionSpecified && options.extensionColor) {
			rebasedCtx.fillStyle = options.extensionColor;
			rebasedCtx.fillRect(0, 0, newWidth, newHeight);
		} else if (!extensionSpecified && this.baseImageSource?.kind === 'preset') {
			rebasedCtx.fillStyle = this.baseImageSource.preset.color;
			rebasedCtx.fillRect(0, 0, newWidth, newHeight);
		}
		rebasedCtx.drawImage(this.originalCanvas, offsetX, offsetY);

		this.originalCanvas.width = newWidth;
		this.originalCanvas.height = newHeight;
		this.originalCtx.clearRect(0, 0, newWidth, newHeight);
		this.originalCtx.drawImage(rebased, 0, 0);
		this.originalImageData = this.originalCtx.getImageData(0, 0, newWidth, newHeight);

		this.originalAlphaChannel = new Uint8Array(newWidth * newHeight);
		for (let i = 0; i < newWidth * newHeight; i++) {
			this.originalAlphaChannel[i] = this.originalImageData.data[i * 4 + 3];
		}

		// 2. Preview surface + wrapper.
		this.previewCanvas.width = newWidth;
		this.previewCanvas.height = newHeight;
		this.previewWrapper.style.width = newWidth + 'px';
		this.previewWrapper.style.height = newHeight + 'px';

		// 3. Glitter paint buffers, selection seeds, and mask caches.
		this.glitterManager?.reanchorForCanvasResize(newWidth, newHeight, offsetX, offsetY, this.layers);

		// 4. Sticker / text positions shift with the content (canvas coords).
		this.layers.forEach((layer) => {
			if (layer.type === LayerType.STICKER && layer.stickerData?.transform?.position) {
				const position = layer.stickerData.transform.position;
				this.stickerManager?.updateTransform(layer.id, {
					position: { x: position.x + offsetX, y: position.y + offsetY }
				});
			} else if (layer.type === LayerType.TEXT_GLITTER && layer.textData?.transform?.position) {
				layer.textData.transform.position.x += offsetX;
				layer.textData.transform.position.y += offsetY;
				this.textGlitterManager?.renderLayer(layer);
			} else if (layer.type === LayerType.SHAPE && layer.shapeData?.transform?.position) {
				layer.shapeData.transform.position.x += offsetX;
				layer.shapeData.transform.position.y += offsetY;
				this.shapeGlitterManager?.renderLayer(layer);
			}
		});

		// 5. Base swatch, viewport, zoom.
		this.layerManager.updateBaseImageSwatchCache();
		this.viewport.setCanvasDimensions(newWidth, newHeight);
		this.viewport.resetZoomSmart();
		this.updateZoomUI();

		// 6. Undoable checkpoint. reanchorForCanvasResize re-captured paint at the
		// new size, and the snapshot records the new canvas dims + base pixels, so
		// undo restores the previous size/content and redo re-applies this resize.
		if (options.saveHistory !== false) this.historyManager.saveState();
		this.isSaved = false;
		if (options.updateStatus !== false) this.updateStatus(`Canvas resized to ${newWidth} × ${newHeight} px`);

		// 7. Repaint composite + list + status; drop any live resize preview.
		this.hideCanvasResizePreview();
		this.updatePreview();
		this.layerManager.renderLayersList();
		this.syncScaleDesignInputs();
		this.updateStatusBar();
		this.updateHistoryButtons();
	}

	// Restore canvas dimensions + base-image pixels from a history snapshot's
	// `canvas` field (see HistoryManager.createStateSnapshot). Called at the top
	// of restoreState, before paint/layers, so buffers rebuild at the right size.
	applyCanvasStateFromHistory(canvasState) {
		if (!canvasState || !canvasState.imageData) return;

		const sameSize = this.originalCanvas.width === canvasState.width
			&& this.originalCanvas.height === canvasState.height;
		const sameData = this.originalImageData === canvasState.imageData;
		if (sameSize && sameData) return; // typical non-resize undo — nothing to do

		const { width, height, imageData, alphaChannel } = canvasState;

		this.originalCanvas.width = width;
		this.originalCanvas.height = height;
		this.originalCtx.clearRect(0, 0, width, height);
		this.originalCtx.putImageData(imageData, 0, 0);
		this.originalImageData = imageData;
		this.originalAlphaChannel = alphaChannel;
		if ('baseImageSource' in canvasState) this.baseImageSource = canvasState.baseImageSource;
		if (canvasState.originalImage) this.originalImage = canvasState.originalImage;

		this.previewCanvas.width = width;
		this.previewCanvas.height = height;
		this.previewWrapper.style.width = width + 'px';
		this.previewWrapper.style.height = height + 'px';

		if (!sameSize) {
			// Live paint buffers are now the wrong size; restorePaintState (runs
			// next) rebuilds them at this size from each layer's snapshot.
			this.glitterManager?.discardLivePaintBuffers();
			this.viewport.setCanvasDimensions(width, height);
			this.viewport.resetZoomSmart();
			this.updateZoomUI();
		}

		this.layerManager.updateBaseImageSwatchCache();
		this.syncCanvasSizeInputs();
		this.syncScaleDesignInputs();
	}

	// Live preview overlay: a dashed rectangle inside previewWrapper (so it
	// inherits the viewport's zoom/pan transform for free) showing where the new
	// canvas bounds will fall relative to the current content. New bounds in
	// current-canvas coords = a rect at (-offsetX, -offsetY) sized newW×newH.
	_ensureCanvasResizePreviewEl() {
		if (this._canvasResizePreviewEl) return this._canvasResizePreviewEl;
		if (!this.previewWrapper) return null;
		const el = document.createElement('div');
		el.className = 'canvas-resize-preview';
		el.style.display = 'none';
		this.previewWrapper.appendChild(el);
		this._canvasResizePreviewEl = el;
		return el;
	}

	updateCanvasResizePreview() {
		const el = this._ensureCanvasResizePreviewEl();
		if (!el || !this.originalImage) {
			this.hideCanvasResizePreview();
			return;
		}

		const requested = this.getRequestedCanvasSize();
		if (
			!requested ||
			requested.width < 1 ||
			requested.height < 1 ||
			requested.width > CONFIG.canvas.limits.maxWidth ||
			requested.height > CONFIG.canvas.limits.maxHeight
		) {
			this.hideCanvasResizePreview();
			return;
		}
		const newWidth = requested.width;
		const newHeight = requested.height;

		const oldWidth = this.originalCanvas.width;
		const oldHeight = this.originalCanvas.height;
		if (newWidth === oldWidth && newHeight === oldHeight) {
			this.hideCanvasResizePreview();
			return;
		}

		const anchor = GlitterEditor.CANVAS_ANCHORS[this.canvasSizeAnchorIndex] || GlitterEditor.CANVAS_ANCHORS[4];
		const offsetX = Math.round((newWidth - oldWidth) * anchor.fx);
		const offsetY = Math.round((newHeight - oldHeight) * anchor.fy);

		el.style.left = `${-offsetX}px`;
		el.style.top = `${-offsetY}px`;
		el.style.width = `${newWidth}px`;
		el.style.height = `${newHeight}px`;
		el.style.display = 'block';
	}

	hideCanvasResizePreview() {
		if (this._canvasResizePreviewEl) {
			this._canvasResizePreviewEl.style.display = 'none';
		}
	}

	updateStatusBar() {
		if (this.originalImage) {
			document.getElementById('statusDimensions').innerHTML = formatDimensions(this.originalCanvas.width, this.originalCanvas.height);

			const zoomPct = Math.round(this.viewport.currentZoom * 100);
			const count = this.layerManager?.getSelectedLayers().length || 0;
			document.getElementById('statusZoom').innerHTML = count > 1
				? `${formatUnit(zoomPct, '%')}<span class="setting-separator"> · </span>${count} layers selected`
				: formatUnit(zoomPct, '%');
		} else {
			document.getElementById('statusDimensions').textContent = '';
			document.getElementById('statusZoom').textContent = '';
		}
	}

	// ===== CLICK HANDLERS =====

	handleWorkspaceAction(clientX, clientY, options = {}) {
		const tool = options.tool || this.currentTool;
		const event = options.event || null;
		const canvasPoint = this.viewport.screenToCanvas(clientX, clientY);
		const hitCanvas = this.viewport.isWithinCanvas(canvasPoint.x, canvasPoint.y);
		const x = Math.round(canvasPoint.x);
		const y = Math.round(canvasPoint.y);

		switch (tool) {
			case ToolType.SELECT:
				if (hitCanvas) {
					this.handleLayerSelectAction(x, y, {
						toggleSelection: Boolean(event?.shiftKey),
						cycleDeep: Boolean(event?.altKey)
					});
				} else {
					this.layerManager.clearSelection();
				}
				break;

			case ToolType.TEXT:
				if (!hitCanvas) {
					return;
				}
				{
					// Figma parity: clicking existing text with the text tool edits it;
					// any other layer under the click is no obstacle — text goes on top.
					const hitLayer = this.layerManager.getTopVisibleLayerAtPoint?.(x, y, { includeBase: false });
					if (hitLayer?.type === LayerType.TEXT_GLITTER) {
						this.layerManager.selectLayerFromCanvas(hitLayer.id);
						this.textGlitterManager?.focusTextInput(true);
						return;
					}

					const layer = this.layerManager.addLayer(LayerType.TEXT_GLITTER, {
						textLayer: {
							position: { x, y },
							align: 'left',
							anchorPosition: { x, y },
							boxMode: 'auto'
						}
					});

					this.finishLayerCreation(layer, {
						onDesktopReload: () => this.textGlitterManager?.focusTextInput(true)
					});
				}
				break;

			case ToolType.SHAPE:
				// Tap-to-create parity with desktop's plain click (startShapeDrag's
				// isClick path); drag-to-size stays desktop-only (mouse pointerdown).
				if (!hitCanvas || !this.originalImage) {
					return;
				}
				{
					const layer = this.layerManager.addLayer(LayerType.SHAPE, {
						shapeLayer: {
							shapeId: this.shapeGlitterManager.getActiveShapeId(),
							position: { x, y }
						}
					});

					this.finishLayerCreation(layer);
				}
				break;

			case ToolType.COLOR_PICKER:
				if (hitCanvas) {
					this.handleColorPickAction(x, y, event);
				} else {
					this.setTool(ToolType.SELECT);
				}
				break;

			case ToolType.HAND:
				this.viewport.startPan(clientX, clientY);
				break;

			case ToolType.ZOOM:
				if (this.originalImage) {
					this.handleZoomAction(clientX, clientY, {
						zoomOut: options.zoomOut || false
					});
				}
				break;
		}
	}


	handlePreviewContainerClick(e) {
		dbg('📍 Click handler fired', e.type);

		// 0. IGNORE IF JUST FINISHED HANDLE DRAGGING
		if (this.ignoreNextClick) {
			dbg('🚫 Ignoring click - just finished handle drag');
			return;
		}

		// 1. IGNORE TRANSFORM HANDLES
		const clickedGroupBoundingBox = e.target.closest('.group-transform-handles .transform-bounding-box');
		if ((e.target.closest('.transform-handles') ||
			e.target.classList.contains('transform-bounding-box')) && !clickedGroupBoundingBox) return;

		// 2. IGNORE UI ELEMENTS
		if (e.target.closest('.ui-ignore-gestures')) {
			return;
		}

		// 3. MOUSE BUTTON CHECKS
		if (e.button === 1) return; // Ignore middle mouse button
		// Ignore right-click for all tools EXCEPT zoom tool
		if (e.button === 2 && this.currentTool !== ToolType.ZOOM) {
			return;
		}

		// 4. EVENT TYPE FILTERING - Different tools need different events
		// HAND tool needs pointerdown to start dragging
		// Other tools need click to prevent double-firing

		if (this.currentTool === ToolType.HAND) {
			// Hand tool: ONLY respond to pointerdown (ignore click)
			if (e.type === 'click') {
				dbg('🚫 HAND tool: Ignoring click event (already handled by pointerdown)');
				return;
			}
		} else {
			// Other tools (SELECT, COLOR_PICKER, ZOOM): ONLY respond to click
			// EXCEPT: ZOOM tool with right-click needs pointerdown (right-click doesn't fire 'click')
			// EXCEPT: SELECT tool on sticker elements - let mousedown pass through to sticker handlers
			if (e.type === 'pointerdown' || e.type === 'mousedown') {
				// Allow pointerdown for zoom tool with right-click
				if (this.currentTool === ToolType.ZOOM && e.button === 2) {
					dbg('✅ ZOOM tool: Allowing right-click pointerdown');
					// Continue to handle this event
				}
				// CRITICAL FIX: Allow mousedown on transformable overlays to pass through
				else if (this.currentTool === ToolType.SELECT && e.target.closest(TRANSFORMABLE_LAYER_ELEMENT_SELECTOR)) {
					dbg('✅ SELECT tool: Allowing transformable overlay mousedown to pass through');
					// Don't return - let it fall through, but don't process it here
					// The sticker's own mousedown handler will handle it
					return;
				}
				else {
					dbg('🚫 Click-based tool: Ignoring pointerdown (waiting for click)');
					return;
				}
			}
		}

		const hitTransformableOverlay = e.target.closest(TRANSFORMABLE_LAYER_ELEMENT_SELECTOR);

		// Check if click is within the canvas area using viewport coordinates
		const canvasCoords = this.viewport.screenToCanvas(e.clientX, e.clientY);
		const hitCanvas = this.viewport.isWithinCanvas(canvasCoords.x, canvasCoords.y);

		// We treat transformable overlays and the canvas as the "Image Area"
		const hitImageArea = hitCanvas || hitTransformableOverlay;

		// Gatekeeper: If they clicked a button/sidebar, stop here
		const isWorkspace = e.target === this.previewContainer || e.target === this.previewWrapper || hitImageArea;
		if (!isWorkspace) return;

		if (
			this.currentTool === ToolType.SELECT &&
			hitTransformableOverlay &&
			!this.layerManager.hasMultiSelection() &&
			!e.shiftKey &&
			!e.altKey
		) return;

		this.handleWorkspaceAction(e.clientX, e.clientY, {
			tool: this.currentTool,
			event: e,
			zoomOut: e.altKey || e.button === 2
		});
	}
	handleColorPickAction(x, y, event = null) {
		if (this.currentTool !== ToolType.COLOR_PICKER) return;

		let layer = this.layerManager.getActiveLayer();

		// If no layer selected, try to select a layer at this location
		if (!layer) {
			for (let i = this.layerManager.layers.length - 1; i >= 0; i--) {
				const testLayer = this.layerManager.layers[i];
				if (!testLayer.visible) continue;

				let isHit = false;

				if (testLayer.type === LayerType.GLITTER_FILL) {
					if (hasMaskContent(testLayer)) {
						isHit = this.layerManager.isPixelInLayerSelection(testLayer, x, y);
					}
				} else if (testLayer.type === LayerType.BASE_IMAGE) {
					if (this.originalImage) {
						isHit = true;
					}
				}

				if (isHit) {
					this.layerManager.selectLayerFromCanvas(testLayer.id);
					layer = testLayer;
					break;
				}
			}

			if (!layer) {
				this.updateStatus('Please select the Base Image or a Glitter Layer.');
				return;
			}
		}

		// Handle based on selected layer type
		if (layer.type === LayerType.GLITTER_FILL) {
			if (!this.canEditLayer(layer, { notify: true })) return;

			// fill normally
			this.glitterFillSelector(x, y, event);

		} else if (layer.type === LayerType.BASE_IMAGE) {

			if (CONFIG.app.behavior.autoCreateGlitterLayer) {
				const newLayer = this.glitterManager.createLayer();
				this.layerManager.insertLayer(newLayer);
				this.glitterFillSelector(x, y, event);
			} else {
				this.updateStatus('Please create a glitter layer first');
			}

		} else if (layer.type === LayerType.STICKER) {
			const hitSticker = this.layerManager.isPointInSticker(layer, x, y);

			if (hitSticker) {

				if (CONFIG.app.behavior.autoCreateGlitterLayer) {
					const newLayer = this.glitterManager.createLayer();
					this.layerManager.insertLayer(newLayer);
					this.glitterFillSelector(x, y, event);
				} else {
					this.updateStatus('Color Fill disabled on Sticker layers.');
				}
				return;
			}

			let glitterLayer = null;

			for (let i = this.layerManager.layers.length - 1; i >= 0; i--) {
				const testLayer = this.layerManager.layers[i];
				if (!testLayer.visible || testLayer.type !== LayerType.GLITTER_FILL) continue;

				if (hasMaskContent(testLayer)) {
					const isHit = this.layerManager.isPixelInLayerSelection(testLayer, x, y);
					if (isHit) {
						glitterLayer = testLayer;
						break;
					}
				}
			}

			if (glitterLayer) {
				this.layerManager.selectLayerFromCanvas(glitterLayer.id);
			} else {
				const newLayer = this.glitterManager.createLayer();
				this.layerManager.insertLayer(newLayer);
			}

			this.glitterFillSelector(x, y, event);
		}
	}

	handleLayerSelectAction(x, y, options = {}) {
		if (this.currentTool !== ToolType.SELECT) return;
		if (this.autoGlitterManager?.isSessionActive()) {
			this.autoGlitterManager.handleCanvasSelect(x, y);
			return;
		}
		if (!CONFIG.app.behavior.autoSelect || this.justCompletedDrag) return;

		this.layerManager.handleLayerPick(x, y, options);
	}

	handleZoomAction(clientX, clientY, options = {}) {
		if (this.currentTool !== ToolType.ZOOM || !this.originalImage) return;

		if (options.zoomOut) {
			this.viewport.zoomOut(clientX, clientY, { animate: true });
		} else {
			this.viewport.zoomIn(clientX, clientY, { animate: true });
		}

		this.updateStatus(`Zoom: ${this.viewport.getZoomPercentage()}%`);
	}



	glitterFillSelector(x, y, event) {
		let layer = this.layerManager.getActiveLayer();

		if (!layer) {
			this.updateStatus('Please select the Base Image or a Glitter Layer.');
			return;
		}

		// Case 1: Base Image is Selected -> Create NEW Glitter Layer
		if (layer.type === LayerType.BASE_IMAGE) {
			const newLayer = this.glitterManager.createLayer();
			this.layerManager.insertLayer(newLayer);  // Use the new method
			layer = newLayer; // Switch target to the new layer
			this.updateStatus('Created new layer from Base Image');
		}
		// Case 2: Glitter Fill Layer is Selected -> Use it
		else if (layer.type === LayerType.GLITTER_FILL) {
			// Continue using this layer
		}
		// Case 3: Sticker (or other) -> Block
		else {
			this.updateStatus('Color Fill disabled on Sticker layers.');
			return;
		}

		const pixelIndex = y * this.originalCanvas.width + x;
		const alpha = this.originalAlphaChannel[pixelIndex];
		const isTransparent = alpha < CONFIG.tools.selection.transparency.alphaThreshold;

		// 1. Config Check: Block if transparent and selection isn't allowed
		if (isTransparent && !CONFIG.tools.selection.transparency.allowTransparentSelection) {
			this.updateStatus('Cannot select transparent pixels');
			return;
		}

		const i = pixelIndex * 4;

		// 2. Data Extraction
		// If it's transparent, we force RGB to 0 to be clean, 
		// because the 'isTransparent' flag will do the heavy lifting in the mask logic.
		const r = isTransparent ? 0 : this.originalImageData.data[i];
		const g = isTransparent ? 0 : this.originalImageData.data[i + 1];
		const b = isTransparent ? 0 : this.originalImageData.data[i + 2];

		// 3. Multi-Select Logic with Shift Key Support
		const shiftPressed = event && event.shiftKey;

		// If Shift is pressed, enable multi-select
		if (shiftPressed && !layer.settings.multiSelect) {
			layer.settings.multiSelect = true;

			// Update UI checkboxes
			const multiSelect = document.getElementById('multiSelect');
			const contextMultiSelect = document.getElementById('contextMultiSelect');
			if (multiSelect) multiSelect.checked = true;
			if (contextMultiSelect) contextMultiSelect.checked = true;

			this.updateStatus('Multi-select enabled');
		}

		// If multi-select is off (and shift wasn't pressed), clear previous selections
		const multiSelect = layer.settings.multiSelect;
		if (!multiSelect) layer.selections = [];

		// 4. Save the Selection
		layer.selections.push({
			r, g, b, x, y,
			isTransparent: isTransparent
		});

		// 5. UI & Preview Updates (Crucial: These must happen after pushing the data)
		this.saveState(); // For Undo/Redo

		// G-1b: paint the chip/status/toolbar feedback on this frame, *before*
		// kicking off the (potentially slow) mask pipeline, so the click never
		// looks like dead air. updatePreview is deferred a frame so the browser
		// actually gets to paint the above first.
		this.updateActionButtons();
		this.updateSelectedColorsDisplay(); // To show "Transparent" or the RGB values in the sidebar
		this.updateContextToolbars();
		this.updateHelpfulMessage();
		this.updateStatus('Applying glitter…');

		this.glitterManager.markMaskRequestStart(layer.id);
		requestAnimationFrame(() => this.updatePreview()); // To show the new glitter fill

	}

	// G-1b: fires whenever a mask encode starts/settles for any glitter layer.
	// Recomputed from ground truth (isMaskPending for the CURRENTLY active layer)
	// rather than trusting this event's own layerId/isPending, so switching the
	// active layer mid-encode can't leave the busy cursor stuck.
	onMaskPendingChange(layerId, isPending) {
		if (this.currentTool === ToolType.BRUSH) return; // brush has its own cursor UI

		const previewContainer = document.getElementById('previewContainer');
		const activeLayer = this.layerManager.getActiveLayer();
		const activeIsPending = Boolean(activeLayer && this.glitterManager.isMaskPending(activeLayer.id));

		if (previewContainer) {
			previewContainer.style.cursor = activeIsPending ? 'progress' : '';
		}

		if (!isPending && activeLayer && activeLayer.id === layerId) {
			this.updateStatus('Glitter applied');
		}
	}

	updateSelectedColorsDisplay() {
		const container = document.getElementById('selectedColorsDisplay');
		if (!container) return;

		const layer = this.layerManager.getActiveLayer();

		// Only show for glitter layers with selections
		if (!layer || layer.type !== LayerType.GLITTER_FILL || !layer.selections || layer.selections.length === 0) {
			document.getElementById('selectedColorsEmpty')?.classList.add('visible');
			container.innerHTML = '';
			return;
		}

		document.getElementById('selectedColorsEmpty')?.classList.remove('visible');
		container.innerHTML = '';

		layer.selections.forEach((sel, index) => {
			const chip = document.createElement('div');
			chip.className = 'selected-color-chip';

			const swatch = document.createElement('div');
			swatch.className = 'selected-color-swatch';
			swatch.style.backgroundColor = `rgb(${sel.r}, ${sel.g}, ${sel.b})`;

			const text = document.createElement('span');
			text.textContent = `${sel.r},${sel.g},${sel.b}`;

			const removeBtn = document.createElement('button');
			removeBtn.className = 'selected-color-remove';
			removeBtn.type = 'button';
			removeBtn.textContent = '×';
			removeBtn.title = 'Remove this color selection';
			removeBtn.setAttribute('aria-label', `Remove color ${sel.r}, ${sel.g}, ${sel.b}`);
			removeBtn.onclick = () => this.removeColorSelection(index);

			chip.append(swatch, text, removeBtn);
			container.appendChild(chip);
		});
	}

	removeColorSelection(index) {
		const layer = this.layerManager.getActiveLayer();

		// Only works on glitter layers
		if (!layer || layer.type !== LayerType.GLITTER_FILL || !layer.selections) {
			return;
		}

		layer.selections.splice(index, 1);
		this.saveState();

		if (hasMaskContent(layer)) {
			this.updatePreview();
		} else {
			this.clearPreview();
		}

		this.updateActionButtons();
		this.updateSelectedColorsDisplay();
		this.updateContextToolbars();
		this.updateHelpfulMessage();
	}

	clearPreview() {
		this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
		if (this.originalImageData) this.renderPreviewCanvas([]);

		// Clear glitter backgrounds
		this.canvasElementsContainer.innerHTML = '';
		if (this.glitterManager) {
			this.glitterManager.layerElements.clear();
		}

		// Clear sticker elements
		if (this.stickerManager) {
			this.stickerManager.layerElements.forEach((element, layerId) => {
				if (element.parentNode) {
					element.parentNode.removeChild(element);
				}
			});
			this.stickerManager.layerElements.clear();
		}

		if (this.textGlitterManager) {
			this.textGlitterManager.clearElements();
		}
	}

	// ===== PREVIEW & RENDERING =====
	updatePreview() {
		if (!this.originalImageData) {
			this.clearPreview();
			return;
		}

		const layersToShow = this.showAllLayers
			? this.layers.filter(l => l.visible && layerHasVisibleContent(l))
			: [this.layerManager.getActiveLayer()].filter(l => l && l.visible && layerHasVisibleContent(l));

		if (layersToShow.length === 0) {
			this.renderPreviewCanvas(layersToShow);
			this.glitterManager.renderContent(layersToShow);
			this.stickerManager.renderContent(layersToShow);
			this.textGlitterManager.renderContent(layersToShow);
			this.shapeGlitterManager.renderContent(layersToShow);
			return;
		}

		this.renderPreviewCanvas(layersToShow);

		// Use the manager to render the glitter backgrounds
		this.glitterManager.renderContent(layersToShow);

		this.stickerManager.renderContent(layersToShow);
		this.textGlitterManager.renderContent(layersToShow);
		this.shapeGlitterManager.renderContent(layersToShow);
	}

	renderPreviewCanvas(layersToShow) {
		// Clear canvas first
		this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);

		// ============================================================
		// UPDATED LOGIC: BASE IMAGE VISIBILITY
		// ============================================================

		// Find the Base Image layer in the stack
		const baseLayer = this.layers.find(l => l.type === LayerType.BASE_IMAGE);

		// If the base layer exists and is set to hidden, stop here (leave canvas transparent)
		if (baseLayer && !baseLayer.visible) {
			return;
		}

		const background = this.baseBackgroundManager?.normalizeLayer(baseLayer)?.background;
		const mode = background?.mode || 'image';
		if ((mode === 'image' && this.baseBackgroundManager?.hasBaseImage()) || mode === 'gradient') {
			const width = this.previewCanvas.width;
			const height = this.previewCanvas.height;
			const source = this.baseBackgroundManager.getBackgroundSourceImageData(background, width, height);
			const settings = background.pixelEffects;
			const processed = !settings.pixelateEnabled && !settings.paletteEnabled
				? source
				: this.baseBackgroundManager.getPreviewImageData(source, width, height, settings);
			this.renderBasePreviewImageData(background, processed);
		} else if (mode === 'solid') {
			this.previewCtx.save();
			this.previewCtx.globalAlpha = background.opacity / 100;
			this.previewCtx.fillStyle = background.color;
			this.previewCtx.fillRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
			this.previewCtx.restore();
		}
	}

	renderBasePreviewImageData(background, processed) {
		if (!processed) return;
		const image = new ImageData(new Uint8ClampedArray(processed.data), processed.width, processed.height);
		applyColorAdjustToImageData(image, background.colorAdjust);
		if (background.opacity < 100) {
			for (let offset = 3; offset < image.data.length; offset += 4) image.data[offset] = Math.round(image.data[offset] * background.opacity / 100);
		}
		this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
		this.previewCtx.putImageData(image, 0, 0);
	}

	// ===== EXPORT PROGRESS =====
	showExportProgress() {
		const progress = document.getElementById('exportProgress');
		const fill = document.getElementById('exportProgressFill');
		const text = document.getElementById('exportProgressText');
		const time = document.getElementById('exportProgressTime');
		progress.classList.add('visible');
		fill.style.width = '0%';
		text.textContent = 'Preparing...';
		time.textContent = '';
		this.exportStartTime = Date.now();
		this.exportCancelled = false;
	}

	updateExportProgress(percent, message, currentFrame = 0, totalFrames = 0) {
		const fill = document.getElementById('exportProgressFill');
		const text = document.getElementById('exportProgressText');
		const time = document.getElementById('exportProgressTime');
		fill.style.width = `${percent}%`;
		text.textContent = message;
		if (percent > 0 && currentFrame > 0 && totalFrames > 0) {
			const elapsed = Date.now() - this.exportStartTime;
			const estimatedTotal = (elapsed / percent) * 100;
			const remaining = estimatedTotal - elapsed;
			if (remaining > 1000) {
				const seconds = Math.ceil(remaining / 1000);
				time.textContent = `~${seconds}s remaining`;
			}
		}
	}

	hideExportProgress() {
		document.getElementById('exportProgress').classList.remove('visible');
	}

	validateExportSettings() {
		const settings = this.exportSettings;
		if (!['gif', 'mp4'].includes(settings.format)) settings.format = CONFIG.export.defaults.format;
		if (!['duration', 'loops'].includes(settings.mp4LengthMode)) settings.mp4LengthMode = CONFIG.export.mp4.lengthMode;
		if (!Number.isFinite(settings.mp4TargetDuration)) settings.mp4TargetDuration = CONFIG.export.mp4.targetDurationSeconds;
		settings.mp4TargetDuration = Math.min(
			CONFIG.export.mp4.maxDurationSeconds,
			Math.max(CONFIG.export.mp4.minDurationSeconds, settings.mp4TargetDuration)
		);
		if (!Number.isFinite(settings.mp4LoopCount)) settings.mp4LoopCount = CONFIG.export.mp4.loopCount;
		settings.mp4LoopCount = Math.min(
			CONFIG.export.mp4.maxLoopCount,
			Math.max(CONFIG.export.mp4.minLoopCount, Math.round(settings.mp4LoopCount))
		);
		if (!CONFIG.export.mp4.qualityPresets[settings.mp4Quality]) settings.mp4Quality = CONFIG.export.mp4.defaultQuality;

		// Validate and clamp frame delay (minimum 20ms)
		if (typeof settings.frameDelay !== 'number' || settings.frameDelay < 20) {
			console.warn('Invalid frameDelay, clamping to 20ms');
			settings.frameDelay = 20;
		}

		// Validate and clamp max frames (1 to hard limit)
		const hardLimit = CONFIG.export.limits.maxFramesHardLimit || 1000;
		if (typeof settings.maxFrames !== 'number' || settings.maxFrames < 1) {
			console.warn('Invalid maxFrames, setting to default');
			settings.maxFrames = CONFIG.export.defaults.maxFrames;
		} else if (settings.maxFrames > hardLimit) {
			console.warn(`maxFrames exceeds hard limit, capping at ${hardLimit}`);
			settings.maxFrames = hardLimit;
		}

		// Validate quality (1-30)
		if (typeof settings.quality !== 'number' || settings.quality < 1 || settings.quality > 30) {
			console.warn('Invalid quality, setting to default');
			settings.quality = CONFIG.export.defaults.quality;
		}

		// Validate frame skip (must be positive integer)
		if (typeof settings.exportFrameSkip !== 'number' || settings.exportFrameSkip < 1) {
			console.warn('Invalid exportFrameSkip, setting to 1');
			settings.exportFrameSkip = 1;
		}

		// Validate boolean settings
		settings.ditherEnabled = Boolean(settings.ditherEnabled);
		settings.baseImage = Boolean(settings.baseImage);
		settings.transparency = Boolean(settings.transparency);
		settings.watermarkEnabled = Boolean(settings.watermarkEnabled);
		settings.exportReverse = Boolean(settings.exportReverse);
		settings.smartFrameReduction = Boolean(settings.smartFrameReduction);
		if (!CONFIG.export.timeline.presets[settings.optimizationPreset]) {
			settings.optimizationPreset = CONFIG.export.timeline.defaultPreset;
		}
		if (!Number.isFinite(settings.maxSamplingFps)) settings.maxSamplingFps = CONFIG.export.defaults.maxSamplingFps;
		settings.maxSamplingFps = Math.max(1, Math.min(CONFIG.export.timeline.maxSamplingFps, Math.round(settings.maxSamplingFps)));

		// Validate string settings
		if (typeof settings.ditherType !== 'string' || !settings.ditherType) {
			settings.ditherType = CONFIG.export.defaults.ditherType;
		}
		if (typeof settings.matteColor !== 'string' || !settings.matteColor.match(/^#[0-9A-Fa-f]{6}$/)) {
			settings.matteColor = CONFIG.export.defaults.matteColor;
		}
	}

	async exportAnimatedGif() {
		// Filter visible layers (ephemeral Auto Glitter previews never export)
		const visibleLayers = this.layers.filter(l => {
			if (!l.visible || l.isPreview) return false;
			return layerHasVisibleContent(l);
		});

		if (visibleLayers.length === 0) {
			this.showError('No visible layers with content to export!');
			return;
		}

		// Validate export settings before proceeding
		this.validateExportSettings();
		const format = this.exportSettings.format;
		const activeExporter = format === 'mp4' ? this.mp4Exporter : this.exporter;
		activeExporter.setFileName(this.getProjectFileName(format));

		const exportBtn = document.getElementById('exportGif');
		exportBtn.disabled = true;
		this.showExportProgress();

		// USE this.exportSettings directly - no DOM reading!
		dbg('Export settings:', this.exportSettings);

		const exportParams = {
			visibleLayers: visibleLayers,
			glitterGifs: this.glitterManager.content,
			canvasData: {
				width: this.originalCanvas.width,
				height: this.originalCanvas.height,
				originalData: new Uint8ClampedArray(this.originalImageData.data),
				originalAlpha: this.originalAlphaChannel,
				alphaThreshold: CONFIG.tools.selection.transparency.alphaThreshold,
				hasBaseImage: this.baseBackgroundManager?.hasBaseImage() ?? true
			},
			exportSettings: this.exportSettings,
			callbacks: {
				onStatus: (msg) => this.updateStatus(msg),
				onProgress: (percent, text, currentFrame, totalFrames) => {
					if (this.exportCancelled) throw new Error('Export cancelled');
					this.updateExportProgress(percent, text, currentFrame, totalFrames);
				},
				onComplete: () => {
					exportBtn.disabled = false;
					this.isSaved = true;
					this.hideExportProgress();
				},
				onError: (error) => {
					// Fired by gif.js encoder events, outside our try/catch below
					exportBtn.disabled = false;
					this.hideExportProgress();
					if (error.message !== 'Export cancelled') {
						this.showError('Export failed: ' + error.message);
					}
				},
				parseGif: (url) => this.glitterManager.parseGifFromUrl(url),
				createMask: (layer) => this.maskCompositor.getMaskData(layer),
				renderTextMask: (layer) => this.textGlitterManager.renderTextMask(layer),
				renderShapeMask: (layer) => this.shapeGlitterManager.buildMaskEntry(layer),
				ensureTextFont: (fontId) => this.textGlitterManager.ensureFontLoaded(fontId)
			}
		};

		setTimeout(async () => {
			try {
				await activeExporter.process(exportParams);
			} catch (error) {
				console.error('Export error:', error);
				exportBtn.disabled = false;
				this.hideExportProgress();
				if (error.message !== 'Export cancelled') {
					this.showError('Export failed: ' + error.message);
				}
			}
		}, 50);
	}

	showError(message) {
		const toast = document.getElementById('errorToast');
		document.getElementById('errorText').textContent = message;
		toast.classList.add('visible');

		setTimeout(() => {
			if (toast.classList.contains('visible')) {
				this.hideError();
			}
		}, 5000);
	}

	hideError() {
		document.getElementById('errorToast').classList.remove('visible');
	}

	updateStatus(message) {
		document.getElementById('statusText').textContent = message;
	}
}


// everything inside IIFE
(async () => {
	const editor = new GlitterEditor();
	await editor.init();

	// (Tooltips are handled by the global tooltipManager created in core/utils.js)

	// Load debug configuration if enabled
	if (DEBUG_CONFIG.enabled) {
		await editor.loadDebugConfig();
	}

	// Make editor globally accessible (optional, useful for debugging)
	window.editor = editor;
})();

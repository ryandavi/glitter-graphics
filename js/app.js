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

		// ============================================================================
		// TOOL & HISTORY
		// ============================================================================
		this.currentTool = null;

		// ============================================================================
		// DISPLAY SETTINGS
		// ============================================================================
		this.showAllLayers = true;
		this.showHints = CONFIG.defaultShowHints;
		this.currentHintDismissed = false;

		// ============================================================================
		// GLOBAL SETTINGS
		// ============================================================================
		this.refineGlobal = CONFIG.refineGlobalDefault;
		this.glitterGlobal = CONFIG.glitterGlobalDefault;

		// ============================================================================
		// STATE FLAGS
		// ============================================================================
		this.isSaved = false;
		this.touchGestureActive = false;
		this.justCompletedDrag = false; // Flag to prevent layer picking immediately after drag
		this.pendingConfirmationResolve = null;
		this.pendingConfirmationValue = false;

		// ============================================================================
		// EXPORT STATE
		// ============================================================================
		this.exportStartTime = 0;
		this.exportCancelled = false;

		// ============================================================================
		// MANAGERS
		// ============================================================================
		this.viewport = new ViewportManager(this.previewContainer, this.previewWrapper);
		this.viewport.editor = this;
		this.layerManager = new LayerManager(this);
		this.stickerManager = new StickerManager(this);
		this.glitterManager = new GlitterManager(this);
		this.textGlitterManager = new TextGlitterManager(this);
		this.mobileManager = new MobileManager(this);
		this.maskCompositor = new MaskCompositor(this);
		this.maskEditor = new MaskEditor(this);
		this.historyManager = new HistoryManager(this);

		// ============================================================================
		// INITIALIZATION
		// ============================================================================
		this.setTool(CONFIG.defaultTool);
		this.setupEventListeners();
		this.initializeCollapsibleSections();
		this.initializeShortcutsModal();
		this.initializeExportSettings();
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
		await this.stickerManager.init();
		await this.glitterManager.init(); // NEW
		await this.textGlitterManager.init();
		this.updateSidePanelUI(null);
	}

	// ===== SETTINGS PERSISTENCE =====

	saveSettingsToStorage() {
		const settings = {
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
			exportBaseImage: this.exportSettings.baseImage,
			showHelpfulHints: this.showHints
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

	// Initialize export settings with saved values or defaults
	this.exportSettings = {
		quality: savedSettings?.exportQuality ?? CONFIG.defaultExportQuality,
		ditherEnabled: savedSettings?.exportDitherEnabled ?? CONFIG.defaultExportDitherEnabled,
		ditherType: savedSettings?.exportDitherType ?? CONFIG.defaultExportDitherType,
		baseImage: savedSettings?.exportBaseImage ?? CONFIG.defaultExportBaseImage,
		frameDelay: savedSettings?.exportFrameDelay ?? CONFIG.defaultExportFrameDelay,
		maxFrames: savedSettings?.exportMaxFrames ?? CONFIG.defaultExportMaxFrames,
		transparency: savedSettings?.exportTransparency ?? CONFIG.defaultExportTransparency,
		matteColor: savedSettings?.exportMatteColor ?? CONFIG.defaultExportMatteColor,
		watermarkEnabled: savedSettings?.exportWatermarkEnabled ?? CONFIG.defaultExportWatermarkEnabled,
		exportFrameSkip: savedSettings?.exportFrameSkip ?? CONFIG.defaultExportFrameSkip,
		exportReverse: savedSettings?.exportReverse ?? CONFIG.defaultExportReverse,
		smartFrameReduction: savedSettings?.exportSmartFrameReduction ?? CONFIG.defaultExportSmartFrameReduction
	};

	// Update this.showHints
	this.showHints = savedSettings?.showHelpfulHints ?? CONFIG.defaultShowHints;

	// Sync UI to match exportSettings
	this.syncExportSettingsToUI();

	// Setup listeners
	this.setupExportSettingsListeners();
	this.setupSettingsResetListeners(); // ADD THIS LINE
}

	syncExportSettingsToUI() {
		const uiElements = {
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
			showHelpfulHints: { checked: this.showHints }
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
			matteColorRow.classList.toggle('disabled', this.exportSettings.transparency);
		}
	}


	setupExportSettingsListeners() {
		// Map UI elements to exportSettings properties
		const settingsMap = [
			{ id: 'exportQuality', prop: 'quality', parse: (v) => parseInt(v) },
			{ id: 'exportDitherEnabled', prop: 'ditherEnabled', parse: (v) => v },
			{ id: 'exportDitherType', prop: 'ditherType', parse: (v) => v },
			{ id: 'exportBaseImage', prop: 'baseImage', parse: (v) => v },
			{ id: 'exportTransparency', prop: 'transparency', parse: (v) => v },
			{ id: 'exportMatteColor', prop: 'matteColor', parse: (v) => v },
			{ id: 'exportFrameDelay', prop: 'frameDelay', parse: (v) => parseInt(v) },
			{ id: 'exportMaxFrames', prop: 'maxFrames', parse: (v) => v === 'unlimited' ? CONFIG.maxFramesHardLimit : parseInt(v) },
			{ id: 'exportWatermarkEnabled', prop: 'watermarkEnabled', parse: (v) => v },
			{ id: 'exportFrameSkip', prop: 'exportFrameSkip', parse: (v) => parseInt(v) },
			{ id: 'exportReverse', prop: 'exportReverse', parse: (v) => v },
			{ id: 'exportSmartFrameReduction', prop: 'smartFrameReduction', parse: (v) => v }
		];

		settingsMap.forEach(({ id, prop, parse }) => {
			const element = document.getElementById(id);
			if (!element) return;

			element.addEventListener('change', (e) => {
				const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
				this.exportSettings[prop] = parse(value);
				this.saveSettingsToStorage();

				// Update dependent UI states
				if (id === 'exportDitherEnabled') {
					const ditherTypeRow = document.getElementById('ditherTypeRow');
					if (ditherTypeRow) ditherTypeRow.classList.toggle('disabled', !value);
				}
				if (id === 'exportTransparency') {
					const matteColorRow = document.getElementById('matteColorRow');
					if (matteColorRow) matteColorRow.classList.toggle('disabled', value);
				}
			});
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
	const resetAllBtn = document.querySelector('.reset-all-settings-btn');
	if (resetAllBtn) {
		resetAllBtn.addEventListener('click', () => {
			this.resetAllSettings();
		});
	}
}

resetSettingsSection(section) {
	const sectionName = this.getSectionDisplayName(section);
	
	if (!confirm(`Reset all ${sectionName} to defaults?`)) {
		return;
	}

	switch(section) {
		case 'interface':
			this.showHints = CONFIG.defaultShowHints;
			break;

		case 'export':
			this.exportSettings.baseImage = CONFIG.defaultExportBaseImage;
			this.exportSettings.transparency = CONFIG.defaultExportTransparency;
			this.exportSettings.matteColor = CONFIG.defaultExportMatteColor;
			this.exportSettings.watermarkEnabled = CONFIG.defaultExportWatermarkEnabled;
			break;

		case 'encoding':
			this.exportSettings.ditherEnabled = CONFIG.defaultExportDitherEnabled;
			this.exportSettings.ditherType = CONFIG.defaultExportDitherType;
			this.exportSettings.quality = CONFIG.defaultExportQuality;
			break;

		case 'framecontrol':
			this.exportSettings.frameDelay = CONFIG.defaultExportFrameDelay;
			this.exportSettings.maxFrames = CONFIG.defaultExportMaxFrames;
			this.exportSettings.smartFrameReduction = CONFIG.defaultExportSmartFrameReduction;
			this.exportSettings.exportFrameSkip = CONFIG.defaultExportFrameSkip;
			this.exportSettings.exportReverse = CONFIG.defaultExportReverse;
			break;
	}

	this.syncExportSettingsToUI();
	this.saveSettingsToStorage();
}

resetAllSettings() {
	if (!confirm('Reset ALL settings to defaults? This will reset export settings, interface preferences, and all other settings.')) {
		return;
	}

	// Reset all export settings
	this.exportSettings = {
		quality: CONFIG.defaultExportQuality,
		ditherEnabled: CONFIG.defaultExportDitherEnabled,
		ditherType: CONFIG.defaultExportDitherType,
		baseImage: CONFIG.defaultExportBaseImage,
		transparency: CONFIG.defaultExportTransparency,
		matteColor: CONFIG.defaultExportMatteColor,
		frameDelay: CONFIG.defaultExportFrameDelay,
		maxFrames: CONFIG.defaultExportMaxFrames,
		watermarkEnabled: CONFIG.defaultExportWatermarkEnabled,
		exportFrameSkip: CONFIG.defaultExportFrameSkip,
		exportReverse: CONFIG.defaultExportReverse,
		smartFrameReduction: CONFIG.defaultExportSmartFrameReduction
	};

	// Reset UI preferences
	this.showHints = CONFIG.defaultShowHints;

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
	}

	updateSidePanelUI(layer) {
		// 1. Define ALL possible sections to hide them first
		const allSections = [
			'welcomeSection',
			'noLayerSettingsSection',
			'baseLayerSettingsSection',
			'glitterSettingsSection',
			'layerSettingsSection',
			'glitterOptions',
			'glitterSearchSection',
			'stickerSettingsSection',
			'textSettingsSection',
			'stickersOptions',
			'stickersSearchSection'
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
		if (!this.originalImage) {
			config = LAYER_UI_CONFIG.NO_IMAGE;
		} else if (!layer) {
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
	}

	getPreferredDesignSection(layer) {
		if (!this.originalImage || !layer || layer.type === LayerType.BASE_IMAGE) {
			return 'designGallery';
		}

		if (layer.type === LayerType.TEXT_GLITTER) {
			return 'textSettings';
		}

		if (layer.type === LayerType.STICKER) {
			return 'stickerSettings';
		}

		return 'glitterSettings';
	}

	updateZoomUI() {
		const percentage = this.viewport.getZoomPercentage();
		document.getElementById('zoomPercentage').textContent = `${percentage}%`;
		document.getElementById('statusZoom').textContent = `${percentage}%`;


		document.getElementById('zoomOut').disabled = this.viewport.currentZoomIndex <= 0;
		document.getElementById('zoomIn').disabled = this.viewport.currentZoomIndex >= CONFIG.zoomLevels.length - 1;

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

		const baseSize = CONFIG.baseGridSize;
		const size = baseSize * this.viewport.currentZoom;
		const half = size / 2;

		this.previewWrapper.style.backgroundSize = `${size}px ${size}px`;
		this.previewWrapper.style.backgroundPosition =
			`${this.viewport.panX}px ${this.viewport.panY}px, ${this.viewport.panX}px ${this.viewport.panY + half}px, ${this.viewport.panX + half}px ${this.viewport.panY - half}px, ${this.viewport.panX - half}px ${this.viewport.panY}px`;
	}

	// ===== UX: EMPTY STATE MANAGEMENT =====

	showLayerSettingsEmptyState(title = 'No layer selected', subtext = '') {
		const empty = document.getElementById('layerSettingsEmpty');
		const controls = document.getElementById('layerSettingsControls');
		const emptyText = document.getElementById('layerSettingsEmptyText');
		const emptySubtext = document.getElementById('layerSettingsEmptySubtext');
		if (empty) empty.classList.add('visible');
		if (controls) controls.classList.remove('visible');
		if (emptyText) emptyText.textContent = title;
		if (emptySubtext) emptySubtext.textContent = subtext;
	}

	hideLayerSettingsEmptyState() {
		const empty = document.getElementById('layerSettingsEmpty');
		const controls = document.getElementById('layerSettingsControls');
		if (empty) empty.classList.remove('visible');
		if (controls) controls.classList.add('visible');
	}

	showGlitterSettingsEmptyState() {
		const empty = document.getElementById('glitterSettingsEmpty');
		const controls = document.getElementById('glitterSettingsControls');
		if (empty) empty.classList.add('visible');
		if (controls) controls.classList.remove('visible');
	}

	hideGlitterSettingsEmptyState() {
		const empty = document.getElementById('glitterSettingsEmpty');
		const controls = document.getElementById('glitterSettingsControls');
		if (empty) empty.classList.remove('visible');  // ← FIXED
		if (controls) controls.classList.add('visible');
	}

	collapseLayerSettings() {
		const content = document.getElementById('layerSettingsContent');
		const toggle = document.getElementById('layerSettingsToggle');
		if (content) content.classList.remove('visible');
		if (toggle) toggle.classList.add('collapsed');
	}

	collapseGlitterSettings() {
		const content = document.getElementById('glitterSettingsContent');
		const toggle = document.getElementById('glitterSettingsToggle');
		if (content) content.classList.remove('visible');
		if (toggle) toggle.classList.add('collapsed');
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
		const empty = document.getElementById('stickerSettingsEmpty');
		const controls = document.getElementById('stickerSettingsControls');
		if (empty) empty.classList.add('visible');
		if (controls) controls.classList.remove('visible');
	}

	hideStickerSettingsEmptyState() {
		const empty = document.getElementById('stickerSettingsEmpty');
		const controls = document.getElementById('stickerSettingsControls');
		if (empty) empty.classList.remove('visible');
		if (controls) controls.classList.add('visible');
	}

	collapseStickerSettings() {
		const content = document.getElementById('stickerSettingsContent');
		const toggle = document.getElementById('stickerSettingsToggle');
		if (content) content.classList.remove('visible');
		if (toggle) toggle.classList.add('collapsed');
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

		// Thumbnail with click handler
		if (thumbnail) {
			renderThumbnail(thumbnail, asset);
			thumbnail.style.cursor = 'pointer';

			// Remove old listeners and add new one
			thumbnail.replaceWith(thumbnail.cloneNode(true));
			const newThumbnail = document.getElementById(`${prefix}Thumbnail`);

			// Re-render after cloning
			renderThumbnail(newThumbnail, asset);

			newThumbnail.addEventListener('click', () => {
				if (manager && manager.browser) {
					manager.browser.navigateToItem(asset.id);
				}
			});
		}

		// Name
		if (name) name.textContent = asset.name || 'Undefined';

		// Badges
		if (badges) {
			const badgeHTML = [];

			// Category badge (clickable)
			if (asset.category) {
				const categoryName = asset.category.charAt(0).toUpperCase() + asset.category.slice(1);
				badgeHTML.push(`<div class="asset-info-badge badge-category" data-category="${asset.category}">${categoryName}</div>`);
			}

			// Animated badge
			if (asset.isAnimated) {
				badgeHTML.push('<div class="asset-info-badge badge-animated">Animated</div>');
			}


			// Transparency badge
			if (asset.hasTransparency) {
				badgeHTML.push('<div class="asset-info-badge badge-transparency">Transparent</div>');
			}

			// Variable frame rate badge
			if (asset.isVariableFramerate) {
				badgeHTML.push('<div class="asset-info-badge badge-variable-fps">Variable FPS</div>');
			}


			// Type-specific badges
			if (getExtraBadges) {
				const extraBadges = getExtraBadges(asset);
				extraBadges.forEach(badge => {
					badgeHTML.push(`<div class="asset-info-badge ${badge.class}">${badge.text}</div>`);
				});
			}

			badges.innerHTML = badgeHTML.join('');

			// Add click listener to category badge
			const categoryBadge = badges.querySelector('.badge-category');
			if (categoryBadge) {
				categoryBadge.addEventListener('click', () => {
					if (manager && manager.browser) {
						manager.browser.navigateToItem(asset.id);
					}
				});
			}
		}

		// Size - handle undefined
		if (size) {
			if (asset.width && asset.height) {
				size.textContent = `${asset.width} × ${asset.height} px`;
			} else {
				size.textContent = 'Undefined';
			}
		}

		// Frames and frame rate - handle undefined




		let frameText = '';

		if (asset.frameCount !== undefined && asset.frameCount !== null) {
			// Add frame rate if available and animated
			if (asset.isAnimated && asset.frameRate) {
				frameText = `${asset.frameCount}`;

				if (asset.isVariableFramerate) {
					frameText += ` @ Variable fps`;
				} else {
					frameText += ` @ ${asset.frameRate} fps`;
				}

			}else{
				frameText = 'Static';
			}
		} else {
			frameText = 'Undefined';
		}

		frames.textContent = frameText;
		
	}

	// Convenience wrappers
	updateGlitterAssetInfo(glitter) {
		this.updateAssetInfo(glitter, 'glitter');
	}

	updateStickerAssetInfo(sticker) {
		this.updateAssetInfo(sticker, 'sticker');
	}


	loadActiveLayerSettings() {
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
			scaleValue.textContent = s.scale + '%';
			this.updateResetButton('scale');
		}

		if (opacity && opacityValue) {
			opacity.value = s.opacity;
			opacityValue.textContent = s.opacity + '%';
			this.updateResetButton('opacity');
		}

		if (layer.selectedGlitterId) {
			const glitter = this.glitterManager.getItemById(layer.selectedGlitterId);
			if (glitter) {
				this.updateGlitterAssetInfo(glitter);
			}
		}

		this.updateSelectedColorsDisplay();
		this.maskEditor?.loadLayer(layer);
	}

	loadStickerSettings(layer) {
		if (!layer || layer.type !== LayerType.STICKER) return;

		this.loadTransformSettings(layer, 'sticker');

		// Update sticker asset info
		if (layer.stickerSourceId) {
			const sticker = this.stickerManager.getItemById(layer.stickerSourceId);
			if (sticker) {
				this.updateStickerAssetInfo(sticker);
			}
		}
	}

	saveActiveLayerSettings(refineOnly = false, glitterOnly = false) {
		const settings = {
			threshold: parseInt(document.getElementById('threshold').value),
			feather: parseInt(document.getElementById('feather').value),
			scale: parseInt(document.getElementById('scale').value),
			opacity: parseInt(document.getElementById('opacity').value),
			contiguous: document.getElementById('contiguous').checked,
			invert: document.getElementById('invert').checked,
			multiSelect: document.getElementById('multiSelect').checked
		};

		const activeLayer = this.layerManager.getActiveLayer();
		// Only apply to active layer if it is a Glitter Fill layer
		if (activeLayer && activeLayer.type === LayerType.GLITTER_FILL) {
			activeLayer.settings = settings;
			this.maskCompositor.invalidate(activeLayer.id);
		}

		// Handle Global Refine (Threshold/Feather)
		if (this.refineGlobal && refineOnly) {
			this.layers.forEach(layer => {
				// FIX: Only apply to Glitter Fill layers
				if (layer.type === LayerType.GLITTER_FILL && layer.settings) {
					layer.settings.threshold = settings.threshold;
					layer.settings.feather = settings.feather;
					this.maskCompositor.invalidate(layer.id);
				}
			});
		}

		// Handle Global Glitter (Scale/Opacity)
		if (this.glitterGlobal && glitterOnly) {
			this.layers.forEach(layer => {
				// FIX: Only apply to Glitter Fill layers
				if (layer.type === LayerType.GLITTER_FILL && layer.settings) {
					layer.settings.scale = settings.scale;
					layer.settings.opacity = settings.opacity;
					this.maskCompositor.invalidate(layer.id);
				}
			});
		}
	}

	updateGlitterSelection() {
		const layer = this.layerManager.getActiveLayer();
		const selectedGlitterId = layer?.type === LayerType.TEXT_GLITTER
			? this.textGlitterManager?.resolveSelectedGlitterId(layer)
			: layer?.selectedGlitterId;

		// Query all glitter options in BOTH traditional grid AND asset browser
		const glitterOptions = document.querySelectorAll(
			'.asset-options .asset-option, #glitterItemGrid .asset-option, #glitterSearchResults .asset-option'
		);

		glitterOptions.forEach(opt => {
			const isSelected = layer && (layer.type === LayerType.GLITTER_FILL || layer.type === LayerType.TEXT_GLITTER) &&
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
		const sections = ['designGallery', 'layerSettings', 'glitterSettings', 'stickerSettings', 'textSettings'];

		const setOpen = (name, isOpen, accordion = false) => {
			const section = document.getElementById(`${name}Section`);
			const content = document.getElementById(`${name}Content`);
			const toggle = document.getElementById(`${name}Toggle`);
			if (section) section.classList.toggle('is-open', isOpen);
			if (content) content.classList.toggle('visible', isOpen);
			if (toggle) toggle.classList.toggle('collapsed', !isOpen);

			if (isOpen && accordion && CONFIG.designPanelAccordion) {
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

				const isOpen = !content.classList.contains('visible');
				setOpen(name, isOpen, true);
			});
		});

		this.syncCollapsibleSections('designGallery');

		this.showLayerSettingsEmptyState();
		this.showGlitterSettingsEmptyState();
		this.showStickerSettingsEmptyState();
	}

	initializeShortcutsModal() {
		const list = document.getElementById('shortcutList');

		Object.entries(CONFIG.shortcuts).forEach(([category, shortcutArray]) => {
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
				keys.className = 'shortcut-keys';

				sc.key.split(' + ').forEach(k => {
					const el = document.createElement('span');
					el.className = 'kbd';
					el.textContent = k;
					keys.appendChild(el);
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
		this.setupZoomListeners();
		this.setupPanListeners();
		this.setupStickerCenterListeners();
		this.setupColorPickerContextListeners();
		this.setupLayerSettingsListeners();
		this.setupSliderListeners();
		this.setupMaskEditorListeners();
		this.setupTransformListeners('sticker', LayerType.STICKER, () => this.stickerManager);
		this.setupTransformListeners('text', LayerType.TEXT_GLITTER, () => this.textGlitterManager);
		this.setupExportListeners();
		this.setupImageListeners();
		this.setupModalListeners();
		this.setupPreviewListeners();
		this.setupGlobalListeners();
		this.setupHelpfulMessageListeners();
	}



	// ===== HELPER: Attach slider with live update and reset =====
	setupSlider(sliderId, valueId, suffix, updateCallback, resetValue) {
		const slider = document.getElementById(sliderId);
		const valueDisplay = document.getElementById(valueId);
		const resetBtn = document.getElementById('reset' + sliderId.charAt(0).toUpperCase() + sliderId.slice(1));

		if (!slider || !valueDisplay) return;

		// Live value display
		slider.addEventListener('input', (e) => {
			valueDisplay.textContent = e.target.value + suffix;
			if (resetBtn) {
				resetBtn.disabled = parseInt(slider.value) === resetValue;
			}
			if (updateCallback) updateCallback(e);
		});

		// Reset button
		if (resetBtn) {
			resetBtn.addEventListener('click', () => {
				slider.value = resetValue;
				valueDisplay.textContent = resetValue + suffix;
				slider.dispatchEvent(new Event('input'));
				slider.dispatchEvent(new Event('change'));
				resetBtn.disabled = true;
			});
			resetBtn.disabled = parseInt(slider.value) === resetValue;
		}
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
			{ id: 'colorPickerTool', type: ToolType.COLOR_PICKER },
			{ id: 'brushTool', type: ToolType.BRUSH },
			{ id: 'handTool', type: ToolType.HAND },
			{ id: 'zoomTool', type: ToolType.ZOOM }
		];

		tools.forEach(({ id, type }) => {
			const btn = document.getElementById(id);
			if (btn) btn.addEventListener('click', () => this.setTool(type));
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

	// ===== ZOOM CONTROL LISTENERS =====
	setupZoomListeners() {
		const controls = [
			{ id: 'zoomIn', handler: () => this.viewport.zoomIn() },
			{ id: 'zoomOut', handler: () => this.viewport.zoomOut() },
			{ id: 'zoomPercentage', handler: () => this.viewport.resetZoom() },
			{ id: 'fitScreen', handler: () => this.viewport.zoomToFit() },
			{ id: 'fillScreen', handler: () => this.viewport.zoomToFill() }
		];

		controls.forEach(({ id, handler }) => {
			const btn = document.getElementById(id);
			if (btn) btn.addEventListener('click', handler);
		});
	}

	setupPanListeners() {
		const controls = [
			{ id: 'centerCanvasHorizontal', handler: () => this.viewport.centerHorizontal() },
			{ id: 'centerCanvasVertical', handler: () => this.viewport.centerVertical() }
		];

		controls.forEach(({ id, handler }) => {
			const btn = document.getElementById(id);
			if (btn) btn.addEventListener('click', handler);
		});
	}

	setupStickerCenterListeners() {
		const centerStickerHorizontal = document.getElementById('centerStickerHorizontal');
		const centerStickerVertical = document.getElementById('centerStickerVertical');

		if (centerStickerHorizontal) {
			centerStickerHorizontal.addEventListener('click', () => {
				const layer = this.layerManager.getActiveLayer();
				if (!layer) return;
				if (layer.type === LayerType.STICKER && this.stickerManager) {
					this.stickerManager.centerHorizontal(layer.id);
				} else if (layer.type === LayerType.TEXT_GLITTER && this.textGlitterManager) {
					this.textGlitterManager.centerHorizontal(layer.id);
				}
			});
		}

		if (centerStickerVertical) {
			centerStickerVertical.addEventListener('click', () => {
				const layer = this.layerManager.getActiveLayer();
				if (!layer) return;
				if (layer.type === LayerType.STICKER && this.stickerManager) {
					this.stickerManager.centerVertical(layer.id);
				} else if (layer.type === LayerType.TEXT_GLITTER && this.textGlitterManager) {
					this.textGlitterManager.centerVertical(layer.id);
				}
			});
		}
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
				this.saveActiveLayerSettings(true, false);
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
		const refineGlobal = document.getElementById('refineGlobal');
		const glitterGlobal = document.getElementById('glitterGlobal');

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

		if (refineGlobal) {
			refineGlobal.addEventListener('change', (e) => {
				this.refineGlobal = e.target.checked;
				if (this.refineGlobal) {
					this.saveActiveLayerSettings(true, false);
					this.updatePreview();
					this.saveState();
					this.updateStatus('Global threshold/feather applied');
				}
			});
		}

		if (glitterGlobal) {
			glitterGlobal.addEventListener('change', (e) => {
				this.glitterGlobal = e.target.checked;
				if (this.glitterGlobal) {
					this.saveActiveLayerSettings(false, true);
					this.updatePreview();
					this.saveState();
					this.updateStatus('Global scale/opacity applied');
				}
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
		}, CONFIG.defaultThreshold);

		// Helper to attach debounced slider updates
		const attachSliderDebounce = (sliderId, saveRefine, saveGlitter) => {
			const slider = document.getElementById(sliderId);
			if (slider) {
				slider.addEventListener('input', () => {
					this.saveActiveLayerSettings(saveRefine, saveGlitter);
					this.debouncedSliderUpdate();
				});
				slider.addEventListener('change', () => this.saveState());
			}
		};

		attachSliderDebounce('threshold', true, false);
		attachSliderDebounce('feather', true, false);
		attachSliderDebounce('scale', false, true);
		attachSliderDebounce('opacity', false, true);
	}

	setupMaskEditorListeners() {
		this.setupSlider('maskBrushSize', 'maskBrushSizeValue', 'px', () => {
			this.maskEditor?._updateBrushCursorSize();
		}, CONFIG.maskBrush.defaultSize);

		this.setupSlider('maskBrushSoftness', 'maskBrushSoftnessValue', '%', () => {
			this.maskEditor?.renderOverlay();
		}, CONFIG.maskBrush.defaultSoftness);

		this.setupSlider('maskBrushFlow', 'maskBrushFlowValue', '%', () => {
			this.maskEditor?.renderOverlay();
		}, CONFIG.maskBrush.defaultFlow);

		this.maskEditor?.setupUIListeners();
	}

	// Shared by sticker and text layers — both carry a transform object of the
	// exact same shape (position/rotation/scale/proportionalScale/opacity/
	// flipX/flipY, see LayerTransform.getTransform()). Position inputs are
	// readonly display-only (see loadTransformSettings) — dragging is how you
	// move a layer, so no listeners are needed for them here.
	getTransformIds(prefix) {
		if (prefix === 'sticker') {
			return {
				posX: 'stickerPosX', posY: 'stickerPosY',
				rotation: 'stickerRotation', rotationValue: 'stickerRotationValue', resetRotation: 'resetStickerRotation',
				opacity: 'stickerOpacity', opacityValue: 'stickerOpacityValue', resetOpacity: 'resetStickerOpacity',
				scaleX: 'stickerScaleX', scaleXValue: 'stickerScaleXValue', resetScaleX: 'resetStickerScaleX',
				scaleY: 'stickerScaleY', scaleYValue: 'stickerScaleYValue', resetScaleY: 'resetStickerScaleY',
				proportional: 'stickerProportionalScale',
				flipX: 'stickerFlipX', flipY: 'stickerFlipY'
			};
		}

		return {
			posX: 'textPosX', posY: 'textPosY',
			rotation: 'textRotation', rotationValue: 'textRotationValue', resetRotation: 'resetTextRotation',
			opacity: 'textLayerOpacity', opacityValue: 'textLayerOpacityValue', resetOpacity: 'resetTextLayerOpacity',
			scaleX: 'textLayerScaleX', scaleXValue: 'textLayerScaleXValue', resetScaleX: 'resetTextLayerScaleX',
			scaleY: 'textLayerScaleY', scaleYValue: 'textLayerScaleYValue', resetScaleY: 'resetTextLayerScaleY',
			proportional: 'textLayerProportionalScale',
			flipX: 'textFlipX', flipY: 'textFlipY'
		};
	}

	getLayerTransformData(layer) {
		return layer?.stickerData?.transform || layer?.textData?.transform || null;
	}

	loadTransformSettings(layer, prefix) {
		const transform = this.getLayerTransformData(layer);
		if (!transform) return;

		const ids = this.getTransformIds(prefix);

		const posX = document.getElementById(ids.posX);
		const posY = document.getElementById(ids.posY);
		if (posX) posX.value = Math.round(transform.position.x);
		if (posY) posY.value = Math.round(transform.position.y);

		const rotation = document.getElementById(ids.rotation);
		const rotationValue = document.getElementById(ids.rotationValue);
		if (rotation && rotationValue) {
			rotation.value = transform.rotation;
			rotationValue.textContent = Math.round(transform.rotation) + '°';
		}

		const scaleX = document.getElementById(ids.scaleX);
		const scaleXValue = document.getElementById(ids.scaleXValue);
		const scaleY = document.getElementById(ids.scaleY);
		const scaleYValue = document.getElementById(ids.scaleYValue);
		const proportional = document.getElementById(ids.proportional);

		if (scaleX && scaleXValue) {
			scaleX.value = transform.scale.x;
			scaleXValue.textContent = Math.round(transform.scale.x) + '%';
		}
		if (scaleY && scaleYValue) {
			scaleY.value = transform.scale.y;
			scaleYValue.textContent = Math.round(transform.scale.y) + '%';
		}
		if (proportional) {
			proportional.checked = transform.proportionalScale;
		}

		const opacity = document.getElementById(ids.opacity);
		const opacityValue = document.getElementById(ids.opacityValue);
		if (opacity && opacityValue) {
			opacity.value = transform.opacity;
			opacityValue.textContent = Math.round(transform.opacity) + '%';
		}

		const flipX = document.getElementById(ids.flipX);
		const flipY = document.getElementById(ids.flipY);
		if (flipX) flipX.checked = transform.flipX;
		if (flipY) flipY.checked = transform.flipY;
	}

	setupTransformListeners(prefix, layerType, getManager) {
		const ids = this.getTransformIds(prefix);
		const activeManager = () => {
			const layer = this.layerManager.getActiveLayer();
			const manager = getManager();
			return (layer && layer.type === layerType && manager) ? { layer, manager } : null;
		};

		// Rotation
		const rotation = document.getElementById(ids.rotation);
		const rotationValue = document.getElementById(ids.rotationValue);
		const resetRotation = document.getElementById(ids.resetRotation);

		if (rotation && rotationValue) {
			rotation.addEventListener('input', (e) => {
				const value = parseFloat(e.target.value);
				rotationValue.textContent = Math.round(value) + '°';

				const active = activeManager();
				if (active) active.manager.updateTransform(active.layer.id, { rotation: value });
			});

			rotation.addEventListener('change', () => this.saveState());
		}

		if (resetRotation) {
			resetRotation.addEventListener('click', () => {
				if (rotation) rotation.value = CONFIG.defaultStickerRotation;
				if (rotationValue) rotationValue.textContent = CONFIG.defaultStickerRotation + '°';

				const active = activeManager();
				if (active) {
					active.manager.updateTransform(active.layer.id, { rotation: CONFIG.defaultStickerRotation });
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
				opacityValue.textContent = Math.round(value) + '%';

				const active = activeManager();
				if (active) active.manager.updateTransform(active.layer.id, { opacity: value });
			});

			opacity.addEventListener('change', () => this.saveState());
		}

		if (resetOpacity) {
			resetOpacity.addEventListener('click', () => {
				if (opacity) opacity.value = CONFIG.defaultStickerOpacity;
				if (opacityValue) opacityValue.textContent = CONFIG.defaultStickerOpacity + '%';

				const active = activeManager();
				if (active) {
					active.manager.updateTransform(active.layer.id, { opacity: CONFIG.defaultStickerOpacity });
					this.saveState();
				}
			});
		}

		// Scale X / Y (+ proportional lock)
		const scaleX = document.getElementById(ids.scaleX);
		const scaleXValue = document.getElementById(ids.scaleXValue);
		const scaleY = document.getElementById(ids.scaleY);
		const scaleYValue = document.getElementById(ids.scaleYValue);
		const proportionalScale = document.getElementById(ids.proportional);
		const resetScaleX = document.getElementById(ids.resetScaleX);
		const resetScaleY = document.getElementById(ids.resetScaleY);

		if (scaleX && scaleXValue) {
			scaleX.addEventListener('input', (e) => {
				const value = parseFloat(e.target.value);
				scaleXValue.textContent = Math.round(value) + '%';

				const active = activeManager();
				if (!active) return;

				if (proportionalScale && proportionalScale.checked) {
					if (scaleY && scaleYValue) {
						scaleY.value = value;
						scaleYValue.textContent = Math.round(value) + '%';
					}
					active.manager.updateTransform(active.layer.id, { scale: { x: value, y: value } });
				} else {
					// Only pass x - let updateTransform preserve y
					active.manager.updateTransform(active.layer.id, { scale: { x: value } });
				}
			});

			scaleX.addEventListener('change', () => this.saveState());
		}

		if (scaleY && scaleYValue) {
			scaleY.addEventListener('input', (e) => {
				const value = parseFloat(e.target.value);
				scaleYValue.textContent = Math.round(value) + '%';

				const active = activeManager();
				if (!active) return;

				if (proportionalScale && proportionalScale.checked) {
					if (scaleX && scaleXValue) {
						scaleX.value = value;
						scaleXValue.textContent = Math.round(value) + '%';
					}
					active.manager.updateTransform(active.layer.id, { scale: { x: value, y: value } });
				} else {
					// Only pass y - let updateTransform preserve x
					active.manager.updateTransform(active.layer.id, { scale: { y: value } });
				}
			});

			scaleY.addEventListener('change', () => this.saveState());
		}

		if (resetScaleX) {
			resetScaleX.addEventListener('click', () => {
				if (scaleX) scaleX.value = CONFIG.defaultStickerScale;
				if (scaleXValue) scaleXValue.textContent = CONFIG.defaultStickerScale + '%';

				const active = activeManager();
				if (!active) return;

				if (proportionalScale && proportionalScale.checked) {
					if (scaleY && scaleYValue) {
						scaleY.value = CONFIG.defaultStickerScale;
						scaleYValue.textContent = CONFIG.defaultStickerScale + '%';
					}
					active.manager.updateTransform(active.layer.id, {
						scale: { x: CONFIG.defaultStickerScale, y: CONFIG.defaultStickerScale }
					});
				} else {
					active.manager.updateTransform(active.layer.id, { scale: { x: CONFIG.defaultStickerScale } });
				}
				this.saveState();
			});
		}

		if (resetScaleY) {
			resetScaleY.addEventListener('click', () => {
				if (scaleY) scaleY.value = CONFIG.defaultStickerScale;
				if (scaleYValue) scaleYValue.textContent = CONFIG.defaultStickerScale + '%';

				const active = activeManager();
				if (!active) return;

				if (proportionalScale && proportionalScale.checked) {
					if (scaleX && scaleXValue) {
						scaleX.value = CONFIG.defaultStickerScale;
						scaleXValue.textContent = CONFIG.defaultStickerScale + '%';
					}
					active.manager.updateTransform(active.layer.id, {
						scale: { x: CONFIG.defaultStickerScale, y: CONFIG.defaultStickerScale }
					});
				} else {
					active.manager.updateTransform(active.layer.id, { scale: { y: CONFIG.defaultStickerScale } });
				}
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
					this.saveState();
				}
			});
		};

		attachFlip(ids.flipX, 'flipX');
		attachFlip(ids.flipY, 'flipY');
	}

	setupImageListeners() {
		const imageUpload = document.getElementById('imageUpload');
		const imageDropzone = document.getElementById('imageDropzone');
		const imageClearBtn = document.getElementById('imageClearBtn');

		// New Canvas button
		const openNewCanvasBtn = document.getElementById('openNewCanvasBtn');
		if (openNewCanvasBtn) {
			openNewCanvasBtn.addEventListener('click', () => {
				const modal = document.getElementById('newCanvasModal');
				if (modal) {
					modal.classList.add('visible');
					this.initializeNewCanvasModal();
				}
			});
		}

		if (imageUpload) {
			imageUpload.addEventListener('change', (e) => this.loadImage(e));
		}

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
				if (file && file.type.startsWith('image/')) {
					const fakeEvent = { target: { files: [file] } };
					await this.loadImage(fakeEvent);
				}
			});
		}

		if (imageClearBtn) {
			imageClearBtn.addEventListener('click', () => {
				if (confirm('Are you sure you want to remove the image? This will clear the image and all layers.')) {
					this.clearImage();
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
		if (widthInput) widthInput.value = CONFIG.defaultCanvasPreset.width;
		if (heightInput) heightInput.value = CONFIG.defaultCanvasPreset.height;
		if (colorInput) colorInput.value = CONFIG.defaultCanvasPreset.color;

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
			if (width === CONFIG.defaultCanvasPreset.width && height === CONFIG.defaultCanvasPreset.height) {
				matchingPreset = btn;
			}
		});

		if (matchingPreset) {
			matchingPreset.classList.add('active');
		}

		// Update orientation buttons based on default dimensions
		this.updateOrientationButtons(CONFIG.defaultCanvasPreset.width, CONFIG.defaultCanvasPreset.height);
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

		// Preset buttons
		presetButtons.forEach(btn => {
			btn.addEventListener('click', () => {
				const width = parseInt(btn.dataset.width);
				const height = parseInt(btn.dataset.height);

				if (widthInput) widthInput.value = width;
				if (heightInput) heightInput.value = height;

				presetButtons.forEach(b => b.classList.remove('active'));
				btn.classList.add('active');

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

				this.updateOrientationButtons(parseInt(widthInput.value), parseInt(heightInput.value));
			});
		}

		// Dimension inputs
		if (widthInput && heightInput) {
			const updateOrientation = () => {
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
			.register('settingsModal', {
				openBtnId: 'settingsBtn',
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
				onClose: () => this.resolvePendingConfirmation(this.pendingConfirmationValue)
			});

		// External content modals with utils.js initialization
		this.modalManager
			.register('aboutModal', {
				openBtnId: 'aboutBtn',
				closeBtnId: 'closeAboutModal',
				externalContentUrl: 'modals/about.html?v=3',
				cacheContent: true,
				resetScrollOnOpen: true,
				onContentLoaded: (modalBody) => {
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
				externalContentUrl: 'modals/guide.html?v=2',
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
			onOpen: () => this.initializeNewCanvasModal()
		});

		// Welcome modal (no open button - shown automatically on first visit)
		this.modalManager.register('welcomeModal', {
			closeBtnId: 'closeWelcomeModal',
			resetScrollOnOpen: false,
			onClose: () => {
				// Mark as seen when close button is clicked
				const checkbox = document.getElementById('welcomeDontShowAgain');
				if (checkbox && checkbox.checked) {
					try {
						localStorage.setItem('glitterEditor_welcomeModalSeen', 'true');
					} catch (e) {
						console.warn('Failed to save welcome modal preference:', e);
					}
				}
			}
		});

		// Setup welcome modal button listeners
		this.setupWelcomeModalListeners();

		// Check if should show welcome modal on page load
		this.checkWelcomeModal();


		// Setup modal-specific interactions
		this.setupConfirmationModalListeners();
		this.setupLayerTypePickerListeners();
		this.setupLayerPanelListeners();
		this.setupStickerUploadModalListeners();
		this.setupNewCanvasModalListeners();
	}

async checkWelcomeModal() {
	const storageKey = 'glitterEditor_welcomeModalSeen';
	
	try {
		const hasBeenSeen = localStorage.getItem(storageKey) === 'true';
		
		if (!hasBeenSeen) {
			// Pre-load guide modal content silently before showing welcome modal
			const guideConfig = this.modalManager.modals.get('guideModal');
			if (guideConfig && guideConfig.externalContentUrl) {
				await this.modalManager.loadExternalContent(guideConfig);
			}
			
			// Small delay so page loads first
			setTimeout(() => {
				this.modalManager.open('welcomeModal');
			}, 500);
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
	
	const markAsSeenIfChecked = () => {
		if (dontShowCheckbox && dontShowCheckbox.checked) {
			try {
				localStorage.setItem(storageKey, 'true');
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
			cancelLabel = 'Cancel'
		} = options;

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
		if (messageNode) messageNode.textContent = message;
		if (confirmBtn) confirmBtn.textContent = confirmLabel;
		if (cancelBtn) cancelBtn.textContent = cancelLabel;

		this.pendingConfirmationValue = false;

		return new Promise((resolve) => {
			this.pendingConfirmationResolve = resolve;
			this.modalManager.open('confirmationModal');
		});
	}


	setupLayerTypePickerListeners() {
		const layerTypeButtons = document.querySelectorAll('.layer-type-option');

		layerTypeButtons.forEach(btn => {
			btn.addEventListener('click', () => {
				const type = btn.dataset.layerType;

				// Map dataset value to LayerType enum
				let layerType;
				switch (type) {
					case 'sticker':
						layerType = LayerType.STICKER;
						break;
					case 'text-glitter':
						layerType = LayerType.TEXT_GLITTER;
						break;
					case 'glitter-fill':
						layerType = LayerType.GLITTER_FILL;
						break;
					default:
						console.error('Unknown layer type:', type);
						return;
				}

				// Close modal FIRST, then add layer
				this.modalManager.close('layerTypePickerModal');

				// Small delay to ensure modal close completes
				requestAnimationFrame(() => {
					this.layerManager.addLayer(layerType);
				});
			});
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
		const addLayerBtn = document.getElementById('addLayerBtn');
		if (addLayerBtn) {
			addLayerBtn.addEventListener('click', () => {
				this.modalManager.open('layerTypePickerModal');
			});
		}

		const mobileAddBtn = document.getElementById('mobileAddLayerBtn');
		if (mobileAddBtn) {
			mobileAddBtn.addEventListener('click', () => {
				// Close all mobile menus first
				if (this.mobileManager && this.mobileManager.isMobile) {
					this.mobileManager.closeAllDrawers();
					this.mobileManager.closeSettings();
				}
				this.modalManager.open('layerTypePickerModal');
			});
		}

		// Bottom bar quick-add buttons - create layers directly
		const layersBarAddGlitter = document.getElementById('layersBarAddGlitter');
		const layersBarAddSticker = document.getElementById('layersBarAddSticker');
		const layersBarAddText = document.getElementById('layersBarAddText');

		if (layersBarAddGlitter) {
			layersBarAddGlitter.addEventListener('click', () => {
				this.layerManager.addLayer(LayerType.GLITTER_FILL);
			});
		}

		if (layersBarAddSticker) {
			layersBarAddSticker.addEventListener('click', () => {
				// Create new sticker layer (NOT upload modal)
				this.layerManager.addLayer(LayerType.STICKER);
			});
		}

		if (layersBarAddText) {
			layersBarAddText.addEventListener('click', () => {
				this.layerManager.addLayer(LayerType.TEXT_GLITTER);
			});
		}

		// Bottom bar action buttons
		const layersBarGoToSelected = document.getElementById('layersBarGoToSelected');
		const layersBarCloneSelected = document.getElementById('layersBarCloneSelected');
		const layersBarDeleteSelected = document.getElementById('layersBarDeleteSelected');

		if (layersBarGoToSelected) {
			layersBarGoToSelected.addEventListener('click', () => {
				const selectedLayer = this.layerManager.getActiveLayer();
				if (!selectedLayer || selectedLayer.type === LayerType.BASE_IMAGE) return;

				if (selectedLayer.type === LayerType.GLITTER_FILL) {
					this.layerManager.goToGlitter(selectedLayer.id);
				} else if (selectedLayer.type === LayerType.STICKER) {
					this.layerManager.goToSticker(selectedLayer.id);
				} else if (selectedLayer.type === LayerType.TEXT_GLITTER) {
					this.layerManager.goToGlitter(selectedLayer.id);
				}
			});
		}

		if (layersBarCloneSelected) {
			layersBarCloneSelected.addEventListener('click', () => {
				const selectedLayer = this.layerManager.getActiveLayer();
				if (!selectedLayer || selectedLayer.type === LayerType.BASE_IMAGE) return;
				this.layerManager.cloneLayer(selectedLayer.id);
			});
		}

		if (layersBarDeleteSelected) {
			layersBarDeleteSelected.addEventListener('click', () => {
				const selectedLayer = this.layerManager.getActiveLayer();
				if (!selectedLayer || selectedLayer.type === LayerType.BASE_IMAGE) return;

				// Add delete confirmation
				if (confirm('Delete this layer?')) {
					this.layerManager.deleteLayer(selectedLayer.id);
				}
			});
		}
	}

	togglePreview() {
		this.showAllLayers = !this.showAllLayers;

		const previewToggle = document.getElementById('previewModeToggle');
		if (previewToggle) {
			previewToggle.classList.toggle('active', !this.showAllLayers);
		}

		this.updatePreview();
		this.updateActionButtons(); // Updates the button title
	}

	setupPreviewListeners() {
		const previewToggle = document.getElementById('previewModeToggle');
		const transparencyToggle = document.getElementById('transparencyToggle');
		const boundsToggle = document.getElementById('boundsToggle');

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

		// In setupEventListeners() or wherever you set up preview container events
		this.previewContainer.addEventListener('pointerdown', (e) => {
			if (e.pointerType === 'touch') {
				return;
			}
			if (this.currentTool === ToolType.TEXT) {
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

	// ===== GLOBAL LISTENERS =====
	setupGlobalListeners() {
		// Keyboard
		document.addEventListener('keydown', (e) => this.handleKeyboard(e));
		document.addEventListener('keyup', (e) => this.handleKeyUp(e));

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

	updateResetButton(sliderId) {
		const resetBtn = document.getElementById('reset' + sliderId.charAt(0).toUpperCase() + sliderId.slice(1));
		const slider = document.getElementById(sliderId);
		const defaultValue = CONFIG['default' + sliderId.charAt(0).toUpperCase() + sliderId.slice(1)];
		if (resetBtn) {
			resetBtn.disabled = parseInt(slider.value) === defaultValue;
		}
	}

	async loadBlankImage(width, height, color = CONFIG.defaultCanvasPreset.color) {
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

		const fakeEvent = {
			target: {
				files: [file]
			}
		};

		await this.loadImage(fakeEvent);
		this.updateStatus(`Created ${width}×${height} canvas`);
	}

	setTool(tool) {
		if (tool === ToolType.BRUSH && !this.maskEditor?.canActivate()) return;

		if (this.currentTool === tool) return;

		this.currentTool = tool;
		this.currentHintDismissed = false; // Reset dismissed flag when tool changes


		// Remove all tool classes from body
		document.body.classList.remove('tool-select', 'tool-text', 'tool-hand', 'tool-colorPicker', 'tool-zoom', 'tool-brush');

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
		if (this.stickerManager && this.textGlitterManager) {
			const activeLayer = this.layerManager.getActiveLayer();
			if (tool === ToolType.SELECT && activeLayer && activeLayer.type === LayerType.STICKER) {
				this.stickerManager.createTransformHandles(activeLayer.id);
				this.textGlitterManager.removeTransformHandles();
			} else if (tool === ToolType.SELECT && activeLayer && activeLayer.type === LayerType.TEXT_GLITTER) {
				this.textGlitterManager.createTransformHandles(activeLayer.id);
				this.stickerManager.removeTransformHandles();
			} else {
				this.stickerManager.removeTransformHandles();
				this.textGlitterManager.removeTransformHandles();
			}
		}

		// Sync mask editing with the active tool (enter/exit brush painting)
		this.maskEditor?.onToolChanged(tool);

		// 3. Update Context Toolbars
		this.updateContextToolbars();


		// Update helpful message
		this.updateHelpfulMessage();

		this.updateStatus(`Active tool: ${tool}`);

	}


	updateContextToolbars() {
		const zoomControls = document.getElementById('zoomControls');
		const panControls = document.getElementById('panControls');
		const stickerCenterControls = document.getElementById('stickerCenterControls');
		const colorPickerControls = document.getElementById('colorPickerControls');

		// Hide all first
		if (zoomControls) zoomControls.classList.remove('visible');
		if (panControls) panControls.classList.remove('visible');
		if (stickerCenterControls) stickerCenterControls.classList.remove('visible');
		if (colorPickerControls) colorPickerControls.classList.remove('visible');

		const layer = this.layerManager.getActiveLayer();

		// Show appropriate toolbar based on current tool and layer state
		if (this.currentTool === ToolType.ZOOM && zoomControls) {
			zoomControls.classList.add('visible');
		} else if (this.currentTool === ToolType.HAND && panControls) {
			panControls.classList.add('visible');
		} else if (this.currentTool === ToolType.SELECT && stickerCenterControls) {
			// When a sticker layer is selected
			if (layer && layer.type === LayerType.STICKER) {
				if (layer.stickerSourceId) {
					// Has a sticker selected - show controls
					this.hideStickerSettingsEmptyState();
					this.loadStickerSettings(layer); // This will populate asset info
					stickerCenterControls.classList.add('visible');
				} else {
					// No sticker selected yet - show empty state, hide controls
					this.showStickerSettingsEmptyState();
				}
			} else if (layer && layer.type === LayerType.TEXT_GLITTER) {
				// Text layers reuse the same center-H/center-V bar
				stickerCenterControls.classList.add('visible');
			}
		} else if (this.currentTool === ToolType.COLOR_PICKER && colorPickerControls) {
			if (layer && layer.type === LayerType.GLITTER_FILL && layer.selections && layer.selections.length > 0) {
				this.updateColorPickerControls();
				colorPickerControls.classList.add('visible');
			}
		}
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
				[ToolType.COLOR_PICKER]: { icon: 'icon-magic-wand', name: 'Color Picker' },
				[ToolType.BRUSH]: { icon: 'icon-brush', name: 'Mask Brush' },
				[ToolType.HAND]: { icon: 'icon-hand', name: 'Hand Tool' },
				[ToolType.ZOOM]: { icon: 'icon-magnifying-glass', name: 'Zoom Tool' }
			};
			return toolMap[tool] || { icon: '', name: '' };
		};

		// PRIORITY 1: Critical layer states (don't show tool label for these)
		if (this.maskEditor?.isEditing && activeLayer?.type === LayerType.GLITTER_FILL) {
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
			hint = isMobile
				? 'Drag here to create a new glitter layer and start painting'
				: 'Paint here to create a new glitter layer automatically';
			context = 'The Mask Brush targets glitter layers. Starting a stroke on another layer creates a new glitter layer for you.';
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
				? 'This glitter layer is empty—use the color picker or Mask Brush to add glitter'
				: 'This glitter layer is empty—use the Color Picker or Mask Brush to add glitter';
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
				hint = 'Add a sticker layer to move items around, or use color picker for glitter';
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
				hint = 'Switch to the color picker or Mask Brush to add or modify glitter, or add a sticker layer';
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
		if (e.key === 'Alt') {
			if (this.currentTool === ToolType.ZOOM) {
				this.previewContainer.classList.remove('zoom-out-mode');
			}
		}
	}

	handleKeyboard(e) {
		// Don't trigger shortcuts when typing in input fields
		const activeElement = document.activeElement;
		const isTyping = activeElement && (
			activeElement.tagName === 'INPUT' ||
			activeElement.tagName === 'TEXTAREA' ||
			activeElement.isContentEditable
		);

		// Allow Escape to work in inputs (to blur/close things)
		// Allow Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z for undo/redo
		if (isTyping && e.key !== 'Escape' &&
			!((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z'))) {
			return;
		}

		if (e.key === 'Alt' && this.currentTool === ToolType.ZOOM) {
			this.previewContainer.classList.add('zoom-out-mode');
		}

		if (e.key === 'Escape') {
			// Let ModalManager handle modal closing
			if (this.modalManager.closeTopModal()) {
				return; // A modal was closed, we're done
			}

			// No modal was open, switch to select tool
			this.setTool(ToolType.SELECT);
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
			const selectedLayer = this.layerManager.getActiveLayer();

			// Only delete if a layer is selected and it's not the base image
			if (selectedLayer && selectedLayer.type !== LayerType.BASE_IMAGE) {
				e.preventDefault(); // Prevent browser back navigation on Backspace

				if (confirm('Delete this layer?')) {
					this.layerManager.deleteLayer(selectedLayer.id);
				}
			}
			return;
		}

		// Ctrl/Cmd+D: duplicate the selected layer
		if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
			const selectedLayer = this.layerManager.getActiveLayer();
			if (selectedLayer && selectedLayer.type !== LayerType.BASE_IMAGE) {
				e.preventDefault(); // Prevent the browser's "bookmark this page" dialog
				this.layerManager.cloneLayer(selectedLayer.id);
			}
			return;
		}

		// Arrow keys: nudge the selected sticker/text layer by 1px (10px with Shift).
		// Rapid/held presses collapse into a single history entry (see scheduleNudgeSave).
		if (this.currentTool === ToolType.SELECT &&
			(e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
			const layer = this.layerManager.getActiveLayer();
			const prefix = layer?.type === LayerType.STICKER ? 'sticker'
				: layer?.type === LayerType.TEXT_GLITTER ? 'text' : null;
			const manager = prefix === 'sticker' ? this.stickerManager
				: prefix === 'text' ? this.textGlitterManager : null;
			const transform = this.getLayerTransformData(layer);

			if (manager && transform) {
				e.preventDefault();
				const step = e.shiftKey ? 10 : 1;
				const deltaX = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
				const deltaY = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;

				manager.updateTransform(layer.id, {
					position: {
						x: transform.position.x + deltaX,
						y: transform.position.y + deltaY
					}
				});

				this.loadTransformSettings(layer, prefix);
				this.scheduleNudgeSave();
				return;
			}
		}


		if (this.originalImage) {
			if ((e.ctrlKey || e.metaKey) && e.key === '0') {
				e.preventDefault();
				this.zoomToFit();
			}
			if ((e.ctrlKey || e.metaKey) && e.key === '1') {
				e.preventDefault();
				this.resetZoom();
			}
			if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
				e.preventDefault();
				this.zoomIn();
			}
			if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
				e.preventDefault();
				this.zoomOut();
			}
		}

		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
			e.preventDefault();
			this.undo();
		}

		if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'Z' || e.key === 'z')) {
			e.preventDefault();
			this.redo();
		}
	}

	// Collapses a burst of arrow-key nudges (held key / rapid presses) into a
	// single history entry, the same debounce pattern sliders use.
	scheduleNudgeSave() {
		clearTimeout(this._nudgeSaveTimer);
		this._nudgeSaveTimer = setTimeout(() => this.saveState(), CONFIG.sliderDebounceMs);
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

		const hasAnySelection = this.layers.some((layer) => layerHasVisibleContent(layer));

		const clearAllTool = document.getElementById('clearAllTool');
		const exportGif = document.getElementById('exportGif');
		const imageClearBtn = document.getElementById('imageClearBtn');
		const textTool = document.getElementById('textTool');
		const colorPickerTool = document.getElementById('colorPickerTool');
		const handTool = document.getElementById('handTool');
		const zoomTool = document.getElementById('zoomTool');
		const zoomControls = document.getElementById('zoomControls');
		const addBtn = document.getElementById('addLayerBtn');
		const previewToggle = document.getElementById('previewModeToggle');
		const transparencyToggle = document.getElementById('transparencyToggle');
		const boundsToggle = document.getElementById('boundsToggle');

		// --- Reference the container ---
		const previewControls = document.getElementById('previewControls');

		if (clearAllTool) clearAllTool.disabled = !hasImage;
		if (exportGif) exportGif.disabled = !hasAnySelection;

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

		if (imageClearBtn) {
			if (hasImage) {
				imageClearBtn.classList.add('visible');
			} else {
				imageClearBtn.classList.remove('visible');
			}
		}

		if (textTool) textTool.disabled = !hasImage;
		if (colorPickerTool) colorPickerTool.disabled = !hasImage;
		if (handTool) handTool.disabled = !hasImage;
		if (zoomTool) zoomTool.disabled = !hasImage;
		this.maskEditor?.updateToolButtonState();

		// UX: Can't add layers until image is loaded
		if (addBtn) {
			addBtn.disabled = !hasImage || this.layers.length >= CONFIG.maxLayers;
			if (!hasImage) {
				addBtn.title = 'Load an image first';
			} else if (this.layers.length >= CONFIG.maxLayers) {
				addBtn.title = `Maximum ${CONFIG.maxLayers} layers`;
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
			previewToggle.disabled = !hasAnySelection;
			if (!hasAnySelection) {
				previewToggle.title = 'Add glitter or stickers first';
			} else if (this.showAllLayers) {
				previewToggle.title = 'Show only active layer';
			} else {
				previewToggle.title = 'Show all layers';
			}
		}

		// UX: Update export tooltip
		if (exportGif) {
			if (!hasAnySelection) {
				exportGif.title = 'Add glitter or stickers first';
			} else {
				exportGif.title = 'Export GIF';
			}
		}
	}

	resetAll() {
		if (!this.originalImage) return;

		if (confirm('Reset everything? This will clear the image and all layers.')) {
			this.clearImage();
		}
	}

	clearImage() {
		// ======================
		// Core image + data state
		// ======================
		if (this.originalImage && this.originalImage.src.startsWith('blob:')) {
			URL.revokeObjectURL(this.originalImage.src);
		}
		this.originalImage = null;
		this.originalImageData = null;
		this.originalAlphaChannel = null;
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
		}, CONFIG.sliderDebounceMs);
	}


	// ===== IMAGE LOADING =====
	async loadImage(event) {
		const file = event.target.files[0];
		if (!file) return;

		if (file.size > CONFIG.maxFileSizeMB * 1024 * 1024) {
			this.showError(`Image too large. Maximum size is ${CONFIG.maxFileSizeMB}MB`);
			return;
		}

		// Release the previous image's blob URL (its src is referenced by the
		// base-layer swatch CSS, so it can only be revoked once replaced)
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

			if (width > CONFIG.maxImageWidth || height > CONFIG.maxImageHeight) {
				const scale = Math.min(CONFIG.maxImageWidth / width, CONFIG.maxImageHeight / height);
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
			if (CONFIG.createBaseImageLayerOnLoad) {
				const layer = this.layerManager.createBaseImageLayer(LayerType.BASE_IMAGE);
				this.layers.push(layer);
				// Set it active immediately
				// this.layerManager.setActiveLayer(layer.id);
			}

			// 2. Create Default Glitter Layer (Optional)
			if (CONFIG.createDefaultLayerOnLoad) {
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
			// first Text tool click almost never races the FontFace load (see
			// TextGlitterManager's font-readiness cache-key fix, docs/UX-PLAN-2.md §4).
			this.textGlitterManager?.ensureFontLoaded(CONFIG.textLayers.defaultFontId).catch(() => {});

			window.dispatchEvent(new Event('imageLoaded'));


		};
		img.src = URL.createObjectURL(file);
	}

	updateStatusBar() {
		if (this.originalImage) {
			const dims = `${this.originalCanvas.width} × ${this.originalCanvas.height}px`;
			document.getElementById('statusDimensions').textContent = dims;

			const zoomPct = Math.round(this.viewport.currentZoom * 100);
			document.getElementById('statusZoom').textContent = `${zoomPct}%`;
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
					this.handleLayerSelectAction(x, y);
				} else {
					this.layerManager.setActiveLayer(null);
				}
				break;

			case ToolType.TEXT:
				if (!hitCanvas) {
					return;
				}
				{
					const hitLayer = this.layerManager.getTopVisibleLayerAtPoint?.(x, y, { includeBase: false });
					if (hitLayer) {
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

					if (layer) {
						this.setTool(ToolType.SELECT);
						if (!this.mobileManager?.isMobile) {
							setTimeout(() => {
								this.updateSidePanelUI(layer);
								this.loadActiveLayerSettings();
								this.textGlitterManager?.focusTextInput(true);
							}, 0);
						}
					}
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
		if (e.target.closest('.transform-handles') ||
			e.target.classList.contains('transform-bounding-box')) return;

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
				else if (this.currentTool === ToolType.SELECT && e.target.closest('.sticker-element, .text-glitter-element')) {
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

		const hitSticker = e.target.closest('.sticker-element');
		const hitText = e.target.closest('.text-glitter-element');

		// Check if click is within the canvas area using viewport coordinates
		const canvasCoords = this.viewport.screenToCanvas(e.clientX, e.clientY);
		const hitCanvas = this.viewport.isWithinCanvas(canvasCoords.x, canvasCoords.y);

		// We treat transformable overlays and the canvas as the "Image Area"
		const hitImageArea = hitCanvas || hitSticker || hitText;

		// Gatekeeper: If they clicked a button/sidebar, stop here
		const isWorkspace = e.target === this.previewContainer || e.target === this.previewWrapper || hitImageArea;
		if (!isWorkspace) return;

		if (this.currentTool === ToolType.SELECT && (hitSticker || hitText)) return;

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
					this.layerManager.setActiveLayer(testLayer.id);
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

			// fill normally
			this.glitterFillSelector(x, y, event);

		} else if (layer.type === LayerType.BASE_IMAGE) {

			if (CONFIG.autoCreateGlitterLayer) {
				const newLayer = this.glitterManager.createLayer();
				this.layerManager.insertLayer(newLayer);
				this.glitterFillSelector(x, y, event);
			} else {
				this.updateStatus('Please create a glitter layer first');
			}

		} else if (layer.type === LayerType.STICKER) {
			const hitSticker = this.layerManager.isPointInSticker(layer, x, y);

			if (hitSticker) {

				if (CONFIG.autoCreateGlitterLayer) {
					const newLayer = this.glitterManager.createLayer();
					this.layerManager.insertLayer(newLayer);
					this.glitterFillSelector(x, y, event);
				} else {
					this.updateStatus('Color Picker disabled on Sticker layers.');
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
				this.layerManager.setActiveLayer(glitterLayer.id);
			} else {
				const newLayer = this.glitterManager.createLayer();
				this.layerManager.insertLayer(newLayer);
			}

			this.glitterFillSelector(x, y, event);
		}
	}

	handleLayerSelectAction(x, y) {
		if (this.currentTool !== ToolType.SELECT) return;
		if (!CONFIG.autoSelect || this.justCompletedDrag) return;

		this.layerManager.handleLayerPick(x, y);
	}

	handleZoomAction(clientX, clientY, options = {}) {
		if (this.currentTool !== ToolType.ZOOM || !this.originalImage) return;

		if (options.zoomOut) {
			this.viewport.zoomOut(clientX, clientY);
		} else {
			this.viewport.zoomIn(clientX, clientY);
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
			this.updateStatus('Color Picker disabled on Sticker layers.');
			return;
		}

		const pixelIndex = y * this.originalCanvas.width + x;
		const alpha = this.originalAlphaChannel[pixelIndex];
		const isTransparent = alpha < CONFIG.alphaThreshold;

		// 1. Config Check: Block if transparent and selection isn't allowed
		if (isTransparent && !CONFIG.allowTransparentSelection) {
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
			document.getElementById('selectedColorsEmpty').classList.add('visible');
			container.innerHTML = '';
			return;
		}

		document.getElementById('selectedColorsEmpty').classList.remove('visible');
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
			removeBtn.textContent = '×';
			removeBtn.title = 'Remove this color selection';
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
		if (this.originalImageData) {
			this.previewCtx.putImageData(this.originalImageData, 0, 0);
		} else {
			this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
		}

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
			this.clearPreview();
			return;
		}

		this.renderPreviewCanvas(layersToShow);

		// Use the manager to render the glitter backgrounds
		this.glitterManager.renderContent(layersToShow);

		this.stickerManager.renderContent(layersToShow);
		this.textGlitterManager.renderContent(layersToShow);
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

		// Otherwise, draw the original image
		this.previewCtx.putImageData(this.originalImageData, 0, 0);
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

		// Validate and clamp frame delay (minimum 20ms)
		if (typeof settings.frameDelay !== 'number' || settings.frameDelay < 20) {
			console.warn('Invalid frameDelay, clamping to 20ms');
			settings.frameDelay = 20;
		}

		// Validate and clamp max frames (1 to hard limit)
		const hardLimit = CONFIG.maxFramesHardLimit || 1000;
		if (typeof settings.maxFrames !== 'number' || settings.maxFrames < 1) {
			console.warn('Invalid maxFrames, setting to default');
			settings.maxFrames = CONFIG.defaultExportMaxFrames;
		} else if (settings.maxFrames > hardLimit) {
			console.warn(`maxFrames exceeds hard limit, capping at ${hardLimit}`);
			settings.maxFrames = hardLimit;
		}

		// Validate quality (1-30)
		if (typeof settings.quality !== 'number' || settings.quality < 1 || settings.quality > 30) {
			console.warn('Invalid quality, setting to default');
			settings.quality = CONFIG.defaultExportQuality;
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

		// Validate string settings
		if (typeof settings.ditherType !== 'string' || !settings.ditherType) {
			settings.ditherType = CONFIG.defaultExportDitherType;
		}
		if (typeof settings.matteColor !== 'string' || !settings.matteColor.match(/^#[0-9A-Fa-f]{6}$/)) {
			settings.matteColor = CONFIG.defaultExportMatteColor;
		}
	}

	async exportAnimatedGif() {
		// Filter visible layers
		const visibleLayers = this.layers.filter(l => {
			if (!l.visible) return false;
			return layerHasVisibleContent(l);
		});

		if (visibleLayers.length === 0) {
			this.showError('No visible layers with content to export!');
			return;
		}

		// Validate export settings before proceeding
		this.validateExportSettings();

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
				alphaThreshold: CONFIG.alphaThreshold
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
				ensureTextFont: (fontId) => this.textGlitterManager.ensureFontLoaded(fontId)
			}
		};

		setTimeout(async () => {
			try {
				await this.exporter.process(exportParams);
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

	// (Tooltips are handled by the global tooltipManager created in utils.js)

	// Load debug configuration if enabled
	if (DEBUG_CONFIG.enabled) {
		await editor.loadDebugConfig();
	}

	// Make editor globally accessible (optional, useful for debugging)
	window.editor = editor;
})();

const CONFIG = {
	maxImageWidth: 1200,
	maxImageHeight: 1200,
	maxFileSizeMB: 10,
	maxLayers: 15,
	historyLimit: 30,
	defaultThreshold: 50,
	defaultFeather: 0,
	defaultScale: 100,
	defaultOpacity: 100,
	defaultGlitterIndex: 0,
	alphaThreshold: 254,
	featherDebounceMs: 300,
	layerSettingsOpenByDefault: false,
	glitterSettingsOpenByDefault: false,
	exportFrameRateSource: 'first-layer',
	createDefaultLayerOnLoad: true,
	refineGlobalDefault: false,
	glitterGlobalDefault: false,
	baseGridSize: 20,
	zoomLevels: [0.1, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 16],


	// Auto-scroll settings for layer dragging
	scrollZoneSize: 50,
	scrollSpeed: 10,


	// Export settings (defaults)
	defaultExportQuality: 10,
	defaultExportDitherEnabled: true,
	defaultExportDitherType: 'FloydSteinberg',
	defaultExportFrameDelay: 110,
	defaultExportMaxFrames: 60,
	defaultExportBaseImage: true,
	defaultExportTransparency: true,
	defaultExportMatteColor: '#ffffff',

	shortcuts: {
		tools: [
			{ key: 'V', action: 'Select Tool' },
			{ key: 'I', action: 'Color Picker Tool' },
			{ key: 'H', action: 'Hand Tool' },
			{ key: 'Z', action: 'Zoom Tool' },
		],
		view: [
			{ key: 'Alt + Click', action: 'Zoom Out (Zoom Tool)' },
			{ key: 'Scroll Wheel', action: 'Zoom In/Out (Zoom Tool)' },
			{ key: 'Ctrl + 0', action: 'Fit Screen' },
			{ key: 'Ctrl + 1', action: 'Reset Zoom (100%)' },
			{ key: 'Ctrl + +/-', action: 'Zoom In/Out' }
		],
		history: [
			{ key: 'Ctrl + Z', action: 'Undo' },
			{ key: 'Ctrl + Shift + Z', action: 'Redo' },
		]
	},


	glitterGifs: [],


};

class GlitterEditor {
	constructor() {
		this.originalCanvas = document.getElementById('originalCanvas');
		this.previewCanvas = document.getElementById('previewCanvas');
		this.previewContainer = document.getElementById('previewContainer');
		this.previewWrapper = document.getElementById('previewWrapper');
		this.glitterBackgroundsContainer = document.getElementById('glitterBackgroundsContainer');

		// --- ADD THESE LINES TO FIX STACKING ---
		// Ensure the canvas is the base layer and glitter sits on top
		this.previewCanvas.style.zIndex = '1';
		this.glitterBackgroundsContainer.style.zIndex = '10';
		this.glitterBackgroundsContainer.style.pointerEvents = 'none'; // Allows clicking through to canvas
		// ---------------------------------------

		this.originalCtx = this.originalCanvas.getContext('2d', { willReadFrequently: true });
		this.previewCtx = this.previewCanvas.getContext('2d', { willReadFrequently: true });


		this.originalImage = null;
		this.originalImageData = null;
		this.originalAlphaChannel = null;
		this.glitterGifs = [];

		this.exporter = new GifExporter();

		// Auto-scroll for layer dragging
		this.dragScrollInterval = null;
		this.draggedLayerId = null;


		// Export settings
		this.exportSettings = {
			quality: CONFIG.defaultExportQuality,
			ditherEnabled: CONFIG.defaultExportDitherEnabled,
			ditherType: CONFIG.defaultExportDitherType,
			frameDelay: CONFIG.defaultExportFrameDelay,
			maxFrames: CONFIG.defaultExportMaxFrames,
			baseImage: CONFIG.defaultExportBaseImage,
			transparency: CONFIG.defaultExportTransparency,
			matteColor: CONFIG.defaultExportMatteColor
		};

		this.exportStartTime = 0;
		this.exportCancelled = false;

		// Layer system
		this.layers = [];
		this.activeLayerId = null;
		this.draggedLayerId = null;

		// Preview mode
		this.showAllLayers = true;

		// Global settings mode
		this.refineGlobal = CONFIG.refineGlobalDefault;
		this.glitterGlobal = CONFIG.glitterGlobalDefault;

		// Zoom & Pan system
		this.currentZoom = 1;
		this.currentZoomIndex = CONFIG.zoomLevels.indexOf(1);
		this.panX = 0;
		this.panY = 0;
		this.isPanning = false;
		this.panStartX = 0;
		this.panStartY = 0;
		this.lastPanX = 0;
		this.lastPanY = 0;

		this.currentTool = 'select';
		this.history = [];
		this.historyIndex = -1;

		this.featherTimeout = null;

		// Resize handling
		this.resizeTimeout = null;
		this.lastViewportWidth = 0;
		this.lastViewportHeight = 0;

		// Touch gesture state
		this.touch = {
			active: false,
			startDistance: 0,
			startZoom: 1,
			startPan: { x: 0, y: 0 },
			lastCenter: { x: 0, y: 0 }
		};


		// Filter state
		this.activeFilters = {
			colors: new Set(),
			tones: new Set(),
			special: new Set(),
			search: '',
			nameOnly: false
		};

		this.setupEventListeners();
		this.loadGlitterGifs();
		this.initializeCollapsibleSections();
		this.initializeShortcutsModal();
		this.initializeExportSettings();
	}

	initializeExportSettings() {
		// Set export settings UI to match CONFIG defaults
		const qualitySelect = document.getElementById('exportQuality');
		const ditherEnabledCheckbox = document.getElementById('exportDitherEnabled');
		const ditherTypeSelect = document.getElementById('exportDitherType');
		const ditherTypeRow = document.getElementById('ditherTypeRow');
		const baseImageCheckbox = document.getElementById('exportBaseImage');
		const transparencyCheckbox = document.getElementById('exportTransparency');
		const matteColor = document.getElementById('exportMatteColor');
		const matteColorRow = document.getElementById('matteColorRow');
		const delaySelect = document.getElementById('exportFrameDelay');
		const maxFramesSelect = document.getElementById('exportMaxFrames');

		if (qualitySelect) qualitySelect.value = CONFIG.defaultExportQuality;
		if (ditherEnabledCheckbox) ditherEnabledCheckbox.checked = CONFIG.defaultExportDitherEnabled;
		if (ditherTypeSelect) ditherTypeSelect.value = CONFIG.defaultExportDitherType;
		if (baseImageCheckbox) baseImageCheckbox.checked = CONFIG.defaultExportBaseImage;
		if (transparencyCheckbox) transparencyCheckbox.checked = CONFIG.defaultExportTransparency;
		if (matteColor) matteColor.value = CONFIG.defaultExportMatteColor;
		if (delaySelect) delaySelect.value = CONFIG.defaultExportFrameDelay;
		if (maxFramesSelect) maxFramesSelect.value = CONFIG.defaultExportMaxFrames;

		// Show/hide dither type dropdown based on enabled checkbox
		const updateDitherTypeVisibility = () => {
			if (ditherTypeRow) {
				ditherTypeRow.classList.toggle('disabled', !ditherEnabledCheckbox.checked);
			}
		};

		if (ditherEnabledCheckbox) {
			ditherEnabledCheckbox.addEventListener('change', updateDitherTypeVisibility);
			updateDitherTypeVisibility();
		}

		// Show/hide matte color based on transparency checkbox
		const updateMatteColorVisibility = () => {
			if (matteColorRow && transparencyCheckbox) {
				// Show matte when transparency is disabled
				matteColorRow.classList.toggle('disabled', transparencyCheckbox.checked);
			}
		};

		if (transparencyCheckbox) {
			transparencyCheckbox.addEventListener('change', updateMatteColorVisibility);
		}

		// Initial visibility states
		updateMatteColorVisibility();
	}

	// ===== RANDOMIZE GLITTER =====

	randomizeGlitter(category = null) {
		if (this.layers.length === 0) {
			console.log('No layers to randomize');
			return;
		}

		// Get available glitters (optionally filtered by category)
		let availableGlitters = this.glitterGifs;
		if (category) {
			availableGlitters = this.glitterGifs.filter(g =>
				g.category.toLowerCase() === category.toLowerCase()
			);
			if (availableGlitters.length === 0) {
				console.log(`No glitters found in category: ${category}`);
				console.log('Available categories:', [...new Set(this.glitterGifs.map(g => g.category))].join(', '));
				return;
			}
		}

		// Group layers by their current glitter index
		const glitterGroups = new Map();
		this.layers.forEach(layer => {
			const currentIndex = layer.selectedGlitterIndex;
			if (!glitterGroups.has(currentIndex)) {
				glitterGroups.set(currentIndex, []);
			}
			glitterGroups.get(currentIndex).push(layer);
		});

		// Create a mapping of old index -> new index
		const replacementMap = new Map();
		glitterGroups.forEach((layers, oldIndex) => {
			// Filter out the current glitter
			const choices = availableGlitters.filter(g => {
				const gIndex = this.glitterGifs.findIndex(gl => gl.url === g.url);
				return gIndex !== oldIndex;
			});

			if (choices.length === 0) {
				console.warn(`No alternative glitters available for index ${oldIndex}`);
				replacementMap.set(oldIndex, oldIndex);
				return;
			}

			// Pick a random glitter from available glitters
			const randomGlitter = choices[Math.floor(Math.random() * choices.length)];
			// Find the index in the full glitterGifs array
			const newIndex = this.glitterGifs.findIndex(g => g.url === randomGlitter.url);
			replacementMap.set(oldIndex, newIndex);
		});

		// Apply the replacements
		this.layers.forEach(layer => {
			const oldIndex = layer.selectedGlitterIndex;
			const newIndex = replacementMap.get(oldIndex);
			layer.selectedGlitterIndex = newIndex;
		});

		// Update UI
		this.renderLayersList();
		this.updateGlitterSelection();
		this.updatePreview();
		this.saveState();

		console.log(`✨ Randomized ${this.layers.length} layers. ${glitterGroups.size} unique glitters changed.`);
		if (category) {
			console.log(`   Category filter: ${category}`);
		}
	}

	randomizeAdvanced(category = null) {
		if (this.layers.length === 0) {
			console.log('No layers to randomize');
			return;
		}

		// Group layers by their current glitter index
		const glitterGroups = new Map();
		this.layers.forEach(layer => {
			const currentIndex = layer.selectedGlitterIndex;
			if (!glitterGroups.has(currentIndex)) {
				glitterGroups.set(currentIndex, []);
			}
			glitterGroups.get(currentIndex).push(layer);
		});

		// Create a mapping of old index -> new index
		const replacementMap = new Map();
		glitterGroups.forEach((layers, oldIndex) => {
			const currentGlitter = this.glitterGifs[oldIndex];
			const currentTags = currentGlitter.tags || [];

			const hasLight = currentTags.includes('light');
			const hasDark = currentTags.includes('dark');

			// DEBUG: Log what we're looking for
			console.log(`\n🔍 Looking for match for "${currentGlitter.name}"`);
			console.log(`   Tags:`, currentTags);
			console.log(`   hasLight: ${hasLight}, hasDark: ${hasDark}`);

			// Filter glitters based on light/dark matching
			let matchingGlitters = this.glitterGifs.filter((g, idx) => {
				// Never choose itself
				if (idx === oldIndex) return false;

				// Apply category filter if specified
				if (category && g.category.toLowerCase() !== category.toLowerCase()) {
					return false;
				}

				const tags = g.tags || [];

				// If current has 'light', new must have 'light'
				if (hasLight) {
					return tags.includes('light');
				}
				// If current has 'dark', new must have 'dark'
				else if (hasDark) {
					return tags.includes('dark');
				}
				// If current has neither, new must also have neither
				else {
					return !tags.includes('light') && !tags.includes('dark');
				}
			});

			console.log(`   Found ${matchingGlitters.length} matches`);
			if (matchingGlitters.length > 0) {
				console.log(`   Examples:`, matchingGlitters.slice(0, 3).map(g => g.name));
			}

			if (matchingGlitters.length === 0) {
				console.warn(`❌ No matching glitters found for "${currentGlitter.name}" (${hasLight ? 'light' : hasDark ? 'dark' : 'neutral'}). Keeping original.`);
				replacementMap.set(oldIndex, oldIndex);
				return;
			}

			// Pick random from matching glitters
			const randomGlitter = matchingGlitters[Math.floor(Math.random() * matchingGlitters.length)];
			const newIndex = this.glitterGifs.findIndex(g => g.url === randomGlitter.url);
			console.log(`   ✅ Chose: "${randomGlitter.name}"`);
			replacementMap.set(oldIndex, newIndex);
		});

		// Apply the replacements
		this.layers.forEach(layer => {
			const oldIndex = layer.selectedGlitterIndex;
			const newIndex = replacementMap.get(oldIndex);
			layer.selectedGlitterIndex = newIndex;
		});

		// Update UI
		this.renderLayersList();
		this.updateGlitterSelection();
		this.updatePreview();
		this.saveState();

		console.log(`\n✨ Advanced randomize: ${this.layers.length} layers. ${glitterGroups.size} unique glitters changed (matching light/dark tags).`);
		if (category) {
			console.log(`   Category filter: ${category}`);
		}
	}


	// ===== ZOOM & PAN FUNCTIONS =====

	setZoom(newZoom, clickX = null, clickY = null) {
		if (!this.originalImage) return;

		const oldZoom = this.currentZoom;

		// 1. Clamp Zoom
		this.currentZoom = Math.max(CONFIG.zoomLevels[0], Math.min(CONFIG.zoomLevels[CONFIG.zoomLevels.length - 1], newZoom));

		// Update active index for UI
		let closestDiff = Number.MAX_VALUE;
		let closestIndex = 0;
		CONFIG.zoomLevels.forEach((z, i) => {
			const diff = Math.abs(this.currentZoom - z);
			if (diff < closestDiff) {
				closestDiff = diff;
				closestIndex = i;
			}
		});
		this.currentZoomIndex = closestIndex;

		// 2. Get Dimensions
		const containerRect = this.previewContainer.getBoundingClientRect();
		const viewportW = containerRect.width;
		const viewportH = containerRect.height;

		// 3. Determine the "Anchor Point" (The pixel on the image we want to keep stationary)
		// relative to the container's top-left
		let anchorContainerX, anchorContainerY;

		if (clickX !== null && clickY !== null) {
			// MOUSE ZOOM: The anchor is the mouse position
			anchorContainerX = clickX - containerRect.left;
			anchorContainerY = clickY - containerRect.top;
		} else {
			// BUTTON ZOOM: The anchor is the center of the viewport
			anchorContainerX = viewportW / 2;
			anchorContainerY = viewportH / 2;
		}

		// 4. Convert Anchor Point to "Image Coordinates" (The pixel inside the image)
		// Formula: ImagePixel = (ScreenCoord - CurrentPan) / OldZoom
		const imagePixelX = (anchorContainerX - this.panX) / oldZoom;
		const imagePixelY = (anchorContainerY - this.panY) / oldZoom;

		// 5. Calculate New Pan
		// We want that same ImagePixel to be at the AnchorPoint after the new scale
		// Formula: NewPan = ScreenCoord - (ImagePixel * NewZoom)
		this.panX = anchorContainerX - (imagePixelX * this.currentZoom);
		this.panY = anchorContainerY - (imagePixelY * this.currentZoom);

		// 6. Apply
		this.applyZoomTransform();
		this.updateZoomUI();
		this.updateTransparencyGrid();
		this.updateStatusBar();
	}


	applyZoomTransform() {
		this.previewWrapper.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.currentZoom})`;
	}

	zoomIn(clickX = null, clickY = null) {
		if (this.currentZoomIndex < CONFIG.zoomLevels.length - 1) {
			this.setZoom(CONFIG.zoomLevels[this.currentZoomIndex + 1], clickX, clickY);
		} else {
			// Allow zooming past max array if triggered manually, or just cap it
			const nextZoom = this.currentZoom * 1.5; // fallback
			this.setZoom(nextZoom, clickX, clickY);
		}
	}

	zoomOut(clickX = null, clickY = null) {
		if (this.currentZoomIndex > 0) {
			this.setZoom(CONFIG.zoomLevels[this.currentZoomIndex - 1], clickX, clickY);
		} else {
			const nextZoom = this.currentZoom / 1.5;
			this.setZoom(nextZoom, clickX, clickY);
		}
	}



	zoomToFit() {
		if (!this.originalImage) return;

		const containerRect = this.previewContainer.getBoundingClientRect();
		const padding = 40;

		// Calculate ratios based on available space
		const scaleX = (containerRect.width - padding) / this.previewCanvas.width;
		const scaleY = (containerRect.height - padding) / this.previewCanvas.height;

		// Fit = smallest ratio
		const fitZoom = Math.min(scaleX, scaleY);

		// Apply zoom directly
		this.currentZoom = fitZoom;

		// Recalculate index
		this.currentZoomIndex = CONFIG.zoomLevels.findIndex(z => z >= fitZoom);
		if (this.currentZoomIndex === -1) this.currentZoomIndex = 0;

		// CENTER IT: (ContainerSize - ImageSize)/2
		this.panX = (containerRect.width - (this.previewCanvas.width * fitZoom)) / 2;
		this.panY = (containerRect.height - (this.previewCanvas.height * fitZoom)) / 2;

		this.applyZoomTransform();
		this.updateZoomUI();
		this.updateTransparencyGrid();
		this.updateStatusBar();
	}

	zoomToFill() {
		if (!this.originalImage) return;

		const containerRect = this.previewContainer.getBoundingClientRect();
		const padding = 40;

		const scaleX = (containerRect.width - padding) / this.previewCanvas.width;
		const scaleY = (containerRect.height - padding) / this.previewCanvas.height;

		// Fill = largest ratio
		const fillZoom = Math.max(scaleX, scaleY);

		this.currentZoom = fillZoom;

		this.currentZoomIndex = CONFIG.zoomLevels.findIndex(z => z >= fillZoom);
		if (this.currentZoomIndex === -1) this.currentZoomIndex = CONFIG.zoomLevels.length - 1;

		// CENTER IT
		this.panX = (containerRect.width - (this.previewCanvas.width * fillZoom)) / 2;
		this.panY = (containerRect.height - (this.previewCanvas.height * fillZoom)) / 2;

		this.applyZoomTransform();
		this.updateZoomUI();
		this.updateTransparencyGrid();
		this.updateStatusBar();
	}

	resetZoom() {
		if (!this.originalImage) return;

		const containerRect = this.previewContainer.getBoundingClientRect();

		this.currentZoom = 1;
		this.currentZoomIndex = CONFIG.zoomLevels.indexOf(1);
		if (this.currentZoomIndex === -1) this.currentZoomIndex = 3;

		// CENTER IT
		this.panX = (containerRect.width - this.previewCanvas.width) / 2;
		this.panY = (containerRect.height - this.previewCanvas.height) / 2;

		this.applyZoomTransform();
		this.updateZoomUI();
		this.updateTransparencyGrid();
		this.updateStatusBar();
	}

	resetViewport() {
		if (!this.previewCanvas.width) return;

		const containerRect = this.previewContainer.getBoundingClientRect();

		// Sync resize tracking
		this.lastViewportWidth = containerRect.width;
		this.lastViewportHeight = containerRect.height;

		this.currentZoom = 1;
		this.currentZoomIndex = CONFIG.zoomLevels.indexOf(1);
		if (this.currentZoomIndex === -1) this.currentZoomIndex = 3; // Default fallback

		// Start centered
		this.panX = (containerRect.width - this.previewCanvas.width) / 2;
		this.panY = (containerRect.height - this.previewCanvas.height) / 2;

		this.applyZoomTransform();
	}

	handleCanvasZoomClick(event) {
		if (this.currentTool !== 'zoom' || !this.originalImage) return;

		// Pass the raw client coordinates
		if (event.altKey) {
			this.zoomOut(event.clientX, event.clientY);
		} else {
			this.zoomIn(event.clientX, event.clientY);
		}
	}

// REPLACE your existing startPan method with this:
startPan(x, y) {
    if (!this.originalImage) return;

    this.isPanning = true;
    
    // Store the starting coordinates
    this.panStartX = x;
    this.panStartY = y;
    
    // Store the current pan position to calculate offsets later
    this.lastPanX = this.panX;
    this.lastPanY = this.panY;

    this.previewContainer.classList.add('panning');
}

	handlePan(event) {
		if (!this.isPanning) return;

		const deltaX = event.clientX - this.panStartX;
		const deltaY = event.clientY - this.panStartY;

		this.panX = this.lastPanX + deltaX;
		this.panY = this.lastPanY + deltaY;

		this.applyZoomTransform();
		event.preventDefault();
	}

	endPan() {
		if (!this.isPanning) return;

		this.isPanning = false;
		this.previewContainer.classList.remove('panning');
	}

	setupTouchGestures() {
		const container = this.previewContainer;

		const getTouchDistance = (touch1, touch2) => {
			const dx = touch2.clientX - touch1.clientX;
			const dy = touch2.clientY - touch1.clientY;
			return Math.sqrt(dx * dx + dy * dy);
		};

		const getTouchCenter = (touch1, touch2) => {
			return {
				x: (touch1.clientX + touch2.clientX) / 2,
				y: (touch1.clientY + touch2.clientY) / 2
			};
		};

		container.addEventListener('touchstart', (e) => {
			if (e.touches.length === 2) {
				e.preventDefault();

				this.touch.active = true;
				this.touch.startDistance = getTouchDistance(e.touches[0], e.touches[1]);
				this.touch.startZoom = this.currentZoom;
				this.touch.startPan = { x: this.panX, y: this.panY };
				this.touch.lastCenter = getTouchCenter(e.touches[0], e.touches[1]);
			}
		}, { passive: false });

		container.addEventListener('touchmove', (e) => {
			if (this.touch.active && e.touches.length === 2) {
				e.preventDefault();

				// Calculate new distance and zoom
				const currentDistance = getTouchDistance(e.touches[0], e.touches[1]);
				const scale = currentDistance / this.touch.startDistance;
				const newZoom = Math.max(0.1, Math.min(16, this.touch.startZoom * scale));

				// Calculate center point movement for panning
				const currentCenter = getTouchCenter(e.touches[0], e.touches[1]);
				const deltaCenterX = currentCenter.x - this.touch.lastCenter.x;
				const deltaCenterY = currentCenter.y - this.touch.lastCenter.y;

				// Update zoom and pan
				this.currentZoom = newZoom;
				this.panX = this.touch.startPan.x + deltaCenterX;
				this.panY = this.touch.startPan.y + deltaCenterY;

				// Update zoom index for consistency
				this.currentZoomIndex = CONFIG.zoomLevels.findIndex(z => z >= newZoom);
				if (this.currentZoomIndex === -1) {
					this.currentZoomIndex = CONFIG.zoomLevels.length - 1;
				}

				// Apply changes
				this.applyZoomTransform();
				this.updateZoomUI();
				this.updateTransparencyGrid();
				this.updateStatusBar();
			}
		}, { passive: false });

		container.addEventListener('touchend', (e) => {
			if (e.touches.length < 2) {
				this.touch.active = false;
			}
		});

		container.addEventListener('touchcancel', () => {
			this.touch.active = false;
		});

this.previewContainer.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1 && this.currentTool === 'hand') {
        const touch = e.touches[0];
        // Now valid: startPan accepts numbers
        this.startPan(touch.clientX, touch.clientY); 
        e.preventDefault();
    }
}, { passive: false });

		this.previewContainer.addEventListener('touchmove', (e) => {
			if (e.touches.length === 1 && this.isPanning) {
				const touch = e.touches[0];
				const deltaX = touch.clientX - this.panStartX;
				const deltaY = touch.clientY - this.panStartY;

				this.panX = this.lastPanX + deltaX;
				this.panY = this.lastPanY + deltaY;

				this.applyZoomTransform();
				e.preventDefault();
			}
		}, { passive: false });

		this.previewContainer.addEventListener('touchend', (e) => {
			if (this.isPanning && e.touches.length === 0) {
				this.endPan();
			}
		});


	}


	updateZoomUI() {
		const percentage = Math.round(this.currentZoom * 100);
		document.getElementById('zoomPercentage').textContent = `${percentage}%`;
		document.getElementById('statusZoom').textContent = `${percentage}%`;

		document.getElementById('zoomOut').disabled = this.currentZoomIndex <= 0;
		document.getElementById('zoomIn').disabled = this.currentZoomIndex >= CONFIG.zoomLevels.length - 1;

		// Update cursor
		this.previewContainer.classList.remove('zoom-cursor', 'hand-cursor');
		if (this.currentTool === 'zoom') {
			this.previewContainer.classList.add('zoom-cursor');
		} else if (this.currentTool === 'hand') {
			this.previewContainer.classList.add('hand-cursor');
		}
	}

	updateTransparencyGrid() {
		if (!this.previewContainer.classList.contains('transparent-bg')) return;

		const baseSize = CONFIG.baseGridSize;
		const size = baseSize * this.currentZoom;
		const half = size / 2;

		this.previewContainer.style.backgroundSize = `${size}px ${size}px`;
		this.previewContainer.style.backgroundPosition =
			`${this.panX}px ${this.panY}px, ${this.panX}px ${this.panY + half}px, ${this.panX + half}px ${this.panY - half}px, ${this.panX - half}px ${this.panY}px`;
	}

	// ===== LAYER MANAGEMENT =====

	generateLayerId() {
		return `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	createLayer() {
		if (this.layers.length >= CONFIG.maxLayers) {
			this.showError(`Maximum ${CONFIG.maxLayers} layers reached`);
			return null;
		}

		const layer = {
			id: this.generateLayerId(),
			visible: true,
			selections: [],
			selectedGlitterIndex: CONFIG.defaultGlitterIndex,
			settings: {
				threshold: CONFIG.defaultThreshold,
				feather: CONFIG.defaultFeather,
				scale: CONFIG.defaultScale,
				opacity: CONFIG.defaultOpacity,
				contiguous: false,
				invert: false,
				multiSelect: false
			}
		};

		return layer;
	}

	addLayer() {
		const layer = this.createLayer();
		if (!layer) return;

		this.layers.push(layer);
		this.setActiveLayer(layer.id);
		this.renderLayersList();
		this.saveState();
		this.updateActionButtons();
		this.updateStatus('Layer added');
	}

	deleteLayer(layerId) {
		if (this.layers.length <= 1) {
			this.showError('Cannot delete the last layer');
			return;
		}

		const index = this.layers.findIndex(l => l.id === layerId);
		if (index === -1) return;

		this.layers.splice(index, 1);

		if (this.activeLayerId === layerId) {
			const newActiveIndex = Math.max(0, index - 1);
			this.setActiveLayer(this.layers[newActiveIndex].id);
		}

		this.renderLayersList();
		this.saveState();
		this.updatePreview();
		this.updateActionButtons();
		this.updateStatus('Layer deleted');
	}

	toggleLayerVisibility(layerId) {
		const layer = this.layers.find(l => l.id === layerId);
		if (!layer) return;

		layer.visible = !layer.visible;
		this.renderLayersList();
		this.saveState();
		this.updatePreview();
	}

	goToGlitter(layerId) {
		const layer = this.layers.find(l => l.id === layerId);
		if (!layer) return;

		const glitterIndex = layer.selectedGlitterIndex;

		// On mobile, open the glitter drawer first
		if (window.innerWidth <= 800 && this.mobileManager) {
			this.mobileManager.toggleDrawer('glitter');
		}

		// Scroll to the glitter option
		this.scrollToGlitter(glitterIndex);
	}

	scrollToGlitter(glitterIndex) {
		const glitterOption = document.querySelector(`.glitter-option[data-index="${glitterIndex}"]`);
		if (!glitterOption) return;

		const glitterOptions = document.querySelector('.glitter-options');
		if (!glitterOptions) return;

		// Scroll the glitter option into view
		glitterOption.scrollIntoView({
			behavior: 'smooth',
			block: 'center'
		});

		// Brief highlight effect
		glitterOption.classList.add('highlight');
		setTimeout(() => {
			glitterOption.classList.remove('highlight');
		}, 1000);
	}



	setActiveLayer(layerId) {
		this.activeLayerId = layerId;
		this.renderLayersList();

		if (layerId === null) {
			// Show empty states
			this.showLayerSettingsEmptyState();
			this.showGlitterSettingsEmptyState();
			// Collapse both sections
			this.collapseLayerSettings();
			this.collapseGlitterSettings();
			this.clearPreview();
		} else {
			// Hide empty states, show controls
			this.hideLayerSettingsEmptyState();
			this.hideGlitterSettingsEmptyState();
			this.loadActiveLayerSettings();
			this.updateGlitterSelection();
		}

		this.updatePreview();
		this.updateGlitterOptionsState();
		window.dispatchEvent(new CustomEvent('layerChanged'));
	}

	getActiveLayer() {
		return this.layers.find(l => l.id === this.activeLayerId);
	}

	// ===== UX: EMPTY STATE MANAGEMENT =====

	showLayerSettingsEmptyState() {
		const empty = document.getElementById('layerSettingsEmpty');
		const controls = document.getElementById('layerSettingsControls');
		if (empty) empty.classList.add('visible');
		if (controls) controls.classList.remove('visible');
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
		document.querySelectorAll('.glitter-option').forEach(opt => {
			if (hasActiveLayer) {
				opt.classList.remove('disabled');
			} else {
				opt.classList.add('disabled');
			}
		});
	}


	loadActiveLayerSettings() {
		const layer = this.getActiveLayer();
		if (!layer) return;

		const s = layer.settings;

		document.getElementById('contiguous').checked = s.contiguous;
		document.getElementById('invert').checked = s.invert;
		document.getElementById('multiSelect').checked = s.multiSelect;

		document.getElementById('threshold').value = s.threshold;
		document.getElementById('thresholdValue').textContent = s.threshold;
		this.updateResetButton('threshold');

		document.getElementById('feather').value = s.feather;
		document.getElementById('featherValue').textContent = s.feather;
		this.updateResetButton('feather');

		document.getElementById('scale').value = s.scale;
		document.getElementById('scaleValue').textContent = s.scale + '%';
		this.updateResetButton('scale');

		document.getElementById('opacity').value = s.opacity;
		document.getElementById('opacityValue').textContent = s.opacity + '%';
		this.updateResetButton('opacity');

		this.updateSelectedColorsDisplay();
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

		const activeLayer = this.getActiveLayer();
		if (activeLayer) {
			activeLayer.settings = settings;
		}

		if (this.refineGlobal && refineOnly) {
			this.layers.forEach(layer => {
				layer.settings.threshold = settings.threshold;
				layer.settings.feather = settings.feather;
			});
		}

		if (this.glitterGlobal && glitterOnly) {
			this.layers.forEach(layer => {
				layer.settings.scale = settings.scale;
				layer.settings.opacity = settings.opacity;
			});
		}
	}

	updateGlitterSelection() {
		const layer = this.getActiveLayer();

		document.querySelectorAll('.glitter-option').forEach((opt) => {
			// If layer exists, check index. If no layer (null), always false.
			const isSelected = layer ? parseInt(opt.dataset.index) === layer.selectedGlitterIndex : false;
			opt.classList.toggle('selected', isSelected);
		});
	}

	handleLayerDragStart(event, layerId) {
		this.draggedLayerId = layerId;
		event.target.classList.add('dragging');
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData('text/html', event.target.innerHTML);
	}

	handleLayerDragOver(event, targetLayerId) {
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';

		if (!this.draggedLayerId) return;

		// Call existing scroll handler
		this.handleLayerDragScroll(event);

		const targetElement = event.currentTarget;
		const rect = targetElement.getBoundingClientRect();
		const layersList = document.getElementById('layersList');
		const containerRect = layersList.getBoundingClientRect();
		const insertionLine = document.querySelector('.layer-insertion-line');

		const midpoint = rect.top + rect.height / 2;
		const insertAbove = event.clientY < midpoint;

		const draggedIndex = this.layers.findIndex(l => l.id === this.draggedLayerId);
		const targetIndex = this.layers.findIndex(l => l.id === targetLayerId);

		if (targetIndex === draggedIndex) {
			insertionLine.classList.remove('visible');
			return;
		}
		if (targetIndex === draggedIndex - 1 && insertAbove) {
			insertionLine.classList.remove('visible');
			return;
		}
		if (targetIndex === draggedIndex + 1 && !insertAbove) {
			insertionLine.classList.remove('visible');
			return;
		}

		let lineY;
		let LAYER_MARGIN_BOTTOM = 6;
		let INSERTION_LINE_HEIGHT = 2;
		let offset = (LAYER_MARGIN_BOTTOM - INSERTION_LINE_HEIGHT) / 2;

		const scrollTop = layersList.scrollTop;

		if (insertAbove) {
			lineY = rect.top - containerRect.top + scrollTop - LAYER_MARGIN_BOTTOM + offset;
		} else {
			lineY = rect.bottom - containerRect.top + scrollTop + offset;
		}

		insertionLine.style.top = lineY + 'px';
		insertionLine.classList.add('visible');

		this.dropInsertAbove = insertAbove;
		this.dropTargetId = targetLayerId;
	}

	handleLayerDragLeave(event) {
		// Only hide if leaving the layers list entirely
		const layersList = document.getElementById('layersList');
		const insertionLine = document.querySelector('.layer-insertion-line');

		if (!layersList.contains(event.relatedTarget)) {
			insertionLine.classList.remove('visible');
		}
	}

	handleLayerDragScroll(event) {
		if (!this.draggedLayerId) return;

		const layersList = document.getElementById('layersList');
		const rect = layersList.getBoundingClientRect();
		const scrollZone = CONFIG.scrollZoneSize;
		const scrollSpeed = CONFIG.scrollSpeed;

		const mouseY = event.clientY - rect.top;
		const listHeight = rect.height;

		// Clear existing interval
		if (this.dragScrollInterval) {
			clearInterval(this.dragScrollInterval);
			this.dragScrollInterval = null;
		}

		// Scroll up when near top
		if (mouseY < scrollZone && mouseY > 0) {
			this.dragScrollInterval = setInterval(() => {
				layersList.scrollTop = Math.max(0, layersList.scrollTop - scrollSpeed);
			}, 16);
		}
		// Scroll down when near bottom
		else if (mouseY > listHeight - scrollZone && mouseY < listHeight) {
			this.dragScrollInterval = setInterval(() => {
				const maxScroll = layersList.scrollHeight - layersList.clientHeight;
				layersList.scrollTop = Math.min(maxScroll, layersList.scrollTop + scrollSpeed);
			}, 16);
		}
	}

	handleLayerTouchStart(event, layerId) {
		// Only start drag if touching the drag handle area (not buttons)
		if (event.target.closest('.layer-actions')) {
			return; // Don't drag if touching buttons
		}

		this.draggedLayerId = layerId;
		event.currentTarget.classList.add('dragging');

		const touch = event.touches[0];
		this.touchDragStartY = touch.clientY;
		this.touchDragLastY = touch.clientY;

		event.preventDefault();
	}

handleLayerTouchMove(event) {
    if (!this.draggedLayerId) return;

    const touch = event.touches[0];
    this.touchDragLastY = touch.clientY;

    // Find which layer element we're over
    const elements = document.elementsFromPoint(touch.clientX, touch.clientY);
    
    // FIX 1: Add check to ensure we aren't targeting the layer we are currently dragging
    const targetLayer = elements.find(el => 
        el.classList.contains('layer-item') && 
        el.dataset.layerId !== this.draggedLayerId
    );

    if (targetLayer && targetLayer.dataset.layerId) {
        const targetLayerId = targetLayer.dataset.layerId;

        const rect = targetLayer.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const insertAbove = touch.clientY < midpoint;

        // Show insertion line
        const layersList = document.getElementById('layersList');
        const containerRect = layersList.getBoundingClientRect();
        const insertionLine = document.querySelector('.layer-insertion-line');

        let lineY;
        const LAYER_MARGIN_BOTTOM = 6;
        const INSERTION_LINE_HEIGHT = 2;
        const offset = (LAYER_MARGIN_BOTTOM - INSERTION_LINE_HEIGHT) / 2;
        const scrollTop = layersList.scrollTop;

        if (insertAbove) {
            lineY = rect.top - containerRect.top + scrollTop - LAYER_MARGIN_BOTTOM + offset;
        } else {
            lineY = rect.bottom - containerRect.top + scrollTop + offset;
        }

        insertionLine.style.top = lineY + 'px';
        insertionLine.classList.add('visible');

        this.dropTargetId = targetLayerId;
        this.dropInsertAbove = insertAbove;
    }

    event.preventDefault();
}

handleLayerTouchEnd(event) {
    if (!this.draggedLayerId) return;

    // Find the dragged element and remove dragging class
    const draggedElement = document.querySelector(`[data-layer-id="${this.draggedLayerId}"]`);
    if (draggedElement) {
        draggedElement.classList.remove('dragging');
    }

    const insertionLine = document.querySelector('.layer-insertion-line');
    insertionLine.classList.remove('visible');

    // Perform the actual reordering using stored values
    if (this.dropTargetId && this.draggedLayerId !== this.dropTargetId) {
        const draggedIndex = this.layers.findIndex(l => l.id === this.draggedLayerId);
        
        // Remove the dragged layer first
        if (draggedIndex !== -1) {
            const [draggedLayer] = this.layers.splice(draggedIndex, 1);
            
            // Recalculate target index after removal (items might have shifted)
            let newTargetIndex = this.layers.findIndex(l => l.id === this.dropTargetId);
            
            // FIX 2: Fixed inverted logic. 
            // "Insert Above" visually means a higher index in the array (rendered bottom-to-top)
            let newIndex = this.dropInsertAbove ? newTargetIndex + 1 : newTargetIndex;

            this.layers.splice(newIndex, 0, draggedLayer);
            this.reorderLayerElements();
            this.reorderGlitterBackgrounds();
            this.saveState();
        }
    }

    this.draggedLayerId = null;
    this.dropTargetId = null;
    this.dropInsertAbove = false;
}


	// Replace handleLayerDrop with this optimized version:
	handleLayerDrop(event, targetLayerId) {
		event.preventDefault();

		const insertionLine = document.querySelector('.layer-insertion-line');
		insertionLine.classList.remove('visible');

		if (!this.draggedLayerId) return;

		// Use stored values from dragover
		targetLayerId = this.dropTargetId;
		const insertAbove = this.dropInsertAbove;

		if (!targetLayerId || this.draggedLayerId === targetLayerId) return;

		const draggedIndex = this.layers.findIndex(l => l.id === this.draggedLayerId);
		const targetIndex = this.layers.findIndex(l => l.id === targetLayerId);

		if (draggedIndex === -1 || targetIndex === -1) return;

		// Remove the dragged layer
		const [draggedLayer] = this.layers.splice(draggedIndex, 1);

		// Recalculate target index after removal
		let newTargetIndex = this.layers.findIndex(l => l.id === targetLayerId);

		// IMPORTANT: Visual order is reversed!
		// "Above" visually = higher index in array = AFTER target
		// "Below" visually = lower index in array = AT target
		let newIndex = insertAbove ? newTargetIndex + 1 : newTargetIndex;

		// Insert at new position
		this.layers.splice(newIndex, 0, draggedLayer);

		// OPTIMIZED: Just reorder DOM instead of recreating
		this.reorderLayerElements();
		this.reorderGlitterBackgrounds();
		this.saveState();
		// No updatePreview() needed - visual stacking order changed but render is same
	}

	// Fast reordering - just moves existing DOM elements
	reorderLayerElements() {
		const container = document.getElementById('layersList');
		const insertionLine = container.querySelector('.layer-insertion-line');

		// Get all existing layer elements
		const existingElements = new Map();
		container.querySelectorAll('.layer-item').forEach(el => {
			existingElements.set(el.dataset.layerId, el);
		});

		// Reorder them to match layers array (reversed for display)
		const fragment = document.createDocumentFragment();

		[...this.layers].reverse().forEach(layer => {
			const element = existingElements.get(layer.id);
			if (element) {
				// Update active state
				element.classList.toggle('active', layer.id === this.activeLayerId);
				fragment.appendChild(element);
			}
		});

		// Clear and re-append in correct order
		container.innerHTML = '';
		container.appendChild(insertionLine);
		container.appendChild(fragment);
	}

	// Fast reordering for glitter backgrounds
	reorderGlitterBackgrounds() {
		const container = this.glitterBackgroundsContainer;

		// Get existing background elements
		const existingBgs = new Map();
		container.querySelectorAll('.glitter-background').forEach(bg => {
			existingBgs.set(bg.dataset.layerId, bg);
		});

		// Reorder them to match layers array
		const fragment = document.createDocumentFragment();

		this.layers.forEach(layer => {
			const bg = existingBgs.get(layer.id);
			if (bg) {
				fragment.appendChild(bg);
			}
		});

		container.innerHTML = '';
		container.appendChild(fragment);
	}

	handleLayerDragEnd(event) {
		event.target.classList.remove('dragging');
		const insertionLine = document.querySelector('.layer-insertion-line');
		insertionLine.classList.remove('visible');

		if (this.dragScrollInterval) {
			clearInterval(this.dragScrollInterval);
			this.dragScrollInterval = null;
		}

		this.draggedLayerId = null;
	}

	renderLayersList() {
		const container = document.getElementById('layersList');

		// Add insertion line if it doesn't exist
		let insertionLine = container.querySelector('.layer-insertion-line');
		if (!insertionLine) {
			insertionLine = document.createElement('div');
			insertionLine.className = 'layer-insertion-line';
			container.appendChild(insertionLine);
		}

		container.innerHTML = '';
		container.appendChild(insertionLine);

		// Handle dragging over empty space at bottom
		container.addEventListener('dragover', (e) => {
			// Only handle if target is the container itself (not a layer item)
			if (this.draggedLayerId && e.target === container) {
				e.preventDefault();

				const layerItems = container.querySelectorAll('.layer-item');
				if (layerItems.length === 0) return;

				// Check if mouse is actually below all layer items
				const lastItem = layerItems[layerItems.length - 1];
				const lastRect = lastItem.getBoundingClientRect();


			}
		});

		// Also add drop handler for container
		container.addEventListener('drop', (e) => {
			if (e.target === container) {
				this.handleLayerDrop(e, null);
			}
		});

		[...this.layers].reverse().forEach((layer, index) => {
			const layerEl = document.createElement('div');
			layerEl.className = 'layer-item';
			layerEl.dataset.layerId = layer.id;
			layerEl.draggable = true;

			if (layer.id === this.activeLayerId) {
				layerEl.classList.add('active');
			}

			const swatch = document.createElement('div');
			swatch.className = 'layer-swatch';
			const glitter = this.glitterGifs[layer.selectedGlitterIndex];
			if (glitter) {
				swatch.style.backgroundImage = `url(${glitter.url})`;
				if (glitter.isPixelated) {
					swatch.classList.add('pixelated');
				}
			}

			// Double-click swatch to go to glitter
			swatch.addEventListener('dblclick', (e) => {
				e.stopPropagation();
				this.goToGlitter(layer.id);
			});

			const info = document.createElement('div');
			info.className = 'layer-info';
			const colorText = document.createElement('div');
			colorText.className = 'layer-color';

			if (glitter) {
				colorText.textContent = `${glitter.category} - ${glitter.name}`;
			} else {
				colorText.textContent = 'No glitter';
			}

			info.appendChild(colorText);

			const actions = document.createElement('div');
			actions.className = 'layer-actions';




			const visBtn = this.createIconButton({
				className: 'layer-action-btn visibility' + (!layer.visible ? ' hidden' : ''),
				label: 'Layer Visibility',
				title: layer.visible ? 'Hide layer' : 'Show layer',
				iconType: 'eye',
				onClick: (e) => {
					e.stopPropagation();
					this.toggleLayerVisibility(layer.id);
				}
			});

			const arrowBtn = this.createIconButton({
				className: 'layer-action-btn goto-glitter',
				label: 'Go To',
				title: 'Go to glitter',
				iconType: 'chevron-right',
				onClick: (e) => {
					e.stopPropagation();
					this.goToGlitter(layer.id);
				}
			});

			const delBtn = this.createIconButton({
				className: 'layer-action-btn delete',
				label: 'Delete',
				title: 'Delete layer',
				iconType: 'x-mark',
				onClick: (e) => {
					e.stopPropagation();
					if (confirm('Delete this layer?')) this.deleteLayer(layer.id);
				}
			});







			actions.append(arrowBtn, visBtn, delBtn);  // CHANGED: added arrowBtn

			layerEl.append(swatch, info, actions);
			layerEl.onclick = () => this.setActiveLayer(layer.id);

			// Drag and drop events
			layerEl.addEventListener('dragstart', (e) => this.handleLayerDragStart(e, layer.id));
			layerEl.addEventListener('dragover', (e) => this.handleLayerDragOver(e, layer.id));
			layerEl.addEventListener('dragleave', (e) => this.handleLayerDragLeave(e));
			layerEl.addEventListener('drop', (e) => this.handleLayerDrop(e, layer.id));
			layerEl.addEventListener('dragend', (e) => this.handleLayerDragEnd(e));

			layerEl.addEventListener('touchstart', (e) => this.handleLayerTouchStart(e, layer.id), { passive: false });
			layerEl.addEventListener('touchmove', (e) => this.handleLayerTouchMove(e), { passive: false });
			layerEl.addEventListener('touchend', (e) => this.handleLayerTouchEnd(e));


			container.appendChild(layerEl);
		});

		document.getElementById('addLayerBtn').disabled = this.layers.length >= CONFIG.maxLayers;

		// Update mobile add button if it exists
		const mobileAddBtn = document.getElementById('mobileAddLayerBtn');
		if (mobileAddBtn) {
			mobileAddBtn.disabled = this.layers.length >= CONFIG.maxLayers;
		}
	}


	createIconButton({ className = '', id = '', disabled = false, title = '', iconType = '', label = '', onClick }) {
		const btn = document.createElement('button');
		btn.className = "btn-icon icon-wrapper " + className;
		if (id) btn.id = id;
		if (disabled) btn.disabled = true;
		if (title) btn.title = title;

		if (iconType) {
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.classList.add('icon');
			const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
			use.setAttribute('href', `#icon-${iconType}`);
			svg.appendChild(use);
			btn.appendChild(svg);
		}

		if (label) {
			const span = document.createElement('span');
			span.className = 'name';
			span.textContent = label;
			btn.appendChild(span);
		}

		if (onClick) btn.onclick = onClick;

		return btn;
	}


	// ===== INITIALIZATION =====
	initializeCollapsibleSections() {
		const layerSettingsHeader = document.getElementById('layerSettingsHeader');
		const layerSettingsContent = document.getElementById('layerSettingsContent');
		const layerSettingsToggle = document.getElementById('layerSettingsToggle');

		// Start collapsed with empty state showing
		layerSettingsToggle.classList.add('collapsed');
		this.showLayerSettingsEmptyState();

		layerSettingsHeader.addEventListener('click', () => {
			const isOpen = layerSettingsContent.classList.toggle('visible');
			layerSettingsToggle.classList.toggle('collapsed', !isOpen);
		});

		const glitterSettingsHeader = document.getElementById('glitterSettingsHeader');
		const glitterSettingsContent = document.getElementById('glitterSettingsContent');
		const glitterSettingsToggle = document.getElementById('glitterSettingsToggle');

		// Start collapsed with empty state showing
		glitterSettingsToggle.classList.add('collapsed');
		this.showGlitterSettingsEmptyState();

		glitterSettingsHeader.addEventListener('click', () => {
			const isOpen = glitterSettingsContent.classList.toggle('visible');
			glitterSettingsToggle.classList.toggle('collapsed', !isOpen);
		});
	}

	initializeShortcutsModal() {
		// Shortcuts Modal
		const shortcutsModal = document.getElementById('shortcutsModal');
		const shortcutsBtn = document.getElementById('shortcutsBtn');
		const closeShortcuts = document.getElementById('closeShortcutsModal');
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


		// Settings Modal
		const settingsModal = document.getElementById('settingsModal');
		const settingsBtn = document.getElementById('settingsBtn');
		const closeSettings = document.getElementById('closeSettingsModal');

		// About Modal
		const aboutModal = document.getElementById('aboutModal');
		const aboutBtn = document.getElementById('aboutBtn');
		const closeAbout = document.getElementById('closeAboutModal');

		// Function to close all modals
		const closeAllModals = () => {
			shortcutsModal.classList.remove('visible');
			aboutModal.classList.remove('visible');
			settingsModal.classList.remove('visible');
		};

		// Shortcuts Modal Events
		shortcutsBtn.addEventListener('click', () => {
			closeAllModals();
			shortcutsModal.classList.add('visible');
		});

		closeShortcuts.addEventListener('click', () => {
			shortcutsModal.classList.remove('visible');
		});

		shortcutsModal.addEventListener('click', (e) => {
			if (e.target === shortcutsModal) {
				shortcutsModal.classList.remove('visible');
			}
		});

		// Settings Modal Events
		settingsBtn.addEventListener('click', () => {
			closeAllModals();
			settingsModal.classList.add('visible');
		});

		closeSettings.addEventListener('click', () => {
			settingsModal.classList.remove('visible');
		});

		settingsModal.addEventListener('click', (e) => {
			if (e.target === settingsModal) {
				settingsModal.classList.remove('visible');
			}
		});

		// About Modal Events
		aboutBtn.addEventListener('click', () => {
			closeAllModals();
			aboutModal.classList.add('visible');
		});

		closeAbout.addEventListener('click', () => {
			aboutModal.classList.remove('visible');
		});

		aboutModal.addEventListener('click', (e) => {
			if (e.target === aboutModal) {
				aboutModal.classList.remove('visible');
			}
		});
	}

	setupEventListeners() {
		// --- TOOLBAR BUTTONS ---
		document.getElementById('selectTool').addEventListener('click', () => this.setTool('select'));
		document.getElementById('colorPickerTool').addEventListener('click', () => this.setTool('colorPicker'));
		document.getElementById('handTool').addEventListener('click', () => this.setTool('hand'));
		document.getElementById('zoomTool').addEventListener('click', () => this.setTool('zoom'));
		document.getElementById('undoTool').addEventListener('click', () => this.undo());
		document.getElementById('redoTool').addEventListener('click', () => this.redo());
		document.getElementById('clearAllTool').addEventListener('click', () => this.resetAll());

		// --- ZOOM CONTROLS ---
		document.getElementById('zoomIn').addEventListener('click', () => this.zoomIn());
		document.getElementById('zoomOut').addEventListener('click', () => this.zoomOut());
		document.getElementById('zoomPercentage').addEventListener('click', () => this.resetZoom());
		document.getElementById('fitScreen').addEventListener('click', () => this.zoomToFit());
		document.getElementById('fillScreen').addEventListener('click', () => this.zoomToFill());

		// --- WINDOW RESIZE ---
		window.addEventListener('resize', () => this.handleWindowResize());

		// Initialize dimensions on load
		const rect = this.previewContainer.getBoundingClientRect();
		this.lastViewportWidth = rect.width;
		this.lastViewportHeight = rect.height;

		// --- SCROLL ZOOM ---
		this.previewContainer.addEventListener('wheel', (e) => {
			if (this.currentTool === 'zoom' && this.originalImage) {
				e.preventDefault();
				// No params = zoom toward center of viewport
				if (e.deltaY < 0) {
					this.zoomIn();
				} else {
					this.zoomOut();
				}
			}
		}, { passive: false });

		// --- PAN HANDLERS ---
this.previewContainer.addEventListener('mousedown', (e) => {
    // Check for Hand Tool OR Spacebar key
    if (this.currentTool === 'hand' || e.code === 'Space') {
        // Prevent default browser dragging
        e.preventDefault(); 
        // Pass specific X/Y coordinates to the new function
        this.startPan(e.clientX, e.clientY);
    }
});



		this.previewContainer.addEventListener('mousemove', (e) => {
			this.handlePan(e);
		});

		this.previewContainer.addEventListener('mouseup', () => {
			this.endPan();
		});

		this.previewContainer.addEventListener('mouseleave', () => {
			this.endPan();
		});




		// --- DISABLE RIGHT CLICK ON PREVIEW ---
		this.previewContainer.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			return false;
		});

		// --- LAYER ACTIONS ---
		document.getElementById('addLayerBtn').addEventListener('click', () => this.addLayer());

		// --- LAYER DESELECTION ---
		const layersList = document.getElementById('layersList');
		layersList.addEventListener('click', (e) => {
			// Only deselect if clicking the container itself
			if (e.target === layersList) {
				this.setActiveLayer(null);
			}
		});

		// --- IMAGE HANDLING ---
		document.getElementById('imageClearBtn').addEventListener('click', () => this.clearImage());

		const dropzone = document.getElementById('imageDropzone');
		const fileInput = document.getElementById('imageUpload');

		dropzone.addEventListener('click', () => fileInput.click());
		fileInput.addEventListener('change', (e) => this.loadImage(e));

		dropzone.addEventListener('dragover', (e) => {
			e.preventDefault();
			dropzone.classList.add('drag-over');
		});

		dropzone.addEventListener('dragleave', () => {
			dropzone.classList.remove('drag-over');
		});

		dropzone.addEventListener('drop', (e) => {
			e.preventDefault();
			dropzone.classList.remove('drag-over');
			if (e.dataTransfer.files.length > 0) {
				fileInput.files = e.dataTransfer.files;
				this.loadImage({ target: fileInput });
			}
		});

		// --- CANVAS INTERACTION ---
		this.previewWrapper.addEventListener('click', (e) => {
			if (this.currentTool === 'colorPicker' || this.currentTool === 'select') {  // ADD 'select' here
				this.handleCanvasClick(e);
			} else if (this.currentTool === 'zoom') {
				this.handleCanvasZoomClick(e);
			}
		});

		// --- LAYER SETTINGS CONTROLS ---
		['contiguous', 'invert'].forEach(id => {
			document.getElementById(id).addEventListener('change', () => {
				this.saveActiveLayerSettings();
				this.updatePreview();
				this.saveState();
			});
		});

		document.getElementById('multiSelect').addEventListener('change', (e) => {

			// If multi-select is disabled, clear all selections except the first
			const layer = this.getActiveLayer();
			if (!e.target.checked && layer && layer.selections.length > 1) {
				layer.selections = [layer.selections[0]];
			}
			this.saveActiveLayerSettings();
			this.updatePreview();
			this.updateSelectedColorsDisplay();
			this.saveState();
		});

		document.getElementById('refineGlobal').addEventListener('change', (e) => {
			this.refineGlobal = e.target.checked;
		});

		document.getElementById('glitterGlobal').addEventListener('change', (e) => {
			this.glitterGlobal = e.target.checked;
		});

		const thresholdSlider = document.getElementById('threshold');
		thresholdSlider.addEventListener('input', () => {
			this.saveActiveLayerSettings(true, false);
			this.updatePreview();
		});
		thresholdSlider.addEventListener('change', () => this.saveState());

		const featherSlider = document.getElementById('feather');
		featherSlider.addEventListener('input', () => {
			this.saveActiveLayerSettings(true, false);
			this.debouncedUpdatePreview();
		});
		featherSlider.addEventListener('change', () => this.saveState());

		const scaleSlider = document.getElementById('scale');
		scaleSlider.addEventListener('input', () => {
			this.saveActiveLayerSettings(false, true);
			this.updatePreview();
		});
		scaleSlider.addEventListener('change', () => this.saveState());

		const opacitySlider = document.getElementById('opacity');
		opacitySlider.addEventListener('input', () => {
			this.saveActiveLayerSettings(false, true);
			this.updatePreview();
		});
		opacitySlider.addEventListener('change', () => this.saveState());

		// --- SEARCH & FILTERS ---
		document.getElementById('glitterSearch').addEventListener('input', (e) => this.handleSearchInput(e.target.value));
		document.getElementById('filterToggleBtn').addEventListener('click', () => this.toggleFilters());

		document.getElementById('searchNameOnlyWrapper').addEventListener('click', (e) => {
			e.preventDefault();
			const checkbox = document.getElementById('searchNameOnly');
			checkbox.checked = !checkbox.checked;
			this.activeFilters.nameOnly = checkbox.checked;
			this.applyFilters();
			this.updateClearFiltersButton();
		});

		const filtersContainer = document.getElementById('filtersContainer');
		filtersContainer.addEventListener('click', (e) => {
			const chip = e.target.closest('.filter-chip');
			if (chip && chip.dataset.filter) {
				this.toggleFilter(chip);
			}
		});

		document.getElementById('clearFiltersBtn').addEventListener('click', () => this.clearAllFilters());

		// --- UI HELPERS ---
		this.setupSliderDisplay('threshold', 'thresholdValue', '');
		this.setupSliderDisplay('feather', 'featherValue', '');
		this.setupSliderDisplay('scale', 'scaleValue', '%');
		this.setupSliderDisplay('opacity', 'opacityValue', '%');

		this.setupResetButton('threshold', CONFIG.defaultThreshold);
		this.setupResetButton('feather', CONFIG.defaultFeather);
		this.setupResetButton('scale', CONFIG.defaultScale);
		this.setupResetButton('opacity', CONFIG.defaultOpacity);

		document.getElementById('previewModeToggle').addEventListener('click', () => {
			this.showAllLayers = !this.showAllLayers;
			const btn = document.getElementById('previewModeToggle');
			// btn.textContent = this.showAllLayers ? '👁️ Solo Mode' : '✓ Solo Mode';
			btn.classList.toggle('active', !this.showAllLayers);
			btn.title = this.showAllLayers ? 'Show only active layer' : 'Show all layers';
			this.updatePreview();
		});

		document.getElementById('transparencyToggle').addEventListener('click', () => {
			const toggle = document.getElementById('transparencyToggle');
			const isActive = toggle.classList.toggle('active');

			//this.previewContainer.style.transition = 'none';
			this.previewContainer.classList.toggle('transparent-bg', isActive);

			if (isActive) {
				this.updateTransparencyGrid();
			} else {
				this.previewContainer.style.backgroundSize = '';
				this.previewContainer.style.backgroundPosition = '';
			}

			this.previewContainer.offsetHeight;
			this.previewContainer.style.transition = '';
		});

		// --- EXPORT & GLOBAL ---
		document.getElementById('exportGif').addEventListener('click', () => this.exportAnimatedGif());

		// Export settings
		document.getElementById('exportQuality').addEventListener('change', (e) => {
			this.exportSettings.quality = parseInt(e.target.value);
		});
		document.getElementById('exportDitherEnabled').addEventListener('change', (e) => {
			this.exportSettings.ditherEnabled = e.target.checked;
		});
		document.getElementById('exportDitherType').addEventListener('change', (e) => {
			this.exportSettings.ditherType = e.target.value;
		});
		document.getElementById('exportBaseImage').addEventListener('change', (e) => {
			this.exportSettings.baseImage = e.target.checked;
		});
		document.getElementById('exportTransparency').addEventListener('change', (e) => {
			this.exportSettings.transparency = e.target.checked;
		});
		document.getElementById('exportMatteColor').addEventListener('change', (e) => {
			this.exportSettings.matteColor = e.target.value;
		});
		document.getElementById('exportFrameDelay').addEventListener('change', (e) => {
			this.exportSettings.frameDelay = parseInt(e.target.value);
		});
		document.getElementById('exportMaxFrames').addEventListener('change', (e) => {
			this.exportSettings.maxFrames = parseInt(e.target.value);
		});

		// Export progress cancel
		document.getElementById('exportProgressCancel').addEventListener('click', () => {
			this.exportCancelled = true;
			this.hideExportProgress();
			this.updateStatus('Export cancelled');
			document.getElementById('exportGif').disabled = false;
		});

		document.getElementById('errorClose').addEventListener('click', () => this.hideError());

		document.addEventListener('keydown', (e) => this.handleKeyboard(e));
		document.addEventListener('keyup', (e) => this.handleKeyUp(e));

		// --- TOUCH GESTURES ---
		this.setupTouchGestures();


	}

	handleWindowResize() {
		clearTimeout(this.resizeTimeout);
		this.resizeTimeout = setTimeout(() => {
			this.performResizeUpdate();
		}, 100); // 100ms debounce
	}

	performResizeUpdate() {
		const containerRect = this.previewContainer.getBoundingClientRect();
		const newWidth = containerRect.width;
		const newHeight = containerRect.height;

		// If we have an image, adjust the pan to keep it centered relative to the change
		if (this.originalImage) {
			const deltaX = newWidth - this.lastViewportWidth;
			const deltaY = newHeight - this.lastViewportHeight;

			// Shift the pan by half the delta to keep the image in the visual center
			this.panX += deltaX / 2;
			this.panY += deltaY / 2;

			this.applyZoomTransform();
			this.updateTransparencyGrid();

			// Optional: If you want to force "Fit Screen" behavior on resize instead of maintaining position:
			this.zoomToFit();
		}

		// Update stored dimensions for next time
		this.lastViewportWidth = newWidth;
		this.lastViewportHeight = newHeight;
	}



	toggleFilters() {
		const container = document.getElementById('filtersContainer');
		const btn = document.getElementById('filterToggleBtn');
		const isVisible = container.classList.toggle('visible');
		btn.classList.toggle('active', isVisible);
	}

	setupSliderDisplay(sliderId, displayId, suffix) {
		document.getElementById(sliderId).addEventListener('input', (e) => {
			document.getElementById(displayId).textContent = e.target.value + suffix;
			this.updateResetButton(sliderId);
		});
	}

	setupResetButton(sliderId, defaultValue) {
		const resetBtnId = 'reset' + sliderId.charAt(0).toUpperCase() + sliderId.slice(1);
		const resetBtn = document.getElementById(resetBtnId);

		resetBtn.addEventListener('click', () => {
			const slider = document.getElementById(sliderId);
			slider.value = defaultValue;
			slider.dispatchEvent(new Event('input'));
			slider.dispatchEvent(new Event('change'));

			if (sliderId === 'feather') {
				this.saveActiveLayerSettings(true, false);
				this.updatePreview();
			} else if (sliderId === 'threshold') {
				this.saveActiveLayerSettings(true, false);
			} else if (sliderId === 'scale' || sliderId === 'opacity') {
				this.saveActiveLayerSettings(false, true);
			}
		});

		this.updateResetButton(sliderId);
	}

	updateResetButton(sliderId) {
		const resetBtn = document.getElementById('reset' + sliderId.charAt(0).toUpperCase() + sliderId.slice(1));
		const slider = document.getElementById(sliderId);
		const defaultValue = CONFIG['default' + sliderId.charAt(0).toUpperCase() + sliderId.slice(1)];
		if (resetBtn) {
			resetBtn.disabled = parseInt(slider.value) === defaultValue;
		}
	}

	setTool(tool) {
		this.currentTool = tool;
		document.getElementById('selectTool').classList.toggle('active', tool === 'select');
		document.getElementById('colorPickerTool').classList.toggle('active', tool === 'colorPicker');
		document.getElementById('handTool').classList.toggle('active', tool === 'hand');
		document.getElementById('zoomTool').classList.toggle('active', tool === 'zoom');
		document.getElementById('previewWrapper').classList.toggle('color-picker-mode', tool === 'colorPicker');

		this.updateZoomUI();

		document.getElementById('zoomControls').style.display = this.originalImage ? 'flex' : 'none';
	}

	handleKeyUp(e) {
		if (e.key === 'Alt') {
			if (this.currentTool === 'zoom') {
				this.previewContainer.classList.remove('zoom-out-mode');
			}
		}
	}

	handleKeyboard(e) {
		if (e.key === 'Alt' && this.currentTool === 'zoom') {
			this.previewContainer.classList.add('zoom-out-mode');
		}

		if (e.key === 'Escape') {
			// Check if any modal is open
			const shortcutsModal = document.getElementById('shortcutsModal');
			const aboutModal = document.getElementById('aboutModal');
			const settingsModal = document.getElementById('settingsModal');

			if (settingsModal.classList.contains('visible')) {
				settingsModal.classList.remove('visible');
				return;
			}



			if (shortcutsModal.classList.contains('visible')) {
				shortcutsModal.classList.remove('visible');
				return;
			}

			if (aboutModal.classList.contains('visible')) {
				aboutModal.classList.remove('visible');
				return;
			}

			// If no modal open, switch to select tool
			this.setTool('select');
		}


		if (e.key === 'v' || e.key === 'V') this.setTool('select');
		if (e.key === 'i' || e.key === 'I') {
			if (this.originalImage) this.setTool('colorPicker');
		}
		if (e.key === 'h' || e.key === 'H') {
			if (this.originalImage) this.setTool('hand');
		}
		if (e.key === 'z' || e.key === 'Z') {
			if (!e.ctrlKey && !e.metaKey && this.originalImage) this.setTool('zoom');
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

	// ===== HISTORY =====

	saveState() {
		const state = {
			layers: this.layers.map(layer => ({
				id: layer.id,
				visible: layer.visible,
				selections: JSON.parse(JSON.stringify(layer.selections)),
				selectedGlitterIndex: layer.selectedGlitterIndex,
				settings: { ...layer.settings }
			})),
			activeLayerId: this.activeLayerId
		};

		this.history = this.history.slice(0, this.historyIndex + 1);

		if (this.history.length >= CONFIG.historyLimit) {
			this.history.shift();
		} else {
			this.historyIndex++;
		}

		this.history.push(state);
		this.updateHistoryButtons();
	}

	restoreState(state) {
		this.layers = state.layers.map(layer => ({
			id: layer.id,
			visible: layer.visible,
			selections: JSON.parse(JSON.stringify(layer.selections)),
			selectedGlitterIndex: layer.selectedGlitterIndex,
			settings: { ...layer.settings }
		}));

		this.activeLayerId = state.activeLayerId;

		this.renderLayersList();
		this.loadActiveLayerSettings();
		this.updateGlitterSelection();
		this.updatePreview();
		this.updateActionButtons();
	}

	undo() {
		if (this.historyIndex > 0) {
			this.historyIndex--;
			this.restoreState(this.history[this.historyIndex]);
			this.updateHistoryButtons();
		}
	}

	redo() {
		if (this.historyIndex < this.history.length - 1) {
			this.historyIndex++;
			this.restoreState(this.history[this.historyIndex]);
			this.updateHistoryButtons();
		}
	}

	updateHistoryButtons() {
		document.getElementById('undoTool').disabled = this.historyIndex <= 0;
		document.getElementById('redoTool').disabled = this.historyIndex >= this.history.length - 1;
	}

	updateActionButtons() {
		const hasImage = this.originalImage !== null;
		const hasAnySelection = this.layers.some(l => l.selections.length > 0);

		document.getElementById('clearAllTool').disabled = !hasImage;
		document.getElementById('exportGif').disabled = !hasAnySelection;

		const imageClearBtn = document.getElementById('imageClearBtn');
		if (hasImage) {
			imageClearBtn.classList.add('visible');
		} else {
			imageClearBtn.classList.remove('visible');
		}

		document.getElementById('colorPickerTool').disabled = !hasImage;
		document.getElementById('handTool').disabled = !hasImage;
		document.getElementById('zoomTool').disabled = !hasImage;

		const zoomControls = document.getElementById('zoomControls');
		if (hasImage) {
			zoomControls.classList.add('visible');
		} else {
			zoomControls.classList.remove('visible');
		}

		// UX: Can't add layers until image is loaded
		const addBtn = document.getElementById('addLayerBtn');
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


		// UX: Disable preview toggle when no selections
		const previewToggle = document.getElementById('previewModeToggle');
		previewToggle.disabled = !hasAnySelection;
		if (!hasAnySelection) {
			previewToggle.title = 'Add glitter to a layer first';
		} else if (this.showAllLayers) {
			previewToggle.title = 'Show only active layer';
		} else {
			previewToggle.title = 'Show all layers';
		}

		// UX: Update export tooltip
		const exportBtn = document.getElementById('exportGif');
		if (!hasAnySelection) {
			exportBtn.title = 'Add glitter to a layer first';
		} else {
			exportBtn.title = 'Export GIF';
		}
	}

	resetAll() {
		if (!this.originalImage) return;

		if (confirm('Reset everything? This will clear the image and all layers.')) {
			this.clearImage();
		}
	}

	clearImage() {
		this.originalImage = null;
		this.originalImageData = null;
		this.originalAlphaChannel = null;
		this.layers = [];
		this.activeLayerId = null; // Important: set to null

		// Reset UI
		document.getElementById('imageUpload').value = '';
		document.getElementById('imageDropzone').classList.remove('has-image');

		const dropzoneContent = document.getElementById('dropzoneContent');
		dropzoneContent.classList.add('visible');

		// Clear canvas
		const originalCanvas = this.originalCanvas;
		originalCanvas.classList.remove('visible');

		// Reset transparency background
		this.previewContainer.classList.remove('transparent-bg');
		this.previewContainer.style.backgroundSize = '';
		this.previewContainer.style.backgroundPosition = '';
		document.getElementById('transparencyToggle').classList.remove('active');

		this.clearPreview();
		this.glitterBackgroundsContainer.innerHTML = '';

		// UX: Reset to empty state properly
		this.showLayerSettingsEmptyState();
		this.showGlitterSettingsEmptyState();
		this.collapseLayerSettings();
		this.collapseGlitterSettings();

		document.getElementById('selectedColorsDisplay').innerHTML = '<span class="empty-state-text">None</span>';
		this.clearAllFilters();

		this.resetViewport();
		this.updateZoomUI();

		this.renderLayersList();
		this.updateHistoryButtons();
		this.updateActionButtons();
		this.updateGlitterOptionsState();
		this.setTool('select');
		this.updateStatus('Load an image to begin');
		this.updateStatusBar();

		window.dispatchEvent(new Event('imageRemoved'));
	}

	debouncedUpdatePreview() {
		clearTimeout(this.featherTimeout);
		this.featherTimeout = setTimeout(() => {
			this.saveActiveLayerSettings(true, false);
			this.updatePreview();
		}, CONFIG.featherDebounceMs);
	}

	// ===== GLITTER LOADING =====
	async loadGlitterGifs() {
		this.glitterGifs = [];

		const res = await fetch('data/swatches.json');
		const json = await res.json();

		json.forEach(config => {
			this.glitterGifs.push({
				id: config.id,
				url: config.url,
				name: config.name || 'Unnamed',
				generatedName: config.generatedName || null,
				frames: null,
				brightness: config.brightness || null,
				sortOrder: config.sortOrder || 0,
				hue: config.hue || null,
				colorCodes: config.colorCodes || [],
				frameCount: config.frameCount || 0,
				frameRate: config.frameRate || 10,
				isVariableFramerate: config.isVariableFramerate || false,
				category: config.category || 'Uncategorized',
				isPixelated: config.isPixelated || false,
				tags: config.tags || []
			});
		});

		if (this.glitterGifs.length > 0) {
			this.displayGlitterOptions();
		}
	}

	async parseGifFromUrl(url) {
		const response = await fetch(url);
		const arrayBuffer = await response.arrayBuffer();
		const uintArray = new Uint8Array(arrayBuffer);
		const reader = new GifReader(uintArray);

		const frameCount = reader.numFrames();
		const frameInfo = reader.frameInfo(0);
		const width = reader.width;
		const height = reader.height;

		const frames = [];
		for (let i = 0; i < frameCount; i++) {
			const pixels = new Uint8ClampedArray(width * height * 4);
			reader.decodeAndBlitFrameRGBA(i, pixels);
			frames.push(new ImageData(pixels, width, height));
		}

		return {
			width, height, frames, frameCount,
			frameDelay: frameInfo.delay * 10 || 100
		};
	}

	displayGlitterOptions() {
		const container = document.getElementById('glitterOptions');
		container.innerHTML = '';

		const categories = {};
		this.glitterGifs.forEach((glitter, index) => {
			if (!categories[glitter.category]) {
				categories[glitter.category] = [];
			}
			categories[glitter.category].push({ glitter, index });
		});

		Object.entries(categories).forEach(([category, items]) => {
			const categoryDiv = document.createElement('div');
			categoryDiv.className = 'glitter-category';
			categoryDiv.dataset.category = category;

			const title = document.createElement('div');
			title.className = 'category-title';
			title.textContent = category;
			categoryDiv.appendChild(title);

			const grid = document.createElement('div');
			grid.className = 'glitter-grid';

			items.forEach(({ glitter, index }) => {
				const option = document.createElement('div');
				option.className = 'glitter-option' + (glitter.isPixelated ? ' pixelated' : '');
				option.title = glitter.name;
				option.dataset.index = index;
				option.dataset.name = glitter.name.toLowerCase();
				option.dataset.category = glitter.category.toLowerCase();
				option.dataset.tags = (glitter.tags || []).join(' ').toLowerCase();

				option.dataset.hue = glitter.hue;
				option.dataset.brightness = glitter.brightness;
				option.dataset.sortOrder = glitter.sortOrder

				const img = document.createElement('img');
				img.src = glitter.url;
				img.alt = glitter.name;

				option.appendChild(img);
				option.addEventListener('click', () => this.selectGlitter(index));
				grid.appendChild(option);
			});

			categoryDiv.appendChild(grid);
			container.appendChild(categoryDiv);
		});

		// ADD THESE TWO LINES HERE ↓
		// Initialize disabled state for all glitter options
		this.updateGlitterOptionsState();
	}

	handleSearchInput(searchTerm) {
		this.activeFilters.search = searchTerm.toLowerCase().trim();
		this.applyFilters();
	}

	toggleFilter(chip) {
		console.log('toggleFilter called:', chip, chip.dataset);
		const filterType = chip.dataset.filter;
		const value = chip.dataset.value || chip.dataset.color;

		console.log('filterType:', filterType, 'value:', value);

		chip.classList.toggle('active');
		console.log('chip classes after toggle:', chip.className);

		console.log('About to check if filterType === color:', filterType === 'color');

		if (filterType === 'color') {
			if (this.activeFilters.colors.has(value)) {
				this.activeFilters.colors.delete(value);
			} else {
				this.activeFilters.colors.add(value);
			}
		}

		console.log('activeFilters.colors:', this.activeFilters.colors);

		this.applyFilters();
		this.updateClearFiltersButton();
	}

	clearAllFilters() {
		this.activeFilters.colors.clear();
		this.activeFilters.search = '';
		this.activeFilters.nameOnly = false;

		document.getElementById('glitterSearch').value = '';
		document.getElementById('searchNameOnly').checked = false;
		document.querySelectorAll('.filter-chip').forEach(chip => {
			chip.classList.remove('active');
		});

		this.applyFilters();
		this.updateClearFiltersButton();

		this.toggleFilters();
	}

	updateClearFiltersButton() {
		const hasActiveFilters =
			this.activeFilters.colors.size > 0 ||
			this.activeFilters.tones.size > 0 ||
			this.activeFilters.special.size > 0 ||
			this.activeFilters.search !== '' ||
			this.activeFilters.nameOnly;

		document.getElementById('clearFiltersBtn').disabled = !hasActiveFilters;


	}

	applyFilters() {
		const categories = document.querySelectorAll('.glitter-category');

		categories.forEach(category => {
			const options = category.querySelectorAll('.glitter-option');
			let visibleCount = 0;

			options.forEach(option => {
				const name = (option.dataset.name || '').toLowerCase();
				const tagsString = (option.dataset.tags || '').toLowerCase();
				const tags = tagsString.split(' ').filter(t => t.length > 0);

				let matches = true;

				if (this.activeFilters.search) {
					const term = this.activeFilters.search;
					if (this.activeFilters.nameOnly) {
						if (!name.includes(term)) matches = false;
					} else {
						if (!name.includes(term) && !tagsString.includes(term)) {
							matches = false;
						}
					}
				}

				if (matches && this.activeFilters.colors.size > 0) {
					const hasColor = [...this.activeFilters.colors].some(color => tags.includes(color));
					if (!hasColor) matches = false;
				}

				option.style.display = matches ? 'block' : 'none';
				if (matches) {
					visibleCount++;
				}
			});

			category.style.display = visibleCount > 0 ? 'block' : 'none';
		});
	}

	async selectGlitter(index) {

		const layer = this.getActiveLayer();
		if (!layer) {
			// UX: Don't allow selection when no layer is active
			return;
		}

		layer.selectedGlitterIndex = index;

		const glitter = this.glitterGifs[index];
		if (!glitter) return;

		if (!glitter.frames) {
			this.updateStatus(`Downloading ${glitter.name} glitter...`);
			document.body.style.cursor = 'wait';

			try {
				const frames = await this.parseGifFromUrl(glitter.url);
				glitter.frames = frames;
			} catch (error) {
				console.error('Failed to load glitter:', error);
				this.showError(`Failed to load ${glitter.name} glitter`);
				document.body.style.cursor = 'default';
				return;
			} finally {
				document.body.style.cursor = 'default';
			}
		}

		this.updateGlitterSelection();
		this.renderLayersList();

		if (layer.selections.length > 0) {
			this.updatePreview();
		}

		this.updateActionButtons();

		if (this.originalImage) {
			this.saveState();
		}

		this.updateStatus(`Selected ${glitter.name}`);
		window.dispatchEvent(new CustomEvent('layerChanged'));
	}

	// ===== IMAGE LOADING =====

	async loadImage(event) {
		const file = event.target.files[0];
		if (!file) return;

		if (file.size > CONFIG.maxFileSizeMB * 1024 * 1024) {
			this.showError(`Image too large. Maximum size is ${CONFIG.maxFileSizeMB}MB`);
			return;
		}

		const img = new Image();
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

			this.originalCtx.drawImage(img, 0, 0, width, height);
			this.originalImageData = this.originalCtx.getImageData(0, 0, width, height);

			this.originalAlphaChannel = new Uint8Array(width * height);
			for (let i = 0; i < width * height; i++) {
				this.originalAlphaChannel[i] = this.originalImageData.data[i * 4 + 3];
			}

			// Reset viewport (zoom and pan)
			this.resetViewport();
			this.updateZoomUI();

			const dropzone = document.getElementById('imageDropzone');
			dropzone.classList.add('has-image');
			document.getElementById('dropzoneContent').classList.remove('visible');
			this.originalCanvas.classList.add('visible');

			// Clear previous layers and glitter
			this.layers = [];
			this.glitterBackgroundsContainer.innerHTML = '';

			if (CONFIG.createDefaultLayerOnLoad) {
				const layer = this.createLayer();
				this.layers.push(layer);
				this.setActiveLayer(layer.id); // Use setActiveLayer instead of directly setting activeLayerId
			} else {
				this.activeLayerId = null;
				this.showLayerSettingsEmptyState();
				this.showGlitterSettingsEmptyState();
			}

			this.history = [{
				layers: this.layers.map(layer => ({
					id: layer.id,
					visible: layer.visible,
					selections: [],
					selectedGlitterIndex: layer.selectedGlitterIndex,
					settings: { ...layer.settings }
				})),
				activeLayerId: this.activeLayerId
			}];
			this.historyIndex = 0;

			this.renderLayersList();
			this.updateHistoryButtons();
			this.updateActionButtons();
			this.updateStatusBar();

			this.previewCtx.putImageData(this.originalImageData, 0, 0);
			this.setTool('colorPicker');
			this.updateStatus('Click on the preview to select a color');

			window.dispatchEvent(new Event('imageLoaded'));


		};
		img.src = URL.createObjectURL(file);
	}

	updateStatusBar() {
		if (this.originalImage) {
			const dims = `${this.originalCanvas.width} × ${this.originalCanvas.height}px`;
			document.getElementById('statusDimensions').textContent = dims;

			const zoomPct = Math.round(this.currentZoom * 100);
			document.getElementById('statusZoom').textContent = `${zoomPct}%`;
		} else {
			document.getElementById('statusDimensions').textContent = '';
			document.getElementById('statusZoom').textContent = '';
		}
	}

	updatePreviewScale() {
		document.querySelectorAll('.glitter-bg-layer').forEach(bg => {
			bg.style.width = this.originalCanvas.width + 'px';
			bg.style.height = this.originalCanvas.height + 'px';

			const layerId = bg.dataset.layerId;
			const layer = this.layers.find(l => l.id === layerId);
			if (layer) {
				const glitter = this.glitterGifs[layer.selectedGlitterIndex];
				if (glitter && glitter.frames) {
					const glitterScale = layer.settings.scale / 100;
					const scaledGlitterSize = Math.round(glitter.frames.width * glitterScale);
					bg.style.backgroundSize = `${scaledGlitterSize}px`;
				}
			}
		});
	}

	handleCanvasClick(event) {
		if (!this.originalImageData) return;

		const rect = this.previewCanvas.getBoundingClientRect();
		const clickX = event.clientX - rect.left;
		const clickY = event.clientY - rect.top;

		const scaleX = this.previewCanvas.width / rect.width;
		const scaleY = this.previewCanvas.height / rect.height;

		const x = Math.floor(clickX * scaleX);
		const y = Math.floor(clickY * scaleY);

		if (x < 0 || x >= this.previewCanvas.width || y < 0 || y >= this.previewCanvas.height) {
			return;
		}

		// Select Tool: Pick layer at click location
		if (this.currentTool === 'select') {
			this.handleLayerPick(x, y);
			return;
		}

		// Color Picker Tool
		// Color Picker Tool
		if (this.currentTool === 'colorPicker') {
			let layer = this.getActiveLayer();

			// If no active layer, find an empty one or create new
			if (!layer) {
				// Try to find a layer with no selections
				const emptyLayer = this.layers.find(l => !l.selections || l.selections.length === 0);

				if (emptyLayer) {
					// Reuse empty layer
					this.setActiveLayer(emptyLayer.id);
					layer = emptyLayer;
					this.updateStatus('Selected empty layer');
				} else {
					// All layers have selections - create a new one
					const newLayer = this.createLayer();
					this.layers.push(newLayer);
					this.setActiveLayer(newLayer.id);
					this.renderLayersList();
					layer = newLayer;
					this.updateStatus('Created new layer');
				}
			}

			const pixelIndex = y * this.originalCanvas.width + x;
			const alpha = this.originalAlphaChannel[pixelIndex];

			if (alpha < CONFIG.alphaThreshold) {
				this.updateStatus('Cannot select transparent pixels');
				return;
			}

			const i = pixelIndex * 4;
			const r = this.originalImageData.data[i];
			const g = this.originalImageData.data[i + 1];
			const b = this.originalImageData.data[i + 2];

			const multiSelect = layer.settings.multiSelect;
			if (!multiSelect) layer.selections = [];

			layer.selections.push({ r, g, b, x, y });
			this.renderLayersList();
			this.saveState();
			this.updatePreview();
			this.updateActionButtons();
			this.updateSelectedColorsDisplay();

			this.updateStatus(`Selected RGB(${r}, ${g}, ${b}) at (${x}, ${y})`);
		}
	}

	handleLayerPick(x, y) {
		// Check layers from top to bottom (end to start of array)
		for (let i = this.layers.length - 1; i >= 0; i--) {
			const layer = this.layers[i];

			// Skip invisible layers
			if (!layer.visible) continue;

			// Skip layers without selections
			if (!layer.selections || layer.selections.length === 0) continue;

			// Check if this pixel is covered by this layer's selection
			if (this.isPixelInLayerSelection(layer, x, y)) {
				this.setActiveLayer(layer.id);
				const glitterName = this.glitterGifs[layer.selectedGlitterIndex]?.name || 'Layer';
				this.updateStatus(`Selected: ${glitterName}`);

				// Brief visual feedback
				const flash = document.createElement('div');
				flash.className = 'layer-pick-flash';
				flash.style.left = (x / this.previewCanvas.width * 100) + '%';
				flash.style.top = (y / this.previewCanvas.height * 100) + '%';
				this.previewWrapper.appendChild(flash);
				setTimeout(() => flash.remove(), 300);

				return;
			}
		}

		// Nothing clicked - deselect
		this.setActiveLayer(null);
		this.updateStatus('No layer at this location');
	}

	isPixelInLayerSelection(layer, x, y) {
		const pixelIndex = y * this.originalCanvas.width + x;
		const i = pixelIndex * 4;

		const pixelR = this.originalImageData.data[i];
		const pixelG = this.originalImageData.data[i + 1];
		const pixelB = this.originalImageData.data[i + 2];
		const pixelAlpha = this.originalAlphaChannel[pixelIndex];

		// Check if pixel is transparent
		if (pixelAlpha < CONFIG.alphaThreshold) {
			return false;
		}

		// Check if pixel matches any of this layer's color selections
		const threshold = layer.settings.threshold;
		const invert = layer.settings.invert;

		for (const sel of layer.selections) {
			const distance = Math.sqrt(
				Math.pow(pixelR - sel.r, 2) +
				Math.pow(pixelG - sel.g, 2) +
				Math.pow(pixelB - sel.b, 2)
			);

			const matches = distance <= threshold;
			if (invert ? !matches : matches) {
				return true;
			}
		}

		return false;
	}

	updateSelectedColorsDisplay() {
		const container = document.getElementById('selectedColorsDisplay');
		const layer = this.getActiveLayer();

		if (!layer || layer.selections.length === 0) {
			container.innerHTML = '<span class="empty-state-text">None</span>';
			return;
		}

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
		const layer = this.getActiveLayer();
		if (!layer) return;

		layer.selections.splice(index, 1);
		this.renderLayersList();
		this.saveState();

		if (layer.selections.length > 0) {
			this.updatePreview();
		} else {
			this.clearPreview();
		}

		this.updateActionButtons();
		this.updateSelectedColorsDisplay();
	}

	clearPreview() {
		if (this.originalImageData) {
			this.previewCtx.putImageData(this.originalImageData, 0, 0);
		} else {
			this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
		}

		this.glitterBackgroundsContainer.innerHTML = '';
	}

	// ===== PREVIEW & RENDERING =====

	updatePreview() {
		if (!this.originalImageData) {
			this.clearPreview();
			return;
		}

		const layersToShow = this.showAllLayers
			? this.layers.filter(l => l.visible && l.selections.length > 0)
			: [this.getActiveLayer()].filter(l => l && l.visible && l.selections.length > 0);

		if (layersToShow.length === 0) {
			this.clearPreview();
			return;
		}

		this.renderPreviewCanvas(layersToShow);
		this.renderGlitterBackgrounds(layersToShow);
		this.updatePreviewScale();
	}


	/*

	renderPreviewCanvas(layersToShow) {
		const previewData = new ImageData(
			new Uint8ClampedArray(this.originalImageData.data),
			this.previewCanvas.width,
			this.previewCanvas.height
		);

		layersToShow.forEach(layer => {
			const mask = this.createMaskForLayer(layer);
			if (layer.settings.feather > 0) {
				this.applyFeatherToMask(mask, layer.settings.feather);
			}

			const opacity = layer.settings.opacity / 100;

			for (let i = 0; i < mask.length; i++) {
				const maskValue = mask[i] / 255;
				const originalAlpha = this.originalAlphaChannel[i];
				const idx = i * 4;

				if (originalAlpha < CONFIG.alphaThreshold) {
					previewData.data[idx + 3] = 0;
				} else if (maskValue > 0) {
					const currentAlpha = previewData.data[idx + 3];
					previewData.data[idx + 3] = Math.max(0, currentAlpha - Math.round(originalAlpha * maskValue * opacity));
				}
			}
		});

		this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
		this.previewCtx.putImageData(previewData, 0, 0);
	}

		*/

	renderPreviewCanvas(layersToShow) {
		// Just draw the original image. The glitter sits on top as a DOM element.
		this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
		this.previewCtx.putImageData(this.originalImageData, 0, 0);
	}



	renderGlitterBackgrounds(layersToShow) {
		this.glitterBackgroundsContainer.innerHTML = '';

		const width = this.originalCanvas.width;
		const height = this.originalCanvas.height;

		layersToShow.forEach(layer => {
			const glitter = this.glitterGifs[layer.selectedGlitterIndex];
			if (!glitter) return;

			const mask = this.createMaskForLayer(layer);
			if (layer.settings.feather > 0) {
				this.applyFeatherToMask(mask, layer.settings.feather);
			}

			const maskCanvas = document.createElement('canvas');
			maskCanvas.width = width;
			maskCanvas.height = height;
			const maskCtx = maskCanvas.getContext('2d');
			const maskData = maskCtx.createImageData(width, height);

			for (let i = 0; i < width * height; i++) {
				const alpha = this.originalAlphaChannel[i];
				const maskValue = mask[i];
				const idx = i * 4;

				if (alpha >= CONFIG.alphaThreshold && maskValue > 0) {
					maskData.data[idx] = 0;
					maskData.data[idx + 1] = 0;
					maskData.data[idx + 2] = 0;
					maskData.data[idx + 3] = maskValue;
				} else {
					maskData.data[idx] = 0;
					maskData.data[idx + 1] = 0;
					maskData.data[idx + 2] = 0;
					maskData.data[idx + 3] = 0;
				}
			}

			maskCtx.putImageData(maskData, 0, 0);

			const bg = document.createElement('div');
			bg.className = 'glitter-background glitter-bg-layer visible';
			if (glitter.isPixelated) {
				bg.classList.add('pixelated');
			}
			bg.dataset.layerId = layer.id;
			bg.style.backgroundImage = `url(${glitter.url})`;

			bg.style.width = width + 'px';
			bg.style.height = height + 'px';
			bg.style.position = 'absolute';
			bg.style.top = '0';
			bg.style.left = '0';

			// --- CHANGED: Increase Z-Index to ensure it sits over the canvas ---
			bg.style.zIndex = '100';
			// -------------------------------------------------------------------

			bg.style.pointerEvents = 'none';

			// --- ADDED: Apply Opacity here so transparent glitters fade correctly ---
			bg.style.opacity = layer.settings.opacity / 100;
			// ------------------------------------------------------------------------

			const maskDataURL = maskCanvas.toDataURL();
			bg.style.maskImage = `url(${maskDataURL})`;
			bg.style.webkitMaskImage = `url(${maskDataURL})`;

			bg.style.maskSize = `${width}px ${height}px`;
			bg.style.webkitMaskSize = `${width}px ${height}px`;
			bg.style.maskRepeat = 'no-repeat';
			bg.style.webkitMaskRepeat = 'no-repeat';

			this.glitterBackgroundsContainer.appendChild(bg);
		});
	}

	createMaskForLayer(layer) {
		const width = this.originalCanvas.width;
		const height = this.originalCanvas.height;
		const len = width * height;

		const mask = new Uint8Array(len);
		const thresholdSq = layer.settings.threshold * layer.settings.threshold;
		const data = this.originalImageData.data;
		const alphaChannel = this.originalAlphaChannel;

		layer.selections.forEach(sel => {
			if (layer.settings.contiguous) {
				this.floodFill(mask, sel.x, sel.y, sel, thresholdSq);
			} else {
				for (let i = 0; i < len; i++) {
					if (mask[i] === 255) continue;
					if (alphaChannel[i] < CONFIG.alphaThreshold) continue;

					const idx = i * 4;
					const r = data[idx];
					const g = data[idx + 1];
					const b = data[idx + 2];

					if (this.colorDistanceSq(r, g, b, sel.r, sel.g, sel.b) <= thresholdSq) {
						mask[i] = 255;
					}
				}
			}
		});

		if (layer.settings.invert) {
			for (let i = 0; i < len; i++) {
				if (alphaChannel[i] >= CONFIG.alphaThreshold) {
					mask[i] = 255 - mask[i];
				}
			}
		}

		return mask;
	}

	colorDistanceSq(r1, g1, b1, r2, g2, b2) {
		return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
	}

	floodFill(mask, startX, startY, targetColor, thresholdSq) {
		const width = this.originalCanvas.width;
		const height = this.originalCanvas.height;
		const totalPixels = width * height;
		const data = this.originalImageData.data;
		const alphaChannel = this.originalAlphaChannel;

		const stack = [startY * width + startX];

		while (stack.length > 0) {
			const idx = stack.pop();
			if (mask[idx] === 255) continue;

			const r = data[idx * 4];
			const g = data[idx * 4 + 1];
			const b = data[idx * 4 + 2];

			if (alphaChannel[idx] >= CONFIG.alphaThreshold &&
				this.colorDistanceSq(r, g, b, targetColor.r, targetColor.g, targetColor.b) <= thresholdSq) {

				mask[idx] = 255;

				if ((idx + 1) % width !== 0 && mask[idx + 1] === 0) stack.push(idx + 1);
				if (idx % width !== 0 && mask[idx - 1] === 0) stack.push(idx - 1);
				if (idx + width < totalPixels && mask[idx + width] === 0) stack.push(idx + width);
				if (idx - width >= 0 && mask[idx - width] === 0) stack.push(idx - width);
			}
		}
	}

	applyFeatherToMask(mask, radius) {
		const width = this.originalCanvas.width;
		const height = this.originalCanvas.height;
		const tempMask = new Uint8Array(mask);

		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				let sum = 0, count = 0;
				for (let dy = -radius; dy <= radius; dy++) {
					for (let dx = -radius; dx <= radius; dx++) {
						const nx = x + dx, ny = y + dy;
						if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
							sum += tempMask[ny * width + nx];
							count++;
						}
					}
				}
				mask[y * width + x] = Math.round(sum / count);
			}
		}
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

	async exportAnimatedGif() {
		const visibleLayers = this.layers.filter(l => l.visible && l.selections.length > 0);

		if (visibleLayers.length === 0) {
			this.showError('No visible layers with selections!');
			return;
		}

		const exportBtn = document.getElementById('exportGif');
		exportBtn.disabled = true;
		this.showExportProgress();

		// Read current settings from DOM
		// Read current settings from DOM
		const qualityInput = document.getElementById('exportQuality');
		const ditherEnabledInput = document.getElementById('exportDitherEnabled');
		const ditherTypeInput = document.getElementById('exportDitherType');
		const baseImageInput = document.getElementById('exportBaseImage');
		const transparencyInput = document.getElementById('exportTransparency');
		const matteColorInput = document.getElementById('exportMatteColor');
		const delayInput = document.getElementById('exportFrameDelay');
		const maxFramesInput = document.getElementById('exportMaxFrames');

		this.exportSettings.quality = qualityInput ? parseInt(qualityInput.value) : CONFIG.defaultExportQuality;
		this.exportSettings.ditherEnabled = ditherEnabledInput ? ditherEnabledInput.checked : CONFIG.defaultExportDitherEnabled;
		this.exportSettings.ditherType = ditherTypeInput ? ditherTypeInput.value : CONFIG.defaultExportDitherType;
		this.exportSettings.frameDelay = delayInput ? parseInt(delayInput.value) : CONFIG.defaultExportFrameDelay;
		this.exportSettings.maxFrames = maxFramesInput ? parseInt(maxFramesInput.value) : CONFIG.defaultExportMaxFrames;
		this.exportSettings.baseImage = baseImageInput ? baseImageInput.checked : CONFIG.defaultExportBaseImage;
		this.exportSettings.transparency = transparencyInput ? transparencyInput.checked : CONFIG.defaultExportTransparency;
		this.exportSettings.matteColor = matteColorInput ? matteColorInput.value : CONFIG.defaultExportMatteColor;

		console.log('Export settings:', this.exportSettings);

		const exportParams = {
			visibleLayers: visibleLayers,
			glitterGifs: this.glitterGifs,
			canvasData: {
				width: this.originalCanvas.width,
				height: this.originalCanvas.height,
				originalData: this.originalImageData.data,
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
					this.hideExportProgress();
				},
				parseGif: (url) => this.parseGifFromUrl(url),
				createMask: (layer) => {
					const mask = this.createMaskForLayer(layer);
					if (layer.settings.feather > 0) {
						this.applyFeatherToMask(mask, layer.settings.feather);
					}
					return mask;
				}
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
class GifExporter {
	constructor() {
		const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

		this.config = {
			workers: 4,
			// Quality 1 = Best (samples every pixel). Critical for pixel art accuracy.
			quality: 1,
			workerScript: isLocal
				? 'js/gif.worker.js'
				: 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js',
			fileName: 'ryandavi-com_glitter.gif',
			timing: { forceDelay: 100, maxFrames: 60 }
		};

		// Reusable canvas elements
		this.canvas = document.createElement('canvas');
		this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

		this.helperCanvas = document.createElement('canvas');
		this.helperCtx = this.helperCanvas.getContext('2d', { willReadFrequently: true });
	}

	gcd(a, b) { return !b ? a : this.gcd(b, a % b); }
	lcm(a, b) { return (a * b) / this.gcd(a, b); }

	_hasTransparency(canvasData) {
		const { originalAlpha, alphaThreshold } = canvasData;
		for (let i = 0; i < originalAlpha.length; i++) {
			if (originalAlpha[i] < alphaThreshold) {
				return true; // Found at least one transparent pixel
			}
		}
		return false; // No transparency in image
	}

	async process(params) {
		const { visibleLayers, glitterGifs, canvasData, exportSettings, callbacks } = params;

		// 1. Ensure Frames Loaded
		callbacks.onProgress(0, 'Loading glitter frames...', 0, 0);
		await this._loadMissingFrames(visibleLayers, glitterGifs, callbacks);

		// 2. De-Optimize Frames (Flatten disposal methods)
		callbacks.onProgress(5, 'Processing frames...', 0, 0);
		this._deoptimizeGlitterFrames(visibleLayers, glitterGifs);

		// 3. CHECK FOR TRANSPARENCY
		const hasTransparency = this._hasTransparency(canvasData);
		console.log(`[GifExporter] Image has transparency: ${hasTransparency}`);

		// Need a safe key if EITHER the image has transparency OR we're exporting glitter-only
		const needsSafeKey = hasTransparency || !exportSettings.baseImage;

		// Only find a safe key if we actually need transparency
		const safeKey = needsSafeKey
			? this._findSafeTransparencyKey(visibleLayers, glitterGifs, canvasData)
			: null;

		if (safeKey) {
			console.log(`[GifExporter] Selected Safe Transparency Key: RGB(${safeKey.r}, ${safeKey.g}, ${safeKey.b})`);
		}

		// 4. Synchronization
		const totalFrames = this._calculateTotalFrames(visibleLayers, glitterGifs, exportSettings.maxFrames);
		callbacks.onStatus(`Rendering ${totalFrames} frames...`);

		// 5. Prepare Masks
		callbacks.onProgress(10, 'Preparing masks...', 0, totalFrames);
		const maskCanvases = new Map();

		this.helperCanvas.width = canvasData.width;
		this.helperCanvas.height = canvasData.height;

		visibleLayers.forEach(layer => {
			const rawMask = callbacks.createMask(layer);
			const maskCanvas = this._createMaskCanvas(rawMask, canvasData.width, canvasData.height);
			maskCanvases.set(layer.id, maskCanvas);
		});

		// 6. Setup Encoder
		// Disable dithering when we need transparency
		const needsTransparency = hasTransparency && exportSettings.transparency;

		const gifOptions = {
			workers: this.config.workers,
			quality: exportSettings.quality,
			width: canvasData.width,
			height: canvasData.height,
			workerScript: this.config.workerScript,
			dither: needsTransparency
				? false
				: (exportSettings.ditherEnabled ? exportSettings.ditherType : false)
		};

		// Enable transparency if user wants it and we have a safe key
		if (needsTransparency && safeKey) {
			gifOptions.transparent = safeKey.hex;
			gifOptions.background = safeKey.hex;  // MUST BE safeKey.hex, not 0
			console.log('[GifExporter] Transparency enabled with key:', safeKey.hex);
		}

		const gif = new GIF(gifOptions);

		// 7. Render Loop
		this.canvas.width = canvasData.width;
		this.canvas.height = canvasData.height;

		for (let f = 0; f < totalFrames; f++) {
			const frameData = this._renderFrame(f, canvasData, visibleLayers, glitterGifs, maskCanvases, safeKey, exportSettings);

			// Around line 105, REMOVE dispose: 2 again:
			gif.addFrame(frameData, {
				delay: exportSettings.frameDelay,
				copy: true
				// NO dispose property - we're providing full frames
			});
			const progressPercent = 10 + Math.floor((f / totalFrames) * 65);
			callbacks.onProgress(progressPercent, `Rendering frame ${f + 1}/${totalFrames}...`, f + 1, totalFrames);
		}

		// 8. Output
		callbacks.onProgress(75, 'Encoding GIF...', totalFrames, totalFrames);

		gif.on('error', (error) => {
			console.error('GIF encoding error:', error);
			throw new Error('GIF encoding failed: ' + error.message);
		});

		gif.on('abort', () => {
			throw new Error('Export cancelled');
		});

		gif.on('finished', (blob) => this._handleFileSave(blob, callbacks));

		console.log('Starting GIF render:', {
			frames: totalFrames,
			workers: this.config.workers,
			quality: exportSettings.quality,
			key: safeKey
		});

		gif.render();
	}

	// --- HELPER METHODS ---

	_findSafeTransparencyKey(layers, library, canvasData) {
		const candidates = [
			{ name: 'DarkGray1', hex: 0x010101, r: 1, g: 1, b: 1 },
			{ name: 'DarkGray2', hex: 0x020202, r: 2, g: 2, b: 2 },
			{ name: 'DarkGray3', hex: 0x030303, r: 3, g: 3, b: 3 },
			{ name: 'OffGreen1', hex: 0x00FE00, r: 0, g: 254, b: 0 },
			{ name: 'OffGreen2', hex: 0x01FF00, r: 1, g: 255, b: 0 },
			{ name: 'Green', hex: 0x00FF00, r: 0, g: 255, b: 0 },
			{ name: 'Magenta', hex: 0xFF00FF, r: 255, g: 0, b: 255 },
			{ name: 'Blue', hex: 0x0000FF, r: 0, g: 0, b: 255 },
			{ name: 'Red', hex: 0xFF0000, r: 255, g: 0, b: 0 },
			{ name: 'Yellow', hex: 0xFFFF00, r: 255, g: 255, b: 0 },
			{ name: 'Cyan', hex: 0x00FFFF, r: 0, g: 255, b: 255 }
		];

		const glitterFrames = [];
		layers.forEach(layer => {
			const glitter = library[layer.selectedGlitterIndex];
			if (glitter?.frames?.frames) {
				glitterFrames.push(...glitter.frames.frames);
			}
		});

		for (const candidate of candidates) {
			let isSafe = true;

			const imgData = canvasData.originalData;
			const imgLen = imgData.length;

			for (let i = 0; i < imgLen; i += 4) {
				const pixelIndex = i / 4;
				if (canvasData.originalAlpha[pixelIndex] < canvasData.alphaThreshold) continue;

				if (imgData[i] === candidate.r &&
					imgData[i + 1] === candidate.g &&
					imgData[i + 2] === candidate.b) {
					isSafe = false;
					break;
				}
			}

			if (!isSafe) continue;

			for (const frame of glitterFrames) {
				const data = frame.data;
				const len = data.length;

				for (let i = 0; i < len; i += 4) {
					if (data[i + 3] === 0) continue;
					if (data[i] === candidate.r &&
						data[i + 1] === candidate.g &&
						data[i + 2] === candidate.b) {
						isSafe = false;
						break;
					}
				}
				if (!isSafe) break;
			}

			if (isSafe) {
				console.log(`[GifExporter] Found safe transparency key: ${candidate.name} RGB(${candidate.r}, ${candidate.g}, ${candidate.b})`);
				return candidate;
			}
		}

		console.warn('[GifExporter] All candidates failed. Using ultra-dark fallback.');
		return { name: 'Fallback', hex: 0x000001, r: 0, g: 0, b: 1 };
	}

	_renderFrame(frameIndex, canvasData, layers, library, maskCanvases, safeKey, exportSettings) {
		const { width, height, originalData, originalAlpha, alphaThreshold } = canvasData;
		const ctx = this.ctx;
		const hCtx = this.helperCtx;

		// A. Clear canvas
		this.canvas.width = width;
		this.canvas.height = height;
		ctx.clearRect(0, 0, width, height);

		// B. Draw Background Image
		if (exportSettings.baseImage) {
			const bgImage = new ImageData(originalData, width, height);
			ctx.putImageData(bgImage, 0, 0);
		}

		// C. Composite Glitter Layers
		layers.forEach(layer => {
			const maskCanvas = maskCanvases.get(layer.id);
			if (!maskCanvas) return;

			const glitter = library[layer.selectedGlitterIndex];
			const frames = glitter.frames.frames;
			const fIdx = frameIndex % frames.length;
			const glitterFrame = frames[fIdx];

			// FIX: Save state so previous layers don't corrupt this one
			hCtx.save();

			// 1. Pattern Fill
			hCtx.clearRect(0, 0, width, height);

			const patternSource = document.createElement('canvas');
			patternSource.width = glitterFrame.width;
			patternSource.height = glitterFrame.height;
			patternSource.getContext('2d').putImageData(glitterFrame.data, 0, 0);

			const pattern = hCtx.createPattern(patternSource, 'repeat');
			const scale = (layer.settings.scale <= 0 ? 1 : layer.settings.scale) / 100;
			const matrix = new DOMMatrix();
			matrix.scaleSelf(scale, scale);
			pattern.setTransform(matrix);

			hCtx.globalAlpha = layer.settings.opacity / 100;
			hCtx.fillStyle = pattern;
			hCtx.fillRect(0, 0, width, height);

			// 2. Apply Mask
			hCtx.globalCompositeOperation = 'destination-in';
			hCtx.globalAlpha = 1.0;
			hCtx.drawImage(maskCanvas, 0, 0);

			// Restore state (resets composite op and alpha)
			hCtx.restore();

			// 3. Draw to Main
			ctx.drawImage(this.helperCanvas, 0, 0);
		});

		// D. APPLY TRANSPARENCY OR MATTE COLOR
		const output = ctx.getImageData(0, 0, width, height);
		const data = output.data;
		const len = data.length;

		const shouldApplyTransparency = exportSettings.transparency && safeKey;
		const shouldApplyMatte = !exportSettings.transparency && safeKey;

		if (shouldApplyTransparency) {
			// TRANSPARENCY LOGIC
			const { r: keyR, g: keyG, b: keyB } = safeKey;

			for (let i = 0; i < len; i += 4) {
				const pixelIndex = i / 4;
				const currentAlpha = data[i + 3];

				let shouldBeTransparent = false;

				if (!exportSettings.baseImage) {
					shouldBeTransparent = (currentAlpha === 0);
				} else {
					shouldBeTransparent = (originalAlpha[pixelIndex] < alphaThreshold);
				}

				if (shouldBeTransparent) {
					// FORCE TRANSPARENT: Fill with Safe Key Color
					data[i] = keyR;
					data[i + 1] = keyG;
					data[i + 2] = keyB;
					data[i + 3] = 255;
				} else {
					// CONFLICT CHECK
					if (data[i] === keyR && data[i + 1] === keyG && data[i + 2] === keyB) {
						data[i + 1] = (keyG === 255) ? 254 : keyG + 1;
					}
					data[i + 3] = 255;
				}
			}
		} else if (shouldApplyMatte) {
			// APPLY MATTE COLOR
			const matteColor = this._parseHexColor(exportSettings.matteColor);

			for (let i = 0; i < len; i += 4) {
				const pixelIndex = i / 4;
				const currentAlpha = data[i + 3];

				let needsMatte = false;

				if (!exportSettings.baseImage) {
					needsMatte = (currentAlpha === 0);
				} else {
					needsMatte = (originalAlpha[pixelIndex] < alphaThreshold);
				}

				if (needsMatte) {
					if (currentAlpha === 0) {
						data[i] = matteColor.r;
						data[i + 1] = matteColor.g;
						data[i + 2] = matteColor.b;
						data[i + 3] = 255;
					} else if (currentAlpha < 255) {
						const alpha = currentAlpha / 255;
						data[i] = Math.round(data[i] * alpha + matteColor.r * (1 - alpha));
						data[i + 1] = Math.round(data[i + 1] * alpha + matteColor.g * (1 - alpha));
						data[i + 2] = Math.round(data[i + 2] * alpha + matteColor.b * (1 - alpha));
						data[i + 3] = 255;
					} else {
						data[i + 3] = 255;
					}
				} else {
					data[i + 3] = 255;
				}
			}
		} else {
			// No transparency needed
			for (let i = 3; i < len; i += 4) {
				data[i] = 255;
			}
		}

		return output;
	}

	_parseHexColor(hex) {
		hex = hex.replace('#', '');
		const r = parseInt(hex.substring(0, 2), 16);
		const g = parseInt(hex.substring(2, 4), 16);
		const b = parseInt(hex.substring(4, 6), 16);
		return { r, g, b };
	}

	_createMaskCanvas(rawMaskData, width, height) {
		const c = document.createElement('canvas');
		c.width = width;
		c.height = height;
		const ctx = c.getContext('2d');

		const imgData = ctx.createImageData(width, height);
		const data = imgData.data;

		for (let i = 0; i < rawMaskData.length; i++) {
			const val = rawMaskData[i];
			const pIdx = i * 4;
			data[pIdx] = 0;
			data[pIdx + 1] = 0;
			data[pIdx + 2] = 0;
			data[pIdx + 3] = val;
		}

		ctx.putImageData(imgData, 0, 0);
		return c;
	}

	_deoptimizeGlitterFrames(layers, library) {
		layers.forEach(layer => {
			const glitter = library[layer.selectedGlitterIndex];
			if (glitter.isFlattened) return;

			const rawFrames = glitter.frames.frames;
			const width = glitter.frames.width;
			const height = glitter.frames.height;

			this.helperCanvas.width = width;
			this.helperCanvas.height = height;
			const ctx = this.helperCanvas.getContext('2d', { willReadFrequently: true });

			const tempC = document.createElement('canvas');
			const tempCtx = tempC.getContext('2d');

			const flattenedFrames = [];
			let previousFrameData = ctx.getImageData(0, 0, width, height);

			// We'll detect transparency from the FIRST FLATTENED FRAME
			let glitterHasTransparency = false;

			for (let i = 0; i < rawFrames.length; i++) {
				const frame = rawFrames[i];
				const dims = { x: frame.x || 0, y: frame.y || 0, w: frame.width || width, h: frame.height || height };

				const patchData = new ImageData(frame.data, dims.w, dims.h);
				tempC.width = dims.w;
				tempC.height = dims.h;
				tempCtx.putImageData(patchData, 0, 0);

				if (frame.disposal === 3) previousFrameData = ctx.getImageData(0, 0, width, height);

				ctx.drawImage(tempC, dims.x, dims.y);

				const flattenedData = ctx.getImageData(0, 0, width, height);

				flattenedFrames.push({
					data: flattenedData,
					width, height
				});

				// Check FIRST FRAME ONLY for actual transparency
				if (i === 0) {
					const checkData = flattenedData.data;
					for (let j = 3; j < checkData.length; j += 4) {
						if (checkData[j] < 255) {
							glitterHasTransparency = true;
							break;
						}
					}
					console.log(`[GifExporter] Glitter "${glitter.name}" has transparency: ${glitterHasTransparency}`);
				}

				// If glitter has transparency anywhere, ALL frames must clear (disposal=2)
				// Otherwise use stacking (disposal=1) for opaque glitter
				const disposal = glitterHasTransparency
					? 2
					: (frame.disposal !== undefined ? frame.disposal : 1);

				if (disposal === 2) ctx.clearRect(dims.x, dims.y, dims.w, dims.h);
				else if (disposal === 3) ctx.putImageData(previousFrameData, 0, 0);
			}

			glitter.frames.frames = flattenedFrames;
			glitter.isFlattened = true;
		});
	}

	async _loadMissingFrames(layers, library, callbacks) {
		for (const layer of layers) {
			const glitter = library[layer.selectedGlitterIndex];
			if (!glitter.frames) {
				callbacks.onStatus(`Loading ${glitter.name}...`);
				try {
					glitter.frames = await callbacks.parseGif(glitter.url);
				} catch (e) {
					throw new Error(`Failed to load ${glitter.name}`);
				}
			}
		}
	}

	_calculateTotalFrames(layers, library, maxFrames) {
		const counts = layers.map(l => {
			const glitter = library[l.selectedGlitterIndex];
			if (!glitter || !glitter.frames || !glitter.frames.frames) {
				console.error('Missing frames for layer', l.id, 'glitter index', l.selectedGlitterIndex);
				return 1;
			}
			return glitter.frames.frames.length;
		});

		let total = counts[0] || 1;
		if (counts.length > 1) {
			total = counts.reduce((acc, val) => this.lcm(acc, val), total);
		}

		const result = Math.min(total, maxFrames);
		console.log('Calculated total frames:', result, 'from counts:', counts);
		return result;
	}

	async _handleFileSave(blob, callbacks) {
		console.log('_handleFileSave called with blob size:', blob.size);
		callbacks.onProgress(100, 'Export complete!', 0, 0);
		callbacks.onStatus('Export complete!');
		callbacks.onComplete();

		const file = new File([blob], this.config.fileName, { type: 'image/gif' });
		const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

		if (isMobile && navigator.canShare && navigator.canShare({ files: [file] })) {
			try {
				await navigator.share({
					files: [file],
					title: 'Glitter Image',
					text: 'Created with Glitter Image Editor'
				});
				return;
			} catch (error) {
				if (error.name !== 'AbortError') console.warn('Share failed', error);
				else return;
			}
		}

		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = this.config.fileName;
		document.body.appendChild(a);
		a.click();
		setTimeout(() => {
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		}, 100);
	}
}




// ============================================
// TOOLTIP MANAGER CLASS
// ============================================
class TooltipManager {
	constructor(options = {}) {
		this.config = {
			gap: 8,                  // Distance from the element
			viewportPadding: 10,     // Buffer from screen edges
			dismissOnScroll: true,   // Hide on scroll
			oneAtATime: true,        // Only one open at a time
			placement: 'bottom',        // Primary Axis: top, bottom, left, right
			alignment: 'center',     // Secondary Axis: center, left, right, top, bottom
			...options
		};

		this.activeTooltip = null;
		this.activeElement = null;
		this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
		this.scrollContainers = new Set();

		this.handleScroll = this.handleScroll.bind(this);
		this.handleResize = this.handleResize.bind(this);
		this.handleOutsideClick = this.handleOutsideClick.bind(this);

		this.init();
	}

	init() {
		this.attachTooltipListeners();
		this.attachGlobalListeners();
	}

	findScrollableParent(element) {
		let parent = element.parentElement;
		while (parent) {
			const style = window.getComputedStyle(parent);
			if (['auto', 'scroll'].includes(style.overflow) ||
				['auto', 'scroll'].includes(style.overflowY)) {
				return parent;
			}
			parent = parent.parentElement;
		}
		return window;
	}

	attachTooltipListeners() {
		document.querySelectorAll('[data-tooltip]').forEach(el => {
			if (this.isTouchDevice) {
				el.addEventListener('click', (e) => this.handleMobileClick(e, el));
			} else {
				el.addEventListener('mouseenter', () => this.show(el));
				el.addEventListener('mouseleave', () => this.hide(el));
			}

			if (this.config.dismissOnScroll) {
				const scrollParent = this.findScrollableParent(el);
				if (!this.scrollContainers.has(scrollParent)) {
					this.scrollContainers.add(scrollParent);
					scrollParent.addEventListener('scroll', this.handleScroll, {
						passive: true
					});
				}
			}
		});
	}

	attachGlobalListeners() {
		if (this.config.dismissOnScroll) {
			window.addEventListener('scroll', this.handleScroll, {
				passive: true
			});
		}
		if (this.isTouchDevice) {
			document.addEventListener('click', this.handleOutsideClick);
		}
		window.addEventListener('resize', this.handleResize);
	}

	show(element) {
		if (this.config.oneAtATime) {
			this.dismissAll();
		}

		const tooltip = document.createElement('div');
		tooltip.className = 'tooltip';
		tooltip.textContent = element.dataset.tooltip;

		// Read overrides from data attributes, fallback to config
		tooltip.dataset.placement = element.dataset.placement || this.config.placement;
		tooltip.dataset.alignment = element.dataset.alignment || this.config.alignment;

		document.body.appendChild(tooltip);

		this.position(tooltip, element);

		element._tooltip = tooltip;
		this.activeTooltip = tooltip;
		this.activeElement = element;
	}

	// --- POSITIONING LOGIC ---

	position(tooltip, element) {
		const rect = element.getBoundingClientRect();
		const tooltipRect = tooltip.getBoundingClientRect();

		let preferredPlacement = tooltip.dataset.placement;
		const preferredAlignment = tooltip.dataset.alignment;

		// 1. Calculate preferred coordinates based on placement + alignment
		let coords = this.getCoords(preferredPlacement, preferredAlignment, rect, tooltipRect);

		// 2. Check collision with viewport edges (Main Axis flip)
		if (this.isOutOfBounds(coords, tooltipRect)) {
			const flippedPlacement = this.getOppositePlacement(preferredPlacement);
			const flippedCoords = this.getCoords(flippedPlacement, preferredAlignment, rect, tooltipRect);

			// If flipped fits better (or isn't strictly worse), use it
			if (!this.isOutOfBounds(flippedCoords, tooltipRect)) {
				coords = flippedCoords;
				preferredPlacement = flippedPlacement;
			}
		}

		// 3. Clamp Secondary Axis 
		// (Ensure it doesn't slide off screen left/right if placed top/bottom, etc.)
		coords = this.clampToViewport(coords, tooltipRect);

		// 4. Apply absolute position including current scroll offset
		tooltip.style.left = (coords.left + window.scrollX) + 'px';
		tooltip.style.top = (coords.top + window.scrollY) + 'px';
	}

	getCoords(placement, alignment, targetRect, tooltipRect) {
		const gap = this.config.gap;
		let top, left;

		// Logic split by axis
		switch (placement) {
			case 'top':
				top = targetRect.top - tooltipRect.height - gap;
				left = this.getHorizontalAlignment(alignment, targetRect, tooltipRect);
				break;
			case 'bottom':
				top = targetRect.bottom + gap;
				left = this.getHorizontalAlignment(alignment, targetRect, tooltipRect);
				break;
			case 'left':
				left = targetRect.left - tooltipRect.width - gap;
				top = this.getVerticalAlignment(alignment, targetRect, tooltipRect);
				break;
			case 'right':
				left = targetRect.right + gap;
				top = this.getVerticalAlignment(alignment, targetRect, tooltipRect);
				break;
			default: // Fallback to top/center
				top = targetRect.top - tooltipRect.height - gap;
				left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
		}

		return { top, left };
	}

	// Calculate X position based on alignment (left, center, right)
	getHorizontalAlignment(align, target, tooltip) {
		if (align === 'left' || align === 'start') {
			return target.left;
		}
		if (align === 'right' || align === 'end') {
			return target.right - tooltip.width;
		}
		// Default center
		return target.left + (target.width / 2) - (tooltip.width / 2);
	}

	// Calculate Y position based on alignment (top, center, bottom)
	getVerticalAlignment(align, target, tooltip) {
		if (align === 'top' || align === 'start') {
			return target.top;
		}
		if (align === 'bottom' || align === 'end') {
			return target.bottom - tooltip.height;
		}
		// Default center
		return target.top + (target.height / 2) - (tooltip.height / 2);
	}

	getOppositePlacement(placement) {
		const opposites = {
			'top': 'bottom',
			'bottom': 'top',
			'left': 'right',
			'right': 'left'
		};
		return opposites[placement] || 'top';
	}

	isOutOfBounds(coords, tooltipRect) {
		const padding = this.config.viewportPadding;
		return (
			coords.top < padding ||
			coords.left < padding ||
			coords.top + tooltipRect.height > window.innerHeight - padding ||
			coords.left + tooltipRect.width > window.innerWidth - padding
		);
	}

	clampToViewport(coords, tooltipRect) {
		const padding = this.config.viewportPadding;

		// Clamp Horizontal
		const maxLeft = window.innerWidth - tooltipRect.width - padding;
		coords.left = Math.max(padding, Math.min(coords.left, maxLeft));

		// Clamp Vertical
		const maxTop = window.innerHeight - tooltipRect.height - padding;
		coords.top = Math.max(padding, Math.min(coords.top, maxTop));

		return coords;
	}

	// --- END POSITIONING LOGIC ---

	hide(element) {
		if (element._tooltip) {
			element._tooltip.remove();
			element._tooltip = null;
			if (this.activeElement === element) {
				this.activeTooltip = null;
				this.activeElement = null;
			}
		}
	}

	dismissAll() {
		document.querySelectorAll('.tooltip').forEach(t => t.remove());
		document.querySelectorAll('[data-tooltip]').forEach(el => el._tooltip = null);
		this.activeTooltip = null;
		this.activeElement = null;
	}

	handleMobileClick(e, element) {
		e.preventDefault();
		e.stopPropagation();
		element._tooltip ? this.hide(element) : this.show(element);
	}

	handleScroll() { this.dismissAll(); }
	handleResize() { this.dismissAll(); }

	handleOutsideClick(e) {
		if (!e.target.closest('[data-tooltip], .tooltip')) {
			this.dismissAll();
		}
	}



	destroy() {
		this.dismissAll();
		this.scrollContainers.forEach(container => {
			container.removeEventListener('scroll', this.handleScroll);
		});
		this.scrollContainers.clear();
		window.removeEventListener('scroll', this.handleScroll);
		window.removeEventListener('resize', this.handleResize);
		document.removeEventListener('click', this.handleOutsideClick);
	}

	refresh() {
		this.attachTooltipListeners();
	}
}

// Initialize
const tooltips = new TooltipManager();



document.querySelectorAll('img[data-pixel-scale]').forEach(img => {
	const s = Number(img.dataset.pixelScale);
	img.style.width = img.naturalWidth * s + 'px';
	img.style.height = img.naturalHeight * s + 'px';
	img.style.imageRendering = 'pixelated';
});


// Reference linking and highlighting functionality
document.addEventListener('DOMContentLoaded', function () {
	const modalBody = document.querySelector('#aboutModal .modal-body');

	// Add IDs to sup elements and make them clickable
	const sups = modalBody.querySelectorAll('sup');
	sups.forEach((sup, index) => {
		const refNum = sup.textContent.match(/\d+/)[0];
		// Add both a unique ID and a class for the reference number
		sup.id = `ref-link-${refNum}-${index}`;
		sup.classList.add(`ref-${refNum}`);
		sup.style.cursor = 'pointer';

		sup.addEventListener('click', function (e) {
			e.preventDefault();
			const targetRef = modalBody.querySelector(`#ref-${refNum}`);
			if (targetRef) {
				// Remove any existing highlights
				modalBody.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));

				// Scroll to reference
				targetRef.scrollIntoView({ behavior: 'smooth', block: 'center' });

				// Highlight the reference
				targetRef.classList.add('highlight');
				setTimeout(() => targetRef.classList.remove('highlight'), 2000);
			}
		});
	});

	// Add IDs to reference list items and make them clickable
	const refList = modalBody.querySelector('h3:has(+ ol) + ol');
	if (refList) {
		const refItems = refList.querySelectorAll('li');
		refItems.forEach((item, index) => {
			const refNum = index + 1;
			item.id = `ref-${refNum}`;
			item.style.cursor = 'pointer';

			item.addEventListener('click', function (e) {
				// Don't trigger if clicking on a link
				if (e.target.tagName === 'A') return;

				e.preventDefault();

				// Find ALL occurrences of this reference number
				const targetSups = modalBody.querySelectorAll(`sup.ref-${refNum}`);

				if (targetSups.length > 0) {
					// Remove any existing highlights
					modalBody.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));

					// Scroll to first mention
					targetSups[0].scrollIntoView({ behavior: 'smooth', block: 'center' });

					// Highlight ALL matching sup elements
					targetSups.forEach(sup => {
						sup.classList.add('highlight');
					});

					// Remove highlights after 2 seconds
					setTimeout(() => {
						targetSups.forEach(sup => {
							sup.classList.remove('highlight');
						});
					}, 2000);
				}
			});
		});
	}
});


class MobileManager {
	constructor(editor) {
		this.editor = editor;
		this.isMobile = window.innerWidth <= 800;
		this.activeTab = 'image'; // image or preview
		this.activeDrawer = null; // glitter or layers or null
		this.resizeObserver = null;

		if (this.isMobile) {
			this.init();
		}

		this.setupResizeObserver();
		this.setupImageEvents();
	}

	init() {
		console.log('Mobile: Initializing mobile manager');
		this.createMobileControls();
		this.createMobileSwatch();
		this.setupEventListeners();
		this.switchTab('image');
		console.log('Mobile: Initialization complete, on image tab');
	}

	createMobileSwatch() {
		// Check if already exists
		if (document.querySelector('.mobile-swatch')) {
			return;
		}

		const previewContainer = document.getElementById('previewContainer');

		const swatch = document.createElement('div');
		swatch.className = 'mobile-swatch';
		swatch.innerHTML = `
		<div class="mobile-swatch-icon"></div>
		<div class="mobile-swatch-label">Glitter</div>
	`;

		swatch.addEventListener('click', () => {
			this.toggleDrawer('glitter');
		});

		previewContainer.appendChild(swatch);

		// Initial update
		this.updateMobileSwatch();
	}

	updateMobileSwatch() {
		const swatch = document.querySelector('.mobile-swatch');
		if (!swatch) return;

		const icon = swatch.querySelector('.mobile-swatch-icon');
		const layer = this.editor.getActiveLayer();

		if (layer) {
			const glitter = this.editor.glitterGifs[layer.selectedGlitterIndex];
			if (glitter) {
				icon.style.backgroundImage = `url(${glitter.url})`;
				if (glitter.isPixelated) {
					icon.classList.add('pixelated');
				} else {
					icon.classList.remove('pixelated');
				}
				swatch.classList.add('visible');  // CHANGED: add visible class
			} else {
				icon.style.backgroundImage = '';
				swatch.classList.remove('visible');  // CHANGED: remove visible class
			}
		} else {
			icon.style.backgroundImage = '';
			swatch.classList.remove('visible');  // CHANGED: remove visible class
		}
	}


	createMobileControls() {
		const mainContent = document.querySelector('.main-content');

		if (document.querySelector('.mobile-top-nav')) {
			console.log('Mobile: Controls already exist, skipping creation');
			return;
		}

		// Check if image exists to set initial disabled state
		const hasImage = this.editor.originalImage !== null;

		// Create top nav (Image/Preview tabs)
		const topNav = document.createElement('div');
		topNav.className = 'mobile-top-nav';
		topNav.innerHTML = `
		<button class="mobile-tab-btn active" data-tab="image">Image</button>
		<button class="mobile-tab-btn" data-tab="preview" ${!hasImage ? 'disabled' : ''}>Preview</button>
	`;

		// Create bottom nav (Glitter/Layers drawer buttons)
		const bottomNav = document.createElement('div');
		bottomNav.className = 'mobile-bottom-nav';
		bottomNav.innerHTML = `
	<button class="mobile-drawer-btn" data-drawer="layers">Layers</button>
	<button class="mobile-add-layer-btn" id="mobileAddLayerBtn">+</button>
	<button class="mobile-drawer-btn" data-drawer="glitter">Glitter</button>
`;

		document.body.insertBefore(topNav, document.body.firstChild);
		document.body.appendChild(bottomNav);

		console.log('Mobile: Navigation created');
	}

	setupEventListeners() {
		document.querySelectorAll('.mobile-tab-btn').forEach(btn => {
			btn.addEventListener('click', () => {
				this.switchTab(btn.dataset.tab);
			});
		});

		document.querySelectorAll('.mobile-drawer-btn').forEach(btn => {
			btn.addEventListener('click', () => {
				this.toggleDrawer(btn.dataset.drawer);
			});
		});

		// Add layer button
		const mobileAddLayerBtn = document.getElementById('mobileAddLayerBtn');
		if (mobileAddLayerBtn) {
			mobileAddLayerBtn.addEventListener('click', () => {
				this.editor.addLayer();
				// Open layers drawer to show the new layer
				// this.toggleDrawer('layers');
			});
		}

		// Close drawer when clicking on section headers (but not action buttons)
		document.querySelectorAll('.section-header').forEach(header => {
			header.addEventListener('click', (e) => {
				// Only close if mobile and a drawer is open
				if (this.isMobile && this.activeDrawer) {
					// Don't close if clicking on the action button or its children
					if (!e.target.closest('.section-header-action')) {
						this.closeAllDrawers();
					}
				}
			});
		});

		// Prevent action buttons from triggering header click
		document.querySelectorAll('.section-header-action').forEach(btn => {
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
			});
		});
	}

	setupImageEvents() {
		window.addEventListener('imageLoaded', () => {
			if (this.isMobile) {
				// Enable preview tab
				const previewBtn = document.querySelector('.mobile-tab-btn[data-tab="preview"]');
				if (previewBtn) {
					previewBtn.disabled = false;
				}

				// Switch to preview and recalculate viewport
				this.switchTab('preview');

				// Wait for tab switch to complete, then fix viewport
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						this.editor.resetViewport();
						this.editor.updateZoomUI();
					});
				});
			}
		});

		window.addEventListener('imageRemoved', () => {
			if (this.isMobile) {
				// Disable preview tab
				const previewBtn = document.querySelector('.mobile-tab-btn[data-tab="preview"]');
				if (previewBtn) {
					previewBtn.disabled = true;
				}

				this.switchTab('image');
				this.closeAllDrawers();
			}
		});

		window.addEventListener('layerChanged', () => {
			if (this.isMobile) {
				this.updateMobileSwatch();
			}
		});


	}

	setupResizeObserver() {
		let resizeTimer;

		this.resizeObserver = new ResizeObserver(entries => {
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				const newWidth = window.innerWidth;
				const nowMobile = newWidth <= 800;

				console.log('Mobile: Resize detected, width:', newWidth, 'Mobile:', nowMobile);

				if (!this.isMobile && nowMobile) {
					console.log('Mobile: Switching to mobile mode');
					this.isMobile = true;
					this.init();
				} else if (this.isMobile && !nowMobile) {
					console.log('Mobile: Switching to desktop mode');
					this.isMobile = false;
					this.cleanup();
				}
			}, 250);
		});

		this.resizeObserver.observe(document.body);
	}

	switchTab(tab) {
		console.log('Mobile: Switching to tab:', tab);
		this.activeTab = tab;

		// Update tab button states
		document.querySelectorAll('.mobile-tab-btn').forEach(btn => {
			btn.classList.toggle('active', btn.dataset.tab === tab);
		});

		// Close any open drawers
		this.closeAllDrawers();

		// Remove all tab classes
		document.body.classList.remove('mobile-image-tab', 'mobile-preview-tab');

		// Add the active tab class
		document.body.classList.add(`mobile-${tab}-tab`);

		console.log('Mobile: Tab switched to:', tab);
	}

	toggleDrawer(drawer) {
		console.log('Mobile: Toggling drawer:', drawer);

		// If clicking the currently open drawer, close it
		if (this.activeDrawer === drawer) {
			this.closeAllDrawers();
		} else {
			// Close any open drawer and open the new one
			this.closeAllDrawers();
			this.activeDrawer = drawer;
			document.body.classList.add(`${drawer}Open`);

			// Update button states
			document.querySelectorAll('.mobile-drawer-btn').forEach(btn => {
				btn.classList.toggle('active', btn.dataset.drawer === drawer);
			});
		}
	}

	closeAllDrawers() {
		this.activeDrawer = null;
		document.body.classList.remove('glitterOpen', 'layersOpen');
		document.querySelectorAll('.mobile-drawer-btn').forEach(btn => {
			btn.classList.remove('active');
		});
	}

	cleanup() {
		console.log('Mobile: Starting cleanup');

		// Remove mobile navigation
		const topNav = document.querySelector('.mobile-top-nav');
		const bottomNav = document.querySelector('.mobile-bottom-nav');
		const swatch = document.querySelector('.mobile-swatch');

		if (topNav) topNav.remove();
		if (bottomNav) bottomNav.remove();
		if (swatch) swatch.remove();

		// Remove all mobile classes
		document.body.classList.remove('mobile-image-tab', 'mobile-preview-tab', 'glitterOpen', 'layersOpen');

		console.log('Mobile: Cleanup complete, restored to desktop layout');
	}
}



const editor = new GlitterEditor();
const mobileManager = new MobileManager(editor);
editor.mobileManager = mobileManager;
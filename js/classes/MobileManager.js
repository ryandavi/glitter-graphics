// ============================================
// MOBILE MANAGER CLASS
// ============================================
class MobileManager {
	constructor(editor) {
		this.editor = editor;
		this.isMobile = window.innerWidth <= CONFIG.mobileBreakpoint;
		this.activeTab = 'image'; // image or preview
		this.activeDrawer = null; // design, layers, or null
		this.settingsOpen = false;
		this.resizeObserver = null;

		// Track original locations of settings sections
		this.settingsSections = {
			tool: null,
			glitter: null,
			sticker: null,
			text: null,
			shape: null,
			// Tool-scoped, not layer-scoped: the mask-brush settings live in the
			// design panel and are toggled by the active tool, so on mobile they
			// must be relocated into the settings drawer while brushing (see
			// syncBrushSettingsPlacement) rather than leaking into the Design drawer.
			brush: null
		};
		this.originalParents = new Map();

		// Initialize the flag
		this.eventsBound = false;

		if (this.isMobile) {
			this.init();
		}

		this.setupResizeObserver();
		this.setupImageEvents();
	}

	init() {
		dbg('Mobile: Initializing mobile manager');
		this.cacheSettingsSections();

		// Debug: Check if sections were cached
		dbg('Mobile: Cached sections:', {
			tool: !!this.settingsSections.tool,
			glitter: !!this.settingsSections.glitter,
			sticker: !!this.settingsSections.sticker,
			text: !!this.settingsSections.text
		});

		this.showMobileControls();
		this.setupEventListeners();

		// Switch to image tab FIRST (this calls closeSettings which moves sections back)
		this.switchTab('image');

		// THEN prepare settings AFTER switching tabs
		const activeLayer = this.editor.layerManager.getActiveLayer();
		dbg('Mobile: Active layer on init:', activeLayer);

		if (activeLayer && this.hasLayerSettings(activeLayer)) {
			// Prepare settings AFTER tab switch
			dbg('Mobile: Preparing settings for layer:', activeLayer.type);
			this.prepareSettings(activeLayer);
		}

		dbg('Mobile: Initialization complete, on image tab');
	}

	hasLayerSettings(layer) {
		if (!layer) return false;
		const config = LAYER_UI_CONFIG[layer.type];
		return config && config.mobileSettingsSections && config.mobileSettingsSections.length > 0;
	}

	cacheSettingsSections() {
		// Cache references to settings sections
		this.settingsSections.tool = document.querySelector('.layer-settings-section');
		this.settingsSections.glitter = document.querySelector('.glitter-settings-section');
		this.settingsSections.sticker = document.querySelector('.sticker-settings-section');
		this.settingsSections.text = document.querySelector('.text-settings-section');
		this.settingsSections.shape = document.querySelector('.shape-settings-section');
		this.settingsSections.brush = document.querySelector('.brush-settings-section');

		// Store original parents
		if (this.settingsSections.tool) {
			this.originalParents.set('tool', this.settingsSections.tool.parentElement);
		}
		if (this.settingsSections.glitter) {
			this.originalParents.set('glitter', this.settingsSections.glitter.parentElement);
		}
		if (this.settingsSections.sticker) {
			this.originalParents.set('sticker', this.settingsSections.sticker.parentElement);
		}
		if (this.settingsSections.text) {
			this.originalParents.set('text', this.settingsSections.text.parentElement);
		}
		if (this.settingsSections.shape) {
			this.originalParents.set('shape', this.settingsSections.shape.parentElement);
		}
		if (this.settingsSections.brush) {
			this.originalParents.set('brush', this.settingsSections.brush.parentElement);
		}
	}

	showMobileControls() {
		const topNav = document.querySelector('.mobile-top-nav');
		const bottomNav = document.querySelector('.mobile-bottom-nav');

		if (topNav) topNav.classList.add('visible');
		if (bottomNav) bottomNav.classList.add('visible');

		// Update initial state based on whether image exists
		const previewTab = document.querySelector('.mobile-tab-btn[data-tab="preview"]');
		if (previewTab) {
			previewTab.disabled = !this.editor.originalImage;
		}

		dbg('Mobile: Controls shown');
	}

	setupEventListeners() {
		// Stop if events are already set up
		if (this.eventsBound) return;

		// Tab buttons
		document.querySelectorAll('.mobile-tab-btn').forEach(btn => {
			btn.addEventListener('click', () => {
				this.switchTab(btn.dataset.tab);
			});
		});

		// Drawer buttons
		document.querySelectorAll('.mobile-drawer-btn').forEach(btn => {
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.toggleDrawer(btn.dataset.drawer);
			});
		});




		// Settings button
		const settingsBtn = document.getElementById('mobileSettingsBtn');
		if (settingsBtn) {
			settingsBtn.addEventListener('click', () => {
				if (!settingsBtn.disabled) {
					this.toggleSettings();
				}
			});
		}

		// Layer selection triggers settings preparation (not auto-open)
		window.addEventListener('layerChanged', () => {
			if (!this.isMobile) return; // Only handle this on mobile

			dbg('Mobile: Layer changed to', this.editor.layerManager.getActiveLayer());

			const activeLayer = this.editor.layerManager.getActiveLayer();
			const settingsBtn = document.getElementById('mobileSettingsBtn');

			if (activeLayer) {
				const hasSettings = this.hasLayerSettings(activeLayer);

				if (hasSettings) {
					// Prepare settings (moves to mobile container) but don't auto-open
					this.prepareSettings(activeLayer);
				} else {
					// No settings for this layer type
					document.body.classList.remove('has-layer-settings');
					if (settingsBtn) settingsBtn.disabled = true;
					this.closeSettings();
				}
			} else {
				// No layer selected
				document.body.classList.remove('has-layer-settings');
				if (settingsBtn) settingsBtn.disabled = true;
				this.closeSettings();
			}
		});

		// Close drawer when clicking on panel headers (Design, Layers)
		// But NOT collapsible section headers inside settings
		document.querySelectorAll('.section-header').forEach(header => {
			header.addEventListener('click', (e) => {
				if (!this.isMobile) return;

				// Don't interfere with action buttons (collapse chevrons, add layer button)
				if (e.target.closest('.section-header-action')) return;

				// Check which panel this header belongs to
				const inDesignPanel = header.closest('.design-panel');
				const inLeftPanel = header.closest('.left-panel');
				const inSettingsDrawer = header.closest('.mobile-settings-drawer');

				// If in settings drawer AND it's a collapsible section, let it handle its own toggle
				if (inSettingsDrawer && header.closest('.collapsible-section')) {
					// Don't close drawer - let the collapsible behavior work normally
					return;
				}

				// Same carve-out for the design panel (its own gallery header is a
				// collapsible-section header too) - let the accordion toggle itself
				// instead of the drawer swallowing the click as a close.
				if (inDesignPanel && header.closest('.collapsible-section')) {
					return;
				}

				// Close design drawer if clicking design panel header
				if (inDesignPanel && this.activeDrawer === 'design') {
					this.closeAllDrawers();
					return;
				}

				// Close layers drawer if clicking layers panel header
				if (inLeftPanel && this.activeDrawer === 'layers') {
					this.closeAllDrawers();
					return;
				}
			});
		});

		// Tap selected layer to reopen settings
		window.addEventListener('layerItemClick', (e) => {
			const layerId = e.detail.layerId;
			const currentActive = this.editor.layerManager.activeLayerId;

			// If tapping already selected layer, toggle settings
			if (this.isMobile && layerId === currentActive && this.activeTab === 'preview') {
				this.toggleSettings();
			}
		});


		// Mark events as bound
		this.eventsBound = true;
	}

	setupImageEvents() {
		window.addEventListener('imageLoaded', () => {
			if (this.isMobile) {
				this.editor.previewWrapper.style.opacity = '0';
				this.editor.previewWrapper.style.transition = 'none';

				const previewBtn = document.querySelector('.mobile-tab-btn[data-tab="preview"]');
				if (previewBtn) {
					previewBtn.disabled = false;
				}

				this.switchTab('preview');

				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						this.editor.viewport.performResizeUpdate();
						this.editor.viewport.resetZoomSmart();
						this.editor.updateZoomUI();
						this.editor.previewWrapper.style.transition = '';
						this.editor.previewWrapper.style.opacity = '1';
					});
				});
			}
		});
	}

	setupResizeObserver() {
		let resizeTimer;

		this.resizeObserver = new ResizeObserver(entries => {
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				const newWidth = window.innerWidth;
				const nowMobile = newWidth <= CONFIG.mobileBreakpoint;

if (!this.isMobile && nowMobile) {
    // Switching TO Mobile
    dbg('Mobile: Switching to mobile mode');
    if (this.editor.currentTool === ToolType.BRUSH) {
        this.editor.maskEditor?.releaseBrushTool({ commitStroke: false });
    }
    this.isMobile = true;
    this.init();

    // ✅ LayerTransform handles touch gestures automatically - no manual rebinding needed

    if (this.editor.originalImage) {
						this.switchTab('preview');

						// Re-prepare settings after switching to preview
						const activeLayer = this.editor.layerManager.getActiveLayer();
						const settingsBtn = document.getElementById('mobileSettingsBtn');

						if (activeLayer && this.hasLayerSettings(activeLayer)) {
							this.prepareSettings(activeLayer);
						} else {
							// Base image or no layer - disable button
							if (settingsBtn) settingsBtn.disabled = true;
							document.body.classList.remove('has-layer-settings');
						}

						requestAnimationFrame(() => {
							requestAnimationFrame(() => {
								this.editor.viewport.performResizeUpdate();
								this.editor.viewport.resetViewport();
								this.editor.updateZoomUI();
								this.editor.updateTransparencyGrid();
							});
						});
					}




} else if (this.isMobile && !nowMobile) {
    // Switching TO Desktop
    dbg('Mobile: Switching to desktop mode');
    if (this.editor.currentTool === ToolType.BRUSH) {
        this.editor.maskEditor?.releaseBrushTool({ commitStroke: false });
    }
    this.isMobile = false;
    this.cleanup();

    // ✅ LayerTransform handles touch gestures automatically - no manual rebinding needed

    setTimeout(() => {
						if (this.editor.originalImage) {
							this.editor.viewport.performResizeUpdate();
							this.editor.viewport.resetViewport();
							this.editor.updateZoomUI();
						}
					}, 50);
				}
			}, 250);
		});

		this.resizeObserver.observe(document.body);
	}

	switchTab(tab) {
		dbg('Mobile: Switching to tab:', tab);
		const isTabChange = this.activeTab !== tab;
		this.activeTab = tab;

		document.querySelectorAll('.mobile-tab-btn').forEach(btn => {
			btn.classList.toggle('active', btn.dataset.tab === tab);
		});

		this.closeAllDrawers();

		// Collapse settings sections when switching tabs
		this.collapseAllSections();

		this.closeSettings({ releaseBrush: isTabChange });

		document.body.classList.remove('mobile-image-tab', 'mobile-preview-tab');
		document.body.classList.add(`mobile-${tab}-tab`);
	}

	toggleDrawer(drawer) {
		dbg('Mobile: Toggling drawer:', drawer);

		if (this.activeDrawer === drawer) {
			// Closing current drawer
			this.closeAllDrawers();

			// Also collapse settings sections if settings drawer is visible
			if (document.body.classList.contains('has-layer-settings')) {
				this.collapseAllSections();

				// Also close the settings drawer to collapsed state
				//document.body.classList.remove('mobileSettingsOpen');
				//this.settingsOpen = false;
			}
		} else {
			// Opening different drawer (or opening for first time)

			// If switching drawers, do it without closeAllDrawers to prevent flash
			if (this.activeDrawer) {
				// Remove previous drawer class
				const prevCamelCase = this.activeDrawer.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
				const prevClassName = prevCamelCase + 'Open';
				document.body.classList.remove(prevClassName);
			}
			// Don't close settings when opening a drawer - they're independent

			// Add new drawer class immediately (no setTimeout to prevent flash)
			this.activeDrawer = drawer;
			const camelCase = drawer.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
			const className = camelCase + 'Open';
			document.body.classList.add(className);

			// Update button states
			document.querySelectorAll('.mobile-drawer-btn').forEach(btn => {
				btn.classList.toggle('active', btn.dataset.drawer === drawer);
			});
		}
	}

	prepareSettings(layer) {
		const mobileContainer = document.querySelector('.mobile-settings-content');
		if (!mobileContainer) {
			dbg('Mobile: No mobile settings container found');
			return;
		}

		// Conditionally close drawers based on config
		if (CONFIG.mobileAutoCloseDesignDrawer) {
			this.closeAllDrawers();
		}

		// Clear container
		mobileContainer.innerHTML = '';
		let hasSettings = false;

		dbg('Mobile: Moving sections to container...');

		// Get the UI config for this layer type
		const config = LAYER_UI_CONFIG[layer.type];
		if (!config || !config.mobileSettingsSections) {
			dbg('Mobile: No settings for this layer type');
			return;
		}

		// Move the appropriate sections based on config
		config.mobileSettingsSections.forEach(sectionKey => {
			const section = this.settingsSections[sectionKey];
			if (section) {
				dbg(`Mobile: Moving ${sectionKey} section`);
				mobileContainer.appendChild(section);
				section.classList.add('visible');
				hasSettings = true;
			} else {
				dbg(`Mobile: No ${sectionKey} section found`);
			}
		});

		dbg('Mobile: hasSettings:', hasSettings);
		dbg('Mobile: Container children:', mobileContainer.children.length);

		// Collapse all sections
		this.collapseAllSections();

		// Update button state but DON'T auto-open
		const settingsBtn = document.getElementById('mobileSettingsBtn');
		if (hasSettings) {
			document.body.classList.add('has-layer-settings');
			if (settingsBtn) settingsBtn.disabled = false;
		} else {
			document.body.classList.remove('has-layer-settings');
			if (settingsBtn) settingsBtn.disabled = true;
		}

		// innerHTML='' above detached the tool-scoped brush section if it was
		// here; re-append it (and re-enable the button) when brushing.
		this.syncBrushSettingsPlacement();
	}
	// Delegates to the same setCollapsibleSectionOpen used by the desktop
	// accordion (app.js initializeCollapsibleSections) so .is-open stays in
	// sync. Previously this toggled classes directly — including a
	// '.section-header.collapsible' selector that doesn't exist in the
	// current markup — which left stale .is-open state behind (that class
	// drives flex: 1 1 auto even outside the design panel) and desynced from
	// the desktop accordion state.
	collapseAllSections() {
		const sectionNameByKey = {
			tool: 'layerSettings',
			glitter: 'glitterSettings',
			sticker: 'stickerSettings',
			text: 'textSettings',
			shape: 'shapeSettings'
		};

		Object.entries(sectionNameByKey).forEach(([key, sectionName]) => {
			if (this.settingsSections[key]) {
				this.editor.setCollapsibleSectionOpen?.(sectionName, false);
			}
		});
	}




	toggleSettings() {
		const settingsBtn = document.getElementById('mobileSettingsBtn');

		if (this.settingsOpen) {
			this.closeSettings({ releaseBrush: true });
		} else {
			// closeSettings() moves the settings sections back out of the
			// mobile container (returnSettingsSections), so re-opening must
			// re-populate it from the active layer — otherwise the drawer
			// shows empty on every reopen after the first close.
			const activeLayer = this.editor.layerManager.getActiveLayer();
			if (activeLayer && this.hasLayerSettings(activeLayer)) {
				this.prepareSettings(activeLayer);
			} else {
				this.collapseAllSections();
				// No layer sections to show, but the brush tool may still need its
				// (tool-scoped) settings relocated into the drawer.
				this.syncBrushSettingsPlacement();
			}
			this.settingsOpen = true;
			document.body.classList.add('mobileSettingsOpen');
			if (settingsBtn) settingsBtn.classList.add('active');
		}
	}

	closeSettings(options = {}) {
		const { releaseBrush = false } = options;

		if (releaseBrush && this.editor.currentTool === ToolType.BRUSH) {
			this.editor.maskEditor?.releaseBrushTool({ commitStroke: false });
		}

		this.settingsOpen = false;
		document.body.classList.remove('mobileSettingsOpen');
		const settingsBtn = document.getElementById('mobileSettingsBtn');
		if (settingsBtn) settingsBtn.classList.remove('active');

		// Collapse all sections
		this.collapseAllSections();

		// Return settings sections to their original parents
		this.returnSettingsSections();
	}

	returnSettingsSections() {
		const mobileContainer = document.getElementById('mobileSettingsContainer');
		if (!mobileContainer) return;

		// Return tool settings
		if (this.settingsSections.tool && this.originalParents.has('tool')) {
			const originalParent = this.originalParents.get('tool');
			if (originalParent && !originalParent.contains(this.settingsSections.tool)) {
				originalParent.appendChild(this.settingsSections.tool);
			}
			// Don't remove visible - desktop needs it
		}

		// Return glitter settings
		if (this.settingsSections.glitter && this.originalParents.has('glitter')) {
			const originalParent = this.originalParents.get('glitter');
			if (originalParent && !originalParent.contains(this.settingsSections.glitter)) {
				originalParent.appendChild(this.settingsSections.glitter);
			}
			// Don't remove visible - desktop needs it
		}

		// Return sticker settings
		if (this.settingsSections.sticker && this.originalParents.has('sticker')) {
			const originalParent = this.originalParents.get('sticker');
			if (originalParent && !originalParent.contains(this.settingsSections.sticker)) {
				originalParent.appendChild(this.settingsSections.sticker);
			}
			// Don't remove visible - desktop needs it
		}

		if (this.settingsSections.text && this.originalParents.has('text')) {
			const originalParent = this.originalParents.get('text');
			if (originalParent && !originalParent.contains(this.settingsSections.text)) {
				originalParent.appendChild(this.settingsSections.text);
			}
		}

		if (this.settingsSections.shape && this.originalParents.has('shape')) {
			const originalParent = this.originalParents.get('shape');
			if (originalParent && !originalParent.contains(this.settingsSections.shape)) {
				originalParent.appendChild(this.settingsSections.shape);
			}
		}

		// Return the brush section to the design panel too, so clearing the
		// container below doesn't orphan it while the brush tool is still active.
		this.returnBrushSection();

		// Clear container
		mobileContainer.innerHTML = '';
	}

	returnBrushSection() {
		const section = this.settingsSections.brush;
		if (!section || !this.originalParents.has('brush')) return;
		const originalParent = this.originalParents.get('brush');
		if (originalParent && !originalParent.contains(section)) {
			originalParent.appendChild(section);
		}
	}

	// The brush settings section is tool-scoped (shown whenever the mask brush is
	// active, independent of layer type), so it normally lives in the design
	// panel and is toggled visible by app.updateContextToolbars. On mobile the
	// design panel IS the "Design" drawer, so a visible brush section would leak
	// into that drawer. While the brush tool is active, relocate it into the
	// settings drawer (reached via the settings button) and keep that button
	// enabled; otherwise return it to the design panel and restore the button
	// state from the active layer. Called at the end of updateContextToolbars so
	// it re-runs on every tool change and layer/toolbar update.
	syncBrushSettingsPlacement() {
		if (!this.isMobile) return;
		const section = this.settingsSections.brush;
		if (!section) return;

		const brushActive = this.editor.currentTool === ToolType.BRUSH;
		const settingsBtn = document.getElementById('mobileSettingsBtn');
		const mobileContainer = document.getElementById('mobileSettingsContainer');

		if (brushActive && mobileContainer) {
			if (!mobileContainer.contains(section)) {
				mobileContainer.appendChild(section);
			}
			section.classList.add('visible');
			document.body.classList.add('has-layer-settings');
			if (settingsBtn) settingsBtn.disabled = false;
		} else {
			this.returnBrushSection();
			// Restore the settings button from the active layer's own settings.
			const activeLayer = this.editor.layerManager.getActiveLayer();
			const hasSettings = !!(activeLayer && this.hasLayerSettings(activeLayer));
			// Only disable if the settings drawer isn't holding other sections.
			if (!this.settingsOpen) {
				document.body.classList.toggle('has-layer-settings', hasSettings);
				if (settingsBtn) settingsBtn.disabled = !hasSettings;
			}
		}
	}

	closeAllDrawers() {
		this.activeDrawer = null;
		document.body.classList.remove('designOpen', 'layersOpen');
		document.querySelectorAll('.mobile-drawer-btn').forEach(btn => {
			btn.classList.remove('active');
		});


	}

	cleanup() {
		dbg('Mobile: Starting cleanup');

		const topNav = document.querySelector('.mobile-top-nav');
		const bottomNav = document.querySelector('.mobile-bottom-nav');

		if (topNav) topNav.classList.remove('visible');
		if (bottomNav) bottomNav.classList.remove('visible');

		// Return settings sections before cleanup
		this.returnSettingsSections();

		document.body.classList.remove(
			'mobile-image-tab',
			'mobile-preview-tab',
			'designOpen',
			'layersOpen',
			'mobileSettingsOpen',
			'has-layer-settings'
		);

		this.closeSettings();

		// Restore desktop layer display state
		const activeLayer = this.editor.layerManager.getActiveLayer();
		if (activeLayer) {
			const config = LAYER_UI_CONFIG[activeLayer.type];
			if (config && config.onActivate) {
				config.onActivate(this.editor, activeLayer);
			}
		} else {
			this.editor.showLayerSettingsEmptyState();
			this.editor.showGlitterSettingsEmptyState();
			this.editor.showStickerSettingsEmptyState();
		}

		dbg('Mobile: Cleanup complete, restored to desktop layout');
	}
}

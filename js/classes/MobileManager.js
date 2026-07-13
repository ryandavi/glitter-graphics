// ============================================
// MOBILE MANAGER CLASS
// ============================================
const MOBILE_SETTINGS_SECTION_CONFIG = {
	tool: {
		selector: '.layer-settings-section',
		collapsibleName: 'layerSettings'
	},
	glitter: {
		selector: '.glitter-settings-section',
		collapsibleName: 'glitterSettings'
	},
	sticker: {
		selector: '.sticker-settings-section',
		collapsibleName: 'stickerSettings'
	},
	text: {
		selector: '.text-settings-section',
		collapsibleName: 'textSettings'
	},
	shape: {
		selector: '.shape-settings-section',
		collapsibleName: 'shapeSettings'
	},
	background: {
		selector: '.base-layer-settings-section',
		collapsibleName: 'baseLayerSettings'
	},
	brush: {
		selector: '.brush-settings-section'
	}
};
const MOBILE_SETTINGS_SECTION_KEYS = Object.keys(MOBILE_SETTINGS_SECTION_CONFIG);

class MobileManager {
	constructor(editor) {
		this.editor = editor;
		this.isMobile = window.innerWidth <= CONFIG.ui.mobile.breakpoint;
		this.activeTab = 'image'; // image or preview
		this.activeDrawer = null; // design, layers, or null
		this.settingsOpen = false;
		this.resizeObserver = null;

		// Track original locations of settings sections
		this.settingsSections = Object.fromEntries(MOBILE_SETTINGS_SECTION_KEYS.map((key) => [key, null]));
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
		dbg('Mobile: Cached sections:', Object.fromEntries(
			MOBILE_SETTINGS_SECTION_KEYS.map((key) => [key, !!this.settingsSections[key]])
		));

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
		MOBILE_SETTINGS_SECTION_KEYS.forEach((key) => {
			const section = document.querySelector(MOBILE_SETTINGS_SECTION_CONFIG[key].selector);
			this.settingsSections[key] = section;
			if (section) {
				this.originalParents.set(key, section.parentElement);
			}
		});
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

				// Action buttons keep their own behavior (add layer, add custom
				// sticker, settings-section chevrons) — except the design gallery's
				// collapse chevron, which on mobile means "close the drawer" like
				// the rest of its header.
				if (e.target.closest('.section-header-action') && !e.target.closest('#designGalleryToggle')) return;

				// Check which panel this header belongs to
				const inDesignPanel = header.closest('.design-panel');
				const inLayersPanel = header.closest('.layers-panel');
				const inSettingsDrawer = header.closest('.mobile-settings-drawer');

				// If in settings drawer AND it's a collapsible section, let it handle its own toggle
				if (inSettingsDrawer && header.closest('.collapsible-section')) {
					// Don't close drawer - let the collapsible behavior work normally
					return;
				}

				// The design drawer's gallery header closes the drawer. Accordion-
				// collapsing the gallery is desktop-only: inside the drawer it
				// strands a bare header bar that reopens collapsed (the app.js
				// accordion handler skips designGallery on mobile for the same
				// reason).
				if (inDesignPanel && this.activeDrawer === 'design') {
					this.closeAllDrawers();
					return;
				}

				// Close layers drawer if clicking layers panel header
				if (inLayersPanel && this.activeDrawer === 'layers') {
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
				const nowMobile = newWidth <= CONFIG.ui.mobile.breakpoint;

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

	// Idempotent "open" intent — every non-nav-button call site wants the drawer
	// open, never toggled closed (a toggle here silently closes an already-open
	// drawer, which is how the LayerManager goto/auto-open paths drifted).
	openDrawer(drawer) {
		if (this.activeDrawer !== drawer) {
			this.toggleDrawer(drawer);
		}
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

			// The design drawer must never open with its gallery collapsed —
			// is-open can persist from the desktop accordion (breakpoint resize)
			// and would strand the drawer as a bare header bar.
			if (drawer === 'design') {
				this.editor.setCollapsibleSectionOpen?.('designGallery', true);
			}

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
		if (CONFIG.ui.mobile.autoCloseDesignDrawer) {
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
		MOBILE_SETTINGS_SECTION_KEYS.forEach((key) => {
			const sectionName = MOBILE_SETTINGS_SECTION_CONFIG[key].collapsibleName;
			if (sectionName && this.settingsSections[key]) {
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

		MOBILE_SETTINGS_SECTION_KEYS
			.filter((key) => key !== 'brush')
			.forEach((key) => this.returnSettingsSection(key));

		// Return the brush section to the design panel too, so clearing the
		// container below doesn't orphan it while the brush tool is still active.
		this.returnBrushSection();

		// Clear container
		mobileContainer.innerHTML = '';
	}

	returnSettingsSection(key) {
		const section = this.settingsSections[key];
		if (!section || !this.originalParents.has(key)) return;
		const originalParent = this.originalParents.get(key);
		if (originalParent && !originalParent.contains(section)) {
			originalParent.appendChild(section);
		}
	}

	returnBrushSection() {
		this.returnSettingsSection('brush');
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

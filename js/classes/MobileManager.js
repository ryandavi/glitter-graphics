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
			sticker: null
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
		console.log('Mobile: Initializing mobile manager');
		this.cacheSettingsSections();
		this.showMobileControls();
		this.setupEventListeners();
		this.switchTab('image');
		console.log('Mobile: Initialization complete, on image tab');
	}

	cacheSettingsSections() {
		// Cache references to settings sections
		this.settingsSections.tool = document.querySelector('.layer-settings-section');
		this.settingsSections.glitter = document.querySelector('.glitter-settings-section');
		this.settingsSections.sticker = document.querySelector('.sticker-settings-section');

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

		console.log('Mobile: Controls shown');
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


		// Settings drawer handle
		const settingsHandle = document.querySelector('.mobile-settings-handle');
		if (settingsHandle) {
			settingsHandle.addEventListener('click', () => {
				this.toggleSettings();
			});
		}

		// Layer selection triggers settings
		window.addEventListener('layerChanged', () => {
			const activeLayer = this.editor.layerManager.getActiveLayer();

			// Don't open settings if a modal is currently open
			const isModalOpen = document.querySelector('.modal-overlay.visible');

			if (activeLayer && this.isMobile && this.activeTab === 'preview' && !isModalOpen) {
				// openSettings() will add has-layer-settings if layer has settings
				this.openSettings(activeLayer);
			} else if (!activeLayer) {
				// No layer selected, close settings and remove has-layer-settings
				document.body.classList.remove('has-layer-settings');
				this.closeSettings();
			} else {
				// Layer selected but we're not opening settings (modal open, wrong tab, etc)
				// Still check if we should show/hide the handle based on layer type
				const hasSettings = activeLayer.type === LayerType.GLITTER_FILL || activeLayer.type === LayerType.STICKER;
				if (hasSettings) {
					document.body.classList.add('has-layer-settings');
				} else {
					document.body.classList.remove('has-layer-settings');
				}
			}
		});

		// Settings collapsible headers - make them close the drawer
		document.querySelectorAll('.mobile-settings-drawer .section-header').forEach(header => {
			header.addEventListener('click', (e) => {
				// Don't close if clicking the collapse button
				if (e.target.closest('.section-header-action')) return;

				// Close settings drawer
				this.closeSettings();
			});
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
				if (inSettingsDrawer && header.classList.contains('collapsible')) {
					// Don't close drawer - let the collapsible behavior work normally
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
					console.log('Mobile: Switching to mobile mode');
					this.isMobile = true;
					this.init();

					// Update sticker touch gestures
					if (this.editor.stickerManager) {
						this.editor.layerManager.layers.forEach(layer => {
							if (layer.type === LayerType.STICKER) {
								const element = this.editor.stickerManager.layerElements.get(layer.id);
								if (element) {
									this.editor.stickerManager.setupStickerTouchGestures(element, layer.id);
								}
							}
						});
					}

					if (this.editor.originalImage) {
						this.switchTab('preview');
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
					console.log('Mobile: Switching to desktop mode');
					this.isMobile = false;
					this.cleanup();

					// Update sticker touch gestures
					if (this.editor.stickerManager) {
						this.editor.layerManager.layers.forEach(layer => {
							if (layer.type === LayerType.STICKER) {
								const element = this.editor.stickerManager.layerElements.get(layer.id);
								if (element) {
									this.editor.stickerManager.setupStickerTouchGestures(element, layer.id);
								}
							}
						});
					}

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
		console.log('Mobile: Switching to tab:', tab);
		this.activeTab = tab;

		document.querySelectorAll('.mobile-tab-btn').forEach(btn => {
			btn.classList.toggle('active', btn.dataset.tab === tab);
		});

		this.closeAllDrawers();

		// Collapse settings sections when switching tabs
		this.collapseAllSections();

		this.closeSettings();

		document.body.classList.remove('mobile-image-tab', 'mobile-preview-tab');
		document.body.classList.add(`mobile-${tab}-tab`);
	}

	toggleDrawer(drawer) {
		console.log('Mobile: Toggling drawer:', drawer);

		if (this.activeDrawer === drawer) {
			// Closing current drawer
			this.closeAllDrawers();

			// Also collapse settings sections if settings drawer is visible
			if (document.body.classList.contains('has-layer-settings')) {
				this.collapseAllSections();

				// Also close the settings drawer to collapsed state
				document.body.classList.remove('mobileSettingsOpen');
				this.settingsOpen = false;
			}
		} else {
			// Opening different drawer (or opening for first time)

			// If switching drawers, do it without closeAllDrawers to prevent flash
			if (this.activeDrawer) {
				// Remove previous drawer class
				const prevCamelCase = this.activeDrawer.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
				const prevClassName = prevCamelCase + 'Open';
				document.body.classList.remove(prevClassName);
			} else {
				// No active drawer, close settings
				this.closeSettings();
			}

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

	openSettings(layer) {
		if (!this.isMobile || !layer) return;

		const mobileContainer = document.getElementById('mobileSettingsContainer');
		if (!mobileContainer) return;

		// Close any open drawers first
		this.closeAllDrawers();

		// Clear container
		mobileContainer.innerHTML = '';

		let hasSettings = false;

		// Move appropriate settings based on layer type
		if (layer.type === LayerType.GLITTER_FILL) {
			if (this.settingsSections.tool) {
				mobileContainer.appendChild(this.settingsSections.tool);
				this.settingsSections.tool.classList.add('visible');
				hasSettings = true;
			}
			if (this.settingsSections.glitter) {
				mobileContainer.appendChild(this.settingsSections.glitter);
				this.settingsSections.glitter.classList.add('visible');
				hasSettings = true;
			}
		} else if (layer.type === LayerType.STICKER) {
			if (this.settingsSections.sticker) {
				mobileContainer.appendChild(this.settingsSections.sticker);
				this.settingsSections.sticker.classList.add('visible');
				hasSettings = true;
			}
		}

		// Collapse all sections before opening
		this.collapseAllSections();

		// Only open settings if we actually found settings to show
		if (hasSettings) {
			this.settingsOpen = true;
			document.body.classList.add('mobileSettingsOpen');
			document.body.classList.add('has-layer-settings');
		} else {
			// Layer has no settings, close drawer
			this.closeSettings();
		}
	}

	collapseAllSections() {
		const panel = document.querySelector('.mobile-settings-content');
		if (!panel) return;

		panel.querySelectorAll('.collapsible-section').forEach(section => {
			section.querySelector('.section-header-action')?.classList.add('collapsed');
			section.querySelector('.section-content')?.classList.remove('visible');
		});

		// Also collapse if sections are in their original locations
		if (this.settingsSections.tool) {
			const toolHeader = this.settingsSections.tool.querySelector('.section-header.collapsible');
			if (toolHeader) toolHeader.classList.add('collapsed');
		}
		if (this.settingsSections.glitter) {
			const glitterHeader = this.settingsSections.glitter.querySelector('.section-header.collapsible');
			if (glitterHeader) glitterHeader.classList.add('collapsed');
		}
		if (this.settingsSections.sticker) {
			const stickerHeader = this.settingsSections.sticker.querySelector('.section-header.collapsible');
			if (stickerHeader) stickerHeader.classList.add('collapsed');
		}
	}




	toggleSettings() {
		if (this.settingsOpen) {
			// Closing drawer - collapse all sections
			this.collapseAllSections();
			this.settingsOpen = false;
			document.body.classList.remove('mobileSettingsOpen');
		} else {
			// Opening drawer - ensure all sections are collapsed
			this.collapseAllSections();
			this.settingsOpen = true;
			document.body.classList.add('mobileSettingsOpen');
		}
	}

	closeSettings() {
		this.settingsOpen = false;
		document.body.classList.remove('mobileSettingsOpen');
		// Don't remove has-layer-settings - it should persist if layer still has settings

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
			this.settingsSections.tool.classList.remove('visible');
		}

		// Return glitter settings
		if (this.settingsSections.glitter && this.originalParents.has('glitter')) {
			const originalParent = this.originalParents.get('glitter');
			if (originalParent && !originalParent.contains(this.settingsSections.glitter)) {
				originalParent.appendChild(this.settingsSections.glitter);
			}
			this.settingsSections.glitter.classList.remove('visible');
		}

		// Return sticker settings
		if (this.settingsSections.sticker && this.originalParents.has('sticker')) {
			const originalParent = this.originalParents.get('sticker');
			if (originalParent && !originalParent.contains(this.settingsSections.sticker)) {
				originalParent.appendChild(this.settingsSections.sticker);
			}
			this.settingsSections.sticker.classList.remove('visible');
		}

		// Clear container
		mobileContainer.innerHTML = '';
	}

	closeAllDrawers() {
		this.activeDrawer = null;
		document.body.classList.remove('designOpen', 'layersOpen');
		document.querySelectorAll('.mobile-drawer-btn').forEach(btn => {
			btn.classList.remove('active');
		});


	}

	cleanup() {
		console.log('Mobile: Starting cleanup');

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
			'mobileSettingsOpen'
		);

		this.closeSettings();

		console.log('Mobile: Cleanup complete, restored to desktop layout');
	}
}
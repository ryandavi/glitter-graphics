// ============================================
// MOBILE MANAGER CLASS
// ============================================
class MobileManager {
	constructor(editor) {
		this.editor = editor;
		this.isMobile = window.innerWidth <= 800;
		this.activeTab = 'image'; // image or preview
		this.activeDrawer = null; // glitter or layers or null
		this.resizeObserver = null;

		// 1. Initialize the flag
		this.eventsBound = false;

		if (this.isMobile) {
			this.init();
		}

		this.setupResizeObserver();
		this.setupImageEvents();
	}

	init() {
		console.log('Mobile: Initializing mobile manager');
		this.showMobileControls();
		this.setupEventListeners();
		this.switchTab('image');
		console.log('Mobile: Initialization complete, on image tab');
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

		this.updateLayerSettingsButtonState();
		this.updateGlitterSettingsButtonState();

		console.log('Mobile: Controls shown');
	}

	setupEventListeners() {
		// 2. Stop if events are already set up
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
				// Prevent immediate propagation to avoid conflicts
				e.stopPropagation();
				this.toggleDrawer(btn.dataset.drawer);
			});
		});


		window.addEventListener('layerChanged', () => {
			this.updateLayerSettingsButtonState();
			this.updateGlitterSettingsButtonState();
		});

		this.updateLayerSettingsButtonState();
		this.updateGlitterSettingsButtonState();

		// Add layer button
		const mobileAddLayerBtn = document.getElementById('mobileAddLayerBtn');
		if (mobileAddLayerBtn) {
			mobileAddLayerBtn.addEventListener('click', () => {
				this.editor.layerManager.addLayer();
			});
		}

		// Close drawer when clicking on section headers
		document.querySelectorAll('.section-header').forEach(header => {
			header.addEventListener('click', (e) => {
				if (!this.isMobile || !this.activeDrawer) return;

				if (e.target.closest('.section-header-action')) return;

				if (header.id === 'layerSettingsHeader' || header.id === 'glitterSettingsHeader') {
					e.preventDefault();
					e.stopPropagation();
					e.stopImmediatePropagation();
					this.closeAllDrawers();
					return;
				}

				if (!header.closest('.collapsible-section')) {
					this.closeAllDrawers();
				}
			}, { capture: true });
		});

		// Prevent action buttons from triggering header click
		document.querySelectorAll('.section-header-action').forEach(btn => {
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
			});
		});

		// 3. Mark events as bound
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
				const nowMobile = newWidth <= 800;

				if (!this.isMobile && nowMobile) {
					// Switching TO Mobile
					console.log('Mobile: Switching to mobile mode');
					this.isMobile = true;
					this.init();

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

		document.body.classList.remove('mobile-image-tab', 'mobile-preview-tab');
		document.body.classList.add(`mobile-${tab}-tab`);
	}

	toggleDrawer(drawer) {
		console.log('Mobile: Toggling drawer:', drawer);

		if (this.activeDrawer === drawer) {
			// Closing
			this.closeAllDrawers();
		} else {
			// Opening
			this.closeAllDrawers();

			// Logic simplified: we rely on single-event binding now.
			setTimeout(() => {
				this.activeDrawer = drawer;

				const camelCase = drawer.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
				const className = camelCase + 'Open';
				document.body.classList.add(className);

				document.querySelectorAll('.mobile-drawer-btn').forEach(btn => {
					btn.classList.toggle('active', btn.dataset.drawer === drawer);
				});
			}, 0);
		}
	}

	updateLayerSettingsButtonState() {
		if (!this.isMobile) return;
		const btn = document.getElementById('mobileLayerSettingsBtn');
		if (!btn) return;
		const hasActiveLayer = this.editor.layerManager.getActiveLayer() !== null;
		btn.disabled = !hasActiveLayer;
	}

	updateGlitterSettingsButtonState() {
		if (!this.isMobile) return;
		const btn = document.getElementById('mobileGlitterSettingsBtn');
		if (!btn) return;
		const hasActiveLayer = this.editor.layerManager.getActiveLayer() !== null;
		btn.disabled = !hasActiveLayer;
	}

	openSettingsDrawer() {
		const activeLayer = this.editor.layerManager.getActiveLayer();

		if (activeLayer) {
			document.body.classList.add('settingsOpen');
			document.body.classList.remove('show-glitter-settings');
		} else if (this.editor.layerManager.layers.length > 0) {
			document.body.classList.add('settingsOpen', 'show-glitter-settings');
		} else {
			document.body.classList.add('settingsOpen');
			document.body.classList.remove('show-glitter-settings');
		}
	}

	closeAllDrawers() {
		this.activeDrawer = null;
		document.body.classList.remove(
			'glitterOpen',
			'layersOpen',
			'layerSettingsOpen',
			'glitterSettingsOpen'
		);
		document.querySelectorAll('.mobile-drawer-btn').forEach(btn => {
			btn.classList.remove('active');
		});
	}

	cleanup() {
		// Note: Cleanup does NOT remove event listeners because
		// removing anonymous functions is difficult. 
		// We rely on 'eventsBound' to prevent duplication upon re-init.

		console.log('Mobile: Starting cleanup');

		const topNav = document.querySelector('.mobile-top-nav');
		const bottomNav = document.querySelector('.mobile-bottom-nav');

		if (topNav) topNav.classList.remove('visible');
		if (bottomNav) bottomNav.classList.remove('visible');

		document.body.classList.remove(
			'mobile-image-tab',
			'mobile-preview-tab',
			'glitterOpen',
			'layersOpen',
			'layerSettingsOpen',
			'glitterSettingsOpen'
		);

		console.log('Mobile: Cleanup complete, restored to desktop layout');
	}
}
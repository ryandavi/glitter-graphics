// ============================================
// MOBILE MANAGER CLASS
// ============================================
class MobileManager {
	constructor(editor) {
		this.editor = editor;
		this.isMobile = window.innerWidth <= CONFIG.ui.mobile.breakpoint;
		this.activeDrawer = null;
		this.settingsRegistry = {};
		this.settingsSections = {};
		this.originalParents = new Map();
		this.resizeObserver = null;
		this.eventsBound = false;
		this.sheetDrag = null;
		this.sheetHeight = 50;
		this.drawerViewportState = null;
		this.drawerViewportUserState = null;
		this.drawerViewportUserZoomed = false;
		this.drawerViewportLastZoom = null;
		this.drawerViewportSyncing = false;
		this.drawerLayoutFrame = null;
		this.drawerCloseTimer = null;
		this.drawerCloseElement = null;
		this.drawerCloseListener = null;

		if (this.isMobile) this.init();
		this.setupResizeObserver();
		this.setupImageEvents();
	}

	buildSettingsRegistry() {
		const registry = {};
		const register = (schema) => {
			if (!schema?.mobileKey || !schema.section?.id) return;
			const element = document.getElementById(schema.section.id);
			registry[schema.mobileKey] = {
				element,
				collapsibleName: schema.sectionPrefix || null
			};
		};
		Object.values(PANEL_SCHEMAS).forEach((schema) => {
			register(schema);
			(schema.auxiliarySections || []).forEach(register);
		});
		this.settingsRegistry = registry;
		this.settingsSections = Object.fromEntries(
			Object.entries(registry).map(([key, value]) => [key, value.element])
		);
	}

	init() {
		dbg('Mobile: Initializing mobile manager');
		this.buildSettingsRegistry();
		this.cacheSettingsSections();
		dbg('Mobile: Schema settings registry:', Object.keys(this.settingsRegistry));
		this.showMobileControls();
		this.setupEventListeners();
		this.setupSheetDrag();
		this.syncImageState();

		const activeLayer = this.editor.layerManager.getActiveLayer();
		if (activeLayer && this.hasLayerSettings(activeLayer)) this.prepareSettings(activeLayer);
	}

	hasLayerSettings(layer) {
		const sections = layer && LAYER_UI_CONFIG[layer.type]?.mobileSettingsSections;
		return Boolean(sections?.some((key) => this.settingsRegistry[key]?.element));
	}

	cacheSettingsSections() {
		Object.entries(this.settingsRegistry).forEach(([key, entry]) => {
			if (entry.element && !this.originalParents.has(key)) {
				this.originalParents.set(key, entry.element.parentElement);
			}
		});
	}

	showMobileControls() {
		document.querySelector('.mobile-bottom-nav')?.classList.add('visible');
	}

	setupEventListeners() {
		if (this.eventsBound) return;

		document.querySelectorAll('.mobile-drawer-btn[data-drawer]').forEach((button) => {
			button.addEventListener('click', (event) => {
				event.stopPropagation();
				if (!button.disabled) this.toggleDrawer(button.dataset.drawer);
			});
		});

		window.addEventListener('layerChanged', () => {
			if (!this.isMobile) return;
			const layer = this.editor.layerManager.getActiveLayer();
			if (layer && this.hasLayerSettings(layer)) {
				this.prepareSettings(layer);
			} else {
				this.returnSettingsSections();
				this.syncEditAvailability();
				if (this.activeDrawer === 'edit') this.closeAllDrawers();
			}
		});

		window.addEventListener('layerItemClick', (event) => {
			if (!this.isMobile || event.detail.layerId !== this.editor.layerManager.activeLayerId) return;
			this.openDrawer('edit');
		});

		document.querySelectorAll('.section-header').forEach((header) => {
			header.addEventListener('click', (event) => {
				if (!this.isMobile || header.closest('.mobile-settings-drawer .collapsible-section')) return;
				if (event.target.closest('.section-header-action') && !event.target.closest('#designGalleryToggle')) return;
				if (header.closest('.design-panel') && this.activeDrawer === 'design') this.closeAllDrawers();
				if (header.closest('.layers-panel') && this.activeDrawer === 'layers') this.closeAllDrawers();
			});
		});
		const editHeader = document.getElementById('mobileEditHeader');
		const closeEdit = () => {
			if (this.isMobile && this.activeDrawer === 'edit') this.closeAllDrawers();
		};
		editHeader?.addEventListener('click', closeEdit);
		editHeader?.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			closeEdit();
		});

		window.addEventListener('viewportChanged', () => {
			if (!this.isMobile || !this.activeDrawer || this.drawerViewportSyncing) return;
			const state = this.editor.viewport?.captureViewState?.();
			if (!state) return;
			if (this.drawerViewportLastZoom !== null && Math.abs(state.zoom - this.drawerViewportLastZoom) > 0.0001) {
				this.drawerViewportUserZoomed = true;
			}
			this.drawerViewportUserState = state;
			this.drawerViewportLastZoom = state.zoom;
		});

		this.editor.previewContainer?.addEventListener('pointerdown', () => this.finishViewportAnimation(), { capture: true });

		this.eventsBound = true;
	}

	setupImageEvents() {
		window.addEventListener('imageLoaded', () => {
			if (!this.isMobile) return;
			this.syncImageState();
			this.editor.previewWrapper.style.opacity = '0';
			this.editor.previewWrapper.style.transition = 'none';
			requestAnimationFrame(() => requestAnimationFrame(() => {
				this.editor.viewport.performResizeUpdate();
				this.editor.viewport.resetZoomSmart();
				this.editor.updateZoomUI();
				this.editor.previewWrapper.style.transition = '';
				this.editor.previewWrapper.style.opacity = '1';
			}));
		});
		window.addEventListener('imageRemoved', () => {
			if (!this.isMobile) return;
			this.syncImageState();
		});
	}

	syncImageState() {
		const noImage = !this.editor.originalImage;
		const wasNoImage = document.body.classList.contains('mobile-no-image');
		if (wasNoImage && !noImage) {
			document.body.classList.add('mobile-document-opening');
			this.closeAllDrawers({ resize: false });
		}
		document.body.classList.toggle('mobile-no-image', noImage);
		if (noImage) this.closeAllDrawers();
		if (wasNoImage && !noImage) {
			requestAnimationFrame(() => requestAnimationFrame(() => {
				document.body.classList.remove('mobile-document-opening');
			}));
		}
	}

	setupResizeObserver() {
		let resizeTimer;
		this.resizeObserver = new ResizeObserver(() => {
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				const nowMobile = window.innerWidth <= CONFIG.ui.mobile.breakpoint;
				if (!this.isMobile && nowMobile) {
					if (this.editor.currentTool === ToolType.BRUSH) this.editor.maskEditor?.releaseBrushTool({ commitStroke: false });
					this.isMobile = true;
					this.init();
					requestAnimationFrame(() => requestAnimationFrame(() => {
						this.editor.viewport.performResizeUpdate();
						this.editor.viewport.resetViewport();
						this.editor.updateZoomUI();
						this.editor.updateTransparencyGrid();
					}));
				} else if (this.isMobile && !nowMobile) {
					if (this.editor.currentTool === ToolType.BRUSH) this.editor.maskEditor?.releaseBrushTool({ commitStroke: false });
					this.isMobile = false;
					this.cleanup();
					setTimeout(() => {
						if (!this.editor.originalImage) return;
						this.editor.viewport.performResizeUpdate();
						this.editor.viewport.resetViewport();
						this.editor.updateZoomUI();
					}, 50);
				}
			}, 250);
		});
		this.resizeObserver.observe(document.body);
	}

	normalizeDrawer(drawer) {
		if (drawer === 'add') return 'design';
		if (drawer === 'settings') return 'edit';
		return drawer;
	}

	get settingsOpen() {
		return this.activeDrawer === 'edit';
	}

	openDrawer(drawer) {
		drawer = this.normalizeDrawer(drawer);
		if (this.activeDrawer !== drawer) this.toggleDrawer(drawer);
	}

	toggleDrawer(drawer) {
		drawer = this.normalizeDrawer(drawer);
		this.cancelDrawerCloseFinalization();
		if (drawer === 'edit' && !this.canOpenEditDrawer()) return;
		if (this.activeDrawer === drawer) {
			this.closeAllDrawers({ releaseBrush: drawer === 'edit' });
			return;
		}

		if (drawer === 'edit') {
			const layer = this.editor.layerManager.getActiveLayer();
			if (layer && this.hasLayerSettings(layer)) this.prepareSettings(layer, { preserveDrawer: true });
			this.syncBrushSettingsPlacement();
		}

		const openingFirstDrawer = !this.activeDrawer;
		if (openingFirstDrawer) {
			this.drawerViewportState = this.editor.viewport?.captureViewState?.() || null;
			this.drawerViewportUserState = null;
			this.drawerViewportUserZoomed = false;
			this.drawerViewportLastZoom = this.drawerViewportState?.zoom ?? null;
		}

		this.activeDrawer = drawer;
		document.body.classList.toggle('designOpen', drawer === 'design');
		document.body.classList.toggle('layersOpen', drawer === 'layers');
		document.body.classList.toggle('editOpen', drawer === 'edit');
		if (drawer === 'design') this.editor.setCollapsibleSectionOpen?.('designGallery', true);
		document.querySelectorAll('.mobile-drawer-btn[data-drawer]').forEach((button) => {
			const active = this.normalizeDrawer(button.dataset.drawer) === drawer;
			button.classList.toggle('active', active);
			button.setAttribute('aria-expanded', String(active));
		});
		this.scheduleDrawerViewportUpdate('fit');
	}

	canOpenEditDrawer() {
		return document.body.classList.contains('has-layer-settings');
	}

	prepareSettings(layer, options = {}) {
		const container = document.getElementById('mobileSettingsContainer');
		if (!container) return;
		const wasEditOpen = this.activeDrawer === 'edit';
		this.returnSettingsSections();
		let hasSettings = false;
		const keys = LAYER_UI_CONFIG[layer.type]?.mobileSettingsSections || [];
		keys.forEach((key) => {
			const section = this.settingsRegistry[key]?.element;
			if (!section) return;
			container.appendChild(section);
			section.classList.add('visible');
			hasSettings = true;
		});
		this.collapseAllSections();
		document.body.classList.toggle('has-layer-settings', hasSettings);
		document.getElementById('mobileSettingsBtn')?.toggleAttribute('disabled', !hasSettings);
		this.syncBrushSettingsPlacement();
		if (!options.preserveDrawer && CONFIG.ui.mobile.autoCloseDesignDrawer && this.activeDrawer === 'design') {
			this.closeAllDrawers();
		}
		if (wasEditOpen) this.activeDrawer = 'edit';
	}

	collapseAllSections() {
		Object.values(this.settingsRegistry).forEach((entry) => {
			if (entry.collapsibleName && entry.element) {
				this.editor.setCollapsibleSectionOpen?.(entry.collapsibleName, false);
			}
		});
	}

	returnSettingsSections() {
		Object.keys(this.settingsRegistry).forEach((key) => this.returnSettingsSection(key));
		const container = document.getElementById('mobileSettingsContainer');
		if (container) container.replaceChildren();
	}

	returnSettingsSection(key) {
		const section = this.settingsRegistry[key]?.element;
		const parent = this.originalParents.get(key);
		if (section && parent && !parent.contains(section)) parent.appendChild(section);
	}

	returnBrushSection() {
		this.returnSettingsSection('brush');
	}

	syncBrushSettingsPlacement() {
		if (!this.isMobile) return;
		const section = this.settingsRegistry.brush?.element;
		const container = document.getElementById('mobileSettingsContainer');
		if (!section) return;
		if (this.editor.currentTool === ToolType.BRUSH && container) {
			if (!container.contains(section)) container.appendChild(section);
			section.classList.add('visible');
			document.body.classList.add('has-layer-settings');
			document.getElementById('mobileSettingsBtn')?.removeAttribute('disabled');
			return;
		}
		this.returnBrushSection();
		this.syncEditAvailability();
	}

	syncEditAvailability() {
		const layer = this.editor.layerManager.getActiveLayer();
		const hasSettings = Boolean(layer && this.hasLayerSettings(layer)) || this.editor.currentTool === ToolType.BRUSH;
		document.body.classList.toggle('has-layer-settings', hasSettings);
		document.getElementById('mobileSettingsBtn')?.toggleAttribute('disabled', !hasSettings);
	}

	toggleSettings() {
		this.toggleDrawer('edit');
	}

	closeSettings(options = {}) {
		if (options.releaseBrush && this.editor.currentTool === ToolType.BRUSH) {
			this.editor.maskEditor?.releaseBrushTool({ commitStroke: false });
		}
		if (this.activeDrawer === 'edit') this.closeAllDrawers();
	}

	closeAllDrawers(options = {}) {
		if (options.releaseBrush && this.editor.currentTool === ToolType.BRUSH) {
			this.editor.maskEditor?.releaseBrushTool({ commitStroke: false });
		}
		const hadDrawerViewportSession = Boolean(this.activeDrawer || this.drawerViewportState);
		const userState = this.drawerViewportUserState;
		const restoreState = userState && this.drawerViewportState
			? {
				zoom: this.drawerViewportUserZoomed ? userState.zoom : this.drawerViewportState.zoom,
				focusX: userState.focusX,
				focusY: userState.focusY
			}
			: this.drawerViewportState;
		const closingDrawer = this.activeDrawer;
		const closingElement = closingDrawer === 'edit'
			? document.getElementById('mobileSettingsDrawer')
			: closingDrawer === 'design'
				? document.getElementById('designPanel')
				: closingDrawer === 'layers'
					? document.getElementById('layersPanel')
					: null;
		this.activeDrawer = null;
		document.body.classList.remove('designOpen', 'layersOpen', 'editOpen', 'mobile-sheet-expanded');
		document.querySelectorAll('.mobile-drawer-btn[data-drawer]').forEach((button) => {
			button.classList.remove('active');
			button.setAttribute('aria-expanded', 'false');
		});
		if (options.immediate || !closingElement) {
			this.setSheetHeight(50, { resize: false });
		} else {
			this.deferSheetHeightReset(closingElement);
		}
		if (options.resize !== false && hadDrawerViewportSession) this.scheduleDrawerViewportUpdate('restore', restoreState);
		else this.resetDrawerViewportSession();
	}

	deferSheetHeightReset(closingElement) {
		this.cancelDrawerCloseFinalization();
		document.body.classList.add('mobile-drawer-closing');
		const finish = () => {
			if (this.drawerCloseElement !== closingElement) return;
			this.cancelDrawerCloseFinalization();
			this.setSheetHeight(50, { resize: false });
		};
		this.drawerCloseElement = closingElement;
		// Keep the dragged height stable for the entire exit animation. Listening
		// for transitionend is unreliable when an opening transition is reversed;
		// browsers may deliver that earlier transition's completion to the same node.
		this.drawerCloseTimer = setTimeout(finish, 350);
	}

	cancelDrawerCloseFinalization() {
		if (this.drawerCloseTimer) clearTimeout(this.drawerCloseTimer);
		if (this.drawerCloseElement && this.drawerCloseListener) {
			this.drawerCloseElement.removeEventListener('transitionend', this.drawerCloseListener);
		}
		this.drawerCloseTimer = null;
		this.drawerCloseElement = null;
		this.drawerCloseListener = null;
		document.body.classList.remove('mobile-drawer-closing');
	}

	setupSheetDrag() {
		document.querySelectorAll('[data-mobile-drawer-handle]').forEach((handle) => {
			if (handle.dataset.bound === 'true') return;
			handle.dataset.bound = 'true';
			handle.addEventListener('pointerdown', (event) => {
				if (!this.isMobile || this.activeDrawer !== handle.dataset.mobileDrawerHandle) return;
				handle.setPointerCapture(event.pointerId);
				this.finishViewportAnimation();
				this.sheetDrag = { pointerId: event.pointerId, startY: event.clientY, startHeight: this.sheetHeight };
				document.body.classList.add('mobile-sheet-dragging');
				event.preventDefault();
			});
			handle.addEventListener('pointermove', (event) => {
				if (!this.sheetDrag || event.pointerId !== this.sheetDrag.pointerId) return;
				const delta = ((this.sheetDrag.startY - event.clientY) / window.innerHeight) * 100;
				this.setSheetHeight(Math.max(0, Math.min(85, this.sheetDrag.startHeight + delta)));
				event.preventDefault();
			});
			const finish = (event) => {
				if (!this.sheetDrag || event.pointerId !== this.sheetDrag.pointerId) return;
				this.sheetDrag = null;
				document.body.classList.remove('mobile-sheet-dragging');
				if (this.sheetHeight <= 32) {
					this.closeAllDrawers({ releaseBrush: this.activeDrawer === 'edit' });
				} else {
					this.setSheetHeight(this.sheetHeight >= 68 ? 85 : 50);
				}
			};
			handle.addEventListener('pointerup', finish);
			handle.addEventListener('pointercancel', finish);
			handle.addEventListener('keydown', (event) => {
				if (event.key === 'Escape') this.closeAllDrawers({ releaseBrush: this.activeDrawer === 'edit' });
				if (event.key === 'ArrowDown') this.setSheetHeight(Math.max(30, this.sheetHeight - 10));
				if (event.key === 'ArrowUp') this.setSheetHeight(Math.min(85, this.sheetHeight + 10));
			});
		});
	}

	setSheetHeight(height, options = {}) {
		this.sheetHeight = height;
		document.documentElement.style.setProperty('--mobile-drawer-height', `${height}dvh`);
		document.body.classList.toggle('mobile-sheet-expanded', height >= 65);
		document.querySelectorAll('[data-mobile-drawer-handle]').forEach((handle) => {
			handle.setAttribute('aria-valuenow', String(Math.round(height)));
		});
		if (options.resize !== false) this.requestViewportResize();
	}

	requestViewportResize() {
		cancelAnimationFrame(this.sheetResizeFrame);
		this.sheetResizeFrame = requestAnimationFrame(() => {
			this.drawerViewportSyncing = true;
			this.editor.viewport?.performResizeUpdate();
			this.drawerViewportLastZoom = this.editor.viewport?.currentZoom ?? null;
			this.drawerViewportSyncing = false;
		});
	}

	scheduleDrawerViewportUpdate(mode, restoreState = null) {
		this.cancelDrawerViewportUpdate();
		this.editor.viewport?.startViewTransition?.();
		this.drawerLayoutFrame = requestAnimationFrame(() => {
			this.drawerLayoutFrame = requestAnimationFrame(() => {
				this.drawerViewportSyncing = true;
				if (mode === 'restore' && restoreState) {
					this.editor.viewport?.restoreViewState?.(restoreState);
				} else {
					this.editor.viewport?.performResizeUpdate();
				}
				this.drawerViewportLastZoom = this.editor.viewport?.currentZoom ?? null;
				this.drawerViewportSyncing = false;
				if (mode === 'restore') this.resetDrawerViewportSession();
			});
		});
	}

	cancelDrawerViewportUpdate() {
		if (this.drawerLayoutFrame) cancelAnimationFrame(this.drawerLayoutFrame);
		this.drawerLayoutFrame = null;
		this.finishViewportAnimation();
	}

	finishViewportAnimation() {
		this.editor.viewport?.cancelViewTransition?.();
	}

	resetDrawerViewportSession() {
		this.drawerViewportState = null;
		this.drawerViewportUserState = null;
		this.drawerViewportUserZoomed = false;
		this.drawerViewportLastZoom = null;
	}

	cleanup() {
		this.cancelDrawerViewportUpdate();
		this.cancelDrawerCloseFinalization();
		this.closeAllDrawers({ releaseBrush: true, resize: false, immediate: true });
		this.returnSettingsSections();
		document.querySelector('.mobile-bottom-nav')?.classList.remove('visible');
		document.body.classList.remove('mobile-no-image', 'has-layer-settings', 'mobile-sheet-dragging');
		document.documentElement.style.removeProperty('--mobile-drawer-height');

		const activeLayer = this.editor.layerManager.getActiveLayer();
		if (activeLayer) {
			LAYER_UI_CONFIG[activeLayer.type]?.onActivate?.(this.editor, activeLayer);
		} else {
			this.editor.showLayerSettingsEmptyState();
			this.editor.showGlitterSettingsEmptyState();
			this.editor.showStickerSettingsEmptyState();
		}
	}
}

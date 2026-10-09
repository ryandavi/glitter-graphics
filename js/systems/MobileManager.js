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
		this.phoneHostAnchors = new Map();
		this.resizeObserver = null;
		this.eventsBound = false;
		this.sheetDrag = null;
		this.sheetHeight = CONFIG.ui.mobile.sheetDetents.half;
		this.drawerViewportState = null;
		this.drawerViewportUserState = null;
		this.drawerViewportUserZoomed = false;
		this.drawerViewportLastZoom = null;
		this.drawerViewportSyncing = false;
		this.drawerLayoutFrame = null;
		this.drawerCloseTimer = null;
		this.drawerCloseElement = null;
		this.drawerCloseListener = null;

		// index.html ships `mobile-no-image` on <body> so the empty-document mobile
		// layout is correct on first paint; drop it when we boot on desktop.
		if (this.isMobile) this.init();
		else document.body.classList.remove('mobile-no-image');
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
		if (this.editor.currentTool === ToolType.HAND) this.editor.setTool(ToolType.SELECT);
		this.buildSettingsRegistry();
		this.cacheSettingsSections();
		dbg('Mobile: Schema settings registry:', Object.keys(this.settingsRegistry));
		this.showMobileControls();
		this.syncPhoneHosts();
		this.editor.libraryWindow?.sync();
		this.setupEventListeners();
		this.setupSheetDrag();
		this.syncImageState();

		const activeLayer = this.editor.layerManager.getActiveLayer();
		if (activeLayer && this.hasLayerSettings(activeLayer)) this.prepareSettings(activeLayer);
	}

	hasLayerSettings(layer) {
		const sections = this.getLayerSettingsKeys(layer);
		return Boolean(sections?.some((key) => this.settingsRegistry[key]?.element));
	}

	getLayerSettingsKeys(layer) {
		// An Auto Glitter session owns the edit drawer regardless of which layer
		// is active — its panel replaces the active layer's own settings, the
		// same way editor-panels.js swaps in LAYER_UI_CONFIG.AUTO_GLITTER. Without
		// this, openDrawer('edit') re-runs prepareSettings off the active (base)
		// layer and clobbers the just-mounted Auto Glitter section.
		if (this.editor.autoGlitterManager?.isSessionActive()) return [...LAYER_UI_CONFIG.AUTO_GLITTER.mobileSettingsSections];
		if (!layer) return [];
		const keys = [...(LAYER_UI_CONFIG[layer.type]?.mobileSettingsSections || [])];
		if (this.editor.currentTool === ToolType.GLITTER_FILL && layer.type === LayerType.GLITTER_FILL) {
			keys.unshift('tool');
		}
		return keys;
	}

	cacheSettingsSections() {
		Object.entries(this.settingsRegistry).forEach(([key, entry]) => {
			if (entry.element && !this.originalParents.has(key)) {
				this.originalParents.set(key, {
					parent: entry.element.parentElement,
					next: entry.element.nextElementSibling
				});
			}
		});
	}

	// Controls that sit somewhere else at phone width. Each host names its
	// controls in data-phone-host-for, so the markup is the one list.
	syncPhoneHosts() {
		document.querySelectorAll('[data-phone-host-for]').forEach((host) => {
			host.dataset.phoneHostFor.split(' ').forEach((id) => {
				const control = document.getElementById(id);
				if (!control) return;
				if (this.isMobile) {
					if (!this.phoneHostAnchors.has(id)) {
						this.phoneHostAnchors.set(id, { parent: control.parentElement, next: control.nextElementSibling });
					}
					host.appendChild(control);
					return;
				}
				const anchor = this.phoneHostAnchors.get(id);
				if (!anchor || anchor.parent.contains(control)) return;
				anchor.parent.insertBefore(control, anchor.next?.parentElement === anchor.parent ? anchor.next : null);
			});
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
					if (this.editor.currentTool === ToolType.BRUSH) this.editor.setTool(ToolType.SELECT, { commitStroke: false });
					this.isMobile = true;
					this.init();
					requestAnimationFrame(() => requestAnimationFrame(() => {
						this.editor.viewport.performResizeUpdate();
						this.editor.viewport.resetViewport();
						this.editor.updateZoomUI();
						this.editor.updateTransparencyGrid();
					}));
				} else if (this.isMobile && !nowMobile) {
					if (this.editor.currentTool === ToolType.BRUSH) this.editor.setTool(ToolType.SELECT, { commitStroke: false });
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
			this.setSheetHeight(CONFIG.ui.mobile.sheetDetents.half, { resize: false });
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
		const keys = options.keys || this.getLayerSettingsKeys(layer);
		keys.forEach((key) => {
			const section = this.settingsRegistry[key]?.element;
			if (!section) return;
			container.appendChild(section);
			section.classList.add('visible');
			hasSettings = true;
		});
		document.body.classList.toggle('has-layer-settings', hasSettings);
		document.getElementById('mobileSettingsBtn')?.toggleAttribute('disabled', !hasSettings);
		this.syncBrushSettingsPlacement();
		this.syncEditSections();
		if (!options.preserveDrawer && CONFIG.ui.mobile.autoCloseDesignDrawer && this.activeDrawer === 'design') {
			this.closeAllDrawers();
		}
		if (wasEditOpen) this.activeDrawer = 'edit';
	}

	// A lone section sits bare on the drawer, named in the grabber row. Two (a
	// fill layer beside its tool settings, a layer beside Mask Settings) stack
	// under their own bars and collapse as the sidebar accordion does.
	syncEditSections() {
		const container = document.getElementById('mobileSettingsContainer');
		const bar = document.getElementById('mobileEditTitle');
		if (!container || !bar) return;
		const present = Array.from(container.children)
			.map((element) => Object.keys(this.settingsRegistry).find((key) => this.settingsRegistry[key].element === element))
			.filter(Boolean);
		const stacked = present.length > 1;
		container.classList.toggle('has-section-stack', stacked);
		// A new pairing opens on the tool being used; after that the bars the
		// user opened and closed stand.
		const pairing = present.join();
		const open = present.filter((key) => this.settingsRegistry[key].element.classList.contains('is-open'));
		const toolKey = this.editor.currentTool === ToolType.BRUSH && present.includes('brush') ? 'brush' : present[0];
		const activeKey = stacked && pairing === this.editSectionPairing && open.length === 1 ? open[0] : toolKey;
		this.editSectionPairing = pairing;
		present.forEach((key) => {
			const entry = this.settingsRegistry[key];
			if (entry.collapsibleName) this.editor.setCollapsibleSectionOpen?.(entry.collapsibleName, key === activeKey);
		});
		const title = document.createElement('span');
		title.className = 'mobile-sheet-title';
		title.textContent = stacked ? 'Edit'
			: (present.length ? this.settingsRegistry[present[0]].element.querySelector('.section-header-title-text')?.textContent || '' : '');
		bar.replaceChildren(title);
	}

	returnSettingsSections() {
		Object.keys(this.settingsRegistry).forEach((key) => this.returnSettingsSection(key));
		const container = document.getElementById('mobileSettingsContainer');
		if (container) container.replaceChildren();
	}

	returnSettingsSection(key) {
		const section = this.settingsRegistry[key]?.element;
		const anchor = this.originalParents.get(key);
		if (!section || !anchor?.parent || anchor.parent.contains(section)) return;
		anchor.parent.insertBefore(section, anchor.next?.parentElement === anchor.parent ? anchor.next : null);
	}

	returnBrushSection() {
		this.returnSettingsSection('brush');
	}

	syncToolSettingsPlacement() {
		if (!this.isMobile) return;
		const layer = this.editor.layerManager.getActiveLayer();
		if (this.activeDrawer === 'edit' && layer) {
			this.prepareSettings(layer, { preserveDrawer: true });
			return;
		}
		this.returnSettingsSection('tool');
		this.syncEditAvailability();
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
			this.syncEditSections();
			return;
		}
		this.returnBrushSection();
		this.syncEditAvailability();
		this.syncEditSections();
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

	closeAllDrawers(options = {}) {
		if (options.releaseBrush && this.editor.currentTool === ToolType.BRUSH) {
			this.editor.setTool(ToolType.SELECT, { commitStroke: false });
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
		this.sheetDrag = null;
		document.body.classList.remove('mobile-sheet-dragging');
		document.body.classList.remove('designOpen', 'layersOpen', 'editOpen', 'mobile-sheet-expanded');
		document.querySelectorAll('.mobile-drawer-btn[data-drawer]').forEach((button) => {
			button.classList.remove('active');
			button.setAttribute('aria-expanded', 'false');
		});
		if (options.immediate || !closingElement) {
			this.setSheetHeight(CONFIG.ui.mobile.sheetDetents.half, { resize: false });
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
			this.setSheetHeight(CONFIG.ui.mobile.sheetDetents.half, { resize: false });
		};
		this.drawerCloseElement = closingElement;
		// Keep the dragged height stable for the entire exit animation. Listening
		// for transitionend is unreliable when an opening transition is reversed;
		// browsers may deliver that earlier transition's completion to the same node.
		this.drawerCloseTimer = setTimeout(finish, this.sheetTransitionMs());
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

	sheetTransitionMs() {
		const reduced = PREFERENCES.get('reduceMotion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		document.body.classList.toggle('mobile-sheet-reduced-motion', reduced);
		if (reduced) return 0;
		const duration = getComputedStyle(document.documentElement).getPropertyValue('--transition-base').trim();
		return parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000);
	}

	setupSheetDrag() {
		this.setSheetHeight(this.sheetHeight, { resize: false });
		document.querySelectorAll('[data-mobile-drawer-handle]').forEach((handle) => {
			if (handle.dataset.bound === 'true') return;
			handle.dataset.bound = 'true';
			const sheet = handle.parentElement;
			const name = handle.dataset.mobileDrawerHandle;
			const headers = name === 'edit' ? '.mobile-sheet-bar' : ':scope > .section > .section-header';
			sheet.querySelectorAll(headers).forEach(header => header.classList.add('mobile-sheet-drag-header', 'ui-ignore-gestures'));
			let suppressClick = false;
			sheet.addEventListener('click', event => {
				if (!suppressClick) return;
				suppressClick = false;
				event.preventDefault();
				event.stopImmediatePropagation();
			}, true);
			sheet.addEventListener('pointerdown', event => {
				if (!this.isMobile || this.activeDrawer !== name || this.sheetDrag || event.button !== 0) return;
				suppressClick = false;
				const header = event.target.closest('[data-mobile-drawer-handle], .mobile-sheet-drag-header');
				let content = false;
				if (!header) {
					if (event.pointerType !== 'touch' || event.target.closest('input, select, textarea, .gradient-preview, .layer-drag-handle, .scroll-region-track, [data-pointer-drag]')) return;
					for (let node = event.target; node && node !== sheet; node = node.parentElement) {
						const style = getComputedStyle(node);
						if (style.touchAction === 'none' || (node.scrollWidth > node.clientWidth && /^(auto|scroll)$/.test(style.overflowX))) return;
						if (!/^(auto|scroll)$/.test(style.overflowY)) continue;
						// Content scrolled anywhere up the chain scrolls back first.
						if (node.scrollTop > 0) return;
						content = true;
					}
					if (!content) return;
				}
				this.sheetDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
					startHeight: this.sheetHeight, content, mode: 'pending',
					samples: [{ y: event.clientY, time: event.timeStamp }] };
			}, true);
			sheet.addEventListener('pointermove', event => {
				const drag = this.sheetDrag;
				if (!drag || event.pointerId !== drag.pointerId) return;
				const dy = event.clientY - drag.startY;
				if (drag.mode === 'pending') {
					if (Math.abs(dy) <= CONFIG.ui.gestures.tapSlopPx) return;
					if (Math.abs(event.clientX - drag.startX) > Math.abs(dy)) { this.sheetDrag = null; return; }
					// Upward movement over content is the browser's own scroll.
					if (drag.content && dy < 0) { this.sheetDrag = null; return; }
					drag.mode = 'drag';
					sheet.setPointerCapture(event.pointerId);
					suppressClick = true;
					this.cancelDrawerViewportUpdate();
					cancelAnimationFrame(this.sheetResizeFrame);
					document.body.classList.add('mobile-sheet-dragging');
				}
				const detents = CONFIG.ui.mobile.sheetDetents;
				const height = drag.startHeight - dy / window.innerHeight * 100;
				this.setSheetHeight(Math.max(detents.minDragHeight, Math.min(detents.full, height)), { live: true, resize: false });
				const now = event.timeStamp;
				drag.samples.push({ y: event.clientY, time: now });
				while (drag.samples.length > 2 && drag.samples[1].time < now - detents.velocityWindowMs) drag.samples.shift();
				event.preventDefault();
				event.stopPropagation();
			});
			// Content scrolls natively, so it keeps momentum. A pull down from content
			// resting at its top belongs to the sheet, and only a cancelled touchmove
			// stops the browser from claiming that touch as a scroll.
			sheet.addEventListener('touchmove', event => {
				const drag = this.sheetDrag;
				if (!drag?.content || !event.cancelable || event.touches.length !== 1) return;
				const dx = event.touches[0].clientX - drag.startX;
				const dy = event.touches[0].clientY - drag.startY;
				if (drag.mode === 'drag' || (dy > 0 && dy >= Math.abs(dx))) event.preventDefault();
			}, { passive: false });
			const finish = event => {
				if (event.type === 'lostpointercapture' && event.target !== sheet) return;
				const drag = this.sheetDrag;
				if (!drag || event.pointerId !== drag.pointerId) return;
				this.sheetDrag = null;
				if (sheet.hasPointerCapture(event.pointerId)) sheet.releasePointerCapture(event.pointerId);
				document.body.classList.remove('mobile-sheet-dragging');
				if (drag.mode === 'drag') {
					const now = event.timeStamp;
					const recent = drag.samples.filter(sample => sample.time >= now - CONFIG.ui.mobile.sheetDetents.velocityWindowMs);
					const first = recent[0];
					const velocity = event.type === 'pointercancel' || !first
						? 0 : (event.clientY - first.y) / Math.max(1, now - first.time);
					this.settleSheet(velocity, drag.startHeight);
				}
			};
			sheet.addEventListener('pointerup', finish);
			sheet.addEventListener('pointercancel', finish);
			sheet.addEventListener('lostpointercapture', finish);
			handle.addEventListener('keydown', event => {
				if (!this.isMobile || this.activeDrawer !== name) return;
				if (!['Escape', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
				event.preventDefault();
				if (event.key === 'Escape') this.closeAllDrawers({ releaseBrush: name === 'edit' });
				else this.settleSheet(event.key === 'ArrowDown' ? CONFIG.ui.mobile.sheetDetents.flingVelocityPxMs : -CONFIG.ui.mobile.sheetDetents.flingVelocityPxMs, this.sheetHeight, true);
			});
		});
	}

	settleSheet(velocity = 0, startHeight = this.sheetHeight, keyboard = false) {
		const config = CONFIG.ui.mobile.sheetDetents;
		const heights = [config.peek, config.half, config.full];
		const down = velocity >= config.flingVelocityPxMs;
		const up = velocity <= -config.flingVelocityPxMs;
		if (this.sheetHeight < config.dismissBelow || (down && startHeight <= (keyboard ? config.peek : config.half))) {
			this.closeAllDrawers({ releaseBrush: this.activeDrawer === 'edit' });
			return;
		}
		let height = heights.reduce((best, value) => Math.abs(value - this.sheetHeight) < Math.abs(best - this.sheetHeight) ? value : best);
		if (down) height = heights.filter(value => value < startHeight).pop() || config.peek;
		if (up) height = heights.find(value => value > startHeight) || config.full;
		this.setSheetHeight(height);
	}

	setSheetHeight(height, options = {}) {
		this.sheetHeight = height;
		document.documentElement.style.setProperty('--mobile-drawer-height', `${height}dvh`);
		if (!options.live) {
			this.sheetTransitionMs();
			document.documentElement.style.setProperty('--mobile-drawer-reserved-height', `${height}dvh`);
		}
		document.body.classList.toggle('mobile-sheet-expanded', height >= CONFIG.ui.mobile.sheetDetents.full);
		document.querySelectorAll('[data-mobile-drawer-handle]').forEach(handle => {
			handle.setAttribute('aria-valuemin', String(CONFIG.ui.mobile.sheetDetents.minDragHeight));
			handle.setAttribute('aria-valuemax', String(CONFIG.ui.mobile.sheetDetents.full));
			handle.setAttribute('aria-valuenow', String(Math.round(height)));
		});
		if (options.resize !== false) this.requestViewportResize();
	}

	requestViewportResize() {
		cancelAnimationFrame(this.sheetResizeFrame);
		this.sheetResizeFrame = requestAnimationFrame(() => {
			this.drawerViewportSyncing = true;
			this.editor.viewport?.performResizeUpdate({ animate: true });
			this.drawerViewportLastZoom = this.editor.viewport?.currentZoom ?? null;
			this.drawerViewportSyncing = false;
		});
	}

	scheduleDrawerViewportUpdate(mode, restoreState = null) {
		this.cancelDrawerViewportUpdate();
		this.drawerLayoutFrame = requestAnimationFrame(() => {
			this.drawerLayoutFrame = requestAnimationFrame(() => {
				this.drawerViewportSyncing = true;
				if (mode === 'restore' && restoreState) {
					this.editor.viewport?.restoreViewState?.(restoreState, { animate: true });
				} else {
					this.editor.viewport?.performResizeUpdate({ animate: true });
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
		this.syncPhoneHosts();
		this.editor.libraryWindow?.sync();
		document.querySelector('.mobile-bottom-nav')?.classList.remove('visible');
		document.body.classList.remove('mobile-no-image', 'has-layer-settings', 'mobile-sheet-dragging');
		document.documentElement.style.removeProperty('--mobile-drawer-height');
		document.documentElement.style.removeProperty('--mobile-drawer-reserved-height');
		this.sheetDrag = null;

		const activeLayer = this.editor.layerManager.getActiveLayer();
		if (activeLayer) {
			LAYER_UI_CONFIG[activeLayer.type]?.onActivate?.(this.editor, activeLayer);
		} else {
			this.editor.setSettingsEmptyState('layerSettings', true, { title: 'No layer selected', subtext: '' });
			this.editor.setSettingsEmptyState('glitterSettings', true);
			this.editor.setSettingsEmptyState('stickerSettings', true);
		}
	}
}

// ============================================
// MOBILE MANAGER CLASS
// ============================================
class MobileManager {
	constructor(editor) {
		this.editor = editor;
		this.isMobile = window.innerWidth <= CONFIG.ui.mobile.breakpoint;
		this.chipBar = new PhoneChipBar(editor, this);
		this.sheetSection = null;
		// The section a Library sheet was opened from, for its Back.
		this.sheetReturn = null;
		this.sheetHadLayer = false;
		// What a closed sheet still shows while it slides away.
		this.sheetRelease = null;
		this.activeDrawer = null;
		this.phoneHostAnchors = new Map();
		this.resizeObserver = null;
		this.eventsBound = false;
		this.sheetDrags = null;
		this.sheetHeight = CONFIG.ui.mobile.sheetDetents.half;
		// Sheets keep the height the user left them at.
		this.sheetRestHeight = this.sheetHeight;
		this.drawerViewportState = null;
		this.drawerViewportUserState = null;
		this.drawerViewportUserZoomed = false;
		this.drawerViewportLastZoom = null;
		this.drawerViewportSyncing = false;
		this.drawerCloseTimer = null;
		this.drawerCloseElement = null;
		this.historyStateKey = 'glitterSheet';
		this.pendingHistoryBack = null;
		this.pendingDrawerOpen = null;
		this.sheetResizeFrame = null;

		// index.html ships `mobile-no-image` on <body> so the empty-document mobile
		// layout is correct on first paint; drop it when we boot on desktop.
		if (this.isMobile) this.init();
		else document.body.classList.remove('mobile-no-image');
		this.setupResizeObserver();
		this.setupImageEvents();
	}

	init() {
		dbg('Mobile: Initializing mobile manager');
		document.body.classList.add('phone-bar');
		document.getElementById('inspectorClose').classList.add('visible');
		this.releaseSheet('window');
		document.querySelector('.mobile-bottom-nav')?.classList.add('visible');
		this.syncToolSwitch();
		this.syncPhoneHosts();
		this.editor.libraryWindow?.sync();
		this.setupEventListeners();
		this.setupSheetDrag();
		this.syncImageState();
		this.chipBar.start();
	}

	// Controls that sit somewhere else at phone width. Each host names its
	// controls in data-phone-host-for, so the markup is the one list. A host
	// with data-phone-host-place="after" is followed by its control instead of
	// holding it.
	syncPhoneHosts() {
		document.querySelectorAll('[data-phone-host-for]').forEach((host) => {
			const hosts = this.isMobile;
			host.dataset.phoneHostFor.split(' ').forEach((id) => {
				const control = document.getElementById(id);
				if (!control) return;
				if (hosts) {
					if (!this.phoneHostAnchors.has(id)) {
						this.phoneHostAnchors.set(id, { parent: control.parentElement, next: control.nextElementSibling });
					}
					if (host.dataset.phoneHostPlace === 'after') host.after(control);
					else host.appendChild(control);
					return;
				}
				const anchor = this.phoneHostAnchors.get(id);
				if (!anchor || anchor.parent.contains(control)) return;
				anchor.parent.insertBefore(control, anchor.next?.parentElement === anchor.parent ? anchor.next : null);
			});
		});
	}

	// The phone rail is its switch, Undo and Redo until it is opened. Picking a
	// tool or pressing anywhere off the rail closes it.
	setToolRailOpen(open) {
		document.querySelector('.toolbar').classList.toggle('is-open', open);
		document.getElementById('toolSwitch').setAttribute('aria-expanded', String(open));
		this.syncToolSwitch();
	}

	// Closed, the switch is the current tool; open, it is the chevron that
	// closes the rail, and the rail's own button marks the tool.
	syncToolSwitch() {
		const toolSwitch = document.getElementById('toolSwitch');
		const open = toolSwitch.getAttribute('aria-expanded') === 'true';
		toolSwitch.classList.toggle('active', !open);
		// No tool is current until the editor's first setTool; the markup's icon stands until then.
		const icon = open ? 'chevron-up' : TOOLS[this.editor.currentTool]?.icon;
		if (icon) toolSwitch.querySelector('use').setAttribute('href', `#icon-${icon}`);
	}

	setupEventListeners() {
		if (this.eventsBound) return;
		window.addEventListener('popstate', (event) => {
			if (this.pendingHistoryBack) return;
			if (!event.state?.[this.historyStateKey] && this.activeDrawer) this.closeAllDrawers({ fromHistory: true });
			// Forward never revives a dismissed sheet or its expired picker.
			if (event.state?.[this.historyStateKey] && !this.activeDrawer) {
				const state = { ...history.state };
				delete state[this.historyStateKey];
				history.replaceState(state, '', location.href);
			}
		});

		document.querySelectorAll('.mobile-drawer-btn[data-drawer]').forEach((button) => {
			button.addEventListener('click', (event) => {
				event.stopPropagation();
				if (!button.disabled) this.toggleDrawer(button.dataset.drawer);
			});
		});

		const toolSwitch = document.getElementById('toolSwitch');
		toolSwitch.addEventListener('click', () => this.setToolRailOpen(toolSwitch.getAttribute('aria-expanded') !== 'true'));
		document.getElementById('toolbarToolsGroup').addEventListener('click', (event) => {
			if (event.target.closest('button[data-tool]')) this.setToolRailOpen(false);
		});
		document.addEventListener('pointerdown', (event) => {
			if (!event.target.closest('.toolbar')) this.setToolRailOpen(false);
		}, { capture: true });

		window.addEventListener('layerChanged', () => {
			if (!this.isMobile) return;
			const layer = this.editor.layerManager.getActiveLayer();
			const sheetOpen = this.activeDrawer === 'inspector' || this.activeDrawer === 'window';
			if (sheetOpen && this.sheetHadLayer && !layer && !this.editor.layerManager.hasMultiSelection()) this.closeAllDrawers();
		});

		window.addEventListener('layerItemClick', (event) => {
			if (!this.isMobile || event.detail.layerId !== this.editor.layerManager.activeLayerId) return;
			this.openLeadingSection();
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

		this.editor.previewContainer?.addEventListener('pointerdown', () => this.editor.viewport?.cancelViewTransition?.(), { capture: true });
		document.getElementById('inspectorClose').addEventListener('click', () => this.closeAllDrawers());

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
					this.setToolRailOpen(false);
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

	getDrawerElement(drawer) {
		const id = { inspector: 'designPanel', layers: 'layersPanel', window: 'libraryWindow' }[drawer];
		return id ? document.getElementById(id) : null;
	}

	// ----- The chip bar (js/ui/phone-chip-bar.js) ----------------------------

	syncBar() {
		this.chipBar.sync();
	}

	returnToSection() {
		return this.chipBar.returnToSection();
	}

	openLeadingSection() {
		this.chipBar.openLeadingSection();
	}

	// ----- Sheet state ------------------------------------------------------

	// The Inspector as a sheet shows one section: the marks here are what its
	// stylesheet rules read.
	setSheetSection(entry) {
		const body = document.getElementById('inspectorBody');
		body.querySelectorAll('.is-sheet-open, .has-sheet-open').forEach((node) => node.classList.remove('is-sheet-open', 'has-sheet-open'));
		const changed = Boolean(entry || this.sheetSection);
		this.sheetSection = entry ? { key: entry.key, title: entry.title, element: entry.element } : null;
		const card = entry && (entry.element.matches('.property-card') ? entry.element : entry.element.querySelector('.property-card'));
		// The sheet's bar is the section's: its title (syncInspectorHeader) and
		// its reset.
		bindSectionBar({ reset: document.getElementById('inspectorReset') }, card);
		if (changed) this.editor.syncInspectorHeader();
		if (!entry) return;
		[entry.element, ...(entry.extras || [])].forEach((element) => {
			element.classList.add('is-sheet-open');
			element.parentElement.closest('.property-group')?.classList.add('has-sheet-open');
		});
		if (entry.host !== entry.element) entry.host.classList.add('has-sheet-open');
		// The sheet's bar is the section's title row, so it shows whole.
		if (card?.classList.contains('is-collapsed')) setPanelCardCollapsed(card, false);
	}

	// Leaving a sheet ends what it showed.
	releaseSheet(drawer) {
		if (drawer === 'inspector') this.setSheetSection(null);
		if (drawer === 'window') {
			const pickers = this.editor.pickers;
			if (!pickers) return;
			pickers.flyout = null;
			pickers.closeAll();
			this.editor.libraryWindow?.sync();
		}
	}

	// ----- Drawers and sheets -----------------------------------------------

	openDrawer(drawer) {
		if (this.activeDrawer !== drawer) this.toggleDrawer(drawer);
	}

	toggleDrawer(drawer) {
		if (!this.isMobile || !this.getDrawerElement(drawer)) return;
		if (this.pendingHistoryBack) {
			const request = { drawer };
			this.pendingDrawerOpen = request;
			this.pendingHistoryBack.then(() => {
				if (this.pendingDrawerOpen !== request) return;
				this.pendingDrawerOpen = null;
				this.toggleDrawer(drawer);
			});
			return;
		}
		if (drawer === 'window' && !this.editor.libraryWindow.isOpen) return;
		this.cancelDrawerCloseFinalization();
		if (this.activeDrawer === drawer) {
			this.closeAllDrawers();
			return;
		}

		const openingFirstDrawer = !this.activeDrawer;
		const previous = this.activeDrawer;
		if (openingFirstDrawer) {
			history.pushState({ ...history.state, [this.historyStateKey]: true }, '', location.href);
			this.sheetHadLayer = Boolean(this.editor.layerManager.getActiveLayer());
			this.setSheetHeight(this.sheetRestHeight, { resize: false });
			this.drawerViewportState = this.editor.viewport?.captureViewState?.() || null;
			this.drawerViewportUserState = null;
			this.drawerViewportUserZoomed = false;
			this.drawerViewportLastZoom = this.drawerViewportState?.zoom ?? null;
		}

		this.activeDrawer = drawer;
		this.sheetReturn = previous === 'inspector' && drawer === 'window' ? this.sheetSection?.key || null : null;
		if (previous) {
			// One sheet takes another's place without either sliding.
			document.body.classList.add('mobile-sheet-swapping');
			requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('mobile-sheet-swapping')));
			this.releaseSheet(previous);
		}
		['layers', 'inspector', 'window'].forEach((name) => document.body.classList.toggle(`${name}Open`, drawer === name));
		document.body.classList.add('sheetOpen');
		document.querySelectorAll('.mobile-drawer-btn[data-drawer]').forEach((button) => {
			const active = button.dataset.drawer === drawer;
			button.classList.toggle('active', active);
			button.setAttribute('aria-expanded', String(active));
		});
		if (openingFirstDrawer) this.updateDrawerViewport('fit');
	}

	closeAllDrawers(options = {}) {
		this.pendingDrawerOpen = null;
		if (!options.fromHistory && this.activeDrawer) this.popSheetHistory();
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
		const closingElement = this.getDrawerElement(closingDrawer);
		this.activeDrawer = null;
		this.sheetDrags?.forEach((drag) => drag.cancel());
		this.sheetReturn = null;
		document.body.classList.remove('layersOpen', 'inspectorOpen', 'windowOpen', 'sheetOpen', 'mobile-sheet-expanded');
		document.querySelectorAll('.mobile-drawer-btn[data-drawer]').forEach((button) => {
			button.classList.remove('active');
			button.setAttribute('aria-expanded', 'false');
		});
		// The sheet slides away with its content and its height; both are let
		// go once it is out of sight.
		this.cancelDrawerCloseFinalization();
		this.sheetRelease = closingDrawer;
		if (options.immediate || !closingElement) this.finishDrawerClose();
		else this.deferSheetHeightReset(closingElement);
		if (options.resize !== false && hadDrawerViewportSession) this.updateDrawerViewport('restore', restoreState);
		else this.resetDrawerViewportSession();
	}

	popSheetHistory() {
		if (this.pendingHistoryBack || !history.state?.[this.historyStateKey]) return;
		const modals = this.editor.modalManager;
		if (modals.stack.length) {
			const state = { ...history.state };
			delete state[this.historyStateKey];
			history.replaceState(state, '', location.href);
			return;
		}
		// Modal opens already wait for this shared history boundary. A sheet
		// closed immediately before a modal must not navigate back through it.
		modals.navigatingBack = true;
		const pending = new Promise(resolve => {
			window.addEventListener('popstate', resolve, { once: true });
			history.back();
		});
		this.pendingHistoryBack = pending;
		modals.pendingHistoryBack = pending;
		pending.then(() => {
			this.pendingHistoryBack = null;
			if (modals.pendingHistoryBack === pending) modals.pendingHistoryBack = null;
			modals.navigatingBack = false;
		});
	}

	deferSheetHeightReset(closingElement) {
		document.body.classList.add('mobile-drawer-closing');
		const finish = () => {
			if (this.drawerCloseElement !== closingElement) return;
			this.cancelDrawerCloseFinalization();
		};
		this.drawerCloseElement = closingElement;
		// Keep the dragged height stable for the entire exit animation. Listening
		// for transitionend is unreliable when an opening transition is reversed;
		// browsers may deliver that earlier transition's completion to the same node.
		this.drawerCloseTimer = setTimeout(finish, this.sheetTransitionMs());
	}

	// The end of a close, whether the slide finished or something else opened.
	finishDrawerClose() {
		const drawer = this.sheetRelease;
		this.sheetRelease = null;
		if (drawer) this.releaseSheet(drawer);
		if (!this.activeDrawer) this.setSheetHeight(this.sheetRestHeight, { resize: false });
		this.syncBar();
	}

	cancelDrawerCloseFinalization() {
		if (this.sheetRelease) this.finishDrawerClose();
		if (this.drawerCloseTimer) clearTimeout(this.drawerCloseTimer);
		this.drawerCloseTimer = null;
		this.drawerCloseElement = null;
		document.body.classList.remove('mobile-drawer-closing');
	}

	sheetTransitionMs() {
		const reduced = PREFERENCES.get('reduceMotion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		document.body.classList.toggle('mobile-sheet-reduced-motion', reduced);
		if (reduced) return 0;
		const duration = getComputedStyle(document.documentElement).getPropertyValue('--transition-base').trim();
		return parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000);
	}

	// Each sheet's drag gesture (js/ui/sheet-drag.js), bound once.
	setupSheetDrag() {
		this.setSheetHeight(this.sheetHeight, { resize: false });
		this.sheetDrags ||= Array.from(document.querySelectorAll('[data-mobile-drawer-handle]')).map((handle) => {
			const sheet = handle.parentElement;
			return bindSheetDrag(sheet, handle, {
				isActive: () => this.isMobile && this.getDrawerElement(this.activeDrawer) === sheet,
				getHeight: () => this.sheetHeight,
				setHeight: (height) => this.setSheetHeight(height, { live: true, resize: false }),
				begin: () => cancelAnimationFrame(this.sheetResizeFrame),
				settle: (velocity, startHeight, keyboard) => this.settleSheet(velocity, startHeight, keyboard),
				close: () => this.closeAllDrawers({ releaseBrush: false })
			});
		});
	}

	settleSheet(velocity = 0, startHeight = this.sheetHeight, keyboard = false) {
		const config = CONFIG.ui.mobile.sheetDetents;
		const heights = [config.peek, config.half, config.full];
		const down = velocity >= config.flingVelocityPxMs;
		const up = velocity <= -config.flingVelocityPxMs;
		if (this.sheetHeight < config.dismissBelow || (down && startHeight <= (keyboard ? config.peek : config.half))) {
			this.closeAllDrawers({ releaseBrush: false });
			return;
		}
		let height = heights.reduce((best, value) => Math.abs(value - this.sheetHeight) < Math.abs(best - this.sheetHeight) ? value : best);
		if (down) height = heights.filter(value => value < startHeight).pop() || config.peek;
		if (up) height = heights.find(value => value > startHeight) || config.full;
		this.sheetRestHeight = height;
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
			this.refitDrawerViewport();
			this.drawerViewportLastZoom = this.editor.viewport?.currentZoom ?? null;
			this.drawerViewportSyncing = false;
		});
	}

	refitDrawerViewport() {
		const viewport = this.editor.viewport;
		if (!viewport) return;
		if (this.drawerViewportUserState) {
			viewport.restoreViewState(this.drawerViewportUserState, { animate: true });
			return;
		}
		const layers = this.activeDrawer === 'layers' ? [] : this.editor.layerManager.getSelectedLayers();
		const bounds = getLayersCanvasBox(this.editor, layers, { visual: true }) || {
			left: 0, top: 0, right: viewport.canvasWidth, bottom: viewport.canvasHeight
		};
		viewport.performResizeUpdate({
			animate: true, bounds,
			padding: CONFIG.ui.mobile.editingViewportPadding
		});
	}

	// The sheet and the canvas start in the same frame, so they move as one.
	// The room the sheet takes is already in the layout here.
	updateDrawerViewport(mode, restoreState = null) {
		this.drawerViewportSyncing = true;
		if (mode === 'restore' && restoreState) {
			this.editor.viewport?.restoreViewState?.(restoreState, { animate: true });
		} else {
			this.refitDrawerViewport();
		}
		this.drawerViewportLastZoom = this.editor.viewport?.currentZoom ?? null;
		this.drawerViewportSyncing = false;
		if (mode === 'restore') this.resetDrawerViewportSession();
	}

	resetDrawerViewportSession() {
		this.drawerViewportState = null;
		this.drawerViewportUserState = null;
		this.drawerViewportUserZoomed = false;
		this.drawerViewportLastZoom = null;
	}

	cleanup() {
		this.cancelDrawerCloseFinalization();
		this.closeAllDrawers({ releaseBrush: true, resize: false, immediate: true });
		this.syncPhoneHosts();
		this.editor.libraryWindow?.sync();
		this.chipBar.stop();
		document.querySelector('.mobile-bottom-nav')?.classList.remove('visible');
		document.getElementById('inspectorClose').classList.remove('visible');
		document.body.classList.remove('mobile-no-image', 'phone-bar');
		document.documentElement.style.removeProperty('--mobile-drawer-height');
		document.documentElement.style.removeProperty('--mobile-drawer-reserved-height');
	}
}

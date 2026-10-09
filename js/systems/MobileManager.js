// ============================================
// MOBILE MANAGER CLASS
// ============================================
class MobileManager {
	constructor(editor) {
		this.editor = editor;
		this.isMobile = window.innerWidth <= CONFIG.ui.mobile.breakpoint;
		this.barEntries = [];
		this.barFrame = null;
		this.sheetSection = null;
		// The section a Library sheet was opened from, for its Back.
		this.sheetReturn = null;
		this.sheetHadLayer = false;
		// What a closed sheet still shows while it slides away.
		this.sheetRelease = null;
		this.barObserver = new MutationObserver(() => this.syncBar());
		this.activeDrawer = null;
		this.phoneHostAnchors = new Map();
		this.resizeObserver = null;
		this.eventsBound = false;
		this.sheetDrag = null;
		this.sheetHeight = CONFIG.ui.mobile.sheetDetents.half;
		// The bar layout's sheets keep the height the user left them at.
		this.sheetRestHeight = this.sheetHeight;
		this.drawerViewportState = null;
		this.drawerViewportUserState = null;
		this.drawerViewportUserZoomed = false;
		this.drawerViewportLastZoom = null;
		this.drawerViewportSyncing = false;
		this.drawerLayoutFrame = null;
		this.drawerCloseTimer = null;
		this.drawerCloseElement = null;
		this.drawerCloseListener = null;
		this.historyStateKey = 'glitterSheet';
		this.pendingHistoryBack = null;

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
		this.barObserver.observe(document.getElementById('inspectorBody'), { subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
		this.showMobileControls();
		this.syncPhoneHosts();
		this.editor.libraryWindow?.sync();
		this.setupEventListeners();
		this.setupSheetDrag();
		this.syncImageState();
		this.syncBar();

	}

	get usesBar() {
		return this.isMobile;
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

	showMobileControls() {
		document.querySelector('.mobile-bottom-nav')?.classList.add('visible');
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

		const chipBar = document.getElementById('phoneChipBar');
		chipBar?.addEventListener('click', (event) => {
			const chip = event.target.closest('.phone-chip');
			const entry = chip && this.barEntries[Number(chip.dataset.chipIndex)];
			if (entry) this.pressChip(entry);
		});
		// The bar has no scrollbar, so a mouse wheel scrolls it sideways.
		chipBar?.addEventListener('wheel', (event) => {
			if (!event.deltaY || event.deltaX) return;
			chipBar.scrollLeft += event.deltaY;
			event.preventDefault();
		}, { passive: false });

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

	getDrawerElement(drawer) {
		const id = { inspector: 'designPanel', layers: 'layersPanel', window: 'libraryWindow' }[drawer];
		return id ? document.getElementById(id) : null;
	}

	// ----- The bar layout ---------------------------------------------------

	// The chips: the section index of every panel the Inspector shows, in
	// panel order, the tool's panel first.
	syncBar() {
		if (!this.usesBar) return;
		cancelAnimationFrame(this.barFrame);
		this.barFrame = requestAnimationFrame(() => this.renderBar());
	}

	renderBar() {
		const bar = document.getElementById('phoneChipBar');
		const body = document.getElementById('inspectorBody');
		if (!bar || !body || !this.usesBar) return;
		const editor = this.editor;
		const tool = `${TOOLS[editor.currentTool]?.panel?.(editor, editor.layerManager.getActiveLayer())}Section`;
		const entries = Array.from(body.children)
			.filter((host) => host.classList.contains('visible'))
			.sort((a, b) => (b.id === tool) - (a.id === tool))
			.flatMap((host) => getPanelSectionIndex(host).map((entry) => ({ ...entry, host })))
			.filter((entry) => entry.button?.dataset.phoneChip !== 'false');
		this.barEntries = entries;

		// The open section follows the selection: the same section of the next
		// layer keeps the sheet, and a layer without it closes the sheet.
		if (this.sheetSection) {
			const next = entries.find((entry) => entry.key === this.sheetSection.key && !entry.line && !entry.button);
			if (!next) {
				if (this.activeDrawer === 'inspector') this.closeAllDrawers();
				else this.setSheetSection(null);
			} else if (next.element !== this.sheetSection.element) {
				this.openPanel(next.host);
				this.setSheetSection(next);
			}
		}

		const signature = entries.map((entry) => `${entry.host.id}/${entry.key}`).join('|');
		if (bar.dataset.signature !== signature) {
			bar.dataset.signature = signature;
			bar.scrollLeft = 0;
			bar.replaceChildren(...entries.map((entry, index) => {
				const chip = document.createElement('button');
				chip.type = 'button';
				chip.className = entry.button ? 'phone-chip is-add' : 'phone-chip';
				if (entry.button) {
					chip.appendChild(createIcon('plus'));
					chip.setAttribute('aria-label', `Add ${entry.title} layer`);
				}
				chip.dataset.chipIndex = String(index);
				if (entry.line?.querySelector(':scope > .property-card-title > .property-card-swatch')) {
					const swatch = document.createElement('span');
					swatch.className = 'phone-chip-swatch';
					chip.appendChild(swatch);
				}
				chip.append(entry.title);
				return chip;
			}));
		}
		entries.forEach((entry, index) => {
			const chip = bar.children[index];
			if (chip.lastChild?.nodeType === Node.TEXT_NODE) chip.lastChild.textContent = entry.title;
			const swatch = entry.line?.querySelector(':scope > .property-card-title > .property-card-swatch');
			if (swatch) {
				// Off, a section has no paint to show, whatever it would use if on.
				const unset = swatch.classList.contains('is-unset') || entry.line.classList.contains('is-off');
				chip.firstElementChild.style.background = unset ? '' : swatch.style.background;
				chip.firstElementChild.classList.toggle('is-unset', unset);
			}
			const open = !entry.button && (entry.line ? entry.line.classList.contains('is-flyout-open') : this.sheetSection?.element === entry.element);
			if (open && !chip.classList.contains('active')) chip.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
			chip.classList.toggle('active', Boolean(open));
			chip.classList.toggle('is-off', Boolean(entry.line?.classList.contains('is-off')));
			if (!entry.button) chip.setAttribute('aria-pressed', String(Boolean(open)));
			chip.disabled = Boolean(entry.button?.disabled);
		});
	}

	// A chip opens its section, swaps the sheet to it, or closes it. A button
	// chip is its button.
	pressChip(entry) {
		// A sheet still sliding away is done with.
		this.cancelDrawerCloseFinalization();
		if (entry.button) {
			entry.button.click();
			return;
		}
		if (entry.line) {
			if (entry.line.classList.contains('is-flyout-open')) this.closeAllDrawers();
			// The window owns a flyout section: its line opens it.
			else entry.line.querySelector(':scope > .property-card-title').click();
			return;
		}
		if (this.activeDrawer === 'inspector' && this.sheetSection?.element === entry.element) {
			this.closeAllDrawers();
			return;
		}
		this.openPanel(entry.host);
		this.setSheetSection(entry);
		if (this.activeDrawer !== 'inspector') this.toggleDrawer('inspector');
		this.syncBar();
	}

	// Of a tool's panel and the layer's, the Inspector shows one.
	openPanel(host) {
		if (host.classList.contains('switch-panel') && !host.classList.contains('is-open')) {
			this.editor.setCollapsibleSectionOpen(host.id.replace(/Section$/, ''), true);
		}
	}

	// The Inspector as a sheet shows one section: the marks here are what its
	// stylesheet rules read.
	setSheetSection(entry) {
		const body = document.getElementById('inspectorBody');
		body.querySelectorAll('.is-sheet-open, .has-sheet-open').forEach((node) => node.classList.remove('is-sheet-open', 'has-sheet-open'));
		const title = document.getElementById('inspectorTitleText');
		this.sheetSection = entry ? { key: entry.key, element: entry.element } : null;
		const resetCard = entry?.element.matches('.property-card') ? entry.element : entry?.element.querySelector('.property-card');
		syncSectionHeaderReset(document.getElementById('inspectorReset'), resetCard);
		if (!entry) {
			if (title.dataset.sheetSection === undefined) return;
			delete title.dataset.sheetSection;
			this.editor.syncInspectorHeader();
			return;
		}
		title.dataset.sheetSection = entry.title;
		title.textContent = entry.title;
		document.getElementById('inspectorTitleName').textContent = '';
		[entry.element, ...(entry.extras || [])].forEach((element) => {
			element.classList.add('is-sheet-open');
			element.parentElement.closest('.property-group')?.classList.add('has-sheet-open');
		});
		if (entry.host !== entry.element) entry.host.classList.add('has-sheet-open');
		// The sheet's bar is the section's title row, so it shows whole.
		const card = entry.element.matches('.property-card') ? entry.element : entry.element.querySelector('.property-card');
		if (card?.classList.contains('is-collapsed')) setPanelCardCollapsed(card, false);
	}

	// Back on a Library sheet that was opened from a section's sheet.
	returnToSection() {
		const entry = this.sheetReturn && this.barEntries.find((candidate) => candidate.key === this.sheetReturn && !candidate.line && !candidate.button);
		if (!entry) return false;
		this.pressChip(entry);
		return true;
	}

	// Open the selection's first section from its layer-list row.
	openLeadingSection() {
		if (this.activeDrawer === 'inspector' || this.activeDrawer === 'window') return;
		this.renderBar();
		const entry = this.barEntries.find((candidate) => !candidate.button);
		if (entry) this.pressChip(entry);
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

	closeSheet(drawer) {
		if (this.activeDrawer === drawer) this.closeAllDrawers();
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
		if (openingFirstDrawer) this.scheduleDrawerViewportUpdate('fit');
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
		this.sheetDrag = null;
		this.sheetReturn = null;
		document.body.classList.remove('mobile-sheet-dragging');
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
		if (options.resize !== false && hadDrawerViewportSession) this.scheduleDrawerViewportUpdate('restore', restoreState);
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
			const headers = ':scope > .section > .section-header';
			sheet.querySelectorAll(headers).forEach(header => header.classList.add('mobile-sheet-drag-header', 'ui-ignore-gestures'));
			let suppressClick = false;
			sheet.addEventListener('click', event => {
				if (!suppressClick) return;
				suppressClick = false;
				event.preventDefault();
				event.stopImmediatePropagation();
			}, true);
			sheet.addEventListener('pointerdown', event => {
				if (!this.isMobile || this.getDrawerElement(this.activeDrawer) !== sheet || this.sheetDrag || event.button !== 0) return;
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
				if (!this.isMobile || this.getDrawerElement(this.activeDrawer) !== sheet) return;
				if (!['Escape', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
				event.preventDefault();
				if (event.key === 'Escape') this.closeAllDrawers({ releaseBrush: false });
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

	scheduleDrawerViewportUpdate(mode, restoreState = null) {
		this.cancelDrawerViewportUpdate();
		const update = () => {
			this.drawerLayoutFrame = null;
			this.drawerViewportSyncing = true;
			if (mode === 'restore' && restoreState) {
				this.editor.viewport?.restoreViewState?.(restoreState, { animate: true });
			} else {
				this.refitDrawerViewport();
			}
			this.drawerViewportLastZoom = this.editor.viewport?.currentZoom ?? null;
			this.drawerViewportSyncing = false;
			if (mode === 'restore') this.resetDrawerViewportSession();
		};
		// The bar layout's sheet and the canvas start in the same frame, so they
		// move as one. The room the sheet takes is already in the layout here.
		update();
	}

	cancelDrawerViewportUpdate() {
		if (this.drawerLayoutFrame) cancelAnimationFrame(this.drawerLayoutFrame);
		this.drawerLayoutFrame = null;
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
		this.syncPhoneHosts();
		this.editor.libraryWindow?.sync();
		this.barObserver.disconnect();
		cancelAnimationFrame(this.barFrame);
		document.querySelector('.mobile-bottom-nav')?.classList.remove('visible');
		document.getElementById('inspectorClose').classList.remove('visible');
		document.body.classList.remove('mobile-no-image', 'has-layer-settings', 'mobile-sheet-dragging', 'phone-bar');
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

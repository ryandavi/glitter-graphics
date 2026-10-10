const MODAL_METHODS = {
async ensureHtmlSceneExporter() {
		if (this.htmlSceneExporter) return this.htmlSceneExporter;
		await loadScriptOnce('js/export/HtmlSceneExporter.js?v=af19f59b');
		this.htmlSceneExporter = new HtmlSceneExporter(this);
		this.htmlSceneExporter.initialize();
		return this.htmlSceneExporter;
	}

,
updateOrientationButtons(width, height) {
		const portraitBtn = document.getElementById('orientationPortrait');
		const landscapeBtn = document.getElementById('orientationLandscape');

		if (!portraitBtn || !landscapeBtn) return;

		// A square canvas has no orientation: both options go inert.
		const isSquare = width === height;
		[[portraitBtn, height > width], [landscapeBtn, width > height]].forEach(([button, active]) => {
			button.disabled = isSquare;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
		});
	}

,
	setupModalListeners() {
		this.modalManager = new ModalManager();
		this.glitterRecolor = new GlitterRecolorController(this);

		// Simple modals (inline content)
		this.modalManager
			.register('shortcutsModal', {
				openBtnId: 'shortcutsBtn',
				closeBtnId: 'closeShortcutsModal',
				resetScrollOnOpen: true,
				initialFocusSelector: '#shortcutSearch',
				onOpen: () => this.shortcutsFilter?.reset()
			})
			.register('exportSettingsModal', {
				closeBtnId: ['closeExportSettingsModal', 'closeExportSettingsModalFooter'],
				resetScrollOnOpen: true,
				onOpen: () => {
					this.exportSettingsFilter?.reset();
					this.updateExportDuration();
					syncFieldReverts(document.getElementById('exportSettingsModal'));
				}
			})
			.register('settingsModal', {
				openBtnId: 'settingsBtn',
				closeBtnId: ['closeSettingsModal', 'closeSettingsModalFooter'],
				resetScrollOnOpen: true,
				onOpen: async () => {
					// Canvas controls write some of these switches without an event.
					syncFieldReverts(document.getElementById('settingsModal'));
					const htmlSceneExporter = await this.ensureHtmlSceneExporter();
					htmlSceneExporter.refreshStickerMetadata();
					this.settingsFilter?.refresh();
					this.settingsFilter?.reset();
				}
			})
			.register('exportPreviewModal', {
				closeBtnId: 'closeExportPreviewModal',
				resetScrollOnOpen: false,
				onClose: () => {
					document.getElementById('exportPreviewVideo')?.pause();
					this.exportResultPresenter?.clear();
				}
			})
			.register('confirmationModal', {
				layer: 'dialog',
				closeBtnId: 'confirmationModalClose',
				resetScrollOnOpen: false,
				initialFocusSelector: '#confirmationConfirmBtn',
				onClose: () => this.resolvePendingConfirmation(this.pendingConfirmationValue)
			});

		// Desktop rail shortcuts mirror the header menu actions so both entry
		// points share the same modal lifecycle and focus behavior.
		document.getElementById('toolbarShortcutsBtn')?.addEventListener('click', () => {
			document.getElementById('shortcutsBtn')?.click();
		});
		document.getElementById('toolbarSettingsBtn')?.addEventListener('click', () => {
			document.getElementById('settingsBtn')?.click();
		});

		this.registerDocumentModal('historyModal', { url: 'modals/history.html', references: 'ol#HistoryReferencesList' });
		this.registerDocumentModal('personalWebModal', { url: 'modals/personal-web.html', references: 'ol#PersonalWebReferencesList' });
		this.registerDocumentModal('preservationModal', {
			url: 'modals/preservation.html',
			onLoaded: async (body) => {
				await loadScriptOnce('js/generated/entities-data.js?v=b8b7d1f7');
				await loadScriptOnce('js/ui/about-timeline-data.js?v=c875b6a5');
				initPreservationTimeline(body);
			}
		});
		this.registerDocumentModal('aboutModal', {
			url: 'modals/about.html', references: 'ol#AboutReferencesList',
			onLoaded: (body) => this.renderVersionHistory(body)
		});
		this.registerDocumentModal('guideModal', { url: 'modals/guide.html', onLoaded: (body) => localizeKeyLabels(body) });

		// Layer type picker modal (no open button - opened programmatically)
		this.modalManager.register('layerTypePickerModal', {
			closeBtnId: 'closeLayerTypePickerModal',
			resetScrollOnOpen: false
		});

		// Stickers and fills share the image upload dialog.
		this.modalManager.register('stickerUploadModal', {
			openBtnId: 'uploadStickerBtn',
			closeBtnId: 'closeStickerUploadModal',
			resetScrollOnOpen: false,
			onOpen: () => {
				this.assetUploadLibrary = syncLibraryView() === 'glitter' ? this.glitterLibrary : this.stickerLibrary;
				const fill = this.assetUploadLibrary === this.glitterLibrary;
				if (fill && this.glitterRecolor.pickerSession) this.glitterRecolor.closePickerSession();
				const modal = document.getElementById('stickerUploadModal');
				const title = fill ? 'Upload fill tile' : 'Upload sticker';
				modal.querySelector('.modal-title-text').textContent = title;
				modal.querySelector('.modal-title .name').textContent = title;
				modal.querySelector('.modal-title use').setAttribute('href', '#icon-upload');
				modal.querySelector('.dropzone-icon use').setAttribute('href', '#icon-upload');
				modal.querySelector('.dropzone-icon .name').textContent = title;
				modal.querySelector('.dropzone-text').textContent = fill ? 'Drop fill tiles here or click to browse' : 'Drop stickers here or click to browse';
				const maxMB = CONFIG.tools.assetUpload.maxUploadSize / 1024 / 1024;
				modal.querySelector('.dropzone-subtext').textContent = `PNG, JPG, or GIF · Max ${maxMB}MB each${fill ? ' · Images repeat as fill tiles' : ''}`;
			}
		});

		// New canvas modal
		this.modalManager.register('newCanvasModal', {
			closeBtnId: ['closeNewCanvasModal', 'createCanvasCloseBtn'],
			resetScrollOnOpen: true,
			initialFocusSelector: '#newCanvasWidth',
			confirmOnEnter: true,
			enterActionSelector: '#createCanvasBtn',
			onOpen: () => this.initializeNewCanvasModal()
		});

		// Welcome modal opens from the header menu and the start card, and
		// automatically on load only while CONFIG.app.startup.showWelcome is on.
		this.modalManager.register('welcomeModal', {
			openBtnId: 'openWelcomeModal',
			closeBtnId: 'closeWelcomeModal',
			externalContentUrl: 'modals/welcome.html?v=34c08d90',
			cacheContent: true,
			showWhileLoading: true,
			loadingLabel: 'Preparing Glitter…',
			resetScrollOnOpen: false,
			onContentLoaded: (modalBody) => {
				initPixelScalerInContainer(modalBody);
				// Only the latest release earns a first-time reader's attention;
				// older ones are a click away instead of pushing past the fold.
				this.renderVersionHistory(modalBody, { limit: 1, openCount: 1 });
				this.setupWelcomeUpdatesActions(modalBody);
				this.setupWelcomeModalListeners();
				initTooltipsInContainer(modalBody);
			},
			onOpen: () => {
				const checked = !PREFERENCES.get('showWelcomeOnStartup');
				document.querySelectorAll('#welcomeDontShowAgain, #welcomeDontShowAgainMobile').forEach((checkbox) => {
					checkbox.checked = checked;
					checkbox.closest('.welcome-checkbox').hidden = !CONFIG.app.startup.showWelcome;
				});
			},
			onClose: () => {
				const checkbox = document.querySelector('#welcomeDontShowAgain, #welcomeDontShowAgainMobile');
				try {
					PREFERENCES.set('welcomeLastSeenRelease', CONFIG.app.currentRelease);
					PREFERENCES.set('showWelcomeOnStartup', !checkbox?.checked);
				} catch (e) {
					console.warn('Failed to save welcome modal preference:', e);
				}
			}
		});

		// A #modal= link (see openModalFromHash) replaces the startup welcome.
		if (!this.openModalFromHash()) this.checkWelcomeModal();
		this.watchModalSources();


		// Setup modal-specific interactions
		this.setupConfirmationModalListeners();
		this.setupLayerTypePickerListeners();
		this.setupLayerPanelListeners();
		this.setupStickerUploadModalListeners();
		this.setupNewCanvasModalListeners();
		this.setupAppMenu();
	}

,
	// The header "Menu" popover is a thin shell: its items keep the same ids the
	// ModalManager (and the toolbar action wiring for #clearAllTool) already bind
	// to, so this only owns open/close, focus, and dismissal of the panel.
	setupAppMenu() {
		const root = document.getElementById('appMenu');
		const trigger = document.getElementById('appMenuBtn');
		const panel = document.getElementById('appMenuPanel');
		setupMenuPopover({ root, trigger, panel });
		this.exportMenuPopover = setupMenuPopover({
			root: document.getElementById('exportMenu'),
			trigger: document.getElementById('exportMenuBtn'),
			panel: document.getElementById('exportMenuPanel')
		});
		setupMenuPopover({
			root: document.getElementById('exportResultMenu'),
			trigger: document.getElementById('exportResultMenuBtn'),
			panel: document.getElementById('exportResultMenuPanel')
		});
		this.setupViewMenu();
		this.setupStatusBar();

		// Any activated item runs its own handler (modal open, resetAll, …) — we
		// just dismiss the panel afterwards.
	}

,
	// The view toggles are one set of buttons with two presentations: an inline
	// row at desktop width, and a dropdown under one trigger when narrow. The
	// buttons keep their ids and listeners; this only owns the panel.
	setupViewMenu() {
		const root = document.getElementById('viewMenu');
		const trigger = document.getElementById('viewMenuBtn');
		const panel = document.getElementById('viewMenuPanel');
		const popover = setupMenuPopover({
			root, trigger, panel,
			liftHost: root?.closest('.preview-controls'),
			itemSelector: 'button:not([disabled])'
		});
		if (!popover) return;

		const narrow = matchMedia(`(max-width: ${CONFIG.ui.mobile.breakpoint}px)`);
		const syncPresentation = () => {
			popover.close();
			panel.hidden = narrow.matches;
		};
		narrow.addEventListener('change', syncPresentation);
		syncPresentation();

		// The closed menu hides every toggle's state, so the trigger carries a
		// marker whenever one differs from how the editor starts.
		const toggles = Array.from(panel.querySelectorAll('button'));
		const defaults = new Map(toggles.map((button) => [button, button.classList.contains('active')]));
		const syncMarker = () => trigger.classList.toggle('has-changes',
			toggles.some((button) => button.classList.contains('active') !== defaults.get(button)));
		new MutationObserver(syncMarker).observe(panel, { subtree: true, attributes: true, attributeFilter: ['class'] });
		syncMarker();
	}

,
renderVersionHistory(root, { limit = null, openCount = 0 } = {}) {
	const releases = limit == null ? CONFIG.app.releases : CONFIG.app.releases.slice(0, limit);

	root.querySelectorAll('[data-app-version]').forEach((slot) => {
		slot.textContent = CONFIG.app.version;
	});

	root.querySelectorAll('[data-version-history]').forEach((history) => {
		history.replaceChildren(...releases.map((release, index) =>
			this.buildVersionHistoryEntry(release, { open: index < openCount })));
		if (history.dataset.guideLinksBound !== 'true') {
			history.dataset.guideLinksBound = 'true';
			history.addEventListener('click', (event) => {
				const link = event.target.closest?.('[data-guide-anchor]');
				if (!link) return;
				event.preventDefault();
				this.openGuideAt(link.dataset.guideAnchor);
			});
		}
	});
}

,
// Each entry reuses the app's one "Advanced disclosure" primitive
// (`.advanced-disclosure` / `data-advanced-toggle`, see disclosures.js) so
// expand/collapse comes from the same delegated click handler every property
// panel already uses, instead of a modal-specific accordion.
buildVersionHistoryEntry(release, { open = false } = {}) {
	const entry = document.createElement('div');
	entry.className = 'advanced-disclosure version-history-entry';
	entry.dataset.advanced = '';
	if (open) entry.classList.add('is-open');

	const toggle = document.createElement('button');
	toggle.type = 'button';
	toggle.className = 'advanced-disclosure-toggle version-history-toggle';
	toggle.dataset.advancedToggle = '';
	toggle.setAttribute('aria-expanded', String(open));

	const header = document.createElement('span');
	header.className = 'version-history-header';
	const title = document.createElement('span');
	title.className = 'version-history-title';
	title.textContent = `v${release.version} — ${release.name}`;
	const date = document.createElement('time');
	date.dateTime = release.date;
	date.textContent = release.dateLabel;
	header.append(title, date);

	const chevron = document.createElement('span');
	chevron.className = 'advanced-disclosure-chevron icon-wrapper';
	chevron.innerHTML = '<svg class="icon"><use href="#icon-chevron-down"></use></svg>';

	toggle.append(header, chevron);
	entry.append(toggle);

	const content = document.createElement('div');
	content.className = 'advanced-disclosure-content version-history-content';
	content.dataset.advancedContent = '';

	if (release.image?.src) {
		const figure = document.createElement('figure');
		figure.className = 'version-history-image';
		const image = document.createElement('img');
		image.src = release.image.src;
		image.alt = release.image.alt || '';
		image.loading = 'lazy';
		image.decoding = 'async';
		figure.append(image);
		content.append(figure);
	}

	const summary = document.createElement('p');
	summary.textContent = release.summary;
	content.append(summary);

	const features = document.createElement('ul');
	features.append(...release.features.map((feature) => {
		// Older entries stored features as plain strings; treat those as additions.
		const { type = 'added', text = feature, guide = null } =
			typeof feature === 'string' ? {} : feature;

		const item = document.createElement('li');
		item.className = 'version-history-feature';

		const badge = document.createElement('span');
		badge.className = `badge version-history-badge is-${type}`;
		badge.textContent = type;
		item.append(badge, document.createTextNode(` ${text} `));

		if (guide) {
			const link = document.createElement('button');
			link.type = 'button';
			link.className = 'version-history-guide-link';
			link.dataset.guideAnchor = guide;
			link.textContent = 'Show me';
			item.append(link);
		}
		return item;
	}));
	content.append(features);

	if (release.projectFormat != null) {
		const note = document.createElement('p');
		note.className = 'version-history-format-note';
		note.textContent = `Saves project files in format version ${release.projectFormat}.`;
		content.append(note);
	}

	entry.append(content);
	return entry;
}

,
// Welcome keeps the latest release concise; the full history lives in About.
setupWelcomeUpdatesActions(modalBody) {
	const pastUpdatesBtn = modalBody.querySelector('[data-welcome-past-updates]');

	if (pastUpdatesBtn) {
		pastUpdatesBtn.addEventListener('click', () => this.openDocumentAt('aboutModal', 'AboutVersionHistory'));
	}
}

,
// index.html#modal=history&at=HistoryMicasTile opens a document modal at a
// heading, so a writer can jump straight to the paragraph being edited.
openModalFromHash() {
	const params = new URLSearchParams(location.hash.slice(1));
	const name = params.get('modal');
	if (!name || !/^[a-z0-9-]+$/.test(name)) return false;
	const config = [...this.modalManager.modals.values()].find(entry => entry.externalContentUrl?.startsWith(`modals/${name}.html`));
	if (!config) return false;
	this.openDocumentAt(config.id, params.get('at'));
	return true;
}

,
// On localhost only: while a document modal is open, re-render it in place
// when its generated file changes (node tools/build-modals.js --watch), keeping
// the scroll position. Production never polls.
watchModalSources() {
	if (!['localhost', '127.0.0.1'].includes(location.hostname)) return;
	window.setInterval(async () => {
		if (document.visibilityState !== 'visible') return;
		const config = [...this.modalManager.modals.values()].find(entry => entry.externalContentUrl && entry.contentLoaded && entry.modal.classList.contains('visible'));
		if (!config) return;
		try {
			const response = await fetch(config.externalContentUrl.replace(/\?.*$/, ''), { cache: 'no-store' });
			if (!response.ok) return;
			const html = await response.text();
			if (html === config.cachedContent) return;
			const modalBody = config.modal.querySelector('.modal-body');
			const scrollTop = modalBody.scrollTop;
			config.cachedContent = html;
			modalBody.innerHTML = html;
			// Navigation binds once per modal; a fresh copy lets it index the new headings.
			const nav = config.modal.querySelector('.document-nav');
			if (nav) {
				const fresh = nav.cloneNode(true);
				delete fresh.dataset.initialized;
				nav.replaceWith(fresh);
			}
			if (config.onContentLoaded) await config.onContentLoaded(modalBody);
			modalBody.scrollTop = scrollTop;
			dbg(`Reloaded ${config.id} from source`);
		} catch (error) {
			dbg('Modal live reload failed:', error);
		}
	}, 1500);
}

,
async openGuideAt(anchor) {
	return this.openDocumentAt('guideModal', anchor);
}

,
// Shared by the Guide and About deep links: open() closes whatever is
// showing and awaits the target modal's external content, so the anchored
// section exists by the time we scroll to it.
async openDocumentAt(modalId, anchor) {
	await this.modalManager.open(modalId);
	if (!anchor) return;
	const target = document.getElementById(modalId)?.querySelector(`#${CSS.escape(anchor)}`);
	if (!target) {
		dbg(`Document anchor not found: ${anchor} in ${modalId}`);
		return;
	}
	requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

,
async checkWelcomeModal() {

	if (!CONFIG.app.startup.showWelcome) {
		this.syncWhatsNewMarker();
		return;
	}

	try {
		const lastSeenRelease = PREFERENCES.get('welcomeLastSeenRelease');
		const showOnStartup = PREFERENCES.get('showWelcomeOnStartup');
		const hasUnseenRelease = lastSeenRelease !== CONFIG.app.currentRelease;
		
		if (showOnStartup || hasUnseenRelease) {
			await this.modalManager.open('welcomeModal');

			// Warm the guide after the welcome screen is visible so startup never
			// waits on content the user has not requested yet.
			const guideConfig = this.modalManager.modals.get('guideModal');
			if (guideConfig && guideConfig.externalContentUrl) {
				this.modalManager.loadExternalContent(guideConfig).catch((error) => dbg('Guide preload failed:', error));
			}
		}
	} catch (e) {
		console.warn('Failed to check welcome modal status:', e);
	}
}

,
setupWelcomeModalListeners() {
	
	const takeTourBtn = document.getElementById('welcomeTakeTourBtn');
	const startCreatingBtn = document.getElementById('welcomeStartCreatingBtn');
	const dontShowCheckbox = document.getElementById('welcomeDontShowAgain');
	const dontShowMobileCheckbox = document.getElementById('welcomeDontShowAgainMobile');
	if (takeTourBtn?.dataset.welcomeBound === 'true') return;
	if (takeTourBtn) takeTourBtn.dataset.welcomeBound = 'true';
	if (startCreatingBtn) startCreatingBtn.dataset.welcomeBound = 'true';

	[dontShowCheckbox, dontShowMobileCheckbox].filter(Boolean).forEach((checkbox) => {
		checkbox.addEventListener('change', () => {
			[dontShowCheckbox, dontShowMobileCheckbox].filter(Boolean).forEach((peer) => {
				peer.checked = checkbox.checked;
			});
		});
	});
	
	const markAsSeenIfChecked = () => {
		if (dontShowCheckbox?.checked || dontShowMobileCheckbox?.checked) {
			try {
				PREFERENCES.set('showWelcomeOnStartup', false);
				this.saveSettingsToStorage();
			} catch (e) {
				console.warn('Failed to save welcome modal preference:', e);
			}
		}
	};
	
	if (takeTourBtn) {
		takeTourBtn.addEventListener('click', () => {
			markAsSeenIfChecked();
			this.modalManager.open('guideModal', { resetScroll: true });
		});
	}
	
	if (startCreatingBtn) {
		startCreatingBtn.addEventListener('click', () => {
			markAsSeenIfChecked();
			this.modalManager.close('welcomeModal');
		});
	}
}

,
	setupConfirmationModalListeners() {
		document.querySelector('#confirmationModal .modal-footer').addEventListener('click', (event) => {
			const button = event.target.closest('[data-dialog-action]');
			if (!button) return;
			this.pendingConfirmationValue = button.dataset.dialogAction;
			this.modalManager.close('confirmationModal');
		});
	}

,
	resolvePendingConfirmation(value) {
		const resolve = this.pendingConfirmationResolve;
		this.pendingConfirmationResolve = null;
		this.pendingConfirmationValue = null;
		resolve?.(value ?? null);
	}

,
	confirmAction(options = {}) {
		if (options.skippable && PREFERENCES.get('confirmDestructiveActions') === false) return Promise.resolve(true);
		return this.chooseAction({
			...options,
			actions: [
				{ id: 'cancel', label: options.cancelLabel || 'Cancel' },
				{ id: 'confirm', label: options.confirmLabel || 'Confirm', tone: options.tone, primary: true }
			]
		}).then(value => value === 'confirm');
	}

,
	chooseAction(options = {}) {
		const {
			title = 'Confirm',
			message = 'Are you sure?',
			subject = null,
			facts = [],
			tone = 'default',
			skippable = false,
			actions,
			details = [],
			outro = ''
		} = options;

		if (this.pendingConfirmationResolve) {
			this.resolvePendingConfirmation(null);
		}

		const titleNode = document.getElementById('confirmationModalTitle');
		const messageNode = document.getElementById('confirmationModalMessage');
		const modal = document.getElementById('confirmationModal');
		const footer = modal.querySelector('.modal-footer');
		const buttons = actions.map((action, index) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.dataset.dialogAction = action.id;
			button.id = action.id === 'confirm' ? 'confirmationConfirmBtn' : action.id === 'cancel' ? 'confirmationCancelBtn' : `confirmationAction${index}`;
			button.textContent = action.label;
			button.className = actions.length > 2 && !action.primary && action.id !== 'cancel'
				? 'btn-text' : `btn-text-with-icon modal-action ${action.primary ? 'primary' : 'secondary'}`;
			button.classList.toggle('modal-action-danger', action.tone === 'danger');
			return button;
		});
		footer.replaceChildren(...buttons.filter(button => button.classList.contains('btn-text')),
			...buttons.filter(button => !button.classList.contains('btn-text') && !button.classList.contains('primary')),
			...buttons.filter(button => button.classList.contains('primary')));
		modal.querySelector('.modal-icon use').setAttribute('href', tone === 'danger' ? '#icon-triangle-exclamation' : '#icon-circle-info');
		const config = this.modalManager.modals.get('confirmationModal');
		const safeFocus = tone === 'danger' && !skippable;
		const initial = safeFocus ? buttons.find(button => button.dataset.dialogAction === 'cancel') : buttons.find(button => button.classList.contains('primary'));
		config.initialFocusSelector = `#${(initial || buttons[0]).id}`;
		config.dialogEnterSelector = safeFocus ? null : config.initialFocusSelector;

		if (titleNode) titleNode.textContent = title;
		if (messageNode) {
			messageNode.replaceChildren();
			const copy = document.createElement('p');
			copy.className = 'confirmation-message-copy';
			copy.textContent = message;
			messageNode.appendChild(copy);
			if (subject?.value) {
				const subjectNode = document.createElement('div');
				subjectNode.className = 'confirmation-subject';
				const subjectLabel = document.createElement('span');
				subjectLabel.className = 'confirmation-subject-label';
				subjectLabel.textContent = subject.label || 'Item';
				const subjectValue = document.createElement('strong');
				subjectValue.className = 'confirmation-subject-value';
				subjectValue.textContent = subject.value;
				subjectNode.append(subjectLabel, subjectValue);
				messageNode.appendChild(subjectNode);
			}
			if (facts.length) {
				const factList = document.createElement('dl');
				factList.className = 'confirmation-facts';
				facts.forEach((fact) => {
					const row = document.createElement('div');
					const label = document.createElement('dt');
					label.textContent = fact.label;
					const value = document.createElement('dd');
					value.textContent = fact.value;
					row.append(label, value);
					factList.appendChild(row);
				});
				messageNode.appendChild(factList);
			}
			if (details.length) {
				const list = document.createElement('ul');
				list.className = 'confirmation-detail-list';
				details.forEach((detail) => {
					const item = document.createElement('li');
					item.textContent = detail;
					list.appendChild(item);
				});
				messageNode.appendChild(list);
			}
			if (outro) {
				const footerCopy = document.createElement('p');
				footerCopy.className = 'confirmation-message-outro';
				footerCopy.textContent = outro;
				messageNode.appendChild(footerCopy);
			}
		}
		this.pendingConfirmationValue = null;

		return new Promise((resolve) => {
			this.pendingConfirmationResolve = resolve;
			if (this.modalManager.getTopOpenModalConfig() === config) this.modalManager.focusInitialElement(config);
			else this.modalManager.open('confirmationModal');
		});
	}

,
	registerDocumentModal(id, { url, references, onLoaded }) {
		const name = id.slice(0, -5);
		this.modalManager.register(id, {
			openBtnId: `${name}Btn`,
			closeBtnId: `close${id[0].toUpperCase()}${id.slice(1)}`,
			externalContentUrl: url,
			resetScrollOnOpen: false,
			rememberScroll: true,
			onContentLoaded: async (body) => {
				if (onLoaded) await onLoaded(body);
				initPixelScalerInContainer(body);
				if (references) initModalReferences(body, { referenceListSelector: references });
				initModalCrossLinks(body, (modalId, anchor) => this.openDocumentAt(modalId, anchor));
				const modal = document.getElementById(id);
				initDocumentModalNavigation(modal);
				initModalSmoothScroll(modal);
				initTooltipsInContainer(body);
			}
		});
	}
};

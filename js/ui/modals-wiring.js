const MODAL_METHODS = {
updateOrientationButtons(width, height) {
		const portraitBtn = document.getElementById('orientationPortrait');
		const landscapeBtn = document.getElementById('orientationLandscape');

		if (!portraitBtn || !landscapeBtn) return;

		// Check if square
		const isSquare = width === height;

		// Disable buttons if square
		portraitBtn.disabled = isSquare;
		landscapeBtn.disabled = isSquare;

		// Remove active from both
		portraitBtn.classList.remove('active');
		landscapeBtn.classList.remove('active');

		// Only set active state if not square
		if (!isSquare) {
			if (height > width) {
				portraitBtn.classList.add('active');
			} else if (width > height) {
				landscapeBtn.classList.add('active');
			}
		}
	}

,
	setupModalListeners() {
		this.modalManager = new ModalManager();

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
				openBtnId: 'exportSettingsBtn',
				closeBtnId: ['closeExportSettingsModal', 'closeExportSettingsModalFooter'],
				resetScrollOnOpen: true,
				onOpen: () => {
					this.exportSettingsFilter?.reset();
					this.updateExportDuration();
				}
			})
			.register('settingsModal', {
				openBtnId: 'settingsBtn',
				closeBtnId: ['closeSettingsModal', 'closeSettingsModalFooter'],
				resetScrollOnOpen: true,
				onOpen: () => {
					this.htmlSceneExporter?.refreshStickerMetadata();
					this.settingsFilter?.refresh();
					this.settingsFilter?.reset();
				}
			})
			.register('exportPreviewModal', {  // ADD THIS
				closeBtnId: 'closeExportPreviewModal',
				resetScrollOnOpen: false
			})
			.register('confirmationModal', {
				closeBtnId: ['confirmationModalClose', 'confirmationCancelBtn'],
				resetScrollOnOpen: false,
				initialFocusSelector: '#confirmationConfirmBtn',
				confirmOnEnter: true,
				enterActionSelector: '#confirmationConfirmBtn',
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

		// External content modals use the shared document-modal helpers.
		this.modalManager
			.register('aboutModal', {
				openBtnId: 'aboutBtn',
				closeBtnId: 'closeAboutModal',
				externalContentUrl: 'modals/about.html?v=8',
				cacheContent: true,
				resetScrollOnOpen: false,
				rememberScroll: true,
				onContentLoaded: (modalBody) => {
					this.renderVersionHistory(modalBody);
					// Initialize pixel-scaled images
					initPixelScalerInContainer(modalBody);

					// Initialize references (sup ↔ reference list interaction)
					initModalReferences(modalBody, {
						referenceListSelector: 'ol#AboutReferencesList'
					});

					const modal = document.getElementById('aboutModal');
					initDocumentModalNavigation(modal);
					initModalSmoothScroll(modal);

					// Initialize tooltips for dynamically loaded content
					initTooltipsInContainer(modalBody);


				}
			})
			.register('guideModal', {
				openBtnId: 'guideBtn',
				closeBtnId: 'closeGuideModal',
				externalContentUrl: 'modals/guide.html?v=35dcc985',
				cacheContent: true,
				resetScrollOnOpen: false,
				rememberScroll: true,
				onContentLoaded: (modalBody) => {
					// Initialize pixel-scaled images (for screenshots)
					initPixelScalerInContainer(modalBody);

					// The guide's key names are authored generically ('Ctrl/Cmd');
					// resolve them to this platform's labels, as the shortcuts modal does.
					localizeKeyLabels(modalBody);

					const modal = document.getElementById('guideModal');
					initDocumentModalNavigation(modal);
					initModalSmoothScroll(modal);
				}
			});




		// Layer type picker modal (no open button - opened programmatically)
		this.modalManager.register('layerTypePickerModal', {
			closeBtnId: 'closeLayerTypePickerModal',
			resetScrollOnOpen: false
		});

		// Sticker upload modal - ONLY uploadStickerBtn opens this
		this.modalManager.register('stickerUploadModal', {
			openBtnId: 'uploadStickerBtn',
			closeBtnId: 'closeStickerUploadModal',
			resetScrollOnOpen: false
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

		// Welcome modal is shown automatically and remains available from the header.
		this.modalManager.register('welcomeModal', {
			openBtnId: 'openWelcomeModal',
			closeBtnId: 'closeWelcomeModal',
			externalContentUrl: 'modals/welcome.html?v=4',
			cacheContent: true,
			showWhileLoading: true,
			loadingLabel: 'Preparing Glitter…',
			resetScrollOnOpen: false,
			onContentLoaded: (modalBody) => {
				initPixelScalerInContainer(modalBody);
				this.renderVersionHistory(modalBody, 2);
				this.setupWelcomeModalListeners();
			},
			onOpen: () => {
				const checked = !this.showWelcomeOnStartup;
				document.querySelectorAll('#welcomeDontShowAgain, #welcomeDontShowAgainMobile').forEach((checkbox) => {
					checkbox.checked = checked;
				});
			},
			onClose: () => {
				const checkbox = document.querySelector('#welcomeDontShowAgain, #welcomeDontShowAgainMobile');
				try {
					localStorage.setItem('glitterEditor_welcomeLastSeenRelease', CONFIG.app.currentRelease);
					if (checkbox?.checked) {
						localStorage.setItem('glitterEditor_welcomeModalSeen', 'true');
						this.showWelcomeOnStartup = false;
					} else {
						localStorage.removeItem('glitterEditor_welcomeModalSeen');
						this.showWelcomeOnStartup = true;
					}
					this.saveSettingsToStorage();
				} catch (e) {
					console.warn('Failed to save welcome modal preference:', e);
				}
			}
		});

		// Check if should show welcome modal on page load
		this.checkWelcomeModal();


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
		if (!root || !trigger || !panel) return;

		const isOpen = () => !panel.hidden;

		const close = ({ focusTrigger = false } = {}) => {
			if (!isOpen()) return;
			panel.hidden = true;
			root.classList.remove('is-open');
			trigger.setAttribute('aria-expanded', 'false');
			document.removeEventListener('keydown', onKeydown, true);
			document.removeEventListener('pointerdown', onPointerDown, true);
			if (focusTrigger) trigger.focus();
		};

		const open = () => {
			if (isOpen()) return;
			panel.hidden = false;
			root.classList.add('is-open');
			trigger.setAttribute('aria-expanded', 'true');
			document.addEventListener('keydown', onKeydown, true);
			document.addEventListener('pointerdown', onPointerDown, true);
			const first = panel.querySelector('.app-menu-item:not([disabled])');
			first?.focus();
		};

		function onPointerDown(event) {
			if (!root.contains(event.target)) close();
		}

		function onKeydown(event) {
			if (event.key === 'Escape') {
				event.stopPropagation();
				close({ focusTrigger: true });
				return;
			}
			if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
			const items = Array.from(panel.querySelectorAll('.app-menu-item:not([disabled])'));
			if (!items.length) return;
			event.preventDefault();
			const current = items.indexOf(document.activeElement);
			const step = event.key === 'ArrowDown' ? 1 : -1;
			const next = (current + step + items.length) % items.length;
			items[next].focus();
		}

		trigger.addEventListener('click', () => (isOpen() ? close() : open()));
		document.getElementById('mobileExportSettingsBtn')?.addEventListener('click', () => {
			document.getElementById('exportSettingsBtn')?.click();
		});

		// Any activated item runs its own handler (modal open, resetAll, …) — we
		// just dismiss the panel afterwards.
		panel.addEventListener('click', (event) => {
			if (event.target.closest('.app-menu-item')) close();
		});
	}

,
renderVersionHistory(root, limit = null) {
	const releases = limit == null ? CONFIG.app.releases : CONFIG.app.releases.slice(0, limit);

	root.querySelectorAll('[data-app-version]').forEach((slot) => {
		slot.textContent = CONFIG.app.version;
	});

	root.querySelectorAll('[data-version-history]').forEach((history) => {
		history.replaceChildren(...releases.map((release) => this.buildVersionHistoryEntry(release)));
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
buildVersionHistoryEntry(release) {
	const entry = document.createElement('section');
	entry.className = 'version-history-entry';

	const header = document.createElement('div');
	header.className = 'version-history-header';
	const title = document.createElement('h4');
	title.textContent = `v${release.version} — ${release.name}`;
	const date = document.createElement('time');
	date.dateTime = release.date;
	date.textContent = release.dateLabel;
	header.append(title, date);
	entry.append(header);

	if (release.image?.src) {
		const figure = document.createElement('figure');
		figure.className = 'version-history-image';
		const image = document.createElement('img');
		image.src = release.image.src;
		image.alt = release.image.alt || '';
		image.loading = 'lazy';
		image.decoding = 'async';
		figure.append(image);
		entry.append(figure);
	}

	const summary = document.createElement('p');
	summary.textContent = release.summary;
	entry.append(summary);

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
	entry.append(features);

	if (release.projectFormat != null) {
		const note = document.createElement('p');
		note.className = 'version-history-format-note';
		note.textContent = `Saves project files in format version ${release.projectFormat}.`;
		entry.append(note);
	}

	return entry;
}

,
async openGuideAt(anchor) {
	// open() closes whatever is showing and awaits the guide's external content,
	// so the target section exists by the time we scroll to it.
	await this.modalManager.open('guideModal');
	if (!anchor) return;
	const target = document.getElementById('guideModal')?.querySelector(`#${CSS.escape(anchor)}`);
	if (!target) {
		dbg(`Guide anchor not found: ${anchor}`);
		return;
	}
	requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

,
async checkWelcomeModal() {
	const storageKey = 'glitterEditor_welcomeModalSeen';
	
	try {
		const isSuppressed = localStorage.getItem(storageKey) === 'true';
		const lastSeenRelease = localStorage.getItem('glitterEditor_welcomeLastSeenRelease');
		const showOnStartup = this.showWelcomeOnStartup ?? !isSuppressed;
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
	const storageKey = 'glitterEditor_welcomeModalSeen';
	
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
				localStorage.setItem(storageKey, 'true');
				this.showWelcomeOnStartup = false;
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
		const confirmBtn = document.getElementById('confirmationConfirmBtn');
		if (confirmBtn) {
			confirmBtn.addEventListener('click', () => {
				this.pendingConfirmationValue = true;
				this.modalManager.close('confirmationModal');
			});
		}
	}

,
	resolvePendingConfirmation(value) {
		if (!this.pendingConfirmationResolve) {
			this.pendingConfirmationValue = false;
			return;
		}

		const resolve = this.pendingConfirmationResolve;
		this.pendingConfirmationResolve = null;
		this.pendingConfirmationValue = false;
		resolve(Boolean(value));
	}

,
	confirmAction(options = {}) {
		const {
			title = 'Confirm',
			message = 'Are you sure?',
			subject = null,
			facts = [],
			confirmLabel = 'Confirm',
			cancelLabel = 'Cancel',
			destructive = false,
			details = [],
			outro = ''
		} = options;

		if (destructive && this.confirmDestructiveActions === false) {
			return Promise.resolve(true);
		}

		if (!this.modalManager || !document.getElementById('confirmationModal')) {
			return Promise.resolve(confirm(message));
		}

		if (this.pendingConfirmationResolve) {
			this.resolvePendingConfirmation(false);
		}

		const titleNode = document.getElementById('confirmationModalTitle');
		const messageNode = document.getElementById('confirmationModalMessage');
		const confirmBtn = document.getElementById('confirmationConfirmBtn');
		const cancelBtn = document.getElementById('confirmationCancelBtn');

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
		if (confirmBtn) confirmBtn.textContent = confirmLabel;
		confirmBtn?.classList.toggle('modal-action-danger', destructive);
		if (cancelBtn) cancelBtn.textContent = cancelLabel;

		this.pendingConfirmationValue = false;

		return new Promise((resolve) => {
			this.pendingConfirmationResolve = resolve;
			this.modalManager.open('confirmationModal');
		});
	}

,
	alertAction(options = {}) {
		const {
			title = 'Notice',
			message = ''
		} = options;

		if (!this.modalManager || !document.getElementById('confirmationModal')) {
			alert(message);
			return Promise.resolve();
		}

		const cancelBtn = document.getElementById('confirmationCancelBtn');
		if (cancelBtn) cancelBtn.style.display = 'none';

		return this.confirmAction({ title, message, confirmLabel: 'OK' }).then(() => {
			if (cancelBtn) cancelBtn.style.display = '';
		});
	}
};

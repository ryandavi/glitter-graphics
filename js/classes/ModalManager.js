// ============================================
// MODAL MANAGER CLASS
// Handles all modal-related operations
// ============================================
class ModalManager {
	constructor() {
		this.modals = new Map();
		this.historyStateKey = 'glitterModal';
		this.setupGlobalListeners();
	}

/**
 * Register a modal with the manager
 *
 * @param {string} id - Modal element ID
 * @param {Object} options - Configuration
 * @param {string|string[]} options.openBtnId - ID(s) of buttons that open modal
 * @param {string|string[]} options.closeBtnId - ID(s) of button(s) that close modal
 * @param {Function} options.onOpen - Callback when modal opens
 * @param {Function} options.onClose - Callback when modal closes
 * @param {boolean} options.closeOnOutsideClick - Close when clicking overlay (default: true)
 * @param {boolean} options.closeOnEscape - Close on Escape key (default: true)
 * @param {string} options.externalContentUrl - URL to load content from
 * @param {boolean} options.cacheContent - Cache loaded content (default: true)
 * @param {boolean} options.resetScrollOnOpen - Reset scroll to top on open (default: true)
 * @param {boolean} options.resetScrollOnClose - Reset scroll to top on close (default: false)
 * @param {boolean} options.rememberScroll - Restore the previous body position when reopened
 * @param {Function} options.onContentLoaded - Callback after external content loads
 * @returns {ModalManager} - For chaining
 */
	register(id, options = {}) {
		const modal = document.getElementById(id);
		if (!modal) {
			console.warn(`Modal not found: ${id}`);
			return this;
		}

		const closeBtnIds = Array.isArray(options.closeBtnId)
			? options.closeBtnId
			: (options.closeBtnId ? [options.closeBtnId] : []);
		const openBtnIds = Array.isArray(options.openBtnId)
			? options.openBtnId
			: (options.openBtnId ? [options.openBtnId] : []);

		const config = {
			id,
			modal,
			content: modal.querySelector(':scope > .modal-content'),
			openButtons: openBtnIds.map(buttonId => document.getElementById(buttonId)).filter(Boolean),
			closeButtons: closeBtnIds.map(buttonId => document.getElementById(buttonId)).filter(Boolean),
			onOpen: options.onOpen || null,
			onClose: options.onClose || null,
			closeOnOutsideClick: options.closeOnOutsideClick !== false,
			closeOnEscape: options.closeOnEscape !== false,
			externalContentUrl: options.externalContentUrl || null,
			cacheContent: options.cacheContent !== false,
			showWhileLoading: options.showWhileLoading === true,
			loadingLabel: options.loadingLabel || 'Loadingâ€¦',
			contentLoaded: false,
			cachedContent: null,
			resetScrollOnOpen: options.resetScrollOnOpen !== false,
			resetScrollOnClose: options.resetScrollOnClose || false,
			rememberScroll: options.rememberScroll === true,
			savedScrollTop: 0,
			onContentLoaded: options.onContentLoaded || null,
			initialFocusSelector: options.initialFocusSelector || null,
			confirmOnEnter: options.confirmOnEnter || false,
			enterActionSelector: options.enterActionSelector || null,
			previouslyFocused: null,
			backgroundState: []
		};

		this.modals.set(id, config);
		this.setupAccessibility(config);
		this.setupModalListeners(config);
		this.observeVisibility(config);

		return this;
	}

	setupAccessibility(config) {
		const { id, modal, content, closeButtons } = config;
		if (!content) return;

		const title = content.querySelector('.modal-title-text');
		if (title) {
			if (!title.id) title.id = `${id}Title`;
			title.tabIndex = -1;
			content.setAttribute('aria-labelledby', title.id);
		}

		content.setAttribute('role', 'dialog');
		content.setAttribute('aria-modal', 'true');
		modal.setAttribute('aria-hidden', 'true');
		closeButtons.forEach(button => button.setAttribute('aria-label', 'Close'));
	}

	setupModalListeners(config) {
		const { modal, openButtons, closeButtons, closeOnOutsideClick } = config;

		openButtons.forEach(openButton => {
			openButton.addEventListener('click', () => this.open(config.id, {
				restoreFocusTarget: openButton
			}));
		});

		closeButtons.forEach(closeButton => {
			closeButton.addEventListener('click', () => this.close(config.id));
		});

		if (closeOnOutsideClick) {
			modal.addEventListener('click', (event) => {
				if (event.target === modal) this.close(config.id);
			});
		}
	}

	observeVisibility(config) {
		const observer = new MutationObserver(() => {
			const isVisible = config.modal.classList.contains('visible');
			config.modal.setAttribute('aria-hidden', String(!isVisible));

			if (!isVisible && config.backgroundState.length) {
				this.restoreBackground(config);
				if (!this.isAnyOpen()) document.body.classList.remove('modal-open');
			}
		});

		observer.observe(config.modal, {
			attributes: true,
			attributeFilter: ['class']
		});
	}

	setupGlobalListeners() {
		document.addEventListener('keydown', (event) => {
			const config = this.getTopOpenModalConfig();
			if (!config) return;

			if (event.key === 'Escape' && config.closeOnEscape) {
				event.preventDefault();
				event.stopImmediatePropagation();
				this.close(config.id);
				return;
			}

			if (event.key === 'Tab') {
				this.trapFocus(event, config);
				return;
			}

			if (event.key === 'Enter') this.handleEnterKey(event);
		});

		window.addEventListener('popstate', (event) => {
			const requestedId = event.state?.[this.historyStateKey] || null;
			const openConfig = this.getTopOpenModalConfig();

			if (openConfig && requestedId !== openConfig.id) {
				this.close(openConfig.id, { fromHistory: true });
			}

			if (requestedId && this.modals.has(requestedId) && !this.modals.get(requestedId).modal.classList.contains('visible')) {
				this.open(requestedId, { fromHistory: true });
			}
		});
	}

	async open(id, options = {}) {
		const config = this.modals.get(id);
		if (!config) {
			console.warn(`Cannot open unregistered modal: ${id}`);
			return;
		}

		const activeModal = document.activeElement?.closest?.('.modal-overlay');
		const activeConfig = activeModal ? this.modals.get(activeModal.id) : null;
		config.previouslyFocused = options.restoreFocusTarget
			|| activeConfig?.previouslyFocused
			|| (document.activeElement instanceof HTMLElement ? document.activeElement : null);

		this.closeAll({ preserveHistory: true, restoreFocus: false });

		if (config.externalContentUrl) {
			if (config.showWhileLoading) this.showModal(config);
			await this.loadExternalContent(config);
		}

		this.showModal(config);

		const shouldResetScroll = options.resetScroll === true
			|| (options.resetScroll !== false && config.resetScrollOnOpen && !config.rememberScroll);
		if (shouldResetScroll) {
			this.resetScroll(config);
		} else if (config.rememberScroll) {
			this.restoreScroll(config);
		}

		if (!options.fromHistory) this.pushModalHistory(id);

		if (config.onOpen) config.onOpen();
		this.focusInitialElement(config);
	}

	showModal(config) {
		config.modal.classList.add('visible');
		config.modal.setAttribute('aria-hidden', 'false');
		document.body.classList.add('modal-open');
		this.setBackgroundInert(config);
	}

	close(id, options = {}) {
		const config = this.modals.get(id);
		if (!config) {
			console.warn(`Cannot close unregistered modal: ${id}`);
			return false;
		}
		if (!config.modal.classList.contains('visible')) return false;

		const modalBody = config.modal.querySelector('.modal-body');
		if (modalBody) {
			const currentScrollTop = modalBody.scrollTop;
			this.setScrollPosition(modalBody, currentScrollTop);
			if (config.rememberScroll) config.savedScrollTop = currentScrollTop;
		}

		config.modal.classList.remove('visible');
		config.modal.setAttribute('aria-hidden', 'true');
		this.restoreBackground(config);

		if (config.resetScrollOnClose) this.resetScroll(config);
		if (config.onClose) config.onClose();

		if (!this.isAnyOpen()) document.body.classList.remove('modal-open');
		if (options.restoreFocus !== false) this.restoreFocus(config);
		if (!options.fromHistory && !options.preserveHistory) this.popModalHistory(id);

		return true;
	}

	async loadExternalContent(config) {
		if (config.cacheContent && config.contentLoaded) return;

		const modalBody = config.modal.querySelector('.modal-body');
		if (!modalBody) {
			console.warn(`No .modal-body found in modal: ${config.id}`);
			return;
		}

		try {
			const loading = document.createElement('div');
			loading.className = 'modal-loading';
			loading.setAttribute('role', 'status');
			loading.textContent = config.loadingLabel;
			modalBody.replaceChildren(loading);

			const response = await fetch(config.externalContentUrl);
			if (!response.ok) throw new Error(`Failed to load: ${response.status}`);

			const html = await response.text();
			if (config.cacheContent) {
				config.cachedContent = html;
				config.contentLoaded = true;
			}

			modalBody.innerHTML = html;
			if (config.onContentLoaded) config.onContentLoaded(modalBody);
		} catch (error) {
			console.error(`Error loading modal content for ${config.id}:`, error);
			modalBody.innerHTML = `<div class="modal-error">Failed to load content. Please try again.</div>`;
		}
	}

	resetScroll(config) {
		const modalBody = config.modal.querySelector('.modal-body');
		if (modalBody) this.setScrollPosition(modalBody, 0);
		config.savedScrollTop = 0;
	}

	restoreScroll(config) {
		const modalBody = config.modal.querySelector('.modal-body');
		if (modalBody) this.setScrollPosition(modalBody, config.savedScrollTop);
	}

	setScrollPosition(element, scrollTop) {
		const scrollBehavior = element.style.scrollBehavior;
		const token = (element.modalScrollToken || 0) + 1;
		element.modalScrollToken = token;
		element.style.setProperty('scroll-behavior', 'auto', 'important');
		element.scrollTo({ top: scrollTop, left: element.scrollLeft, behavior: 'auto' });
		element.scrollTop = scrollTop;

		requestAnimationFrame(() => {
			if (element.modalScrollToken !== token) return;
			if (scrollBehavior) element.style.scrollBehavior = scrollBehavior;
			else element.style.removeProperty('scroll-behavior');
		});
	}

	async reloadContent(id) {
		const config = this.modals.get(id);
		if (!config || !config.externalContentUrl) return;

		config.contentLoaded = false;
		config.cachedContent = null;
		await this.loadExternalContent(config);
	}

	closeTopModal() {
		const config = this.getTopOpenModalConfig();
		if (!config?.closeOnEscape) return false;
		return this.close(config.id);
	}

	closeAll(options = {}) {
		for (const config of this.modals.values()) {
			if (config.modal.classList.contains('visible')) {
				this.close(config.id, {
					preserveHistory: options.preserveHistory === true,
					restoreFocus: options.restoreFocus !== false
				});
			}
		}
	}

	handleEnterKey(event) {
		const config = this.getTopOpenModalConfig();
		if (!config?.confirmOnEnter) return;

		const target = event.target;
		if (target instanceof HTMLElement) {
			const tagName = target.tagName;
			if (tagName === 'TEXTAREA' || target.isContentEditable) return;
		}

		const actionSelector = config.enterActionSelector || config.initialFocusSelector;
		if (!actionSelector) return;

		const actionElement = config.modal.querySelector(actionSelector);
		if (!(actionElement instanceof HTMLElement) || actionElement.hasAttribute('disabled')) return;

		event.preventDefault();
		actionElement.click();
	}

	focusInitialElement(config) {
		requestAnimationFrame(() => {
			const selector = config.initialFocusSelector || '.modal-title-text';
			const focusTarget = config.modal.querySelector(selector);
			if (!(focusTarget instanceof HTMLElement) || focusTarget.hasAttribute('disabled')) return;

			focusTarget.focus({ preventScroll: true });
			if (typeof focusTarget.select === 'function' && focusTarget.matches('input, textarea')) {
				focusTarget.select();
			}
		});
	}

	restoreFocus(config) {
		requestAnimationFrame(() => {
			const focusTarget = config.previouslyFocused;
			if (!(focusTarget instanceof HTMLElement) || !focusTarget.isConnected) return;
			if (focusTarget.closest('.modal-overlay')) return;
			focusTarget.focus({ preventScroll: true });
		});
	}

	trapFocus(event, config) {
		const focusable = this.getFocusableElements(config.content);
		if (!focusable.length) {
			event.preventDefault();
			config.content?.querySelector('.modal-title-text')?.focus({ preventScroll: true });
			return;
		}

		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const active = document.activeElement;
		const focusIsInside = config.content?.contains(active);

		if (!focusIsInside) {
			event.preventDefault();
			(event.shiftKey ? last : first).focus();
			return;
		}

		if (event.shiftKey && (active === first || active?.matches?.('.modal-title-text'))) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && active === last) {
			event.preventDefault();
			first.focus();
		}
	}

	getFocusableElements(root) {
		if (!root) return [];
		const selector = [
			'a[href]',
			'button:not([disabled])',
			'input:not([disabled])',
			'select:not([disabled])',
			'textarea:not([disabled])',
			'[tabindex]:not([tabindex="-1"])'
		].join(',');

		return Array.from(root.querySelectorAll(selector)).filter(element => {
			return element.getClientRects().length > 0
				&& element.getAttribute('aria-hidden') !== 'true'
				&& !element.closest('[hidden]');
		});
	}

	setBackgroundInert(config) {
		if (config.backgroundState.length) return;

		config.backgroundState = Array.from(document.body.children)
			.filter(element => element !== config.modal)
			.map(element => ({
				element,
				inert: element.hasAttribute('inert'),
				ariaHidden: element.getAttribute('aria-hidden')
			}));

		config.backgroundState.forEach(({ element }) => {
			element.setAttribute('inert', '');
			element.setAttribute('aria-hidden', 'true');
		});
	}

	restoreBackground(config) {
		config.backgroundState.forEach(({ element, inert, ariaHidden }) => {
			if (inert) element.setAttribute('inert', '');
			else element.removeAttribute('inert');
			if (ariaHidden === null) element.removeAttribute('aria-hidden');
			else element.setAttribute('aria-hidden', ariaHidden);
		});
		config.backgroundState = [];
	}

	pushModalHistory(id) {
		const currentState = history.state && typeof history.state === 'object' ? history.state : {};
		const nextState = { ...currentState, [this.historyStateKey]: id };

		if (currentState[this.historyStateKey]) {
			history.replaceState(nextState, '', location.href);
		} else {
			history.pushState(nextState, '', location.href);
		}
	}

	popModalHistory(id) {
		if (history.state?.[this.historyStateKey] === id) history.back();
	}

	getTopOpenModalConfig() {
		let openConfig = null;
		for (const config of this.modals.values()) {
			if (config.modal.classList.contains('visible')) openConfig = config;
		}
		return openConfig;
	}

	isAnyOpen() {
		for (const config of this.modals.values()) {
			if (config.modal.classList.contains('visible')) return true;
		}
		return false;
	}

	getOpenModalId() {
		return this.getTopOpenModalConfig()?.id || null;
	}
}

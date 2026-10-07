// ============================================
// MODAL MANAGER CLASS
// Handles all modal-related operations
// ============================================
class ModalManager {
	constructor() {
		this.modals = new Map();
		this.stack = [];
		this.backgroundState = [];
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
 * @param {string} options.layer - 'dialog' stacks; 'modal' replaces (default)
 * @param {Function} options.beforeClose - Async guard; false keeps the modal open
 * @param {boolean} options.showWhileLoading - Show the shell before content loads
 * @param {string} options.loadingLabel - Loading status text
 * @param {string} options.initialFocusSelector - Initial focus target inside the modal
 * @param {boolean} options.confirmOnEnter - Enter activates the configured form action
 * @param {string} options.enterActionSelector - Form action selector for Enter
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
			layer: options.layer || 'modal',
			modal,
			content: modal.querySelector(':scope > .modal-content'),
			openButtons: openBtnIds.map(buttonId => document.getElementById(buttonId)).filter(Boolean),
			closeButtons: closeBtnIds.map(buttonId => document.getElementById(buttonId)).filter(Boolean),
			onOpen: options.onOpen || null,
			onClose: options.onClose || null,
			beforeClose: options.beforeClose || null,
			closeOnOutsideClick: options.closeOnOutsideClick !== false,
			closeOnEscape: options.closeOnEscape !== false,
			externalContentUrl: options.externalContentUrl || null,
			cacheContent: options.cacheContent !== false,
			showWhileLoading: options.showWhileLoading === true,
			loadingLabel: options.loadingLabel || 'Loading\u2026',
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
			previouslyFocused: null
		};

		this.modals.set(id, config);
		this.setupAccessibility(config);
		this.setupModalListeners(config);

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

		window.addEventListener('popstate', async (event) => {
			if (this.navigatingBack) return;
			const requested = event.state?.[this.historyStateKey] || [];
			while (this.stack.length && !this.stack.every((config, index) => requested[index] === config.id)) {
				if (!this.close(this.getTopOpenModalConfig().id, { fromHistory: true })) return;
			}
			const base = this.modals.get(requested[0]);
			if (!this.stack.length && base?.layer === 'modal') await this.open(base.id, { fromHistory: true });
			// Forward can revisit a dismissed dialog whose promise no longer exists.
			const ids = this.stack.map(config => config.id);
			if (requested.length > ids.length) {
				const state = { ...history.state };
				if (ids.length) state[this.historyStateKey] = ids;
				else delete state[this.historyStateKey];
				history.replaceState(state, '', location.href);
			}
		});
	}

	async open(id, options = {}) {
		const config = this.modals.get(id);
		if (!config) {
			console.warn(`Cannot open unregistered modal: ${id}`);
			return;
		}

		// A modal closed a moment ago is still navigating back. Opening before
		// that popstate lands would have it close this modal instead.
		if (this.pendingHistoryBack) await this.pendingHistoryBack;

		if (this.stack.includes(config)) return;
		const activeModal = document.activeElement?.closest?.('.modal-overlay');
		const activeConfig = activeModal ? this.modals.get(activeModal.id) : null;
		config.previouslyFocused = options.restoreFocusTarget
			|| (config.layer === 'modal' ? activeConfig?.previouslyFocused : null)
			|| (document.activeElement instanceof HTMLElement ? document.activeElement : null);

		if (config.layer === 'modal') {
			while (this.stack.length > 1) {
				if (!this.close(this.getTopOpenModalConfig().id, { restoreFocus: false })) return;
			}
			if (this.pendingHistoryBack) await this.pendingHistoryBack;
			if (!this.closeAll({ preserveHistory: true, restoreFocus: false })) return;
		}

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

		if (!options.fromHistory) this.pushModalHistory();

		if (config.onOpen) await config.onOpen();
		this.focusInitialElement(config);
	}

	showModal(config) {
		if (this.stack.includes(config)) return;
		config.modal.classList.toggle('is-stacked', this.stack.length > 0);
		this.stack.push(config);
		config.modal.classList.add('visible');
		config.modal.setAttribute('aria-hidden', 'false');
		document.body.classList.add('modal-open');
		this.syncInert();
	}

	close(id, options = {}) {
		const config = this.modals.get(id);
		if (!config) {
			console.warn(`Cannot close unregistered modal: ${id}`);
			return false;
		}
		const index = this.stack.indexOf(config);
		if (index < 0) return false;
		for (const above of this.stack.slice(index + 1).reverse()) {
			if (!this.close(above.id, options)) return false;
		}
		if (config.beforeClose && !options.force) {
			if (config.closing) {
				if (options.fromHistory) this.pushModalHistory();
				return false;
			}
			config.closing = true;
			if (options.fromHistory) {
				this.pushModalHistory();
				options = { ...options, fromHistory: false };
			}
			Promise.resolve(config.beforeClose()).then((allowed) => {
				if (allowed) this.close(id, { ...options, force: true });
			}).finally(() => { config.closing = false; });
			return false;
		}

		const modalBody = config.modal.querySelector('.modal-body');
		if (modalBody) {
			const currentScrollTop = modalBody.scrollTop;
			this.setScrollPosition(modalBody, currentScrollTop);
			if (config.rememberScroll) config.savedScrollTop = currentScrollTop;
		}

		config.modal.classList.remove('visible', 'is-stacked');
		this.stack.splice(index, 1);
		config.modal.setAttribute('aria-hidden', 'true');
		this.syncInert();

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
			if (config.onContentLoaded) await config.onContentLoaded(modalBody);
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

	closeTopModal() {
		const config = this.getTopOpenModalConfig();
		if (!config?.closeOnEscape) return false;
		return this.close(config.id);
	}

	closeAll(options = {}) {
		for (const config of [...this.stack].reverse()) {
			if (!this.close(config.id, options)) return false;
		}
		return true;
	}

	handleEnterKey(event) {
		const config = this.getTopOpenModalConfig();
		if (config?.layer === 'dialog') {
			if (config.dialogEnterSelector) {
				event.preventDefault();
				config.modal.querySelector(config.dialogEnterSelector)?.click();
				return;
			}
			if (event.target instanceof HTMLElement && event.target.matches('button') && config.content.contains(event.target)) {
				event.preventDefault();
				event.target.click();
			}
			return;
		}
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
			if (this.getTopOpenModalConfig() !== config) return;
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
			const overlay = focusTarget.closest('.modal-overlay');
			if (overlay && this.getTopOpenModalConfig()?.modal !== overlay) return;
			if (!overlay && this.stack.length) return;
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

	syncInert() {
		if (!this.stack.length) {
			this.backgroundState.forEach(({ element, inert, ariaHidden }) => {
				element.toggleAttribute('inert', inert);
				if (ariaHidden === null) element.removeAttribute('aria-hidden');
				else element.setAttribute('aria-hidden', ariaHidden);
			});
			this.backgroundState = [];
			for (const config of this.modals.values()) config.modal.setAttribute('aria-hidden', 'true');
			return;
		}
		const top = this.getTopOpenModalConfig().modal;
		for (const element of document.body.children) {
			if (!this.backgroundState.some(entry => entry.element === element)) {
				this.backgroundState.push({ element, inert: element.hasAttribute('inert'), ariaHidden: element.getAttribute('aria-hidden') });
			}
			element.toggleAttribute('inert', element !== top);
			element.setAttribute('aria-hidden', String(element !== top));
		}
	}

	pushModalHistory() {
		const currentState = history.state && typeof history.state === 'object' ? history.state : {};
		const ids = this.stack.map(config => config.id);
		const nextState = { ...currentState, [this.historyStateKey]: ids };
		if (currentState[this.historyStateKey]?.length === ids.length) {
			history.replaceState(nextState, '', location.href);
		} else {
			history.pushState(nextState, '', location.href);
		}
	}

	popModalHistory(id) {
		const previous = this.pendingHistoryBack;
		const tail = (async () => {
			if (previous) await previous;
			if (history.state?.[this.historyStateKey]?.at(-1) !== id) return;
			this.navigatingBack = true;
			await new Promise(resolve => {
				window.addEventListener('popstate', resolve, { once: true });
				history.back();
			});
			this.navigatingBack = false;
		})();
		this.pendingHistoryBack = tail;
		tail.finally(() => {
			if (this.pendingHistoryBack === tail) this.pendingHistoryBack = null;
		});
	}

	getTopOpenModalConfig() {
		return this.stack.at(-1) || null;
	}

	isAnyOpen() {
		return this.stack.length > 0;
	}

}

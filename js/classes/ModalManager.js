// ============================================
// MODAL MANAGER CLASS
// Handles all modal-related operations
// ============================================
class ModalManager {
	constructor() {
		this.modals = new Map();
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
 * @param {Function} options.onContentLoaded - Callback after external content loads
 * @returns {ModalManager} - For chaining
 */
	register(id, options = {}) {
	const modal = document.getElementById(id);
	if (!modal) {
		console.warn(`Modal not found: ${id}`);
		return this;
	}

	// Support both single closeBtnId and array of closeBtnIds
	const closeBtnIds = Array.isArray(options.closeBtnId) 
		? options.closeBtnId 
		: (options.closeBtnId ? [options.closeBtnId] : []);

	const closeButtons = closeBtnIds
		.map(id => document.getElementById(id))
		.filter(btn => btn !== null);

	const openBtnIds = Array.isArray(options.openBtnId)
		? options.openBtnId
		: (options.openBtnId ? [options.openBtnId] : []);

	const config = {
		id,
		modal,
		openButtons: openBtnIds.map(id => document.getElementById(id)).filter(Boolean),
		closeButtons: closeButtons, // Changed from closeBtn to closeButtons (array)
		onOpen: options.onOpen || null,
		onClose: options.onClose || null,
		closeOnOutsideClick: options.closeOnOutsideClick !== false,
		closeOnEscape: options.closeOnEscape !== false,
		
		// External content options
		externalContentUrl: options.externalContentUrl || null,
		cacheContent: options.cacheContent !== false,
		showWhileLoading: options.showWhileLoading === true,
		loadingLabel: options.loadingLabel || 'Loading…',
		contentLoaded: false,
		cachedContent: null,
		
		// Scroll behavior
		resetScrollOnOpen: options.resetScrollOnOpen !== false,
		resetScrollOnClose: options.resetScrollOnClose || false,
		
		// Content loaded callback
		onContentLoaded: options.onContentLoaded || null,

		// Keyboard/focus behavior
		initialFocusSelector: options.initialFocusSelector || null,
		confirmOnEnter: options.confirmOnEnter || false,
		enterActionSelector: options.enterActionSelector || null
	};

	this.modals.set(id, config);
	this.setupModalListeners(config);
	
	return this;
}

setupModalListeners(config) {
	const { modal, openButtons, closeButtons, closeOnOutsideClick } = config;

	openButtons.forEach(openBtn => openBtn.addEventListener('click', () => this.open(config.id)));

	// Setup all close buttons
	closeButtons.forEach(closeBtn => {
		closeBtn.addEventListener('click', () => this.close(config.id));
	});

	if (closeOnOutsideClick) {
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				this.close(config.id);
			}
		});
	}
}

	setupGlobalListeners() {
		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				this.closeTopModal();
				return;
			}

			if (e.key === 'Enter') {
				this.handleEnterKey(e);
			}
		});
	}

	async open(id) {
		const config = this.modals.get(id);
		if (!config) {
			console.warn(`Cannot open unregistered modal: ${id}`);
			return;
		}

		this.closeAll();

		// Load external content if needed
		if (config.externalContentUrl) {
			if (config.showWhileLoading) {
				config.modal.classList.add('visible');
			}
			await this.loadExternalContent(config);
		}

		// Reset scroll position if configured
		if (config.resetScrollOnOpen) {
			this.resetScroll(config);
		}

		config.modal.classList.add('visible');

		if (config.onOpen) {
			config.onOpen();
		}

		this.focusInitialElement(config);
	}

	close(id) {
		const config = this.modals.get(id);
		if (!config) {
			console.warn(`Cannot close unregistered modal: ${id}`);
			return;
		}

		config.modal.classList.remove('visible');

		// Reset scroll on close if configured
		if (config.resetScrollOnClose) {
			this.resetScroll(config);
		}

		if (config.onClose) {
			config.onClose();
		}
	}

	async loadExternalContent(config) {
		// Return cached content if available
		if (config.cacheContent && config.contentLoaded) {
			return;
		}

		const modalBody = config.modal.querySelector('.modal-body');
		if (!modalBody) {
			console.warn(`No .modal-body found in modal: ${config.id}`);
			return;
		}

		try {
			// Show loading state
			const loading = document.createElement('div');
			loading.className = 'modal-loading';
			loading.setAttribute('role', 'status');
			loading.textContent = config.loadingLabel;
			modalBody.replaceChildren(loading);

			// Fetch content
			const response = await fetch(config.externalContentUrl);
			if (!response.ok) {
				throw new Error(`Failed to load: ${response.status}`);
			}

			const html = await response.text();

			// Cache content if enabled
			if (config.cacheContent) {
				config.cachedContent = html;
				config.contentLoaded = true;
			}

			// Inject content
			modalBody.innerHTML = html;

			// Run content loaded callback (for initializing refs, etc.)
			if (config.onContentLoaded) {
				config.onContentLoaded(modalBody);
			}

		} catch (error) {
			console.error(`Error loading modal content for ${config.id}:`, error);
			modalBody.innerHTML = `<div class="modal-error">Failed to load content. Please try again.</div>`;
		}
	}

	resetScroll(config) {
		const modalBody = config.modal.querySelector('.modal-body');
		if (modalBody) {
			modalBody.scrollTop = 0;
		}
	}

	async reloadContent(id) {
		const config = this.modals.get(id);
		if (!config || !config.externalContentUrl) {
			return;
		}

		// Force reload by clearing cache
		config.contentLoaded = false;
		config.cachedContent = null;

		await this.loadExternalContent(config);
	}

	closeTopModal() {
		for (const config of this.modals.values()) {
			if (config.modal.classList.contains('visible') && config.closeOnEscape) {
				this.close(config.id);
				return true;
			}
		}
		return false;
	}

	closeAll() {
		for (const config of this.modals.values()) {
			if (config.modal.classList.contains('visible')) {
				config.modal.classList.remove('visible');
				
				if (config.onClose) {
					config.onClose();
				}
			}
		}
	}

	handleEnterKey(event) {
		const config = this.getTopOpenModalConfig();
		if (!config?.confirmOnEnter) {
			return;
		}

		const target = event.target;
		if (target instanceof HTMLElement) {
			const tagName = target.tagName;
			if (tagName === 'TEXTAREA' || target.isContentEditable) {
				return;
			}
		}

		const actionSelector = config.enterActionSelector || config.initialFocusSelector;
		if (!actionSelector) {
			return;
		}

		const actionElement = config.modal.querySelector(actionSelector);
		if (!(actionElement instanceof HTMLElement) || actionElement.hasAttribute('disabled')) {
			return;
		}

		event.preventDefault();
		actionElement.click();
	}

	focusInitialElement(config) {
		if (!config?.initialFocusSelector) {
			return;
		}

		requestAnimationFrame(() => {
			const focusTarget = config.modal.querySelector(config.initialFocusSelector);
			if (!(focusTarget instanceof HTMLElement) || focusTarget.hasAttribute('disabled')) {
				return;
			}

			focusTarget.focus({ preventScroll: true });
			if (typeof focusTarget.select === 'function' && focusTarget.matches('input, textarea')) {
				focusTarget.select();
			}
		});
	}

	getTopOpenModalConfig() {
		let openConfig = null;
		for (const config of this.modals.values()) {
			if (config.modal.classList.contains('visible')) {
				openConfig = config;
			}
		}
		return openConfig;
	}

	isAnyOpen() {
		for (const config of this.modals.values()) {
			if (config.modal.classList.contains('visible')) {
				return true;
			}
		}
		return false;
	}

	getOpenModalId() {
		for (const config of this.modals.values()) {
			if (config.modal.classList.contains('visible')) {
				return config.id;
			}
		}
		return null;
	}
}

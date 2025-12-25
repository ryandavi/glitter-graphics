// js/ModalManager.js

/**
 * ModalManager - Centralized modal handling
 * 
 * Handles:
 * - Open/close behavior
 * - Escape key to close
 * - Click outside to close
 * - External content loading
 * - Callbacks for custom logic
 */
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
	 * @param {string} options.openBtnId - ID of button that opens modal
	 * @param {string} options.closeBtnId - ID of button that closes modal
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

		const config = {
			id,
			modal,
			openBtn: options.openBtnId ? document.getElementById(options.openBtnId) : null,
			closeBtn: options.closeBtnId ? document.getElementById(options.closeBtnId) : null,
			onOpen: options.onOpen || null,
			onClose: options.onClose || null,
			closeOnOutsideClick: options.closeOnOutsideClick !== false,
			closeOnEscape: options.closeOnEscape !== false,
			
			// External content options
			externalContentUrl: options.externalContentUrl || null,
			cacheContent: options.cacheContent !== false,
			contentLoaded: false,
			cachedContent: null,
			
			// Scroll behavior
			resetScrollOnOpen: options.resetScrollOnOpen !== false,
			resetScrollOnClose: options.resetScrollOnClose || false,
			
			// Content loaded callback
			onContentLoaded: options.onContentLoaded || null
		};

		this.modals.set(id, config);
		this.setupModalListeners(config);
		
		return this;
	}

	setupModalListeners(config) {
		const { modal, openBtn, closeBtn, closeOnOutsideClick } = config;

		if (openBtn) {
			openBtn.addEventListener('click', () => this.open(config.id));
		}

		if (closeBtn) {
			closeBtn.addEventListener('click', () => this.close(config.id));
		}

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
			}
		});
	}

	/**
	 * Open a modal by ID
	 */
	async open(id) {
		const config = this.modals.get(id);
		if (!config) {
			console.warn(`Cannot open unregistered modal: ${id}`);
			return;
		}

		this.closeAll();

		// Load external content if needed
		if (config.externalContentUrl) {
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
	}

	/**
	 * Close a modal by ID
	 */
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

	/**
	 * Load external content into modal
	 */
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
			const originalContent = modalBody.innerHTML;
			modalBody.innerHTML = '<div class="modal-loading">Loading...</div>';

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

	/**
	 * Reset scroll position to top of modal body
	 */
	resetScroll(config) {
		const modalBody = config.modal.querySelector('.modal-body');
		if (modalBody) {
			modalBody.scrollTop = 0;
		}
	}

	/**
	 * Reload external content (bypass cache)
	 */
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
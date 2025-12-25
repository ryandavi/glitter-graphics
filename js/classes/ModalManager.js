class ModalManager {
	constructor() {
		this.modals = new Map();
		this.setupGlobalListeners();
	}

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
			closeOnOutsideClick: options.closeOnOutsideClick !== false, // default true
			closeOnEscape: options.closeOnEscape !== false // default true
		};

		this.modals.set(id, config);
		this.setupModalListeners(config);
		
		return this; // Enable chaining
	}

	setupModalListeners(config) {
		const { modal, openBtn, closeBtn, closeOnOutsideClick } = config;

		// Open button
		if (openBtn) {
			openBtn.addEventListener('click', () => this.open(config.id));
		}

		// Close button
		if (closeBtn) {
			closeBtn.addEventListener('click', () => this.close(config.id));
		}

		// Click outside to close
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

	open(id) {
		const config = this.modals.get(id);
		if (!config) {
			console.warn(`Cannot open unregistered modal: ${id}`);
			return;
		}

		// Close all other modals first
		this.closeAll();

		// Open the modal
		config.modal.classList.add('visible');

		// Run callback
		if (config.onOpen) {
			config.onOpen();
		}
	}

	close(id) {
		const config = this.modals.get(id);
		if (!config) {
			console.warn(`Cannot close unregistered modal: ${id}`);
			return;
		}

		config.modal.classList.remove('visible');

		// Run callback
		if (config.onClose) {
			config.onClose();
		}
	}

	closeTopModal() {
		// Find the first visible modal that allows Escape closing
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
				
				// Run onClose callback
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
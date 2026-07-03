// ============================================
// MODAL UTILITIES
// ============================================

const initModalReferences = (modalBody, options = {}) => {
	if (!modalBody) return;

	const config = {
		referenceListSelector: options.referenceListSelector || 'ol',
		highlightDuration: options.highlightDuration || 2000
	};

	// Utility: Remove highlights
	const clearHighlights = () => {
		modalBody.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));
	};

	// Utility: Scroll element into view inside modal
	const scrollToElement = (el, block = 'start') => {
		el.scrollIntoView({ behavior: 'smooth', block, inline: 'nearest' });
	};

	// --- Reference Highlighting ---
	const sups = modalBody.querySelectorAll('sup');
	sups.forEach((sup, index) => {
		const match = sup.textContent.match(/\d+/);
		if (!match) return;

		const refNum = match[0];
		sup.id = `ref-link-${refNum}-${index}`;
		sup.classList.add(`ref-${refNum}`);
		sup.style.cursor = 'pointer';

		sup.addEventListener('click', e => {
			e.preventDefault();
			const targetRef = modalBody.querySelector(`#ref-${refNum}`);
			if (!targetRef) return;

			clearHighlights();
			targetRef.classList.add('highlight');
			scrollToElement(targetRef, 'center');
			setTimeout(() => targetRef.classList.remove('highlight'), config.highlightDuration);
		});
	});

	// --- Reference List Highlighting ---
	const refList = modalBody.querySelector(config.referenceListSelector);
	if (refList) {
		refList.querySelectorAll('li').forEach((item, index) => {
			const refNum = index + 1;
			item.id = `ref-${refNum}`;
			item.style.cursor = 'pointer';

			item.addEventListener('click', e => {
				if (e.target.tagName === 'A') return;
				e.preventDefault();

				const targetSups = modalBody.querySelectorAll(`sup.ref-${refNum}`);
				if (!targetSups.length) return;

				clearHighlights();
				targetSups.forEach(sup => sup.classList.add('highlight'));
				scrollToElement(targetSups[0], 'center');
				setTimeout(() => targetSups.forEach(sup => sup.classList.remove('highlight')), config.highlightDuration);
			});
		});
	}
};

const initModalSmoothScroll = (modal) => {
	if (!modal) return;

	// Utility: Scroll element into view
	const scrollToElement = (el, block = 'start') => {
		el.scrollIntoView({ behavior: 'smooth', block, inline: 'nearest' });
	};

	// Handle all anchor links
	modal.querySelectorAll('a[href^="#"]').forEach(link => {
		// Skip reference links (handled by initModalReferences)
		if (link.getAttribute('href').match(/^#ref-/)) return;

		link.addEventListener('click', e => {
			const targetId = link.getAttribute('href').slice(1);
			const targetEl = modal.querySelector(`#${targetId}`);
			if (!targetEl) return;

			e.preventDefault();
			scrollToElement(targetEl, 'start');
		});
	});
};

const initPixelScalerInContainer = (container = document) => {
	const images = container.querySelectorAll('img[data-pixel-scale]');
	if (images.length === 0) return;

	const scaleImages = () => {
		images.forEach(img => {
			// Ensure image is loaded before calculating
			if (!img.complete || img.naturalWidth === 0) {
				img.onload = scaleImages;
				return;
			}

			const scale = Number(img.dataset.pixelScale) || 1;
			const targetWidth = img.naturalWidth * scale;

			// Set the "ideal" width. 
			// The CSS max-width: 100% will automatically shrink it 
			// if the parent is smaller than this value.
			img.style.width = `${targetWidth}px`;
		});
	};

	// Initial Run
	scaleImages();
};

// ============================================
// PIXEL SCALER (Global initialization)
// Delegates to initPixelScalerInContainer and re-runs on resize
// ============================================
const initPixelScaler = () => {
	const debounce = (func, wait) => {
		let timeout;
		return (...args) => {
			clearTimeout(timeout);
			timeout = setTimeout(() => func.apply(this, args), wait);
		};
	};

	initPixelScalerInContainer(document);
	window.addEventListener('resize', debounce(() => initPixelScalerInContainer(document), 150));
};

// Run on DOM ready
document.addEventListener('DOMContentLoaded', initPixelScaler);

// ============================================
// TOOLTIP MANAGER CLASS
// ============================================

class TooltipManager {
	constructor(options = {}) {
		this.config = {
			gap: 12,                 // Distance from the cursor
			viewportPadding: 10,     // Buffer from screen edges
			dismissOnScroll: true,   // Hide on scroll
			oneAtATime: true,        // Only one open at a time
			placement: 'bottom',     // Primary Axis: top, bottom, left, right
			alignment: 'center',     // Secondary Axis: center, left, right, top, bottom
			...options
		};

		this.activeTooltip = null;
		this.activeElement = null;
		this.activeCoords = null; // Store cursor/touch position
		this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
		this.scrollContainers = new Set();

		this.handleScroll = this.handleScroll.bind(this);
		this.handleResize = this.handleResize.bind(this);
		this.handleOutsideClick = this.handleOutsideClick.bind(this);

		this.init();
	}

	init() {
		this.attachTooltipListeners();
		this.attachGlobalListeners();
	}

	findScrollableParent(element) {
		let parent = element.parentElement;
		while (parent) {
			const style = window.getComputedStyle(parent);
			if (['auto', 'scroll'].includes(style.overflow) ||
				['auto', 'scroll'].includes(style.overflowY)) {
				return parent;
			}
			parent = parent.parentElement;
		}
		return window;
	}

	attachTooltipListeners(container = document) {
		container.querySelectorAll('[data-tooltip]').forEach(el => this.attachTo(el));
	}

	// Idempotent per-element setup — safe to call again for dynamically loaded content
	attachTo(el) {
		if (el._tooltipInitialized) return;
		el._tooltipInitialized = true;

		if (this.isTouchDevice) {
			el.addEventListener('click', (e) => this.handleMobileClick(e, el));
		} else {
			el.addEventListener('mouseenter', (e) => this.show(el, e));
			el.addEventListener('mouseleave', () => this.hide(el));
		}

		if (this.config.dismissOnScroll) {
			const scrollParent = this.findScrollableParent(el);
			if (!this.scrollContainers.has(scrollParent)) {
				this.scrollContainers.add(scrollParent);
				scrollParent.addEventListener('scroll', this.handleScroll, {
					passive: true
				});
			}
		}
	}

	attachGlobalListeners() {
		if (this.config.dismissOnScroll) {
			window.addEventListener('scroll', this.handleScroll, {
				passive: true
			});
		}
		if (this.isTouchDevice) {
			document.addEventListener('click', this.handleOutsideClick);
		}
		window.addEventListener('resize', this.handleResize);
	}

	show(element, event) {
		if (this.config.oneAtATime) {
			this.dismissAll();
		}

		// Capture cursor/touch position
		let x, y;
		if (event) {
			if (event.touches && event.touches.length > 0) {
				// Touch event
				x = event.touches[0].clientX;
				y = event.touches[0].clientY;
			} else {
				// Mouse event
				x = event.clientX;
				y = event.clientY;
			}
		} else {
			// Fallback to element center if no event
			const rect = element.getBoundingClientRect();
			x = rect.left + rect.width / 2;
			y = rect.top + rect.height / 2;
		}

		this.activeCoords = { x, y };

		const tooltip = document.createElement('div');
		tooltip.className = 'tooltip';
		tooltip.textContent = element.dataset.tooltip;

		// Read overrides from data attributes, fallback to config
		tooltip.dataset.placement = element.dataset.placement || this.config.placement;
		tooltip.dataset.alignment = element.dataset.alignment || this.config.alignment;

		document.body.appendChild(tooltip);

		this.position(tooltip, element);

		element._tooltip = tooltip;
		this.activeTooltip = tooltip;
		this.activeElement = element;
	}

	// --- POSITIONING LOGIC ---

	position(tooltip, element) {
		const tooltipRect = tooltip.getBoundingClientRect();

		// Use stored cursor/touch coordinates instead of element bounds
		const cursorRect = {
			left: this.activeCoords.x,
			top: this.activeCoords.y,
			right: this.activeCoords.x,
			bottom: this.activeCoords.y,
			width: 0,
			height: 0
		};

		let preferredPlacement = tooltip.dataset.placement;
		const preferredAlignment = tooltip.dataset.alignment;

		// 1. Calculate preferred coordinates based on placement + alignment
		let coords = this.getCoords(preferredPlacement, preferredAlignment, cursorRect, tooltipRect);

		// 2. Check collision with viewport edges (Main Axis flip)
		if (this.isOutOfBounds(coords, tooltipRect)) {
			const flippedPlacement = this.getOppositePlacement(preferredPlacement);
			const flippedCoords = this.getCoords(flippedPlacement, preferredAlignment, cursorRect, tooltipRect);

			// If flipped fits better (or isn't strictly worse), use it
			if (!this.isOutOfBounds(flippedCoords, tooltipRect)) {
				coords = flippedCoords;
				preferredPlacement = flippedPlacement;
			}
		}

		// 3. Clamp Secondary Axis 
		coords = this.clampToViewport(coords, tooltipRect);

		// 4. Apply absolute position including current scroll offset
		tooltip.style.left = (coords.left + window.scrollX) + 'px';
		tooltip.style.top = (coords.top + window.scrollY) + 'px';
	}

	getCoords(placement, alignment, targetRect, tooltipRect) {
		const gap = this.config.gap;
		let top, left;

		// Logic split by axis
		switch (placement) {
			case 'top':
				top = targetRect.top - tooltipRect.height - gap;
				left = this.getHorizontalAlignment(alignment, targetRect, tooltipRect);
				break;
			case 'bottom':
				top = targetRect.bottom + gap;
				left = this.getHorizontalAlignment(alignment, targetRect, tooltipRect);
				break;
			case 'left':
				left = targetRect.left - tooltipRect.width - gap;
				top = this.getVerticalAlignment(alignment, targetRect, tooltipRect);
				break;
			case 'right':
				left = targetRect.right + gap;
				top = this.getVerticalAlignment(alignment, targetRect, tooltipRect);
				break;
			default: // Fallback to bottom/center
				top = targetRect.bottom + gap;
				left = targetRect.left - (tooltipRect.width / 2);
		}

		return { top, left };
	}

	// Calculate X position based on alignment (left, center, right)
	getHorizontalAlignment(align, target, tooltip) {
		if (align === 'left' || align === 'start') {
			return target.left;
		}
		if (align === 'right' || align === 'end') {
			return target.right - tooltip.width;
		}
		// Default center - center tooltip on cursor point
		return target.left - (tooltip.width / 2);
	}

	// Calculate Y position based on alignment (top, center, bottom)
	getVerticalAlignment(align, target, tooltip) {
		if (align === 'top' || align === 'start') {
			return target.top;
		}
		if (align === 'bottom' || align === 'end') {
			return target.bottom - tooltip.height;
		}
		// Default center - center tooltip on cursor point
		return target.top - (tooltip.height / 2);
	}

	getOppositePlacement(placement) {
		const opposites = {
			'top': 'bottom',
			'bottom': 'top',
			'left': 'right',
			'right': 'left'
		};
		return opposites[placement] || 'top';
	}

	isOutOfBounds(coords, tooltipRect) {
		const padding = this.config.viewportPadding;
		return (
			coords.top < padding ||
			coords.left < padding ||
			coords.top + tooltipRect.height > window.innerHeight - padding ||
			coords.left + tooltipRect.width > window.innerWidth - padding
		);
	}

	clampToViewport(coords, tooltipRect) {
		const padding = this.config.viewportPadding;
		return {
			left: Math.max(padding, Math.min(coords.left, window.innerWidth - tooltipRect.width - padding)),
			top: Math.max(padding, Math.min(coords.top, window.innerHeight - tooltipRect.height - padding))
		};
	}

	hide(element) {
		const tooltip = element._tooltip;
		if (tooltip) {
			tooltip.remove();
			delete element._tooltip;
			if (this.activeTooltip === tooltip) {
				this.activeTooltip = null;
				this.activeElement = null;
				this.activeCoords = null;
			}
		}
	}

	dismissAll() {
		document.querySelectorAll('[data-tooltip]').forEach(el => {
			if (el._tooltip) this.hide(el);
		});
	}

	handleScroll() {
		this.dismissAll();
	}

	handleResize() {
		if (this.activeTooltip && this.activeElement) {
			this.position(this.activeTooltip, this.activeElement);
		}
	}

	handleMobileClick(e, element) {
		if (element._tooltip) {
			this.hide(element);
		} else {
			this.show(element, e);
		}
	}

	handleOutsideClick(e) {
		if (this.activeTooltip && !this.activeElement.contains(e.target)) {
			this.dismissAll();
		}
	}
}

// Global instance
const tooltipManager = new TooltipManager();

const initTooltipsInContainer = (container = document) => {
	if (!container) return;
	tooltipManager.attachTooltipListeners(container);
};
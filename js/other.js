const initPixelScaler = () => {
    const images = document.querySelectorAll('img[data-pixel-scale]');

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

    // Debounce function: limits how often the scaler runs
    const debounce = (func, wait) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    };

    // Initial Run
    scaleImages();

    // Responsive Listeners
    window.addEventListener('resize', debounce(scaleImages, 150));
};

// Run on DOM ready
document.addEventListener('DOMContentLoaded', initPixelScaler);



// Reference linking and highlighting functionality
document.addEventListener('DOMContentLoaded', function () {
	const modalBody = document.querySelector('#aboutModal .modal-body');

	// Add IDs to sup elements and make them clickable
	const sups = modalBody.querySelectorAll('sup');
	sups.forEach((sup, index) => {
		const refNum = sup.textContent.match(/\d+/)[0];
		// Add both a unique ID and a class for the reference number
		sup.id = `ref-link-${refNum}-${index}`;
		sup.classList.add(`ref-${refNum}`);
		sup.style.cursor = 'pointer';

		sup.addEventListener('click', function (e) {
			e.preventDefault();
			const targetRef = modalBody.querySelector(`#ref-${refNum}`);
			if (targetRef) {
				// Remove any existing highlights
				modalBody.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));

				// Scroll to reference
				targetRef.scrollIntoView({ behavior: 'smooth', block: 'center' });

				// Highlight the reference
				targetRef.classList.add('highlight');
				setTimeout(() => targetRef.classList.remove('highlight'), 2000);
			}
		});
	});

	// Add IDs to reference list items and make them clickable
	const refList = modalBody.querySelector('h3:has(+ ol) + ol');
	if (refList) {
		const refItems = refList.querySelectorAll('li');
		refItems.forEach((item, index) => {
			const refNum = index + 1;
			item.id = `ref-${refNum}`;
			item.style.cursor = 'pointer';

			item.addEventListener('click', function (e) {
				// Don't trigger if clicking on a link
				if (e.target.tagName === 'A') return;

				e.preventDefault();

				// Find ALL occurrences of this reference number
				const targetSups = modalBody.querySelectorAll(`sup.ref-${refNum}`);

				if (targetSups.length > 0) {
					// Remove any existing highlights
					modalBody.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));

					// Scroll to first mention
					targetSups[0].scrollIntoView({ behavior: 'smooth', block: 'center' });

					// Highlight ALL matching sup elements
					targetSups.forEach(sup => {
						sup.classList.add('highlight');
					});

					// Remove highlights after 2 seconds
					setTimeout(() => {
						targetSups.forEach(sup => {
							sup.classList.remove('highlight');
						});
					}, 2000);
				}
			});
		});
	}
});

// ============================================
// TOOLTIP MANAGER CLASS
// ============================================
class TooltipManager {
	constructor(options = {}) {
		this.config = {
			gap: 8,                  // Distance from the element
			viewportPadding: 10,     // Buffer from screen edges
			dismissOnScroll: true,   // Hide on scroll
			oneAtATime: true,        // Only one open at a time
			placement: 'bottom',        // Primary Axis: top, bottom, left, right
			alignment: 'center',     // Secondary Axis: center, left, right, top, bottom
			...options
		};

		this.activeTooltip = null;
		this.activeElement = null;
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

	attachTooltipListeners() {
		document.querySelectorAll('[data-tooltip]').forEach(el => {
			if (this.isTouchDevice) {
				el.addEventListener('click', (e) => this.handleMobileClick(e, el));
			} else {
				el.addEventListener('mouseenter', () => this.show(el));
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
		});
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

	show(element) {
		if (this.config.oneAtATime) {
			this.dismissAll();
		}

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
		const rect = element.getBoundingClientRect();
		const tooltipRect = tooltip.getBoundingClientRect();

		let preferredPlacement = tooltip.dataset.placement;
		const preferredAlignment = tooltip.dataset.alignment;

		// 1. Calculate preferred coordinates based on placement + alignment
		let coords = this.getCoords(preferredPlacement, preferredAlignment, rect, tooltipRect);

		// 2. Check collision with viewport edges (Main Axis flip)
		if (this.isOutOfBounds(coords, tooltipRect)) {
			const flippedPlacement = this.getOppositePlacement(preferredPlacement);
			const flippedCoords = this.getCoords(flippedPlacement, preferredAlignment, rect, tooltipRect);

			// If flipped fits better (or isn't strictly worse), use it
			if (!this.isOutOfBounds(flippedCoords, tooltipRect)) {
				coords = flippedCoords;
				preferredPlacement = flippedPlacement;
			}
		}

		// 3. Clamp Secondary Axis 
		// (Ensure it doesn't slide off screen left/right if placed top/bottom, etc.)
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
			default: // Fallback to top/center
				top = targetRect.top - tooltipRect.height - gap;
				left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
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
		// Default center
		return target.left + (target.width / 2) - (tooltip.width / 2);
	}

	// Calculate Y position based on alignment (top, center, bottom)
	getVerticalAlignment(align, target, tooltip) {
		if (align === 'top' || align === 'start') {
			return target.top;
		}
		if (align === 'bottom' || align === 'end') {
			return target.bottom - tooltip.height;
		}
		// Default center
		return target.top + (target.height / 2) - (tooltip.height / 2);
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

		// Clamp Horizontal
		const maxLeft = window.innerWidth - tooltipRect.width - padding;
		coords.left = Math.max(padding, Math.min(coords.left, maxLeft));

		// Clamp Vertical
		const maxTop = window.innerHeight - tooltipRect.height - padding;
		coords.top = Math.max(padding, Math.min(coords.top, maxTop));

		return coords;
	}

	// --- END POSITIONING LOGIC ---

	hide(element) {
		if (element._tooltip) {
			element._tooltip.remove();
			element._tooltip = null;
			if (this.activeElement === element) {
				this.activeTooltip = null;
				this.activeElement = null;
			}
		}
	}

	dismissAll() {
		document.querySelectorAll('.tooltip').forEach(t => t.remove());
		document.querySelectorAll('[data-tooltip]').forEach(el => el._tooltip = null);
		this.activeTooltip = null;
		this.activeElement = null;
	}

	handleMobileClick(e, element) {
		e.preventDefault();
		e.stopPropagation();
		element._tooltip ? this.hide(element) : this.show(element);
	}

	handleScroll() { this.dismissAll(); }
	handleResize() { this.dismissAll(); }

	handleOutsideClick(e) {
		if (!e.target.closest('[data-tooltip], .tooltip')) {
			this.dismissAll();
		}
	}

	destroy() {
		this.dismissAll();
		this.scrollContainers.forEach(container => {
			container.removeEventListener('scroll', this.handleScroll);
		});
		this.scrollContainers.clear();
		window.removeEventListener('scroll', this.handleScroll);
		window.removeEventListener('resize', this.handleResize);
		document.removeEventListener('click', this.handleOutsideClick);
	}

	refresh() {
		this.attachTooltipListeners();
	}
}
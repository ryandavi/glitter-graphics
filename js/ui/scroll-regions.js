// Classic native scrollbars reserve width even with a transparent track.
// One floating thumb serves opted-in vertical regions without changing overflow.
document.addEventListener('DOMContentLoaded', () => {
	const selector = '.scroll-region';
	// Horizontal rails, native inputs and the canvas viewport keep their own treatment.
	const hosts = [
		'.section-content', '.panel-scroll-region', '.layers-list',
		'.asset-options', '.asset-browser-content', '.filters-container-inner',
		'.property-scrollbox', '.mobile-settings-content',
		'.welcome-section', '.no-layer-settings-section', '.base-layer-settings-section',
		'.modal-body', '.confirmation-message', '.timeline-list',
		'.document-toc-panel', '.document-search-results', '.app-menu-panel'
	].join(', ');
	const markRegions = (root) => {
		if (!(root instanceof Element)) return;
		if (root.matches(hosts)) root.classList.add('scroll-region');
		root.querySelectorAll(hosts).forEach((node) => node.classList.add('scroll-region'));
	};
	markRegions(document.body);
	// Modal content is lazy-loaded, and panels move between desktop and the drawer.
	new MutationObserver((records) => {
		for (const record of records) {
			for (const node of record.addedNodes) markRegions(node);
		}
	}).observe(document.body, { childList: true, subtree: true });
	const thumb = document.createElement('div');
	thumb.className = 'scroll-region-thumb ui-ignore-gestures';
	thumb.setAttribute('aria-hidden', 'true');
	document.body.appendChild(thumb);
	let region = null;
	let drag = null;
	let timer = null;
	let frame = null;
	let travel = 0;
	const minThumb = parseFloat(getComputedStyle(thumb).getPropertyValue('--scrollbar-min-thumb'));

	const hovered = () => region?.matches(':hover') || thumb.matches(':hover');
	const hide = () => {
		if (drag || hovered()) return;
		thumb.classList.remove('is-visible');
		region = null;
		resize.disconnect();
		mutation.disconnect();
	};
	const deferHide = () => {
		clearTimeout(timer);
		timer = setTimeout(hide, CONFIG.ui.scrollbar.hideDelayMs);
	};
	const update = () => {
		frame = null;
		if (!region) return;
		const rect = region.getBoundingClientRect();
		const height = region.clientHeight;
		const range = region.scrollHeight - height;
		const visible = region.isConnected && height > 0 && range > 0 && /^(auto|scroll)$/.test(getComputedStyle(region).overflowY) && rect.bottom > 0 && rect.top < innerHeight;
		thumb.classList.toggle('is-visible', visible);
		if (!visible) return;
		const size = Math.min(height, Math.max(minThumb, height * height / region.scrollHeight));
		travel = height - size;
		const left = rect.left + region.clientLeft + region.clientWidth - thumb.offsetWidth;
		const top = rect.top + region.clientTop + travel * Math.max(0, Math.min(1, region.scrollTop / range));
		let clipTop = 0;
		let clipBottom = innerHeight;
		let clipLeft = 0;
		let clipRight = innerWidth;
		// The floating thumb must respect the same clipping as nested native bars.
		for (let parent = region.parentElement; parent; parent = parent.parentElement) {
			const style = getComputedStyle(parent);
			const box = parent.getBoundingClientRect();
			if (style.overflowY !== 'visible') {
				clipTop = Math.max(clipTop, box.top + parent.clientTop);
				clipBottom = Math.min(clipBottom, box.top + parent.clientTop + parent.clientHeight);
			}
			if (style.overflowX !== 'visible') {
				clipLeft = Math.max(clipLeft, box.left + parent.clientLeft);
				clipRight = Math.min(clipRight, box.left + parent.clientLeft + parent.clientWidth);
			}
		}
		thumb.style.height = `${size}px`;
		thumb.style.left = `${left}px`;
		thumb.style.top = `${top}px`;
		thumb.style.clipPath = `inset(${Math.max(0, clipTop - top)}px ${Math.max(0, left + thumb.offsetWidth - clipRight)}px ${Math.max(0, top + size - clipBottom)}px ${Math.max(0, clipLeft - left)}px)`;
	};
	const schedule = () => {
		if (region && frame === null) frame = requestAnimationFrame(update);
	};
	const resize = new ResizeObserver(schedule);
	const mutation = new MutationObserver(schedule);
	const activate = (next) => {
		if (drag) return;
		if (region !== next) {
			resize.disconnect();
			mutation.disconnect();
			region = next;
			if (region) {
				resize.observe(region);
				for (const child of region.children) resize.observe(child);
				mutation.observe(region.closest('.section') || region, { subtree: true, childList: true, attributes: true });
			}
		}
		update();
		deferHide();
	};
	const findRegion = (target) => {
		for (let node = target instanceof Element ? target.closest(selector) : null; node; node = node.parentElement?.closest(selector)) {
			if (node.scrollHeight > node.clientHeight && /^(auto|scroll)$/.test(getComputedStyle(node).overflowY)) return node;
		}
		return null;
	};
	document.addEventListener('pointerover', (event) => {
		if (event.target === thumb) return;
		const next = findRegion(event.target);
		if (next) activate(next);
		else hide();
	}, { passive: true });
	document.addEventListener('pointerout', deferHide, { passive: true });
	document.addEventListener('scroll', (event) => {
		if (event.target instanceof Element && event.target.matches(selector)) {
			activate(event.target);
		} else schedule();
	}, { capture: true, passive: true });
	window.addEventListener('resize', schedule, { passive: true });

	// Wheel events over the floating thumb must still reach the native scroller.
	thumb.addEventListener('wheel', (event) => {
		if (!region || event.ctrlKey) return;
		const unit = event.deltaMode === 1 ? parseFloat(getComputedStyle(region).lineHeight) || minThumb : event.deltaMode === 2 ? region.clientHeight : 1;
		region.scrollTop += event.deltaY * unit;
		event.preventDefault();
	}, { passive: false });
	thumb.addEventListener('pointerdown', (event) => {
		if (!region || event.button !== 0 || event.pointerType === 'touch') return;
		update();
		drag = { y: event.clientY, top: region.scrollTop, range: region.scrollHeight - region.clientHeight, travel };
		thumb.setPointerCapture(event.pointerId);
		thumb.classList.add('is-dragging');
		event.preventDefault();
	});
	thumb.addEventListener('pointermove', (event) => {
		if (!drag || !region || !drag.travel) return;
		region.scrollTop = drag.top + (event.clientY - drag.y) * drag.range / drag.travel;
		schedule();
	});
	thumb.addEventListener('lostpointercapture', () => {
		drag = null;
		thumb.classList.remove('is-dragging');
		deferHide();
	});
	document.documentElement.classList.add('has-overlay-scrollbars');
}, { once: true });

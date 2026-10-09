// Classic native scrollbars reserve width even with a transparent track.
// One floating bar serves opted-in vertical regions without changing overflow.
document.addEventListener('DOMContentLoaded', () => {
	const selector = '.scroll-region';
	// Horizontal rails, native inputs and the canvas viewport keep their own treatment.
	const hosts = [
		'.section-content', '.panel-scroll-region', '.layers-list',
		'.asset-options', '.asset-browser-content', '.filters-container-inner',
		'.property-scrollbox',
		'.welcome-section', '.no-layer-settings-section', '.base-layer-settings-section',
		'.modal-body', '.confirmation-message', '.timeline-list',
		'.document-toc-panel', '.document-search-results', '.app-menu-panel', '.export-side'
	].join(', ');
	// Every edge host gets `has-overflow-*` classes for the edges that hide
	// content. Fade hosts draw a bottom strip from them; the bar-less rails
	// (tool rail, context bars, the phone's chip bar) mask their own edges instead.
	const fadeHosts = '.section-content, .panel-scroll-region, .asset-options, .asset-browser-content, .property-scrollbox';
	const edgeHosts = `${fadeHosts}, .toolbar, [data-context-toolbar], .phone-chip-bar`;
	const scrollable = (overflow) => /^(auto|scroll)$/.test(overflow);
	const pendingEdges = new Set();
	const syncEdges = (node) => {
		const style = getComputedStyle(node);
		const slackY = scrollable(style.overflowY) ? node.scrollHeight - node.clientHeight : 0;
		const slackX = scrollable(style.overflowX) ? node.scrollWidth - node.clientWidth : 0;
		const bottom = slackY > 1 && node.scrollTop < slackY - 1;
		node.classList.toggle('has-overflow-top', slackY > 1 && node.scrollTop > 1);
		node.classList.toggle('has-overflow-bottom', bottom);
		node.classList.toggle('has-overflow-start', slackX > 1 && node.scrollLeft > 1);
		node.classList.toggle('has-overflow-end', slackX > 1 && node.scrollLeft < slackX - 1);
		// The strip is in flow and sticky, so it takes the host's own padding and
		// gap to sit flush on the bottom edge without adding height.
		const flex = style.display === 'flex' && style.flexDirection === 'column';
		const strip = bottom && node.matches(fadeHosts) && (flex || style.display === 'block');
		node.classList.toggle('has-scroll-fade', strip);
		if (!strip) return;
		node.style.setProperty('--scroll-fade-gap', `${flex && parseFloat(style.rowGap) || 0}px`);
		node.style.setProperty('--scroll-fade-pad-bottom', style.paddingBottom);
		node.style.setProperty('--scroll-fade-pad-left', style.paddingLeft);
		node.style.setProperty('--scroll-fade-pad-right', style.paddingRight);
	};
	const queueEdges = (node) => {
		if (!(node instanceof Element) || !node.matches(edgeHosts)) return;
		if (!pendingEdges.size) requestAnimationFrame(() => {
			for (const host of pendingEdges) if (host.isConnected) syncEdges(host);
			pendingEdges.clear();
		});
		pendingEdges.add(node);
	};
	// A host's overflow changes when it or any direct child resizes. Resize
	// callbacks run before paint, so the edges are right in the frame a region
	// first shows, not one frame later.
	const edgeSizes = new ResizeObserver((entries) => {
		const seen = new Set();
		for (const { target } of entries) {
			[target, target.parentElement].forEach((node) => {
				if (node instanceof Element && node.matches(edgeHosts) && !seen.has(node)) {
					seen.add(node);
					syncEdges(node);
				}
			});
		}
	});
	const markNode = (node) => {
		if (node.matches(hosts)) node.classList.add('scroll-region');
		if (!node.matches(edgeHosts)) return;
		edgeSizes.observe(node);
		for (const child of node.children) edgeSizes.observe(child);
	};
	const markRegions = (root) => {
		if (!(root instanceof Element)) return;
		markNode(root);
		root.querySelectorAll(`${hosts}, ${edgeHosts}`).forEach(markNode);
	};
	markRegions(document.body);
	// Modal content is lazy-loaded, and panels move between desktop and the drawer.
	// A host tagged after load is picked up when its own children next change.
	new MutationObserver((records) => {
		for (const record of records) {
			for (const node of record.addedNodes) markRegions(node);
			if (!(record.target instanceof Element)) continue;
			markNode(record.target);
			queueEdges(record.target);
		}
	}).observe(document.body, { childList: true, subtree: true });
	// The track is the hit area: wider than the drawn thumb, and as tall as the region.
	const track = document.createElement('div');
	track.className = 'scroll-region-track ui-ignore-gestures';
	track.setAttribute('aria-hidden', 'true');
	const thumb = document.createElement('div');
	thumb.className = 'scroll-region-thumb';
	track.appendChild(thumb);
	document.body.appendChild(track);
	let region = null;
	let drag = null;
	let paging = null;
	let touch = false;
	let timer = null;
	let frame = null;
	let travel = 0;
	const minThumb = parseFloat(getComputedStyle(thumb).getPropertyValue('--scrollbar-min-thumb'));

	// Hover sticks after a tap, so touch relies on the hide delay alone.
	const hovered = () => !touch && (region?.matches(':hover') || track.matches(':hover'));
	// Regions may opt into smooth scrolling; the bar must track the pointer exactly.
	const scrollTo = (top) => region.scrollTo({ top, behavior: 'instant' });
	const hide = () => {
		if (drag || paging || hovered()) return;
		track.classList.remove('is-visible');
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
		const visible = region.isConnected && height > 0 && range > 0 && scrollable(getComputedStyle(region).overflowY) && rect.bottom > 0 && rect.top < innerHeight;
		track.classList.toggle('is-visible', visible);
		if (!visible) return;
		const size = Math.min(height, Math.max(minThumb, height * height / region.scrollHeight));
		travel = height - size;
		const width = track.offsetWidth;
		const left = rect.left + region.clientLeft + region.clientWidth - width;
		const top = rect.top + region.clientTop;
		let clipTop = 0;
		let clipBottom = innerHeight;
		let clipLeft = 0;
		let clipRight = innerWidth;
		// The floating bar must respect the same clipping as nested native bars.
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
		track.style.height = `${height}px`;
		track.style.left = `${left}px`;
		track.style.top = `${top}px`;
		track.style.clipPath = `inset(${Math.max(0, clipTop - top)}px ${Math.max(0, left + width - clipRight)}px ${Math.max(0, top + height - clipBottom)}px ${Math.max(0, clipLeft - left)}px)`;
		thumb.style.height = `${size}px`;
		thumb.style.top = `${travel * Math.max(0, Math.min(1, region.scrollTop / range))}px`;
	};
	const schedule = () => {
		if (region && frame === null) frame = requestAnimationFrame(update);
	};
	const resize = new ResizeObserver(schedule);
	const mutation = new MutationObserver(schedule);
	const activate = (next) => {
		if (drag || paging) return;
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
			if (node.scrollHeight > node.clientHeight && scrollable(getComputedStyle(node).overflowY)) return node;
		}
		return null;
	};
	document.addEventListener('pointerover', (event) => {
		// Touch scrolls the region directly, so the bar only indicates position for it.
		touch = event.pointerType === 'touch';
		track.classList.toggle('is-touch', touch);
		if (track.contains(event.target)) return;
		const next = findRegion(event.target);
		if (next) activate(next);
		else hide();
	}, { passive: true });
	document.addEventListener('pointerout', deferHide, { passive: true });
	document.addEventListener('scroll', (event) => {
		if (event.target instanceof Element && event.target.matches(selector)) {
			activate(event.target);
		} else schedule();
		queueEdges(event.target);
	}, { capture: true, passive: true });
	window.addEventListener('resize', schedule, { passive: true });

	// Wheel events over the floating bar must still reach the native scroller.
	track.addEventListener('wheel', (event) => {
		if (!region || event.ctrlKey) return;
		const unit = event.deltaMode === 1 ? parseFloat(getComputedStyle(region).lineHeight) || minThumb : event.deltaMode === 2 ? region.clientHeight : 1;
		scrollTo(region.scrollTop + event.deltaY * unit);
		event.preventDefault();
	}, { passive: false });
	// A press on the bare track pages toward the pointer, repeating while held.
	const pageToward = () => {
		if (!region || !paging) return;
		const box = thumb.getBoundingClientRect();
		if (paging.y >= box.top && paging.y <= box.bottom) return;
		scrollTo(region.scrollTop + (paging.y < box.top ? -1 : 1) * region.clientHeight * CONFIG.ui.scrollbar.pageFraction);
		update();
		paging.timer = setTimeout(pageToward, paging.repeating ? CONFIG.ui.scrollbar.pageRepeatMs : CONFIG.ui.scrollbar.pageRepeatDelayMs);
		paging.repeating = true;
	};
	track.addEventListener('pointerdown', (event) => {
		if (!region || event.button !== 0 || event.pointerType === 'touch') return;
		update();
		track.setPointerCapture(event.pointerId);
		event.preventDefault();
		if (event.target === thumb) {
			drag = { y: event.clientY, top: region.scrollTop, range: region.scrollHeight - region.clientHeight, travel };
			track.classList.add('is-dragging');
			return;
		}
		paging = { y: event.clientY, timer: null, repeating: false };
		pageToward();
	});
	track.addEventListener('pointermove', (event) => {
		if (paging) paging.y = event.clientY;
		if (!drag || !region || !drag.travel) return;
		scrollTo(drag.top + (event.clientY - drag.y) * drag.range / drag.travel);
		schedule();
	});
	track.addEventListener('lostpointercapture', () => {
		clearTimeout(paging?.timer);
		paging = null;
		drag = null;
		track.classList.remove('is-dragging');
		deferHide();
	});
	document.documentElement.classList.add('has-overlay-scrollbars');
}, { once: true });

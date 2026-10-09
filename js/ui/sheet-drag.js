'use strict';

// The phone sheet's drag gesture: its grabber and bar drag it, and so does a
// pull down from content resting at its top. The sheet's owner supplies the
// rest as `host`:
//   isActive()                 this sheet is the one showing
//   getHeight()                its height, in dvh
//   setHeight(height)          follow the pointer
//   begin()                    a drag has started
//   settle(velocity, startHeight, keyboard)  rest at a detent, or dismiss
//   close()                    dismiss
// Returns `{ cancel }`, which drops a drag in flight.
function bindSheetDrag(sheet, handle, host) {
	const detents = CONFIG.ui.mobile.sheetDetents;
	sheet.querySelectorAll(':scope > .section > .section-header').forEach(header => header.classList.add('mobile-sheet-drag-header', 'ui-ignore-gestures'));
	let drag = null;
	let suppressClick = false;
	sheet.addEventListener('click', event => {
		if (!suppressClick) return;
		suppressClick = false;
		event.preventDefault();
		event.stopImmediatePropagation();
	}, true);
	sheet.addEventListener('pointerdown', event => {
		if (!host.isActive() || drag || event.button !== 0) return;
		suppressClick = false;
		const header = event.target.closest('[data-mobile-drawer-handle], .mobile-sheet-drag-header');
		let content = false;
		if (!header) {
			if (event.pointerType !== 'touch' || event.target.closest('input, select, textarea, .gradient-preview, .layer-drag-handle, .scroll-region-track, [data-pointer-drag]')) return;
			for (let node = event.target; node && node !== sheet; node = node.parentElement) {
				const style = getComputedStyle(node);
				if (style.touchAction === 'none' || (node.scrollWidth > node.clientWidth && /^(auto|scroll)$/.test(style.overflowX))) return;
				if (!/^(auto|scroll)$/.test(style.overflowY)) continue;
				// Content scrolled anywhere up the chain scrolls back first.
				if (node.scrollTop > 0) return;
				content = true;
			}
			if (!content) return;
		}
		drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
			startHeight: host.getHeight(), content, mode: 'pending',
			samples: [{ y: event.clientY, time: event.timeStamp }] };
	}, true);
	sheet.addEventListener('pointermove', event => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const dy = event.clientY - drag.startY;
		if (drag.mode === 'pending') {
			if (Math.abs(dy) <= CONFIG.ui.gestures.tapSlopPx) return;
			if (Math.abs(event.clientX - drag.startX) > Math.abs(dy)) { drag = null; return; }
			// Upward movement over content is the browser's own scroll.
			if (drag.content && dy < 0) { drag = null; return; }
			drag.mode = 'drag';
			sheet.setPointerCapture(event.pointerId);
			suppressClick = true;
			host.begin();
			document.body.classList.add('mobile-sheet-dragging');
		}
		const height = drag.startHeight - dy / window.innerHeight * 100;
		host.setHeight(Math.max(detents.minDragHeight, Math.min(detents.full, height)));
		const now = event.timeStamp;
		drag.samples.push({ y: event.clientY, time: now });
		while (drag.samples.length > 2 && drag.samples[1].time < now - detents.velocityWindowMs) drag.samples.shift();
		event.preventDefault();
		event.stopPropagation();
	});
	// Content scrolls natively, so it keeps momentum. A pull down from content
	// resting at its top belongs to the sheet, and only a cancelled touchmove
	// stops the browser from claiming that touch as a scroll.
	sheet.addEventListener('touchmove', event => {
		if (!drag?.content || !event.cancelable || event.touches.length !== 1) return;
		const dx = event.touches[0].clientX - drag.startX;
		const dy = event.touches[0].clientY - drag.startY;
		if (drag.mode === 'drag' || (dy > 0 && dy >= Math.abs(dx))) event.preventDefault();
	}, { passive: false });
	const finish = event => {
		if (event.type === 'lostpointercapture' && event.target !== sheet) return;
		const ended = drag;
		if (!ended || event.pointerId !== ended.pointerId) return;
		drag = null;
		if (sheet.hasPointerCapture(event.pointerId)) sheet.releasePointerCapture(event.pointerId);
		document.body.classList.remove('mobile-sheet-dragging');
		if (ended.mode !== 'drag') return;
		const now = event.timeStamp;
		const first = ended.samples.filter(sample => sample.time >= now - detents.velocityWindowMs)[0];
		const velocity = event.type === 'pointercancel' || !first
			? 0 : (event.clientY - first.y) / Math.max(1, now - first.time);
		host.settle(velocity, ended.startHeight);
	};
	sheet.addEventListener('pointerup', finish);
	sheet.addEventListener('pointercancel', finish);
	sheet.addEventListener('lostpointercapture', finish);
	handle.addEventListener('keydown', event => {
		if (!host.isActive()) return;
		if (!['Escape', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
		event.preventDefault();
		if (event.key === 'Escape') host.close();
		else host.settle(event.key === 'ArrowDown' ? detents.flingVelocityPxMs : -detents.flingVelocityPxMs, host.getHeight(), true);
	});
	return {
		cancel() {
			drag = null;
			document.body.classList.remove('mobile-sheet-dragging');
		}
	};
}

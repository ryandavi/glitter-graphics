'use strict';

// `liftHost` is a bar that forms its own stacking context: it carries
// `.has-open-menu` while the panel is open so the menu can rise above its
// neighbours.
function setupMenuPopover({ root, trigger, panel, liftHost = null, fixed = false, beforeOpen = null, itemSelector = '.app-menu-item:not([disabled])', bindTrigger = true }) {
	if (!root || !trigger || !panel) return null;
	const panelParent = panel.parentElement;
	const panelNext = panel.nextSibling;
	const closeOnViewportChange = () => close();
	const isOpen = () => !panel.hidden;
	const close = ({ focusTrigger = false } = {}) => {
		if (!isOpen()) return;
		panel.hidden = true;
		if (fixed) {
			panelParent.insertBefore(panel, panelNext);
			panel.classList.remove('is-fixed-menu');
			panel.style.removeProperty('left');
			panel.style.removeProperty('top');
			document.removeEventListener('scroll', closeOnViewportChange, true);
			window.removeEventListener('resize', closeOnViewportChange);
		}
		root.classList.remove('is-open');
		liftHost?.classList.remove('has-open-menu');
		trigger.setAttribute('aria-expanded', 'false');
		document.removeEventListener('keydown', onKeydown, true);
		document.removeEventListener('pointerdown', onPointerDown, true);
		if (focusTrigger) trigger.focus();
	};
	const open = () => {
		if (isOpen()) return;
		beforeOpen?.();
		if (fixed) {
			// A body portal escapes both clipping and ancestor stacking contexts.
			document.body.appendChild(panel);
			panel.classList.add('is-fixed-menu');
		}
		panel.hidden = false;
		if (fixed) {
			const rect = trigger.getBoundingClientRect();
			const box = panel.getBoundingClientRect();
			const inset = parseFloat(getComputedStyle(panel).getPropertyValue('--spacing-md'));
			const gap = parseFloat(getComputedStyle(panel).getPropertyValue('--spacing-xs'));
			panel.style.left = `${Math.max(inset, Math.min(rect.right - box.width, window.innerWidth - box.width - inset))}px`;
			const top = rect.bottom + gap + box.height <= window.innerHeight - inset ? rect.bottom + gap : rect.top - box.height - gap;
			panel.style.top = `${Math.max(inset, Math.min(top, window.innerHeight - box.height - inset))}px`;
			document.addEventListener('scroll', closeOnViewportChange, true);
			window.addEventListener('resize', closeOnViewportChange);
		}
		root.classList.add('is-open');
		liftHost?.classList.add('has-open-menu');
		trigger.setAttribute('aria-expanded', 'true');
		document.addEventListener('keydown', onKeydown, true);
		document.addEventListener('pointerdown', onPointerDown, true);
		panel.querySelector(itemSelector)?.focus();
	};
	function onPointerDown(event) {
		if (!root.contains(event.target) && !panel.contains(event.target)) close();
	}
	function onKeydown(event) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			close({ focusTrigger: true });
			return;
		}
		if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
		const items = Array.from(panel.querySelectorAll(itemSelector));
		if (!items.length) return;
		event.preventDefault();
		const current = items.indexOf(document.activeElement);
		const step = event.key === 'ArrowDown' ? 1 : -1;
		items[(current + step + items.length) % items.length].focus();
	}
	if (bindTrigger) trigger.addEventListener('click', () => (isOpen() ? close() : open()));
	panel.addEventListener('click', (event) => {
		if (event.target.closest('.app-menu-item')) close();
	});
	return { open, close, isOpen };
}

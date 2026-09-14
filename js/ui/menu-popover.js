'use strict';

function setupMenuPopover({ root, trigger, panel, itemSelector = '.app-menu-item:not([disabled])' }) {
	if (!root || !trigger || !panel) return null;
	const isOpen = () => !panel.hidden;
	const close = ({ focusTrigger = false } = {}) => {
		if (!isOpen()) return;
		panel.hidden = true;
		root.classList.remove('is-open');
		trigger.setAttribute('aria-expanded', 'false');
		document.removeEventListener('keydown', onKeydown, true);
		document.removeEventListener('pointerdown', onPointerDown, true);
		if (focusTrigger) trigger.focus();
	};
	const open = () => {
		if (isOpen()) return;
		panel.hidden = false;
		root.classList.add('is-open');
		trigger.setAttribute('aria-expanded', 'true');
		document.addEventListener('keydown', onKeydown, true);
		document.addEventListener('pointerdown', onPointerDown, true);
		panel.querySelector(itemSelector)?.focus();
	};
	function onPointerDown(event) {
		if (!root.contains(event.target)) close();
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
	trigger.addEventListener('click', () => (isOpen() ? close() : open()));
	panel.addEventListener('click', (event) => {
		if (event.target.closest('.app-menu-item')) close();
	});
	return { open, close, isOpen };
}

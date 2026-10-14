'use strict';

function buildMenuPanel() {
	const panel = buildElement('app-menu-panel');
	panel.hidden = true; panel.setAttribute('role', 'menu');
	return panel;
}

function buildMenuItem({ label, run = null, title = '', role = 'menuitem', current = false }) {
	const button = document.createElement('button');
	button.type = 'button'; button.className = 'app-menu-item';
	button.setAttribute('role', role);
	if (title) button.title = title;
	if (run) button.addEventListener('click', run);
	else button.disabled = true;
	if (current) {
		const text = document.createElement('span'); text.className = 'app-menu-item-label'; text.textContent = label;
		const check = document.createElement('span'); check.className = 'app-menu-item-current';
		check.setAttribute('aria-hidden', 'true'); check.appendChild(createIcon('check'));
		button.append(text, check);
	} else button.textContent = label;
	return button;
}

function buildMenuSeparator() {
	const node = document.createElement('div');
	node.className = 'app-menu-separator'; node.setAttribute('role', 'separator');
	return node;
}

function buildMenuLabel(text) {
	const node = document.createElement('div');
	node.className = 'app-menu-group-label'; node.textContent = text;
	return node;
}

// `liftHost` is a bar that forms its own stacking context: it carries
// `.has-open-menu` while the panel is open so the menu can rise above its
// neighbours.
function setupMenuPopover({
	root, trigger, panel, liftHost = null, fixed = false, beforeOpen = null,
	itemSelector = '.app-menu-item:not([disabled])', bindTrigger = true, keepOpenSelector = null
}) {
	if (!root || !trigger || !panel) return null;
	const panelParent = panel.parentElement;
	const panelNext = panel.nextSibling;
	const closeOnViewportChange = event => {
		if (event.type === 'scroll' && !event.target.contains?.(trigger)) return;
		close();
	};
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
	const open = ({ anchor = null } = {}) => {
		if (isOpen()) return;
		beforeOpen?.();
		if (fixed) {
			// A body portal escapes both clipping and ancestor stacking contexts.
			document.body.appendChild(panel);
			panel.classList.add('is-fixed-menu');
		}
		panel.hidden = false;
		if (fixed) {
			const rect = anchor || trigger.getBoundingClientRect();
			const box = panel.getBoundingClientRect();
			const inset = parseFloat(getComputedStyle(panel).getPropertyValue('--spacing-md'));
			const gap = parseFloat(getComputedStyle(panel).getPropertyValue('--spacing-xs'));
			panel.style.left = `${Math.max(inset, Math.min(anchor ? rect.left : rect.right - box.width, window.innerWidth - box.width - inset))}px`;
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
		const item = event.target.closest('.app-menu-item');
		if (item && (!keepOpenSelector || !item.matches(keepOpenSelector))) close();
	});
	return { open, close, isOpen };
}

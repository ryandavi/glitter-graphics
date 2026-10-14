'use strict';

// Both hosts use the same key buttons and edits; the dock supplies its ruler
// coordinates and snapping, while the panel measures one cycle locally.
class KeyStrip {
	constructor(host, panel, context) {
		this.host = host; this.panel = panel; this.context = context; this.buttons = [];
		host.classList.add('key-strip');
		if (!context.begin) {
			this.pointerDrag = bindPointerDrag(host, {
				threshold: CONFIG.ui.timeline.dragThresholdPx, axis: 'x', clickHost: host,
				start: event => {
					const button = event.target.closest('[data-key-at]'), { layer, entry } = this.context;
					if (!button || !this.panel.canEditKeys(layer, entry)) return false;
					const at = Number(button.dataset.keyAt);
					this.drag = { layer, entry, at, keys: GlitterAnimation.normalizeKeys(entry.keys), moved: false };
					this.panel.selectKey(layer, entry, at);
				},
				move: event => {
					const drag = this.drag, box = host.getBoundingClientRect();
					if (!this.panel.canEditKeys(drag.layer, drag.entry)) { this.pointerDrag.finish(true); return; }
					drag.moved = true;
					this.panel.retimeKey(drag.layer, drag.entry, this.panel.keyIndex(drag.entry), clampNumber((event.clientX - box.left) / box.width, 0, 1), { commit: false });
					this.update();
				},
				end: cancelled => {
					const drag = this.drag; this.drag = null;
					if (!drag?.moved) return;
					if (cancelled) this.panel.setKeys(drag.layer, drag.entry, drag.keys, { commit: false, rollback: true, at: drag.at });
					else if (!isSameData(drag.keys, GlitterAnimation.normalizeKeys(drag.entry.keys))) this.panel.editor.saveState('Retime motion key');
					this.update();
				}
			});
		} else host.addEventListener('pointerdown', event => context.begin(event));
	}

	update() {
		const { layer, entry } = this.context;
		if (!entry) { this.host.replaceChildren(); this.buttons = []; return; }
		const keys = GlitterAnimation.normalizeKeys(entry.keys), selected = this.panel.keyIndex(entry);
		while (this.buttons.length > keys.length) this.buttons.pop().remove();
		while (this.buttons.length < keys.length) {
			const button = document.createElement('button');
			button.type = 'button'; button.className = 'timeline-key btn-icon-simple';
			button.addEventListener('click', () => {
				if (this.panel.canEditKeys(this.context.layer, this.context.entry)) this.panel.selectKey(this.context.layer, this.context.entry, Number(button.dataset.keyAt), { seek: true });
			});
			button.addEventListener('keydown', event => this.onKey(event, button));
			button.addEventListener('contextmenu', event => { event.preventDefault(); this.openMenu(button, event); });
			this.buttons.push(button); this.host.appendChild(button);
		}
		keys.forEach((key, index) => {
			const button = this.buttons[index], option = ANIMATION_EASING_OPTIONS.find(option => option.value === key.easing);
			button.dataset.keyAt = key.at; button.dataset.shape = option.shape;
			button.title = `Key ${index + 1} · ${formatSeconds(key.at * this.panel.keyPeriod(layer, entry))}, ${option.label} outgoing easing`;
			button.setAttribute('aria-label', button.title);
			button.classList.toggle('active', index === selected); button.setAttribute('aria-pressed', String(index === selected));
			button.disabled = !this.panel.canEditKeys(layer, entry);
			if (this.context.place) this.context.place(button, key.at);
			else button.style.left = `${key.at * 100}%`;
		});
	}

	onKey(event, button) {
		const { layer, entry } = this.context;
		if (!this.panel.canEditKeys(layer, entry) || event.ctrlKey || event.metaKey || event.altKey) return;
		if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
			event.preventDefault(); event.stopPropagation(); this.openMenu(button); return;
		}
		if (!['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
		event.preventDefault(); event.stopPropagation();
		if (this.drag || this.context.dragging?.()) return;
		this.panel.setKeySelection(entry, Number(button.dataset.keyAt));
		const index = this.panel.keyIndex(entry);
		if (event.key === 'Delete' || event.key === 'Backspace') this.panel.deleteKey(layer, entry, index);
		else {
			const step = event.shiftKey ? CONFIG.ui.timeline.keyFastNudgeStep : CONFIG.ui.timeline.keyNudgeStep;
			this.panel.retimeKey(layer, entry, index, Number(button.dataset.keyAt) + (event.key === 'ArrowRight' ? step : -step), {
				coalesceKey: this.panel.editor.historyManager.burstCoalesceKey(`motion-key-nudge:${layer.id}`)
			});
		}
		this.update();
	}

	openMenu(button, event) {
		const { layer, entry } = this.context;
		if (!this.panel.canEditKeys(layer, entry)) return;
		this.menu?.close(); this.menuHost?.remove();
		this.panel.setKeySelection(entry, Number(button.dataset.keyAt));
		const key = GlitterAnimation.normalizeKeys(entry.keys)[this.panel.keyIndex(entry)];
		const menu = buildMenuPanel();
		menu.append(buildMenuLabel('Outgoing easing'), ...ANIMATION_EASING_OPTIONS.map(option => {
			const item = buildMenuItem({ label: option.label, current: true, run: () => {
				if (!this.panel.canEditKeys(layer, entry)) return;
				this.panel.editKeyEasing(layer, entry, key.at, option.value); this.update();
			} });
			item.setAttribute('aria-current', String(key.easing === option.value)); return item;
		}), buildMenuSeparator(), buildMenuItem({ label: 'Duplicate key', run: () => { this.panel.duplicateKey(layer, entry, key.at); this.update(); } }), buildMenuItem({ label: 'Delete key', run: () => { this.panel.deleteKey(layer, entry); this.update(); } }));
		this.host.appendChild(menu); this.menuHost = menu;
		this.menu = setupMenuPopover({ root: this.host, trigger: button, panel: menu, fixed: true, bindTrigger: false });
		const anchor = event && { left: event.clientX, right: event.clientX, top: event.clientY, bottom: event.clientY };
		this.menu.open({ anchor });
	}
}

function buildEasingCurve(easing, steps) {
	const fn = GlitterEasing.easingFn(easing, { steps });
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.classList.add('easing-curve'); svg.setAttribute('viewBox', '0 -10 100 120'); svg.setAttribute('aria-hidden', 'true');
	const line = document.createElementNS(svg.namespaceURI, 'polyline');
	line.setAttribute('points', Array.from({ length: CONFIG.ui.timeline.curveSamples + 1 }, (_, i) => {
		const p = i / CONFIG.ui.timeline.curveSamples; return `${p * 100},${100 - fn(p) * 100}`;
	}).join(' '));
	svg.appendChild(line); return svg;
}

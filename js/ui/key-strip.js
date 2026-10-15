'use strict';

// Both hosts use the same key buttons and edits; the dock supplies its ruler
// coordinates and snapping, while the panel measures one cycle locally.
class KeyStrip {
	constructor(host, editor, context) {
		this.host = host; this.editor = editor; this.context = context; this.buttons = [];
		host.classList.add('key-strip');
		if (!context.begin) {
			this.pointerDrag = bindPointerDrag(host, {
				threshold: CONFIG.ui.timeline.dragThresholdPx, axis: 'x', clickHost: host,
				start: event => {
					const button = event.target.closest('[data-key-at]'), { layer, entry } = this.context;
					if (!button || !this.editor.canEditKeys(layer, entry)) return false;
					const at = Number(button.dataset.keyAt);
					this.drag = { layer, entry, retime: this.editor.beginKeyRetime(layer, entry, at), moved: false };
					this.editor.selectKey(layer, entry, at);
				},
				move: event => {
					const drag = this.drag, box = host.getBoundingClientRect();
					if (!this.editor.canEditKeys(drag.layer, drag.entry)) { this.pointerDrag.finish(true); return; }
					drag.moved = true;
					drag.retime.move(clampNumber((event.clientX - box.left) / box.width, 0, 1));
					this.update();
				},
				end: cancelled => {
					const drag = this.drag; this.drag = null;
					if (!drag?.moved) return;
					drag.retime.finish(cancelled);
					this.update();
				}
			});
		} else host.addEventListener('pointerdown', event => context.begin(event));
	}

	update() {
		const { layer, entry } = this.context;
		if (!entry) { this.host.replaceChildren(); this.buttons = []; return; }
		const keys = GlitterAnimation.normalizeKeys(entry.keys), selected = this.editor.keyIndex(entry);
		while (this.buttons.length > keys.length) this.buttons.pop().remove();
		while (this.buttons.length < keys.length) {
			const button = document.createElement('button');
			button.type = 'button'; button.className = 'timeline-key btn-icon-simple';
			button.addEventListener('click', () => {
				if (this.editor.canEditKeys(this.context.layer, this.context.entry)) this.editor.selectKey(this.context.layer, this.context.entry, Number(button.dataset.keyAt), { seek: true });
			});
			button.addEventListener('keydown', event => this.onKey(event, button));
			button.addEventListener('contextmenu', event => { event.preventDefault(); this.openMenu(button, event); });
			this.buttons.push(button); this.host.appendChild(button);
		}
		keys.forEach((key, index) => {
			const button = this.buttons[index], option = ANIMATION_EASING_OPTIONS.find(option => option.value === key.easing);
			button.dataset.keyAt = key.at; button.dataset.shape = option.shape;
			button.title = `Key ${index + 1} · ${formatSeconds(key.at * this.editor.keyPeriod(layer, entry))}, ${option.label} outgoing easing`;
			button.setAttribute('aria-label', button.title);
			button.classList.toggle('active', index === selected); button.setAttribute('aria-pressed', String(index === selected));
			button.disabled = !this.editor.canEditKeys(layer, entry);
			if (this.context.place) this.context.place(button, key.at);
			else button.style.left = `${key.at * 100}%`;
		});
	}

	onKey(event, button) {
		const { layer, entry } = this.context;
		if (!this.editor.canEditKeys(layer, entry) || event.ctrlKey || event.metaKey || event.altKey) return;
		if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
			event.preventDefault(); event.stopPropagation(); this.openMenu(button); return;
		}
		if (!['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
		event.preventDefault(); event.stopPropagation();
		if (this.drag || this.context.dragging?.()) return;
		this.editor.setKeySelection(entry, Number(button.dataset.keyAt));
		const index = this.editor.keyIndex(entry);
		if (event.key === 'Delete' || event.key === 'Backspace') this.editor.deleteKey(layer, entry, index);
		else {
			const step = event.shiftKey ? CONFIG.ui.timeline.keyFastNudgeStep : CONFIG.ui.timeline.keyNudgeStep;
			this.editor.retimeKey(layer, entry, index, Number(button.dataset.keyAt) + (event.key === 'ArrowRight' ? step : -step), {
				coalesceKey: this.editor.historyManager.burstCoalesceKey(`motion-key-nudge:${layer.id}`)
			});
		}
		this.update();
	}

	openMenu(button, event) {
		const { layer, entry } = this.context;
		if (!this.editor.canEditKeys(layer, entry)) return;
		this.editor.setKeySelection(entry, Number(button.dataset.keyAt));
		const key = GlitterAnimation.normalizeKeys(entry.keys)[this.editor.keyIndex(entry)];
		this.menu = openActionMenu({ root: this.host, trigger: button, event, actions: [
			...ANIMATION_EASING_OPTIONS.map(option => ({ group: 'Outgoing easing', label: option.label, checked: key.easing === option.value, run: () => {
				if (!this.editor.canEditKeys(layer, entry)) return;
				this.editor.editKeyEasing(layer, entry, key.at, option.value); this.update();
			} })),
			{ label: 'Duplicate key', run: () => { this.editor.duplicateKey(layer, entry, key.at); this.update(); } },
			{ label: 'Delete key', run: () => { this.editor.deleteKey(layer, entry); this.update(); } }
		] });
	}
}

function buildEasingCurve(easing, steps) {
	const fn = GlitterEasing.easingFn(easing, { steps });
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.classList.add('icon'); svg.setAttribute('viewBox', '0 -10 100 120'); svg.setAttribute('aria-hidden', 'true');
	const line = document.createElementNS(svg.namespaceURI, 'polyline');
	line.setAttribute('points', Array.from({ length: CONFIG.ui.timeline.curveSamples + 1 }, (_, i) => {
		const p = i / CONFIG.ui.timeline.curveSamples; return `${p * 100},${100 - fn(p) * 100}`;
	}).join(' '));
	line.setAttribute('fill', 'none'); line.setAttribute('stroke', 'currentColor');
	line.setAttribute('stroke-width', document.getElementById('icon-crop').getAttribute('stroke-width'));
	line.setAttribute('vector-effect', 'non-scaling-stroke');
	line.setAttribute('stroke-linecap', 'round'); line.setAttribute('stroke-linejoin', 'round');
	svg.appendChild(line); return svg;
}

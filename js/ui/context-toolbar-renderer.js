class ContextToolbarRenderer {
	constructor(editor) {
		this.editor = editor;
		this.hosts = [];
		this.placement = this.readPlacement();
	}

	render() {
		(CONFIG.ui.contextToolbars || []).forEach((toolbar) => {
			const host = document.getElementById(toolbar.id);
			if (!host) return;
			const handle = document.createElement('button');
			handle.type = 'button';
			handle.className = 'context-toolbar-handle';
			handle.setAttribute('aria-label', 'Move context bar');
			handle.title = 'Drag to move · Double-click to reset';
			handle.innerHTML = '<span aria-hidden="true"></span>';
			host.replaceChildren(handle, ...(toolbar.controls || []).map((control) => this.build(control)));
			host.dataset.contextToolbar = '';
			this.hosts.push(host);
			this.bindPlacement(host, handle);
		});

		window.addEventListener('resize', () => this.hosts.forEach((host) => this.applyPlacement(host)), { passive: true });
		if (typeof ResizeObserver === 'function') {
			const parent = this.hosts[0]?.offsetParent;
			if (parent) new ResizeObserver(() => this.hosts.forEach((host) => this.applyPlacement(host))).observe(parent);
		}
	}

	readPlacement() {
		try {
			const value = JSON.parse(localStorage.getItem('glitterEditor_contextToolbarPlacement'));
			if (value?.anchor
				|| (Number.isFinite(value?.centerX) && Number.isFinite(value?.centerY))
				|| (Number.isFinite(value?.x) && Number.isFinite(value?.y))) return value;
		} catch (_) { /* A corrupt preference should never prevent the editor booting. */ }
		return { anchor: 'bottom-center' };
	}

	savePlacement(placement) {
		this.placement = placement;
		localStorage.setItem('glitterEditor_contextToolbarPlacement', JSON.stringify(placement));
	}

	bindPlacement(host, handle) {
		this.applyPlacement(host);
		handle.addEventListener('dblclick', () => {
			this.savePlacement({ anchor: 'bottom-center' });
			this.hosts.forEach((item) => this.applyPlacement(item));
			this.editor.updateStatus?.('Context bar position reset');
		});

		handle.addEventListener('pointerdown', (event) => {
			if (matchMedia(`(max-width: ${CONFIG.ui.mobile.breakpoint}px)`).matches || event.button !== 0) return;
			event.preventDefault();
			this.showSnapPreview(host, null);
			const container = host.offsetParent;
			if (!container) return;
			const containerRect = container.getBoundingClientRect();
			const hostRect = host.getBoundingClientRect();
			const offsetX = event.clientX - hostRect.left;
			const offsetY = event.clientY - hostRect.top;
			host.classList.add('is-dragging');
			handle.setPointerCapture(event.pointerId);

			const move = (moveEvent) => {
				const maxX = Math.max(0, containerRect.width - host.offsetWidth);
				const maxY = Math.max(0, containerRect.height - host.offsetHeight);
				const x = Math.min(maxX, Math.max(0, moveEvent.clientX - containerRect.left - offsetX));
				const y = Math.min(maxY, Math.max(0, moveEvent.clientY - containerRect.top - offsetY));
				this.setFreePosition(host, x, y);
				const snap = moveEvent.altKey ? null : this.nearestAnchor(host, x, y);
				this.showSnapPreview(host, snap);
			};
			const end = () => {
				host.classList.remove('is-dragging');
				const x = parseFloat(host.style.left) || 0;
				const y = parseFloat(host.style.top) || 0;
				const snap = this.previewedSnap;
				const parentWidth = host.offsetParent?.clientWidth || host.offsetWidth;
				const parentHeight = host.offsetParent?.clientHeight || host.offsetHeight;
				this.savePlacement(snap ? { anchor: snap.name } : {
					centerX: (x + host.offsetWidth / 2) / parentWidth,
					centerY: (y + host.offsetHeight / 2) / parentHeight
				});
				this.showSnapPreview(host, null);
				this.hosts.forEach((item) => this.applyPlacement(item));
				handle.removeEventListener('pointermove', move);
				handle.removeEventListener('pointerup', end);
				handle.removeEventListener('pointercancel', end);
			};
			handle.addEventListener('pointermove', move);
			handle.addEventListener('pointerup', end);
			handle.addEventListener('pointercancel', end);
		});
	}

	anchorPositions(host) {
		const parent = host.offsetParent;
		const inset = 12;
		const maxX = Math.max(0, (parent?.clientWidth || 0) - host.offsetWidth);
		const maxY = Math.max(0, (parent?.clientHeight || 0) - host.offsetHeight);
		const centerX = maxX / 2;
		const centerY = maxY / 2;
		return [
			{ name: 'top-left', x: Math.min(inset, maxX), y: Math.min(inset, maxY) },
			{ name: 'top-center', x: centerX, y: Math.min(inset, maxY) },
			{ name: 'top-right', x: Math.max(0, maxX - inset), y: Math.min(inset, maxY) },
			{ name: 'center', x: centerX, y: centerY },
			{ name: 'bottom-left', x: Math.min(inset, maxX), y: Math.max(0, maxY - inset) },
			{ name: 'bottom-center', x: centerX, y: Math.max(0, maxY - inset) },
			{ name: 'bottom-right', x: Math.max(0, maxX - inset), y: Math.max(0, maxY - inset) }
		];
	}

	nearestAnchor(host, x, y) {
		const threshold = (host.offsetParent?.clientWidth || innerWidth) < 900 ? 22 : 32;
		return this.anchorPositions(host)
			.map((anchor) => ({ ...anchor, distance: Math.hypot(anchor.x - x, anchor.y - y) }))
			.sort((a, b) => a.distance - b.distance)
			.find((anchor) => anchor.distance <= threshold) || null;
	}

	showSnapPreview(host, snap) {
		const previousName = this.previewedSnap?.name || null;
		const nextName = snap?.name || null;
		if (previousName === nextName && this.snapGuide?.isConnected === Boolean(snap)) return;
		this.previewedSnap = snap;
		this.snapGuide?.remove();
		this.snapGuide = null;
		host.classList.toggle('has-snap-preview', Boolean(snap));
		if (!snap || !host.offsetParent) return;
		const guide = document.createElement('div');
		guide.className = 'context-toolbar-snap-guide';
		guide.style.left = `${snap.x}px`;
		guide.style.top = `${snap.y}px`;
		guide.style.width = `${host.offsetWidth}px`;
		guide.style.height = `${host.offsetHeight}px`;
		host.offsetParent.appendChild(guide);
		this.snapGuide = guide;
	}

	setFreePosition(host, x, y) {
		host.style.left = `${x}px`;
		host.style.top = `${y}px`;
		host.style.right = 'auto';
		host.style.bottom = 'auto';
		host.style.transform = 'none';
	}

	applyPlacement(host) {
		if (matchMedia(`(max-width: ${CONFIG.ui.mobile.breakpoint}px)`).matches) {
			host.style.removeProperty('left'); host.style.removeProperty('top');
			host.style.removeProperty('right'); host.style.removeProperty('bottom'); host.style.removeProperty('transform');
			return;
		}
		requestAnimationFrame(() => {
			const positions = this.anchorPositions(host);
			const parentWidth = host.offsetParent?.clientWidth || 0;
			const parentHeight = host.offsetParent?.clientHeight || 0;
			const maxX = Math.max(0, parentWidth - host.offsetWidth);
			const maxY = Math.max(0, parentHeight - host.offsetHeight);
			let position;
			if (this.placement.anchor) {
				position = positions.find((item) => item.name === this.placement.anchor)
					|| positions.find((item) => item.name === 'bottom-center');
			} else if (Number.isFinite(this.placement.centerX) && Number.isFinite(this.placement.centerY)) {
				position = {
					x: this.placement.centerX * parentWidth - host.offsetWidth / 2,
					y: this.placement.centerY * parentHeight - host.offsetHeight / 2
				};
			} else {
				// Migrate the original top-left free-position preference to the new
				// center-based model without visibly moving the current bar.
				position = { x: this.placement.x, y: this.placement.y };
				this.placement = {
					centerX: (position.x + host.offsetWidth / 2) / Math.max(1, parentWidth),
					centerY: (position.y + host.offsetHeight / 2) / Math.max(1, parentHeight)
				};
				localStorage.setItem('glitterEditor_contextToolbarPlacement', JSON.stringify(this.placement));
			}
			this.setFreePosition(host, Math.min(maxX, Math.max(0, position.x)), Math.min(maxY, Math.max(0, position.y)));
			host.dataset.placement = this.placement.anchor || 'free';
		});
	}

	build(control) {
		if (control.kind === 'group') {
			const group = document.createElement('div');
			group.append(...control.controls.map((child) => this.build(child)));
			return group;
		}
		if (control.kind === 'button') {
			const node = document.getElementById('tpl-context-button').content.firstElementChild.cloneNode(true);
			node.id = control.id; node.title = control.title; node.dataset.action = control.action;
			node.querySelector('use').setAttribute('href', `#icon-${control.icon}`);
			node.querySelector('.name').textContent = control.name;
			node.addEventListener('click', () => COMMANDS[control.action]?.run(this.editor));
			return node;
		}
		if (control.kind === 'readout') {
			const node = document.createElement('button');
			node.type = 'button';
			node.className = 'zoom-percentage'; node.id = control.id; node.title = control.title; node.textContent = control.value;
			node.setAttribute('aria-label', `${control.value}. ${control.title}`);
			node.addEventListener('click', () => COMMANDS[control.action]?.run(this.editor));
			return node;
		}
		if (control.kind === 'segmented') {
			const node = document.createElement('div');
			node.className = 'segmented-control context-segmented-control';
			node.id = control.id;
			node.setAttribute('role', 'group');
			node.setAttribute('aria-label', 'Brush mode');
			node.append(...control.options.map((option) => {
				const button = document.createElement('button');
				button.type = 'button';
				button.className = 'segmented-option';
				button.textContent = option.label;
				if (option.title) button.title = option.title;
				if (option.mode) button.dataset.brushMode = option.mode;
				button.setAttribute('aria-pressed', 'false');
				button.addEventListener('click', () => COMMANDS[option.action]?.run(this.editor));
				return button;
			}));
			return node;
		}
		if (control.kind === 'slider') {
			const spec = control.slider ? CONFIG.ui.sliders[control.slider] : control;
			const node = document.getElementById('tpl-context-slider').content.firstElementChild.cloneNode(true);
			node.querySelector('.context-label').textContent = control.label || spec.label;
			const input = node.querySelector('input'); input.id = control.id; input.min = spec.min; input.max = spec.max; input.value = spec.value;
			input.setAttribute('aria-label', control.label || spec.label);
			const value = node.querySelector('.context-value'); value.id = control.valueId; value.textContent = `${spec.value}${control.unit || spec.unit || ''}`;
			return node;
		}
		const node = document.getElementById('tpl-context-toggle').content.firstElementChild.cloneNode(true);
		node.querySelector('input').id = control.id; node.querySelector('.context-toggle-label').textContent = control.label;
		const count = node.querySelector('.context-count'); if (control.countId) count.id = control.countId; else count.remove();
		return node;
	}

	setValue(id, value) { const node = document.getElementById(id); if (node) node.textContent = value; }
	setEnabled(id, enabled) { const node = document.getElementById(id); if (node) node.disabled = !enabled; }
}

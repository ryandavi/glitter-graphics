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
			handle.title = 'Drag to move · Alt for precision · Esc to cancel · Double-click to reset';
			handle.innerHTML = '<span class="drag-handle-mark" aria-hidden="true"></span>';
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

	// Returning the bar home is reachable two ways: double-clicking its handle,
	// and Settings — a bar dragged off screen has to be recoverable from a menu.
	resetPlacement() {
		this.savePlacement({ anchor: 'bottom-center' });
		this.hosts.forEach((item) => this.applyPlacement(item));
	}

	bindPlacement(host, handle) {
		this.applyPlacement(host);
		handle.addEventListener('dblclick', () => {
			this.resetPlacement();
			this.editor.updateStatus?.('Context bar position reset');
		});

		handle.addEventListener('pointerdown', (event) => {
			if (matchMedia(`(max-width: ${CONFIG.ui.mobile.breakpoint}px)`).matches || event.button !== 0) return;
			event.preventDefault();
			this.showSnapPreview(host, null);
			this.showSnapTargets(host);
			const container = host.offsetParent;
			if (!container) return;
			const containerRect = container.getBoundingClientRect();
			const hostRect = host.getBoundingClientRect();
			const offsetX = event.clientX - hostRect.left;
			const offsetY = event.clientY - hostRect.top;
			host.classList.add('is-dragging');
			handle.setPointerCapture(event.pointerId);
			const startingPlacement = { ...this.placement };
			let finished = false;

			const move = (moveEvent) => {
				const maxX = Math.max(0, containerRect.width - host.offsetWidth);
				const maxY = Math.max(0, containerRect.height - host.offsetHeight);
				const x = Math.min(maxX, Math.max(0, moveEvent.clientX - containerRect.left - offsetX));
				const y = Math.min(maxY, Math.max(0, moveEvent.clientY - containerRect.top - offsetY));
				this.setFreePosition(host, x, y);
				const snap = moveEvent.altKey ? null : this.nearestAnchor(host, x, y);
				this.showSnapPreview(host, snap);
			};
			const end = (cancelled = false) => {
				if (finished) return;
				finished = true;
				host.classList.remove('is-dragging');
				const x = parseFloat(host.style.left) || 0;
				const y = parseFloat(host.style.top) || 0;
				const snap = this.previewedSnap;
				const parentWidth = host.offsetParent?.clientWidth || host.offsetWidth;
				const parentHeight = host.offsetParent?.clientHeight || host.offsetHeight;
				const finalX = snap?.x ?? x;
				const finalY = snap?.y ?? y;
				this.savePlacement(cancelled ? startingPlacement : {
					horizontal: snap?.horizontal || null,
					vertical: snap?.vertical || null,
					centerX: (finalX + host.offsetWidth / 2) / parentWidth,
					centerY: (finalY + host.offsetHeight / 2) / parentHeight
				});
				this.showSnapPreview(host, null);
				this.hideSnapTargets();
				this.hosts.forEach((item) => this.applyPlacement(item));
				handle.removeEventListener('pointermove', move);
				handle.removeEventListener('pointerup', finish);
				handle.removeEventListener('pointercancel', cancel);
				document.removeEventListener('keydown', keydown, true);
			};
			const finish = () => end(false);
			const cancel = () => end(true);
			const keydown = (keyEvent) => {
				if (keyEvent.key !== 'Escape') return;
				keyEvent.preventDefault();
				cancel();
				this.editor.updateStatus?.('Context bar move cancelled');
			};
			handle.addEventListener('pointermove', move);
			handle.addEventListener('pointerup', finish);
			handle.addEventListener('pointercancel', cancel);
			document.addEventListener('keydown', keydown, true);
		});
	}

	anchorPositions(host) {
		const parent = host.offsetParent;
		const inset = 12;
		const parentRect = parent?.getBoundingClientRect();
		const topChromeBottom = [...document.querySelectorAll('#previewControls.visible > *, #helpfulMessage.visible')]
			.reduce((bottom, node) => Math.max(bottom, node.getBoundingClientRect().bottom - (parentRect?.top || 0)), 0);
		const safeTop = Math.min(Math.max(inset, topChromeBottom + inset), Math.max(inset, (parent?.clientHeight || 0) / 2));
		const maxX = Math.max(0, (parent?.clientWidth || 0) - host.offsetWidth);
		const maxY = Math.max(0, (parent?.clientHeight || 0) - host.offsetHeight);
		const centerX = maxX / 2;
		const centerY = Math.max(safeTop, maxY / 2);
		return {
			horizontal: [
				{ name: 'left', value: Math.min(inset, maxX) },
				{ name: 'center', value: centerX },
				{ name: 'right', value: Math.max(0, maxX - inset) }
			],
			vertical: [
				{ name: 'top', value: Math.min(safeTop, maxY) },
				{ name: 'center', value: centerY },
				{ name: 'bottom', value: Math.max(0, maxY - inset) }
			]
		};
	}

	nearestAnchor(host, x, y) {
		const threshold = (host.offsetParent?.clientWidth || innerWidth) < 900 ? 22 : 32;
		const positions = this.anchorPositions(host);
		const nearest = (targets, value) => targets
			.map((target) => ({ ...target, distance: Math.abs(target.value - value) }))
			.sort((a, b) => a.distance - b.distance)[0];
		const horizontal = nearest(positions.horizontal, x);
		const vertical = nearest(positions.vertical, y);
		const snapX = horizontal.distance <= threshold ? horizontal : null;
		const snapY = vertical.distance <= threshold ? vertical : null;
		if (!snapX && !snapY) return null;
		return {
			name: `${snapX?.name || 'free'}-${snapY?.name || 'free'}`,
			horizontal: snapX?.name || null,
			vertical: snapY?.name || null,
			x: snapX?.value ?? x,
			y: snapY?.value ?? y
		};
	}

	showSnapTargets(host) {
		this.hideSnapTargets();
		const parent = host.offsetParent;
		if (!parent) return;
		const positions = this.anchorPositions(host);
		const layer = document.createElement('div');
		layer.className = 'context-toolbar-snap-targets';
		positions.horizontal.forEach(({ name, value }) => {
			const guide = document.createElement('i');
			guide.className = `is-vertical is-${name}`;
			guide.style.left = `${value + (name === 'center' ? host.offsetWidth / 2 : name === 'right' ? host.offsetWidth : 0)}px`;
			layer.appendChild(guide);
		});
		positions.vertical.forEach(({ name, value }) => {
			const guide = document.createElement('i');
			guide.className = `is-horizontal is-${name}`;
			guide.style.top = `${value + (name === 'center' ? host.offsetHeight / 2 : name === 'bottom' ? host.offsetHeight : 0)}px`;
			layer.appendChild(guide);
		});
		parent.appendChild(layer);
		this.snapTargets = layer;
	}

	hideSnapTargets() {
		this.snapTargets?.remove();
		this.snapTargets = null;
	}

	showSnapPreview(host, snap) {
		const previousName = this.previewedSnap?.name || null;
		const nextName = snap?.name || null;
		if (previousName === nextName && this.snapGuide?.isConnected === Boolean(snap)) return;
		this.previewedSnap = snap;
		this.snapTargets?.querySelectorAll('.is-active').forEach((guide) => guide.classList.remove('is-active'));
		if (snap?.horizontal) this.snapTargets?.querySelector(`.is-vertical.is-${snap.horizontal}`)?.classList.add('is-active');
		if (snap?.vertical) this.snapTargets?.querySelector(`.is-horizontal.is-${snap.vertical}`)?.classList.add('is-active');
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
				const [verticalName, horizontalName] = this.placement.anchor === 'center'
					? ['center', 'center'] : this.placement.anchor.split('-');
				position = {
					x: positions.horizontal.find((item) => item.name === horizontalName)?.value ?? maxX / 2,
					y: positions.vertical.find((item) => item.name === verticalName)?.value ?? maxY
				};
			} else if (Number.isFinite(this.placement.centerX) && Number.isFinite(this.placement.centerY)) {
				position = {
					x: positions.horizontal.find((item) => item.name === this.placement.horizontal)?.value
						?? this.placement.centerX * parentWidth - host.offsetWidth / 2,
					y: positions.vertical.find((item) => item.name === this.placement.vertical)?.value
						?? this.placement.centerY * parentHeight - host.offsetHeight / 2
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

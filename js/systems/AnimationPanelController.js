'use strict';

class AnimationPanelController {
	constructor(editor) {
		this.editor = editor;
		this.prefixByType = new Map([
			[LayerType.GLITTER_FILL, 'glitter'], [LayerType.STICKER, 'sticker'],
			[LayerType.TEXT_GLITTER, 'text'], [LayerType.SHAPE, 'shape']
		]);
		this.fields = {
			PeriodMs: 'periodMs', Amount: 'amount', Angle: 'angle', Distance: 'distance', Radius: 'radius',
			Turns: 'turns', Duty: 'duty', OpacityFloor: 'opacityFloor',
			DelayMs: 'delayMs', Phase: 'phase', AnchorX: 'anchorX', AnchorY: 'anchorY'
		};
		this.selectedByLayer = new Map();
		this.prefixByType.forEach((_prefix, type) => this._bind(type));
		this.pauseButton = document.getElementById('pauseMotionTool');
		this.pauseButton?.addEventListener('click', () => this.setPaused(!this.editor.animationTicker.paused));
	}

	setPaused(paused) {
		this.editor.animationTicker.setPaused(paused);
		if (this.pauseButton) {
			this.pauseButton.classList.toggle('active', paused);
			this.pauseButton.setAttribute('aria-pressed', String(paused));
			this.pauseButton.title = paused ? 'Resume motion' : 'Pause motion';
			this.pauseButton.querySelector('.name').textContent = paused ? 'Resume motion' : 'Pause motion';
		}
		this.editor.layerManager.layers.forEach((layer) => {
			if (layer.type !== LayerType.STICKER || !layer.stickerData?.isAnimated) return;
			const image = this.editor.stickerManager.layerElements.get(layer.id)?.querySelector('img.sticker-image');
			if (!image) return;
			if (!paused) {
				if (image.dataset.motionSource) image.src = image.dataset.motionSource;
				delete image.dataset.motionSource;
				return;
			}
			if (image.dataset.motionSource) return;
			image.dataset.motionSource = layer.stickerData.url;
			const firstFrame = new Image();
			firstFrame.onload = () => {
				if (!this.editor.animationTicker.paused || !image.isConnected) return;
				const canvas = createAppCanvas(0, 0, 'systems/AnimationPanelController');
				canvas.width = firstFrame.naturalWidth;
				canvas.height = firstFrame.naturalHeight;
				canvas.getContext('2d').drawImage(firstFrame, 0, 0);
				image.src = canvas.toDataURL('image/png');
			};
			firstFrame.src = layer.stickerData.url;
		});
	}

	_id(prefix, suffix) {
		return document.getElementById(`${prefix}Anim${suffix}`);
	}

	_active(type) {
		const layer = this.editor.layerManager.getActiveLayer();
		return layer?.type === type ? layer : null;
	}

	_animations(layer) {
		return Array.isArray(layer?.animations) ? layer.animations : [];
	}

	_selectedIndex(layer) {
		const animations = this._animations(layer);
		const requested = this.selectedByLayer.get(layer.id) || 0;
		return Math.max(0, Math.min(animations.length - 1, requested));
	}

	_selected(layer) {
		return this._animations(layer)[this._selectedIndex(layer)] || null;
	}

	_createDefault(layer, type = CONFIG.tools.animation.defaultType) {
		const animation = GlitterAnimation.normalizeAnimation({ type });
		if (layer.type === LayerType.STICKER && layer.stickerData?.isPixelated !== false) animation.snapMode = 'pixel-snap';
		return animation;
	}

	_renderStack(prefix, layer) {
		const host = this._id(prefix, 'Stack');
		if (!host) return;
		const animations = this._animations(layer);
		host.hidden = animations.length < 2;
		host.replaceChildren();
		animations.forEach((animation, index) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'segmented-option animation-stack-item';
			button.classList.toggle('active', index === this._selectedIndex(layer));
			button.setAttribute('aria-pressed', String(index === this._selectedIndex(layer)));
			button.textContent = `${index + 1}. ${GlitterAnimation.summaryText(animation)}`;
			button.addEventListener('click', () => {
				this.selectedByLayer.set(layer.id, index);
				this.load(layer);
			});
			host.appendChild(button);
		});
		const remove = this._id(prefix, 'Remove');
		if (remove) remove.disabled = animations.length < 2;
		const add = this._id(prefix, 'Add');
		if (add) {
			const atLimit = animations.length >= CONFIG.tools.animation.maxStackSize;
			add.disabled = atLimit;
			add.title = atLimit ? `Maximum of ${CONFIG.tools.animation.maxStackSize} animations` : '';
		}
	}

	_renderLayer(layer) {
		const manager = getLayerManagerForType(this.editor, layer.type);
		if (layer.type === LayerType.GLITTER_FILL) {
			manager?.renderLayer?.(layer, this.editor.originalCanvas.width, this.editor.originalCanvas.height);
			return;
		}
		manager?.renderLayer?.(layer);
	}

	_render(layer, commit = false) {
		this._renderLayer(layer);
		this.load(layer);
		if (commit) this.editor.saveState('Edit animation');
	}

	_updateLayerAnchor(layer, anchor) {
		const manager = getLayerManagerForType(this.editor, layer.type);
		if (manager?.updateTransform) manager.updateTransform(layer.id, { anchor });
		else {
			layer.transform = { ...getLayerTransform(layer), anchor };
			this._renderLayer(layer);
		}
		const prefix = LAYER_UI_CONFIG[layer.type]?.transformPrefix;
		if (prefix) this.editor.loadTransformSettings?.(layer, prefix);
	}

	_bind(type) {
		const prefix = this.prefixByType.get(type);
		this._id(prefix, 'Enabled')?.addEventListener('change', (event) => {
			const layer = this._active(type);
			if (!layer) return;
			if (event.target.checked) {
				layer.animations = [this._createDefault(layer)];
				this.selectedByLayer.set(layer.id, 0);
			} else {
				delete layer.animations;
				this.selectedByLayer.delete(layer.id);
			}
			this._render(layer, true);
		});
		this._id(prefix, 'Type')?.addEventListener('change', (event) => {
			const layer = this._active(type);
			const animation = this._selected(layer);
			if (!animation) return;
			layer.animations[this._selectedIndex(layer)] = this._createDefault(layer, event.target.value);
			this._render(layer, true);
		});
		this._id(prefix, 'Add')?.addEventListener('click', () => {
			const layer = this._active(type);
			if (!layer || this._animations(layer).length >= CONFIG.tools.animation.maxStackSize) return;
			layer.animations ||= [];
			layer.animations.push(this._createDefault(layer));
			this.selectedByLayer.set(layer.id, layer.animations.length - 1);
			this._render(layer, true);
		});
		this._id(prefix, 'Remove')?.addEventListener('click', () => {
			const layer = this._active(type);
			if (!layer || this._animations(layer).length < 2) return;
			const index = this._selectedIndex(layer);
			layer.animations.splice(index, 1);
			this.selectedByLayer.set(layer.id, Math.min(index, layer.animations.length - 1));
			this._render(layer, true);
		});
		const cyclePreset = (direction) => {
			const select = this._id(prefix, 'Type');
			if (!select?.options.length) return;
			const current = select.selectedIndex < 0 ? 0 : select.selectedIndex;
			select.selectedIndex = (current + direction + select.options.length) % select.options.length;
			select.dispatchEvent(new Event('change', { bubbles: true }));
		};
		this._id(prefix, 'PresetPrev')?.addEventListener('click', () => cyclePreset(-1));
		this._id(prefix, 'PresetNext')?.addEventListener('click', () => cyclePreset(1));
		this.fields && Object.entries(this.fields).forEach(([suffix, field]) => {
			const slider = this._id(prefix, suffix);
			if (!slider) return;
			const sliderRole = slider.closest('.property-row')?.dataset.role?.replace(/-row$/, '');
			bindSlider(slider, this._id(prefix, `${suffix}Value`), {
				suffix: FIELDS[sliderRole]?.unit || '',
				parseValue: Number,
				apply: (value) => {
					const layer = this._active(type);
					const animation = this._selected(layer);
					if (!animation) return;
					if (field === 'anchorX' || field === 'anchorY') {
						const key = field.endsWith('X') ? 'x' : 'y';
						if (animation.type === 'orbit') animation[`orbitCenter${key.toUpperCase()}`] = value / 100;
						else this._updateLayerAnchor(layer, { ...getLayerTransform(layer).anchor, [key]: value / 100 });
					} else animation[field] = field === 'phase' ? value / 100 : value;
					this._renderLayer(layer);
					this._syncSummary(prefix, layer.animations, animation);
				},
				onCommit: () => {
					const layer = this._active(type);
					this.editor.saveState(this._selected(layer)?.type !== 'orbit' && (field === 'anchorX' || field === 'anchorY') ? 'Change anchor' : 'Edit animation');
				}
			});
		});
		['Easing', 'Direction', 'FillMode', 'Anchor', 'SnapMode'].forEach((suffix) => {
			this._id(prefix, suffix)?.addEventListener('change', (event) => {
				const layer = this._active(type);
				const animation = this._selected(layer);
				if (!animation) return;
				const field = suffix.charAt(0).toLowerCase() + suffix.slice(1);
				if (field === 'anchor') {
					if (event.target.value === 'custom') return;
					const [x, y] = event.target.value.split(',').map(Number);
					if (animation.type === 'orbit') {
						animation.orbitCenter = event.target.value;
						animation.orbitCenterX = x;
						animation.orbitCenterY = y;
					}
					else {
						this._updateLayerAnchor(layer, { x, y });
					}
				} else animation[field] = event.target.value;
				this._render(layer);
				this.editor.saveState(field === 'anchor' && animation.type !== 'orbit' ? 'Change anchor' : 'Edit animation');
			});
		});
		this._id(prefix, 'Iterations')?.addEventListener('change', (event) => {
			const layer = this._active(type);
			const animation = this._selected(layer);
			if (!animation) return;
			animation.iterations = event.target.value === 'Infinity' ? Infinity : Number(event.target.value);
			this._render(layer, true);
		});
		this._id(prefix, 'Steps')?.addEventListener('change', (event) => {
			const layer = this._active(type);
			const animation = this._selected(layer);
			if (!animation) return;
			animation.steps = Math.max(2, Math.min(60, Number(event.target.value) || 2));
			this._render(layer, true);
		});
	}

	_syncSummary(prefix, animations, selected = animations?.[0]) {
		const summary = this._id(prefix, 'Summary');
		if (summary) summary.textContent = GlitterAnimation.summaryText(animations);
		const hint = this._id(prefix, 'LoopHint');
		if (hint) hint.textContent = Number.isFinite(selected?.iterations)
			? 'Plays a fixed number of times'
			: (GlitterAnimation.isSeamlessLoop(selected) ? 'Loops seamlessly' : 'Restarts abruptly each loop');
	}

	load(layer) {
		const prefix = this.prefixByType.get(layer?.type);
		if (!prefix) return;
		const enabled = GlitterAnimation.isActive(layer.animations);
		// Same contract as every other effect module (shadow, border, pixel
		// effects): the card's own is-collapsed accordion shows/hides the body,
		// so there's no separate content wrapper to toggle by hand here.
		syncPanelEffectToggle(this._id(prefix, 'Enabled'), enabled);
		this._syncSummary(prefix, layer.animations, this._selected(layer));
		if (!enabled) return;
		layer.animations = GlitterAnimation.normalizeAnimations(layer.animations);
		const data = this._selected(layer);
		this._renderStack(prefix, layer);
		const anchorControl = this._id(prefix, 'Anchor');
		const anchorRow = anchorControl?.closest('.property-row');
		const anchorLabel = anchorRow?.querySelector('.property-label');
		if (anchorLabel) anchorLabel.textContent = data.type === 'orbit' ? 'Orbit center' : 'Anchor';
		if (anchorRow) {
			let note = anchorRow.nextElementSibling?.matches('.animation-anchor-note') ? anchorRow.nextElementSibling : null;
			if (!note) {
				note = document.createElement('div');
				note.className = 'property-note animation-anchor-note';
				anchorRow.after(note);
			}
			note.textContent = data.type === 'orbit' ? 'Sets the center of the orbit path.' : 'Also sets the layer transform anchor.';
		}
		['Type', 'Easing', 'Direction', 'FillMode', 'Anchor', 'SnapMode'].forEach((suffix) => {
			const control = this._id(prefix, suffix);
			const field = suffix.charAt(0).toLowerCase() + suffix.slice(1);
			if (control) {
				if (field === 'anchor') control.value = data.type === 'orbit' ? this._orbitPreset(data) : this._anchorPreset(getLayerTransform(layer).anchor);
				else control.value = data[field];
			}
		});
		const iterations = this._id(prefix, 'Iterations');
		if (iterations) iterations.value = Number.isFinite(data.iterations) ? String(data.iterations) : 'Infinity';
		const steps = this._id(prefix, 'Steps');
		if (steps) steps.value = data.steps;
		Object.entries(this.fields).forEach(([suffix, field]) => {
			const control = this._id(prefix, suffix);
			if (!control) return;
			let source = data[field];
			if (field === 'anchorX' || field === 'anchorY') {
				const key = field.endsWith('X') ? 'x' : 'y';
				source = data.type === 'orbit' ? data[`orbitCenter${key.toUpperCase()}`] : getLayerTransform(layer).anchor[key];
			}
			const value = ['phase', 'anchorX', 'anchorY'].includes(field) ? source * 100 : source;
			writeSliderValue(control, value);
			const readout = this._id(prefix, `${suffix}Value`);
			if (!readout) return;
			const sliderRole = control.closest('.property-row')?.dataset.role?.replace(/-row$/, '');
			const rounded = Math.round(value * 10) / 10;
			readout.innerHTML = formatUnit(rounded, FIELDS[sliderRole]?.unit || '');
		});
		const rows = {
			// Intensity only does something where pose() actually reads `amount`
			// (drift falls back to it when Distance is 0, so it stays listed).
			Amount: ['breath', 'float', 'sway', 'drift', 'pulse', 'heartbeat', 'bounce', 'shake', 'tremble', 'wobble', 'jello', 'tada', 'swing', 'rubber-band', 'zoom', 'rotate', 'glint'],
			Angle: ['move', 'bounce', 'drift', 'marquee', 'float', 'flip'], Distance: ['move', 'drift', 'marquee'], Radius: ['orbit', 'ping'],
			Turns: ['rotate', 'flip'], Duty: ['blink', 'twinkle', 'glint'], OpacityFloor: ['dim', 'twinkle', 'ping', 'move']
		};
		Object.entries(rows).forEach(([suffix, types]) => {
			const row = this._id(prefix, `${suffix}Row`);
			if (row) row.hidden = !types.includes(data.type);
		});
		const stepsRow = this._id(prefix, 'Steps')?.closest('.property-row');
		if (stepsRow) stepsRow.hidden = data.easing !== 'steps';
		['AnchorX', 'AnchorY'].forEach((suffix) => {
			const row = this._id(prefix, `${suffix}Row`);
			if (row) row.hidden = (data.type === 'orbit' ? this._orbitPreset(data) : this._anchorPreset(getLayerTransform(layer).anchor)) !== 'custom';
		});
		this._syncSummary(prefix, layer.animations, data);
	}

	_anchorPreset(anchor) {
		const values = [0, 0.5, 1];
		const x = values.find((value) => Math.abs(value - anchor.x) < 1e-6);
		const y = values.find((value) => Math.abs(value - anchor.y) < 1e-6);
		if (x == null || y == null) return 'custom';
		return `${x},${y}`;
	}

	_orbitPreset(animation) {
		if (animation.orbitCenter === 'custom') return 'custom';
		const [x, y] = GlitterAnimation.resolveOrigin(animation, 'orbitCenter');
		return this._anchorPreset({ x, y });
	}
}

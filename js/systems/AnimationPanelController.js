'use strict';

class AnimationPanelController {
	constructor(editor) {
		this.editor = editor;
		this.prefixByType = new Map(Object.entries(LAYER_UI_CONFIG)
			.filter(([, config]) => config.animatable && config.transformPrefix)
			.map(([type, config]) => [type, config.transformPrefix]));

		this.selectedByLayer = new Map();
		this.previewFrames = new Map();
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
		if (!paused) this.previewFrames.clear();
		this.editor.requestPreviewUpdate();
	}

	getPreviewImageUrl(url) {
		if (!url || !this.editor.animationTicker.paused) return url;
		let entry = this.previewFrames.get(url);
		if (!entry) {
			entry = { url: null };
			this.previewFrames.set(url, entry);
			this.loadPreviewFrame(url).then(frameUrl => {
				entry.url = frameUrl;
				if (this.previewFrames.get(url) === entry && this.editor.animationTicker.paused) this.editor.requestPreviewUpdate();
			}).catch(error => {
				entry.url = url;
				console.warn('Could not pause preview image:', error);
			});
		}
		return entry.url || url;
	}

	async loadPreviewFrame(url) {
		const bytes = await fetchGifBytes(url);
		const canvas = createAppCanvas(0, 0, 'systems/AnimationPanelController');
		if (bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) {
			const reader = openGifReader(bytes);
			canvas.width = reader.width;
			canvas.height = reader.height;
			const pixels = new Uint8ClampedArray(reader.width * reader.height * 4);
			reader.decodeAndBlitFrameRGBA(0, pixels);
			canvas.getContext('2d').putImageData(new ImageData(pixels, reader.width, reader.height), 0, 0);
		} else {
			const image = await loadImageElement(url);
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			canvas.getContext('2d').drawImage(image, 0, 0);
		}
		return canvas.toDataURL('image/png');
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
		GlitterAnimation.ANIMATION_CONTROLS.filter((control) => control.field).forEach(({ suffix, key: field, field: spec, scale }) => {
			const slider = this._id(prefix, suffix);
			if (!slider) return;
			bindSlider(slider, this._id(prefix, `${suffix}Value`), {
				suffix: FIELDS[spec]?.unit || '',
				parseValue: Number,
				apply: (value) => {
					const layer = this._active(type);
					const animation = this._selected(layer);
					if (!animation) return;
					if (field === 'anchorX' || field === 'anchorY') {
						const key = field.endsWith('X') ? 'x' : 'y';
						if (this._anchorDefinition(animation).stores === 'motion') animation[`orbitCenter${key.toUpperCase()}`] = value / scale;
						else this._updateLayerAnchor(layer, { ...getLayerTransform(layer).anchor, [key]: value / scale });
					} else animation[field] = value / scale;
					this._renderLayer(layer);
					this._syncSummary(prefix, layer.animations, animation);
				},
				onCommit: () => {
					const layer = this._active(type);
					this.editor.saveState(this._anchorDefinition(this._selected(layer)).stores === 'layer' && (field === 'anchorX' || field === 'anchorY') ? 'Change anchor' : 'Edit animation');
				}
			});
		});
		GlitterAnimation.ANIMATION_CONTROLS.filter((control) => !control.field).forEach(({ suffix, key: field }) => {
			this._id(prefix, suffix)?.addEventListener('change', (event) => {
				const layer = this._active(type);
				const animation = this._selected(layer);
				if (!animation) return;
				if (field === 'anchor') {
					if (event.target.value === 'custom') return;
					const [x, y] = event.target.value.split(',').map(Number);
					if (this._anchorDefinition(animation).stores === 'motion') {
						animation.orbitCenter = event.target.value;
						animation.orbitCenterX = x;
						animation.orbitCenterY = y;
					}
					else {
						this._updateLayerAnchor(layer, { x, y });
					}
				} else animation[field] = event.target.value;
				this._render(layer);
				this.editor.saveState(field === 'anchor' && this._anchorDefinition(animation).stores === 'layer' ? 'Change anchor' : 'Edit animation');
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
			animation.steps = Math.max(FIELDS.animSteps.min, Math.min(FIELDS.animSteps.max, Number(event.target.value) || FIELDS.animSteps.value));
			this._render(layer, true);
		});
	}

	_syncSummary(prefix, animations, selected = animations?.[0]) {
		const summary = this._id(prefix, 'Summary');
		if (summary) summary.textContent = GlitterAnimation.summaryText(animations);
		const hint = this._id(prefix, 'LoopHint');
		if (hint) hint.textContent = Number.isFinite(selected?.iterations)
			? 'Plays a fixed number of times'
			: (GlitterAnimation.isSeamlessLoop(selected, getLayerAnimationSamplingContext(this.editor, this.editor.layerManager.getActiveLayer())) ? 'Loops seamlessly' : 'Restarts abruptly each loop');
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
		const anchor = this._anchorDefinition(data);
		if (anchorLabel) anchorLabel.textContent = anchor.label;
		const note = this._id(prefix, 'AnchorNote');
		if (note) note.textContent = anchor.note;
		const typeControl = this._id(prefix, 'Type');
		if (typeControl) typeControl.value = data.type;
		GlitterAnimation.ANIMATION_CONTROLS.filter((control) => !control.field).forEach(({ suffix, key }) => {
			const control = this._id(prefix, suffix);
			if (control) control.value = key === 'anchor' ? this._selectedAnchorPreset(layer, data) : data[key];
		});
		const iterations = this._id(prefix, 'Iterations');
		if (iterations) iterations.value = Number.isFinite(data.iterations) ? String(data.iterations) : 'Infinity';
		const steps = this._id(prefix, 'Steps');
		if (steps) steps.value = data.steps;
		GlitterAnimation.ANIMATION_CONTROLS.filter((control) => control.field).forEach(({ suffix, key: field, field: spec, scale }) => {
			const control = this._id(prefix, suffix);
			if (!control) return;
			let source = data[field];
			if (field === 'anchorX' || field === 'anchorY') {
				const key = field.endsWith('X') ? 'x' : 'y';
				source = this._anchorDefinition(data).stores === 'motion' ? data[`orbitCenter${key.toUpperCase()}`] : getLayerTransform(layer).anchor[key];
			}
			const value = source * scale;
			writeSliderValue(control, value);
			const readout = this._id(prefix, `${suffix}Value`);
			if (!readout) return;
			const rounded = Math.round(value * 10) / 10;
			readout.innerHTML = formatUnit(rounded, FIELDS[spec]?.unit || '');
		});
		const motion = GlitterAnimation.MOTION_REGISTRY[data.type];
		GlitterAnimation.ANIMATION_CONTROLS.filter((control) => control.field).forEach(({ key, suffix }) => {
			const row = this._id(prefix, `${suffix}Row`);
			if (row && !['periodMs', 'delayMs', 'phase', 'anchorX', 'anchorY'].includes(key)) row.hidden = !motion.fields.includes(key);
		});
		const stepsRow = this._id(prefix, 'Steps')?.closest('.property-row');
		if (stepsRow) stepsRow.hidden = data.easing !== 'steps';
		['AnchorX', 'AnchorY'].forEach((suffix) => {
			const row = this._id(prefix, `${suffix}Row`);
			if (row) row.hidden = this._selectedAnchorPreset(layer, data) !== 'custom';
		});
		this._syncSummary(prefix, layer.animations, data);
	}

	_anchorDefinition(animation) {
		return GlitterAnimation.MOTION_REGISTRY[animation?.type || CONFIG.tools.animation.defaultType].anchor;
	}

	_selectedAnchorPreset(layer, animation) {
		return this._anchorDefinition(animation).stores === 'motion'
			? this._orbitPreset(animation) : this._anchorPreset(getLayerTransform(layer).anchor);
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

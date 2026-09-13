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
			Turns: 'turns', Duty: 'duty', OpacityFloor: 'opacityFloor', Overshoot: 'overshoot',
			DelayMs: 'delayMs', Phase: 'phase', AnchorX: 'anchorX', AnchorY: 'anchorY'
		};
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
				const canvas = document.createElement('canvas');
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

	_bind(type) {
		const prefix = this.prefixByType.get(type);
		this._id(prefix, 'Enabled')?.addEventListener('change', (event) => {
			const layer = this._active(type);
			if (!layer) return;
			if (event.target.checked) {
				layer.animation = GlitterAnimation.normalizeAnimation({ type: CONFIG.tools.animation.defaultType });
				if (type === LayerType.STICKER && layer.stickerData?.isPixelated !== false) layer.animation.snapMode = 'pixel-snap';
			} else delete layer.animation;
			this._render(layer, true);
		});
		this._id(prefix, 'Type')?.addEventListener('change', (event) => {
			const layer = this._active(type);
			if (!layer) return;
			layer.animation = GlitterAnimation.normalizeAnimation({ type: event.target.value });
			if (type === LayerType.STICKER && layer.stickerData?.isPixelated !== false) layer.animation.snapMode = 'pixel-snap';
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
				suffix: CONFIG.ui.sliders[sliderRole]?.unit || '',
				parseValue: Number,
				apply: (value) => {
					const layer = this._active(type);
					if (!layer?.animation) return;
					layer.animation[field] = ['phase', 'anchorX', 'anchorY'].includes(field) ? value / 100 : value;
					this._renderLayer(layer);
					this._syncSummary(prefix, layer.animation);
				},
				onCommit: () => this.editor.saveState('Edit animation')
			});
		});
		['Easing', 'Direction', 'FillMode', 'Anchor', 'SnapMode'].forEach((suffix) => {
			this._id(prefix, suffix)?.addEventListener('change', (event) => {
				const layer = this._active(type);
				if (!layer?.animation) return;
				const field = suffix.charAt(0).toLowerCase() + suffix.slice(1);
				layer.animation[field] = event.target.value;
				this._render(layer, true);
			});
		});
		this._id(prefix, 'Iterations')?.addEventListener('change', (event) => {
			const layer = this._active(type);
			if (!layer?.animation) return;
			layer.animation.iterations = event.target.value === 'Infinity' ? Infinity : Number(event.target.value);
			this._render(layer, true);
		});
		this._id(prefix, 'Steps')?.addEventListener('change', (event) => {
			const layer = this._active(type);
			if (!layer?.animation) return;
			layer.animation.steps = Math.max(2, Math.min(60, Number(event.target.value) || 2));
			this._render(layer, true);
		});
	}

	_syncSummary(prefix, animation) {
		const summary = this._id(prefix, 'Summary');
		if (summary) summary.textContent = GlitterAnimation.summaryText(animation);
		const hint = this._id(prefix, 'LoopHint');
		if (hint) hint.textContent = Number.isFinite(animation?.iterations)
			? 'Plays a fixed number of times'
			: (GlitterAnimation.isSeamlessLoop(animation) ? 'Loops seamlessly' : 'Restarts abruptly each loop');
	}

	load(layer) {
		const prefix = this.prefixByType.get(layer?.type);
		if (!prefix) return;
		const enabled = Boolean(layer.animation && GlitterAnimation.isActive(layer.animation));
		// Same contract as every other effect module (shadow, border, pixel
		// effects): the card's own is-collapsed accordion shows/hides the body,
		// so there's no separate content wrapper to toggle by hand here.
		syncPanelEffectToggle(this._id(prefix, 'Enabled'), enabled);
		this._syncSummary(prefix, layer.animation);
		if (!enabled) return;
		const data = GlitterAnimation.normalizeAnimation(layer.animation);
		layer.animation = data;
		['Type', 'Easing', 'Direction', 'FillMode', 'Anchor', 'SnapMode'].forEach((suffix) => {
			const control = this._id(prefix, suffix);
			const field = suffix.charAt(0).toLowerCase() + suffix.slice(1);
			if (control) control.value = data[field];
		});
		const iterations = this._id(prefix, 'Iterations');
		if (iterations) iterations.value = Number.isFinite(data.iterations) ? String(data.iterations) : 'Infinity';
		const steps = this._id(prefix, 'Steps');
		if (steps) steps.value = data.steps;
		Object.entries(this.fields).forEach(([suffix, field]) => {
			const control = this._id(prefix, suffix);
			if (!control) return;
			const value = ['phase', 'anchorX', 'anchorY'].includes(field) ? data[field] * 100 : data[field];
			writeSliderValue(control, value);
			const readout = this._id(prefix, `${suffix}Value`);
			if (!readout) return;
			const sliderRole = control.closest('.property-row')?.dataset.role?.replace(/-row$/, '');
			const rounded = Math.round(value * 10) / 10;
			readout.innerHTML = formatUnit(rounded, CONFIG.ui.sliders[sliderRole]?.unit || '');
		});
		const rows = {
			// Intensity only does something where pose() actually reads `amount`
			// (drift falls back to it when Distance is 0, so it stays listed).
			Amount: ['breath', 'float', 'sway', 'drift', 'pulse', 'heartbeat', 'bounce', 'shake', 'tremble', 'wobble', 'jello', 'tada', 'swing', 'rubber-band', 'zoom', 'rotate'],
			Angle: ['move', 'bounce', 'drift', 'marquee', 'float', 'flip'], Distance: ['move', 'drift', 'marquee'], Radius: ['orbit', 'ping'],
			Turns: ['rotate', 'flip'], Duty: ['blink', 'twinkle'], OpacityFloor: ['dim', 'twinkle', 'ping', 'move'],
			Overshoot: ['tada', 'rubber-band']
		};
		Object.entries(rows).forEach(([suffix, types]) => {
			const row = this._id(prefix, `${suffix}Row`);
			if (row) row.hidden = !types.includes(data.type);
		});
		const stepsRow = this._id(prefix, 'Steps')?.closest('.property-row');
		if (stepsRow) stepsRow.hidden = data.easing !== 'steps';
		['AnchorX', 'AnchorY'].forEach((suffix) => {
			const row = this._id(prefix, `${suffix}Row`);
			if (row) row.hidden = data.anchor !== 'custom';
		});
		this._syncSummary(prefix, data);
	}
}

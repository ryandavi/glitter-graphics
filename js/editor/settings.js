'use strict';

// A setting that exists and matters but is currently held off by another
// control the reader can see. It stays in place, carries the real `disabled`
// property on its own controls, and says what to turn on. Hiding it instead
// would teach nothing; `pointer-events: none` alone would leave it reachable
// by Tab. Its revert is left alone: `disabled` there means "at the default",
// and a held-off value can still be put back.
function setSettingsRowInactive(row, inactive) {
	if (!row) return;
	row.classList.toggle('is-inactive', inactive);
	row.querySelectorAll('input, select, textarea, button:not(.property-revert)').forEach((control) => {
		control.disabled = inactive;
	});
	const reason = row.querySelector('[data-inactive-reason-text]');
	if (reason) reason.textContent = inactive ? (row.dataset.inactiveReason || '') : '';
}

// The keys a GIF Look writes. Declared once: the preset objects, the "editing
// one of these switches the look to Custom" rule, and the collapsed summary
// all read from this list, so they cannot drift apart.
const GIF_LOOK_GOVERNED_KEYS = Object.freeze([
	'colorCount', 'paletteStyle', 'ditherEnabled', 'ditherType',
	'ditherAmount', 'ditherScale', 'ditherTemporalMode', 'ditherEdgeProtection'
]);

const GIF_LOOK_PRESETS = Object.freeze({
	clean: { colorCount: 'auto', paletteStyle: 'balanced', ditherEnabled: false, ditherType: 'FloydSteinberg-serpentine', ditherAmount: 80, ditherScale: 1, ditherTemporalMode: 'stable', ditherEdgeProtection: true },
	classic: { colorCount: 128, paletteStyle: 'vivid', ditherEnabled: true, ditherType: 'FloydSteinberg-serpentine', ditherAmount: 80, ditherScale: 1, ditherTemporalMode: 'stable', ditherEdgeProtection: true },
	textured: { colorCount: 64, paletteStyle: 'vivid', ditherEnabled: true, ditherType: 'Bayer', ditherAmount: 90, ditherScale: 2, ditherTemporalMode: 'stable', ditherEdgeProtection: true },
	crunchy: { colorCount: 32, paletteStyle: 'vivid', ditherEnabled: true, ditherType: 'Bayer', ditherAmount: 100, ditherScale: 3, ditherTemporalMode: 'stable', ditherEdgeProtection: true },
	shimmer: { colorCount: 64, paletteStyle: 'vivid', ditherEnabled: true, ditherType: 'Bayer', ditherAmount: 80, ditherScale: 2, ditherTemporalMode: 'animated', ditherEdgeProtection: true }
});

// What the collapsed preset row says the current look actually means.
function describeGifLook(settings) {
	const patternNames = {
		'FloydSteinberg-serpentine': 'Floyd-Steinberg', FloydSteinberg: 'Floyd-Steinberg',
		FalseFloydSteinberg: 'False Floyd-Steinberg', Stucki: 'Stucki',
		Atkinson: 'Atkinson', Bayer: 'Bayer', Halftone: 'Halftone'
	};
	const parts = [settings.colorCount === 'auto' ? 'Automatic colors' : `${settings.colorCount} colors`];
	if (!settings.ditherEnabled) {
		parts.push('no dithering');
	} else {
		parts.push(patternNames[settings.ditherType] || 'dithered');
		parts.push(`${settings.ditherAmount}%`);
		if (settings.ditherScale > 1) parts.push(`${settings.ditherScale}\u00d7 scale`);
		if (settings.ditherTemporalMode === 'animated') parts.push('animated');
	}
	return parts.join(' \u00b7 ');
}

const EDITOR_SETTINGS_METHODS = {
saveSettingsToStorage() {
		const settings = this.settingsStore.serialize(this.exportSettings);

		try {
			localStorage.setItem('glitterEditorSettings', JSON.stringify(settings));
		} catch (e) {
			console.warn('Failed to save settings to localStorage:', e);
		}
	}

,
	loadSettingsFromStorage() {
		try {
			const saved = localStorage.getItem('glitterEditorSettings');
			if (saved) {
				return JSON.parse(saved);
			}
		} catch (e) {
			console.warn('Failed to load settings from localStorage:', e);
		}
		return null;
	}


	// ===== EXPORT SETTINGS =====

,
initializeExportSettings() {
	const savedSettings = this.loadSettingsFromStorage();
	this.settingsStore = new SettingsStore(EXPORT_SETTINGS_SCHEMA);
	this.exportSettings = this.settingsStore.load(savedSettings || {});
	this.interfaceTheme = document.documentElement.dataset.theme;
	this.applyInterfaceTheme();
	this.applyReduceMotion();
	this.applyShowAllControls();

	// Sync UI to match exportSettings
	this.syncExportSettingsToUI();

	// Setup listeners
	this.setupExportSettingsListeners();
	this.setupSettingsResetListeners();
}

,
	syncExportSettingsToUI() {
		this.settingsStore.syncToUI(this.exportSettings);
		const uiElements = {
			showHelpfulHints: { checked: PREFERENCES.get('showHints') },
			showWelcomeOnStartup: { checked: PREFERENCES.get('showWelcomeOnStartup') },
			confirmDestructiveActions: { checked: PREFERENCES.get('confirmDestructiveActions') },
			antialiasMaskEdges: { checked: !PREFERENCES.get('crispMaskEdges') },
			scaleEffectsOnTransform: { checked: PREFERENCES.get('scaleEffects') },
			scaleTexturesOnTransform: { checked: PREFERENCES.get('scaleTextures') },
			scaleCorners: { checked: PREFERENCES.get('scaleCorners') },
			autoSelectLayers: { checked: PREFERENCES.get('autoSelect') },
			snappingEnabled: { checked: PREFERENCES.get('snappingEnabled') },
			panInertia: { checked: PREFERENCES.get('panInertia') },
			pixelGrid: { checked: PREFERENCES.get('pixelGrid') },
			reduceMotion: { checked: PREFERENCES.get('reduceMotion') },
			showAllControls: { checked: PREFERENCES.get('showAllControls') },
			filterPreviewLevel: { value: PREFERENCES.get('filterPreviewLevel') },
			interfaceTheme: { value: this.interfaceTheme }
		};

		Object.entries(uiElements).forEach(([id, props]) => {
			const element = document.getElementById(id);
			if (!element) return;

			if ('value' in props) element.value = props.value;
			if ('checked' in props) element.checked = props.checked;
		});

		this.updateDitherDependentUI();
		this.updateMatteColorUI();
		this.updateWatermarkUI?.();
		this.updateGifLookSummary();
		this.updateExportFidelityUI();
		this.updateExportFormatUI();
		const ditherAmountValue = document.getElementById('exportDitherAmountValue');
		if (ditherAmountValue) ditherAmountValue.textContent = `${this.exportSettings.ditherAmount}%`;
		this.renderExportDitherPreview?.();
		// The controls above were written without events.
		syncFieldReverts();
	}

,
	// Everything the Dithering toggle governs. Inactive, not hidden: a person
	// needs to see that dithering has options in order to know why to turn it on.
	updateDitherDependentUI() {
		const inactive = !this.exportSettings.ditherEnabled;
		['ditherTypeRow', 'ditherAmountRow', 'ditherScaleRow', 'ditherTemporalModeRow', 'ditherEdgeProtectionRow']
			.forEach((id) => setSettingsRowInactive(document.getElementById(id), inactive));
	}

,
	updateMatteColorUI() {
		const target = getActiveExportTarget(this.exportSettings, { mp4Supported: this.mp4ExportSupported !== false });
		setSettingsRowInactive(
			document.getElementById('matteColorRow'),
			target.supportsTransparency && this.exportSettings.transparency
		);
	}

,
	// The collapsed preset row states what the current look means, so the eight
	// rows it wrote do not have to be expanded to be understood.
	updateGifLookSummary() {
		const summary = document.querySelector('[data-governed-summary]');
		if (summary) summary.textContent = describeGifLook(this.exportSettings);
	}

,
	renderExportDitherPreview() {
		const canvas = document.getElementById('exportDitherPreview');
		const description = document.getElementById('exportDitherPreviewDescription');
		if (!canvas || typeof GifPalette === 'undefined' || typeof GlitterPixelEffects === 'undefined') return;
		const width = canvas.width;
		const height = canvas.height;
		const source = new Uint8ClampedArray(width * height * 4);
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			const offset = (y * width + x) * 4;
			const t = x / (width - 1);
			source[offset] = Math.round(255 * (1 - t) + 255 * Math.max(0, (t - 0.55) / 0.45));
			source[offset + 1] = Math.round(225 * Math.max(0, (t - 0.45) / 0.55));
			source[offset + 2] = Math.round(210 * Math.min(1, t * 1.8) * (1 - Math.max(0, (t - 0.7) / 0.3)));
			if (y > 48 && x > 18 && x < 222) source[offset] = source[offset + 1] = source[offset + 2] = x < 120 ? 22 : 240;
			source[offset + 3] = 255;
		}
		const original = new ImageData(source, width, height);
		const count = GifPalette.resolveColorCount(this.exportSettings.colorCount, { observedColorCount: 1024 });
		// A deliberately constrained demonstration palette makes each texture
		// legible even when the actual export is set to Automatic/256 colors.
		const paletteBytes = GifPalette.build([original], Math.min(count, 16), { style: this.exportSettings.paletteStyle });
		const palette = [];
		for (let index = 0; index < paletteBytes.length; index += 3) palette.push(paletteBytes.slice(index, index + 3));
		const type = String(this.exportSettings.ditherType || '').toLowerCase();
		const algorithm = type.includes('atkinson') ? 'atkinson' : type.includes('falsefloyd') ? 'falsefloyd'
			: type.includes('stucki') ? 'stucki' : type.includes('bayer') ? 'bayer' : type.includes('halftone') ? 'halftone' : 'floyd';
		const pixels = GlitterPixelEffects.applyPixelEffects(source, width, height, {
			pixelateEnabled: false, paletteEnabled: true, pixelSize: 1, paletteMode: 'dither',
			dither: { algorithm, angle: 45, strength: this.exportSettings.ditherAmount, scale: this.exportSettings.ditherScale, edgeProtection: this.exportSettings.ditherEdgeProtection, serpentine: type.includes('serpentine'), shimmer: false, palette: 'auto', duotone: ['#000000', '#ffffff'] }
		}, { pixelEffects: CONFIG.tools.pixelEffects, autoGlitter: CONFIG.tools.autoGlitter }, 0, palette);
		canvas.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
		const descriptions = {
			floyd: 'Diffusion: organic, Photoshop-like gradient texture.', falsefloyd: 'False Floyd–Steinberg: sharper and rougher with fewer neighboring dots.',
			stucki: 'Stucki: soft, detailed diffusion with a wider texture field.', atkinson: 'Atkinson: airy Macintosh-style dots with stronger highlights.',
			bayer: 'Bayer: regular tiled pixels—the clearest early-web pattern.', halftone: 'Halftone: graphic printed dots rather than photographic diffusion.'
		};
		if (description) description.textContent = `${this.exportSettings.ditherEnabled ? '' : 'Preview only—export dithering is currently off. '}${descriptions[algorithm]}`;
	}

,
	updateWatermarkUI() {
		const enabled = Boolean(this.exportSettings.watermarkEnabled);
		// Governed by a toggle directly above it, so it stays visible and goes
		// inactive rather than disappearing — the same rule the dither rows use.
		setSettingsRowInactive(document.getElementById('watermarkSelectionRow'), !enabled);
		this.updateWatermarkPreview?.();
	}

,
	// A primary setting plus the rows it governs, which sit in the panel's
	// Advanced disclosure (its shared click handler toggles it). Closed by
	// default because the summary already states the effective values.
	setupGovernedSets() {
		this.setGifLookExpanded(this.exportSettings.ditherPreset === 'custom');
		this.setExportFidelityExpanded(false);
	}

,
	setGovernedSetExpanded(disclosure, expanded) {
		if (disclosure) setAdvancedDisclosureOpen(disclosure, expanded);
	}

,
	setGifLookExpanded(expanded) {
		this.setGovernedSetExpanded(document.getElementById('exportGifLookSet'), expanded);
	}

,
	setExportFidelityExpanded(expanded) {
		this.setGovernedSetExpanded(document.getElementById('exportFidelitySet'), expanded);
	}

,
	updateWatermarkPreview() {
		const preview = document.querySelector('#exportWatermarkPreview img');
		if (!preview) return;
		const option = CONFIG.export.watermark.options.find(({ url }) => url === this.exportSettings.watermark);
		preview.src = option?.url || CONFIG.export.defaults.watermark;
		preview.alt = `${option?.label || 'Selected'} watermark preview`;
	}

,
	setupExportSettingsListeners() {
		const presetControl = document.getElementById('exportDitherPreset');
		if (presetControl && !presetControl.dataset.bound) {
			presetControl.dataset.bound = 'true';
			presetControl.addEventListener('change', () => {
				const preset = GIF_LOOK_PRESETS[presetControl.value];
				// Picking a named look re-collapses the rail — the summary now
				// says everything it wrote. Custom keeps it open to be edited.
				this.setGifLookExpanded(!preset);
				if (!preset) return;
				Object.assign(this.exportSettings, preset, { ditherPreset: presetControl.value });
				this.saveSettingsToStorage();
				// `syncExportSettingsToUI` already pushes the values to the
				// controls; the old call here named a method that never existed,
				// so picking a look threw before it could refresh anything.
				this.syncExportSettingsToUI();
			});
		}
		this.setupGovernedSets();
		this.settingsStore.bindListeners(this.exportSettings, (key, value) => {
			if (presetControl && GIF_LOOK_GOVERNED_KEYS.includes(key)) {
				presetControl.value = 'custom';
				this.exportSettings.ditherPreset = 'custom';
			}
			this.saveSettingsToStorage();
			this.renderExportDitherPreview?.();
			this.updateGifLookSummary();
			this.updateExportFidelityUI();
			if (key === 'exportFidelity') this.setExportFidelityExpanded(false);
			this.updateExportDuration();
			if (key === 'ditherEnabled') this.updateDitherDependentUI();
			if (key === 'watermarkEnabled') this.updateWatermarkUI?.();
			if (key === 'watermark') {
				this.updateWatermarkPreview?.();
			}
			if (key === 'transparency' || key === 'mp4LengthMode') this.updateExportFormatUI();
			if (key === 'transparency' || key === 'format') this.updateMatteColorUI();
		});

		// Delegate live repeat changes so the duration remains bound even if modal
		// controls are reinitialized or replaced in a responsive UI rebuild.
		document.addEventListener('input', (event) => {
			if (event.target?.id === 'exportFidelity') {
				this.exportSettings.exportFidelity = Math.round(event.target.valueAsNumber);
				this.updateExportFidelityUI();
				this.updateExportDuration();
				this.saveSettingsToStorage();
				return;
			}
			if (event.target?.id === 'exportDitherAmount') {
				const value = Math.min(100, Math.max(0, Math.round(event.target.valueAsNumber / 5) * 5));
				this.exportSettings.ditherAmount = value;
				this.exportSettings.ditherPreset = 'custom';
				if (presetControl) presetControl.value = 'custom';
				const output = document.getElementById('exportDitherAmountValue');
				if (output) output.textContent = `${value}%`;
				this.renderExportDitherPreview?.();
				this.saveSettingsToStorage();
				return;
			}
			if (!['exportMp4LoopCount', 'exportMp4TargetDuration'].includes(event.target?.id)) return;
			const value = event.target.valueAsNumber;
			if (Number.isFinite(value)) {
				if (event.target.id === 'exportMp4LoopCount') this.exportSettings.mp4LoopCount = value;
				else this.exportSettings.mp4TargetDuration = value;
			}
			this.updateExportDuration();
		});

		document.querySelectorAll('#exportFormatControl [data-export-format]').forEach((button) => {
			button.addEventListener('click', () => {
				if (button.disabled) return;
				if (this.exportSettings.outputMode === 'still') this.exportSettings.stillFormat = button.dataset.exportFormat;
				else this.exportSettings.animationFormat = button.dataset.exportFormat;
				this.updateExportFormatUI();
				this.saveSettingsToStorage();
			});
		});
		document.querySelectorAll('#exportModeControl [data-export-mode]').forEach((button) => {
			button.addEventListener('click', () => {
				this.exportSettings.outputMode = button.dataset.exportMode;
				this.updateExportFormatUI();
				this.saveSettingsToStorage();
			});
		});
		// Type and Format are button groups, so their reverts are bound here;
		// updateExportFormatUI keeps them inert at the default.
		document.querySelector('[data-revert-for="exportModeControl"]')?.addEventListener('click', () => {
			this.exportSettings.outputMode = CONFIG.export.defaults.outputMode;
			this.updateExportFormatUI();
			this.saveSettingsToStorage();
		});
		document.querySelector('[data-revert-for="exportFormatControl"]')?.addEventListener('click', () => {
			const key = this.exportSettings.outputMode === 'still' ? 'stillFormat' : 'animationFormat';
			this.exportSettings[key] = CONFIG.export.defaults[key];
			this.updateExportFormatUI();
			this.saveSettingsToStorage();
		});

		Mp4Exporter.isSupported().then((supported) => {
			this.mp4ExportSupported = supported;
			if (!supported && this.exportSettings.animationFormat === 'mp4') { this.exportSettings.animationFormat = 'gif'; this.saveSettingsToStorage(); }
			this.updateExportFormatUI();
		}).catch(() => {
			this.mp4ExportSupported = false;
			if (this.exportSettings.animationFormat === 'mp4') { this.exportSettings.animationFormat = 'gif'; this.saveSettingsToStorage(); }
			this.updateExportFormatUI();
		});

		this.bindPreferenceToggle('showHelpfulHints', 'showHints', () => this.updateHelpfulMessage());
		this.bindPreferenceToggle('showWelcomeOnStartup', 'showWelcomeOnStartup');
		this.bindPreferenceToggle('confirmDestructiveActions', 'confirmDestructiveActions');
		this.bindPreferenceToggle('scaleEffectsOnTransform', 'scaleEffects');
		this.bindPreferenceToggle('scaleCorners', 'scaleCorners');
		this.bindPreferenceToggle('scaleTexturesOnTransform', 'scaleTextures');
		document.getElementById('antialiasMaskEdges')?.addEventListener('change', (e) => {
			PREFERENCES.set('crispMaskEdges', !e.target.checked);
			this.refreshMaskEdgeRendering();
			this.updateStatus(e.target.checked ? 'Antialiasing enabled for mask edges' : 'Crisp mask edges enabled');
		});

		const themeInput = document.getElementById('interfaceTheme');
		themeInput?.addEventListener('change', (e) => {
			this.interfaceTheme = CONFIG.ui.themes.includes(e.target.value) ? e.target.value : 'dark';
			this.applyInterfaceTheme();
			this.saveSettingsToStorage();
		});

		// Preferences that used to be reachable only from a transient canvas
		// control. The canvas controls stay; Settings is simply where a person
		// looks to find out whether they are on.
		this.bindPreferenceToggle('autoSelectLayers', 'autoSelect', (value) => {
			const canvasToggle = document.getElementById('contextAutoSelect');
			if (canvasToggle) canvasToggle.checked = value;
		});
		this.bindPreferenceToggle('snappingEnabled', 'snappingEnabled', (value) => {
			document.getElementById('snappingToggle')?.classList.toggle('active', value);
		});
		this.bindPreferenceToggle('panInertia', 'panInertia');
		this.bindPreferenceToggle('pixelGrid', 'pixelGrid', () => this.viewport?.applyTransform());
		this.bindPreferenceToggle('reduceMotion', 'reduceMotion', () => this.applyReduceMotion());
		this.bindPreferenceToggle('showAllControls', 'showAllControls', () => this.applyShowAllControls());
		const filterPreviewLevel = document.getElementById('filterPreviewLevel');
		filterPreviewLevel?.addEventListener('change', () => {
			const value = ['off', 'still', 'animated'].includes(filterPreviewLevel.value) ? filterPreviewLevel.value : 'still';
			PREFERENCES.set('filterPreviewLevel', value);
			this.filterLayerManager?.refreshSnapshots();
			this.layerManager?.renderLayersList();
			this.saveSettingsToStorage();
		});

		document.getElementById('resetToolbarPlacement')?.addEventListener('click', () => this.resetToolbarPlacement());
	}

,
	bindPreferenceToggle(elementId, preferenceKey, onChange = null) {
		const input = document.getElementById(elementId);
		if (!input || input.dataset.bound === 'true') return;
		input.dataset.bound = 'true';
		input.addEventListener('change', () => {
			PREFERENCES.set(preferenceKey, input.checked);
			this.saveSettingsToStorage();
			onChange?.(input.checked);
		});
	}

,
	applyShowAllControls() {
		const showAll = PREFERENCES.get('showAllControls');
		if (showAll) document.documentElement.dataset.showAllControls = 'true';
		else delete document.documentElement.dataset.showAllControls;
		document.querySelectorAll('[data-advanced]').forEach((disclosure) => setAdvancedDisclosureOpen(disclosure, showAll));
	}

,
	applyReduceMotion() {
		// Only stamp the attribute when the preference is on, so the universal
		// selector it gates never has to be evaluated in the common case.
		if (PREFERENCES.get('reduceMotion')) document.documentElement.dataset.reduceMotion = 'true';
		else delete document.documentElement.dataset.reduceMotion;
		this.animationTicker?.refresh();
	}

,
	async resetToolbarPlacement() {
		const confirmed = await this.confirmSettingsAction({
			title: 'Reset Toolbar Position',
			message: 'The floating tool bar returns to its default position at the bottom of the canvas.',
			confirmLabel: 'Reset Toolbar'
		});
		if (!confirmed) return;
		this.contextToolbarRenderer?.resetPlacement?.();
		this.updateStatus('Toolbar position reset');
	}

,
	updateExportFormatUI() {
		const target = getActiveExportTarget(this.exportSettings, { mp4Supported: this.mp4ExportSupported !== false });
		const isMp4 = target.isVideo;
		const formatDescription = document.getElementById('exportFormatDescription');
		if (formatDescription) {
			let description = {
				'still:png': 'Export a lossless still image with optional transparency.',
				'still:jpeg': 'Export a compressed still image. Transparent areas use the matte color.',
				'still:gif': 'Export one selected frame as a palette-based GIF.',
				'animation:gif': 'Export an animated GIF.',
				'animation:mp4': 'Export an H.264 video.'
			}[target.id];
			const pixelLooks = this.layers.filter((layer) => layer.visible && layer.type === LayerType.FILTER && GlitterFilters.tier(layer.filterData) === 3);
			if (pixelLooks.length) description += ` Active pixel look${pixelLooks.length === 1 ? '' : 's'}: ${pixelLooks.map((layer) => GlitterFilter.summaryText(layer.filterData)).join(', ')}.`;
			if (target.isGif && pixelLooks.some((layer) => ['dither', 'posterize'].includes(layer.filterData.type))) description += ' Clean GIF Look avoids quantizing these pixels a second time.';
			if (target.isGif && pixelLooks.some((layer) => layer.filterData.type === 'jpeg-crunch')) description += ' JPEG Crunch can make the GIF larger.';
			formatDescription.textContent = description;
		}
		document.querySelectorAll('#exportModeControl [data-export-mode]').forEach((button) => {
			const active = button.dataset.exportMode === target.mode;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
		});
		document.querySelectorAll('#exportFormatControl [data-export-format]').forEach((button) => {
			const format = button.dataset.exportFormat;
			const inMode = button.dataset.exportMode === target.mode;
			const active = inMode && format === target.format;
			button.hidden = !inMode;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
			if (format === 'mp4') {
				const supported = this.mp4ExportSupported === true;
				button.hidden = !inMode || !supported;
				button.disabled = !supported;
				button.title = supported ? '' : 'MP4 export requires WebCodecs H.264 support in this browser.';
			}
		});
		const modeRevert = document.querySelector('[data-revert-for="exportModeControl"]');
		if (modeRevert) modeRevert.disabled = target.mode === CONFIG.export.defaults.outputMode;
		const formatRevert = document.querySelector('[data-revert-for="exportFormatControl"]');
		if (formatRevert) formatRevert.disabled = target.format === CONFIG.export.defaults[target.isStill ? 'stillFormat' : 'animationFormat'];
		document.querySelectorAll('[data-export-format-section="gif"]').forEach((row) => row.hidden = !target.isGif);
		document.querySelectorAll('[data-export-format-section="mp4"]').forEach((row) => row.hidden = !target.isVideo);
		document.getElementById('transparencySettingsRow').hidden = !target.supportsTransparency;
		document.getElementById('exportStillFrameRow').hidden = !target.isStill || !this.hasAnimatedExportContent();
		document.getElementById('exportJpegQualityRow').hidden = !target.supportsJpegCompression;
		document.querySelector('#exportDitherTemporalMode')?.closest('.settings-row')?.toggleAttribute('hidden', !target.supportsTemporalGifLook);
		document.querySelectorAll('#exportSettingsGroups .settings-group').forEach((group) => {
			const section = group.dataset.section;
			// Assigned for every group: the pass below hides one whose rows are
			// all hidden, and it has to come back when the format changes.
			group.hidden = (section === 'playback' && !target.supportsPlaybackSettings)
				|| (section === 'optimization' && !target.supportsAnimationOptimization);
		});
		document.querySelectorAll('#exportSettingsGroups .settings-group').forEach((group) => {
			if (group.hidden) return;
			// The card body's children are the group's rows.
			const hasVisibleRow = Array.from(group.querySelectorAll('.property-card-body > *')).some((child) => !child.hidden);
			group.hidden = !hasVisibleRow;
		});
		const usesTargetDuration = this.exportSettings.mp4LengthMode === 'duration';
		const targetDurationRow = document.getElementById('exportMp4TargetDurationRow');
		const loopCountRow = document.getElementById('exportMp4LoopCountRow');
		if (targetDurationRow) targetDurationRow.hidden = !isMp4 || !usesTargetDuration;
		if (loopCountRow) loopCountRow.hidden = !isMp4 || usesTargetDuration;
		const transparency = document.getElementById('exportTransparency');
		if (transparency) transparency.disabled = !target.supportsTransparency;
		this.updateMatteColorUI();
		this.updateExportActionUI?.();
		this.exportSettingsFilter?.apply();
		if (target.isAnimation) this.updateExportDuration();
		else this.clearExportDurationUI();
	}

,
	hasAnimatedExportContent() {
		return this.layers.some((layer) => layer.visible && (GlitterAnimation.isActive(layer.animations) || layer.type === LayerType.STICKER || layer.type === LayerType.GLITTER_FILL));
	}

,
	clearExportDurationUI() {
		this.exportDurationRequestId = (this.exportDurationRequestId || 0) + 1;
		const duration = document.getElementById('exportMp4Duration');
		const estimate = document.getElementById('exportFidelityEstimate');
		if (duration) duration.textContent = '';
		if (estimate) estimate.textContent = '';
	}

,
	updateExportFidelityUI() {
		const stop = CONFIG.export.timeline.fidelityStops[this.exportSettings.exportFidelity]
			|| CONFIG.export.timeline.fidelityStops[CONFIG.export.defaults.exportFidelity];
		const output = document.getElementById('exportFidelityValue');
		if (output) output.textContent = stop.label;
		const summary = document.querySelector('[data-export-fidelity-summary]');
		if (!summary) return;
		const samplesPerSecond = this.exportSettings.maxSamplingFps === 'auto'
			? stop.maxSamplingFps
			: this.exportSettings.maxSamplingFps;
		const visualError = Number.isFinite(this.exportSettings.visualErrorThreshold)
			? this.exportSettings.visualErrorThreshold
			: stop.visualError;
		const frameTarget = this.exportSettings.maxFrames >= CONFIG.export.limits.maxFramesHardLimit
			? 'No frame target'
			: `${this.exportSettings.maxFrames}-frame target`;
		summary.textContent = `${samplesPerSecond} samples/sec · ${frameTarget} · ≤ ${(visualError * 100).toFixed(1)}% difference`;
	}

,
	async updateExportDuration() {
		const output = document.getElementById('exportMp4Duration');
		const fidelityOutput = document.getElementById('exportFidelityEstimate');
		if (!output && !fidelityOutput) return;
		const requestId = (this.exportDurationRequestId || 0) + 1;
		this.exportDurationRequestId = requestId;
		const usesTargetDuration = this.exportSettings.mp4LengthMode === 'duration';
		const enteredDuration = document.getElementById('exportMp4TargetDuration')?.valueAsNumber;
		const targetDuration = Math.min(
			CONFIG.export.mp4.maxDurationSeconds,
			Math.max(
				CONFIG.export.mp4.minDurationSeconds,
				Number.isFinite(enteredDuration) ? enteredDuration : this.exportSettings.mp4TargetDuration
			)
		);
		const enteredLoops = document.getElementById('exportMp4LoopCount')?.valueAsNumber;
		const loopCount = Math.min(
			CONFIG.export.mp4.maxLoopCount,
			Math.max(CONFIG.export.mp4.minLoopCount, Number.isFinite(enteredLoops) ? enteredLoops : this.exportSettings.mp4LoopCount)
		);
		const formatSeconds = (seconds) => {
			if (seconds >= 60) {
				const minutes = Math.floor(seconds / 60);
				const remainder = Math.round((seconds % 60) * 10) / 10;
				return remainder > 0 ? `${minutes} min ${remainder} sec` : `${minutes} min`;
			}
			const rounded = Math.round(seconds * 10) / 10;
			return `${rounded} ${rounded === 1 ? 'second' : 'seconds'}`;
		};

		if (output && usesTargetDuration) {
			output.textContent = `${formatSeconds(targetDuration)}. The animation repeats as needed and ends at that time.`;
		} else if (output) {
			output.textContent = 'Calculating from the source animation timing…';
		}
		if (fidelityOutput) fidelityOutput.textContent = 'Calculating animation estimate…';

		if (!this.sceneCompositor || !this.glitterLibrary?.content) return;
		const visibleLayers = this.layers.filter((layer) => layer.visible
			&& layerHasVisibleContent(layer)
			&& this._layerIntersectsExportCanvas(layer));
		if (!visibleLayers.length) return;

		try {
			const estimate = await this.estimateExportAnimation(visibleLayers);
			if (requestId !== this.exportDurationRequestId) return;
			const loopDurationSeconds = estimate.duration / 1000;
			if (output && usesTargetDuration) {
				const repeats = targetDuration / loopDurationSeconds;
				const completeRepeats = Math.round(repeats);
				const isCompleteLoop = Math.abs(repeats - completeRepeats) < 0.001;
				output.textContent = isCompleteLoop
					? `${formatSeconds(targetDuration)}. ${completeRepeats} complete ${completeRepeats === 1 ? 'loop' : 'loops'}.`
					: `${formatSeconds(targetDuration)}. About ${repeats.toFixed(repeats >= 10 ? 1 : 2)} loops; the video ends at the requested time.`;
			} else if (output) {
				output.textContent = `${formatSeconds(loopDurationSeconds * loopCount)}. ${loopCount} complete ${loopCount === 1 ? 'loop' : 'loops'}.`;
			}
			if (fidelityOutput) {
				const stop = CONFIG.export.timeline.fidelityStops[this.exportSettings.exportFidelity]
					|| CONFIG.export.timeline.fidelityStops[CONFIG.export.defaults.exportFidelity];
				const visualError = Number.isFinite(this.exportSettings.visualErrorThreshold)
					? this.exportSettings.visualErrorThreshold
					: stop.visualError;
				fidelityOutput.textContent = `~${estimate.estimatedFrameCount} frames · loop ${loopDurationSeconds.toFixed(1)} s · frames differ by ≤ ${(visualError * 100).toFixed(1)}%`;
			}
		} catch (error) {
			if (requestId !== this.exportDurationRequestId) return;
			console.warn('Export duration estimate failed:', error);
			if (output && !usesTargetDuration) output.textContent = 'Could not load an animation source to estimate the duration. Export will try again.';
			if (fidelityOutput) fidelityOutput.textContent = 'Could not estimate this animation. Export will calculate it again.';
		}
	}

,
	// Timing-only plan of the next export (no frames are composed): loop
	// duration and frame count for the current export settings.
	estimateExportAnimation(layers) {
		return this.sceneCompositor.estimateLoopDuration({
			layers,
			library: this.glitterLibrary.content,
			fallbackDuration: this.exportSettings.frameDelay,
			smartReduction: this.exportSettings.smartFrameReduction,
			exportFidelity: this.exportSettings.exportFidelity,
			maxSamplingFps: this.exportSettings.maxSamplingFps,
			maxFrames: this.exportSettings.maxFrames,
			manualFrameSkip: this.exportSettings.exportFrameSkip,
			baseImage: this.exportSettings.baseImage,
			visualErrorThreshold: this.exportSettings.visualErrorThreshold,
			// The render clock is format-specific, so the estimate must be
			// realized by the same planner the export will actually use.
			outputFormat: getActiveExportTarget(this.exportSettings, { mp4Supported: this.mp4ExportSupported !== false }).format
		});
	}

,
	// An animated GIF holds every composed frame until it is encoded. When the
	// estimate is past this device's export budget, ask before starting rather
	// than letting the tab run out of memory. MP4 and stills encode frame by
	// frame, so they skip the check. An estimate failure never blocks export.
	async confirmExportMemory(target, layers) {
		if (target.isStill || target.format !== 'gif') return true;
		let estimate;
		try {
			estimate = await this.estimateExportAnimation(layers);
		} catch (error) {
			dbg('[Export] Memory estimate failed; exporting anyway.', error);
			return true;
		}
		const width = this.originalCanvas.width;
		const height = this.originalCanvas.height;
		const bytes = estimate.estimatedFrameCount * width * height * CONFIG.memory.gifBytesPerPixel;
		if (bytes <= getMemoryBudget().exportBytes) return true;
		return this.confirmAction({
			title: 'Large Export',
			message: 'This GIF may need more memory than this device has, which can stop the export or reload the page. Lower Frame Limit or Export Fidelity in Export Settings, or use a smaller canvas.',
			facts: [
				{ label: 'Frames', value: `about ${estimate.estimatedFrameCount}` },
				{ label: 'Canvas', value: `${width} × ${height} px` },
				{ label: 'Memory', value: `about ${Math.ceil(bytes / (1024 * 1024))} MB` }
			],
			confirmLabel: 'Export Anyway',
			cancelLabel: 'Cancel'
		});
	}

,
	applyInterfaceTheme() {
		document.documentElement.dataset.theme = this.interfaceTheme;
		try {
			localStorage.setItem('glitterEditorTheme', this.interfaceTheme);
		} catch (error) {
			console.warn('Failed to save interface theme:', error);
		}
	}

,
	refreshMaskEdgeRendering() {
		this.textGlitterManager?.textMaskCache.clear();
		this.textGlitterManager?.clearPreviewMaskUrls();
		this.shapeGlitterManager?.invalidateMeasurement();
		this.maskEditor?._syncAntialiasControls();
		this.requestPreviewUpdate();
	}

,
// Row and group resets belong to the panel renderer (rule D): a row revert
// restores its control and a group reset replays the reverts under it. Only
// the footer resets, which also clear state no row shows, are bound here.
setupSettingsResetListeners() {
	const resetExportBtn = document.querySelector('.reset-export-settings-btn');
	if (resetExportBtn) {
		resetExportBtn.addEventListener('click', () => {
			this.resetExportSettings();
		});
	}

	const resetAllBtn = document.querySelector('.reset-all-settings-btn');
	if (resetAllBtn) {
		resetAllBtn.addEventListener('click', () => {
			this.resetAllSettings();
		});
	}

	document.getElementById('resetToolSettings')?.addEventListener('click', () => this.resetToolSettings());
	document.getElementById('resetPanelLayout')?.addEventListener('click', () => this.resetPanelLayout());
}

,
async resetToolSettings() {
	const confirmed = await this.confirmSettingsAction({
		title: 'Reset Brush & Eraser',
		message: 'Saved Brush and Eraser settings will be restored to their defaults.',
		confirmLabel: 'Reset Tools'
	});
	if (!confirmed) return;
	this.maskEditor?.resetToolSettingsToDefaults();
	this.updateStatus('Brush and Eraser settings reset');
}

,
async resetPanelLayout() {
	const confirmed = await this.confirmSettingsAction({
		title: 'Reset Panel Layout',
		message: 'Collapsible property and tool cards will return to their default open or closed state.',
		confirmLabel: 'Reset Panels'
	});
	if (!confirmed) return;
	this.applyDefaultPanelLayout();
	this.updateStatus('Panel layout reset');
}

,
applyDefaultPanelLayout() {
	resetPanelCardStates();
}

,
// The confirmation replaces the modal that asked, so the modal comes back
// afterwards, where it was scrolled to.
async confirmSettingsAction(options, modalId = 'settingsModal') {
	const body = document.querySelector(`#${modalId} .modal-body`);
	const scrollTop = body ? body.scrollTop : 0;
	const confirmed = await this.confirmAction(options);
	await this.modalManager?.open(modalId, { resetScroll: false });
	if (body) this.modalManager.setScrollPosition(body, scrollTop);
	return confirmed;
}

,
// Preferences shown in both Settings and a canvas control have to agree after
// a reset, whichever surface triggered it.
syncCanvasPreferenceControls() {
	const autoSelect = document.getElementById('contextAutoSelect');
	if (autoSelect) autoSelect.checked = PREFERENCES.get('autoSelect');
	document.getElementById('snappingToggle')?.classList.toggle('active', PREFERENCES.get('snappingEnabled'));
}

,
async resetAllSettings() {
	const confirmed = await this.confirmSettingsAction({
		title: 'Reset Everything',
		message: 'Every setting in this window and in Export Settings, plus your panel layout and toolbar position, will be restored to its default.',
		confirmLabel: 'Reset Everything'
	});
	if (!confirmed) {
		return;
	}

	this.settingsStore.reset(this.exportSettings);

	PREFERENCES.resetAll();
	this.refreshMaskEdgeRendering();
	this.applyReduceMotion();
	this.applyShowAllControls();
	this.viewport?.applyTransform();
	this.filterLayerManager?.refreshSnapshots();
	this.syncCanvasPreferenceControls();
	this.contextToolbarRenderer?.resetPlacement?.();
	this.interfaceTheme = 'dark';
	this.applyInterfaceTheme();
	this.maskEditor?.resetToolSettingsToDefaults();
	this.applyDefaultPanelLayout();

	this.syncExportSettingsToUI();
	this.saveSettingsToStorage();
}

,
	async resetExportSettings() {
		const confirmed = await this.confirmSettingsAction({
			title: 'Reset Export Settings',
			message: 'Every setting in this window — Output, Playback, Quality, and Optimization — will be restored to its default.',
			confirmLabel: 'Reset'
		}, 'exportSettingsModal');
		if (!confirmed) return;

		this.settingsStore.reset(this.exportSettings);
		this.syncExportSettingsToUI();
		this.saveSettingsToStorage();
	}

,
	setupExportListeners() {
		const exportGif = document.getElementById('exportGif');
		if (exportGif) {
			exportGif.addEventListener('click', () => this.exportCurrentTarget());
		}
		document.querySelectorAll('[data-export-target]').forEach((item) => item.addEventListener('click', () => {
			if (item.disabled || this.exportInProgress) return;
			// "Export as" in the result closes it; the new result opens as usual.
			this.modalManager.close('exportPreviewModal');
			setActiveExportTarget(this.exportSettings, item.dataset.exportTarget);
			this.saveSettingsToStorage();
			this.syncExportSettingsToUI();
			this.exportCurrentTarget();
		}));
		document.querySelectorAll('#exportSettingsMenuItem, #exportResultSettings').forEach((button) => {
			button.addEventListener('click', () => this.modalManager.open('exportSettingsModal'));
		});
		document.getElementById('exportSettingsExport')?.addEventListener('click', () => {
			this.modalManager.close('exportSettingsModal');
			this.exportCurrentTarget();
		});

		const saveProject = document.getElementById('saveProject');
		if (saveProject) {
			saveProject.addEventListener('click', () => this.saveProjectFile());
		}
	}

,
	updateExportActionUI() {
		if (!this.exportSettings) return;
		const target = getActiveExportTarget(this.exportSettings, { mp4Supported: this.mp4ExportSupported !== false });
		const hasContent = this.layers?.some((layer) => layerHasVisibleContent(layer)) && !this.autoGlitterManager?.isSessionActive();
		const main = document.getElementById('exportGif');
		if (main) {
			main.disabled = !hasContent || this.exportInProgress;
			main.title = target.exportLabel;
			main.setAttribute('aria-label', target.exportLabel);
			main.querySelector('.name').textContent = target.exportLabel;
		}
		const settingsExport = document.getElementById('exportSettingsExport');
		if (settingsExport) {
			settingsExport.disabled = !hasContent || this.exportInProgress;
			settingsExport.querySelector('.name').textContent = target.exportLabel;
		}
		document.querySelectorAll('[data-export-target]').forEach((item) => {
			const isMp4 = item.dataset.exportTarget === 'animation:mp4';
			item.hidden = isMp4 && this.mp4ExportSupported === false;
			item.disabled = !hasContent || this.exportInProgress || (isMp4 && this.mp4ExportSupported !== true);
			const current = item.dataset.exportTarget === target.id;
			item.classList.toggle('app-menu-item-current-target', current);
			if (current) item.setAttribute('aria-current', 'true'); else item.removeAttribute('aria-current');
		});
		document.querySelectorAll('#exportSettingsMenuItem, #exportResultSettings, #exportResultMenuBtn').forEach((button) => {
			button.disabled = this.exportInProgress;
		});
	}
};

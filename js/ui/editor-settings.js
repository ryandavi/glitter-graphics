'use strict';

// A setting that exists and matters but is currently held off by another
// control the reader can see. It stays in place, carries the real `disabled`
// property on its own controls, and says what to turn on. Hiding it instead
// would teach nothing; `pointer-events: none` alone would leave it reachable
// by Tab.
function setSettingsRowInactive(row, inactive) {
	if (!row) return;
	row.classList.toggle('is-inactive', inactive);
	row.querySelectorAll('input, select, textarea, button').forEach((control) => {
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
		const settings = {
			...this.settingsStore.serialize(this.exportSettings),
			exportDitherPipelineVersion: 2,
			showHelpfulHints: this.showHints,
			showWelcomeOnStartup: this.showWelcomeOnStartup,
			confirmDestructiveActions: this.confirmDestructiveActions,
			antialiasEdges: this.antialiasEdges,
			scaleEffectsOnTransform: this.scaleEffectsOnTransform,
			scaleTexturesOnTransform: this.scaleTexturesOnTransform,
			interfaceTheme: this.interfaceTheme,
			autoSelect: PREFERENCES.get('autoSelect')
		};

		try {
			localStorage.setItem('glitterEditorSettings', JSON.stringify(settings));
			localStorage.setItem('glitterEditorTheme', this.interfaceTheme || 'dark');
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
	let savedSettings = this.loadSettingsFromStorage();
	if (savedSettings?.exportColorCount != null && savedSettings.exportDitherPipelineVersion !== 2) {
		// The first palette-pipeline rollout made a strongly stylized 128-color
		// look the default. Migrate that temporary default back to a clean export;
		// users can opt into the aesthetic presets explicitly.
		savedSettings = {
			...savedSettings,
			exportColorCount: 'auto',
			exportPaletteStyle: 'balanced',
			exportDitherEnabled: false,
			exportDitherPreset: 'clean',
			exportDitherPipelineVersion: 2
		};
	}
	let welcomeWasSuppressed = false;
	try {
		welcomeWasSuppressed = localStorage.getItem('glitterEditor_welcomeModalSeen') === 'true';
	} catch (error) {
		console.warn('Failed to read welcome-screen preference:', error);
	}

	this.settingsStore = new SettingsStore(EXPORT_SETTINGS_SCHEMA);
	this.exportSettings = this.settingsStore.load(savedSettings || {});

	// Update this.showHints
	this.showHints = savedSettings?.showHelpfulHints ?? CONFIG.ui.hints.enabledByDefault;
	this.showWelcomeOnStartup = savedSettings?.showWelcomeOnStartup ?? !welcomeWasSuppressed;
	this.confirmDestructiveActions = savedSettings?.confirmDestructiveActions ?? true;
	PREFERENCES.migrate({
		crispMaskEdges: savedSettings?.antialiasEdges == null ? undefined : !savedSettings.antialiasEdges,
		autoSelect: savedSettings?.autoSelect,
		scaleEffects: savedSettings?.scaleEffectsOnTransform,
		scaleTextures: savedSettings?.scaleTexturesOnTransform
	});
	this.antialiasEdges = !PREFERENCES.get('crispMaskEdges');
	this.scaleEffectsOnTransform = PREFERENCES.get('scaleEffects');
	this.scaleTexturesOnTransform = PREFERENCES.get('scaleTextures');
	this.interfaceTheme = CONFIG.ui.themes.includes(savedSettings?.interfaceTheme) ? savedSettings.interfaceTheme : 'dark';
	this.applyInterfaceTheme();
	this.applyReduceMotion();

	// Sync UI to match exportSettings
	this.syncExportSettingsToUI();

	// Setup listeners
	this.setupExportSettingsListeners();
	this.setupSettingsResetListeners(); // ADD THIS LINE
}

,
	syncExportSettingsToUI() {
		this.settingsStore.syncToUI(this.exportSettings);
		const uiElements = {
			showHelpfulHints: { checked: this.showHints },
			showWelcomeOnStartup: { checked: this.showWelcomeOnStartup },
			confirmDestructiveActions: { checked: this.confirmDestructiveActions },
			antialiasMaskEdges: { checked: this.antialiasEdges },
			scaleEffectsOnTransform: { checked: this.scaleEffectsOnTransform },
			scaleTexturesOnTransform: { checked: this.scaleTexturesOnTransform },
			autoSelectLayers: { checked: PREFERENCES.get('autoSelect') },
			snappingEnabled: { checked: PREFERENCES.get('snappingEnabled') },
			panInertia: { checked: PREFERENCES.get('panInertia') },
			reduceMotion: { checked: PREFERENCES.get('reduceMotion') },
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
		this.updateExportFormatUI();
		const ditherAmountValue = document.getElementById('exportDitherAmountValue');
		if (ditherAmountValue) ditherAmountValue.textContent = `${this.exportSettings.ditherAmount}%`;
		this.renderExportDitherPreview?.();
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
		setSettingsRowInactive(
			document.getElementById('matteColorRow'),
			this.exportSettings.format !== 'mp4' && this.exportSettings.transparency
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
	// A preset row plus the rail of rows it writes. The rail is collapsed by
	// default: the summary beside the preset already says what it means.
	setupGovernedSets() {
		document.querySelectorAll('[data-governed-set]').forEach((set) => {
			const toggle = set.querySelector('[data-governed-toggle]');
			if (!toggle || toggle.dataset.bound === 'true') return;
			toggle.dataset.bound = 'true';
			toggle.addEventListener('click', () => {
				this.setGifLookExpanded(set.classList.contains('is-collapsed'));
			});
		});
		this.setGifLookExpanded(this.exportSettings.ditherPreset === 'custom');
	}

,
	setGifLookExpanded(expanded) {
		const set = document.getElementById('exportGifLookSet');
		if (!set) return;
		set.classList.toggle('is-collapsed', !expanded);
		const toggle = set.querySelector('[data-governed-toggle]');
		const label = set.querySelector('[data-governed-toggle-label]');
		if (toggle) toggle.setAttribute('aria-expanded', String(expanded));
		if (label) label.textContent = expanded ? 'Done' : 'Customize';
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
				this.exportSettings.format = button.dataset.exportFormat;
				this.updateExportFormatUI();
				this.saveSettingsToStorage();
			});
		});

		Mp4Exporter.isSupported().then((supported) => {
			this.mp4ExportSupported = supported;
			if (!supported && this.exportSettings.format === 'mp4') this.exportSettings.format = CONFIG.export.defaults.format;
			this.updateExportFormatUI();
		}).catch(() => {
			this.mp4ExportSupported = false;
			if (this.exportSettings.format === 'mp4') this.exportSettings.format = CONFIG.export.defaults.format;
			this.updateExportFormatUI();
		});

		// Helpful hints setting
		const showHintsInput = document.getElementById('showHelpfulHints');
		if (showHintsInput) {
			showHintsInput.addEventListener('change', (e) => {
				this.showHints = e.target.checked;
				this.updateHelpfulMessage();
				this.saveSettingsToStorage();
			});
		}

		const welcomeInput = document.getElementById('showWelcomeOnStartup');
		welcomeInput?.addEventListener('change', (e) => {
			this.showWelcomeOnStartup = e.target.checked;
			if (this.showWelcomeOnStartup) localStorage.removeItem('glitterEditor_welcomeModalSeen');
			else localStorage.setItem('glitterEditor_welcomeModalSeen', 'true');
			this.saveSettingsToStorage();
		});

		const confirmInput = document.getElementById('confirmDestructiveActions');
		confirmInput?.addEventListener('change', (e) => {
			this.confirmDestructiveActions = e.target.checked;
			this.saveSettingsToStorage();
		});

		const antialiasInput = document.getElementById('antialiasMaskEdges');
		antialiasInput?.addEventListener('change', (e) => {
			this.antialiasEdges = e.target.checked;
			PREFERENCES.set('crispMaskEdges', !this.antialiasEdges);
			this.refreshMaskEdgeRendering();
			this.saveSettingsToStorage();
			this.updateStatus(this.antialiasEdges ? 'Antialiasing enabled for mask edges' : 'Crisp mask edges enabled');
		});

		const scaleEffectsInput = document.getElementById('scaleEffectsOnTransform');
		scaleEffectsInput?.addEventListener('change', (e) => {
			this.scaleEffectsOnTransform = e.target.checked;
			PREFERENCES.set('scaleEffects', this.scaleEffectsOnTransform);
			this.saveSettingsToStorage();
		});

		const scaleTexturesInput = document.getElementById('scaleTexturesOnTransform');
		scaleTexturesInput?.addEventListener('change', (e) => {
			this.scaleTexturesOnTransform = e.target.checked;
			PREFERENCES.set('scaleTextures', this.scaleTexturesOnTransform);
			this.saveSettingsToStorage();
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
		this.bindPreferenceToggle('reduceMotion', 'reduceMotion', () => this.applyReduceMotion());

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
	applyReduceMotion() {
		// Only stamp the attribute when the preference is on, so the universal
		// selector it gates never has to be evaluated in the common case.
		if (PREFERENCES.get('reduceMotion')) document.documentElement.dataset.reduceMotion = 'true';
		else delete document.documentElement.dataset.reduceMotion;
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
		const isMp4 = this.exportSettings.format === 'mp4' && this.mp4ExportSupported === true;
		const activeFormat = isMp4 ? 'mp4' : 'gif';
		const formatDescription = document.getElementById('exportFormatDescription');
		if (formatDescription) {
			formatDescription.textContent = this.mp4ExportSupported === true
				? 'Choose an animated GIF or a broadly compatible MP4 video.'
				: 'Export an animated GIF.';
		}
		document.querySelectorAll('#exportFormatControl [data-export-format]').forEach((button) => {
			const format = button.dataset.exportFormat;
			button.classList.toggle('active', format === activeFormat);
			button.setAttribute('aria-pressed', String(format === activeFormat));
			if (format === 'mp4') {
				const supported = this.mp4ExportSupported === true;
				button.hidden = !supported;
				button.disabled = !supported;
				button.title = supported ? '' : 'MP4 export requires WebCodecs H.264 support in this browser.';
			}
		});
		document.querySelectorAll('[data-export-format-section="gif"]').forEach((row) => row.hidden = isMp4);
		document.querySelectorAll('[data-export-format-section="mp4"]').forEach((row) => row.hidden = !isMp4);
		const usesTargetDuration = this.exportSettings.mp4LengthMode === 'duration';
		const targetDurationRow = document.getElementById('exportMp4TargetDurationRow');
		const loopCountRow = document.getElementById('exportMp4LoopCountRow');
		if (targetDurationRow) targetDurationRow.hidden = !isMp4 || !usesTargetDuration;
		if (loopCountRow) loopCountRow.hidden = !isMp4 || usesTargetDuration;
		const transparency = document.getElementById('exportTransparency');
		if (transparency) transparency.disabled = isMp4;
		this.updateMatteColorUI();
		const buttonName = document.querySelector('#exportGif .name');
		if (buttonName) buttonName.textContent = isMp4 ? 'Export MP4' : 'Export GIF';
		this.exportSettingsFilter?.apply();
		this.updateExportDuration();
	}

,
	async updateExportDuration() {
		const output = document.getElementById('exportMp4Duration');
		if (!output) return;
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

		if (usesTargetDuration) {
			output.textContent = `${formatSeconds(targetDuration)}. The animation repeats as needed and ends at that time.`;
		} else {
			output.textContent = 'Calculating from the source animation timing…';
		}

		if (!this.exporter || !this.glitterManager?.content) return;
		const visibleLayers = this.layers.filter((layer) => layer.visible && layerHasVisibleContent(layer));
		if (!visibleLayers.length) return;

		try {
			const estimate = await this.exporter.estimateLoopDuration({
				layers: visibleLayers,
				library: this.glitterManager.content,
				fallbackDuration: this.exportSettings.frameDelay,
				parseGif: (url) => this.glitterManager.parseGifFromUrl(url)
			});
			if (requestId !== this.exportDurationRequestId) return;
			const loopDurationSeconds = estimate.duration / 1000;
			if (usesTargetDuration) {
				const repeats = targetDuration / loopDurationSeconds;
				const completeRepeats = Math.round(repeats);
				const isCompleteLoop = Math.abs(repeats - completeRepeats) < 0.001;
				output.textContent = isCompleteLoop
					? `${formatSeconds(targetDuration)}. ${completeRepeats} complete ${completeRepeats === 1 ? 'loop' : 'loops'}.`
					: `${formatSeconds(targetDuration)}. About ${repeats.toFixed(repeats >= 10 ? 1 : 2)} loops; the video ends at the requested time.`;
			} else {
				output.textContent = `${formatSeconds(loopDurationSeconds * loopCount)}. ${loopCount} complete ${loopCount === 1 ? 'loop' : 'loops'}.`;
			}
		} catch (error) {
			if (requestId !== this.exportDurationRequestId) return;
			console.warn('Export duration estimate failed:', error);
			if (!usesTargetDuration) output.textContent = 'Could not load an animation source to estimate the duration. Export will try again.';
		}
	}

,
	applyInterfaceTheme() {
		document.documentElement.dataset.theme = this.interfaceTheme || 'dark';
	}

,
	refreshMaskEdgeRendering() {
		this.textGlitterManager?.textMaskCache.clear();
		this.layers
			.filter((layer) => layer.type === LayerType.TEXT_GLITTER)
			.forEach((layer) => this.textGlitterManager?.revokePreviewMaskCache(layer));
		this.shapeGlitterManager?.invalidateMeasurement();
		this.requestPreviewUpdate();
	}

,
setupSettingsResetListeners() {
	// Per-section reset buttons
	document.querySelectorAll('.reset-section-btn').forEach(btn => {
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			const section = btn.dataset.section;
			this.resetSettingsSection(section);
		});
	});

	// Reset all button
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
		message: 'All collapsible property and tool groups will be expanded.',
		confirmLabel: 'Reset Panels'
	});
	if (!confirmed) return;
	this.applyDefaultPanelLayout();
	this.updateStatus('Panel layout reset');
}

,
applyDefaultPanelLayout() {
	localStorage.removeItem('glitter.panelGroups');
	document.querySelectorAll('[data-panel-group].collapsed').forEach((group) => group.classList.remove('collapsed'));
}

,
async confirmSettingsAction(options) {
	const confirmed = await this.confirmAction(options);
	await this.modalManager?.open('settingsModal');
	return confirmed;
}

,
async resetSettingsSection(section) {
	const sectionName = this.getSectionDisplayName(section);

	const confirmed = await this.confirmSettingsAction({
		title: `Reset ${sectionName}`,
		message: 'These settings will be restored to their defaults.',
		confirmLabel: 'Reset'
	});
	if (!confirmed) {
		return;
	}

	switch(section) {
		case 'interface':
			this.showHints = CONFIG.ui.hints.enabledByDefault;
			this.showWelcomeOnStartup = true;
			this.confirmDestructiveActions = true;
			this.interfaceTheme = 'dark';
			this.applyInterfaceTheme();
			PREFERENCES.reset('reduceMotion');
			this.applyReduceMotion();
			localStorage.removeItem('glitterEditor_welcomeModalSeen');
			localStorage.removeItem('glitterEditor_welcomeLastSeenRelease');
			break;

		case 'tools':
			['crispMaskEdges', 'scaleEffects', 'scaleTextures', 'autoSelect', 'snappingEnabled', 'panInertia']
				.forEach((key) => PREFERENCES.reset(key));
			this.antialiasEdges = !PREFERENCES.get('crispMaskEdges');
			this.scaleEffectsOnTransform = PREFERENCES.get('scaleEffects');
			this.scaleTexturesOnTransform = PREFERENCES.get('scaleTextures');
			this.refreshMaskEdgeRendering();
			this.maskEditor?.resetToolSettingsToDefaults();
			this.applyDefaultPanelLayout();
			this.contextToolbarRenderer?.resetPlacement?.();
			break;

		// Export sections map one-to-one onto the headings in the Export
		// Settings modal, so a group Reset restores exactly the rows below it.
		case 'output':
		case 'playback':
		case 'quality':
		case 'optimization':
			this.settingsStore.reset(this.exportSettings, section);
			break;
	}

	this.syncCanvasPreferenceControls();
	this.syncExportSettingsToUI();
	this.saveSettingsToStorage();
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

	// Reset UI preferences
	this.showHints = CONFIG.ui.hints.enabledByDefault;
	this.showWelcomeOnStartup = true;
	this.confirmDestructiveActions = true;
	PREFERENCES.resetAll();
	this.antialiasEdges = !PREFERENCES.get('crispMaskEdges');
	this.scaleEffectsOnTransform = PREFERENCES.get('scaleEffects');
	this.scaleTexturesOnTransform = PREFERENCES.get('scaleTextures');
	this.refreshMaskEdgeRendering();
	this.applyReduceMotion();
	this.syncCanvasPreferenceControls();
	this.contextToolbarRenderer?.resetPlacement?.();
	this.interfaceTheme = 'dark';
	this.applyInterfaceTheme();
	localStorage.removeItem('glitterEditor_welcomeModalSeen');
	localStorage.removeItem('glitterEditor_welcomeLastSeenRelease');
	this.maskEditor?.resetToolSettingsToDefaults();
	this.applyDefaultPanelLayout();

	this.syncExportSettingsToUI();
	this.saveSettingsToStorage();
}

,
	async resetExportSettings() {
		const confirmed = await this.confirmAction({
			title: 'Reset All Export Settings',
			message: 'Every setting in this window — Output, Playback, Quality, and Optimization — will be restored to its default.',
			confirmLabel: 'Reset'
		});
		if (!confirmed) return;

		this.settingsStore.reset(this.exportSettings);
		this.syncExportSettingsToUI();
		this.saveSettingsToStorage();
	}

,
	getSectionDisplayName(section) {
		const names = {
			'interface': 'Interface Settings',
			'tools': 'Tools & Workspace Settings',
			'output': 'Output Settings',
			'playback': 'Playback Settings',
			'quality': 'Quality Settings',
			'optimization': 'Optimization Settings'
		};
		return names[section] || 'Settings';
	}

,
	setupExportListeners() {
		const exportGif = document.getElementById('exportGif');
		if (exportGif) {
			exportGif.addEventListener('click', () => this.exportAnimatedGif());
		}

		const saveProject = document.getElementById('saveProject');
		if (saveProject) {
			saveProject.addEventListener('click', () => this.saveProjectFile());
		}
	}
};

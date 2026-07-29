const EDITOR_SETTINGS_METHODS = {
saveSettingsToStorage() {
		const settings = {
			...this.settingsStore.serialize(this.exportSettings),
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
	const savedSettings = this.loadSettingsFromStorage();
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
			interfaceTheme: { value: this.interfaceTheme }
		};

		Object.entries(uiElements).forEach(([id, props]) => {
			const element = document.getElementById(id);
			if (!element) return;

			if ('value' in props) element.value = props.value;
			if ('checked' in props) element.checked = props.checked;
		});

		// Update visibility states
		const ditherTypeRow = document.getElementById('ditherTypeRow');
		if (ditherTypeRow) {
			ditherTypeRow.classList.toggle('disabled', !this.exportSettings.ditherEnabled);
		}

		const matteColorRow = document.getElementById('matteColorRow');
		if (matteColorRow) {
			matteColorRow.classList.toggle('disabled', this.exportSettings.format !== 'mp4' && this.exportSettings.transparency);
		}
		this.updateExportFormatUI();
	}

,
	setupExportSettingsListeners() {
		this.settingsStore.bindListeners(this.exportSettings, (key, value) => {
			this.saveSettingsToStorage();
			this.updateExportDuration();
			if (key === 'ditherEnabled') {
				document.getElementById('ditherTypeRow')?.classList.toggle('disabled', !value);
			}
			if (key === 'transparency' || key === 'mp4LengthMode') this.updateExportFormatUI();
		});

		// Delegate live repeat changes so the duration remains bound even if modal
		// controls are reinitialized or replaced in a responsive UI rebuild.
		document.addEventListener('input', (event) => {
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
		const matteColorRow = document.getElementById('matteColorRow');
		const matteColor = document.getElementById('exportMatteColor');
		const matteDisabled = !isMp4 && this.exportSettings.transparency;
		matteColorRow?.classList.toggle('disabled', matteDisabled);
		if (matteColor) matteColor.disabled = matteDisabled;
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
			localStorage.removeItem('glitterEditor_welcomeModalSeen');
			localStorage.removeItem('glitterEditor_welcomeLastSeenRelease');
			break;

		case 'tools':
			PREFERENCES.reset('crispMaskEdges');
			PREFERENCES.reset('scaleEffects');
			PREFERENCES.reset('scaleTextures');
			this.antialiasEdges = !PREFERENCES.get('crispMaskEdges');
			this.scaleEffectsOnTransform = PREFERENCES.get('scaleEffects');
			this.scaleTexturesOnTransform = PREFERENCES.get('scaleTextures');
			this.refreshMaskEdgeRendering();
			this.maskEditor?.resetToolSettingsToDefaults();
			this.applyDefaultPanelLayout();
			break;

		case 'export':
			this.settingsStore.reset(this.exportSettings, 'export');
			break;

		case 'encoding':
			this.settingsStore.reset(this.exportSettings, 'encoding');
			break;

		case 'framecontrol':
			this.settingsStore.reset(this.exportSettings, 'framecontrol');
			break;
	}

	this.syncExportSettingsToUI();
	this.saveSettingsToStorage();
}

,
async resetAllSettings() {
	const confirmed = await this.confirmSettingsAction({
		title: 'Reset All Settings',
		message: 'Export settings, interface preferences, and everything else will be restored to their defaults.',
		confirmLabel: 'Reset'
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
			title: 'Reset Export Settings',
			message: 'Export, encoding, and frame-control settings will be restored to their defaults.',
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
			'export': 'Export Settings',
			'encoding': 'Encoding Settings',
			'framecontrol': 'Frame Control Settings'
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

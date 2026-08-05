const EDITOR_PANEL_METHODS = {
isLayerContentLocked(layer) {
		return Boolean(layer?.locked && layer.type !== LayerType.BASE_IMAGE);
	}

,
	canEditLayer(layer, options = {}) {
		const editable = Boolean(layer) && !this.isLayerContentLocked(layer);
		if (!editable && options.notify) {
			this.showError('Unlock this layer to edit it');
		}
		return editable;
	}

,
	syncLockedLayerUI(layer) {
		const locked = this.isLayerContentLocked(layer) && !this.layerManager.hasMultiSelection();
		const propertySectionIds = [
			'glitterSettingsSection',
			'layerSettingsSection',
			'stickerSettingsSection',
			'textSettingsSection',
			'shapeSettingsSection'
		];
		propertySectionIds.forEach((id) => {
			const section = document.getElementById(id);
			if (!section) return;
			const sectionLocked = locked && section.classList.contains('visible');
			section.classList.toggle('is-layer-edit-locked', sectionLocked);
			const content = section.querySelector(':scope > .section-content');
			if (content) {
				content.inert = sectionLocked;
				content.setAttribute('aria-disabled', String(sectionLocked));
				content.title = sectionLocked ? 'Unlock this layer to edit its properties' : '';
			}
			const title = section.querySelector(':scope > .section-header .section-header-title');
			let badge = title?.querySelector('.locked-layer-badge');
			if (sectionLocked && title && !badge) {
				badge = document.createElement('span');
				badge.className = 'locked-layer-badge';
				badge.textContent = 'Locked';
				title.appendChild(badge);
			} else if (!sectionLocked) {
				badge?.remove();
			}
		});

		['centerLayerHorizontal', 'centerLayerVertical', 'duplicateLayerSelection'].forEach((id) => {
			const button = document.getElementById(id);
			if (button) button.disabled = locked;
		});
	}

,
	updateSidePanelUI(layer) {
		const hasMultiSelection = this.layerManager?.hasMultiSelection?.() ?? false;

		// 1. Define ALL possible sections to hide them first
		const allSections = [
			'noLayerSettingsSection',
			'autoGlitterSettingsSection',
			'baseLayerSettingsSection',
			'glitterSettingsSection',
			'layerSettingsSection',
			'glitterOptions',
			'glitterSearchSection',
			'stickerSettingsSection',
			'textSettingsSection',
			'shapeSettingsSection',
			'stickersOptions',
			'stickersSearchSection',
			'shapesOptions'
		];

		// 2. Hide everything
		allSections.forEach(id => {
			const el = document.getElementById(id);
			if (el) {
				el.classList.remove('visible');
				el.style.display = '';
			}
		});

		// 3. Determine which config to use
		let config;
		if (this.autoGlitterManager?.isSessionActive()) {
			config = LAYER_UI_CONFIG.AUTO_GLITTER;
		} else if (!this.originalImage) {
			config = LAYER_UI_CONFIG.NO_IMAGE;
		} else if (hasMultiSelection || !layer) {
			config = LAYER_UI_CONFIG.NO_LAYER;
		} else {
			config = LAYER_UI_CONFIG[layer.type];
		}

		// 4. Show the appropriate sections
		if (config) {
			config.designPanelSections.forEach(id => {
				const el = document.getElementById(id);
				if (el) el.classList.add('visible');
			});

			// 5. Set panel mode
			const designPanel = document.getElementById('designPanel');
			if (designPanel) {
				designPanel.dataset.panelMode = config.panelMode;
			}
		}

		this.syncToolSettingsSectionVisibility(layer);

		if (this.syncCollapsibleSections) {
			this.syncCollapsibleSections(this.getPreferredDesignSection(layer));
		}

		this.syncNoLayerPanelState();
		this.syncLockedLayerUI(layer);

		// D-1c: keep the gallery picker strip in sync when the active layer
		// changes to any type. The glitter, shape, text, and sticker managers each
		// drive it for their own layer type and otherwise leave the active owner
		// alone (the text manager performs the initial hide for non-text layers).
		this.textGlitterManager?.updatePickerStrip();
		this.shapeGlitterManager?.updatePickerStrip();
		this.stickerManager?.updatePickerStrip();
		this.glitterManager?.updatePickerStrip();
		this.baseBackgroundManager?.updatePickerStrip();

		// Canvas Size belongs to Canvas Background; drop its temporary preview
		// when editing any content layer or when no image is loaded.
		if ((layer && layer.type !== LayerType.BASE_IMAGE) || hasMultiSelection || !this.originalImage) {
			this.hideCanvasResizePreview();
		}
	}

,
	syncToolSettingsSectionVisibility(layer = this.layerManager?.getActiveLayer()) {
		const section = document.getElementById('layerSettingsSection');
		if (!section) return;
		const visible = Boolean(
			this.originalImage
			&& !this.layerManager?.hasMultiSelection?.()
			&& this.currentTool === ToolType.COLOR_PICKER
			&& layer?.type === LayerType.GLITTER_FILL
		);
		section.classList.toggle('visible', visible);
	}

	// Shared tail end of "create a layer via a tool" (Text/Shape click-to-create):
	// select it, and reload the side panel to show its Properties - except on
	// mobile, where LAYER_UI_CONFIG[type].mobileCreateBehavior.skipReload opts out
	// (reopening the panel on every tap is Design-drawer noise, not a Settings ask).
,
	finishLayerCreation(layer, { onDesktopReload } = {}) {
		if (!layer) return;
		this.setTool(ToolType.SELECT);

		const skipReload = this.mobileManager?.isMobile
			&& LAYER_UI_CONFIG[layer.type]?.mobileCreateBehavior?.skipReload;
		if (skipReload) return;

		setTimeout(() => {
			this.updateSidePanelUI(layer);
			this.loadActiveLayerSettings();
			onDesktopReload?.();
		}, 0);
	}

	// The single source of truth for "which accordion section should be open".
	// Model: tool-scoped settings win while a settings tool (Brush/Eraser) is
	// active (Photoshop Options-bar behavior); otherwise the SELECTED layer's
	// Properties; otherwise the Design Gallery (nothing to edit / browse mode).
,
	getPreferredDesignSection(layer) {
		// Tool settings take focus when the active layer can use that tool.
		if (this.currentTool === ToolType.BRUSH) {
			return 'brushSettings';
		}
		if (this.currentTool === ToolType.COLOR_PICKER && layer?.type === LayerType.GLITTER_FILL) {
			return 'layerSettings';
		}

		// An armed glitter pick-session keeps the gallery focused (Done returns you).
		if (this.pickers.active) {
			return 'designGallery';
		}

		if (!this.originalImage || this.layerManager?.hasMultiSelection?.() || !layer) {
			return 'designGallery';
		}

		if (layer.type === LayerType.TEXT_GLITTER) {
			return 'textSettings';
		}

		if (layer.type === LayerType.BASE_IMAGE) {
			return 'baseLayerSettings';
		}

		if (layer.type === LayerType.STICKER) {
			return 'stickerSettings';
		}

		if (layer.type === LayerType.SHAPE) {
			return 'shapeSettings';
		}

		return 'glitterSettings';
	}

,
	updateZoomUI() {
		const percentage = this.viewport.getZoomPercentage();
		// Zoom context toolbar reads with the muted-unit treatment like the panels.
		this.contextToolbarRenderer?.setValue('zoomPercentage', `${percentage}%`);
		document.getElementById('statusZoom').innerHTML = formatUnit(percentage, '%');


		this.contextToolbarRenderer?.setEnabled('zoomOut', this.viewport.currentZoomIndex > 0);
		document.getElementById('zoomIn').disabled = this.viewport.currentZoomIndex >= CONFIG.ui.zoom.levels.length - 1;

		// Update cursor
		this.previewContainer.classList.remove('zoom-cursor', 'hand-cursor');
		if (this.currentTool === ToolType.ZOOM) {
			this.previewContainer.classList.add('zoom-cursor');
		} else if (this.currentTool === ToolType.HAND) {
			this.previewContainer.classList.add('hand-cursor');
		}
	}

,
	updateTransparencyGrid() {
		if (!this.previewContainer.classList.contains('transparent-bg')) return;

		const baseSize = CONFIG.canvas.grid.baseSize;
		const size = baseSize * this.viewport.currentZoom;
		const half = size / 2;

		this.previewWrapper.style.backgroundSize = `${size}px ${size}px`;
		this.previewWrapper.style.backgroundPosition =
			`${this.viewport.panX}px ${this.viewport.panY}px, ${this.viewport.panX}px ${this.viewport.panY + half}px, ${this.viewport.panX + half}px ${this.viewport.panY - half}px, ${this.viewport.panX - half}px ${this.viewport.panY}px`;
	}

	// ===== UX: EMPTY STATE MANAGEMENT =====,

,
	setSettingsEmptyState(prefix, visible, { title, subtext } = {}) {
		const empty = document.getElementById(`${prefix}Empty`);
		const controls = document.getElementById(`${prefix}Controls`);
		const emptyText = document.getElementById(`${prefix}EmptyText`);
		const emptySubtext = document.getElementById(`${prefix}EmptySubtext`);
		empty?.classList.toggle('visible', visible);
		controls?.classList.toggle('visible', !visible);
		if (emptyText && title !== undefined) emptyText.textContent = title;
		if (emptySubtext && subtext !== undefined) emptySubtext.textContent = subtext;
	}

,
	collapseSettingsSection(prefix) {
		document.getElementById(`${prefix}Content`)?.classList.remove('visible');
		document.getElementById(`${prefix}Toggle`)?.classList.add('collapsed');
	}

,
	updateGlitterOptionsState() {
		const hasActiveLayer = this.activeLayerId !== null;
		document.querySelectorAll('.asset-option').forEach(opt => {
			if (hasActiveLayer) {
				opt.classList.remove('disabled');
			} else {
				opt.classList.add('disabled');
			}
		});
	}

,
	syncNoLayerPanelState() {
		const selectedLayers = this.layerManager?.getSelectedLayers?.() || [];
		const multiCount = selectedLayers.length;
		const canTransform = this.layerManager?.canTransformMultiSelection?.() || false;
		const defaultGroups = document.getElementById('noLayerDefaultGroups');
		const multiGroup = document.getElementById('multiLayerSelectionGroup');
		const emptyText = document.getElementById('noLayerEmptyText');
		const emptySubtext = document.getElementById('noLayerEmptySubtext');

		if (multiCount > 1) {
			if (defaultGroups) defaultGroups.hidden = true;
			if (multiGroup) multiGroup.hidden = false;
			if (emptyText) emptyText.textContent = `${multiCount} layers selected`;
			if (emptySubtext) emptySubtext.textContent = canTransform
				? 'Drag the shared box to move them. Shift+click changes the selection; use Align and Actions below.'
				: 'Selected together for layer actions. Movement and alignment are unavailable while the selection includes a locked, Base Image, or Glitter Fill layer.';
			document.querySelectorAll('#multiSelectionAlignScope button, [data-multi-align]').forEach((button) => { button.disabled = !canTransform; });
			document.querySelectorAll('[data-multi-distribute]').forEach((button) => { button.disabled = !canTransform || multiCount < 3; });
			const canChangeLayers = selectedLayers.every((layer) => layer.type !== LayerType.BASE_IMAGE && !layer.locked);
			const duplicate = document.getElementById('multiSelectionDuplicateBtn');
			const remove = document.getElementById('multiSelectionDeleteBtn');
			if (duplicate) {
				const gate = this.layerManager.canAddLayers(multiCount);
				duplicate.disabled = !canChangeLayers || !gate.ok;
				duplicate.title = gate.ok ? 'Duplicate selected layers' : gate.reason;
			}
			if (remove) remove.disabled = !canChangeLayers;
			return;
		}

		if (defaultGroups) defaultGroups.hidden = false;
		if (multiGroup) multiGroup.hidden = true;
		if (emptyText) emptyText.textContent = 'Canvas';
		if (emptySubtext) emptySubtext.textContent = 'Select a layer to edit it, or add new content below.';
	}

,
	updateAssetInfo(asset, type) {
		if (!asset) return;

		const config = ASSET_TYPE_CONFIG[type];
		if (!config) {
			console.warn(`Unknown asset type: ${type}`);
			return;
		}

		const { prefix, managerKey, renderThumbnail, getExtraBadges } = config;
		const manager = this[managerKey];

		const thumbnail = document.getElementById(`${prefix}Thumbnail`);
		const name = document.getElementById(`${prefix}Name`);
		const badges = document.getElementById(`${prefix}Badges`);
			const size = document.getElementById(`${prefix}Size`);
			const frames = document.getElementById(`${prefix}Frames`);
			const change = document.getElementById(`${prefix}Change`);
			const revealAsset = () => {
				if (type === 'glitter' && manager?.armAssetPicker) {
					manager.armAssetPicker();
					return;
				}
				if (type === 'sticker' && manager?.armAssetPicker) {
					manager.armAssetPicker();
					return;
				}
				revealAssetBrowser(this, manager, asset.id);
			};

		// Thumbnail with click handler
		if (thumbnail) {
			renderThumbnail(thumbnail, asset);
			thumbnail.style.cursor = 'pointer';

			// Remove old listeners and add new one
			thumbnail.replaceWith(thumbnail.cloneNode(true));
			const newThumbnail = document.getElementById(`${prefix}Thumbnail`);

			// Re-render after cloning
			renderThumbnail(newThumbnail, asset);

				newThumbnail.addEventListener('click', revealAsset);
			}

			if (change) {
				change.replaceWith(change.cloneNode(true));
				document.getElementById(`${prefix}Change`)?.addEventListener('click', revealAsset);
			}

		// Name
		if (name) name.textContent = asset.name || 'Undefined';

		this.renderAssetBadges(badges, asset, manager, getExtraBadges);

		// Size + frames use the shared formatters so Glitter Properties, Sticker
		// Properties, and the text Fill/Border/Shadow pickers all read identically.
		if (size) size.innerHTML = this.formatAssetSize(asset);
		if (frames) frames.innerHTML = this.formatAssetFrames(asset);
	}

	// ===== Shared asset-info formatting (one place to change size/frames text) =====,

,
	formatAssetSize(asset) {
		if (asset?.width && asset?.height) {
			return formatDimensions(asset.width, asset.height);
		}
		return 'Undefined';
	}

,
	formatAssetFrames(asset) {
		if (asset?.frameCount === undefined || asset?.frameCount === null) {
			return 'Undefined';
		}
		if (asset.frameCount <= 1 && !asset.isAnimated) {
			return 'Static';
		}
		const rate = asset.isVariableFramerate
			? 'Variable'
			: asset.frameRate || 'Unknown';
		return `${asset.frameCount}<span class="setting-separator"> @ </span>${rate}<span class="setting-unit">FPS</span>`;
	}

	// Populate a glitter asset-info block (thumbnail + name + badges + size +
	// frames) from a glitter library item. Reused by the text Fill/Border/Shadow
	// source cards so their glitter display matches Glitter Properties' Asset
	// section exactly. `els` holds the target elements (any may be omitted).
,
	renderGlitterAssetDisplay(els, glitter, colorAdjust = null) {
		if (!glitter) return;
		if (els.thumbnail) {
			els.thumbnail.classList.add('glitter-bg');
			els.thumbnail.style.backgroundImage = `url(${glitter.url})`;
			els.thumbnail.style.backgroundColor = 'transparent';
			// Mirror the slot's hue/sat/bright so the chip matches the canvas.
			els.thumbnail.style.filter = buildCssColorFilter(colorAdjust);
		}
		if (els.name) {
			els.name.textContent = glitter.name;
			els.name.title = glitter.name;
		}
		if (els.badges) {
			this.renderAssetBadges(els.badges, glitter, this.glitterManager, () => []);
		}
		if (els.size) els.size.innerHTML = this.formatAssetSize(glitter);
		if (els.frames) els.frames.innerHTML = this.formatAssetFrames(glitter);
	}

	// Shared by Glitter/Sticker asset info (updateAssetInfo) and the Text
	// layer's Fill/Border/Shadow glitter pickers — same badge vocabulary
	// (category/animated/transparency/variable-fps) wherever a glitter or
	// sticker asset is shown.
,
	renderAssetBadges(badgesEl, asset, manager, getExtraBadges) {
		if (!badgesEl) return;

		const badgeHTML = [];

		// Category badge reveals the asset in its gallery/category.
		if (asset.category) {
			const categoryName = asset.category.charAt(0).toUpperCase() + asset.category.slice(1);
			badgeHTML.push(`<button type="button" class="asset-info-badge badge-category" data-category="${asset.category}" title="Show ${categoryName} in Design">${categoryName}</button>`);
		}

		// Animated badge
		if (asset.isAnimated) {
			badgeHTML.push('<span class="asset-info-badge badge-animated" title="This asset contains animation frames">Animated</span>');
		}

		// Transparency badge
		if (asset.hasTransparency) {
			badgeHTML.push('<span class="asset-info-badge badge-transparency" title="This asset contains transparent pixels">Transparent</span>');
		}

		// Variable frame rate badge
		if (asset.isVariableFramerate) {
			badgeHTML.push('<span class="asset-info-badge badge-variable-fps" title="Animation frames use variable timing">Variable FPS</span>');
		}

		// Type-specific badges
		if (getExtraBadges) {
			const extraBadges = getExtraBadges(asset);
			extraBadges.forEach(badge => {
				badgeHTML.push(`<span class="asset-info-badge ${badge.class}" title="Asset property">${badge.text}</span>`);
			});
		}

		badgesEl.innerHTML = badgeHTML.join('');

		// Add click listener to category badge
		const categoryBadge = badgesEl.querySelector('.badge-category');
		if (categoryBadge) {
			categoryBadge.addEventListener('click', () => {
				if (!manager?.browser) return;
				revealAssetBrowser(this, manager);
				manager.browser.navigateToCategory(asset.category);
			});
		}
	}

	// Convenience wrappers
,
	updateGlitterAssetInfo(glitter) {
		this.updateAssetInfo(glitter, 'glitter');
	}

,
	updateStickerAssetInfo(sticker) {
		this.updateAssetInfo(sticker, 'sticker');
	}

,
	loadActiveLayerSettings() {
		if (this.layerManager.hasMultiSelection()) return;

		const layer = this.layerManager.getActiveLayer();
		if (!layer) return;

		// Handle different layer types
		if (layer.type === LayerType.STICKER) {
			// Load sticker settings
			this.loadStickerSettings(layer);
			return;
		}

		if (layer.type === LayerType.TEXT_GLITTER) {
			this.textGlitterManager.loadLayerSettings(layer);
			return;
		}

		if (layer.type === LayerType.BASE_IMAGE) {
			this.baseBackgroundManager?.loadLayerSettings(layer);
			return;
		}

		// Load glitter layer settings (existing code)
		const s = layer.settings;

		const contiguous = document.getElementById('contiguous');
		const invert = document.getElementById('invert');
		const multiSelect = document.getElementById('multiSelect');
		const threshold = document.getElementById('threshold');
		const thresholdValue = document.getElementById('thresholdValue');
		const feather = document.getElementById('feather');
		const featherValue = document.getElementById('featherValue');
		const scale = document.getElementById('scale');
		const scaleValue = document.getElementById('scaleValue');
		const opacity = document.getElementById('opacity');
		const opacityValue = document.getElementById('opacityValue');

		if (contiguous) contiguous.checked = s.contiguous;
		if (invert) invert.checked = s.invert;
		if (multiSelect) multiSelect.checked = s.multiSelect;

		if (threshold && thresholdValue) {
			threshold.value = s.threshold;
			thresholdValue.textContent = s.threshold;
			this.updateResetButton('threshold');
		}

		if (feather && featherValue) {
			feather.value = s.feather;
			featherValue.textContent = s.feather;
			this.updateResetButton('feather');
		}

		if (scale && scaleValue) {
			scale.value = s.scale;
			scaleValue.innerHTML = formatUnit(s.scale, '%');
			this.updateResetButton('scale');
		}

		if (opacity && opacityValue) {
			opacity.value = s.opacity;
			opacityValue.innerHTML = formatUnit(s.opacity, '%');
			this.updateResetButton('opacity');
		}

		// Color adjust (WP4): populate the Advanced HSB sliders from this layer.
		this.applyColorAdjustToSliders('glitter', s.colorAdjust);
		layer.fill = { ...buildDefaultFill(), ...(layer.fill || {}) };
		syncSlotTextureCoordinateControls('glitterFill', layer.fill);

		if (layer.selectedGlitterId) {
			const glitter = this.glitterManager.getItemById(layer.selectedGlitterId);
			if (glitter) {
				this.updateGlitterAssetInfo(glitter);
			}
		}
		const fillMode = layer.fill?.mode || 'glitter';
		syncPaintSlotSourceUI(document.getElementById('glitterFillGlitter'), fillMode);

		// Tint the asset-info thumbnail (and list/mobile swatches) to match the hue.
		this.refreshGlitterSwatchVisuals(layer);

		this.updateSelectedColorsDisplay();
		this.maskEditor?.loadLayer(layer);
	}

,
	loadStickerSettings(layer) {
		if (!layer || layer.type !== LayerType.STICKER) return;

		this.loadTransformSettings(layer, 'sticker');
		this.stickerManager.loadLayerSettings(layer);

		// Update sticker asset info
		if (layer.stickerSourceId) {
			const sticker = this.stickerManager.getItemById(layer.stickerSourceId);
			if (sticker) {
				this.updateStickerAssetInfo(sticker);
			}
		}
	}

,
	saveActiveLayerSettings() {
		const settings = {
			threshold: parseInt(document.getElementById('threshold').value),
			feather: parseInt(document.getElementById('feather').value),
			scale: parseInt(document.getElementById('scale').value),
			opacity: parseInt(document.getElementById('opacity').value),
			contiguous: document.getElementById('contiguous').checked,
			invert: document.getElementById('invert').checked,
			multiSelect: document.getElementById('multiSelect').checked,
			// Color adjust (WP4). Always an identity object for untouched layers, so
			// export stays byte-identical (isIdentityColorAdjust short-circuits it).
			colorAdjust: this.readColorAdjust('glitter')
		};

		const activeLayer = this.layerManager.getActiveLayer();
		// Only apply to active layer if it is a Glitter Fill layer
		if (activeLayer && activeLayer.type === LayerType.GLITTER_FILL) {
			activeLayer.settings = settings;
			this.maskCompositor.invalidate(activeLayer.id);
		}

	}

,
	updateGlitterSelection() {
		const layer = this.layerManager.getActiveLayer();
		const selectedGlitterId = layer?.type === LayerType.TEXT_GLITTER
			? this.textGlitterManager?.resolveSelectedGlitterId(layer)
			: layer?.type === LayerType.SHAPE
				? this.shapeGlitterManager?.resolveSelectedGlitterId(layer)
				: layer?.type === LayerType.STICKER
					? layer.stickerData?.[this.stickerManager.getGlitterSelectionTarget(layer)]?.glitterId
				: layer?.selectedGlitterId;

		// Query all glitter options in BOTH traditional grid AND asset browser
		const glitterOptions = document.querySelectorAll(
			'.asset-options .asset-option, #glitterItemGrid .asset-option, #glitterSearchResults .asset-option'
		);

		glitterOptions.forEach(opt => {
			const isSelected = layer && (layer.type === LayerType.GLITTER_FILL || layer.type === LayerType.TEXT_GLITTER || layer.type === LayerType.SHAPE || layer.type === LayerType.STICKER) &&
				parseInt(opt.dataset.id, 10) === selectedGlitterId;
			opt.classList.toggle('selected', isSelected);
		});

		// Update helpful message
		this.updateHelpfulMessage();

	}

,
	updateStickerSelection() {
		const layer = this.layerManager.getActiveLayer();

		// Get all sticker options (from asset browser)
		const stickerOptions = document.querySelectorAll('.asset-options .asset-option');

		// Early return if no sticker layer is active
		if (!layer || layer.type !== LayerType.STICKER || !layer.stickerSourceId) {
			// Clear all selections
			stickerOptions.forEach(opt => opt.classList.remove('selected'));
			return;
		}

		// Mark the matching sticker as selected
		stickerOptions.forEach(opt => {
			// Convert both to strings for comparison (or both to numbers)
			const isSelected = String(opt.dataset.id) === String(layer.stickerSourceId);
			opt.classList.toggle('selected', isSelected);
		});
	}
};

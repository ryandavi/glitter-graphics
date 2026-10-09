// A panel's asset rows: the sticker row of Sticker Properties and the glitter
// display inside every paint's source, with the shared size, frames and badge
// formatting.
const EDITOR_ASSET_INFO_METHODS = {
	// A panel's asset row: thumbnail, name, badges, size and frames. The row's
	// manager binds its clicks once.
	updateAssetInfo(asset, type) {
		if (!asset) return;
		const { prefix, managerKey, renderThumbnail, getExtraBadges } = ASSET_TYPE_CONFIG[type];
		const manager = this[managerKey];
		const assetId = String(asset.id);
		const thumbnail = document.getElementById(`${prefix}Thumbnail`);
		const name = document.getElementById(`${prefix}Name`);
		const badges = document.getElementById(`${prefix}Badges`);
		const size = document.getElementById(`${prefix}Size`);
		const frames = document.getElementById(`${prefix}Frames`);

		if (thumbnail) {
			renderThumbnail(thumbnail, asset);
			thumbnail.style.cursor = 'pointer';
			thumbnail.dataset.assetId = assetId;
		}
		if (name) name.textContent = asset.name || 'Undefined';
		this.renderAssetBadges(badges, asset, manager, getExtraBadges);

		// Size and frames use the shared formatters, so every asset row reads
		// the same.
		if (size) size.innerHTML = this.formatAssetSize(asset);
		if (frames) frames.innerHTML = this.formatAssetFrames(asset);

		// Indexed manifests omit the heavier dimensions and animation metadata.
		// It is filled in here, guarded against an older request overwriting a
		// newer selection.
		if (!asset._detailLoaded && manager?.ensureAssetDetails) {
			manager.ensureAssetDetails(asset).then((detailedAsset) => {
				if (!detailedAsset || thumbnail?.dataset.assetId !== assetId) return;
				if (size) size.innerHTML = this.formatAssetSize(detailedAsset);
				if (frames) frames.innerHTML = this.formatAssetFrames(detailedAsset);
				this.renderAssetBadges(badges, detailedAsset, manager, getExtraBadges);
			}).catch((error) => console.warn(`Could not load ${type} details:`, error));
		}
	}

	// ===== Shared asset-info formatting (one place to change size/frames text) =====,

,
	formatAssetSize(asset) {
		if (asset?.width && asset?.height) {
			return formatDimensions(asset.width, asset.height);
		}
		return '—';
	}

,
	formatAssetFrames(asset) {
		if (asset?.frameCount === undefined || asset?.frameCount === null) {
			return '—';
		}
		if (asset.frameCount <= 1 && !asset.isAnimated) {
			return 'Static';
		}
		const frames = `${asset.frameCount} ${asset.frameCount === 1 ? 'frame' : 'frames'}`;
		const rate = asset.isVariableFramerate
			? 'variable'
			: asset.frameRate ? `${asset.frameRate} fps` : '';
		return rate ? `${frames}<span class="setting-separator"> · </span>${rate}` : frames;
	}

	// Populate a glitter asset-info block (thumbnail + name + badges + size +
	// frames) from a glitter library item. Reused by the text Fill/Border/Shadow
	// source cards so their glitter display matches Glitter Properties' Asset
	// section exactly. `els` holds the target elements (any may be omitted).
,
	renderGlitterAssetDisplay(els, glitter, colorAdjust = null) {
		if (!glitter) return;
		const assetId = String(glitter.id);
		const displayNodes = [els.thumbnail, els.name, els.badges, els.size, els.frames].filter(Boolean);
		displayNodes.forEach((node) => { node.dataset.assetId = assetId; });
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
			this.renderAssetBadges(els.badges, glitter, this.glitterLibrary, () => []);
		}
		if (els.size) els.size.innerHTML = this.formatAssetSize(glitter);
		if (els.frames) els.frames.innerHTML = this.formatAssetFrames(glitter);

		// Indexed gallery records omit dimensions and animation timing. Hydrate
		// them in this shared renderer so Shape, Text, Background, and effect fills
		// all show the same authoritative metadata. Asset markers prevent a slow
		// response from repainting a slot after another glitter has been selected.
		if (!glitter._detailLoaded && this.glitterLibrary?.ensureAssetDetails) {
			this.glitterLibrary.ensureAssetDetails(glitter).then((detailedGlitter) => {
				if (!detailedGlitter || displayNodes.some((node) => node.dataset.assetId !== assetId)) return;
				if (els.badges) this.renderAssetBadges(els.badges, detailedGlitter, this.glitterLibrary, () => []);
				if (els.size) els.size.innerHTML = this.formatAssetSize(detailedGlitter);
				if (els.frames) els.frames.innerHTML = this.formatAssetFrames(detailedGlitter);
			}).catch((error) => console.warn('Could not load glitter details:', error));
		}
	}

	// A glitter source whose asset can't be resolved (missing or not loaded
	// yet): reset the display to a neutral placeholder.
,
	clearGlitterAssetDisplay(els, placeholder = 'No glitter selected') {
		[els.thumbnail, els.name, els.badges, els.size, els.frames]
			.filter(Boolean)
			.forEach((node) => { delete node.dataset.assetId; });
		if (els.thumbnail) {
			els.thumbnail.classList.remove('glitter-bg');
			els.thumbnail.style.backgroundImage = 'none';
			els.thumbnail.style.backgroundColor = 'transparent';
			els.thumbnail.style.filter = '';
		}
		if (els.name) {
			els.name.textContent = placeholder;
			els.name.title = '';
		}
		if (els.badges) els.badges.innerHTML = '';
		if (els.size) els.size.textContent = '';
		if (els.frames) els.frames.textContent = '';
	}

	// Shared by Glitter/Sticker asset info (updateAssetInfo) and the Text
	// layer's Fill/Border/Shadow glitter pickers — same badge vocabulary
	// (category/animated/transparency/variable-fps) wherever a glitter or
	// sticker asset is shown.
,
	renderAssetBadges(badgesEl, asset, manager, getExtraBadges) {
		if (!badgesEl) return;

		// Badge text can carry asset data (category names, sticker text), so every
		// badge is built as an element with textContent rather than interpolated.
		const addBadge = (className, text, title) => {
			const badge = document.createElement('span');
			badge.className = `asset-info-badge ${className}`;
			badge.title = title;
			badge.textContent = text;
			badgesEl.appendChild(badge);
		};

		badgesEl.replaceChildren();
		if (asset.recipe && manager?.createAssetProvenance) {
			const provenance = manager.createAssetProvenance(asset);
			addBadge('badge-recolored', provenance.textContent, provenance.textContent);
		}

		// Category badge reveals the asset in its gallery/category.
		if (asset.category) {
			const categoryName = manager?.browser?.getCategoryPath(asset.category) || asset.category;
			const badge = document.createElement('button');
			badge.type = 'button';
			badge.className = 'asset-info-badge badge-category';
			badge.dataset.category = asset.category;
			badge.title = `Show ${categoryName} in Design`;
			badge.textContent = categoryName;
			badgesEl.appendChild(badge);
		}

		if (asset.sliced || asset.slice) {
			addBadge('badge-stretchable', 'Stretchable', 'Stretches without distorting its corners.');
		}

		if (asset.isAnimated) {
			addBadge('badge-animated', 'Animated', 'This asset contains animation frames');
		}

		if (asset.hasTransparency) {
			addBadge('badge-transparency', 'Transparent', 'This asset contains transparent pixels');
		}

		if (asset.isVariableFramerate) {
			addBadge('badge-variable-fps', 'Variable FPS', 'Animation frames use variable timing');
		}

		// Type-specific badges
		if (getExtraBadges) {
			getExtraBadges(asset).forEach(badge => {
				addBadge(badge.class, badge.text, 'Asset property');
			});
		}

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

,
	updateStickerAssetInfo(sticker) {
		this.updateAssetInfo(sticker, 'sticker');
	}
};

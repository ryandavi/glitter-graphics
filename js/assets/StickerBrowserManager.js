// Asset lookup, browsing and uploads are independent of layer rendering.
class StickerBrowserManager extends ContentManager {
	constructor(editor) {
		super(editor);
		this.useBrowser = true;
		Object.assign(this.activeFilters, { vibes: new Set(), stretchable: new Set() });
	}

	setupUI() { this.ui = getAssetBrowserUi('sticker'); }

	getLayerType() { return LayerType.STICKER; }

	getProjectAssetIds(layers) {
		return layers.map((layer) => {
			if (layer.type === LayerType.STICKER) return layer.stickerSourceId;
			if (layer.type === LayerType.FRAME && layer.frameData?.kind === 'image') return layer.frameData.image?.stickerId;
			return null;
		});
	}

	async initBrowser() {
		this.browser = new AssetBrowser(this, 'sticker');

		await this.browser.init('data/sticker-categories.json');
		const personal = this.browser.categories.find(category => category.id === 'user-uploads');
		if (personal) { personal.name = 'My Stickers'; personal.icon = ''; personal.description = 'Your uploaded stickers. Used stickers are included in saved projects.'; }
	}

	setupFilterChips() {
		// Static facet chips are wired by ContentManager; dynamic category
		// chips bind when populateCategoryChips creates them.
	}

	matchesChildFilters(item) {
		if (this.activeFilters.stretchable.size && !item.sliced) return false;
		// Animated filter
		if (this.activeFilters.animated !== null) {
			if (item.isAnimated !== this.activeFilters.animated) {
				return false;
			}
		}

		// Vibe filter - check tags array (case insensitive)
		if (this.activeFilters.vibes.size > 0) {
			if (!item.tags) return false;

			const tags = item.tags.map(t => t.toLowerCase());
			const hasVibe = [...this.activeFilters.vibes].some(vibe =>
				tags.includes(vibe.toLowerCase())
			);
			if (!hasVibe) return false;
		}

		return true;
	}

	customizeItemElement(element, item) {
		if (item.sliced || item.slice) {
			element.classList.add('is-sliced');
			const mark = document.createElement('span');
			mark.className = 'asset-slice-mark';
			mark.title = 'Stretches without distorting its corners.';
			mark.appendChild(createIcon('stretch'));
			element.appendChild(mark);
		}
		if (item.isAnimated) element.classList.add('animated');
		if (item.hasTransparency) element.classList.add('has-transparency');
		if (item.isPixelated !== false) element.classList.add('pixelated');
	}

	async handleItemClick(item) {
		await this.editor.stickerManager.addStickerToCanvas(item.id);

		// Update helpful message
		this.editor.updateHelpfulMessage();
	}

	async loadContent() {
		try {
			await this.loadIndexedManifest({
				indexPath: 'data/stickers.index.json',
				fallbackPath: 'data/stickers.json',
				detailBasePath: 'data/stickers',
				defaults: {
				category: 'Uncategorized',
				tags: [],
				colors: [],
				isAnimated: false,
				hasTransparency: false,
				// Records exported before the sticker `is_pixelated` column existed
				// carry no flag; crisp upscaling is what they have always rendered
				// with, so absent means pixelated.
				isPixelated: true,
				width: 0,
				height: 0,
				frameCount: 1,
				frameRate: 10,
				isVariableFramerate: false,
				fileSize: 0,
				sortOrder: 0,
				featured: false,
				source: 'preset'
				}
			});

			dbg(`Loaded ${this.content.length} preset stickers`);

			// Populate category chips after loading
			this.populateCategoryChips();
		} catch (error) {
			console.error('Failed to load preset stickers:', error);
			this.editor.showError('Failed to load sticker library');
		}
	}

	async handleUserUpload(file, options = {}) {
		const done = this.editor.beginActivity('asset-upload', 'Opening sticker');
		try {
			const item = await this.createUploadedAsset(file, { category: 'user-uploads' });
			if (!item) return null;
			this.userContent.unshift(item);
			this.updateFacetAvailability();
			this.browser.refresh();
			if (options.navigate !== false) await revealAssetBrowser(this.editor, this, item.id);
			return item;
		} catch (error) {
			this.editor.showError(error.message);
			return null;
		} finally { done(); }
	}

	async registerCutout(blob, original) {
		const file = new File([blob], `${original.name} (cutout).png`, { type: 'image/png' });
		const item = await this.createUploadedAsset(file, { category: 'user-uploads' });
		if (!item) throw new Error('Could not keep the cutout. Try a smaller image.');
		item.isPixelated = original.isPixelated;
		item.backgroundRemoved = true;
		this.userContent.unshift(item);
		this.updateFacetAvailability();
		this.browser.refresh();
		return item;
	}

	async registerEmbeddedSticker(stickerData) {
		if (!stickerData?.id || !stickerData?.data) return null;
		const existing = this.getItemById(stickerData.id);
		if (existing) return existing;
		const blob = await fetch(stickerData.data).then(response => response.blob());
		const file = new File([blob], stickerData.fileName || `${stickerData.id}.png`, { type: stickerData.mimeType || blob.type });
		const item = await this.createUploadedAsset(file, { id: stickerData.id, category: 'user-uploads', name: stickerData.name });
		if (!item) throw new Error('Invalid embedded sticker');
		item.backgroundRemoved = stickerData.backgroundRemoved === true;
		this.userContent.unshift(item);
		this.updateFacetAvailability();
		this.browser.refresh();
		return item;
	}

	destroy() {
		this.getRenderContent().filter(sticker => sticker.source === 'user-upload').forEach(sticker => {
			if (sticker.url.startsWith('blob:')) URL.revokeObjectURL(sticker.url);
		});
		this.userContent = [];
		this.retiredCustom.clear();
	}

}

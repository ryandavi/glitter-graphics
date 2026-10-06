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

	validateUpload(file) {
		if (!CONFIG.tools.stickers.allowedTypes.includes(file.type)) {
			this.editor.showError('Please upload a valid image file (PNG, GIF, or JPG)');
			return false;
		}

		if (file.size > CONFIG.tools.stickers.maxUploadSize) {
			const maxMB = Math.round(CONFIG.tools.stickers.maxUploadSize / 1024 / 1024);
			this.editor.showError(`File is too large. Maximum size is ${maxMB}MB.`);
			return false;
		}

		return true;
	}

	async handleUserUpload(file, options = {}) {
		// 1. Validate
		if (!this.validateUpload(file)) {
			return null;
		}

		// 2. Create blob URL
		const blobUrl = URL.createObjectURL(file);
		const uploadId = `user-upload-${Date.now()}`;

		// 3. Create entry with loading state
		const userSticker = {
			id: uploadId,
			name: file.name.replace(/\.[^/.]+$/, ''),
			url: blobUrl,
			source: 'user-upload',
			category: 'user-uploads',

			// File info
			fileSize: file.size,
			mimeType: file.type,
			uploadedAt: Date.now(),

			// Initially unknown - will be detected
			isAnimated: false,
			hasTransparency: false,
			isPixelated: true,
			width: 0,
			height: 0,
			frameCount: null,

			// State
			isLoading: true,
			error: null
		};

		this.userContent.push(userSticker);

		if (options.navigate !== false) {
			setTimeout(() => {
				this.browser.setState('CATEGORY_DETAIL', 'user-uploads');
			}, 50);
		}

		// 4. Process asynchronously
		try {
			await this.processUploadedSticker(userSticker, file);
		} catch (error) {
			userSticker.error = error.message;
			userSticker.isLoading = false;
			this.browser.refresh();
		}

		return userSticker;
	}

	async registerEmbeddedSticker(stickerData) {
		if (!stickerData?.id || !stickerData?.data) {
			return null;
		}

		const existingIndex = this.userContent.findIndex((item) => item.id === stickerData.id);
		if (existingIndex >= 0) {
			const existing = this.userContent[existingIndex];
			if (existing?.url?.startsWith('blob:')) {
				URL.revokeObjectURL(existing.url);
			}
			this.userContent.splice(existingIndex, 1);
		}

		const blob = await fetch(stickerData.data).then((response) => response.blob());
		const file = new File(
			[blob],
			stickerData.fileName || stickerData.name || `${stickerData.id}.png`,
			{ type: stickerData.mimeType || blob.type || 'image/png' }
		);

		const userSticker = {
			id: stickerData.id,
			name: stickerData.name || file.name.replace(/\.[^/.]+$/, ''),
			url: URL.createObjectURL(file),
			source: 'user-upload',
			category: 'user-uploads',
			fileSize: file.size,
			mimeType: file.type,
			uploadedAt: Date.now(),
			isAnimated: false,
			hasTransparency: false,
			isPixelated: true,
			width: 0,
			height: 0,
			frameCount: null,
			isLoading: true,
			error: null
		};

		this.userContent.push(userSticker);
		await this.processUploadedSticker(userSticker, file);
		return userSticker;
	}

	async processUploadedSticker(userSticker, file) {
		const img = new Image();

		await new Promise((resolve, reject) => {
			img.onload = resolve;
			img.onerror = () => reject(new Error('Failed to load image'));
			img.src = userSticker.url;
		});

		// Store dimensions
		userSticker.width = img.naturalWidth;
		userSticker.height = img.naturalHeight;

		// Detect if animated GIF
		if (file.type === 'image/gif') {
			try {
				const timing = readGifTiming(await fetchGifBytes(userSticker.url));
				userSticker.isAnimated = timing.frameCount > 1;
				userSticker.frameCount = timing.frameCount;
				userSticker.frameRate = timing.frameRate;
				userSticker.isVariableFramerate = timing.isVariableFramerate;
			} catch (error) {
				console.warn('Failed to parse GIF frames:', error);
			}
		}

		// Detect transparency
		const canvas = createAppCanvas(0, 0, 'layers/StickerManager');
		canvas.width = img.naturalWidth;
		canvas.height = img.naturalHeight;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.drawImage(img, 0, 0);

		const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		userSticker.hasTransparency = this.detectActualTransparency(imageData);
		userSticker.isPixelated = await this.classifyRendering(imageData, file.type, userSticker.hasTransparency);

		// Mark as loaded
		userSticker.isLoading = false;

		// Refresh to update the item from loading state to loaded
		this.updateFacetAvailability();
		this.browser.refresh();

		dbg('Processed uploaded sticker:', userSticker);
	}

	loadRenderingRules() {
		if (!this.renderingRulesPromise) {
			this.renderingRulesPromise = fetch(
				`${CONFIG.tools.stickers.renderingRulesPath}?v=${CONFIG.app.assets.manifestVersion}`
			)
				.then((response) => {
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					return response.json();
				})
				.catch((error) => {
					console.warn('Rendering rules unavailable; upload keeps the pixelated default:', error);
					return null;
				});
		}

		return this.renderingRulesPromise;
	}

	async classifyRendering(imageData, mimeType, hasTransparency) {
		const rules = await this.loadRenderingRules();
		if (!rules) return true;

		const data = imageData.data;
		const alphaLevels = new Set();
		const colorBuckets = new Set();
		let visiblePixels = 0;
		let softPixels = 0;
		for (let index = 0; index < data.length; index += 4) {
			const alpha = data[index + 3];
			if (alpha === 0) continue;
			visiblePixels++;
			// Same 12-bit packing the analyzer buckets colors with.
			colorBuckets.add(((data[index] >> 4) << 8) | ((data[index + 1] >> 4) << 4) | (data[index + 2] >> 4));
			if (alpha < 255) {
				softPixels++;
				alphaLevels.add(alpha);
			}
		}

		const coverage = visiblePixels > 0 ? softPixels / visiblePixels : 0;
		const weights = rules.weights;
		const evidence = [];
		if (alphaLevels.size >= rules.softEdge.minAlphaLevels && coverage >= rules.softEdge.minCoverage) {
			evidence.push(weights.soft_edge_ramp);
		} else if (hasTransparency) {
			evidence.push(weights.hard_alpha_cutout);
		} else {
			evidence.push(weights.no_alpha_channel);
		}
		if (rules.smoothMimeTypes.includes(mimeType)) evidence.push(weights.lossy_photographic_format);
		if (mimeType === 'image/gif') evidence.push(weights.indexed_gif);
		evidence.push(colorBuckets.size >= rules.richPaletteBuckets ? weights.rich_palette : weights.limited_palette);

		// Ties stay pixelated, matching the analyzer.
		return evidence.reduce((total, weight) => total + weight, 0) <= 0;
	}

	detectActualTransparency(imageData) {
		// Scan actual pixel alpha values (not just palette)
		const data = imageData.data;
		for (let i = 3; i < data.length; i += 4) {
			if (data[i] < 255) {
				return true;
			}
		}
		return false;
	}

	destroy() {
		this.userContent.forEach(sticker => {
			if (sticker.url.startsWith('blob:')) URL.revokeObjectURL(sticker.url);
		});
		this.userContent = [];
	}

}

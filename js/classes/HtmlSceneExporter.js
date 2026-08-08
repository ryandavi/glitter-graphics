// HTML SCENE EXPORTER
// Produces a standalone sticker-only document without coupling web output to
// the canvas animation exporter.
// ============================================
class HtmlSceneExporter {
	constructor(editor) {
		this.editor = editor;
		this.config = CONFIG.experimental.htmlScene;
		this.ui = {};
	}

	isAvailable() {
		return this.config.localHosts.includes(window.location.hostname);
	}

	initialize() {
		const group = document.getElementById('htmlSceneSettingsGroup');
		if (!group || !this.isAvailable()) return;

		group.hidden = false;
		this.ui = {
			responsive: document.getElementById('htmlSceneResponsive'),
			stickerSizing: document.getElementById('htmlSceneStickerSizing'),
			maxWidth: document.getElementById('htmlSceneMaxWidth'),
			background: document.getElementById('htmlSceneBackground'),
			customBackground: document.getElementById('htmlSceneCustomBackground'),
			includeBaseImage: document.getElementById('htmlSceneIncludeBaseImage'),
			alignment: document.getElementById('htmlSceneAlignment'),
			minHeight: document.getElementById('htmlSceneMinHeight'),
			fit: document.getElementById('htmlSceneFit'),
			backgroundRepeat: document.getElementById('htmlSceneBackgroundRepeat'),
			overflow: document.getElementById('htmlSceneOverflow'),
			imageRendering: document.getElementById('htmlSceneImageRendering'),
			embedAssets: document.getElementById('htmlSceneEmbedAssets'),
			metadata: document.getElementById('htmlSceneStickerMetadata'),
			copyButton: document.getElementById('copyHtmlSceneSnippet'),
			exportButton: document.getElementById('exportHtmlScene'),
			status: document.getElementById('htmlSceneStatus')
		};

		const defaults = this.config.defaults;
		this.ui.responsive.checked = defaults.responsive;
		this.ui.stickerSizing.value = defaults.stickerSizing;
		this.ui.maxWidth.value = defaults.maxWidth;
		this.ui.background.value = defaults.background;
		this.ui.customBackground.value = defaults.customBackground;
		this.ui.includeBaseImage.checked = defaults.includeBaseImage;
		this.ui.alignment.value = defaults.alignment;
		this.ui.minHeight.value = defaults.minHeight;
		this.ui.fit.value = defaults.fit;
		this.ui.backgroundRepeat.value = defaults.backgroundRepeat;
		this.ui.overflow.value = defaults.overflow;
		this.ui.imageRendering.value = defaults.imageRendering;
		this.ui.embedAssets.checked = defaults.embedAssets;

		this.ui.responsive.addEventListener('change', () => this.syncControls());
		this.ui.background.addEventListener('change', () => this.syncControls());
		this.ui.copyButton.addEventListener('click', () => this.copySnippetFromEditor());
		this.ui.exportButton.addEventListener('click', () => this.exportFromEditor());
		this.refreshStickerMetadata();
		this.syncControls();
	}

	syncControls() {
		const responsive = this.ui.responsive.checked;
		this.ui.stickerSizing.disabled = !responsive;
		this.ui.maxWidth.disabled = !responsive;
		this.ui.fit.disabled = !responsive;
		this.ui.customBackground.disabled = this.ui.background.value !== 'solid';
		const baseMode = this.editor.layers.find((layer) => layer.type === LayerType.BASE_IMAGE)?.background?.mode;
		const usesGlitter = this.ui.background.value === 'glitter' || (this.ui.background.value === 'canvas' && baseMode === 'glitter');
		this.ui.backgroundRepeat.disabled = !usesGlitter;
		const hasBaseImage = Boolean(this.editor.originalImage && this.editor.baseBackgroundManager?.hasBaseImage());
		this.ui.includeBaseImage.disabled = !hasBaseImage;
		if (!hasBaseImage) this.ui.includeBaseImage.checked = false;
	}

	getOptions() {
		const limits = this.config.limits;
		const requestedWidth = Number(this.ui.maxWidth.value);
		const requestedMinHeight = Number(this.ui.minHeight.value);
		return {
			responsive: this.ui.responsive.checked,
			stickerSizing: this.ui.stickerSizing.value,
			maxWidth: Number.isFinite(requestedWidth)
				? Math.min(limits.maxWidth, Math.max(limits.minWidth, requestedWidth))
				: this.config.defaults.maxWidth,
			background: this.ui.background.value,
			customBackground: this.ui.customBackground.value,
			includeBaseImage: this.ui.includeBaseImage.checked,
			alignment: this.ui.alignment.value,
			minHeight: Number.isFinite(requestedMinHeight)
				? Math.min(limits.maxWidth, Math.max(0, requestedMinHeight))
				: this.config.defaults.minHeight,
			fit: this.ui.fit.value,
			backgroundRepeat: this.ui.backgroundRepeat.value,
			overflow: this.ui.overflow.value,
			imageRendering: this.ui.imageRendering.value,
			embedAssets: this.ui.embedAssets.checked
		};
	}

	getVisibleStickers() {
		return this.editor.layers.filter((layer) => (
			layer.type === LayerType.STICKER &&
			layer.visible &&
			!layer.stickerData?.isEmpty &&
			layer.stickerData?.url
		));
	}

	validateScene() {
		if (!this.editor.originalImage) {
			this.editor.showError('Create a scene before exporting HTML');
			return null;
		}

		const stickers = this.getVisibleStickers();
		if (!stickers.length) {
			this.editor.showError('HTML scenes need at least one visible sticker');
			return null;
		}
		return stickers;
	}

	async exportFromEditor() {
		const stickers = this.validateScene();
		if (!stickers) return;
		this.ui.exportButton.disabled = true;
		this.ui.copyButton.disabled = true;
		this.setStatus('Preparing scene assets…');
		try {
			const html = await this.createDocument(stickers, this.getOptions());
			const fileName = this.editor.getProjectFileName('html');
			downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), fileName);
			this.setStatus(`Exported ${stickers.length} sticker${stickers.length === 1 ? '' : 's'} as ${fileName}`);
		} catch (error) {
			dbg('[HtmlSceneExporter] Export failed:', error);
			this.editor.showError('Could not embed every sticker in the HTML scene');
			this.setStatus('Export failed. Check that every sticker asset is available.');
		} finally {
			this.ui.exportButton.disabled = false;
			this.ui.copyButton.disabled = false;
		}
	}

	async copySnippetFromEditor() {
		const stickers = this.validateScene();
		if (!stickers) return;
		this.ui.exportButton.disabled = true;
		this.ui.copyButton.disabled = true;
		this.setStatus('Building embeddable snippet…');
		try {
			const scene = await this.createScene(stickers, this.getOptions());
			await this.copyText(this.renderSnippet(scene));
			this.setStatus(`Copied a snippet with ${stickers.length} sticker${stickers.length === 1 ? '' : 's'}`);
		} catch (error) {
			dbg('[HtmlSceneExporter] Snippet copy failed:', error);
			this.editor.showError('Could not copy the HTML scene snippet');
			this.setStatus('Copy failed. Your browser may not allow clipboard access.');
		} finally {
			this.ui.exportButton.disabled = false;
			this.ui.copyButton.disabled = false;
		}
	}

	async copyText(value) {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(value);
			return;
		}
		const textarea = document.createElement('textarea');
		textarea.value = value;
		textarea.setAttribute('readonly', '');
		textarea.style.position = 'fixed';
		textarea.style.opacity = '0';
		document.body.appendChild(textarea);
		textarea.select();
		const copied = document.execCommand('copy');
		textarea.remove();
		if (!copied) throw new Error('Clipboard copy was rejected');
	}

	setStatus(message) {
		if (this.ui.status) this.ui.status.textContent = message;
	}

	async createDocument(layers, options) {
		return this.renderDocument(await this.createScene(layers, options));
	}

	async createScene(layers, options) {
		const width = this.editor.originalCanvas.width;
		const height = this.editor.originalCanvas.height;
		const items = await Promise.all(layers.map(async (layer) => {
			const transform = getLayerTransform(layer);
			const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
			const metadata = layer.stickerData.htmlExport || this.config.defaults.stickerMetadata;
			return {
				name: layer.name || layer.stickerData.name || 'Sticker',
				alt: String(metadata.alt || '').trim() || layer.name || layer.stickerData.name || 'Sticker',
				title: String(metadata.title || '').trim(),
				href: this.normalizeHref(metadata.href),
				classes: this.normalizeClasses(metadata.classes),
				src: await this.resolveAssetSource(layer.stickerData.url, options.embedAssets),
				x: numberOr(transform.position.x, width / 2),
				y: numberOr(transform.position.y, height / 2),
				width: numberOr(layer.stickerData.width, 1) * numberOr(transform.scale.x, 100) / 100,
				height: numberOr(layer.stickerData.height, 1) * numberOr(transform.scale.y, 100) / 100,
				rotation: numberOr(transform.rotation, 0),
				opacity: numberOr(transform.opacity, 100) / 100,
				flipX: transform.flipX,
				flipY: transform.flipY,
				filter: buildCssColorFilter(layer.stickerData.colorAdjust),
				blendMode: this.normalizeBlendMode(layer.stickerData.blendMode),
				imageRendering: layer.stickerData.isPixelated === false ? 'auto' : 'pixelated'
			};
		}));
		const background = await this.resolveBackground(options);
		const baseImage = options.includeBaseImage && this.editor.baseBackgroundManager?.hasBaseImage()
			? this.editor.originalCanvas.toDataURL('image/png')
			: null;
		const title = this.editor.projectName.trim() || 'Sticker Scene';
		return { width, height, items, background, baseImage, title, options };
	}

	refreshStickerMetadata() {
		if (!this.ui.metadata) return;
		const layers = this.getVisibleStickers();
		this.ui.metadata.replaceChildren();
		if (!layers.length) {
			const empty = document.createElement('div');
			empty.className = 'html-scene-sticker-empty';
			empty.textContent = 'Add a visible sticker to configure its HTML.';
			this.ui.metadata.appendChild(empty);
			this.syncControls();
			return;
		}

		layers.forEach((layer) => {
			const metadata = {
				...this.config.defaults.stickerMetadata,
				...(layer.stickerData.htmlExport || {})
			};
			layer.stickerData.htmlExport = metadata;
			const card = document.createElement('fieldset');
			card.className = 'html-scene-sticker-card';
			const legend = document.createElement('legend');
			legend.textContent = layer.name || layer.stickerData.name || 'Sticker';
			card.appendChild(legend);
			[
				{ key: 'href', label: 'Link', type: 'url', placeholder: 'https://… or /path' },
				{ key: 'alt', label: 'Alt text', type: 'text', placeholder: layer.name || 'Sticker' },
				{ key: 'title', label: 'Title', type: 'text', placeholder: 'Optional tooltip' },
				{ key: 'classes', label: 'CSS classes', type: 'text', placeholder: 'hero-sticker featured' }
			].forEach((field) => {
				const label = document.createElement('label');
				const name = document.createElement('span');
				name.textContent = field.label;
				const input = document.createElement('input');
				input.type = field.type;
				input.value = metadata[field.key];
				input.placeholder = field.placeholder;
				input.addEventListener('input', () => {
					metadata[field.key] = input.value;
					this.editor.isSaved = false;
				});
				input.addEventListener('change', () => this.editor.saveState('Edit scene'));
				label.append(name, input);
				card.appendChild(label);
			});
			this.ui.metadata.appendChild(card);
		});
		this.syncControls();
	}

	async resolveBackground(options) {
		const baseLayer = this.editor.layers.find((layer) => layer.type === LayerType.BASE_IMAGE);
		const data = baseLayer?.background || {};
		let mode = options.background;
		if (mode === 'canvas') {
			mode = baseLayer?.visible === false ? 'transparent' : data.mode;
			if (mode === 'image' || mode === 'none') mode = 'transparent';
		}
		if (!['transparent', 'solid', 'gradient', 'glitter'].includes(mode)) mode = 'transparent';

		const background = {
			mode,
			opacity: Math.max(0, Math.min(1, Number(data.opacity ?? 100) / 100)),
			filter: ['gradient', 'glitter'].includes(mode) ? buildCssColorFilter(data.colorAdjust) : ''
		};
		if (mode === 'solid') {
			background.color = options.background === 'solid'
				? this.normalizeColor(options.customBackground)
				: this.normalizeColor(data.color);
		} else if (mode === 'gradient') {
			background.image = effectGradientToCss(data.gradient);
		} else if (mode === 'glitter') {
			const glitter = this.editor.glitterManager.getItemById(baseLayer?.selectedGlitterId);
			if (!glitter?.url) return { mode: 'transparent', opacity: 1, filter: '' };
			background.image = this.toCssUrl(await this.resolveAssetSource(glitter.url, options.embedAssets));
			background.size = Math.max(1, Math.round((glitter.frames?.width || 50) * Number(data.scale ?? 100) / 100));
			background.offsetX = Number(data.textureOffsetX) || 0;
			background.offsetY = Number(data.textureOffsetY) || 0;
			background.pixelated = Boolean(glitter.isPixelated);
			background.repeat = options.backgroundRepeat;
		}
		return background;
	}

	normalizeHref(value) {
		const href = String(value || '').trim();
		if (!href) return '';
		if (/^(?:https?:|mailto:|tel:)/i.test(href)) return href;
		if (/^(?:\/(?!\/)|\.{0,2}\/|#|\?)/.test(href)) return href;
		return '';
	}

	normalizeClasses(value) {
		return String(value || '')
			.split(/\s+/)
			.filter((name) => /^[a-z_-][a-z0-9_-]*$/i.test(name))
			.join(' ');
	}

	normalizeColor(value) {
		return /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value || '') ? value : 'transparent';
	}

	normalizeBlendMode(value) {
		const supported = [
			'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
			'color-dodge', 'color-burn', 'hard-light', 'soft-light',
			'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'
		];
		return supported.includes(value) ? value : 'normal';
	}

	async assetToDataUrl(url) {
		if (url.startsWith('data:')) return url;
		const response = await fetch(url);
		if (!response.ok) throw new Error(`Sticker request failed with ${response.status}`);
		const blob = await response.blob();
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.addEventListener('load', () => resolve(reader.result), { once: true });
			reader.addEventListener('error', () => reject(reader.error), { once: true });
			reader.readAsDataURL(blob);
		});
	}

	async resolveAssetSource(url, embedAssets) {
		if (!embedAssets && !url.startsWith('blob:')) return url;
		return this.assetToDataUrl(url);
	}

	toCssUrl(url) {
		const escaped = String(url).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
		return `url('${escaped}')`;
	}

	renderDocument(scene) {
		return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${this.escapeHtml(scene.title)}</title>
	<style>
		* { box-sizing: border-box; }
		html, body { margin: 0; min-height: 100%; }
		body { display: grid; place-items: center; overflow: auto; }
${this.getSceneStyles(scene)}
	</style>
</head>
<body>
	<!-- Standalone sticker scene exported from Glitter Editor. -->
${this.getSceneMarkup(scene)}
</body>
</html>
`;
	}

	renderSnippet(scene) {
		return `<!-- Embeddable sticker scene exported from Glitter Editor. -->
<style>
${this.getSceneStyles(scene)}
</style>
${this.getSceneMarkup(scene)}
`;
	}

	getSceneStyles(scene) {
		const { width, height, options } = scene;
		const responsiveWidth = `min(100%, ${options.maxWidth}px)`;
		const cover = options.responsive && options.fit === 'cover' && options.minHeight > 0;
		const coverWidth = Math.ceil(options.minHeight * width / height);
		const stageWidth = cover ? `max(100%, ${coverWidth}px)` : options.responsive ? responsiveWidth : `${width}px`;
		const stageHeight = options.responsive ? 'auto' : `${height}px`;
		const aspectRatio = options.responsive ? `${width} / ${height}` : 'auto';
		const alignment = { top: 'flex-start', center: 'center', bottom: 'flex-end' }[options.alignment] || 'center';
		const shellHeight = cover ? `height: ${options.minHeight}px;` : `min-height: ${options.minHeight}px;`;
		const shellOverflow = cover ? 'overflow: hidden;' : '';
		return `		.glitter-scene-shell {
			display: flex;
			width: 100%;
			${shellHeight}
			${shellOverflow}
			flex-direction: column;
			align-items: center;
			justify-content: ${alignment};
		}
		.glitter-scene {
			position: relative;
			flex: 0 0 auto;
			width: ${stageWidth};
			height: ${stageHeight};
			aspect-ratio: ${aspectRatio};
			overflow: ${options.overflow};
			isolation: isolate;
		}
		.glitter-scene__background,
		.glitter-scene__base-image {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
		}
		.glitter-scene__background {
			background-repeat: repeat;
		}
		.glitter-scene__base-image {
			display: block;
			object-fit: fill;
		}
		.glitter-scene__item {
			position: absolute;
			display: block;
			max-width: none;
			translate: -50% -50%;
			transform-origin: center;
		}
		.glitter-scene__sticker {
			display: block;
			width: 100%;
			height: 100%;
			object-fit: fill;
			image-rendering: ${options.imageRendering};
		}`;
	}

	getSceneMarkup(scene) {
		const { width, height, items, background, baseImage, title, options } = scene;
		const useScaledStickers = options.responsive && options.stickerSizing === 'scale';
		const itemMarkup = items.map((item) => {
			const itemWidth = useScaledStickers ? `${this.formatNumber(item.width / width * 100)}%` : `${this.formatNumber(item.width)}px`;
			const itemHeight = useScaledStickers ? `${this.formatNumber(item.height / height * 100)}%` : `${this.formatNumber(item.height)}px`;
			const declarations = [
				`left:${this.formatNumber(item.x / width * 100)}%`,
				`top:${this.formatNumber(item.y / height * 100)}%`,
				`width:${itemWidth}`,
				`height:${itemHeight}`
			];
			if (item.rotation !== 0) declarations.push(`rotate:${this.formatNumber(item.rotation)}deg`);
			if (item.flipX || item.flipY) declarations.push(`scale:${item.flipX ? -1 : 1} ${item.flipY ? -1 : 1}`);
			if (item.opacity !== 1) declarations.push(`opacity:${this.formatNumber(item.opacity)}`);
			if (item.filter) declarations.push(`filter:${item.filter}`);
			if (item.blendMode !== 'normal') declarations.push(`mix-blend-mode:${item.blendMode}`);
			const customClasses = item.classes ? ` ${item.classes}` : '';
			const titleAttribute = item.title ? ` title="${this.escapeHtml(item.title)}"` : '';
			// The scene stylesheet carries the document-wide choice; only stickers
			// whose own flag disagrees with it need an inline override.
			const renderingOverride = item.imageRendering === options.imageRendering
				? ''
				: ` style="image-rendering:${item.imageRendering}"`;
			const image = `<img class="glitter-scene__sticker" src="${item.src}" alt="${this.escapeHtml(item.alt)}"${renderingOverride}>`;
			return item.href
				? `			<a class="glitter-scene__item${customClasses}" href="${this.escapeHtml(item.href)}"${titleAttribute} style="${declarations.join(';')}">${image}</a>`
				: `			<div class="glitter-scene__item${customClasses}"${titleAttribute} style="${declarations.join(';')}">${image}</div>`;
		}).join('\n');
		const backgroundMarkup = background.mode === 'transparent'
			? ''
			: `		<div class="glitter-scene__background" style="${this.getBackgroundDeclarations(background, {
				scaleTexture: options.responsive && options.stickerSizing === 'scale',
				sceneWidth: width
			}).join(';')}"></div>\n`;
		const baseImageMarkup = baseImage
			? `			<img class="glitter-scene__base-image" src="${baseImage}" alt="">\n`
			: '';
		return `	<div class="glitter-scene-shell">
		<div class="glitter-scene" role="group" aria-label="${this.escapeHtml(title)}">
${backgroundMarkup}${baseImageMarkup}${itemMarkup}
		</div>
	</div>`;
	}

	getBackgroundDeclarations(background, options = {}) {
		const declarations = [];
		if (background.mode === 'solid') declarations.push(`background-color:${background.color}`);
		if (background.image) declarations.push(`background-image:${background.image}`);
		if (background.size) {
			const size = options.scaleTexture
				? `${this.formatNumber(background.size / options.sceneWidth * 100)}% auto`
				: `${background.size}px`;
			declarations.push(`background-size:${size}`);
		}
		if (background.offsetX || background.offsetY) declarations.push(`background-position:${background.offsetX}px ${background.offsetY}px`);
		if (background.repeat && background.repeat !== 'repeat') declarations.push(`background-repeat:${background.repeat}`);
		if (background.opacity !== 1) declarations.push(`opacity:${this.formatNumber(background.opacity)}`);
		if (background.filter) declarations.push(`filter:${background.filter}`);
		if (background.pixelated) declarations.push('image-rendering:pixelated');
		return declarations;
	}

	formatNumber(value) {
		return String(Math.round(Number(value) * 1000000) / 1000000);
	}

	escapeHtml(value) {
		return String(value)
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;');
	}
}

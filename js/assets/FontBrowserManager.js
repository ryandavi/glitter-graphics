'use strict';

// The Library's Fonts: FontLibrary's fonts on the shared ContentManager path
// (search, categories, featured first, recents, favorites). Text Properties
// shows the current font and opens this in picker mode; a pick applies to
// that text layer. Categories come from the fonts manifest: a font with a
// Japanese, Korean or Chinese script files under that category, any other
// under its first tag from the "style" tag group.

const FONT_CATEGORY_TAG_GROUP = 'style';
const FONT_CJK_CATEGORY = Object.freeze({ id: 'japanese-korean-chinese', name: 'Japanese, Korean & Chinese', scripts: ['ja', 'ko', 'zh'] });
const FONT_OTHER_CATEGORY = Object.freeze({ id: 'other', name: 'Other' });
const FONT_SCRIPT_LABELS = Object.freeze({ latin: 'Latin', ja: 'Japanese', ko: 'Korean', zh: 'Chinese' });
const FONT_SAMPLE_TEXT = Object.freeze({
	long: { latin: 'Glitter', ja: 'グリッター', ko: '글리터', zh: '闪粉' },
	short: { latin: 'Aa', ja: 'あ', ko: '가', zh: '字' }
});

// A sample in the font's most distinctive script: a CJK face shows CJK text.
function getFontSampleText(font, length = 'long') {
	const samples = FONT_SAMPLE_TEXT[length];
	const script = (font?.scripts || []).find((entry) => entry !== 'latin' && samples[entry]) || 'latin';
	return samples[script];
}

class FontBrowserManager extends ContentManager {
	constructor(editor) {
		super(editor);
		this.pickerSession = null;
		this.categories = [];
		this.activeFilters.scripts = new Set();
	}

	setupUI() {
		this.ui = getAssetBrowserUi('font');
	}

	setupEventListeners() {
		super.setupEventListeners();
		document.getElementById('galleryPickerStripDone')?.addEventListener('click', () => {
			if (this.pickerSession) this.handlePickerDone();
		});
	}

	async loadContent() {
		try {
			await FontLibrary.loadManifest();
		} catch (error) {
			this.editor.textGlitterManager?.reportFontLoadError(error);
			return;
		}
		const styleTags = FontLibrary.tagGroups.find((group) => group.id === FONT_CATEGORY_TAG_GROUP)?.tags || [];
		const styleIds = new Set(styleTags.map((tag) => tag.id));
		const tagLabels = new Map(FontLibrary.tagGroups.flatMap((group) => group.tags.map((tag) => [tag.id, tag.label])));
		const homeCategory = (font) => (font.scripts.some((script) => FONT_CJK_CATEGORY.scripts.includes(script))
			? FONT_CJK_CATEGORY.id
			: font.tags.find((tag) => styleIds.has(tag)) || FONT_OTHER_CATEGORY.id);

		// Featured first, manifest order otherwise (sort is stable).
		this.content = [...FontLibrary.fonts]
			.sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)))
			.map((font) => ({
				id: font.id,
				name: font.name,
				category: homeCategory(font),
				tags: [...font.tags],
				searchTerms: [
					...font.tags.map((tag) => tagLabels.get(tag)),
					...font.scripts.map((script) => FONT_SCRIPT_LABELS[script])
				].filter(Boolean),
				scripts: font.scripts,
				font
			}));

		const used = new Set(this.content.map((item) => item.category));
		this.categories = [
			...styleTags.map((tag) => ({ id: tag.id, name: tag.label })),
			{ id: FONT_CJK_CATEGORY.id, name: FONT_CJK_CATEGORY.name },
			{ ...FONT_OTHER_CATEGORY }
		].filter((category) => used.has(category.id));
		this.populateCategoryChips();
	}

	async initBrowser() {
		this.browser = new AssetBrowser(this, 'font');
		await this.browser.init(this.categories);
	}

	getCategoryLabel(categoryId) {
		return this.categories.find((category) => category.id === categoryId)?.name || super.getCategoryLabel(categoryId);
	}

	getFilterValueLabel(key, value) {
		if (key === 'scripts') return FONT_SCRIPT_LABELS[value] || value;
		if (key === 'categories') return this.getCategoryLabel(value);
		return super.getFilterValueLabel(key, value);
	}

	getFilterKey(filterType) {
		return filterType === 'script' ? 'scripts' : super.getFilterKey(filterType);
	}

	matchesChildFilters(item) {
		return this.activeFilters.scripts.size === 0
			|| item.scripts.some((script) => this.activeFilters.scripts.has(script));
	}

	itemMatchesFacet(item, key, value) {
		if (key === 'scripts') return item.scripts.includes(value);
		return super.itemMatchesFacet(item, key, value);
	}

	// A sample phrase in the font itself, the name in the UI font, and one
	// corner badge for extra scripts and the device-font marker (system faces
	// render with a fallback on devices without them).
	createItemCard(item) {
		const font = item.font;
		const card = document.createElement('div');
		card.className = 'choice-card asset-option text-font-option';
		const credit = Attribution.creditLine(font.attribution);
		card.title = credit ? `${font.name} — ${credit}` : font.name;

		const sample = document.createElement('span');
		sample.className = 'text-font-option-sample';
		sample.style.fontFamily = FontLibrary.getFamily(font);
		sample.textContent = getFontSampleText(font);

		const name = document.createElement('span');
		name.className = 'text-font-option-name';
		name.textContent = font.name;
		card.append(sample, name);

		const extraScripts = font.scripts.filter((script) => script !== 'latin');
		const badgeLabels = extraScripts.map((script) => script.toUpperCase());
		if (font.system) badgeLabels.push('System');
		if (badgeLabels.length) {
			const badge = document.createElement('span');
			badge.className = 'text-font-option-badge';
			extraScripts.forEach((script) => badge.classList.add(`is-${script}`));
			if (font.system) badge.classList.add('is-system');
			badge.textContent = badgeLabels.join(' · ');
			card.appendChild(badge);
		}
		return card;
	}

	getTargetLayer() {
		const layer = this.editor.layerManager.getActiveLayer();
		return layer?.type === LayerType.TEXT_GLITTER ? layer : null;
	}

	updateSelection() {
		const fontId = this.getTargetLayer()?.textData?.fontId;
		this.ui.panel?.querySelectorAll('.asset-option').forEach((option) => {
			const selected = option.dataset.id === fontId;
			option.classList.toggle('selected', selected);
			option.setAttribute('aria-selected', String(selected));
		});
	}

	async handleItemClick(item) {
		const layer = this.getTargetLayer();
		if (!layer) {
			this.editor.updateStatus('Select a text layer to change its font.');
			return;
		}
		await this.editor.textGlitterManager.setLayerFont(layer, item.id);
		this.editor.textGlitterManager.updateFontRow(layer.textData.fontId);
		this.updateSelection();
	}

	// Samples render in their own faces, so opening the Fonts loads them all.
	ensureSamplesLoaded() {
		return FontLibrary.ensureAllLoaded((error) => this.editor.textGlitterManager?.reportFontLoadError(error));
	}

	// ===== PICKER SESSION =====

	openPicker() {
		const layer = this.getTargetLayer();
		if (!layer || !this.browser) return;
		this.editor.textGlitterManager?.closePickerSession?.();
		pickerOpenSession(this, { kind: 'font', layerId: layer.id }, {
			refresh: () => this.updatePickerStrip(),
			reveal: () => revealAssetBrowser(this.editor, this, layer.textData.fontId)
		});
		this.ensureSamplesLoaded();
		this.updateSelection();
		this.editor.updateStatus('Choose a font, then press Esc or Done.');
	}

	updatePickerStrip(options = {}) {
		const layer = this.getTargetLayer();
		if (this.pickerSession && this.pickerSession.layerId !== layer?.id) {
			this.closePickerSession();
			return;
		}
		if (!this.pickerSession) {
			// Hand the strip back to the text layer's own glitter hint.
			if (options.closing) this.editor.textGlitterManager?.updatePickerStrip();
			return;
		}
		renderPickerStrip({
			ownsStrip: true, visible: true, armed: true, library: 'font',
			title: 'Choosing font', detail: formatPickerTarget(layer.name, 'text')
		});
	}

	handlePickerDone() {
		this.closePickerSession();
		returnFromPickerToProperties(this.editor, { section: 'textSettings', focusId: 'textFontChange' });
	}

	closePickerSession() {
		return pickerCloseSession(this, {
			refresh: () => this.updatePickerStrip({ closing: true }),
			updateSelection: () => this.updateSelection()
		});
	}
}

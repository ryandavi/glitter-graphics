'use strict';

// The Library's Shapes: ShapeLibrary's fill shapes on the shared
// ContentManager path (search, recents, favorites) and shared tree browser.
// What a pick does (reshape the selected shape, replace it, or add a layer)
// belongs to ShapeGlitterManager.
class ShapeBrowserManager extends ContentManager {
	setupUI() {
		this.ui = getAssetBrowserUi('shape');
	}

	async loadContent() {
		this.content = ShapeLibrary.FILL_SHAPES.map(({ id, label, category }) => ({
			id,
			name: label,
			category,
			tags: [],
			searchTerms: [this.getCategoryLabel(category)]
		}));
		this.populateCategoryChips();
	}

	async initBrowser() {
		this.browser = new AssetBrowser(this, 'shape');
		await this.browser.init(ShapeLibrary.FILL_SHAPE_CATEGORIES.map(({ id, label }) => ({ id, name: label })));
	}

	getCategoryLabel(categoryId) {
		return ShapeLibrary.FILL_SHAPE_CATEGORIES.find((category) => category.id === categoryId)?.label
			|| super.getCategoryLabel(categoryId);
	}

	getFilterValueLabel(key, value) {
		return key === 'categories' ? this.getCategoryLabel(value) : super.getFilterValueLabel(key, value);
	}

	getSearchNameElement(option) {
		return option.querySelector('.brush-shape-option-name');
	}

	getProjectAssetIds(layers) {
		return layers.map((layer) => (layer.type === LayerType.SHAPE ? layer.shapeData?.shapeId : null));
	}

	createItemCard(item) {
		return createShapeCard(item.id, item.name, { className: 'asset-option shape-gallery-option', tag: 'div' });
	}

	createCollectionPreview(category) {
		const item = this.content.find(entry => entry.category === category?.id);
		return item ? this.createItemCard(item).querySelector('.brush-shape-option-icon') : null;
	}

	customizeCollectionCard(card, category) {
		const icon = this.createCollectionPreview(category);
		if (icon) card.querySelector('.category-card-image').replaceChildren(icon);
	}

	handleItemClick(item) {
		this.editor.shapeGlitterManager.pickLibraryShape(item.id);
	}

	updateSelection() {
		this.editor.shapeGlitterManager?.syncShapeSelection();
	}
}

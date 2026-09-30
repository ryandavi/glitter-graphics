'use strict';

// The Library's Shapes: ShapeLibrary's fill shapes on the shared
// ContentManager path (search, recents, favorites), listed whole under their
// category headings. What a pick does (reshape the selected shape, the one
// being replaced, or add a new shape layer) belongs to ShapeGlitterManager.
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

	createItemCard(item) {
		return createShapeCard(item.id, item.name, { className: 'asset-option shape-gallery-option', tag: 'div' });
	}

	handleItemClick(item) {
		this.editor.shapeGlitterManager.pickLibraryShape(item.id);
	}

	updateSelection() {
		this.editor.shapeGlitterManager?.syncShapeSelection();
	}
}

// Category membership and provenance are independent of browser state and DOM.
// An item lives in one style (its `category`) and may point at one set (its
// `set`): a creator's collection, which spans styles and supplies the credit.
// Sets are the entries of `categories` with `kind: 'set'`. A manifest library
// may instead nest collections under a style with `parent`.
class LibraryCatalog {
	constructor(categories, resolveAttribution = (...layers) => Object.assign({}, ...layers)) {
		this.categories = categories;
		this.resolveAttribution = resolveAttribution;
	}

	getCategoryById(id) { return this.categories.find(category => category.id === id) || null; }
	isSet(category) { return category?.kind === 'set'; }
	getRoots() { return this.categories.filter(category => !category.parent && !this.isSet(category)); }
	// What narrows a style: its nested collections, and every set (which of
	// them hold items of the style is `getSetCounts`).
	getSets(id) { return this.categories.filter(category => category.parent === id || this.isSet(category)); }
	getRootOf(id) {
		const category = this.getCategoryById(id);
		return category?.parent ? this.getCategoryById(category.parent) : category;
	}
	getCategoryPath(id) {
		const category = this.getCategoryById(id);
		const parent = category?.parent && this.getCategoryById(category.parent);
		return parent ? parent.name + ' › ' + category.name : (category?.name || id);
	}
	getCategoryCounts(items) {
		const counts = {};
		items.forEach(item => { counts[item.category] = (counts[item.category] || 0) + 1; });
		return counts;
	}
	// Items of one style counted per nested collection and per set.
	getSetCounts(id, items) {
		const counts = {};
		this.getRootItems(id, items).forEach(item => {
			for (const key of [item.category !== id && item.category, item.set]) {
				if (key) counts[key] = (counts[key] || 0) + 1;
			}
		});
		return counts;
	}
	getRootCount(category, counts) {
		return (counts[category.id] || 0) + this.categories.filter(child => child.parent === category.id).reduce((sum, set) => sum + (counts[set.id] || 0), 0);
	}
	getCategoryItems(id, items) {
		const key = this.isSet(this.getCategoryById(id)) ? 'set' : 'category';
		return items.filter(item => item[key] === id);
	}
	getRootItems(id, items) {
		const ids = new Set([id, ...this.categories.filter(child => child.parent === id).map(set => set.id)]);
		return items.filter(item => ids.has(item.category));
	}
	// Later layers win: the style's credit, then the set's, then the item's own.
	getAssetAttribution(item) {
		return this.resolveAttribution(this.getCategoryById(item.category)?.attribution, this.getCategoryById(item.set)?.attribution, item.attribution);
	}
	// The one set every item shares, or null.
	getSharedSet(items) {
		const id = items[0]?.set;
		return id && items.every(item => item.set === id) ? this.getCategoryById(id) : null;
	}
	getCreators(items) {
		const creators = new Map();
		items.forEach(item => {
			const attr = this.getAssetAttribution(item);
			const id = attr?.authorId || '__unknown';
			if (!creators.has(id)) creators.set(id, { id, name: id === '__unknown' ? 'Unknown' : (attr.author || id), items: [] });
			creators.get(id).items.push(item);
		});
		return [...creators.values()].sort((a, b) => Number(a.id === '__unknown') - Number(b.id === '__unknown'));
	}
	getCreatorItems(id, items) { return this.getCreators(items).find(creator => creator.id === id)?.items || []; }
	// The styles a creator's items are filed in, in category order.
	getStylesByCreator(id, items) {
		const counts = this.getCategoryCounts(this.getCreatorItems(id, items));
		return this.categories.filter(category => counts[category.id]);
	}
	getUnknownGroups(items) {
		const groups = new Map();
		this.getCreatorItems('__unknown', items).forEach(item => {
			const root = this.getRootOf(item.category);
			const id = root?.id || item.category;
			if (!groups.has(id)) groups.set(id, { id, name: root?.name || id, items: [] });
			groups.get(id).items.push(item);
		});
		return [...groups.values()];
	}
}

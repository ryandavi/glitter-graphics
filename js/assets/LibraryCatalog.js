// Category membership and provenance are independent of browser state and DOM.
class LibraryCatalog {
	constructor(categories, resolveAttribution = (category, item) => ({ ...category, ...item })) {
		this.categories = categories;
		this.resolveAttribution = resolveAttribution;
	}

	getCategoryById(id) { return this.categories.find(category => category.id === id) || null; }
	getRoots() { return this.categories.filter(category => !category.parent); }
	getSets(id) { return this.categories.filter(category => category.parent === id); }
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
	getRootCount(category, counts) {
		return (counts[category.id] || 0) + this.getSets(category.id).reduce((sum, set) => sum + (counts[set.id] || 0), 0);
	}
	getCategoryItems(id, items) { return items.filter(item => item.category === id); }
	getRootItems(id, items) {
		const ids = new Set([id, ...this.getSets(id).map(set => set.id)]);
		return items.filter(item => ids.has(item.category));
	}
	getAssetAttribution(item) { return this.resolveAttribution(this.getCategoryById(item.category)?.attribution, item.attribution); }
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
	getSetsByCreator(id, items) {
		const counts = this.getCategoryCounts(this.getCreatorItems(id, items));
		return this.categories.filter(category => (category.parent || category.attribution?.authorId) && counts[category.id]);
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

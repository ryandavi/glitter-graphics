// Folder creator navigation is retained for libraries awaiting the rail layout.
class AssetBrowserFolders {
	constructor(browser) {
		this.browser = browser;
		this.creatorId = null;
		this.origin = null;
	}
	isCreatorDetail() { return this.browser.state === 'CREATOR_DETAIL'; }
	isUnknownListing() { return this.isCreatorDetail() && this.creatorId === '__unknown'; }
	resetOrigin() { this.origin = null; }
	back() {
		const b = this.browser;
		const category = b.getCategoryById(b.currentCategoryId);
		if (b.state === 'CATEGORY_DETAIL' && this.origin) {
			this.creatorId = this.origin;
			this.origin = null;
			b.setState('CREATOR_DETAIL');
		} else if (b.state === 'CATEGORY_DETAIL' && category?.parent) b.setState('CATEGORY_DETAIL', category.parent);
		else b.setState('CATEGORY_LIST');
	}
	createCreatorCard(creator) {
		const b = this.browser;
		return b.createCategoryCard({ id: creator.id, name: creator.name, icon: creator.items[0]?.thumbnailUrl || creator.items[0]?.url }, creator.items.length, () => { this.creatorId = creator.id; b.setState('CREATOR_DETAIL'); });
	}

	renderCreatorDetail() {
		const b = this.browser;
		const creator = b.getCreators(b.contentManager.getAllContent()).find(entry => entry.id === this.creatorId);
		b.elements.backBtn.disabled = false;
		b.elements.title.textContent = creator?.name || 'Unknown';
		if (this.creatorId === '__unknown') {
			b.elements.searchResults.classList.add('visible');
			b.elements.searchResults.replaceChildren();
			b.loadListingItems();
			return;
		}
		b.elements.categoryGrid.replaceChildren();
		const items = b.getFilteredItems().filter(item => b.getAssetAttribution(item)?.authorId === this.creatorId);
		const counts = b.getCategoryCounts(items);
		const categories = b.categories.filter(category => counts[category.id]);
		const sources = new Set(categories.map(category => category.attribution?.sourceId || ''));
		const ordered = [...sources].flatMap(source => categories.filter(category => (category.attribution?.sourceId || '') === source));
		let lastSource = null;
		ordered.forEach(category => {
			const source = category.attribution?.sourceId || '';
			if (sources.size > 1 && source !== lastSource) b.elements.categoryGrid.appendChild(b.createHeading(category.attribution?.source || source || 'Other sets'));
			lastSource = source;
			const card = b.createCategoryCard(category, counts[category.id]);
			card.addEventListener('click', () => { this.origin = this.creatorId; });
			b.elements.categoryGrid.appendChild(card);
		});
		if (categories.length) b.elements.categoryGrid.classList.add('visible');
		else b.showEmptyState('No items found');
	}

}

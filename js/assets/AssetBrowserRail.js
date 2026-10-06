// The navigation owns selection; filters and item rendering belong to the browser.
class AssetBrowserRail {
	constructor(catalog, onChange) {
		this.catalog = catalog;
		this.onChange = onChange;
		this.mode = 'style';
		this.selection = { root: null, set: null };
		this.element = document.createElement('div');
		this.element.className = 'asset-browser-rails';
		this.rows = ['Style', 'Set'].map(text => {
			const row = document.createElement('label');
			row.className = 'asset-browser-rail';
			const label = document.createElement('span');
			label.textContent = text;
			const select = document.createElement('select');
			select.addEventListener('change', () => {
				if (row === this.rows[0]) this.select(select.value);
				else this.select(this.selection.root, select.value || null);
			});
			row.append(label, select);
			this.element.appendChild(row);
			return row;
		});
	}

	select(root, set = null) {
		this.selection = { root, set };
		this.onChange(this.selection);
	}

	render(items, favorites, mode) {
		if (mode !== this.mode) { this.mode = mode; this.selection = { root: null, set: null }; }
		const counts = this.catalog.getCategoryCounts(items);
		const roots = mode === 'creator' ? this.catalog.getCreators(items).map(creator => ({ ...creator, count: creator.items.length }))
			: this.catalog.getRoots().map(root => ({ ...root, count: this.catalog.getRootCount(root, counts) })).filter(root => root.count);
		if (favorites) roots.push(favorites);
		if (!roots.some(root => root.id === this.selection.root)) this.selection = { root: roots[0]?.id || null, set: null };
		const root = this.selection.root;
		const selectedItems = root === LIBRARY_FAVORITES_ID ? [] : mode === 'creator' ? this.catalog.getCreatorItems(root, items) : this.catalog.getRootItems(root, items);
		const selectedCounts = this.catalog.getCategoryCounts(selectedItems);
		const sets = root === LIBRARY_FAVORITES_ID ? [] : mode === 'creator' ? this.catalog.getSetsByCreator(root, items) : this.catalog.getSets(root).filter(set => counts[set.id]);
		if (!sets.some(set => set.id === this.selection.set)) this.selection.set = null;
		this.rows[0].firstElementChild.textContent = mode === 'creator' ? 'Creator' : 'Style';
		this.updateSelect(this.rows[0], roots, root);
		this.rows[1].hidden = !sets.length;
		this.updateSelect(this.rows[1], [{ id: '', name: 'All sets', count: selectedItems.length }, ...sets.map(set => ({ ...set, count: selectedCounts[set.id] }))], this.selection.set || '');
		return this.selection;
	}

	updateSelect(row, entries, value) {
		const select = row.querySelector('select');
		select.replaceChildren(...entries.map(entry => {
			const option = document.createElement('option');
			option.value = entry.id;
			option.textContent = `${entry.name} (${entry.count})`;
			return option;
		}));
		select.value = value || '';
		select.disabled = !entries.length;
	}
}

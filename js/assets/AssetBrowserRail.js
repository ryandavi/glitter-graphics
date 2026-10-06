// The wall's picker: one select holding the whole tree. Home, then each style
// (or creator) with its sets grouped under it. The navigation owns selection;
// filters and item rendering belong to the browser.
class AssetBrowserRail {
	constructor(catalog, onChange) {
		this.catalog = catalog;
		this.onChange = onChange;
		this.mode = 'style';
		this.selection = { root: null, set: null };
		this.element = document.createElement('div');
		this.element.className = 'asset-browser-rail';
		this.field = document.createElement('select');
		this.field.addEventListener('change', () => {
			const option = this.field.selectedOptions[0];
			if (option) this.select(option.dataset.root, option.dataset.set || null);
		});
		this.element.appendChild(this.field);
	}

	select(root, set = null) {
		this.selection = { root, set };
		this.onChange(this.selection);
	}

	// The tree as picker entries: a root with sets is a group that opens with
	// its own "All" entry; a root that is nothing but one set is that set.
	getEntries(items, mode) {
		const creator = mode === 'creator';
		const counts = this.catalog.getCategoryCounts(items);
		const roots = creator
			? this.catalog.getCreators(items).map(entry => ({ id: entry.id, name: entry.name, count: entry.items.length, icon: entry.items[0]?.thumbnailUrl || entry.items[0]?.url, items: entry.items }))
			: this.catalog.getRoots().map(root => ({ ...root, count: this.catalog.getRootCount(root, counts) })).filter(root => root.count);
		const entries = [];
		if (!creator && roots.length) entries.push({ root: LIBRARY_ALL_ID, set: null, name: 'All styles', count: items.length });
		roots.forEach(root => {
			const setCounts = creator ? this.catalog.getCategoryCounts(root.items) : counts;
			const sets = (creator ? this.catalog.getSetsByCreator(root.id, items) : this.catalog.getSets(root.id)).filter(set => setCounts[set.id]);
			const entry = { root: root.id, set: null, name: root.name, count: root.count, icon: root.icon };
			if (!sets.length) entries.push(entry);
			else if (sets.length === 1 && setCounts[sets[0].id] === root.count) entries.push({ ...entry, set: sets[0].id });
			else {
				entries.push({ ...entry, name: 'All ' + root.name, group: root.name });
				sets.forEach(set => entries.push({ root: root.id, set: set.id, name: set.name, count: setCounts[set.id], icon: set.icon, group: root.name }));
			}
		});
		return entries;
	}

	render(items, mode) {
		if (mode !== this.mode) { this.mode = mode; this.selection = { root: null, set: null }; }
		const entries = this.getEntries(items, mode);
		const { root, set } = this.selection;
		const current = entries.find(entry => entry.root === root && entry.set === set)
			|| entries.find(entry => entry.root === root)
			|| entries[0];
		this.selection = { root: current?.root || null, set: current?.set || null };

		this.field.setAttribute('aria-label', mode === 'creator' ? 'Creator' : 'Style');
		const nodes = [];
		let group = null;
		entries.forEach(entry => {
			const option = this.createOption(entry);
			option.selected = entry === current;
			if (!entry.group) { group = null; nodes.push(option); return; }
			if (group?.label !== entry.group) {
				group = document.createElement('optgroup');
				group.label = entry.group;
				nodes.push(group);
			}
			group.appendChild(option);
		});
		this.field.replaceChildren(...nodes);
		this.field.disabled = !entries.length;
		return this.selection;
	}

	// Thumbnail, name, count. A browser without the customizable select shows
	// the row's text alone: "Name (count)".
	createOption(entry) {
		const option = document.createElement('option');
		option.value = entry.set ? `${entry.root}/${entry.set}` : entry.root;
		option.dataset.root = entry.root;
		if (entry.set) option.dataset.set = entry.set;
		if (entry.icon) {
			const icon = document.createElement('img');
			icon.className = 'asset-browser-rail-icon';
			icon.src = entry.icon;
			icon.alt = '';
			icon.loading = 'lazy';
			option.appendChild(icon);
		}
		const name = document.createElement('span');
		name.className = 'asset-browser-rail-name';
		name.textContent = entry.name;
		const count = document.createElement('span');
		count.className = 'asset-browser-rail-count';
		count.textContent = ` (${entry.count})`;
		option.append(name, count);
		return option;
	}
}

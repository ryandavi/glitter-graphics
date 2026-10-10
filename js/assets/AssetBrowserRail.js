// The wall's picker: one select holding the whole tree. Home, then each style
// with the sets found in it (or each creator with their styles) grouped under it. An Up button beside it steps
// one level toward home. The navigation owns selection; filters and item
// rendering belong to the browser.
class AssetBrowserRail {
	constructor(catalog, onChange, schema, createPreview) {
		this.catalog = catalog;
		this.schema = schema;
		this.createPreview = createPreview;
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
		// Up, not Back: the tree has a parent for every level and no history.
		this.upButton = document.createElement('button');
		this.upButton.type = 'button';
		this.upButton.className = 'btn-flat is-icon asset-browser-rail-up';
		this.upButton.appendChild(createIcon('arrow-up'));
		this.upButton.addEventListener('click', () => {
			if (this.parent) this.select(this.parent.root, this.parent.set);
		});
		this.element.append(this.upButton, this.field);
	}

	select(root, set = null) {
		this.selection = { root, set };
		this.onChange(this.selection);
	}

	// What a selection holds: everything at home, else its style or creator,
	// narrowed to the picked set.
	getItems(items, selection = this.selection, mode = this.mode) {
		if (selection.root === LIBRARY_ALL_ID) return items;
		const wall = mode === 'creator' ? this.catalog.getCreatorItems(selection.root, items) : this.catalog.getRootItems(selection.root, items);
		return selection.set ? this.catalog.getCategoryItems(selection.set, wall) : wall;
	}

	// The tree as picker entries, every row under a heading: a root with sets
	// is a group that opens with its own "All" entry; the roots without sets
	// (a root that is nothing but one set is that set) share a closing group.
	getEntries(items, mode) {
		const creator = mode === 'creator';
		const counts = this.catalog.getCategoryCounts(items);
		const roots = creator
			? this.catalog.getCreators(items).map(entry => ({ id: entry.id, name: entry.name, count: entry.items.length, icon: entry.items[0]?.thumbnailUrl || entry.items[0]?.url, items: entry.items }))
			: this.catalog.getRoots().map(root => ({ ...root, count: this.catalog.getRootCount(root, counts) })).filter(root => root.count);
		const entries = [];
		const single = [];
		if (roots.length) entries.push({ root: LIBRARY_ALL_ID, set: null, name: creator ? 'All creators' : this.schema.browseLabel === 'Style' ? 'All styles' : 'All categories', count: items.length });
		roots.forEach(root => {
			const setCounts = creator ? this.catalog.getCategoryCounts(root.items) : this.catalog.getSetCounts(root.id, items);
			const sets = (creator ? this.catalog.getStylesByCreator(root.id, items) : this.catalog.getSets(root.id)).filter(set => setCounts[set.id]);
			const entry = { root: root.id, set: null, name: root.name, count: root.count, icon: root.icon };
			// One narrowing that holds everything is no choice: the entry stands
			// alone. A style keeps its own name; a nested collection is the entry.
			const whole = sets.length === 1 && setCounts[sets[0].id] === root.count;
			if (root.browseFirst) entries.push(entry);
			else if (!sets.length) single.push(entry);
			else if (whole) single.push(creator || this.catalog.isSet(sets[0]) ? entry : { ...entry, set: sets[0].id });
			else {
				entries.push({ ...entry, name: 'All ' + root.name, group: root.name });
				sets.forEach(set => entries.push({ root: root.id, set: set.id, name: set.name, count: setCounts[set.id], icon: set.icon, group: root.name, child: true }));
			}
		});
		// With nothing grouped above them, the single roots need no heading.
		const grouped = entries.some(entry => entry.group);
		const heading = creator ? 'More creators' : this.schema.browseLabel === 'Style' ? 'More styles' : 'More categories';
		single.forEach(entry => entries.push(grouped ? { ...entry, group: heading } : entry));
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

		this.field.setAttribute('aria-label', mode === 'creator' ? 'Creator' : this.schema.browseLabel);
		const nodes = [];
		let group = null;
		entries.forEach(entry => {
			const option = this.createOption(entry);
			option.selected = entry === current;
			if (!entry.group) { nodes.push(option); return; }
			if (group?.label !== entry.group) {
				// One rule sets home apart from the groups under it.
				if (!group && nodes.length) nodes.push(document.createElement('hr'));
				group = document.createElement('optgroup');
				group.label = entry.group;
				nodes.push(group);
			}
			group.appendChild(option);
		});
		this.field.replaceChildren(...nodes);
		this.field.disabled = !entries.length;

		// A set's parent is its style or creator; theirs is home, where there is one.
		this.parent = (current?.set && entries.find(entry => entry.root === current.root && !entry.set))
			|| (current && current.root !== LIBRARY_ALL_ID && entries.find(entry => entry.root === LIBRARY_ALL_ID))
			|| null;
		const label = this.parent ? `Up to ${this.parent.name}` : 'Up';
		this.upButton.disabled = !this.parent;
		this.upButton.title = label;
		this.upButton.setAttribute('aria-label', label);
		return this.selection;
	}

	// Thumbnail, name, count; a set under its style's "All" row leads with the
	// subdirectory arrow. A browser without the customizable select shows the
	// row's text alone, "Name (count)"; the styled row sets the count apart
	// itself and drops the parentheses.
	createOption(entry) {
		const option = document.createElement('option');
		option.value = entry.set ? `${entry.root}/${entry.set}` : entry.root;
		option.dataset.root = entry.root;
		if (entry.set) option.dataset.set = entry.set;
		if (entry.child) {
			const arrow = createIcon('subdirectory');
			arrow.classList.add('asset-browser-rail-child');
			arrow.setAttribute('aria-hidden', 'true');
			option.appendChild(arrow);
		}
		const preview = this.createPreview?.(this.catalog.getCategoryById(entry.set || entry.root));
		if (preview) {
			preview.classList.add('asset-browser-rail-preview');
			preview.setAttribute('aria-hidden', 'true');
			option.appendChild(preview);
		} else if (entry.icon) {
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
		const paren = (text) => {
			const mark = document.createElement('span');
			mark.className = 'asset-browser-rail-paren';
			mark.textContent = text;
			return mark;
		};
		count.append(paren(' ('), String(entry.count), paren(')'));
		option.append(name, count);
		return option;
	}
}

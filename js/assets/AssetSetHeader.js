class AssetSetHeader {
	constructor(onOrderChanged) {
		this.onOrderChanged = onOrderChanged;
		this.categoryId = null;
		this.originalOrder = false;
		this.element = document.createElement('div');
		this.element.className = 'asset-set-header';
		this.element.hidden = true;
	}

	// Name, then one quiet line of who made it and how big it is, then what it
	// is and any note.
	render(category, items) {
		if (this.categoryId !== category?.id) this.originalOrder = false;
		this.categoryId = category?.id || null;
		this.element.replaceChildren();
		this.element.hidden = !category;
		if (!category) return;
		const attr = Attribution.resolve(category.attribution);
		const line = document.createElement('div');
		line.className = 'asset-set-header-line';
		const title = document.createElement('span');
		title.className = 'asset-set-header-title';
		title.textContent = category.name;
		line.appendChild(title);
		if (items.some(item => item.originalOrder != null)) {
			const toggle = document.createElement('button');
			toggle.type = 'button';
			toggle.className = 'btn-flat';
			toggle.textContent = 'Original order';
			toggle.setAttribute('aria-pressed', String(this.originalOrder));
			toggle.addEventListener('click', () => {
				this.originalOrder = !this.originalOrder;
				this.onOrderChanged();
			});
			line.appendChild(toggle);
		}
		const meta = Attribution.buildCreditLine(attr) || document.createElement('div');
		meta.classList.add('asset-set-header-meta');
		const count = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
		meta.append(meta.childNodes.length ? ` · ${count}` : count);
		const heading = document.createElement('div');
		heading.className = 'asset-set-header-heading';
		heading.append(line, meta);
		this.element.appendChild(heading);
		const paragraph = (className, text) => {
			const node = document.createElement('p');
			node.className = className;
			node.textContent = text;
			this.element.appendChild(node);
		};
		if (category.description) paragraph('asset-set-header-description', category.description);
		if (attr?.notes) paragraph('asset-set-header-note', attr.notes);
	}

	sort(items) {
		const ordered = sortByGlitterColor(items);
		return this.originalOrder ? ordered.sort((a, b) => (a.originalOrder ?? Infinity) - (b.originalOrder ?? Infinity)) : ordered;
	}
}

class AssetSetHeader {
	static createTitleLine(name, itemCount) {
		const line = document.createElement('div');
		line.className = 'asset-set-header-line';
		const title = document.createElement('span');
		title.className = 'asset-set-header-title';
		title.textContent = name;
		const count = document.createElement('span');
		count.className = 'asset-set-header-count';
		count.textContent = `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
		line.append(title, count);
		return line;
	}

	constructor(onOrderChanged) {
		this.onOrderChanged = onOrderChanged;
		this.categoryId = null;
		this.originalOrder = false;
		this.element = document.createElement('div');
		this.element.className = 'asset-set-header';
		this.element.hidden = true;
	}

	// Name and size, then one quiet line of who made it, then what it is and
	// any note.
	render(category, items) {
		if (this.categoryId !== category?.id) this.originalOrder = false;
		this.categoryId = category?.id || null;
		this.element.replaceChildren();
		this.element.hidden = !category;
		if (!category) return;
		const attr = Attribution.resolve(category.attribution);
		const line = AssetSetHeader.createTitleLine(category.name, items.length);
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
		const heading = document.createElement('div');
		heading.className = 'asset-set-header-heading';
		heading.appendChild(line);
		const credit = Attribution.buildCreditLine(attr);
		if (credit) {
			credit.classList.add('asset-set-header-meta');
			heading.appendChild(credit);
		}
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

	// Items arrive in library order, which is the order to show. The toggle
	// puts the artist's own order first for the tiles that record one.
	sort(items) {
		const ordered = [...items];
		return this.originalOrder ? ordered.sort((a, b) => (a.originalOrder ?? Infinity) - (b.originalOrder ?? Infinity)) : ordered;
	}
}

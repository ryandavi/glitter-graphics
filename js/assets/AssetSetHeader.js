class AssetSetHeader {
	constructor(onOrderChanged) {
		this.onOrderChanged = onOrderChanged;
		this.categoryId = null;
		this.originalOrder = false;
		this.element = document.createElement('div');
		this.element.className = 'asset-set-header';
		this.element.hidden = true;
	}

	render(category, items) {
		if (this.categoryId !== category?.id) this.originalOrder = false;
		const wasOpen = this.categoryId === category?.id && this.element.querySelector('details')?.open;
		this.categoryId = category?.id || null;
		this.element.replaceChildren();
		this.element.hidden = !category;
		if (!category) return;
		const line = document.createElement('div');
		line.className = 'asset-set-header-line';
		const title = document.createElement('span');
		const attr = Attribution.resolve(category.attribution);
		title.textContent = category.name + (attr?.author ? ' · by ' + attr.author : '');
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
		this.element.appendChild(line);
		if (category.description) {
			const description = document.createElement('p');
			description.textContent = category.description;
			this.element.appendChild(description);
		}
		const credit = Attribution.buildCreditElement(attr, { unframed: true });
		if (credit) {
			const disclosure = document.createElement('details');
			disclosure.open = Boolean(wasOpen);
			const summary = document.createElement('summary');
			summary.textContent = 'Credit';
			disclosure.append(summary, credit);
			this.element.appendChild(disclosure);
		}
	}

	sort(items) {
		const ordered = sortByGlitterColor(items);
		return this.originalOrder ? ordered.sort((a, b) => (a.originalOrder ?? Infinity) - (b.originalOrder ?? Infinity)) : ordered;
	}
}

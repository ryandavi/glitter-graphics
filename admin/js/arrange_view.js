// One category as the grid the editor shows it in. The order saved here is
// the order the editor's Library uses, so it is arranged by eye, in two
// dimensions, instead of in the sidebar's single column.
class ArrangeView {
	constructor(editor, modal) {
		this.editor = editor;
		this.modal = modal;
		this.category = null;
		this.dragged = null;
		this.body = modal.querySelector('.modal-body');
		this.body.innerHTML = `
			<div class="manager-toolbar arrange-toolbar">
				<label class="arrange-set-filter">Show set <select data-arrange-set></select></label>
				<span class="arrange-hint">Drag a tile, or focus one and hold Alt with the arrow keys.</span>
				<button type="button" class="btn btn-secondary" data-arrange-color hidden>Sort by color</button>
			</div>
			<div class="arrange-grid" data-arrange-grid></div>
		`;
		this.grid = this.body.querySelector('[data-arrange-grid]');
		this.setFilter = this.body.querySelector('[data-arrange-set]');
		this.colorButton = this.body.querySelector('[data-arrange-color]');
		this.setFilter.addEventListener('change', () => this.applySetFilter());
		this.colorButton.addEventListener('click', () => this.sortByColor());
		modal.querySelector('[data-arrange-save]').addEventListener('click', () => this.save());
		modal.querySelectorAll('[data-arrange-close]').forEach(button => button.addEventListener('click', () => this.editor.requestDeactivateModal(this.modal)));
		this.bindDrag();
		this.grid.addEventListener('keydown', event => this.handleKey(event));
	}

	open(categoryId) {
		this.category = this.editor.categories.find(category => Number(category.id) === Number(categoryId));
		const assets = this.editor.assets.filter(asset => Number(asset[this.editor.config.categoryIdField]) === Number(categoryId));
		this.modal.querySelector('.modal-header h3').textContent = `Arrange ${this.category?.name || ''}`;
		this.colorButton.hidden = typeof sortByGlitterColor !== 'function' || this.editor.config.assetType !== 'glitter';
		const sets = new Map(assets.filter(asset => asset.set_id).map(asset => [String(asset.set_id), asset.set_name]));
		this.setFilter.replaceChildren(new Option('All', ''), ...[...sets].map(([id, name]) => new Option(name, id)));
		this.setFilter.closest('label').hidden = !sets.size;
		this.render(assets);
		this.editor.activateModal(this.modal);
	}

	render(assets) {
		this.grid.replaceChildren(...assets.map(asset => {
			const tile = document.createElement('button');
			tile.type = 'button';
			tile.className = 'arrange-tile';
			tile.draggable = true;
			tile.dataset.id = asset.id;
			tile.dataset.set = asset.set_id || '';
			tile.classList.toggle('is-inactive', !Number(asset.is_active));
			tile.title = [asset.name, asset.set_name, Number(asset.is_active) ? '' : 'not published'].filter(Boolean).join(' · ');
			tile.innerHTML = this.editor.renderAssetThumbnail(asset);
			tile._asset = asset;
			return tile;
		}));
		this.applySetFilter();
	}

	// Other sets dim instead of leaving, so a tile's place in the whole
	// category stays visible while one set is being looked at.
	applySetFilter() {
		const set = this.setFilter.value;
		for (const tile of this.grid.children) tile.classList.toggle('is-dimmed', Boolean(set) && tile.dataset.set !== set);
	}

	markDirty() {
		this.modal._adminDirty = true;
	}

	bindDrag() {
		this.grid.addEventListener('dragstart', event => {
			this.dragged = event.target.closest('.arrange-tile');
			this.dragged?.classList.add('dragging');
		});
		this.grid.addEventListener('dragend', () => {
			this.dragged?.classList.remove('dragging');
			this.dragged = null;
		});
		this.grid.addEventListener('dragover', event => {
			if (!this.dragged) return;
			event.preventDefault();
			const target = event.target.closest('.arrange-tile');
			if (!target || target === this.dragged) return;
			const { left, width } = target.getBoundingClientRect();
			const before = event.clientX < left + width / 2;
			if ((before ? target.previousElementSibling : target.nextElementSibling) === this.dragged) return;
			this.grid.insertBefore(this.dragged, before ? target : target.nextElementSibling);
			this.markDirty();
		});
	}

	// Arrows walk the grid in reading order; with Alt they carry the tile.
	handleKey(event) {
		const tile = event.target.closest('.arrange-tile');
		const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
		if (!tile || !step) return;
		event.preventDefault();
		const tiles = [...this.grid.children];
		const columns = ['ArrowUp', 'ArrowDown'].includes(event.key)
			? tiles.filter(other => other.offsetTop === tiles[0].offsetTop).length : 1;
		const index = tiles.indexOf(tile);
		const next = Math.max(0, Math.min(tiles.length - 1, index + step * columns));
		if (next === index) return;
		if (!event.altKey) { tiles[next].focus(); return; }
		this.grid.insertBefore(tile, next > index ? tiles[next].nextElementSibling : tiles[next]);
		tile.focus();
		this.markDirty();
	}

	// A proposal: nothing is written until Save.
	sortByColor() {
		const tiles = [...this.grid.children];
		const items = tiles.map(tile => ({
			tile,
			colorCodes: String(tile._asset.color_codes || '').split(',').map(code => code.trim()).filter(Boolean),
			tags: String(tile._asset.tag_names || '').split(' ')
		}));
		this.grid.replaceChildren(...sortByGlitterColor(items).map(item => item.tile));
		this.markDirty();
	}

	async save() {
		const order = [...this.grid.children].map(tile => Number(tile.dataset.id));
		await AdminAPI.json(`includes/api.php?action=reorder&type=${this.editor.config.assetType}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ order })
		});
		this.editor.deactivateModal(this.modal);
		await this.editor.loadAssets();
		this.editor.showStatus(`${this.category?.name || 'Category'} order saved. It reaches the editor on the next Export JSON.`, 'success');
	}
}

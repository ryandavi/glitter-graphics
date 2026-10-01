class StickerEditor extends AssetEditor {
	constructor() {
		super({
			assetType: 'sticker',
			assetLabel: 'Sticker',
			assetLabelPlural: 'Stickers',
			enableSorting: true,
			listContainerId: 'stickerList',
			categoryIdField: 'sticker_category_id',
			tagModalId: 'tagModal'
		});
	}

	renderEditor() {
		super.renderEditor();
		const slice = this.currentAsset.slice || { top: 0, right: 0, bottom: 0, left: 0, mode: 'stretch' };
		const section = document.createElement('details');
		section.className = 'admin-section slice-editor';
		section.open = true;
		section.innerHTML = `<summary class="admin-section-title">Slice</summary>
			<div class="property-list">
				<label><input id="sliceEnabled" type="checkbox" ${this.currentAsset.slice ? 'checked' : ''}> Stretchable</label>
				<div class="slice-insets">${['top', 'right', 'bottom', 'left'].map(side => `<label>${side}<input id="slice_${side}" type="number" min="0" step="1" value="${slice[side]}"></label>`).join('')}</div>
				<label>Mode <select id="slice_mode"><option value="stretch">Stretch</option><option value="round">Round</option></select></label>
				<div class="slice-source"><img alt="Slice guides" src="${CONFIG.image_base_path}${this.escapeHtml(this.currentAsset.url)}">${['top', 'right', 'bottom', 'left'].map(side => `<button type="button" class="slice-guide slice-guide-${side}" data-side="${side}" aria-label="Drag ${side} slice inset"></button>`).join('')}</div>
				<p class="slice-validation" role="status"></p><div class="slice-samples"><canvas width="360" height="140"></canvas><canvas width="140" height="300"></canvas></div>
			</div>`;
		document.getElementById('editorContent').append(section);
		section.querySelector('#slice_mode').value = slice.mode;
		const refresh = () => { this.setDirty(true); this.refreshSlicePreview(section); };
		section.querySelectorAll('input, select').forEach(input => input.addEventListener('input', refresh));
		['width', 'height', 'is_pixelated'].forEach(id => document.getElementById(id).addEventListener('input', refresh));
		const image = section.querySelector('img');
		image.addEventListener('load', () => this.refreshSlicePreview(section));
		section.querySelectorAll('.slice-guide').forEach(guide => {
			guide.addEventListener('pointerdown', event => {
				event.preventDefault();
				guide.setPointerCapture(event.pointerId);
			});
			guide.addEventListener('pointermove', event => {
				if (!guide.hasPointerCapture(event.pointerId)) return;
				const bounds = image.getBoundingClientRect();
				const side = guide.dataset.side;
				const horizontal = side === 'left' || side === 'right';
				const size = horizontal ? Number(this.currentAsset.width) : Number(this.currentAsset.height);
				let fraction = horizontal ? (event.clientX - bounds.left) / bounds.width : (event.clientY - bounds.top) / bounds.height;
				if (side === 'right' || side === 'bottom') fraction = 1 - fraction;
				section.querySelector(`#slice_${side}`).value = Math.round(Math.max(0, Math.min(1, fraction)) * size);
				refresh();
			});
		});
		this.refreshSlicePreview(section);
	}

	readSliceForm() {
		if (!document.getElementById('sliceEnabled').checked) return null;
		return Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side, Number(document.getElementById(`slice_${side}`).value)]).concat([['mode', document.getElementById('slice_mode').value]]));
	}

	getAssetDataFromForm() {
		return { ...super.getAssetDataFromForm(), slice: this.readSliceForm() };
	}

	refreshSlicePreview(section) {
		const image = section.querySelector('img');
		const width = Number(document.getElementById('width').value);
		const height = Number(document.getElementById('height').value);
		const raw = this.readSliceForm();
		const slice = normalizeSlice(raw, width, height);
		section.querySelector('.slice-validation').textContent = raw && !slice ? 'Use nonnegative integer insets that leave a nonempty center.' : '';
		section.querySelectorAll('.slice-guide').forEach(guide => {
			const side = guide.dataset.side;
			guide.hidden = !raw;
			guide.style[side] = `${100 * (raw?.[side] || 0) / (side === 'left' || side === 'right' ? width : height)}%`;
		});
		if (!image.complete || !image.naturalWidth) return;
		section.querySelectorAll('canvas').forEach(canvas => {
			const ctx = canvas.getContext('2d');
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			const pixelated = document.getElementById('is_pixelated').checked;
			ctx.imageSmoothingEnabled = !pixelated;
			if (slice) {
				const scale = getSliceScale(slice, { scaleX: canvas.width / width, scaleY: canvas.height / height, pixelated, boxWidth: canvas.width, boxHeight: canvas.height });
				drawSlicedImage(ctx, image, getSliceRects(slice, width, height, canvas.width, canvas.height, scale, { pixelated }));
			} else ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
		});
	}

	analyzeCurrentSticker() {
		return this.analyzeCurrentAsset();
	}
}

StickerEditor.FIELDS = [
	{ key: 'name', label: 'Name', input: 'text', section: 'basic' },
	{ key: 'url', label: 'URL', input: 'text', section: 'basic' },
	// Replaces the old free-text `filename` field: that one edited the column
	// without moving the file, so the two could disagree. Rename owns both.
	{ key: 'rename', label: 'File name', input: 'rename', section: 'basic', hint: 'Renames the file on disk and repoints this record. The public URL changes, so re-export and expect saved projects using the old path to lose this asset.' },
	{ key: 'attribution', label: 'Attribution', input: 'attribution', section: 'attribution', nullable: true },
	{ key: 'sticker_text', label: 'Sticker Text', input: 'text', section: 'basic', nullable: true },
	{ key: 'sticker_category_id', label: 'Category', input: 'select', section: 'organization' },
	{ key: 'is_active', label: 'Active', input: 'checkbox', section: 'publishing' },
	// Colors are machine data (masks, matching, future features); tags stay
	// the gallery's filter surface. Editing here writes a palette override.
	{ key: 'color_codes', label: 'Colors', input: 'colors', section: 'color', hint: 'Published to the editor for color-aware features. Auto-Analyze proposes these; your edits override them. Gallery filtering uses color tags, not this list.' },
	{ key: 'palette_type_override', label: 'Palette Type', input: 'paletteType', section: 'color', hint: 'Published as paletteType. Auto re-reads the type from the color list above, so it changes when you edit colors — pick a type to pin it instead. Dithered artwork often reads as more hue families than it has.' },
	{ key: 'analysis', label: 'Stored analysis', input: 'analysis', section: 'color' },
	{ key: 'width', label: 'Width (px)', input: 'number', section: 'tech', group: 'dimensions', groupLabel: 'Dimensions (px)', analyze: {} },
	{ key: 'height', label: 'Height (px)', input: 'number', section: 'tech', group: 'dimensions', groupLabel: 'Dimensions (px)', analyze: {} },
	{ key: 'file_size', label: 'File Size (bytes)', input: 'number', section: 'tech', analyze: {} },
	{ key: 'frame_count', label: 'Frame Count', input: 'number', section: 'tech', analyze: {} },
	{ key: 'frame_rate', label: 'Frame Rate (centiseconds)', input: 'number', section: 'tech', analyze: {} },
	{ key: 'is_variable_framerate', label: 'Variable Frame Rate', input: 'checkbox', section: 'tech', analyze: { format: value => Number(value) ? 'Yes' : 'No' } },
	{ key: 'is_animated', label: 'Animated', input: 'checkbox', section: 'tech', analyze: { format: value => Number(value) ? 'Yes' : 'No' } },
	{ key: 'has_transparency', label: 'Has Transparency', input: 'checkbox', section: 'tech', analyze: { format: value => Number(value) ? 'Yes' : 'No' } },
	// Drives image-rendering in the editor and every export. On for pixel art
	// (the default), off for smooth/vector-ish art that should scale cleanly.
	// Auto-Analyze proposes a value from the artwork's soft-edge pixels, but
	// never writes it on its own — it stays a judgement you confirm.
	{ key: 'is_pixelated', label: 'Pixelated', input: 'checkbox', section: 'tech', analyze: { format: value => Number(value) ? 'Yes' : 'No' } },
	{ key: 'analysis_meta', label: 'Analysis', input: 'analysisMeta', section: 'tech' }
];

const app = new StickerEditor();

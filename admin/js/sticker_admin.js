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

	analyzeCurrentSticker() {
		return this.analyzeCurrentAsset();
	}
}

StickerEditor.FIELDS = [
	{ key: 'name', label: 'Name', input: 'text', section: 'basic' },
	{ key: 'filename', label: 'Filename', input: 'text', section: 'basic' },
	{ key: 'url', label: 'URL', input: 'text', section: 'basic' },
	{ key: 'attribution', label: 'Attribution', input: 'text', section: 'basic', nullable: true },
	{ key: 'sticker_text', label: 'Sticker Text', input: 'text', section: 'basic', nullable: true },
	{ key: 'sticker_category_id', label: 'Category', input: 'select', section: 'organization' },
	{ key: 'is_active', label: 'Active', input: 'checkbox', section: 'publishing' },
	// Colors are machine data (masks, matching, future features); tags stay
	// the gallery's filter surface. Editing here writes a palette override.
	{ key: 'color_codes', label: 'Colors', input: 'colors', section: 'color', hint: 'Published to the editor for color-aware features. Auto-Analyze proposes these; your edits override them. Gallery filtering uses color tags, not this list.' },
	{ key: 'analysis', label: 'Stored analysis', input: 'analysis', section: 'color' },
	{ key: 'width', label: 'Width (px)', input: 'number', section: 'tech', group: 'dimensions', groupLabel: 'Dimensions (px)', analyze: {} },
	{ key: 'height', label: 'Height (px)', input: 'number', section: 'tech', group: 'dimensions', groupLabel: 'Dimensions (px)', analyze: {} },
	{ key: 'file_size', label: 'File Size (bytes)', input: 'number', section: 'tech', analyze: {} },
	{ key: 'frame_count', label: 'Frame Count', input: 'number', section: 'tech', analyze: {} },
	{ key: 'frame_rate', label: 'Frame Rate (centiseconds)', input: 'number', section: 'tech', analyze: {} },
	{ key: 'is_variable_framerate', label: 'Variable Frame Rate', input: 'checkbox', section: 'tech', analyze: { format: value => Number(value) ? 'Yes' : 'No' } },
	{ key: 'is_animated', label: 'Animated', input: 'checkbox', section: 'tech', analyze: { format: value => Number(value) ? 'Yes' : 'No' } },
	{ key: 'has_transparency', label: 'Has Transparency', input: 'checkbox', section: 'tech', analyze: { format: value => Number(value) ? 'Yes' : 'No' } },
	{ key: 'analysis_meta', label: 'Analysis', input: 'analysisMeta', section: 'tech' }
];

const app = new StickerEditor();

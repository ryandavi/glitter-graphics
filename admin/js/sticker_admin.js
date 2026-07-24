class StickerEditor extends AssetEditor {
	constructor() {
		super({
			assetType: 'sticker',
			assetLabel: 'Sticker',
			assetLabelPlural: 'Stickers',
			enableSorting: false,
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
	{ key: 'url', label: 'URL', input: 'text', section: 'basic', full: true },
	{ key: 'sticker_category_id', label: 'Category', input: 'select', section: 'basic' },
	{ key: 'attribution', label: 'Attribution', input: 'text', section: 'basic', nullable: true },
	{ key: 'sticker_text', label: 'Sticker Text', input: 'text', section: 'basic', nullable: true },
	{ key: 'is_active', label: 'Active', input: 'checkbox', section: 'basic' },
	{ key: 'width', label: 'Width (px)', input: 'number', section: 'tech', analyze: {} },
	{ key: 'height', label: 'Height (px)', input: 'number', section: 'tech', analyze: {} },
	{ key: 'file_size', label: 'File Size (bytes)', input: 'number', section: 'tech', analyze: {} },
	{ key: 'frame_count', label: 'Frame Count', input: 'number', section: 'tech', analyze: {} },
	{ key: 'frame_rate', label: 'Frame Rate (centiseconds)', input: 'number', section: 'tech', analyze: {} },
	{ key: 'is_variable_framerate', label: 'Variable Frame Rate', input: 'checkbox', section: 'tech', analyze: { format: value => Number(value) ? 'Yes' : 'No' } },
	{ key: 'is_animated', label: 'Animated', input: 'checkbox', section: 'tech', analyze: { format: value => Number(value) ? 'Yes' : 'No' } },
	{ key: 'has_transparency', label: 'Has Transparency', input: 'checkbox', section: 'tech', analyze: { format: value => Number(value) ? 'Yes' : 'No' } }
];

const app = new StickerEditor();

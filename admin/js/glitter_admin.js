class GlitterEditor extends AssetEditor {
	constructor() {
		super({
			assetType: 'glitter',
			assetLabel: 'Glitter',
			assetLabelPlural: 'Glitters',
			enableSorting: true,
			showRecentSection: false,
			listContainerId: 'swatchList',
			categoryIdField: 'glitter_category_id',
			tagModalId: 'tagModal'
		});
	}

	renderAssetThumbnail(asset) {
		return `<img src="${CONFIG.image_base_path}${this.escapeHtml(asset.url)}" class="swatch-thumb" alt="">`;
	}

}

GlitterEditor.FIELDS = [
	{ key: 'name', label: 'Name', input: 'text', section: 'basic' },
	{ key: 'generated_name', label: 'Generated Name', input: 'text', section: 'basic', analyze: {} },
	{ key: 'url', label: 'URL', input: 'text', section: 'basic' },
	{ key: 'glitter_category_id', label: 'Category', input: 'select', section: 'organization' },
	{ key: 'is_pixelated', label: 'Pixelated', input: 'checkbox', section: 'tech' },
	{ key: 'is_active', label: 'Active', input: 'checkbox', section: 'publishing' },
	{ key: 'width', label: 'Width (px)', input: 'number', section: 'tech', group: 'dimensions', groupLabel: 'Dimensions (px)', analyze: {} },
	{ key: 'height', label: 'Height (px)', input: 'number', section: 'tech', group: 'dimensions', groupLabel: 'Dimensions (px)', analyze: {} },
	{ key: 'file_size', label: 'File Size (bytes)', input: 'number', section: 'tech', analyze: {} },
	{ key: 'frame_count', label: 'Frame Count', input: 'number', section: 'tech', analyze: {} },
	{ key: 'frame_rate', label: 'Frame Rate (centiseconds)', input: 'number', section: 'tech', analyze: {} },
	{ key: 'is_variable_framerate', label: 'Variable Frame Rate', input: 'checkbox', section: 'tech', analyze: { format: value => Number(value) ? 'Yes' : 'No' } },
	{ key: 'is_animated', label: 'Animated', input: 'checkbox', section: 'tech', analyze: { format: value => Number(value) ? 'Yes' : 'No' } },
	{ key: 'has_transparency', label: 'Has Transparency', input: 'checkbox', section: 'tech', analyze: { format: value => Number(value) ? 'Yes' : 'No' } },
	{ key: 'color_codes', label: 'Colors', input: 'colors', section: 'color', hint: 'Published to the editor and used by Auto Glitter. Auto-Analyze proposes these; your edits override them.' },
	{ key: 'color_value', label: 'Color Value', input: 'number', step: '0.001', section: 'color', analyze: {} },
	{ key: 'hue', label: 'Hue', input: 'number', step: '0.001', section: 'color', analyze: {} },
	{ key: 'analysis', label: 'Stored analysis', input: 'analysis', section: 'color' },
	{ key: 'analysis_meta', label: 'Analysis', input: 'analysisMeta', section: 'tech' }
];

const app = new GlitterEditor();

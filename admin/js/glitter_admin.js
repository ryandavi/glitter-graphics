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

	showAnalyzeModal(analysis) {
		super.showAnalyzeModal(analysis);
		const colors = analysis.color_codes ? analysis.color_codes.split(',') : [];
		const weights = analysis.color_weights ? analysis.color_weights.split(',').map(Number) : [];
		const currentColors = this.currentAsset.color_codes ? this.currentAsset.color_codes.split(',').map(color => color.trim().toUpperCase()) : [];
		const currentWeights = this.currentAsset.color_weights ? this.currentAsset.color_weights.split(',').map(Number) : [];
		const colorsChanged = colors.length !== currentColors.length
			|| colors.some((color, index) => color.trim().toUpperCase() !== currentColors[index])
			|| weights.length !== currentWeights.length
			|| weights.some((weight, index) => Math.abs(weight - currentWeights[index]) >= 0.005);
		if (!colorsChanged) return;
		const results = document.getElementById('analyzeResults');
		results.querySelector('.analysis-no-changes')?.remove();
		results.insertAdjacentHTML('beforeend', `<div class="analyze-result-item analyze-colors">
			<input type="checkbox" id="apply_color_codes" checked>
			<div><strong>Dominant Colors</strong><div class="coverage-swatches">${colors.map((color, index) =>
				`<span class="coverage-swatch"><i style="--swatch-color:${this.escapeHtml(color)};--swatch-weight:${Math.round((weights[index] || 0) * 100)}%"></i>
				${this.escapeHtml(color)} · ${Math.round((weights[index] || 0) * 100)}%</span>`).join('')}</div></div>
		</div>`);
	}

	applyAnalysis() {
		super.applyAnalysis();
		if (!document.getElementById('apply_color_codes')?.checked) return;
		const colors = this.analysisResults.color_codes ? this.analysisResults.color_codes.split(',') : [];
		const weights = this.analysisResults.color_weights ? this.analysisResults.color_weights.split(',') : [];
		document.getElementById('colorInputs').innerHTML = colors.map((color, index) =>
			this.renderColorField(color, index, weights[index])).join('');
		this.currentAsset.color_codes = colors.join(',');
		this.currentAsset.color_weights = weights.join(',');
	}
}

GlitterEditor.FIELDS = [
	{ key: 'name', label: 'Name', input: 'text', section: 'basic' },
	{ key: 'generated_name', label: 'Generated Name', input: 'text', section: 'basic', analyze: {} },
	{ key: 'url', label: 'URL', input: 'text', section: 'basic', full: true },
	{ key: 'glitter_category_id', label: 'Category', input: 'select', section: 'basic' },
	{ key: 'is_pixelated', label: 'Pixelated', input: 'checkbox', section: 'basic' },
	{ key: 'is_active', label: 'Active', input: 'checkbox', section: 'basic' },
	{ key: 'width', label: 'Width (px)', input: 'number', section: 'tech', analyze: {} },
	{ key: 'height', label: 'Height (px)', input: 'number', section: 'tech', analyze: {} },
	{ key: 'file_size', label: 'File Size (bytes)', input: 'number', section: 'tech', analyze: {} },
	{ key: 'frame_count', label: 'Frame Count', input: 'number', section: 'tech', analyze: {} },
	{ key: 'frame_rate', label: 'Frame Rate (centiseconds)', input: 'number', section: 'tech', analyze: {} },
	{ key: 'is_variable_framerate', label: 'Variable Frame Rate', input: 'checkbox', section: 'tech', analyze: { format: value => Number(value) ? 'Yes' : 'No' } },
	{ key: 'is_animated', label: 'Animated', input: 'checkbox', section: 'tech', analyze: { format: value => Number(value) ? 'Yes' : 'No' } },
	{ key: 'has_transparency', label: 'Has Transparency', input: 'checkbox', section: 'tech', analyze: { format: value => Number(value) ? 'Yes' : 'No' } },
	{ key: 'color_codes', label: 'Colors', input: 'colors', section: 'color' },
	{ key: 'color_value', label: 'Color Value', input: 'number', step: '0.001', section: 'color', analyze: {} },
	{ key: 'hue', label: 'Hue', input: 'number', step: '0.001', section: 'color', analyze: {} }
];

const app = new GlitterEditor();

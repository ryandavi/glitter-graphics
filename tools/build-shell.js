const fs = require('fs');
const path = require('path');
const { getAppRegistries, escapeHtml } = require('./build-modals');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');

function renderToolButtons(indent, registries) {
	const { ToolType, TOOLS, TOOL_ORDER, COMMANDS } = registries;
	let previousGroup = null;
	const lines = [];
	TOOL_ORDER.forEach((tool) => {
		const definition = TOOLS[tool];
		if (previousGroup && definition.toolbarGroup !== previousGroup) {
			lines.push(`${indent}<span class="toolbar-tool-separator" aria-hidden="true"></span>`);
		}
		const key = COMMANDS[definition.command]?.displayKey;
		const title = `${definition.name}${key ? ` (${key})` : ''}${definition.titleNote || ''}`;
		const disabled = tool === ToolType.SELECT ? '' : ' disabled';
		lines.push(
			`${indent}<button class="btn-icon icon-wrapper" id="${escapeHtml(`${tool}Tool`)}" type="button" data-tool="${escapeHtml(tool)}" title="${escapeHtml(title)}"${disabled}>`,
			`${indent}\t<svg class="icon"><use href="#icon-${escapeHtml(definition.icon)}"></use></svg>`,
			`${indent}\t<span class="name">${escapeHtml(definition.buttonLabel)}</span>`,
			`${indent}</button>`
		);
		previousGroup = definition.toolbarGroup;
	});
	return lines.join('\n');
}

function renderStartPresets(indent, registries) {
	return registries.CONFIG.canvas.presets.filter((preset) => preset.quickStart).map((preset) => [
		`${indent}<button class="action-card is-quiet workspace-start-preset" type="button" data-preset-id="${escapeHtml(preset.id)}" aria-label="New ${escapeHtml(preset.label)} canvas, ${escapeHtml(preset.width)} by ${escapeHtml(preset.height)} pixels">`,
		`${indent}\t<span class="action-card-media workspace-start-preset-preview">`,
		`${indent}\t\t<span class="workspace-start-preset-shape" style="aspect-ratio: ${escapeHtml(preset.width)} / ${escapeHtml(preset.height)};"></span>`,
		`${indent}\t</span>`,
		`${indent}\t<strong class="action-card-title">${escapeHtml(preset.label)}</strong>`,
		`${indent}\t<span class="action-card-detail">${escapeHtml(preset.width)} × ${escapeHtml(preset.height)} px</span>`,
		`${indent}</button>`
	].join('\n')).join('\n');
}

function replaceRegion(source, name, render) {
	const pattern = new RegExp(`(^[\\t ]*)<!-- shell:${name}:start -->[\\s\\S]*?^[\\t ]*<!-- shell:${name}:end -->`, 'mu');
	const match = source.match(pattern);
	if (!match) throw new Error(`Missing shell:${name} marker pair in index.html`);
	const indent = match[1];
	return source.replace(pattern, `${indent}<!-- shell:${name}:start -->\n${render(indent)}\n${indent}<!-- shell:${name}:end -->`);
}

function buildShell(source) {
	const registries = getAppRegistries();
	let output = replaceRegion(source, 'tools', (indent) => renderToolButtons(indent, registries));
	output = replaceRegion(output, 'presets', (indent) => renderStartPresets(indent, registries));
	output = replaceRegion(output, 'manifests', (indent) => {
		const { CONFIG } = registries;
		// Large browse indexes start in parallel during init, preserving CSS bandwidth.
		const manifests = [CONFIG.tools.shapes.manifest, CONFIG.tools.maskBrush.rasterBrushes.manifest,
			CONFIG.tools.text.fontsManifest];
		return manifests.map((file) => `${indent}<link rel="preload" as="fetch" crossorigin fetchpriority="low" href="${escapeHtml(file)}?v=${escapeHtml(CONFIG.app.assets.manifestVersion)}">`).join('\n');
	});
	return output;
}

function main(args = process.argv.slice(2)) {
	const unknown = args.filter((arg) => arg !== '--check');
	if (unknown.length) throw new Error(`Unknown option: ${unknown[0]}`);
	const source = fs.readFileSync(indexPath, 'utf8');
	const output = buildShell(source);
	if (args.includes('--check')) {
		if (output !== source) {
			process.stderr.write('index.html shell markup is out of date; run node tools/build-shell.js\n');
			return 1;
		}
		process.stdout.write('index.html shell markup is up to date\n');
		return 0;
	}
	if (output !== source) fs.writeFileSync(indexPath, output);
	process.stdout.write(output === source ? 'index.html shell markup is already up to date\n' : 'updated index.html shell markup\n');
	return 0;
}

if (require.main === module) {
	try {
		process.exitCode = main();
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		process.exitCode = 1;
	}
}

module.exports = { buildShell, renderToolButtons, renderStartPresets, replaceRegion, main };

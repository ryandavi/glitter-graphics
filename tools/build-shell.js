const fs = require('fs');
const path = require('path');
const { scriptManifest, bundleConfig, getAssetUrl, getScriptUrls } = require('./script-manifest');
const { getAppRegistries, escapeHtml } = require('./build-modals');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');

function renderToolButtons(indent, registries) {
	const { ToolType, TOOLS, TOOL_ORDER, COMMANDS, CONFIG } = registries;
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
			`${indent}<button class="btn-icon icon-wrapper${tool === CONFIG.app.startup.tool ? ' active' : ''}" id="${escapeHtml(`${tool}Tool`)}" type="button" data-tool="${escapeHtml(tool)}" title="${escapeHtml(title)}"${disabled}>`,
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

function renderScripts(indent) {
	const groups = Object.fromEntries(Object.keys(scriptManifest).map((id) => [id, getScriptUrls(id)]));
	return `${indent}<script>
${indent}	const SCRIPT_GROUP_URLS = ${JSON.stringify(groups)};
${indent}	(() => {
${indent}		const params = new URLSearchParams(location.search);
${indent}		const useSources = params.get(${JSON.stringify(bundleConfig.bundleParam)}) !== '1'
${indent}			&& (document.documentElement.classList.contains('is-localhost') || params.get(${JSON.stringify(bundleConfig.sourceParam)}) === '1');
${indent}		const sources = useSources ? SCRIPT_GROUP_URLS.boot : [${JSON.stringify(getAssetUrl(bundleConfig.output))}];
${indent}		const stylesheet = document.querySelector('link[rel="stylesheet"]');
${indent}		let started = false;
${indent}		const start = () => {
${indent}			if (started) return;
${indent}			started = true;
${indent}			const scripts = document.createDocumentFragment();
${indent}			for (const src of sources) {
${indent}				const script = document.createElement('script');
${indent}				script.async = false;
${indent}				script.src = src;
${indent}				script.onerror = () => {
${indent}					document.body.classList.add('boot-failed');
${indent}					const startCard = document.getElementById('workspaceStart');
${indent}					startCard.inert = false;
${indent}					startCard.querySelectorAll('button').forEach((button) => { button.disabled = true; });
${indent}					const reload = document.getElementById('bootReload');
${indent}					reload.hidden = false;
${indent}					reload.disabled = false;
${indent}					reload.onclick = () => location.reload();
${indent}					reload.textContent = 'Could not load the editor. Reload';
${indent}				};
${indent}				scripts.appendChild(script);
${indent}			}
${indent}			document.body.appendChild(scripts);
${indent}		};
${indent}		stylesheet.addEventListener('load', start, { once: true });
${indent}		if (stylesheet.sheet) start();
${indent}	})();
${indent}</script>`;
}

function buildShell(source) {
	const registries = getAppRegistries();
	let output = replaceRegion(source, 'tools', (indent) => renderToolButtons(indent, registries));
	output = replaceRegion(output, 'boot', (indent) => `${indent}<style>:root { --boot-indicator-delay: ${registries.CONFIG.app.boot.indicator.delayMs}ms; --boot-indicator-min-visible: ${registries.CONFIG.app.boot.indicator.minVisibleMs}ms; }</style>`);
	output = replaceRegion(output, 'presets', (indent) => renderStartPresets(indent, registries));
	output = replaceRegion(output, 'manifests', (indent) => {
		const { CONFIG } = registries;
		// Large browse indexes start in parallel during init, preserving CSS bandwidth.
		const manifests = [CONFIG.tools.shapes.manifest, CONFIG.tools.maskBrush.rasterBrushes.manifest,
			CONFIG.tools.text.fontsManifest];
		return manifests.map((file) => `${indent}<link rel="preload" as="fetch" crossorigin fetchpriority="low" href="${escapeHtml(file)}?v=${escapeHtml(CONFIG.app.assets.manifestVersion)}">`).join('\n');
	});
	output = replaceRegion(output, 'head-scripts', (indent) => getScriptUrls('head').map((url) => `${indent}<script src="${escapeHtml(url)}"></script>`).join('\n'));
	output = replaceRegion(output, 'local-host', (indent) => `${indent}<script>
${indent}	if (${JSON.stringify(bundleConfig.localHosts)}.includes(location.hostname)) {
${indent}		document.documentElement.classList.add('is-localhost');
${indent}	}
${indent}</script>`);
	output = replaceRegion(output, 'scripts', renderScripts);
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

'use strict';

// buildExportReport: which notices, upload-limit rows, save guide and primary
// action Export Ready shows for an export, and the Details tables.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const context = vm.createContext({ console, structuredClone, Math, navigator: { hardwareConcurrency: 4, userAgent: 'node' } });
for (const file of ['js/core/math.js', 'js/core/color.js', 'js/core/releases.js', 'js/core/fields.js', 'js/core/config.js', 'js/core/export-target.js', 'js/core/format.js', 'js/export/export-fit.js', 'js/export/export-report.js']) {
	vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
vm.runInContext('globalThis.api = { buildExportReport, EXPORT_TARGETS };', context);
const { buildExportReport, EXPORT_TARGETS } = context.api;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

const MB = 1024 * 1024;
const desktop = { isIOS: false, canShare: false };

function plan(overrides = {}) {
	return {
		totalDuration: 3300,
		sourceAnalysis: [],
		loopSeam: { exact: true },
		renderClock: { delaySpread: 0 },
		phaseTimings: [],
		...overrides,
		reduction: {
			smartReductionEnabled: true,
			framesRemoved: 0,
			selectionDuplicatesMerged: 0,
			preRenderFramesSkipped: 0,
			exactDuplicatesMerged: 0,
			nearDuplicatesMerged: 0,
			maximumVisualError: 0,
			originalFrameCount: 55,
			renderedFrameCount: 55,
			outputFrameCount: 55,
			preferredBudgetMet: true,
			budgetCompromiseRequired: false,
			durationPreserved: true,
			...overrides.reduction
		}
	};
}

function report({ target = 'animation:gif', size = 1024, timelinePlan = plan(), platform = desktop, colorAnalysis = null } = {}) {
	const resolved = EXPORT_TARGETS[target];
	return buildExportReport({
		blob: { size },
		fileName: `project.${resolved.extension}`,
		target: resolved,
		width: 1024,
		height: 1024,
		frameCount: resolved.isStill ? null : 55,
		duration: resolved.isStill ? null : 3.3,
		timelinePlan: resolved.isStill ? null : timelinePlan,
		colorAnalysis,
		platform
	});
}

const noticeIds = (result) => result.notices.map((notice) => notice.id).join(',');

// A clean export says nothing.
const clean = report();
assert(clean.notices.length === 0 && clean.uploadLimits.length === 0, 'A clean GIF export produced notices');
assert(!clean.facts.sizeWarning, 'A small file carried the size warning');
assert(clean.details === null, 'A clean export with no sources offered Details');
assert(clean.facts.fileName === 'project.gif' && clean.facts.frames === '55 frames' && clean.facts.duration === '3.30 s', 'Facts are wrong');

// Each notice appears only under its own rule, warnings first.
const noticeCases = [
	['speed', { reduction: { durationPreserved: false } }, 'warning'],
	['motion', { reduction: { budgetCompromiseRequired: true } }, 'warning'],
	['seam', { loopSeam: { exact: false } }, 'info']
];
for (const [id, overrides, level] of noticeCases) {
	const result = report({ timelinePlan: plan(overrides) });
	assert(noticeIds(result) === id, `Expected only the ${id} notice, got "${noticeIds(result)}"`);
	assert(result.notices[0].level === level, `${id} notice has level ${result.notices[0].level}`);
}
const every = report({ timelinePlan: plan({ loopSeam: { exact: false }, reduction: { durationPreserved: false, budgetCompromiseRequired: true } }) });
assert(noticeIds(every) === 'speed,motion,seam', `Notices are out of order: ${noticeIds(every)}`);

// Colors: only when the palette limited the image, and only for GIFs.
const colorCases = [
	[{ observedColorCount: 200, paletteSize: 256, significant: false }, 'animation:gif', false],
	[{ observedColorCount: 300, paletteSize: 256, significant: false }, 'animation:gif', true],
	[{ observedColorCount: 1025, paletteSize: 256, significant: true }, 'animation:gif', true],
	[{ observedColorCount: 100, paletteSize: 64, significant: false }, 'still:gif', true],
	[{ observedColorCount: 40, paletteSize: 64, significant: false }, 'still:gif', false],
	[{ observedColorCount: 5000, paletteSize: 256, significant: true }, 'still:png', false]
];
for (const [colorAnalysis, target, expected] of colorCases) {
	const fromPlan = target === 'animation:gif';
	const result = report({ target, colorAnalysis: fromPlan ? null : colorAnalysis, timelinePlan: plan(fromPlan ? { colorAnalysis } : {}) });
	assert(result.notices.some((notice) => notice.id === 'colors') === expected, `Color notice for ${target} ${JSON.stringify(colorAnalysis)} should be ${expected}`);
}

// Upload limits: one row per service, the smallest limit exceeded, and the
// note of the smallest tier that still fits.
const limitCases = [
	[4 * MB, ''],
	[8 * MB, 'X 5 MB fits on the web'],
	[12 * MB, 'X 5 MB fits on the web|Tumblr 10 MB|Discord 10 MB fits with Nitro Basic'],
	[60 * MB, 'X 5 MB|Tumblr 10 MB|Discord 10 MB fits with Nitro|Mastodon 16 MB'],
	[600 * MB, 'X 5 MB|Tumblr 10 MB|Discord 10 MB|Mastodon 16 MB']
];
for (const [size, expected] of limitCases) {
	const result = report({ size });
	const rows = result.uploadLimits.map((row) => [row.service, row.limit, row.note].filter(Boolean).join(' ')).join('|');
	assert(rows === expected, `Upload limits at ${size / MB} MB: "${rows}"`);
	assert(result.facts.sizeWarning === Boolean(expected), `Size warning at ${size / MB} MB`);
}

// Save guide and the one primary action, per platform and target.
const ios = (canShare) => ({ isIOS: true, canShare });
const platformCases = [
	['animation:gif', desktop, null, 'save', false],
	['still:png', desktop, null, 'save', false],
	['animation:gif', { isIOS: false, canShare: true }, null, 'save', true],
	['still:png', ios(true), null, 'save', true],
	['animation:gif', ios(true), 'ios-gif', 'share', true],
	['animation:mp4', ios(true), 'ios-video', 'share', true],
	['animation:gif', ios(false), 'ios-unsupported', null, false]
];
for (const [target, platform, guide, primary, share] of platformCases) {
	const result = report({ target, platform });
	const label = `${target} ${JSON.stringify(platform)}`;
	assert(result.saveGuide === guide, `${label}: save guide ${result.saveGuide}`);
	assert(result.primaryAction === primary, `${label}: primary action ${result.primaryAction}`);
	assert(result.actions.share === share, `${label}: share ${result.actions.share}`);
	assert(result.actions.save === (guide === null) && result.actions.open === (guide === null), `${label}: save/open availability`);
}

// Stills never offer Details.
assert(report({ target: 'still:gif' }).details === null && report({ target: 'still:png' }).facts.frames === '', 'A still export showed animation facts or Details');

// Details tables.
const detailed = report({
	timelinePlan: plan({
		colorAnalysis: { observedColorCount: 90, paletteSize: 128, paletteMode: 'shared', ditherEnabled: true, significant: false },
		sourceAnalysis: [
			...[1, 2, 3].map(() => ({ kind: 'authored', label: 'Pink sparkle', frameCount: 27, nativeFps: 10, nativeCycleDuration: 2700, variableTiming: false })),
			{ kind: 'authored', label: 'Star sticker', frameCount: 12, nativeFps: 8.33, nativeCycleDuration: 1440, variableTiming: true },
			{ kind: 'procedural', label: 'Shimmer', requestedPeriod: 800, resolvedPeriod: 825, cycleCount: 4, periodChanged: true }
		],
		phaseTimings: [{ label: 'Loading artwork', ms: 100 }, { label: 'Drawing frames', ms: 2200 }, { label: 'Idle', ms: 10 }, { label: 'Encoding', ms: 990 }],
		reduction: { framesRemoved: 5, exactDuplicatesMerged: 5, originalFrameCount: 60, outputFrameCount: 55, preferredBudgetMet: false }
	})
});
const tables = Object.fromEntries(detailed.details.tables.map((table) => [table.id, table]));
// A cell as the reader sees it: text, a badge label, or a measure with its unit.
const cellText = (cell) => {
	if (typeof cell === 'string') return cell;
	if (cell.badge) return `[${cell.badge}]`;
	const value = cell.from === null ? cell.value : `${cell.from} → ${cell.value}`;
	return ['', '×', '%'].includes(cell.unit) ? `${value}${cell.unit}` : `${value} ${cell.unit}`;
};
const cells = (table) => table.rows.map((row) => row.cells.map(cellText).join('|'));
assert(detailed.details.tables.map((table) => table.id).join(',') === 'sources,generated,optimization,timing', 'Details tables are missing or out of order');
assert(cells(tables.sources).join('\n') === ['Pink sparkle|3×|27|10.0 fps|2.70 s', 'Star sticker|1×|12|~8.3 fps|1.44 s', 'Export||55|16.7 fps|3.30 s'].join('\n'), `Sources table: ${cells(tables.sources).join(' / ')}`);
assert(tables.sources.rows.at(-1).strong, 'The Export row is not the emphasized last row');
assert(tables.optimization.keyValue && !tables.sources.keyValue, 'Only the Optimization table is a label and value list');
assert(cells(tables.generated)[0] === 'Shimmer|1×|800 → 825 ms|4', `Generated table: ${cells(tables.generated)[0]}`);
assert(tables.optimization.lines.join(' ') === 'Removed 5 repeated frames without changing the speed. Kept 55 frames to keep the motion smooth.', `Optimization lines: ${tables.optimization.lines.join(' ')}`);
assert(cells(tables.optimization).join('\n') === ['Frames|60 → 55', 'Repeated frames removed|5', 'Playback speed|Unchanged', 'Loop ending|Exact match', 'Palette|Shared', 'Colors|128', 'Dithering|[On]'].join('\n'), `Optimization rows: ${cells(tables.optimization).join(' / ')}`);
assert(cells(tables.timing).join('\n') === ['Loading artwork|0.1 s|3%', 'Drawing frames|2.2 s|67%', 'Encoding|1.0 s|30%', 'Total|3.3 s|100%'].join('\n'), `Timing table: ${cells(tables.timing).join(' / ')}`);
tables.sources.rows.concat(tables.generated.rows, tables.optimization.rows, tables.timing.rows).forEach((row) => {
	assert(row.cells.every((cell) => typeof cell === 'string' || typeof cell.badge === 'string' || typeof cell.value === 'string'), 'A table cell is not text, a badge or a measure');
});

process.stdout.write('Export report verification passed\n');

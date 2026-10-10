'use strict';

// planFitAttempt: which settings a size fit lowers next, when it stops, and
// which attempt it keeps. The file sizes come from a model, not an encoder.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const context = vm.createContext({ console, structuredClone, Math, navigator: { hardwareConcurrency: 4, userAgent: 'node' } });
for (const file of ['js/core/math.js', 'js/core/color.js', 'js/core/releases.js', 'js/core/fields.js', 'js/core/config.js', 'js/core/export-target.js', 'js/core/format.js', 'js/export/export-fit.js', 'js/export/export-report.js']) {
	vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
vm.runInContext('globalThis.api = { planFitAttempt, buildFitLadder, describeFitOverrides, resolveFitTarget, summarizeFit, buildExportReport, getExportOutputSize, EXPORT_TARGETS, CONFIG };', context);
const { planFitAttempt, buildFitLadder, describeFitOverrides, resolveFitTarget, summarizeFit, buildExportReport, getExportOutputSize, EXPORT_TARGETS, CONFIG } = context.api;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

const KB = 1024;
const defaults = { ...CONFIG.export.defaults, mp4Quality: CONFIG.export.mp4.defaultQuality };

// Runs a whole fit against `measure(settings)`, as the export flow does.
function runFit(targetId, settings, limitBytes, measure) {
	const target = EXPORT_TARGETS[targetId];
	const attempts = [{ step: 0, overrides: {}, bytes: measure(settings) }];
	for (;;) {
		const next = planFitAttempt({ target, settings, limitBytes, attempts });
		if (next.done) return { attempts, ...next };
		assert(attempts.length < CONFIG.export.fit.maxAttempts, 'A fit ran past its attempt limit');
		attempts.push({ ...next, bytes: measure({ ...settings, ...next.overrides }) });
	}
}

// A GIF whose size follows frames, colors and area.
const gifSize = (full) => (settings) => {
	const colors = settings.colorCount === 'auto' ? 256 : settings.colorCount;
	const frames = [1, 0.95, 0.9, 0.7, 0.6][settings.exportFidelity];
	return Math.round(full * frames * (colors / 256) ** 0.25 * (settings.outputScale / 100) ** 1.9 * (settings.ditherEnabled ? 1.3 : 1));
};

// Already under the limit: one attempt, nothing changed.
let fit = runFit('animation:gif', defaults, 5000 * KB, gifSize(4000 * KB));
assert(fit.attempts.length === 1 && fit.best === 0 && fit.reached, 'A file under the limit was exported again');

// A little over: the gentlest levers are enough, and the size stays 100%.
fit = runFit('animation:gif', defaults, 5000 * KB, gifSize(6000 * KB));
assert(fit.reached, 'A file 20% over did not fit');
assert(fit.attempts[fit.best].bytes <= 5000 * KB, 'The kept attempt is over the limit');
assert(!('outputScale' in fit.attempts[fit.best].overrides), `A small overshoot resized the export: ${describeFitOverrides(fit.attempts[fit.best].overrides)}`);

// Far over: it fits, and the kept attempt is the largest one that does.
fit = runFit('animation:gif', defaults, 1000 * KB, gifSize(9000 * KB));
assert(fit.reached, 'A file 9× over did not fit');
const fitting = fit.attempts.filter((attempt) => attempt.bytes <= 1000 * KB);
assert(fit.attempts[fit.best].bytes === Math.max(...fitting.map((attempt) => attempt.bytes)), 'The kept attempt is not the largest that fits');

// Impossible: the smallest attempt is kept and reported as a miss.
fit = runFit('animation:gif', defaults, 10 * KB, gifSize(90000 * KB));
assert(!fit.reached, 'An impossible fit reported success');
assert(fit.attempts[fit.best].bytes === Math.min(...fit.attempts.map((attempt) => attempt.bytes)), 'A missed fit did not keep its smallest attempt');

// The ladder only takes a target's own levers, and only steps below the
// current settings.
const pngKeys = new Set(buildFitLadder(EXPORT_TARGETS['still:png'], defaults).flatMap(Object.keys));
assert([...pngKeys].join() === 'outputScale', `PNG ladder used ${[...pngKeys]}`);
const small = buildFitLadder(EXPORT_TARGETS['animation:gif'], { ...defaults, outputScale: 50, colorCount: 64, exportFidelity: 4 });
assert(small.every((step) => (step.outputScale ?? 0) < 50 && (step.colorCount ?? 0) < 64 && !('exportFidelity' in step)), 'The ladder raised a setting that was already lower');
const stillGif = new Set(buildFitLadder(EXPORT_TARGETS['still:gif'], defaults).flatMap(Object.keys));
assert(!stillGif.has('exportFidelity'), 'A still GIF fit changed animation fidelity');

// A fidelity step hands frame sampling back to the stop.
const fidelityStep = buildFitLadder(EXPORT_TARGETS['animation:gif'], { ...defaults, maxSamplingFps: 30 })[1];
assert(fidelityStep.exportFidelity === 3 && fidelityStep.maxSamplingFps === 'auto' && fidelityStep.visualErrorThreshold === 'auto', 'A fidelity step left a manual sampling override in place');

// MP4: size follows bitrate, so it is solved in a step or two.
const mp4Size = (settings) => Math.round((settings.mp4Bitrate || CONFIG.export.mp4.qualityPresets[settings.mp4Quality].bitrate) / 8 * 15 * 1.04);
fit = runFit('animation:mp4', defaults, 1000 * KB, mp4Size);
assert(fit.reached && fit.attempts.length <= 3, `MP4 took ${fit.attempts.length} attempts`);
assert(fit.attempts[fit.best].overrides.mp4Bitrate >= CONFIG.export.fit.minMp4Bitrate && !('outputScale' in fit.attempts[fit.best].overrides), 'MP4 fit did not use bitrate alone');
// Below the bitrate floor it goes on to size.
fit = runFit('animation:mp4', defaults, 200 * KB, (settings) => Math.round(mp4Size(settings) * (settings.outputScale / 100) ** 1.5));
assert('outputScale' in fit.attempts[fit.attempts.length - 1].overrides, 'MP4 at the bitrate floor did not reduce size');

// JPG: quality first.
fit = runFit('still:jpeg', defaults, 300 * KB, (settings) => Math.round(500 * KB * (settings.jpegQuality / 90) ** 1.5 * (settings.outputScale / 100) ** 2));
assert(fit.reached && 'jpegQuality' in fit.attempts[fit.best].overrides, 'JPG fit did not lower quality');

// Target Size setting to a goal.
assert(resolveFitTarget(defaults) === null, 'Target Size None resolved to a goal');
assert(resolveFitTarget({ ...defaults, targetSize: 'custom', targetSizeKB: 800 }).limitBytes === 800 * KB, 'Custom target size');
const discord = resolveFitTarget({ ...defaults, targetSize: 'discord' });
assert(discord.limitBytes === 10 * 1024 * KB && discord.label === '10 MB for Discord', `Discord goal: ${JSON.stringify(discord)}`);

// What the result says.
assert(describeFitOverrides({ outputScale: 75, colorCount: 128, exportFidelity: 4, maxSamplingFps: 'auto' }) === 'Smallest file fidelity, 128 colors, 75% size', describeFitOverrides({ outputScale: 75, colorCount: 128, exportFidelity: 4 }));
const summary = summarizeFit({ goal: discord, attempts: [{ step: 0, overrides: {}, bytes: 12000 * KB }, { step: 3, overrides: { outputScale: 75 }, bytes: 9000 * KB }], best: 1, reached: true });
const report = buildExportReport({ blob: { size: 9000 * KB }, fileName: 'a.png', target: EXPORT_TARGETS['still:png'], width: 10, height: 10, fit: summary, platform: {} });
assert(report.notices[0].id === 'fit' && report.notices[0].level === 'info' && report.notices[0].text.includes('75% size'), 'Fit notice');
assert(report.details.tables.some((table) => table.id === 'fit' && table.rows.length === 2 && table.rows[1].strong), 'Fit details table');
const missed = buildExportReport({ blob: { size: 12000 * KB }, fileName: 'a.gif', target: EXPORT_TARGETS['still:gif'], width: 10, height: 10, fit: { ...summary, reached: false }, platform: {} });
assert(missed.notices[0].level === 'warning', 'A missed fit is a warning');

// Export Size.
assert(JSON.stringify(getExportOutputSize(400, 300, 50)) === JSON.stringify({ width: 200, height: 150, scaled: true }), 'Half size');
assert(!getExportOutputSize(400, 300, 100).scaled && getExportOutputSize(3, 3, 10).width === 1, 'Output size bounds');

console.log('export-fit-unit: ok');

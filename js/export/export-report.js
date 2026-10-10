'use strict';

// What Export Ready says about one finished export, as plain data: the facts,
// the save guide, which footer action leads, the notices and the Details
// tables. DOM-free so the rules run under node; ExportResultPresenter renders it.

// One row per service, from the size targets that warn. Tiers of a service
// collapse to the smallest limit the file is over, with the note of the
// smallest tier it still fits. `goal` is what the row's Fit button aims for.
function resolveUploadLimits(size, sizeTargets) {
	const services = new Map();
	sizeTargets.filter((target) => target.warn).forEach((target) => {
		if (!services.has(target.service)) services.set(target.service, []);
		services.get(target.service).push(target);
	});
	const rows = [];
	services.forEach((tiers, service) => {
		const ordered = [...tiers].sort((a, b) => a.limitKB - b.limitKB);
		const exceeded = ordered.filter((tier) => size > tier.limitKB * 1024);
		if (!exceeded.length) return;
		const fits = ordered[exceeded.length];
		rows.push({ service, limitKB: exceeded[0].limitKB, limit: formatSizeLimit(exceeded[0].limitKB), note: fits?.note || '', goal: describeSizeTarget(exceeded[0]) });
	});
	return rows.sort((a, b) => a.limitKB - b.limitKB);
}

// Exporters hand a finished file here. The export flow takes the result
// itself (callbacks.present) when it compares attempts before showing one.
function deliverExportResult(callbacks, presenter, { blob, fileName, completion = {}, ...result }) {
	callbacks.onStatus('Export complete!');
	callbacks.onComplete(completion);
	const delivered = { ...result, blob, file: new File([blob], fileName, { type: result.target.mimeType, lastModified: Date.now() }) };
	if (callbacks.present) callbacks.present(delivered);
	else presenter?.show(delivered);
}

function buildExportDetails({ target, timelinePlan, colorAnalysis, fit = null }) {
	const reduction = timelinePlan.reduction;
	// A cell is plain text, a measure ({ value, unit, from }) the presenter
	// formats with formatUnit, or a state badge ({ badge, on }).
	const measure = (value, unit, from = null) => ({ value: String(value), unit, from: from === null ? null : String(from) });
	const seconds = (ms, digits = 2) => measure((ms / 1000).toFixed(digits), 's');
	const uses = (count) => measure(count, '×');
	const state = (label, on) => ({ badge: label, on });
	const tables = [];

	const grouped = new Map();
	(timelinePlan.sourceAnalysis || []).forEach((asset) => {
		const key = asset.kind === 'procedural'
			? [asset.kind, asset.label, asset.requestedPeriod, asset.resolvedPeriod, asset.cycleCount].join(':')
			: [asset.kind, asset.label, asset.frameCount, asset.nativeFps.toFixed(3), asset.nativeCycleDuration].join(':');
		const group = grouped.get(key);
		if (group) group.uses++;
		else grouped.set(key, { ...asset, uses: 1 });
	});
	const assets = [...grouped.values()];

	const authored = assets.filter((asset) => asset.kind !== 'procedural');
	if (authored.length) {
		const outputFps = timelinePlan.totalDuration > 0 ? reduction.outputFrameCount * 1000 / timelinePlan.totalDuration : 0;
		// A variable-delay output can average near its target while still holding
		// a visibly long step, so its rate is marked as an average like a source's.
		const variableCadence = (timelinePlan.renderClock?.delaySpread || 0) > 0;
		const rate = (fps, average) => measure(`${average ? '~' : ''}${fps.toFixed(1)}`, 'fps');
		tables.push({
			id: 'sources',
			title: 'Sources',
			columns: [{ label: 'Source' }, { label: 'Uses', numeric: true }, { label: 'Frames', numeric: true }, { label: 'Rate', numeric: true }, { label: 'Loop', numeric: true }],
			rows: [
				...authored.map((asset) => ({ cells: [asset.label, uses(asset.uses), String(asset.frameCount), rate(asset.nativeFps, asset.variableTiming), seconds(asset.nativeCycleDuration)] })),
				{ strong: true, cells: ['Export', '', String(reduction.outputFrameCount), rate(outputFps, variableCadence), seconds(timelinePlan.totalDuration)] }
			]
		});
	}

	const generated = assets.filter((asset) => asset.kind === 'procedural');
	if (generated.length) {
		tables.push({
			id: 'generated',
			title: 'Generated animation',
			columns: [{ label: 'Animation' }, { label: 'Uses', numeric: true }, { label: 'Period', numeric: true }, { label: 'Cycles', numeric: true }],
			rows: generated.map((asset) => {
				// The arrow shows a period that was fitted to the loop.
				const period = measure(Math.round(asset.resolvedPeriod), 'ms', asset.periodChanged ? Math.round(asset.requestedPeriod) : null);
				const cycles = Number.isInteger(asset.cycleCount) ? asset.cycleCount : Number(asset.cycleCount.toFixed(2));
				return { cells: [asset.label, uses(asset.uses), period, String(cycles)] };
			})
		});
	}

	const pixelRemoved = reduction.framesRemoved;
	const preRenderRemoved = reduction.selectionDuplicatesMerged + reduction.preRenderFramesSkipped;
	const hasReduction = Boolean(reduction.smartReductionEnabled && (pixelRemoved > 0 || preRenderRemoved > 0));
	// Label and value pairs, so this one has no column headings.
	const optimization = { id: 'optimization', title: 'Optimization', keyValue: true, lines: [], columns: [{ label: 'Setting' }, { label: 'Value', numeric: true }], rows: [] };
	if (hasReduction) {
		if (preRenderRemoved > 0) {
			optimization.lines.push(`Resolved ${reduction.originalFrameCount} timing changes into ${reduction.renderedFrameCount} composed frames, then exported ${reduction.outputFrameCount}.`);
		} else {
			const kind = reduction.nearDuplicatesMerged > 0
				? (reduction.exactDuplicatesMerged > 0 ? 'repeated or nearly identical' : 'nearly identical')
				: 'repeated';
			optimization.lines.push(`Removed ${pixelRemoved} ${kind} ${pixelRemoved === 1 ? 'frame' : 'frames'} without changing the speed.`);
		}
		optimization.rows.push({ cells: ['Frames', measure(reduction.outputFrameCount, '', reduction.originalFrameCount)] });
		if (reduction.exactDuplicatesMerged > 0) optimization.rows.push({ cells: ['Repeated frames removed', String(reduction.exactDuplicatesMerged)] });
		if (reduction.nearDuplicatesMerged > 0) {
			optimization.rows.push({ cells: ['Similar frames removed', String(reduction.nearDuplicatesMerged)] });
			optimization.rows.push({ cells: ['Maximum visual difference', measure((reduction.maximumVisualError * 100).toFixed(2), '%')] });
		}
		optimization.rows.push({ cells: ['Playback speed', reduction.durationPreserved ? 'Unchanged' : 'May differ'] });
		optimization.rows.push({ cells: ['Loop ending', timelinePlan.loopSeam.exact ? 'Exact match' : 'Best available match'] });
	}
	if (!reduction.preferredBudgetMet) optimization.lines.push(`Kept ${reduction.outputFrameCount} frames to keep the motion smooth.`);
	if (target.isGif && colorAnalysis) {
		if (colorAnalysis.paletteMode) {
			optimization.rows.push({ cells: ['Palette', colorAnalysis.paletteMode === 'native' ? 'Per frame' : 'Shared'] });
			optimization.rows.push({ cells: ['Colors', String(colorAnalysis.paletteSize)] });
		}
		optimization.rows.push({ cells: ['Dithering', colorAnalysis.ditherEnabled ? state('On', true) : colorAnalysis.authoredDither ? state('Dither filter', true) : state('Off', false)] });
	}
	if (optimization.lines.length || optimization.rows.length) tables.push(optimization);

	// Phases that round to nothing are left out of the rows, not the total.
	const phases = timelinePlan.phaseTimings || [];
	const shown = phases.filter((phase) => seconds(phase.ms, 1).value !== seconds(0, 1).value);
	if (shown.length) {
		const total = phases.reduce((sum, phase) => sum + phase.ms, 0);
		tables.push({
			id: 'timing',
			title: 'Export time',
			columns: [{ label: 'Phase' }, { label: 'Time', numeric: true }, { label: 'Share', numeric: true }],
			rows: [
				...shown.map((phase) => ({ cells: [phase.label, seconds(phase.ms, 1), measure(Math.round(phase.ms / total * 100), '%')] })),
				{ strong: true, cells: ['Total', seconds(total, 1), measure(100, '%')] }
			]
		});
	}

	if (fit) tables.push(buildFitTable(fit));

	return tables.length ? { tables } : null;
}

// One row per attempt of a size fit; the kept one is the total row.
function buildFitTable(fit) {
	return {
		id: 'fit',
		title: `Fit under ${fit.label}`,
		columns: [{ label: 'Attempt' }, { label: 'Size', numeric: true }, { label: 'Fits' }],
		lines: [],
		rows: fit.attempts.map((attempt) => ({
			strong: attempt.chosen,
			cells: [attempt.changes, formatBytes(attempt.bytes), { badge: attempt.fits ? 'Yes' : 'No', on: attempt.fits }]
		}))
	};
}

function buildExportReport({ blob, fileName, target, width, height, frameCount = null, duration = null, timelinePlan = null, colorAnalysis = null, fit = null, platform = {} }) {
	const plan = target.isAnimation ? timelinePlan : null;
	const analysis = target.isGif ? (colorAnalysis || plan?.colorAnalysis || null) : null;
	const uploadLimits = resolveUploadLimits(blob.size, CONFIG.export.sizeTargets);
	const facts = {
		size: formatBytes(blob.size),
		sizeWarning: uploadLimits.length > 0,
		format: target.label,
		dimensions: `${width} × ${height} px`,
		frames: target.isStill ? '' : `${frameCount ?? 0} ${frameCount === 1 ? 'frame' : 'frames'}`,
		duration: target.isStill || !Number.isFinite(duration) ? '' : `${duration.toFixed(2)} s`,
		fileName
	};

	// Direct downloads of an animated GIF or video on iOS Safari have dropped
	// the animation, so those go through the Share sheet. Stills save normally.
	const needsShare = Boolean(platform.isIOS && target.isAnimation);
	const canShare = Boolean(platform.canShare);
	const saveGuide = !needsShare ? null : !canShare ? 'ios-unsupported' : target.isVideo ? 'ios-video' : 'ios-gif';
	const actions = { share: canShare, open: !needsShare, save: !needsShare };
	const primaryAction = actions.save ? 'save' : actions.share ? 'share' : null;

	const notices = [];
	if (fit?.reached) {
		notices.push({ id: 'fit', level: 'info', text: `Fitted under ${fit.label}: ${fit.changes}. Your Export Settings were not changed.` });
	} else if (fit) {
		const advice = target.isStill ? 'Try a smaller canvas.' : `Try a shorter animation${target.isGif ? ', a smaller canvas or MP4' : ' or a smaller canvas'}.`;
		notices.push({ id: 'fit', level: 'warning', text: `Could not fit under ${fit.label}. This is the smallest version${fit.changes ? ` (${fit.changes})` : ''}. ${advice}` });
	}
	if (plan) {
		const reduction = plan.reduction;
		if (!reduction.durationPreserved) notices.push({ id: 'speed', level: 'warning', text: 'The exported animation may play at a different speed than the preview.' });
		if (reduction.budgetCompromiseRequired) notices.push({ id: 'motion', level: 'warning', text: 'This animation is longer than the export limit allows, so some motion detail may be reduced.' });
		if (!plan.loopSeam.exact) notices.push({ id: 'seam', level: 'info', text: 'The animations repeat at different times, so the beginning and ending may not match perfectly.' });
	}
	// The observed count is a sampled lower bound, so this never fires on an
	// image the palette could hold.
	if (analysis && (analysis.significant || analysis.observedColorCount > analysis.paletteSize)) {
		notices.push({ id: 'colors', level: 'info', text: 'This image has more colors than a GIF can hold, so some were merged. GIF Look in Export Settings controls how.' });
	}

	return {
		facts,
		saveGuide,
		actions,
		primaryAction,
		uploadLimits,
		notices,
		details: plan ? buildExportDetails({ target, timelinePlan: plan, colorAnalysis: analysis, fit }) : fit ? { tables: [buildFitTable(fit)] } : null
	};
}

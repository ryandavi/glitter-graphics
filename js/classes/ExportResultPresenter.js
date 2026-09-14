'use strict';

class ExportResultPresenter {
	constructor() { this.previewBlobUrl = null; }
	clear() { if (this.previewBlobUrl) URL.revokeObjectURL(this.previewBlobUrl); this.previewBlobUrl = null; }
	show({ blob, file, target, width, height, frameCount = null, duration = null, timelinePlan = null }) {
		this.clear();
		const blobUrl = URL.createObjectURL(blob);
		this.previewBlobUrl = blobUrl;
		const modal = document.getElementById('exportPreviewModal');
		const img = document.getElementById('exportPreviewImage');
		const video = document.getElementById('exportPreviewVideo');
		img.hidden = target.isVideo; video.hidden = !target.isVideo; img.alt = `Exported ${target.label}`;
		if (target.isVideo) { img.removeAttribute('src'); video.src = blobUrl; video.play().catch(() => {}); }
		else { video.pause(); video.removeAttribute('src'); img.src = blobUrl; }
		document.getElementById('exportStatSize').textContent = formatBytes(blob.size);
		document.getElementById('exportStatDimensions').textContent = `${width} × ${height}px`;
		document.getElementById('exportStatFormat').textContent = target.label;
		document.getElementById('exportStatFramesRow').hidden = target.isStill;
		if (!target.isStill) document.getElementById('exportStatFrames').textContent = String(frameCount ?? 0);
		const durationRow = document.getElementById('exportStatDurationRow');
		durationRow.hidden = target.isStill || !Number.isFinite(duration);
		if (!durationRow.hidden) document.getElementById('exportStatDuration').textContent = `${duration.toFixed(2)}s`;
		document.getElementById('exportFormatNotices').hidden = !target.isGif;
		if (target.isGif) document.getElementById('exportColorNoticeText').textContent = target.isStill ? 'This still GIF uses a palette of up to 256 colors.' : 'This animated GIF uses a palette of up to 256 colors per frame.';
		const warnings = (CONFIG.export.limits.sizeWarnings || []).filter((warning) => blob.size > warning.limitMB * 1024 * 1024);
		const warningRoot = document.getElementById('exportSizeWarnings');
		warningRoot.replaceChildren(...warnings.map((warning) => {
			const row = document.getElementById('tpl-export-size-warning').content.firstElementChild.cloneNode(true);
			row.querySelector('strong').textContent = warning.label;
			row.querySelector('span').textContent = warning.detail;
			return row;
		}));
		warningRoot.hidden = warnings.length === 0;
		this._renderReductionSummary(target.isAnimation ? timelinePlan : null);
		const open = document.getElementById('exportPreviewOpen');
		const save = document.getElementById('exportPreviewSave');
		open.querySelector('.name').textContent = `Open ${target.label}`;
		save.querySelector('.name').textContent = `Save ${target.label}`;
		let canShare = false;
		try { canShare = Boolean(navigator.canShare?.({ files: [file] })); } catch (error) { canShare = false; }
		const share = document.getElementById('exportPreviewShare'); share.disabled = !canShare;
		const isIOS = CONFIG.debug.forceIOSExportPreview || /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
		modal.classList.toggle('is-ios', isIOS);
		const instructions = modal.querySelector('.export-preview-instructions');
		instructions.replaceChildren();
		if (isIOS) {
			const templateId = !canShare ? 'tpl-export-instructions-ios-unsupported' : target.isVideo ? 'tpl-export-instructions-ios-video' : target.isStill ? 'tpl-export-instructions-ios-still' : 'tpl-export-instructions-ios-gif';
			const template = document.getElementById(templateId);
			if (template) instructions.append(template.content.cloneNode(true));
			instructions.hidden = false;
			open.disabled = true; save.disabled = true;
		} else {
			instructions.hidden = true; open.disabled = false; save.disabled = false;
		}
		share.onclick = async () => { if (canShare) await navigator.share({ files: [file], title: `Glitter ${target.label}`, text: `Created with ${CONFIG.app.siteName}` }); };
		open.onclick = () => window.open(blobUrl, '_blank'); save.onclick = () => downloadBlob(file, file.name);
		const cleanup = () => { modal.classList.remove('visible'); video.pause(); this.clear(); };
		document.getElementById('closeExportPreviewModal').onclick = cleanup;
		modal.onclick = (event) => { if (event.target === modal) cleanup(); };
		modal.classList.add('visible');
	}

	_renderReductionSummary(timelinePlan) {
		const reductionSummary = document.getElementById('exportReductionSummary');
		const reduction = timelinePlan?.reduction;
		const sourceAnalysis = timelinePlan?.sourceAnalysis || [];
		const hasAssetAnalysis = sourceAnalysis.length > 0;
		const pixelRemovedFrames = reduction ? reduction.framesRemoved : 0;
		const preRenderRemovedFrames = reduction ? reduction.selectionDuplicatesMerged + reduction.preRenderFramesSkipped : 0;
		const hasReduction = Boolean(reduction?.smartReductionEnabled && (pixelRemovedFrames > 0 || preRenderRemovedFrames > 0));
		const proceduralFits = timelinePlan?.timingResolution?.proceduralPeriodFits || [];
		const hasPlanWarning = Boolean(timelinePlan && (
			!timelinePlan.loopSeam.exact
				|| proceduralFits.some((fit) => Math.abs(fit.requestedPeriod - fit.resolvedPeriod) >= 0.01)
				|| !reduction.preferredBudgetMet
				|| reduction.budgetCompromiseRequired
				|| !reduction.durationPreserved
		));
		const optimizationDetails = document.getElementById('exportOptimizationDetails');
		const assetAnalysis = document.getElementById('exportAssetAnalysis');
		const assetAnalysisList = document.getElementById('exportAssetAnalysisList');
		reductionSummary.hidden = !hasReduction && !hasPlanWarning && !hasAssetAnalysis;
		optimizationDetails.hidden = !hasReduction;
		optimizationDetails.open = false;
		assetAnalysis.hidden = !hasAssetAnalysis;
		assetAnalysis.open = false;
		assetAnalysisList.replaceChildren();
		if (reductionSummary.hidden) return;
		const groupedAssets = new Map();
		sourceAnalysis.forEach((asset) => {
			const groupKey = asset.kind === 'procedural'
				? [asset.kind, asset.label, asset.requestedPeriod, asset.resolvedPeriod, asset.cycleCount].join(':')
				: [asset.kind, asset.label, asset.frameCount, asset.nativeFps.toFixed(3), asset.nativeCycleDuration].join(':');
			const group = groupedAssets.get(groupKey);
			if (group) group.uses++;
			else groupedAssets.set(groupKey, { ...asset, uses: 1 });
		});
		groupedAssets.forEach((asset) => {
			const row = document.createElement('div');
			const name = document.createElement('dt');
			const value = document.createElement('dd');
			name.textContent = `${asset.uses > 1 ? `${asset.label} ×${asset.uses}` : asset.label} (${asset.kind})`;
			if (asset.kind === 'procedural') {
				const requestedPeriod = `${Math.round(asset.requestedPeriod)} ms`;
				const resolvedPeriod = `${Math.round(asset.resolvedPeriod)} ms`;
				const period = asset.periodChanged ? `${requestedPeriod} → ${resolvedPeriod}` : resolvedPeriod;
				const cycles = Number.isInteger(asset.cycleCount) ? asset.cycleCount : Number(asset.cycleCount.toFixed(2));
				value.textContent = `${period} period · ${cycles} ${cycles === 1 ? 'cycle' : 'cycles'}`;
			} else {
				const nativeRate = `${asset.nativeFps.toFixed(1)} fps${asset.variableTiming ? ' average' : ''}`;
				value.textContent = `${asset.frameCount} frames · ${nativeRate} · ${(asset.nativeCycleDuration / 1000).toFixed(2)} s loop`;
			}
			row.append(name, value);
			assetAnalysisList.append(row);
		});
		if (timelinePlan) {
			const row = document.createElement('div');
			const name = document.createElement('dt');
			const value = document.createElement('dd');
			const outputFps = timelinePlan.totalDuration > 0
				? timelinePlan.reduction.outputFrameCount * 1000 / timelinePlan.totalDuration
				: 0;
			// A variable-delay output can average near its target while still holding
			// a visibly long step, so never present the average as a fixed cadence.
			const variableCadence = (timelinePlan.renderClock?.delaySpread || 0) > 0;
			name.textContent = 'Composite export';
			value.textContent = `${(timelinePlan.totalDuration / 1000).toFixed(2)} s · ${timelinePlan.reduction.outputFrameCount} rendered frames · ${variableCadence ? '~' : ''}${outputFps.toFixed(1)} fps${variableCadence ? ' average' : ''}`;
			row.append(name, value);
			assetAnalysisList.append(row);
		}
		const title = document.getElementById('exportReductionTitle');
		const summary = document.getElementById('exportReductionText');
		const seam = document.getElementById('exportSeamStatus');
		title.textContent = hasPlanWarning ? 'About this animation' : 'File size optimized';
		if (hasReduction) {
			if (preRenderRemovedFrames > 0) {
				summary.textContent = `Resolved ${reduction.originalFrameCount} timing changes into ${reduction.renderedFrameCount} composed frames, then exported ${reduction.outputFrameCount}.`;
			} else {
				const frameLabel = pixelRemovedFrames === 1 ? 'frame' : 'frames';
				const kind = reduction.nearDuplicatesMerged > 0
					? (reduction.exactDuplicatesMerged > 0 ? 'repeated or nearly identical' : 'nearly identical')
					: 'repeated';
				summary.textContent = `Removed ${pixelRemovedFrames} ${kind} ${frameLabel} without changing the speed.`;
			}
			document.getElementById('exportDetailFrames').textContent = `${reduction.originalFrameCount} → ${reduction.outputFrameCount}`;
			document.getElementById('exportDetailExact').textContent = String(reduction.exactDuplicatesMerged);
			document.getElementById('exportDetailExactRow').hidden = reduction.exactDuplicatesMerged === 0;
			document.getElementById('exportDetailNear').textContent = String(reduction.nearDuplicatesMerged);
			document.getElementById('exportDetailNearRow').hidden = reduction.nearDuplicatesMerged === 0;
			document.getElementById('exportDetailTiming').textContent = reduction.durationPreserved ? 'Unchanged' : 'May differ';
			document.getElementById('exportDetailLoop').textContent = timelinePlan.loopSeam.exact ? 'Exact match' : 'Best available match';
			document.getElementById('exportDetailError').textContent = `${(reduction.maximumVisualError * 100).toFixed(2)}%`;
			document.getElementById('exportDetailErrorRow').hidden = reduction.nearDuplicatesMerged === 0;
		} else {
			summary.textContent = hasAssetAnalysis
				? `${sourceAnalysis.length} animated ${sourceAnalysis.length === 1 ? 'source' : 'sources'} contributed to this export.`
				: '';
		}
		const planMessages = [];
		const periodChanges = proceduralFits
			.filter((fit) => fit.fitted && Math.abs(fit.requestedPeriod - fit.resolvedPeriod) >= 0.01)
			.map((fit) => `${fit.label}: ${Math.round(fit.requestedPeriod)} → ${Math.round(fit.resolvedPeriod)} ms`);
		if (periodChanges.length) planMessages.push(`Fit generated animation periods to the composite loop: ${periodChanges.join('; ')}.`);
		if (!timelinePlan.loopSeam.exact) planMessages.push('The animations repeat at different times, so the beginning and ending may not match perfectly.');
		if (!reduction.preferredBudgetMet) planMessages.push(`Kept ${reduction.outputFrameCount} frames to keep the motion smooth.`);
		if (reduction.budgetCompromiseRequired) planMessages.push('This animation is longer than the export limit allows, so some motion detail may be reduced.');
		if (!reduction.durationPreserved) planMessages.push('The exported animation may play at a different speed than the preview.');
		seam.hidden = planMessages.length === 0;
		seam.textContent = planMessages.join(' ');
	}
}

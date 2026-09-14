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
		const reductionSummary = document.getElementById('exportReductionSummary');
		const reduction = target.isAnimation ? timelinePlan?.reduction : null;
		const hasAnimationInfo = Boolean(reduction || timelinePlan?.sourceAnalysis?.length);
		reductionSummary.hidden = !hasAnimationInfo;
		if (hasAnimationInfo) {
			document.getElementById('exportReductionTitle').textContent = 'About this animation';
			document.getElementById('exportReductionText').textContent = reduction
				? `${reduction.originalFrameCount} timing samples were resolved into ${reduction.outputFrameCount} exported frames.`
				: `${timelinePlan.sourceAnalysis.length} animated sources contributed to this export.`;
			document.getElementById('exportOptimizationDetails').hidden = true;
			document.getElementById('exportAssetAnalysis').hidden = true;
			document.getElementById('exportSeamStatus').hidden = true;
		}
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
}

'use strict';

// Renders one buildExportReport() into the Export Ready modal and wires its
// footer actions. What is shown, and when, is decided in export-report.js.
class ExportResultPresenter {
	constructor({ onStatus = () => {} } = {}) { this.previewBlobUrl = null; this.onStatus = onStatus; }
	clear() { if (this.previewBlobUrl) URL.revokeObjectURL(this.previewBlobUrl); this.previewBlobUrl = null; }
	show({ blob, file, target, width, height, frameCount = null, duration = null, timelinePlan = null, colorAnalysis = null }) {
		this.clear();
		const blobUrl = URL.createObjectURL(blob);
		this.previewBlobUrl = blobUrl;
		const modal = document.getElementById('exportPreviewModal');
		const img = document.getElementById('exportPreviewImage');
		const video = document.getElementById('exportPreviewVideo');
		img.hidden = target.isVideo; video.hidden = !target.isVideo; img.alt = `Exported ${target.label}`;
		if (target.isVideo) { img.removeAttribute('src'); video.src = blobUrl; video.play().catch(() => {}); }
		else { video.pause(); video.removeAttribute('src'); img.src = blobUrl; }

		let canShare = false;
		try { canShare = Boolean(navigator.canShare?.({ files: [file] })); } catch (error) { canShare = false; }
		const report = buildExportReport({
			blob, fileName: file.name, target, width, height, frameCount, duration, timelinePlan, colorAnalysis,
			platform: { isIOS: CONFIG.debug.forceIOSExportPreview || isIOSDevice(), canShare }
		});

		this._renderFacts(report.facts);
		this._renderSaveGuide(modal, report.saveGuide);
		this._renderUploadLimits(report.uploadLimits);
		this._renderNotices(report.notices);
		this._renderDetails(report.details);
		this._showView('result');

		const actions = {
			share: document.getElementById('exportPreviewShare'),
			open: document.getElementById('exportPreviewOpen'),
			save: document.getElementById('exportPreviewSave')
		};
		actions.share.querySelector('.name').textContent = `Share ${target.label}`;
		actions.open.querySelector('.name').textContent = `Open ${target.label}`;
		actions.save.querySelector('.name').textContent = `Save ${target.label}`;
		Object.entries(actions).forEach(([name, button]) => {
			button.disabled = !report.actions[name];
			button.classList.toggle('primary', report.primaryAction === name);
			button.classList.toggle('secondary', report.primaryAction !== name);
		});
		actions.share.onclick = async () => { if (canShare) await navigator.share({ files: [file], title: `Glitter ${target.label}`, text: `Created with ${CONFIG.app.siteName}` }); };
		actions.open.onclick = () => window.open(blobUrl, '_blank');
		// An anchor download gives no confirmation, so the status names the file.
		actions.save.onclick = async () => { if (await saveBlobAs(file, file.name) === 'downloaded') this.onStatus(`Downloading ${file.name}`); };

		document.querySelectorAll('#exportResultNav [data-export-view]').forEach((option) => { option.onclick = () => this._showView(option.dataset.exportView); });
		const cleanup = () => { modal.classList.remove('visible'); video.pause(); this.clear(); };
		document.getElementById('closeExportPreviewModal').onclick = cleanup;
		modal.onclick = (event) => { if (event.target === modal) cleanup(); };
		modal.classList.add('visible');
		// The frame is reused, so a new result starts at the top of each scroller.
		modal.querySelectorAll('.export-side, .export-scroll, .export-details').forEach((region) => { region.scrollTop = 0; });
	}

	_renderFacts(facts) {
		const size = document.getElementById('exportStatSize');
		size.textContent = facts.size;
		// The size carries the upload-limit warning, so it shows on every layout.
		size.classList.toggle('is-warning', facts.sizeWarning);
		document.getElementById('exportStatFormat').textContent = facts.format;
		document.getElementById('exportStatDimensions').textContent = facts.dimensions;
		document.getElementById('exportStatMotion').hidden = !facts.frames;
		document.getElementById('exportStatFrames').textContent = facts.frames;
		const duration = document.getElementById('exportStatDuration');
		duration.hidden = !facts.duration;
		duration.textContent = facts.duration;
		const fileName = document.getElementById('exportStatFileName');
		fileName.textContent = facts.fileName;
		fileName.title = facts.fileName;
	}

	_renderSaveGuide(modal, saveGuide) {
		// Holding down on the preview would save a still, so `is-ios` takes its touches.
		modal.classList.toggle('is-ios', Boolean(saveGuide));
		const guide = document.getElementById('exportSaveGuide');
		const template = saveGuide ? document.getElementById(`tpl-export-instructions-${saveGuide}`) : null;
		guide.replaceChildren(...(template ? [template.content.cloneNode(true)] : []));
		guide.hidden = !template;
	}

	_renderUploadLimits(uploadLimits) {
		document.getElementById('exportSizeWarnings').hidden = uploadLimits.length === 0;
		document.getElementById('exportSizeWarningList').replaceChildren(...uploadLimits.map((limit) => {
			const row = document.getElementById('tpl-export-limit').content.firstElementChild.cloneNode(true);
			row.querySelector('.export-limit-service').textContent = limit.service;
			row.querySelector('.export-limit-note').textContent = limit.note;
			row.querySelector('.export-limit-value').textContent = limit.limit;
			return row;
		}));
	}

	_renderNotices(notices) {
		const root = document.getElementById('exportNotices');
		root.replaceChildren(...notices.map((notice) => {
			const note = document.createElement('p');
			note.className = 'property-note';
			note.classList.toggle('is-warning', notice.level === 'warning');
			note.textContent = notice.text;
			return note;
		}));
		root.hidden = notices.length === 0;
	}

	_renderDetails(details) {
		document.getElementById('exportResultNav').hidden = !details;
		document.getElementById('exportDetailFacts').textContent = details?.facts || '';
		document.getElementById('exportDetailTables').replaceChildren(...(details?.tables || []).map((table) => {
			const group = document.createElement('section');
			group.className = 'export-detail-group';
			const title = document.createElement('div');
			title.className = 'property-group-label';
			title.textContent = table.title;
			group.append(title, ...(table.lines || []).map((line) => {
				const note = document.createElement('p');
				note.className = 'property-note';
				note.textContent = line;
				return note;
			}));
			if (!table.rows.length) return group;
			const element = document.createElement('table');
			element.className = 'export-detail-table';
			const head = element.createTHead().insertRow();
			table.columns.forEach((column) => {
				const cell = document.createElement('th');
				cell.scope = 'col';
				cell.textContent = column.label;
				cell.classList.toggle('is-numeric', Boolean(column.numeric));
				head.append(cell);
			});
			const body = element.createTBody();
			table.rows.forEach((row) => {
				const line = body.insertRow();
				line.classList.toggle('is-total', Boolean(row.strong));
				row.cells.forEach((text, index) => {
					const cell = index === 0 ? document.createElement('th') : document.createElement('td');
					if (index === 0) cell.scope = 'row';
					cell.textContent = text;
					cell.classList.toggle('is-numeric', Boolean(table.columns[index].numeric));
					line.append(cell);
				});
			});
			group.append(element);
			return group;
		}));
	}

	// Details replaces the whole body, so the frame, header and footer stay put.
	_showView(view) {
		document.getElementById('exportResultView').hidden = view !== 'result';
		document.getElementById('exportDetailsView').hidden = view !== 'details';
		document.querySelectorAll('#exportResultNav [data-export-view]').forEach((option) => {
			const active = option.dataset.exportView === view;
			option.classList.toggle('active', active);
			option.setAttribute('aria-pressed', String(active));
		});
	}
}

class ExportProgressPresenter extends TaskProgressPresenter {
	constructor(editor) {
		super(editor, document.getElementById('exportProgress'), () => { editor.exportCancelled = true; });
	}

	// A size fit names its goal and attempt in place of the default title.
	show(target, { title = `Exporting ${target.label}`, detail = 'Preparing export' } = {}) {
		this.target = target;
		this.editor.exportCancelled = false;
		super.show({ title, detail });
	}

	update(percent, message, current = 0, total = 0, info = {}) {
		const phase = EXPORT_PROGRESS_PHASES[info.phaseKey];
		let label = phase?.label || info.phase || 'Preparing export';
		if (info.phaseKey === 'encoding') label += ` ${this.target.label}`;
		current = info.phaseCurrent ?? current;
		total = info.phaseTotal ?? total;
		const detail = info.detail || message || (phase?.noun && total > 0
			? `${phase.countLabel || label} ${phase.noun} ${current} of ${total}` : label);
		super.update(percent, detail, current, total, { ...info, phase: label });
	}

	cancel() {
		if (this.editor.exportInProgress) super.cancel();
	}
}

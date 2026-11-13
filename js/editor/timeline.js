'use strict';

// Markers are named document times. They are not animation sources: they
// never extend an Automatic loop or change export frame planning.
function normalizeTimelineMarkers(markers) {
	const config = CONFIG.ui.timeline.markers, max = CONFIG.export.timeline.setLoopRange.max;
	const seen = new Set();
	return (Array.isArray(markers) ? markers : []).filter(marker => marker && typeof marker.id === 'string' && marker.id && !seen.has(marker.id) && Number.isFinite(Number(marker.at)) && seen.add(marker.id))
		.slice(0, config.max)
		.map(marker => ({ id: marker.id, name: String(marker.name ?? '').trim().slice(0, config.nameMaxLength) || config.defaultName, at: clampNumber(Math.round(Number(marker.at)), 0, max) }));
}

// Visible order is derived by time; the collection keeps creation order.
function sortTimelineMarkers(markers) {
	return [...markers].sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));
}

const EDITOR_TIMELINE_METHODS = {
	getTimelineMarkers() { return sortTimelineMarkers(this.documentMarkers || []); },
	setTimelineMarkers(markers, label, { commit = true, coalesceKey } = {}) {
		const next = normalizeTimelineMarkers(markers);
		if (isSameData(next, this.documentMarkers || [])) return false;
		this.documentMarkers = next;
		window.dispatchEvent(new CustomEvent('timelineMarkersChanged'));
		if (commit) this.saveState(label, { coalesceKey });
		return true;
	},
	addTimelineMarker(at, name) {
		const markers = this.documentMarkers || [], config = CONFIG.ui.timeline.markers;
		if (markers.length >= config.max) { this.updateStatus(`A document can have up to ${config.max} markers.`); return null; }
		const id = `marker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		this.setTimelineMarkers([...markers, { id, name: name || `${config.defaultName} ${markers.length + 1}`, at }], 'Add marker');
		return this.documentMarkers.find(marker => marker.id === id) || null;
	},
	renameTimelineMarker(id, name) {
		if (!String(name ?? '').trim()) return false;
		return this.setTimelineMarkers((this.documentMarkers || []).map(marker => marker.id === id ? { ...marker, name } : marker), 'Rename marker');
	},
	moveTimelineMarker(id, at, options) {
		return this.setTimelineMarkers((this.documentMarkers || []).map(marker => marker.id === id ? { ...marker, at } : marker), 'Move marker', options);
	},
	deleteTimelineMarker(id) {
		return this.setTimelineMarkers((this.documentMarkers || []).filter(marker => marker.id !== id), 'Delete marker');
	},
	setupTimeline() {
		if (!isFeatureEnabled('timeline')) return;
		document.getElementById('timelineToggle').addEventListener('click', () => COMMANDS.timelineToggle.run(this));
		PREFERENCES.onChange('timelineOpen', () => this.syncTimelineVisibility());
		this.syncTimelineVisibility();
	},
	toggleTimeline() {
		if (!isFeatureAvailable('timeline') || !this.originalImage) return;
		PREFERENCES.set('timelineOpen', !PREFERENCES.get('timelineOpen'));
	},
	async syncTimelineVisibility() {
		if (!isFeatureAvailable('timeline')) return;
		const open = Boolean(this.originalImage && PREFERENCES.get('timelineOpen'));
		const button = document.getElementById('timelineToggle');
		button.disabled = !this.originalImage;
		button.classList.toggle('active', open);
		button.setAttribute('aria-pressed', String(open));
		const view = document.getElementById('viewTimelineToggle');
		if (view) { view.classList.toggle('active', open); view.setAttribute('aria-pressed', String(open)); }
		if (!open) { this.timelineDock?.close(); return; }
		try {
			const dock = await this.ensureTimelineDock();
			if (isFeatureAvailable('timeline') && this.originalImage && PREFERENCES.get('timelineOpen')) dock.open();
		} catch (error) {
			PREFERENCES.set('timelineOpen', false);
			this.showError('Could not open the timeline. Try again.');
			console.warn('Timeline loading failed:', error);
		}
	},
	async ensureTimelineDock() {
		await this.ensurePreviewFrameView();
		await this.ensureKeyRecording();
		const { TimelineDock } = await loadScriptGroup('timeline');
		this.timelineDock ||= new TimelineDock(this, document.getElementById('timelineDock'));
		return this.timelineDock;
	}
};

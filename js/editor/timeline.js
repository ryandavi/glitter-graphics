'use strict';

const EDITOR_TIMELINE_METHODS = {
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

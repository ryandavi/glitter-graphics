'use strict';

const FEATURES = Object.freeze({
	customMotion: Object.freeze({ stage: 'local' }),
	timeline: Object.freeze({ stage: 'local', layouts: Object.freeze(['desktop']) }),
	loopLength: Object.freeze({ stage: 'on' }),
	gifCycle: Object.freeze({ stage: 'on' }),
	history: Object.freeze({ stage: 'local' }),
	personalWeb: Object.freeze({ stage: 'local' }),
	htmlScene: Object.freeze({ stage: 'local' }),
	stylePresetCopy: Object.freeze({ stage: 'debug' }),
	memoryOverlay: Object.freeze({ stage: 'debug' }),
	welcomeOnStartup: Object.freeze({ stage: 'off' })
});

const FEATURE_ENABLED = new Map();
let featureMedia;
let featureOverrides;

function getFeature(id) {
	if (!Object.prototype.hasOwnProperty.call(FEATURES, id)) throw new Error(`Unknown feature: ${id}`);
	return FEATURES[id];
}

function isFeatureEnabled(id) {
	const feature = getFeature(id);
	if (!FEATURE_ENABLED.has(id)) {
		featureOverrides ||= new Set((new URLSearchParams(window.location.search).get(CONFIG.app.features.param) || '').split(',').map(value => value.trim()));
		const enabled = feature.stage === 'on' || feature.stage === 'beta'
			|| (feature.stage === 'debug' && CONFIG.debug.enabled)
			|| (feature.stage === 'local' && (isLocalHost() || CONFIG.debug.enabled || featureOverrides.has(id)));
		FEATURE_ENABLED.set(id, Boolean(enabled));
	}
	return FEATURE_ENABLED.get(id);
}

function featureLayout(id) {
	const layouts = getFeature(id).layouts;
	return layouts?.length === 1 ? layouts[0] : null;
}

function isFeatureAvailable(id) {
	if (!isFeatureEnabled(id)) return false;
	const layout = featureLayout(id);
	if (!layout) return true;
	featureMedia ||= window.matchMedia(`(max-width: ${CONFIG.ui.mobile.breakpoint}px)`);
	return layout === (featureMedia.matches ? 'phone' : 'desktop');
}

function applyFeatureGates(root) {
	const nodes = [...root.querySelectorAll('[data-feature]')];
	if (root.matches?.('[data-feature]')) nodes.unshift(root);
	nodes.forEach(node => {
		const id = node.dataset.feature;
		node.hidden = !isFeatureEnabled(id);
		const layout = featureLayout(id);
		if (layout) node.dataset.layout = layout;
	});
}

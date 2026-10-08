'use strict';

const PREFERENCE_SCHEMA = Object.freeze({
	customGlitter: { default: () => [], keepOnReset: true },
	showHints: { default: () => CONFIG.ui.hints.enabledByDefault },
	backgroundRemovalHintSeen: { default: () => false, keepOnReset: true },
	confirmDestructiveActions: { default: () => true },
	showWelcomeOnStartup: { default: () => true },
	welcomeLastSeenRelease: { default: () => null },
	scaleCorners: { default: () => CONFIG.rendering.transformBehavior.scaleCorners },
	crispMaskEdges: { default: () => CONFIG.rendering.crispMaskEdges },
	autoSelect: { default: () => CONFIG.app.behavior.autoSelect },
	snappingEnabled: { default: () => CONFIG.snapping.enabled },
	scaleEffects: { default: () => CONFIG.rendering.transformBehavior.scaleEffects },
	scaleTextures: { default: () => CONFIG.rendering.transformBehavior.scaleTextures },
	panInertia: { default: () => CONFIG.ui.gestures.inertia.enabled },
	pixelGrid: { default: () => CONFIG.ui.zoom.pixelGridEnabled },
	reduceMotion: { default: () => false },
	showAllControls: { default: () => false },
	filterPreviewLevel: { default: () => 'still' },
	// The Library view menu: tile size ('s' | 'm' | 'l') for every kind's grid,
	// and whether the Quick picks row shows.
	libraryTileSize: { default: () => 'm' },
	libraryQuickPicks: { default: () => true },
	// Per-kind overrides of ASSET_BROWSERS' home defaults.
	libraryHome: { default: () => ({}) },
	// The Library's per-kind asset id lists: { glitter: [id, ...], font: [...] }.
	libraryRecents: { default: () => ({}), keepOnReset: true },
	libraryFavorites: { default: () => ({}), keepOnReset: true },
	// The Library's per-kind recent search queries: { glitter: ['pink', ...] }.
	librarySearches: { default: () => ({}), keepOnReset: true }
});

class Preferences {
	constructor(schema, storageKey = STORAGE_KEYS.preferences.key) {
		this.schema = schema;
		this.storageKey = storageKey;
		this.values = {};
		this.listeners = new Map();
		this.values = readStored(storageKey, {});
	}

	get(key) {
		if (!this.schema[key]) throw new Error(`Unknown preference: ${key}`);
		return Object.prototype.hasOwnProperty.call(this.values, key)
			? this.values[key]
			: this.schema[key].default();
	}

	set(key, value) {
		if (!this.schema[key]) throw new Error(`Unknown preference: ${key}`);
		if (Object.is(this.get(key), value)) return;
		this.values[key] = value;
		this.persist();
		this.listeners.get(key)?.forEach((listener) => listener(value));
	}

	reset(key) {
		delete this.values[key];
		this.persist();
		const value = this.get(key);
		this.listeners.get(key)?.forEach((listener) => listener(value));
		return value;
	}

	// Settings only: `keepOnReset` entries are the user's collections, not settings.
	resetAll() {
		this.values = Object.fromEntries(Object.entries(this.values)
			.filter(([key]) => this.schema[key]?.keepOnReset));
		this.persist();
		Object.keys(this.schema).forEach((key) => {
			const value = this.get(key);
			this.listeners.get(key)?.forEach((listener) => listener(value));
		});
	}

	onChange(key, listener) {
		if (!this.listeners.has(key)) this.listeners.set(key, new Set());
		this.listeners.get(key).add(listener);
		return () => this.listeners.get(key)?.delete(listener);
	}

	persist() {
		writeStored(this.storageKey, this.values);
	}
}

const PREFERENCES = new Preferences(PREFERENCE_SCHEMA);

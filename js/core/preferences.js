'use strict';

const PREFERENCE_SCHEMA = Object.freeze({
	crispMaskEdges: { default: () => CONFIG.rendering.crispMaskEdges },
	autoSelect: { default: () => CONFIG.app.behavior.autoSelect },
	snappingEnabled: { default: () => CONFIG.snapping.enabled },
	scaleEffects: { default: () => CONFIG.rendering.transformBehavior.scaleEffects },
	scaleTextures: { default: () => CONFIG.rendering.transformBehavior.scaleTextures },
	panInertia: { default: () => CONFIG.ui.gestures.inertia.enabled },
	reduceMotion: { default: () => false }
});

class Preferences {
	constructor(schema, storageKey = 'glitterEditorPreferences') {
		this.schema = schema;
		this.storageKey = storageKey;
		this.values = {};
		this.listeners = new Map();
		try {
			this.values = JSON.parse(localStorage.getItem(storageKey) || '{}');
		} catch (error) {
			console.warn('Failed to load preferences:', error);
		}
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

	migrate(values) {
		let changed = false;
		Object.entries(values).forEach(([key, value]) => {
			if (!this.schema[key] || Object.prototype.hasOwnProperty.call(this.values, key) || value === undefined) return;
			this.values[key] = value;
			changed = true;
		});
		if (changed) this.persist();
	}

	reset(key) {
		delete this.values[key];
		this.persist();
		const value = this.get(key);
		this.listeners.get(key)?.forEach((listener) => listener(value));
		return value;
	}

	resetAll() {
		this.values = {};
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
		try {
			localStorage.setItem(this.storageKey, JSON.stringify(this.values));
		} catch (error) {
			console.warn('Failed to save preferences:', error);
		}
	}
}

const PREFERENCES = new Preferences(PREFERENCE_SCHEMA);

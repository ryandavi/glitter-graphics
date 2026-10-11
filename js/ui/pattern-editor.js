'use strict';

let patternShapePresetLibrary = null;

function getPatternShapePresetLibrary() {
	if (!patternShapePresetLibrary) patternShapePresetLibrary = GlitterPresetLibrary.createPresetLibrary({
		id: 'pattern-shapes', groups: [{ id: 'shapes', label: 'Shapes' }],
		entries: ShapeLibrary.FILL_SHAPES.map((shape) => ({ id: shape.id, label: shape.label, group: 'shapes', value: shape.id })),
		renderThumbnail: (entry, element) => { element.innerHTML = ShapeLibrary.getIconSvg(entry.id); }
	});
	return patternShapePresetLibrary;
}

function syncEffectPatternEditor(prefix, data) {
	const sets = document.querySelectorAll(`[data-pattern-editor="${prefix}"]`);
	if (!sets.length) return;
	if (data.mode !== 'pattern') return;
	const pattern = normalizeEffectPattern(data.pattern);
	sets.forEach((set) => {
		set.dataset.patternType = pattern.type;
		set.querySelectorAll('[data-pattern-field]').forEach((row) => {
			const key = row.dataset.patternField;
			row.hidden = key === 'scrollCycleMs' ? pattern.scroll === 'none' : !PATTERN_TYPES[pattern.type].fields.includes(key);
		});
		set.querySelectorAll('[data-pattern-key]').forEach((input) => {
			if (input.type === 'checkbox') input.checked = pattern[input.dataset.patternKey];
			else input.value = pattern[input.dataset.patternKey];
		});
		const preview = set.querySelector('.pattern-preview');
		if (preview) applyPatternTileStyle(preview, pattern, data.scale);
		const grid = set.querySelector('[data-pattern-shapes]');
		if (grid && pattern.type === 'motif') {
			const library = getPatternShapePresetLibrary();
			if (!grid.children.length) GlitterPresetLibrary.renderPresetGrid(grid, library, { activeId: pattern.shapeId, onChoose: grid._choosePatternShape });
			else GlitterPresetLibrary.setPresetGridActive(grid, library, { activeId: pattern.shapeId });
		}
		const presets = set.querySelector('[data-pattern-presets]');
		if (presets && !presets.children.length) GlitterPresetLibrary.renderPresetGrid(presets, PATTERN_PRESETS, {
			activeId: findPatternPresetId(pattern), contextId: prefix,
			groupFilter: set.querySelector('select'), onChoose: presets._choosePattern
		});
		else if (presets) GlitterPresetLibrary.setPresetGridActive(presets, PATTERN_PRESETS, { activeId: findPatternPresetId(pattern), contextId: prefix });
	});
}

function installEffectPatternEditor({ prefix, getData, onUpdate }) {
	const sets = document.querySelectorAll(`[data-pattern-editor="${prefix}"]`);
	if (!sets.length || sets[0]._renderEffectPattern) return;
	sets[0]._renderEffectPattern = () => { const data = getData(); if (data) syncEffectPatternEditor(prefix, data); };
	const update = (key, value, commit) => {
		const data = getData();
		if (!data) return;
		data.pattern = normalizeEffectPattern(data.pattern);
		data.pattern[key] = value;
		onUpdate(commit);
		syncEffectPatternEditor(prefix, data);
	};
	sets.forEach((set) => {
		set.querySelectorAll('[data-pattern-key]').forEach((input) => {
			const key = input.dataset.patternKey;
			input.addEventListener('change', () => update(key, input.type === 'checkbox' ? input.checked : input.value, true));
			if (input.type === 'color') input.addEventListener('input', () => update(key, input.value, false));
		});
		const presets = set.querySelector('[data-pattern-presets]');
		if (presets) presets._choosePattern = (entry) => {
			const data = getData();
			if (!data) return;
			data.pattern = normalizeEffectPattern(data.pattern);
			PATTERN_PRESETS.apply(entry, data.pattern);
			onUpdate(true);
			syncEffectPatternEditor(prefix, data);
		};
		const grid = set.querySelector('[data-pattern-shapes]');
		if (grid) grid._choosePatternShape = (entry) => update('shapeId', entry.id, true);
	});
}

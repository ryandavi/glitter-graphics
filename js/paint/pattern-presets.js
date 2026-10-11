'use strict';

const PATTERN_PRESETS = GlitterPresetLibrary.createPresetLibrary({
	id: 'patterns',
	groups: [{ id: 'classic', label: 'Classic' }, { id: 'lines', label: 'Lines' }, { id: 'motifs', label: 'Motifs' }],
	entries: [
		{ id: 'checker', label: 'Checker', group: 'classic', value: { type: 'checker' } },
		{ id: 'gingham', label: 'Gingham', group: 'classic', value: { type: 'gingham' } },
		{ id: 'grid', label: 'Grid', group: 'classic', value: { type: 'grid', thickness: 8 } },
		{ id: 'brick', label: 'Brick', group: 'classic', value: { type: 'brick', thickness: 8 } },
		{ id: 'stripes', label: 'Stripes', group: 'lines', value: { type: 'stripes', direction: 'vertical' } },
		{ id: 'candy-stripes', label: 'Candy Stripes', group: 'lines', value: { type: 'stripes', direction: 'diagonal-up' } },
		{ id: 'scanlines', label: 'Scanlines', group: 'lines', value: { type: 'stripes', direction: 'horizontal', thickness: 8 } },
		{ id: 'userbar-lines', label: 'Userbar Lines', group: 'lines', value: { type: 'stripes', direction: 'diagonal-down', thickness: 8, transparentBackground: true } },
		{ id: 'zigzag', label: 'Zigzag', group: 'lines', value: { type: 'zigzag', thickness: 25 } },
		{ id: 'polka-dots', label: 'Polka Dots', group: 'motifs', value: { type: 'motif', shapeId: 'circle' } },
		{ id: 'hearts', label: 'Hearts', group: 'motifs', value: { type: 'motif', shapeId: 'heart' } },
		{ id: 'stars', label: 'Stars', group: 'motifs', value: { type: 'motif', shapeId: 'star' } }
	],
	renderThumbnail(entry, element) { applyPatternTileStyle(element, entry.value); },
	apply(entry, target, value) {
		const current = normalizeEffectPattern(target);
		Object.assign(target, normalizeEffectPattern(value), { color: current.color, backgroundColor: current.backgroundColor, scroll: current.scroll, scrollCycleMs: current.scrollCycleMs });
	}
});

function findPatternPresetId(pattern) {
	const current = normalizeEffectPattern(pattern);
	return PATTERN_PRESETS.entries.find((entry) => {
		const value = normalizeEffectPattern(entry.value);
		return current.type === value.type && current.transparentBackground === value.transparentBackground
			&& PATTERN_TYPES[current.type].fields.every((field) => current[field] === value[field]);
	})?.id || null;
}

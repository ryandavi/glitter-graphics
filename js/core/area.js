'use strict';

function areaBox(start, point, { square, fromCenter }) {
	let width = point.x - start.x, height = point.y - start.y;
	if (square) {
		const side = Math.max(Math.abs(width), Math.abs(height));
		width = side * (Math.sign(width) || 1); height = side * (Math.sign(height) || 1);
	}
	return {
		left: Math.round(fromCenter ? start.x - Math.abs(width) : Math.min(start.x, start.x + width)),
		top: Math.round(fromCenter ? start.y - Math.abs(height) : Math.min(start.y, start.y + height)),
		right: Math.round(fromCenter ? start.x + Math.abs(width) : Math.max(start.x, start.x + width)),
		bottom: Math.round(fromCenter ? start.y + Math.abs(height) : Math.max(start.y, start.y + height))
	};
}

const AREA_SHAPES = Object.freeze({
	rect: { label: 'Rectangle', icon: 'area-select', title: 'Drag a rectangle. Shift keeps it square, Alt draws from the center.', gesture: 'box', build: (start, point, options) => {
		const b = areaBox(start, point, options);
		return [[{ x: b.left, y: b.top }, { x: b.right, y: b.top }, { x: b.right, y: b.bottom }, { x: b.left, y: b.bottom }]];
	} },
	ellipse: { label: 'Ellipse', icon: 'area-ellipse', title: 'Drag an ellipse. Shift keeps it round, Alt draws from the center.', gesture: 'box', build: (start, point, options) => {
		const b = areaBox(start, point, options);
		return [Array.from({ length: CONFIG.tools.area.ellipseSegments }, (_, index) => {
			const angle = index / CONFIG.tools.area.ellipseSegments * Math.PI * 2;
			return { x: (b.left + b.right) / 2 + Math.cos(angle) * (b.right - b.left) / 2, y: (b.top + b.bottom) / 2 + Math.sin(angle) * (b.bottom - b.top) / 2 };
		})];
	} },
	lasso: { label: 'Lasso', icon: 'area-lasso', title: 'Draw the area freehand', gesture: 'trace' },
	polygon: { label: 'Polygon Lasso', icon: 'area-polygon', title: 'Click to place corners. Double-click or press Enter to close.', gesture: 'corners' },
	wand: { label: 'Magic Wand', icon: 'magic-wand', title: 'Click a color to select everything like it. Click inside the selection again to deselect. Tolerance sets how close a color must be.', gesture: 'pick', controls: ['contextAreaTolerance', 'contextAreaContiguous'] }
});

// New modes also need their cursor badge in workspace/_stage.scss.
const AREA_MODES = Object.freeze({
	new: { label: 'New', icon: 'area-mode-new', title: 'Each drag starts a new area. Drag inside the area to move it.', composite: 'source-over', modifiers: [] },
	add: { label: 'Add', icon: 'area-mode-add', title: 'Each drag adds to the area (hold Shift)', composite: 'source-over', modifiers: ['shift'] },
	subtract: { label: 'Subtract', icon: 'area-mode-subtract', title: 'Each drag cuts out of the area (hold Alt)', composite: 'destination-out', modifiers: ['alt'] },
	intersect: { label: 'Intersect', icon: 'area-mode-intersect', title: 'Keep only the overlap (hold Shift and Alt)', composite: 'destination-in', modifiers: ['shift', 'alt'] }
});

const AREA_INVERT_COMPOSITE = 'xor';

const AREA_MODIFIERS = Object.freeze({
	expand: { label: 'Expand', title: 'Grow the area outward', test: (d, n) => d >= -n },
	contract: { label: 'Contract', title: 'Shrink the area inward', test: (d, n) => d > n },
	border: { label: 'Border', title: 'Keep a band along the edge', test: (d, n) => d >= -Math.floor(n / 2) && d <= Math.ceil(n / 2) },
	smooth: { label: 'Smooth', title: 'Round corners and drop specks', passes: ['contract', 'expand', 'expand', 'contract'] }
});

function areaCommandId(prefix, value) { return `area${prefix}${value[0].toUpperCase()}${value.slice(1)}`; }
function areaOptions(registry, prefix) {
	return Object.entries(registry).map(([value, entry]) => ({ ...entry, value, action: areaCommandId(prefix, value) }));
}
function modeFromModifiers(input, base = 'new') {
	const held = [...new Set(Object.values(AREA_MODES).flatMap(mode => mode.modifiers))].filter(key => input[`${key}Key`]);
	return held.length ? Object.keys(AREA_MODES).find(key => AREA_MODES[key].modifiers.length === held.length && held.every(value => AREA_MODES[key].modifiers.includes(value))) : base;
}

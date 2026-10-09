'use strict';

// The property panel grammar (docs/UI-CONVENTIONS.md): panel > group >
// section > set > row, with one way to write each. This walks PANEL_SCHEMAS
// and fails on anything the grammar does not allow, so a new setting cannot
// reintroduce a second spelling.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const context = { console, navigator: { hardwareConcurrency: 4 }, localStorage: { getItem: () => null } };
vm.createContext(context);
['js/core/math.js', 'js/core/color.js', 'js/core/releases.js', 'js/core/fields.js', 'js/core/config.js', 'js/core/tools.js', 'js/core/sessions.js', 'js/core/layer-types.js', 'js/core/options.js', 'js/effects/animation.js', 'js/systems/CanvasBounds.js', 'js/core/storage.js', 'js/core/preferences.js', 'js/ui/settings-store.js'].forEach((file) => {
	vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
});
// Registries that load after the schemas in the app (frames, sparkles) are
// read through getters; here they resolve to no options.
vm.runInContext(`
	const __getOptions = getOptions;
	getOptions = (name) => { try { return __getOptions(name) || []; } catch (error) { return []; } };
`, context);
vm.runInContext(`${fs.readFileSync(path.join(root, 'js/ui/panel-schemas.js'), 'utf8')}\nglobalThis.__schemas = PANEL_SCHEMAS;`, context, { filename: 'js/ui/panel-schemas.js' });
const schemas = context.__schemas;

const LAYER_GROUPS = ['Content', 'Appearance', 'Layout', 'Effects', 'Motion', 'Actions'];
const SECTION_KINDS = new Set(['section', 'paintSlot', 'transform', 'mount']);
const ROW_KINDS = new Set([
	'slider', 'pair', 'numberPair', 'select', 'segmented', 'radioSegmented', 'toggle', 'field', 'labeled',
	'note', 'assetInfo', 'presetGrid', 'textarea', 'host', 'sparkleGlyphs', 'processingStatus'
]);
const GROUP_KEYS = new Set(['title', 'sections', 'note', 'actions', 'region', 'classes']);
const SET_KEYS = new Set(['id', 'label', 'collapse', 'hidden', 'attrs', 'classes', 'rows', 'actions', 'paint']);
// Spellings the grammar replaced. None may come back on any object.
const RETIRED_KEYS = [
	'items', 'visibleLabel', 'revertFor', 'reset', 'moduleSummary', 'titleSummary', 'summaryFrom', 'flatBody',
	'bare', 'nested', 'static', 'wrapInContent', 'sourceRevert', 'colorRevert', 'sourceSelect', 'sourceAdvanced',
	'advancedStyle', 'pre', 'afterSource', 'post', 'fragmentCard', 'primaryIds', 'advancedIds'
];
// A class that gives a host the layout of a structural level.
const STRUCTURE_CLASSES = /(^|\s)property-(set|card|card-body|group|content|actions|note|row|toggle-list|pair-group)(\s|$)/;

function checkRetired(node, where) {
	RETIRED_KEYS.forEach((key) => {
		// A numberPair lists its two fields as `items`, and a section's panel
		// chrome (`section: { bare }`) is not part of the grammar.
		if (key === 'items' && node.kind === 'numberPair') return;
		if (key === 'items' && node.kind === 'pair') return;
		assert(!Object.prototype.hasOwnProperty.call(node, key), `${where}: retired key "${key}"`);
	});
}

let numericControls = 0;
const fields = vm.runInContext('FIELDS', context);
function checkNumeric(spec, where, bounded = false) {
	numericControls += 1;
	assert(spec && (spec.step === 'any' || Number(spec.step) > 0), `${where}: numeric control needs step`);
	if (bounded) ['min', 'max'].forEach((key) => assert(Number.isFinite(spec[key]), `${where}: bounded control needs ${key}`));
	['min', 'max'].forEach((key) => {
		if (spec[key] != null) assert(Number.isFinite(spec[key]), `${where}: invalid ${key}`);
	});
	if (spec.min != null && spec.max != null) assert(spec.min <= spec.max, `${where}: reversed bounds`);
}

function checkRow(row, where) {
	assert(row && ROW_KINDS.has(row.kind), `${where}: "${row?.kind}" is not a row kind`);
	checkRetired(row, where);
	if (row.kind === 'slider') checkNumeric(fields[row.slider], `${where} ${row.id}`, true);
	if (row.kind === 'pair' || row.kind === 'numberPair') row.items.forEach((entry) => {
		checkNumeric({ ...(fields[entry.slider] || {}), ...entry }, `${where} ${entry.id}`, Boolean(entry.slider) || /^(newCanvas|canvasSize|scaleDesign)/.test(entry.id));
	});
	if (row.kind === 'field' && row.type === 'number') checkNumeric(row, `${where} ${row.id}`, row.id !== 'artworkCropPadding');
	if (row.kind === 'host') assert(!STRUCTURE_CLASSES.test(row.classes || ''), `${where}: host carries a structure class (${row.classes})`);
	if (row.kind === 'labeled') checkRow(row.control, `${where} control`);
	if (row.revert != null) assert(row.revert === true || typeof row.revert === 'string', `${where}: revert is true or an id`);
}

function checkSet(set, where) {
	Object.keys(set).forEach((key) => assert(SET_KEYS.has(key), `${where}: unknown set key "${key}"`));
	if (set.label != null) assert(typeof set.label === 'string' || (Object.keys(set.label).join() === 'id' && typeof set.label.id === 'string'), `${where}: label is text or a dynamic label id`);
	// A collapsible set's name is its toggle, so it has static text and rows.
	if (set.collapse != null) assert(['open', 'closed'].includes(set.collapse) && typeof set.label === 'string' && set.rows, `${where}: collapse is "open" or "closed", on a set with a text label and rows`);
	const forms = ['rows', 'actions', 'paint'].filter((key) => set[key]);
	assert.strictEqual(forms.length, 1, `${where}: a set is exactly one of rows, actions or paint`);
	if (set.rows) set.rows.forEach((row, index) => checkRow(row, `${where} row ${index}`));
	if (set.actions) set.actions.forEach((action, index) => assert(action.id && action.label, `${where} action ${index}: needs an id and a label`));
	if (set.paint) assert(set.paint.id && set.paint.sourceLabel, `${where}: a second paint source needs an id and a sourceLabel`);
}

function checkSection(section, where) {
	assert(section && SECTION_KINDS.has(section.kind), `${where}: "${section?.kind}" is not a section kind`);
	checkRetired(section, where);
	if (section.kind === 'transform' || section.kind === 'mount') return;
	const name = `${where} "${section.title || section.id || section.classes}"`;
	// A flyout section is one line in the panel, so it needs the line's name.
	if (section.presentation != null) assert(section.presentation === 'flyout' && section.title, `${name}: presentation is "flyout", on a titled section`);
	if (section.kind === 'section') assert(Array.isArray(section.sets), `${name}: a section lists sets`);
	['before', 'sets', 'advanced'].forEach((key) => {
		(section[key] || []).forEach((set, index) => checkSet(set, `${name} ${key}[${index}]`));
	});
	if (section.before) assert.strictEqual(section.kind, 'paintSlot', `${name}: only a paintSlot has "before" sets`);
	// One disclosure per section: `advanced` is the only way to write one, and
	// a set of buttons or a second paint cannot hide another inside it.
	(section.advanced || []).forEach((set, index) => assert(!set.paint, `${name} advanced[${index}]: a paint source is not an Advanced set`));
	// Opacity sits directly under the source in every paint section: the
	// renderer builds both, so a schema must not place its own.
	if (section.kind === 'paintSlot') {
		[...(section.before || []), ...(section.sets || []), ...(section.advanced || [])].forEach((set) => (set.rows || []).forEach((row) => {
			assert(row.slider !== 'slotOpacity', `${name}: paint opacity is built by the renderer, directly under Source`);
		}));
	}
}

function checkGroup(group, where, layerPanel) {
	assert(group.title, `${where}: a group needs a title`);
	const name = `${where} group "${group.title}"`;
	checkRetired(group, name);
	Object.keys(group).forEach((key) => assert(GROUP_KEYS.has(key), `${name}: unknown group key "${key}"`));
	const sections = group.sections || [];
	assert(sections.length || group.actions?.length, `${name}: a group holds sections or actions`);
	sections.forEach((section, index) => checkSection(section, `${name} section ${index}`));
	(group.actions || []).forEach((set, index) => {
		assert(set.actions && !set.rows, `${name} actions[${index}]: a group ends with sets of buttons`);
		checkSet(set, `${name} actions[${index}]`);
	});
	if (group.note) assert(group.actions?.length, `${name}: a group note explains the group's buttons`);
	const titled = sections.filter((section) => section.title);
	if (titled.length === 1 && sections.length === 1) {
		assert.notStrictEqual(titled[0].title.toLowerCase(), group.title.toLowerCase(), `${name}: a group and its only section share a name`);
	}
	if (layerPanel) assert(LAYER_GROUPS.includes(group.title), `${name}: not a layer panel group (${LAYER_GROUPS.join(', ')})`);
}

function checkPanel(schema, key) {
	checkRetired(schema, key);
	if (schema.mountInto) {
		checkSection(schema.content, `${key} content`);
		return;
	}
	if (schema.form) {
		assert(!schema.groups && !schema.subsections, `${key}: a form lists sections, not groups`);
		schema.sections.forEach((section, index) => checkSection(section, `${key} section ${index}`));
		return;
	}
	assert(!schema.sections, `${key}: only a form lists sections outside a group`);
	// A layer panel is keyed by its layer type; tool panels keep their own
	// middle groups.
	const layerPanel = Object.values(context.LayerType || vm.runInContext('LayerType', context)).includes(key);
	const blocks = schema.subsections || [{ groups: schema.groups }];
	blocks.forEach((block) => {
		assert(!block.sections, `${key}: a subsection lists groups`);
		const groups = block.groups || [];
		groups.forEach((group) => checkGroup(group, key, layerPanel));
		if (layerPanel) {
			// Effects and Motion come from the schema's own keys, in that place.
			const order = Array.from(groups, (group) => LAYER_GROUPS.indexOf(group.title));
			assert.strictEqual(order.join(), [...order].sort((a, b) => a - b).join(), `${key}: groups are out of order (${groups.map((group) => group.title).join(', ')})`);
			['Effects', 'Motion'].forEach((title) => assert(!groups.some((group) => group.title === title), `${key}: ${title} is written as the "${title.toLowerCase()}" key, not a group`));
		} else if (groups.some((group) => group.title === 'Actions')) {
			assert.strictEqual(groups[groups.length - 1].title, 'Actions', `${key}: Actions is the last group`);
		}
	});
	(schema.effects || []).forEach((section, index) => checkSection(section, `${key} effects[${index}]`));
	(schema.motion || []).forEach((section, index) => checkSection(section, `${key} motion[${index}]`));
	(schema.preamble || []).forEach((row, index) => checkRow(row, `${key} preamble[${index}]`));
	(schema.auxiliarySections || []).forEach((aux) => checkPanel(aux, `${key} > ${aux.prefix}`));
}

Object.entries(fields).forEach(([key, spec]) => checkNumeric(spec, `FIELDS.${key}`, true));
Reflect.ownKeys(schemas).forEach((key) => checkPanel(schemas[key], String(key)));

function checkSettings(nodes, where) {
	nodes.forEach((node, index) => {
		const name = `${where}[${index}]`;
		const control = node.field?.control;
		if (control?.type === 'range' || control?.type === 'number') checkNumeric(control, `${name} ${node.field.id || node.field.element}`, true);
		if (node.rows) checkSettings(node.rows, name);
		if (node.governed) checkSettings([node.governed.header, ...(node.governed.rows || [])].filter(Boolean), name);
	});
}
checkSettings(vm.runInContext('EXPORT_SETTINGS_LAYOUT', context), 'export settings');
checkSettings(vm.runInContext('APP_SETTINGS_LAYOUT', context), 'app settings');
console.log(`PASS panel schemas follow the folded label grammar; ${numericControls} numeric declarations have steps and bounds`);

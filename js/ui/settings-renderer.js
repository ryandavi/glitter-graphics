'use strict';

// ============================================
// SETTINGS RENDERER
// Builds the settings modals from declarations, so a setting's label,
// description and control (with its option list) are written once. The markup
// is the property-panel vocabulary (js/ui/panel-renderer.js): a group is a
// titled card, and each setting is a `.property-set` in it,
// a property row followed by its description as a `.property-note`. The
// `settings-group` / `settings-row` classes are hooks for the search filter
// and the editor's settings code; they carry no layout. A group's card also
// carries its `section` as data-section.
// ============================================
// A group is { title, section, id?, hidden?, badge?, rows }. `section` names
// the group and gives the card's title a reset. A row is one of:
// - a field row: { field, ...rowOptions }, where `field` is
//   { id, label, description, control, default } (export settings pass their
//   EXPORT_SETTINGS_SCHEMA entry, whose `element` is the control id);
// - { host: 'templateId' }: a custom widget cloned from a <template>;
// - { governed: { id, label, railId, header, rows, rowReverts, formatSection } }:
//   a header row whose value sets the rows under it. The header is an ordinary
//   row in the card body; the governed rows sit in the panel's Advanced
//   disclosure (labelled Customize, id `id`), which is the card's footer as in
//   a sidebar card, so a governed row is the last row of its group. A host
//   header takes `revert`, the field its control edits.
//
// Resets follow the panel's rule D. A field that declares a `default` (a value
// or a function) gets the row revert; the card reset replays the reverts of the
// rows in it. Rows a preset writes (`rowReverts: false`) have none: the
// preset row's revert restores them together.
// Row options: rowId, hidden, formatSection (data-export-format-section),
// aliases (data-search-aliases), filterPin, inactiveReason (why the row is
// disabled; adds the reason line),
// afterHeader / afterDescription (template ids for extra content), descId,
// statusId (a live status line under the description).
//
// Controls: { type: 'select', options } where options is an array of
// { value, label, group? }, a function returning one, or a defineOptions name;
// { type: 'switch', ariaControls }; { type: 'number', min, max, step, value,
// unit, inputMode, ariaLabel, placeholder }; { type: 'color', value };
// { type: 'range', min, max, step, value, outputId, outputText, describedBy };
// { type: 'segmented', id, ariaLabel, options } with panel segmented options;
// { type: 'button', id, label }; { type: 'actions', actions } with panel
// actionRow actions; { type: 'host', id, className } for a manager-filled box.

function resolveSettingsOptions(options) {
	if (typeof options === 'function') return options();
	if (typeof options === 'string') return getOptions(options);
	return options || [];
}

function cloneSettingsTemplate(templateId) {
	const template = document.getElementById(templateId);
	if (!template) throw new Error(`Missing settings template #${templateId}`);
	return template.content.cloneNode(true);
}

// The control-side value of a field's declared default; undefined when it
// declares none.
function settingsFieldDefault(field) {
	if (field.default === undefined) return undefined;
	const value = typeof field.default === 'function' ? field.default() : field.default;
	return field.format ? field.format(value) : value;
}

// The shared handler in initializePropertyReverts restores the control and
// fires its change event, so the setting's own listener does the rest.
function attachSettingsRevert(node, field) {
	const value = settingsFieldDefault(field);
	if (value === undefined) return;
	const row = node.matches?.('.property-row') ? node : node.querySelector('.property-row');
	const button = buildFieldRevert(field.id || field.element, value);
	button.setAttribute('aria-label', `Reset ${field.label}`);
	row.appendChild(button);
}

// A slider keeps its own range and readout id, so it is stamped onto the
// shared slider row directly instead of through FIELDS. The template's revert
// follows the sidebar's id grammar; attachSettingsRevert adds this row's.
function buildSettingsRangeRow(id, field) {
	const control = field.control;
	const row = tplClone('tpl-slider-row');
	row.querySelector('.property-label').textContent = field.label;
	const input = row.querySelector('input');
	input.id = id;
	input.min = String(control.min);
	input.max = String(control.max);
	input.step = String(control.step);
	input.setAttribute('value', String(control.value));
	input.setAttribute('aria-label', field.label);
	if (control.describedBy) input.setAttribute('aria-describedby', control.describedBy);
	const value = row.querySelector('.property-value');
	value.id = control.outputId;
	value.textContent = control.outputText;
	row.querySelector('.property-revert').remove();
	return row;
}

// The property row for one setting, built by the panel renderer.
function buildSettingsControl(field) {
	const control = field.control;
	const id = field.id || field.element;
	switch (control.type) {
		case 'select':
			return buildPanelItem({ kind: 'select', id, visibleLabel: field.label, stacked: false,
				options: resolveSettingsOptions(control.options) });
		case 'switch': {
			const list = buildPanelItem({ kind: 'checkboxList', items: [{ id, label: field.label }] });
			if (control.ariaControls) list.querySelector('input').setAttribute('aria-controls', control.ariaControls);
			return list;
		}
		case 'color':
			return buildPanelItem({ kind: 'field', type: 'color', id, label: field.label, value: control.value });
		case 'number':
			return buildPanelItem({ kind: 'field', type: 'number', id, label: field.label, unit: control.unit,
				min: control.min, max: control.max, step: control.step, value: control.value,
				placeholder: control.placeholder, inputMode: control.inputMode,
				attrs: { 'aria-label': control.ariaLabel || field.label } });
		case 'range':
			return buildSettingsRangeRow(id, field);
		case 'segmented':
			return buildPanelItem({ kind: 'segmented', id: control.id, visibleLabel: field.label,
				label: control.ariaLabel || field.label, stacked: false, options: control.options,
				revertFor: control.revertFor });
		case 'button':
			return buildPanelItem({ kind: 'labeled', label: field.label, stacked: false, control: {
				kind: 'host', tag: 'button', id: control.id, classes: 'btn-text-with-icon', text: control.label, attrs: { type: 'button' }
			} });
		// Block controls: the row is only the label (see buildSettingsBlock).
		case 'actions':
		case 'host':
			return buildOptionGroup(field.label, []);
		default:
			throw new Error(`Unknown settings control: ${control.type}`);
	}
}

// A control too wide for a row sits under the setting's description.
function buildSettingsBlock(control) {
	if (control.type === 'actions') {
		return buildPanelItem({ kind: 'actionRow', classes: 'is-split section-actions', actions: control.actions });
	}
	if (control.type === 'host') {
		return buildPanelItem({ kind: 'host', id: control.id, classes: `property-inset ${control.className || ''}`.trim() });
	}
	return null;
}

function buildSettingsNote(text, id) {
	const note = panelDiv('property-note');
	if (id) note.id = id;
	note.textContent = text || '';
	return note;
}

function buildSettingsFieldRow(row, rowReverts = true) {
	const field = row.field;
	const set = panelDiv('property-set settings-row');
	if (row.rowId) set.id = row.rowId;
	if (row.hidden) set.hidden = true;
	if (row.formatSection) set.dataset.exportFormatSection = row.formatSection;
	if (row.aliases) set.dataset.searchAliases = row.aliases;
	if (row.filterPin) set.dataset.filterPin = '';
	if (row.inactiveReason) set.dataset.inactiveReason = row.inactiveReason;
	const control = buildSettingsControl(field);
	if (rowReverts) attachSettingsRevert(control, field);
	set.appendChild(control);
	if (row.afterHeader) set.appendChild(cloneSettingsTemplate(row.afterHeader));
	if (field.description) set.appendChild(buildSettingsNote(field.description, row.descId));
	if (row.afterDescription) set.appendChild(cloneSettingsTemplate(row.afterDescription));
	const block = buildSettingsBlock(field.control);
	if (block) set.appendChild(block);
	if (row.statusId) {
		const status = buildSettingsNote('', row.statusId);
		status.setAttribute('role', 'status');
		status.setAttribute('aria-live', 'polite');
		set.appendChild(status);
	}
	// Empty until setSettingsRowInactive writes the reason; an empty note
	// takes no space.
	if (row.inactiveReason) {
		const reason = buildSettingsNote('');
		reason.dataset.inactiveReasonText = '';
		set.appendChild(reason);
	}
	return set;
}

function buildSettingsRow(row, rowReverts = true) {
	if (row.host) return cloneSettingsTemplate(row.host);
	return buildSettingsFieldRow(row, rowReverts);
}

function buildGovernedHeader(governed) {
	if (!governed.header.host) return buildSettingsFieldRow({ ...governed.header, formatSection: governed.formatSection });
	const header = cloneSettingsTemplate(governed.header.host);
	if (governed.header.revert) attachSettingsRevert(header, governed.header.revert);
	if (governed.formatSection) header.firstElementChild.dataset.exportFormatSection = governed.formatSection;
	return header;
}

function buildGovernedDisclosure(governed) {
	const disclosure = buildPanelItem({ kind: 'advanced', id: governed.id, label: 'Customize', items: [] });
	if (governed.formatSection) disclosure.dataset.exportFormatSection = governed.formatSection;
	const content = disclosure.querySelector('[data-advanced-content]');
	content.id = governed.railId;
	content.setAttribute('role', 'group');
	content.setAttribute('aria-label', governed.label);
	disclosure.querySelector('[data-advanced-toggle]').setAttribute('aria-controls', governed.railId);
	governed.rows.forEach((child) => content.appendChild(buildSettingsRow(child, governed.rowReverts !== false)));
	return disclosure;
}

function buildSettingsGroup(group) {
	const card = buildPanelItem({ kind: 'card', title: group.title, id: group.id, hidden: group.hidden,
		flatBody: true, items: [],
		badge: group.badge ? { label: group.badge } : null,
		reset: group.section ? { title: `Reset ${group.title} settings` } : null });
	const body = card.querySelector('.subsection-card-body');
	group.rows.forEach((row) => {
		if (!row.governed) {
			body.appendChild(buildSettingsRow(row));
			return;
		}
		body.appendChild(buildGovernedHeader(row.governed));
		card.appendChild(buildGovernedDisclosure(row.governed));
	});
	card.classList.add('settings-group');
	if (group.section) card.dataset.section = group.section;
	return card;
}

// `container` is the modal's `.section` host; it becomes a property section
// with the same content wrappers a sidebar section has.
function renderSettingsGroups(container, groups) {
	if (!container) return;
	container.classList.add('property-section');
	const content = panelDiv('section-content');
	const subsection = panelDiv('settings-subsection');
	groups.forEach((group) => subsection.appendChild(buildSettingsGroup(group)));
	content.appendChild(subsection);
	container.replaceChildren(content);
	finishPanelMarkup(container);
}

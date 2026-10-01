'use strict';

// ============================================
// SETTINGS RENDERER
// Builds the settings modals from declarations, so a setting's label,
// description and control (with its option list) are written once. The markup
// is the property-panel vocabulary (js/ui/panel-renderer.js): a group is a
// panel group holding one card, and each setting is a `.property-set` in it,
// a property row followed by its description as a `.property-note`. The
// `settings-group` / `settings-row` classes are hooks for the search filter
// and the editor's settings code; they carry no layout.
// ============================================
// A group is { title, section, id?, hidden?, badge?, rows }. `section` names
// the group's Reset button target (data-section). A row is one of:
// - a field row: { field, ...rowOptions }, where `field` is
//   { id, label, description, control } (export settings pass their
//   EXPORT_SETTINGS_SCHEMA entry, whose `element` is the control id);
// - { host: 'templateId' }: a custom widget cloned from a <template>;
// - { governed: { id, set, label, railId, header, rows, ...rowOptions } }:
//   a header row whose value sets the rows in a collapsible rail.
// Row options: rowId, hidden, formatSection (data-export-format-section),
// aliases (data-search-aliases), filterPin, dependent (the dependent-row
// style), inactiveReason (why the row is disabled; adds the reason line),
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

// A slider keeps its own range and readout id, so it is stamped onto the
// shared slider row directly instead of through FIELDS. Group Reset is the
// modal's revert, so the row's own revert button is dropped.
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
				label: control.ariaLabel || field.label, stacked: false, options: control.options });
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

function buildSettingsFieldRow(row) {
	const field = row.field;
	const set = panelDiv('property-set settings-row');
	if (row.dependent) set.classList.add('settings-row--dependent');
	if (row.rowId) set.id = row.rowId;
	if (row.hidden) set.hidden = true;
	if (row.formatSection) set.dataset.exportFormatSection = row.formatSection;
	if (row.aliases) set.dataset.searchAliases = row.aliases;
	if (row.filterPin) set.dataset.filterPin = '';
	if (row.inactiveReason) set.dataset.inactiveReason = row.inactiveReason;
	set.appendChild(buildSettingsControl(field));
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

function buildSettingsRow(row) {
	if (row.host) return cloneSettingsTemplate(row.host);
	if (!row.governed) return buildSettingsFieldRow(row);
	const governed = row.governed;
	const set = panelDiv('property-set governed-set is-collapsed');
	set.id = governed.id;
	set.dataset.governedSet = governed.set;
	if (governed.formatSection) set.dataset.exportFormatSection = governed.formatSection;
	set.appendChild(governed.header.host ? cloneSettingsTemplate(governed.header.host) : buildSettingsFieldRow(governed.header));
	const rail = panelDiv('governed-rail');
	rail.id = governed.railId;
	rail.setAttribute('role', 'group');
	rail.setAttribute('aria-label', governed.label);
	governed.rows.forEach((child) => rail.appendChild(buildSettingsRow(child)));
	set.appendChild(rail);
	return set;
}

function buildSettingsGroup(group) {
	const card = buildPanelItem({ kind: 'card', flatBody: true, items: [] });
	const body = card.querySelector('.subsection-card-body');
	group.rows.forEach((row) => body.appendChild(buildSettingsRow(row)));
	const node = buildPanelGroup({ title: group.title, items: [] });
	node.querySelector('.panel-group-blocks').appendChild(card);
	node.classList.add('settings-group');
	if (group.id) node.id = group.id;
	if (group.hidden) node.hidden = true;
	const header = node.querySelector('.subsection-title');
	header.classList.add('settings-group-title');
	const label = header.querySelector('.property-group-label');
	label.classList.add('settings-group-title-text');
	if (group.badge) {
		const badge = document.createElement('span');
		badge.className = 'badge';
		badge.textContent = group.badge;
		label.appendChild(badge);
	}
	if (group.section) {
		const reset = document.createElement('button');
		reset.type = 'button';
		reset.className = 'btn-text small reset-section-btn';
		reset.dataset.section = group.section;
		reset.textContent = 'Reset';
		header.appendChild(reset);
	}
	return node;
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

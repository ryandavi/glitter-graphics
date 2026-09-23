'use strict';

// ============================================
// SETTINGS RENDERER
// Builds settings-modal groups and rows from declarations, so a setting's
// label, description and control (with its option list) are written once.
// ============================================
// A group is { title, section, id?, hidden?, rows }. `section` names the
// group's Reset button target (data-section). A row is one of:
// - a field row: { field, ...rowOptions }, where `field` is
//   { id, label, description, control } (export settings pass their
//   EXPORT_SETTINGS_SCHEMA entry, whose `element` is the control id);
// - { host: 'templateId' }: a custom widget cloned from a <template>;
// - { governed: { id, set, label, railId, header, rows, ...rowOptions } }:
//   a header row whose value sets the rows in a collapsible rail.
// Row options: rowId, hidden, formatSection (data-export-format-section),
// aliases (data-search-aliases), filterPin, dependent (the dependent-row
// style), inactiveReason (why the row is disabled; adds the reason line),
// afterHeader / afterDescription (template ids for extra content), descId.
//
// Controls: { type: 'select', options } where options is an array of
// { value, label, group? }, a function returning one, or a defineOptions name;
// { type: 'switch', ariaControls }; { type: 'number', min, max, step, value,
// unit, inputMode, ariaLabel, placeholder, bareUnit }; { type: 'color', value };
// { type: 'range', min, max, step, value, outputId, outputText, describedBy };
// { type: 'button', id, label, className }.

function escapeSettingsHtml(value) {
	return String(value ?? '').replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

function settingsAttr(name, value) {
	if (value === undefined || value === null || value === false) return '';
	return value === true ? ` ${name}` : ` ${name}="${escapeSettingsHtml(value)}"`;
}

function resolveSettingsOptions(options) {
	if (typeof options === 'function') return options();
	if (typeof options === 'string') return getOptions(options);
	return options || [];
}

function renderSettingsSelectOptions(options) {
	const html = [];
	let openGroup = null;
	resolveSettingsOptions(options).forEach((option) => {
		if ((option.group || null) !== openGroup) {
			if (openGroup) html.push('</optgroup>');
			openGroup = option.group || null;
			if (openGroup) html.push(`<optgroup label="${escapeSettingsHtml(openGroup)}">`);
		}
		html.push(`<option value="${escapeSettingsHtml(option.value)}">${escapeSettingsHtml(option.label)}</option>`);
	});
	if (openGroup) html.push('</optgroup>');
	return html.join('');
}

function renderSettingsControl(id, control) {
	switch (control.type) {
		case 'select':
			return `<select id="${id}">${renderSettingsSelectOptions(control.options)}</select>`;
		case 'switch':
			return `<label class="switch" for="${id}"><input type="checkbox" id="${id}"${settingsAttr('aria-controls', control.ariaControls)}><div class="slider round"></div></label>`;
		case 'color':
			return `<input type="color" id="${id}"${settingsAttr('value', control.value)}>`;
		case 'number': {
			const input = `<input type="number" id="${id}"${settingsAttr('min', control.min)}${settingsAttr('max', control.max)}${settingsAttr('step', control.step)}${settingsAttr('value', control.value)}${settingsAttr('placeholder', control.placeholder)}${settingsAttr('inputmode', control.inputMode)}${settingsAttr('aria-label', control.ariaLabel)}>`;
			if (!control.unit) return input;
			return `<span class="input-unit">${input}<span class="input-unit-suffix">${escapeSettingsHtml(control.unit)}</span></span>`;
		}
		case 'button':
			return `<button class="${control.className || 'btn-simple'}" id="${control.id}" type="button">${escapeSettingsHtml(control.label)}</button>`;
		default:
			throw new Error(`Unknown settings control: ${control.type}`);
	}
}

function cloneSettingsTemplate(templateId) {
	const template = document.getElementById(templateId);
	if (!template) throw new Error(`Missing settings template #${templateId}`);
	const holder = document.createElement('div');
	holder.appendChild(template.content.cloneNode(true));
	return holder.innerHTML;
}

function renderSettingsFieldRow(row) {
	const field = row.field;
	const control = field.control;
	const id = field.id || field.element;
	const classes = ['settings-row', row.dependent ? 'settings-row--dependent' : null].filter(Boolean).join(' ');
	const attrs = `${settingsAttr('id', row.rowId)}${settingsAttr('data-export-format-section', row.formatSection)}${settingsAttr('data-search-aliases', row.aliases)}${settingsAttr('data-filter-pin', row.filterPin)}${settingsAttr('data-inactive-reason', row.inactiveReason)}${settingsAttr('hidden', row.hidden)}`;
	// Action rows (a button, no input to label) use a plain title.
	const label = control.type === 'button' || row.plainLabel
		? `<div class="settings-row-label-main">${escapeSettingsHtml(field.label)}</div>`
		: `<label class="settings-row-label-main" for="${id}">${escapeSettingsHtml(field.label)}</label>`;
	const parts = [];
	if (control.type === 'range') {
		parts.push(`<div class="settings-row-header">${label}<output class="setting-value" id="${control.outputId}" for="${id}">${escapeSettingsHtml(control.outputText)}</output></div>`);
		parts.push(`<input id="${id}" type="range"${settingsAttr('min', control.min)}${settingsAttr('max', control.max)}${settingsAttr('step', control.step)}${settingsAttr('value', control.value)}${settingsAttr('aria-describedby', control.describedBy)}>`);
	} else {
		parts.push(`<div class="settings-row-header">${label}<div class="settings-row-control${control.bareUnit ? ' input-unit' : ''}">${control.bareUnit ? `<input id="${id}" type="number"${settingsAttr('min', control.min)}${settingsAttr('max', control.max)}${settingsAttr('step', control.step)}${settingsAttr('placeholder', control.placeholder)}><span>${escapeSettingsHtml(control.bareUnit)}</span>` : renderSettingsControl(id, control)}</div></div>`);
	}
	if (row.afterHeader) parts.push(cloneSettingsTemplate(row.afterHeader));
	if (field.description) parts.push(`<div class="settings-row-label-desc"${settingsAttr('id', row.descId)}>${escapeSettingsHtml(field.description)}</div>`);
	if (row.afterDescription) parts.push(cloneSettingsTemplate(row.afterDescription));
	if (row.inactiveReason) parts.push('<div class="settings-row-reason" data-inactive-reason-text></div>');
	return `<div class="${classes}"${attrs}>${parts.join('')}</div>`;
}

function renderSettingsRow(row) {
	if (row.host) return cloneSettingsTemplate(row.host);
	if (row.governed) {
		const set = row.governed;
		const header = set.header.host ? cloneSettingsTemplate(set.header.host) : renderSettingsFieldRow(set.header);
		return `<div class="governed-set is-collapsed" id="${set.id}" data-governed-set="${set.set}"${settingsAttr('data-export-format-section', set.formatSection)}>${header}<div class="governed-rail" id="${set.railId}" role="group" aria-label="${escapeSettingsHtml(set.label)}">${set.rows.map(renderSettingsRow).join('')}</div></div>`;
	}
	return renderSettingsFieldRow(row);
}

function renderSettingsGroups(container, groups) {
	if (!container) return;
	container.innerHTML = groups.map((group) => {
		if (group.host) return cloneSettingsTemplate(group.host);
		const reset = group.section
			? `<button class="btn-text small reset-section-btn" data-section="${group.section}">Reset</button>`
			: '';
		return `<div class="settings-group"${settingsAttr('id', group.id)}${settingsAttr('hidden', group.hidden)}><div class="settings-group-title"><span class="settings-group-title-text">${escapeSettingsHtml(group.title)}</span>${reset}</div>${group.rows.map(renderSettingsRow).join('')}</div>`;
	}).join('');
}

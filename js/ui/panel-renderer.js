'use strict';

// Sidebar panel renderer. Clones the tpl-*
// <template> primitives in index.html per PANEL_SCHEMAS (core/config.js) and
// stamps ids, labels, and slider ranges (CONFIG.ui.sliders). Renders ONCE at
// boot, before any manager caches or binds panel elements — managers keep
// updating values in place; nothing here re-renders after boot (rebuilding a
// section would orphan every listener bound to it). Stamped controls also
// carry data-role/data-slot/data-mode so shared code can resolve meaning
// without sniffing id suffixes.

function panelDiv(className) {
	const node = document.createElement('div');
	node.className = className;
	return node;
}

function addPanelClasses(node, classes) {
	if (!classes) return node;
	const names = Array.isArray(classes) ? classes : String(classes).split(/\s+/);
	node.classList.add(...names.filter(Boolean));
	return node;
}

function panelCap(value) {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

const PANEL_ROLES = Object.freeze({
	paintSlot: Object.freeze({
		sourceImage: 'Image',
		sourceNone: 'None',
		sourceGlitter: 'Glitter',
		sourceSolid: 'Solid',
		sourceGradient: 'Gradient'
	})
});

// Full legacy ids are explicit exceptions to the default
// `{prefix}{Slot}{Role}` grammar. Managers continue binding these unchanged.
const PANEL_ID_OVERRIDES = Object.freeze({
	textFill: Object.freeze({ sourceNone: 'textFillUseNone', sourceGlitter: 'textFillUseGlitter', sourceSolid: 'textFillUseColor' }),
	textBorder: Object.freeze({ sourceGlitter: 'textBorderUseGlitter', sourceSolid: 'textBorderUseColor' }),
	textShadow: Object.freeze({ sourceGlitter: 'textShadowUseGlitter', sourceSolid: 'textShadowUseColor' })
});

const TRANSFORM_ID_GRAMMAR = Object.freeze({
	posX: '{p}PosX',
	posY: '{p}PosY',
	sizeWidth: '{p}Width',
	sizeHeight: '{p}Height',
	sizeGroup: '{p}SizeGroup',
	rotation: '{p}Rotation',
	rotationValue: '{p}RotationValue',
	resetRotation: 'reset{P}Rotation',
	opacity: '{p}Opacity',
	opacityValue: '{p}OpacityValue',
	resetOpacity: 'reset{P}Opacity',
	proportional: '{p}ProportionalScale',
	scaleControl: '{p}ScaleControl',
	scaleSummary: '{p}ScaleSummary',
	scaleSlider: '{p}Scale',
	resetScale: 'reset{P}Scale',
	scaleX: '{p}TransformScaleX',
	scaleXValue: '{p}TransformScaleXValue',
	resetScaleX: 'reset{P}TransformScaleX',
	scaleY: '{p}TransformScaleY',
	scaleYValue: '{p}TransformScaleYValue',
	resetScaleY: 'reset{P}TransformScaleY',
	flipX: '{p}FlipX',
	flipY: '{p}FlipY',
	alignLeft: '{p}AlignLeft',
	alignCenterX: '{p}AlignCenterX',
	alignRight: '{p}AlignRight',
	alignTop: '{p}AlignTop',
	alignCenterY: '{p}AlignCenterY',
	alignBottom: '{p}AlignBottom',
	resetTransform: 'reset{P}Transform'
});

const TRANSFORM_ID_EXCEPTIONS = Object.freeze({
	text: Object.freeze({
		opacity: 'textLayerOpacity',
		opacityValue: 'textLayerOpacityValue',
		resetOpacity: 'resetTextLayerOpacity'
	})
});

function getPanelTransformIds(prefix) {
	const normalizedPrefix = ['sticker', 'shape', 'text'].includes(prefix) ? prefix : 'text';
	const capitalized = panelCap(normalizedPrefix);
	return Object.fromEntries(Object.entries(TRANSFORM_ID_GRAMMAR).map(([role, pattern]) => [
		role,
		TRANSFORM_ID_EXCEPTIONS[normalizedPrefix]?.[role]
			|| pattern.replaceAll('{p}', normalizedPrefix).replaceAll('{P}', capitalized)
	]));
}

function panelRoleId(prefix, role) {
	return PANEL_ID_OVERRIDES[prefix]?.[role] || prefix + PANEL_ROLES.paintSlot[role];
}

function applySliderSpec(input, spec) {
	input.min = String(spec.min);
	input.max = String(spec.max);
	input.setAttribute('value', String(spec.value));
	if (spec.step != null) input.step = String(spec.step);
}

// One slider row: label + value readout + range + Reset. Ids follow the role
// grammar (`{id}Value`, `reset{Id}`); ranges come from CONFIG.ui.sliders.
// The boot value text is plain `value+unit` to match the static markup —
// bindSlider swaps in formatUnit markup on first interaction, as it always has.
function buildSliderRow(options) {
	const spec = CONFIG.ui.sliders[options.slider];
	const row = tplClone('tpl-slider-row');
	if (options.rowId) row.id = options.rowId;
	if (options.hidden) row.hidden = true;
	if (options.extraClass) row.classList.add(options.extraClass);
	row.dataset.role = `${options.role || options.slider}-row`;
	const label = row.querySelector('.setting-label');
	label.textContent = options.label || spec.label;
	if (options.title) label.title = options.title;
	const value = row.querySelector('.setting-value');
	value.id = `${options.id}Value`;
	value.dataset.role = `${options.role || options.slider}-value`;
	value.textContent = `${spec.value}${spec.unit}`;
	const input = row.querySelector('input');
	input.id = options.id;
	applySliderSpec(input, spec);
	input.dataset.role = options.role || options.slider;
	const reset = row.querySelector('button');
	reset.id = `reset${panelCap(options.id)}`;
	reset.dataset.role = `${options.role || options.slider}-reset`;
	return row;
}

function buildSegmented(entries, options = {}) {
	const group = tplClone('tpl-segmented');
	if (options.id) group.id = options.id;
	addPanelClasses(group, options.classes);
	if (options.label) group.setAttribute('aria-label', options.label);
	group.setAttribute('role', 'group');
	entries.forEach((entry) => {
		const button = tplClone('tpl-segmented-option');
		if (entry.id) button.id = entry.id;
		button.textContent = entry.label;
		if (entry.active) button.classList.add('active');
		if (entry.mode) button.dataset.mode = entry.mode;
		else if (entry.value != null) button.dataset.value = entry.value;
		button.dataset.role = entry.role || (entry.mode ? `source-${entry.mode}` : 'segmented-option');
		button.setAttribute('aria-pressed', entry.active ? 'true' : 'false');
		group.appendChild(button);
	});
	return group;
}

function buildOptionGroup(label, children) {
	const group = tplClone('tpl-option-group');
	group.querySelector('.effect-option-label').textContent = label;
	children.forEach((child) => group.appendChild(child));
	return group;
}

function initializeInlineProcessingStatus(status) {
	if (!status) return null;
	status.classList.add('inline-processing-status');
	status.setAttribute('role', 'status');
	status.setAttribute('aria-live', status.getAttribute('aria-live') || 'polite');
	status.setAttribute('aria-busy', 'false');
	status.dataset.noAccordionToggle = '';
	status.removeAttribute('hidden');
	if (status.querySelector('.inline-processing-spinner') && status.querySelector('.inline-processing-label')) return status;
	const spinner = document.createElement('span');
	spinner.className = 'inline-processing-spinner';
	spinner.setAttribute('aria-hidden', 'true');
	const label = document.createElement('span');
	label.className = 'inline-processing-label';
	status.replaceChildren(spinner, label);
	return status;
}

function buildProcessingStatus(item) {
	const status = document.createElement('span');
	status.id = item.id;
	addPanelClasses(status, item.classes);
	if (item.live) status.setAttribute('aria-live', item.live);
	return initializeInlineProcessingStatus(status);
}

function setInlineProcessingStatus(status, options = {}) {
	if (!status) return;
	const active = Boolean(options.active);
	const error = Boolean(options.error);
	const visible = active || error;
	const label = status.querySelector('.inline-processing-label');
	if (label) label.textContent = visible ? (options.label || (error ? 'Could not update' : 'Updating')) : '';
	status.classList.toggle('is-active', active);
	status.classList.toggle('is-error', error);
	status.setAttribute('aria-busy', active ? 'true' : 'false');
}

// The paint-source core: source segmented control + glitter asset-info +
// solid color row. The Gradient option and its editor stay runtime-injected
// by installEffectGradientEditor (it finds this segmented control by id).
function buildAssetInfo(options) {
	const info = tplClone('tpl-asset-info');
	info.id = options.info;
	info.dataset.role = 'asset-info';
	if (options.sourceMode) info.dataset.paintSourceMode = options.sourceMode;
	info.hidden = Boolean(options.hidden);
	if (!options.glitterSource) info.classList.remove('glitter-source-glitter');
	const chip = info.querySelector('.asset-info-thumbnail');
	chip.id = options.thumbnail;
	chip.dataset.role = 'asset-thumbnail';
	chip.title = options.title || '';
	const name = info.querySelector('.asset-info-name');
	name.id = options.name;
	name.dataset.role = 'asset-name';
	const badges = info.querySelector('.asset-info-badges');
	badges.id = options.badges;
	badges.dataset.role = 'asset-badges';
	const change = info.querySelector('button');
	change.id = options.change;
	change.dataset.role = 'asset-change';
	const meta = info.querySelectorAll('.asset-info-meta .setting-value');
	if (options.compact) {
		info.querySelector('.asset-info-meta')?.remove();
	} else {
		meta[0].id = options.size;
		meta[1].id = options.frames;
		meta[0].dataset.role = 'asset-size';
		meta[1].dataset.role = 'asset-frames';
	}
	return info;
}

function buildPaintSource(slot) {
	const prefix = slot.idPrefix;
	const assetPrefix = slot.assetIdPrefix || `${prefix}Glitter`;
	const source = tplClone('tpl-paint-source');
	if (slot.imageAsset) {
		const imageInfo = buildAssetInfo({ ...slot.imageAsset, sourceMode: 'image' });
		imageInfo.classList.remove('glitter-source-glitter');
		source.querySelector('.text-effect-color-row').before(imageInfo);
	}
	const assetInfo = buildAssetInfo({
		info: `${assetPrefix}Info`,
		thumbnail: slot.assetIds?.thumbnail || `${assetPrefix}Chip`,
		name: slot.assetIds?.name || `${assetPrefix}Label`,
		badges: slot.assetIds?.badges || `${assetPrefix}Badges`,
		change: slot.assetIds?.change || `${assetPrefix}Change`,
		size: slot.assetIds?.size || `${assetPrefix}Size`,
		frames: slot.assetIds?.frames || `${assetPrefix}Frames`,
		title: slot.chipTitle,
		hidden: slot.activeMode !== 'glitter',
		glitterSource: true
	});
	source.querySelector('.text-effect-color-row').before(assetInfo);
	const sourceChoices = buildSegmented(slot.modes.map((mode) => ({
		id: panelRoleId(prefix, `source${panelCap(mode)}`),
		label: slot.modeLabels?.[mode] || panelCap(mode),
		active: mode === slot.activeMode,
		mode
	})));
	sourceChoices.classList.add('paint-source-choice-grid');
	source.prepend(sourceChoices);
	const colorRow = source.querySelector('.text-effect-color-row');
	colorRow.id = `${prefix}ColorRow`;
	colorRow.dataset.role = 'solid-color-row';
	colorRow.hidden = slot.activeMode !== 'solid';
	const colorInput = colorRow.querySelector('input');
	colorInput.id = `${prefix}Color`;
	colorInput.dataset.role = 'solid-color';
	colorInput.setAttribute('value', slot.color);
	return source;
}

// Canonical [Texture Scale | Opacity] row (FILL-CONSISTENCY-PLAN spec);
// syncPaintSlotSourceUI drives its per-mode visibility at runtime.
function buildPrimaryRow(prefix, ids = {}) {
	const row = tplClone('tpl-two-column');
	row.classList.add('paint-slot-primary-row');
	row.appendChild(buildSliderRow({ id: ids.scale || `${prefix}Scale`, rowId: ids.scaleRow, slider: 'textureScale', extraClass: 'paint-slot-scale', role: 'texture-scale' }));
	row.appendChild(buildSliderRow({ id: ids.opacity || `${prefix}Opacity`, rowId: ids.opacityRow, slider: 'slotOpacity', extraClass: 'paint-slot-opacity', role: 'slot-opacity' }));
	return row;
}

function buildAdvancedControlGroup(title, className) {
	const group = panelDiv(`advanced-control-group ${className}`);
	const heading = panelDiv('advanced-control-group-title setting-label');
	heading.textContent = title;
	group.appendChild(heading);
	return group;
}

// Advanced = grouped color adjustment, then optional texture coordinates.
function buildAdvancedDisclosure(prefix, ids = {}, options = {}) {
	const advanced = tplClone('tpl-advanced');
	const content = advanced.querySelector('[data-advanced-content]');
	const colorGroup = buildAdvancedControlGroup('Color Adjust', 'advanced-color-adjust-group');
	colorGroup.appendChild(buildSliderRow({ id: ids.hue || `${prefix}Hue`, slider: 'hue' }));
	const colorColumns = tplClone('tpl-two-column');
	colorColumns.appendChild(buildSliderRow({ id: ids.saturation || `${prefix}Saturation`, slider: 'saturation' }));
	colorColumns.appendChild(buildSliderRow({ id: ids.brightness || `${prefix}Brightness`, slider: 'brightness' }));
	colorGroup.appendChild(colorColumns);
	content.appendChild(colorGroup);

	if (options.texturePosition) {
		const textureGroup = buildAdvancedControlGroup('Texture Position', 'advanced-texture-position-group');
		const anchor = buildSegmented([
			{ id: `${prefix}TextureAnchorArtwork`, label: 'Artwork', active: true },
			{ id: `${prefix}TextureAnchorCanvas`, label: 'Canvas' }
		], { label: 'Texture anchor' });
		textureGroup.appendChild(buildOptionGroup('Anchor', [anchor]));
		const offsets = tplClone('tpl-two-column');
		offsets.appendChild(buildSliderRow({ id: `${prefix}TextureOffsetX`, slider: 'textureOffsetX' }));
		offsets.appendChild(buildSliderRow({ id: `${prefix}TextureOffsetY`, slider: 'textureOffsetY' }));
		textureGroup.appendChild(offsets);
		const reset = panelDiv('settings-action-row');
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'btn-simple secondary';
		button.id = `${prefix}ResetTexturePosition`;
		button.textContent = 'Reset Texture Position';
		reset.appendChild(button);
		textureGroup.appendChild(reset);
		content.appendChild(textureGroup);
	}
	return advanced;
}

// One full paint-slot card: title (+ Enabled toggle and controls wrapper for
// border/shadow), slot-specific `pre` items, source, primary row, `post`
// items, Advanced. Order mirrors the pre-template static panels exactly.
function buildPaintSlotCard(slot) {
	const card = tplClone('tpl-paint-slot');
	card.classList.add('has-subsection-title');
	card.dataset.slot = slot.slot;
	card.dataset.role = 'paint-slot';
	if (slot.hidePrimaryModes?.length) card.dataset.hidePrimaryModes = slot.hidePrimaryModes.join(' ');
	card.querySelector('.subsection-title > span').textContent = slot.title;
	let container = card;
	if (slot.toggle) {
		card.dataset.effectCard = '';
		const toggle = tplClone('tpl-checkbox');
		const input = toggle.querySelector('input');
		input.id = `${slot.idPrefix}Enabled`;
		input.dataset.effectToggle = '';
		toggle.querySelector('span').textContent = 'Enabled';
		card.querySelector('.subsection-title').appendChild(toggle);
		container = panelDiv('text-effect-controls');
		container.id = `${slot.idPrefix}Controls`;
		card.appendChild(container);
	}
	const main = panelDiv('paint-slot-main');
	container.appendChild(main);
	(slot.pre || []).forEach((item) => main.appendChild(buildPanelItem(item)));
	const source = buildPaintSource(slot);
	main.appendChild(slot.sourceLabel ? buildOptionGroup(slot.sourceLabel, [source]) : source);
	const primaryRow = buildPrimaryRow(slot.idPrefix, slot.primaryIds);
	if (slot.primaryToggle) {
		const toggle = tplClone('tpl-checkbox');
		toggle.querySelector('input').id = slot.primaryToggle.id;
		toggle.querySelector('span').textContent = slot.primaryToggle.label;
		if (slot.primaryToggle.title) toggle.querySelector('span').title = slot.primaryToggle.title;
		main.appendChild(buildOptionGroup('Scale & Opacity', [toggle, primaryRow]));
	} else {
		main.appendChild(primaryRow);
	}
	(slot.post || []).forEach((item) => main.appendChild(buildPanelItem(item)));
	container.appendChild(buildAdvancedDisclosure(slot.idPrefix, slot.advancedIds, {
		texturePosition: slot.texturePosition
	}));
	return card;
}

function buildPanelItem(item, schema) {
	switch (item.kind) {
		case 'card': {
			const card = tplClone('tpl-card');
			if (item.bare) card.classList.remove('subsection-content-group');
			if (item.id) card.id = item.id;
			if (item.hidden) card.hidden = true;
			addPanelClasses(card, item.classes);
			const title = card.querySelector('.subsection-title');
			if (item.title) {
				title.querySelector(':scope > span').textContent = item.title;
				card.classList.add('has-subsection-title');
			}
			else title.remove();
			if (item.toggle) {
				card.dataset.effectCard = '';
				const toggle = tplClone('tpl-checkbox');
				const input = toggle.querySelector('input');
				input.id = item.toggle.id;
				input.dataset.effectToggle = '';
				toggle.querySelector('span').textContent = item.toggle.label;
				if (item.toggle.title) toggle.querySelector('span').title = item.toggle.title;
				card.querySelector('.subsection-title').appendChild(toggle);
			}
			const body = panelDiv('subsection-card-body');
			if (item.bare) body.classList.add('subsection-card-body-bare');
			item.items.forEach((child) => body.appendChild(buildPanelItem(child, schema)));
			card.appendChild(body);
			return card;
		}
		case 'content': {
			const content = addPanelClasses(panelDiv('subsection-content'), item.classes);
			if (item.id) content.id = item.id;
			if (item.hidden) content.hidden = true;
			item.items.forEach((child) => content.appendChild(buildPanelItem(child, schema)));
			return content;
		}
		case 'checkboxList': {
			const content = panelDiv('subsection-content checkbox-list-content');
			if (item.label) {
				const label = panelDiv('effect-option-label setting-label');
				label.textContent = item.label;
				content.appendChild(label);
			}
			const list = panelDiv('tool-options-group');
			item.items.forEach((entry) => {
				const checkbox = tplClone('tpl-checkbox');
				checkbox.querySelector('input').id = entry.id;
				checkbox.querySelector('input').checked = Boolean(entry.checked);
				checkbox.querySelector('span').textContent = entry.label;
				if (entry.title) checkbox.querySelector('span').title = entry.title;
				list.appendChild(checkbox);
			});
			content.appendChild(list);
			return content;
		}
		case 'actionRow': {
			const row = addPanelClasses(panelDiv('settings-action-row'), item.classes);
			item.actions.forEach((action) => {
				const button = document.createElement('button');
				button.type = 'button';
				button.className = `btn-simple${action.primary ? ' primary' : ''}${action.secondary ? ' secondary' : ''}`;
				button.id = action.id;
				button.textContent = action.label;
				if (action.title) button.title = action.title;
				row.appendChild(button);
			});
			return row;
		}
		case 'paintSlot':
			return buildPaintSlotCard(item);
		case 'assetInfo':
			return buildAssetInfo(item);
		case 'slider':
			return buildSliderRow(item);
		case 'twoColumn': {
			const row = tplClone('tpl-two-column');
			item.items.forEach((child) => row.appendChild(buildPanelItem(child, schema)));
			return row;
		}
		case 'optionGroup': {
			const segmented = buildSegmented(item.options);
			let child = segmented;
			if (item.glitterSource) {
				child = panelDiv('glitter-source');
				child.appendChild(segmented);
			}
			return buildOptionGroup(item.label, [child]);
		}
		case 'segmented': {
			const group = buildSegmented(item.options, item);
			return item.visibleLabel ? buildOptionGroup(item.visibleLabel, [group]) : group;
		}
		case 'select': {
			const select = document.createElement('select');
			select.id = item.id;
			select.className = 'effect-option-select';
			select.setAttribute('aria-label', item.label || item.visibleLabel);
			item.options.forEach((entry) => {
				const option = document.createElement('option');
				option.value = entry.value;
				option.textContent = entry.label;
				option.selected = Boolean(entry.selected || entry.active);
				select.appendChild(option);
			});
			return item.visibleLabel ? buildOptionGroup(item.visibleLabel, [select]) : select;
		}
		case 'radioSegmented': {
			const group = tplClone('tpl-segmented');
			group.id = item.id;
			addPanelClasses(group, item.classes);
			group.setAttribute('role', 'radiogroup');
			group.setAttribute('aria-label', item.label);
			item.options.forEach((entry) => {
				const label = document.createElement('label');
				label.className = 'segmented-option';
				const input = document.createElement('input');
				input.type = 'radio';
				input.name = item.id;
				input.id = entry.id;
				input.value = entry.value;
				const text = document.createElement('span');
				text.textContent = entry.label;
				label.append(input, text);
				group.appendChild(label);
			});
			return item.visibleLabel ? buildOptionGroup(item.visibleLabel, [group]) : group;
		}
		case 'advanced': {
			const advanced = tplClone('tpl-advanced');
			advanced.classList.remove('glitter-source-glitter');
			if (item.id) advanced.id = item.id;
			if (item.hidden) advanced.hidden = true;
			addPanelClasses(advanced, item.classes);
			advanced.querySelector('.advanced-disclosure-label').textContent = item.label || 'Advanced';
			const content = advanced.querySelector('[data-advanced-content]');
			item.items.forEach((child) => content.appendChild(buildPanelItem(child, schema)));
			return advanced;
		}
		case 'colorAdjust':
			return buildAdvancedDisclosure(item.prefix || schema.prefix, item.ids);
		case 'stackRow': {
			const row = tplClone('tpl-two-column');
			row.classList.add('effect-stack-row');
			item.groups.forEach((group) => row.appendChild(buildOptionGroup(group.label, [buildSegmented(group.options)])));
			return row;
		}
		case 'host': {
			const node = document.createElement(item.tag || 'div');
			node.id = item.id;
			if (item.classes) node.className = item.classes;
			if (item.text) node.textContent = item.text;
			Object.entries(item.attrs || {}).forEach(([name, value]) => node.setAttribute(name, value));
			if (!item.wrapInContent) return node;
			const wrap = panelDiv('subsection-content');
			wrap.appendChild(node);
			return wrap;
		}
		case 'processingStatus':
			return buildProcessingStatus(item);
		case 'transformHost': {
			const host = panelDiv('transform-panel-host');
			host.id = `${schema.prefix}TransformPanelHost`;
			return host;
		}
		case 'templateCard': {
			const template = document.getElementById(item.template);
			const source = template?.content.querySelector(item.selector)?.closest('.subsection-content-group');
			if (!source) throw new Error(`panel-renderer: missing template card "${item.selector}"`);
			const card = source.cloneNode(true);
			card.querySelectorAll('input[type="range"][id]').forEach((input) => {
				const spec = CONFIG.ui.sliders[input.id];
				if (spec) applySliderSpec(input, spec);
			});
			return card;
		}
		default:
			throw new Error(`panel-renderer: unknown item kind "${item.kind}"`);
	}
}

// Legacy/template cards predate the schema body's padding ownership. Normalize
// them to the same structure without pulling edge-to-edge Advanced disclosures
// into the padded body.
function ensureSubsectionCardBody(card) {
	if (!card?.classList?.contains('subsection-content-group')) return card;
	if (card.classList.contains('subsection-section-group') || card.classList.contains('effects-stack')) return card;
	if (card.querySelector(':scope > .subsection-card-body, :scope > .paint-slot-main, :scope > .text-effect-controls')) return card;
	const children = Array.from(card.children);
	const content = children.filter((child) =>
		!child.classList.contains('subsection-title') &&
		!child.classList.contains('advanced-disclosure')
	);
	if (!content.length) return card;
	const body = panelDiv('subsection-card-body');
	const advanced = children.find((child) => child.classList.contains('advanced-disclosure'));
	card.insertBefore(body, advanced || null);
	content.forEach((child) => body.appendChild(child));
	if (card.querySelector(':scope > .subsection-title')) card.classList.add('has-subsection-title');
	return card;
}

// One state contract for every schema-rendered effect card. Managers supply
// only the enabled value; expansion, accessibility, and paint-slot body
// visibility stay owned by the shared panel primitive.
function syncPanelEffectToggle(toggle, enabled) {
	if (!toggle) return;
	const card = toggle.closest('[data-effect-card]');
	const next = Boolean(enabled);
	const previous = card?.dataset.effectEnabled;
	toggle.checked = next;
	if (!card) return;
	card.dataset.effectEnabled = String(next);
	if (previous == null || String(next) !== previous) card.classList.toggle('is-collapsed', !next);
	card.querySelector(':scope > .subsection-title')?.setAttribute('aria-expanded', card.classList.contains('is-collapsed') ? 'false' : 'true');
	card.querySelector(':scope > .text-effect-controls')?.classList.toggle('visible', next);
}

// Availability is separate from enablement: a card can retain enabled state
// while its source type makes the effect temporarily inapplicable. The group
// and its shared actions disappear when none of its effect cards are usable.
function syncPanelEffectAvailability(card, available) {
	if (!card) return;
	card.hidden = !available;
	const group = card.closest('[data-effect-group]');
	if (!group) return;
	group.hidden = !Array.from(group.querySelectorAll(':scope > [data-effect-card]'))
		.some((effectCard) => !effectCard.hidden);
}

function initializePanelGroupNode(node, prefix, title) {
	const header = node.querySelector('.subsection-title');
	const label = document.createElement('span');
	label.className = 'panel-group-label';
	label.textContent = title;
	header.appendChild(label);
	const chevron = document.createElement('span');
	chevron.className = 'panel-group-chevron icon-wrapper sm';
	chevron.appendChild(createIcon('chevron-down'));
	const key = `${prefix}:${title}`;
	let state = {};
	try { state = JSON.parse(localStorage.getItem('glitter.panelGroups') || '{}'); } catch (error) { state = {}; }
	node.classList.toggle('collapsed', state[key] === false);
	header.addEventListener('click', (event) => {
		if (event.target.closest('input, label, button, [data-no-accordion-toggle]')) return;
		node.classList.toggle('collapsed');
		state[key] = !node.classList.contains('collapsed');
		localStorage.setItem('glitter.panelGroups', JSON.stringify(state));
	});
	return { header, chevron };
}

function buildPanelGroup(group, schema) {
	const node = tplClone('tpl-group');
	if (group.bare) node.classList.remove('subsection-content-group');
	addPanelClasses(node, group.classes);
	if (group.static) {
		node.querySelector('.subsection-title')?.remove();
		node.dataset.panelGroup = group.title;
		group.items.forEach((item) => node.appendChild(buildPanelItem(item, schema)));
		return node;
	}
	const { header, chevron } = initializePanelGroupNode(node, schema.prefix, group.title);
	if (group.toggle) {
		const toggle = tplClone('tpl-checkbox');
		toggle.querySelector('input').id = group.toggle.id;
		toggle.querySelector('span').textContent = group.toggle.label;
		header.appendChild(toggle);
	}
	header.appendChild(chevron);
	node.dataset.panelGroup = group.title;
	group.items.forEach((item) => node.appendChild(buildPanelItem(item, schema)));
	if (node.querySelector(':scope > [data-effect-card]')) node.dataset.effectGroup = '';
	return node;
}

function renderPanelSection(schema) {
	const host = document.getElementById(schema.section.id);
	if (!host) return;
	if (schema.replaceStatic) host.replaceChildren();
	else if (host.querySelector(':scope > .section-header')) return;
	const fragment = document.getElementById('tpl-section').content.cloneNode(true);
	const sectionPrefix = schema.sectionPrefix || `${schema.prefix}Settings`;
	fragment.querySelector('.section-header').id = `${sectionPrefix}Header`;
	const titleIcon = fragment.querySelector('use');
	titleIcon.setAttribute('href', `#icon-${schema.section.icon}`);
	if (schema.section.titleIconId) titleIcon.id = schema.section.titleIconId;
	fragment.querySelector('.name').textContent = schema.section.iconName;
	const titleText = fragment.querySelector('.section-header-title-text');
	titleText.textContent = schema.section.title;
	if (schema.section.titleTextId) titleText.id = schema.section.titleTextId;
	fragment.querySelector('.section-header-action').id = `${sectionPrefix}Toggle`;
	fragment.querySelector('.section-content').id = `${sectionPrefix}Content`;
	const subsection = fragment.querySelector('.settings-subsection');
	let scrollRegion = null;
	schema.groups.forEach((group) => {
		const node = buildPanelGroup(group, schema);
		if (group.region === 'scroll') {
			if (!scrollRegion) {
				scrollRegion = panelDiv('panel-scroll-region');
				subsection.appendChild(scrollRegion);
			}
			scrollRegion.appendChild(node);
		} else {
			subsection.appendChild(node);
		}
	});
	if (schema.effects?.length) {
		const stack = buildPanelGroup({ title: 'Effects', items: schema.effects }, schema);
		stack.classList.add('effects-stack');
		subsection.appendChild(stack);
	}
	if (schema.controls) {
		const content = fragment.querySelector('.section-content');
		const empty = panelDiv('empty-state visible');
		empty.id = schema.controls.emptyId;
		if (schema.controls.emptyItems) {
			schema.controls.emptyItems.forEach((item) => {
				const element = document.createElement('div');
				element.className = item.className;
				if (item.id) element.id = item.id;
				element.textContent = item.text || '';
				empty.appendChild(element);
			});
		} else {
			empty.textContent = schema.controls.emptyText;
		}
		const controls = document.createElement('div');
		controls.id = schema.controls.id;
		controls.appendChild(subsection);
		content.replaceChildren(empty, controls);
	}
	// Keep generated section chrome before any retained static host content.
	(schema.sourceTemplate ? document.getElementById(schema.sourceTemplate) : host.querySelector(':scope > template'))?.remove();
	host.prepend(fragment);
}

// Boot entry point. Must run before renderTransformPanels (it creates the
// transform hosts) and before any manager constructor caches panel elements.
function renderPanelSections(editor) {
	Object.values(PANEL_SCHEMAS).forEach((schema) => {
		if (schema.template) renderLegacyPanelTemplate(schema.section.id, schema.template);
		else renderPanelSection(schema);
		(schema.auxiliarySections || []).forEach((section) => renderPanelSection(section));
	});
}

function renderLegacyPanelTemplate(sectionId, templateId) {
	const section = document.getElementById(sectionId);
	const template = document.getElementById(templateId);
	if (!section || !template || section.querySelector(':scope > .section-header')) return;
	section.appendChild(template.content.cloneNode(true));
	template.remove();
}

function buildTransformPanel(editor, container, prefix, capabilities) {
	const ids = editor.getTransformIds(prefix);
	const fragment = document.getElementById('tpl-transform-panel').content.cloneNode(true);
	const buildNumberPair = (roles, labels, min = null) => {
		const pair = tplClone('tpl-number-pair');
		pair.querySelectorAll('.input-group').forEach((group, index) => {
			const label = group.querySelector('label');
			const input = group.querySelector('input');
			label.textContent = labels[index];
			label.dataset.forRole = roles[index];
			input.dataset.transformRole = roles[index];
			if (min != null) input.min = String(min);
		});
		return pair;
	};
	fragment.querySelector('[data-transform-action-row]').replaceWith(tplClone('tpl-action-row'));
	fragment.querySelector('[data-transform-number-pair="position"]').replaceWith(buildNumberPair(['posX', 'posY'], ['X', 'Y']));
	const sizePair = buildNumberPair(['sizeWidth', 'sizeHeight'], ['W', 'H'], 1);
	sizePair.dataset.transformRole = 'sizeGroup';
	fragment.querySelector('[data-transform-number-pair="size"]').replaceWith(sizePair);
	fragment.querySelector('[data-transform-card]').dataset.transformPrefix = prefix;
	fragment.querySelectorAll('[data-transform-role]').forEach((element) => {
		const id = ids[element.dataset.transformRole];
		if (id) element.id = id;
	});
	const transformSliderSpecs = {
		scaleX: CONFIG.ui.sliders.transformScale,
		scaleY: CONFIG.ui.sliders.transformScale,
		rotation: CONFIG.ui.sliders.transformRotation,
		opacity: CONFIG.ui.sliders.transformOpacity
	};
	Object.entries(transformSliderSpecs).forEach(([role, spec]) => {
		const input = fragment.querySelector(`input[data-transform-role="${role}"]`);
		if (input) applySliderSpec(input, spec);
	});
	fragment.querySelectorAll('[data-for-role]').forEach((label) => {
		const id = ids[label.dataset.forRole];
		if (id) label.htmlFor = id;
	});
	fragment.querySelectorAll('[data-prefix-id]').forEach((element) => {
		element.id = prefix + element.dataset.prefixId;
	});
	if (!capabilities.lockAspect) fragment.querySelector('[data-transform-lock]').remove();
	if (!capabilities.scaleReadout) fragment.querySelectorAll('[data-transform-scale-readout]').forEach((element) => element.remove());
	container.replaceChildren(fragment);
}

// Shared schema finalization: retitle the transform panel's geometry/opacity cards, fold
// Reset Transform into the actions row, and settle host card order.
function normalizeTransformPanelHost(editor, prefix, externalActions = null) {
	const host = document.getElementById(`${prefix}TransformPanelHost`);
	if (!host) return null;
	const card = (id) => document.getElementById(id)?.closest('.subsection-content-group');
	const ids = editor.getTransformIds(prefix);
	const geometry = host.querySelector(':scope > [data-transform-prefix]');
	const opacity = card(ids.opacity);
	const align = card(ids.alignLeft);
	const flip = card(ids.flipX);
	const actions = externalActions || card(`${prefix}FitCanvas`);
	const reset = document.getElementById(ids.resetTransform);

	const setTitle = (section, label) => {
		const title = section?.querySelector(':scope > .subsection-title');
		if (!title) return;
		const labelNode = title.querySelector(':scope > span');
		if (labelNode) labelNode.textContent = label;
		else title.textContent = label;
	};
	setTitle(geometry, 'Transform');
	setTitle(opacity, 'Opacity');

	if (actions && reset) {
		const footer = reset.closest('.transform-panel-footer');
		const row = actions.querySelector('.settings-action-row, .tool-options-group');
		if (row) row.appendChild(reset);
		footer?.remove();
	}

	[geometry, opacity, align, flip].filter(Boolean).forEach((section) => host.appendChild(section));
	if (actions) host.appendChild(actions);
	return host;
}

// Post-transform-render arrangement for schema-rendered panels: normalize the
// host, then let the schema group flagged adoptTransformOpacity take the
// transform panel's Opacity card. Runs once from renderTransformPanels.
function finalizePanelSchemaSections(editor) {
	Object.values(PANEL_SCHEMAS).forEach((schema) => {
		if (!schema.groups) return;
		const content = document.getElementById(`${schema.prefix}SettingsContent`);
		if (!content) return;
		normalizeTransformPanelHost(editor, schema.prefix);
		const adopter = schema.groups.find((group) => group.adoptTransformOpacity);
		if (!adopter) return;
		const groupNode = content.querySelector(`[data-panel-group="${adopter.title}"]`);
		const opacityCard = document.getElementById(editor.getTransformIds(schema.prefix).opacity)?.closest('.subsection-content-group');
		if (groupNode && opacityCard) groupNode.appendChild(opacityCard);
	});
}

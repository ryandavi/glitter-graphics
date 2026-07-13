'use strict';

// Sidebar panel renderer (docs/SIDEBAR-TEMPLATE-PLAN.md). Clones the tpl-*
// <template> primitives in index.html per PANEL_SCHEMAS (core/config.js) and
// stamps ids, labels, and slider ranges (CONFIG.ui.sliders). Renders ONCE at
// boot, before any manager caches or binds panel elements — managers keep
// updating values in place; nothing here re-renders after boot (rebuilding a
// section would orphan every listener bound to it). Stamped controls also
// carry data-role/data-slot/data-mode so shared code can resolve meaning
// without sniffing id suffixes.

function tplClone(templateId) {
	return document.getElementById(templateId).content.firstElementChild.cloneNode(true);
}

function panelDiv(className) {
	const node = document.createElement('div');
	node.className = className;
	return node;
}

function panelCap(value) {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

const PANEL_ROLES = Object.freeze({
	paintSlot: Object.freeze({
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

const PANEL_TRANSFORM_IDS = Object.freeze({
	sticker: Object.freeze({
		posX: 'stickerPosX', posY: 'stickerPosY', sizeWidth: 'stickerWidth', sizeHeight: 'stickerHeight', sizeGroup: 'stickerSizeGroup',
		rotation: 'stickerRotation', rotationValue: 'stickerRotationValue', resetRotation: 'resetStickerRotation',
		opacity: 'stickerOpacity', opacityValue: 'stickerOpacityValue', resetOpacity: 'resetStickerOpacity', proportional: 'stickerProportionalScale',
		scaleControl: 'stickerScaleControl', scaleSummary: 'stickerScaleSummary', scaleSlider: 'stickerScale', resetScale: 'resetStickerScale',
		scaleX: 'stickerTransformScaleX', scaleXValue: 'stickerTransformScaleXValue', resetScaleX: 'resetStickerTransformScaleX',
		scaleY: 'stickerTransformScaleY', scaleYValue: 'stickerTransformScaleYValue', resetScaleY: 'resetStickerTransformScaleY',
		flipX: 'stickerFlipX', flipY: 'stickerFlipY', alignLeft: 'stickerAlignLeft', alignCenterX: 'stickerAlignCenterX', alignRight: 'stickerAlignRight',
		alignTop: 'stickerAlignTop', alignCenterY: 'stickerAlignCenterY', alignBottom: 'stickerAlignBottom', resetTransform: 'resetStickerTransform'
	}),
	shape: Object.freeze({
		posX: 'shapePosX', posY: 'shapePosY', sizeWidth: 'shapeWidth', sizeHeight: 'shapeHeight', sizeGroup: 'shapeSizeGroup',
		rotation: 'shapeRotation', rotationValue: 'shapeRotationValue', resetRotation: 'resetShapeRotation',
		opacity: 'shapeOpacity', opacityValue: 'shapeOpacityValue', resetOpacity: 'resetShapeOpacity', proportional: 'shapeProportionalScale',
		scaleControl: 'shapeScaleControl', scaleSummary: 'shapeScaleSummary', scaleSlider: 'shapeScale', resetScale: 'resetShapeScale',
		scaleX: 'shapeTransformScaleX', scaleXValue: 'shapeTransformScaleXValue', resetScaleX: 'resetShapeTransformScaleX',
		scaleY: 'shapeTransformScaleY', scaleYValue: 'shapeTransformScaleYValue', resetScaleY: 'resetShapeTransformScaleY',
		flipX: 'shapeFlipX', flipY: 'shapeFlipY', alignLeft: 'shapeAlignLeft', alignCenterX: 'shapeAlignCenterX', alignRight: 'shapeAlignRight',
		alignTop: 'shapeAlignTop', alignCenterY: 'shapeAlignCenterY', alignBottom: 'shapeAlignBottom', resetTransform: 'resetShapeTransform'
	}),
	text: Object.freeze({
		posX: 'textPosX', posY: 'textPosY', sizeWidth: 'textWidth', sizeHeight: 'textHeight', sizeGroup: 'textSizeGroup',
		rotation: 'textRotation', rotationValue: 'textRotationValue', resetRotation: 'resetTextRotation',
		opacity: 'textLayerOpacity', opacityValue: 'textLayerOpacityValue', resetOpacity: 'resetTextLayerOpacity', proportional: 'textProportionalScale',
		scaleControl: 'textScaleControl', scaleSummary: 'textScaleSummary', scaleSlider: 'textScale', resetScale: 'resetTextScale',
		scaleX: 'textTransformScaleX', scaleXValue: 'textTransformScaleXValue', resetScaleX: 'resetTextTransformScaleX',
		scaleY: 'textTransformScaleY', scaleYValue: 'textTransformScaleYValue', resetScaleY: 'resetTextTransformScaleY',
		flipX: 'textFlipX', flipY: 'textFlipY', alignLeft: 'textAlignLeft', alignCenterX: 'textAlignCenterX', alignRight: 'textAlignRight',
		alignTop: 'textAlignTop', alignCenterY: 'textAlignCenterY', alignBottom: 'textAlignBottom', resetTransform: 'resetTextTransform'
	})
});

function getPanelTransformIds(prefix) {
	return PANEL_TRANSFORM_IDS[prefix] || PANEL_TRANSFORM_IDS.text;
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

function buildSegmented(entries) {
	const group = tplClone('tpl-segmented');
	entries.forEach((entry) => {
		const button = tplClone('tpl-segmented-option');
		button.id = entry.id;
		button.textContent = entry.label;
		if (entry.active) button.classList.add('active');
		if (entry.mode) button.dataset.mode = entry.mode;
		else if (entry.value) button.dataset.value = entry.value;
		button.dataset.role = entry.role || (entry.mode ? `source-${entry.mode}` : 'segmented-option');
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

// The paint-source core: source segmented control + glitter asset-info +
// solid color row. The Gradient option and its editor stay runtime-injected
// by installEffectGradientEditor (it finds this segmented control by id).
function buildAssetInfo(options) {
	const info = tplClone('tpl-asset-info');
	info.id = options.info;
	info.dataset.role = 'asset-info';
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
	source.prepend(buildSegmented(slot.modes.map((mode) => ({
		id: panelRoleId(prefix, `source${panelCap(mode)}`),
		label: panelCap(mode),
		active: mode === slot.activeMode,
		mode
	}))));
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

// Advanced = color-adjust only (Hue, then Saturation | Brightness).
function buildAdvancedDisclosure(prefix, ids = {}) {
	const advanced = tplClone('tpl-advanced');
	const content = advanced.querySelector('[data-advanced-content]');
	content.appendChild(buildSliderRow({ id: ids.hue || `${prefix}Hue`, slider: 'hue' }));
	const columns = tplClone('tpl-two-column');
	columns.appendChild(buildSliderRow({ id: ids.saturation || `${prefix}Saturation`, slider: 'saturation' }));
	columns.appendChild(buildSliderRow({ id: ids.brightness || `${prefix}Brightness`, slider: 'brightness' }));
	content.appendChild(columns);
	return advanced;
}

// One full paint-slot card: title (+ Enabled toggle and controls wrapper for
// border/shadow), slot-specific `pre` items, source, primary row, `post`
// items, Advanced. Order mirrors the pre-template static panels exactly.
function buildPaintSlotCard(slot) {
	const card = tplClone('tpl-paint-slot');
	card.dataset.slot = slot.slot;
	card.dataset.role = 'paint-slot';
	card.querySelector('.subsection-title > span').textContent = slot.title;
	let container = card;
	if (slot.toggle) {
		const toggle = tplClone('tpl-checkbox');
		toggle.querySelector('input').id = `${slot.idPrefix}Enabled`;
		toggle.querySelector('span').textContent = 'Enabled';
		card.querySelector('.subsection-title').appendChild(toggle);
		container = panelDiv('text-effect-controls');
		container.id = `${slot.idPrefix}Controls`;
		card.appendChild(container);
	}
	(slot.pre || []).forEach((item) => container.appendChild(buildPanelItem(item)));
	const source = buildPaintSource(slot);
	container.appendChild(slot.sourceLabel ? buildOptionGroup(slot.sourceLabel, [source]) : source);
	const primaryRow = buildPrimaryRow(slot.idPrefix, slot.primaryIds);
	if (slot.primaryToggle) {
		const toggle = tplClone('tpl-checkbox');
		toggle.querySelector('input').id = slot.primaryToggle.id;
		toggle.querySelector('span').textContent = slot.primaryToggle.label;
		if (slot.primaryToggle.title) toggle.querySelector('span').title = slot.primaryToggle.title;
		container.appendChild(buildOptionGroup('Scale & Opacity', [toggle, primaryRow]));
	} else {
		container.appendChild(primaryRow);
	}
	(slot.post || []).forEach((item) => container.appendChild(buildPanelItem(item)));
	container.appendChild(buildAdvancedDisclosure(slot.idPrefix, slot.advancedIds));
	return card;
}

function buildPanelItem(item, schema) {
	switch (item.kind) {
		case 'card': {
			const card = tplClone('tpl-card');
			const title = card.querySelector('.subsection-title');
			if (item.title) title.querySelector(':scope > span').textContent = item.title;
			else title.remove();
			if (item.toggle) {
				const toggle = tplClone('tpl-checkbox');
				toggle.querySelector('input').id = item.toggle.id;
				toggle.querySelector('span').textContent = item.toggle.label;
				if (item.toggle.title) toggle.querySelector('span').title = item.toggle.title;
				card.querySelector('.subsection-title').appendChild(toggle);
			}
			item.items.forEach((child) => card.appendChild(buildPanelItem(child, schema)));
			return card;
		}
		case 'content': {
			const content = panelDiv('subsection-content');
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
			const row = panelDiv('settings-action-row');
			item.actions.forEach((action) => {
				const button = document.createElement('button');
				button.type = 'button';
				button.className = `btn-simple${action.primary ? ' primary' : ''}`;
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

function initializePanelGroupNode(node, prefix, title) {
	const header = node.querySelector('.subsection-title');
	const label = document.createElement('span');
	label.className = 'panel-group-label';
	label.textContent = title;
	header.appendChild(label);
	const chevron = document.createElement('span');
	chevron.className = 'panel-group-chevron icon-wrapper sm';
	chevron.innerHTML = '<svg class="icon"><use href="#icon-chevron-down"></use></svg>';
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
	return node;
}

function renderPanelSection(schema) {
	const host = document.getElementById(schema.section.id);
	if (!host) return;
	if (schema.replaceStatic) host.replaceChildren();
	else if (host.querySelector(':scope > .section-header')) return;
	const fragment = document.getElementById('tpl-section').content.cloneNode(true);
	fragment.querySelector('.section-header').id = `${schema.prefix}SettingsHeader`;
	const titleIcon = fragment.querySelector('use');
	titleIcon.setAttribute('href', `#icon-${schema.section.icon}`);
	if (schema.section.titleIconId) titleIcon.id = schema.section.titleIconId;
	fragment.querySelector('.name').textContent = schema.section.iconName;
	const titleText = fragment.querySelector('.section-header-title-text');
	titleText.textContent = schema.section.title;
	if (schema.section.titleTextId) titleText.id = schema.section.titleTextId;
	fragment.querySelector('.section-header-action').id = `${schema.prefix}SettingsToggle`;
	fragment.querySelector('.section-content').id = `${schema.prefix}SettingsContent`;
	const subsection = fragment.querySelector('.settings-subsection');
	schema.groups.forEach((group) => subsection.appendChild(buildPanelGroup(group, schema)));
	if (schema.effects) {
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
	// Prepend, not append: some section hosts carry nested static sections
	// (layerSettingsSection lives inside shapeSettingsSection) that must stay
	// after the rendered header/content.
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

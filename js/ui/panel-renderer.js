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

function buildPropertyEmpty(options = {}) {
	const empty = panelDiv('property-empty');
	if (options.id) empty.id = options.id;
	if (options.visible) empty.classList.add('visible');
	if (options.icon) {
		const icon = panelDiv('property-empty-icon icon-wrapper xl');
		icon.appendChild(createIcon(options.icon));
		empty.appendChild(icon);
	}
	if (options.title !== undefined) {
		const title = panelDiv('property-empty-title');
		if (options.titleId) title.id = options.titleId;
		title.textContent = options.title;
		empty.appendChild(title);
	}
	if (options.text !== undefined) {
		const text = panelDiv('property-empty-text');
		if (options.textId) text.id = options.textId;
		text.textContent = options.text;
		empty.appendChild(text);
	}
	return empty;
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

// Inline glyphs are transcribed from design/Main.dc.html. They stay real SVG
// elements so stroke opacity, joins, and active-state currentColor match the
// target instead of approximating the artwork with font or CSS-mask icons.
const DESIGN_PANEL_GLYPHS = Object.freeze({
	textAlignLeft: '<path d="M3 2v12M3 6h9M3 10h6"/>',
	textAlignCenter: '<path d="M8 2v12M3.5 6h9M5 10h6"/>',
	textAlignRight: '<path d="M13 2v12M4 6h9M7 10h6"/>',
	textAlignTop: '<path d="M2 3h12M6 3v9M10 3v6"/>',
	textAlignMiddle: '<path d="M2 8h12M6 3.5v9M10 5v6"/>',
	textAlignBottom: '<path d="M2 13h12M6 4v9M10 7v6"/>',
	transformAlignLeft: '<path d="M2.5 2v12" opacity=".5"/><rect x="4.5" y="5" width="7.5" height="6" rx="1"/>',
	transformAlignCenterX: '<path d="M8 2v12" opacity=".5" stroke-dasharray="2 2"/><rect x="3.5" y="5" width="9" height="6" rx="1"/>',
	transformAlignRight: '<path d="M13.5 2v12" opacity=".5"/><rect x="4" y="5" width="7.5" height="6" rx="1"/>',
	transformAlignTop: '<path d="M2 2.5h12" opacity=".5"/><rect x="5" y="4.5" width="6" height="7.5" rx="1"/>',
	transformAlignCenterY: '<path d="M2 8h12" opacity=".5" stroke-dasharray="2 2"/><rect x="5" y="3.5" width="6" height="9" rx="1"/>',
	transformAlignBottom: '<path d="M2 13.5h12" opacity=".5"/><rect x="5" y="4" width="6" height="7.5" rx="1"/>',
	transformFlipX: '<path d="M8 2v12" opacity=".5" stroke-dasharray="2 2"/><path d="M6 4.5L2.5 8 6 11.5z"/><path d="M10 4.5L13.5 8 10 11.5z"/>',
	transformFlipY: '<path d="M2 8h12M4.5 6L8 2.5 11.5 6z"/><path d="M4.5 10L8 13.5 11.5 10z"/>'
});

function createDesignPanelGlyph(name) {
	const markup = DESIGN_PANEL_GLYPHS[name];
	if (!markup) return null;
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.classList.add('design-panel-glyph');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', name.startsWith('text') ? '1.5' : '1.4');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.setAttribute('aria-hidden', 'true');
	svg.innerHTML = markup;
	return svg;
}

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

// Every slider's default, keyed by the element id it ends up carrying. One
// registry, filled wherever a spec is applied (schema rows, legacy template
// cards, the transform panel), so rule D's "revert is inert at default" holds
// for all of them instead of the seven that were hand-listed in app.js.
const PANEL_SLIDER_DEFAULTS = Object.create(null);

function applySliderSpec(input, spec) {
	if (spec.scale === 'log') {
		// The DOM range is a 0..positions integer track; data-scale maps it
		// geometrically onto the real [min, max] value domain. spec.value stays a
		// real value everywhere else (defaults registry, revert targets).
		const positions = spec.positions || 1000;
		input.min = '0';
		input.max = String(positions);
		input.step = '1';
		input.dataset.scale = 'log';
		input.dataset.scaleMin = String(spec.min);
		input.dataset.scaleMax = String(spec.max);
		input.setAttribute('value', String(sliderScaleFor(input).toPosition(spec.value)));
	} else {
		input.min = String(spec.min);
		input.max = String(spec.max);
		input.setAttribute('value', String(spec.value));
		if (spec.step != null) input.step = String(spec.step);
	}
	if (input.id) PANEL_SLIDER_DEFAULTS[input.id] = spec.value;
}

// The revert target for a slider: normally its registered default, but the mask
// brush's Size/Spacing follow the active raster tip's manifest value instead.
function panelSliderDefault(id) {
	const brushDefault = window.editor?.maskEditor?.rasterSliderDefault?.(id);
	return brushDefault !== undefined ? brushDefault : PANEL_SLIDER_DEFAULTS[id];
}

// Rule D, applied to any revert the panel owns: the control is disabled (and
// therefore invisible) while its slider sits at the default. Buttons already
// wired by bindSlider mark themselves so this never double-handles a click.
function syncPropertyRevert(slider) {
	if (!slider?.id) return;
	const fallback = panelSliderDefault(slider.id);
	if (fallback === undefined) return;
	const button = document.getElementById(`reset${slider.id.charAt(0).toUpperCase()}${slider.id.slice(1)}`);
	if (!button) return;
	button.disabled = readSliderValue(slider) === Number(fallback);
}

// A slider written programmatically (a panel reloading its values, a transform
// baking a new texture scale) fires no input/change event, so the listeners below
// never see it and its revert keeps whatever state it had. Panels call this after
// repopulating so the control matches the value actually on screen.
function syncPropertyReverts(root = document) {
	root.querySelectorAll('input[type="range"][id]').forEach(syncPropertyRevert);
}

function initializePropertyReverts(root = document) {
	syncPropertyReverts(root);
	if (initializePropertyReverts.bound) return;
	initializePropertyReverts.bound = true;
	document.addEventListener('input', (event) => {
		if (event.target.matches?.('input[type="range"][id]')) syncPropertyRevert(event.target);
	});
	document.addEventListener('change', (event) => {
		if (event.target.matches?.('input[type="range"][id]')) syncPropertyRevert(event.target);
	});
	// Fallback revert for sliders whose reset button bindSlider never claimed.
	document.addEventListener('click', (event) => {
		const button = event.target.closest?.('.property-revert');
		if (!button || button.disabled || button.dataset.revertBound !== undefined) return;
		const sliderId = button.id.replace(/^reset/, '');
		const slider = document.getElementById(sliderId.charAt(0).toLowerCase() + sliderId.slice(1))
			|| document.getElementById(sliderId);
		const fallback = slider && panelSliderDefault(slider.id);
		if (!slider || fallback === undefined) return;
		writeSliderValue(slider, fallback);
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		slider.dispatchEvent(new Event('change', { bubbles: true }));
	});
}

// Redesigned value fields remain the manager-owned display nodes, but also
// proxy typed values to their existing range inputs. This preserves every
// established id/listener while giving the compact value cell real input
// behaviour instead of merely making a span look editable.
function initializeEditablePropertyValues(root = document) {
	root.querySelectorAll('.property-row > .property-value').forEach((value) => {
		if (value.dataset.editableValue !== undefined) return;
		const owner = value.closest('.property-pair-cell, .property-row');
		const input = owner?.querySelector(':scope > input[type="range"]');
		if (!input) return;
		value.dataset.editableValue = '';
		value.contentEditable = 'plaintext-only';
		value.spellcheck = false;
		value.inputMode = 'decimal';
		value.setAttribute('role', 'spinbutton');
		value.setAttribute('aria-label', input.getAttribute('aria-label') || owner.querySelector('.property-label, .property-pair-mark')?.textContent || 'Value');
		value.setAttribute('aria-valuemin', input.dataset.scaleMin || input.min);
		value.setAttribute('aria-valuemax', input.dataset.scaleMax || input.max);
		value.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				value.blur();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				value.dataset.cancelEdit = '';
				value.blur();
			}
		});
		value.addEventListener('blur', () => {
			const next = Number.parseFloat(value.textContent);
			if (value.dataset.cancelEdit === undefined && Number.isFinite(next)) {
				writeSliderValue(input, next);
				input.dispatchEvent(new Event('input', { bubbles: true }));
				input.dispatchEvent(new Event('change', { bubbles: true }));
			} else {
				delete value.dataset.cancelEdit;
				input.dispatchEvent(new Event('input', { bubbles: true }));
			}
		});
	});
}

// Sliders whose range or precision earns a full-width track (R2). Everything
// else uses the compact inline row (R1) - this list is the entire exception.
const PROPERTY_WIDE_SLIDERS = new Set([]);

// One property row (R1): label | control | value | revert. Ids follow the role
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
	const label = row.querySelector('.property-label');
	label.textContent = options.label || spec.label;
	if (options.title) label.title = options.title;
	const value = row.querySelector('.property-value');
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
	// R2: precision controls keep a full-width track instead of sharing the
	// row with the label. Declared per slider, never inferred.
	if (options.wide || PROPERTY_WIDE_SLIDERS.has(options.slider)) row.classList.add('is-stacked');
	return row;
}

// R3, as specced: ONE row holding two properties that read as a single value -
// `Offset  [X ---- 6] [Y ---- 6]`. Each cell keeps the exact ids the managers
// bind (`{id}`, `{id}Value`, `reset{Id}`); only the chrome around them changes.
function buildPairRow(item) {
	const row = tplClone('tpl-slider-row');
	row.className = 'property-row is-pair';
	if (item.fields) row.classList.add('has-num-fields');
	row.replaceChildren();
	if (item.rowId) row.id = item.rowId;
	const label = document.createElement('span');
	label.className = 'property-label';
	label.textContent = item.label;
	if (item.title) label.title = item.title;
	row.appendChild(label);

	const pair = panelDiv('property-pair');
	item.items.forEach((entry) => {
		const spec = CONFIG.ui.sliders[entry.slider];
		const cell = panelDiv('property-pair-cell');
		if (item.fields) cell.classList.add('numf');
		const mark = document.createElement('span');
		mark.className = 'property-pair-mark';
		mark.textContent = entry.mark;
		mark.title = entry.label || spec.label;
		cell.appendChild(mark);

		const input = document.createElement('input');
		input.type = 'range';
		input.id = entry.id;
		applySliderSpec(input, spec);
		input.dataset.role = entry.role || entry.slider;
		input.setAttribute('aria-label', entry.label || spec.label);
		cell.appendChild(input);

		const value = document.createElement('span');
		value.className = 'property-value';
		value.id = `${entry.id}Value`;
		value.dataset.role = `${entry.role || entry.slider}-value`;
		value.textContent = `${spec.value}${spec.unit}`;
		cell.appendChild(value);

		const reset = document.createElement('button');
		reset.type = 'button';
		reset.className = 'property-revert';
		reset.id = `reset${panelCap(entry.id)}`;
		reset.dataset.role = `${entry.role || entry.slider}-reset`;
		reset.title = 'Reset to default';
		reset.setAttribute('aria-label', `Reset ${entry.label || spec.label}`);
		reset.appendChild(createIcon('undo'));
		cell.appendChild(reset);

		pair.appendChild(cell);
	});
	row.appendChild(pair);
	if (item.fields) {
		const placeholder = panelDiv('property-revert is-placeholder');
		placeholder.setAttribute('aria-hidden', 'true');
		placeholder.appendChild(createIcon('undo'));
		row.appendChild(placeholder);
	}
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
		if (entry.designGlyph) {
			button.appendChild(createDesignPanelGlyph(entry.designGlyph));
			button.title = entry.label;
			button.setAttribute('aria-label', entry.label);
		} else if (entry.contentTag) {
			const content = document.createElement(entry.contentTag);
			content.textContent = entry.label;
			button.appendChild(content);
		} else {
			button.textContent = entry.label;
		}
		if (entry.active) button.classList.add('active');
		if (entry.mode) button.dataset.mode = entry.mode;
		else if (entry.value != null) button.dataset.value = entry.value;
		button.dataset.role = entry.role || (entry.mode ? `source-${entry.mode}` : 'segmented-option');
		Object.entries(entry.attrs || {}).forEach(([name, value]) => button.setAttribute(name, value));
		button.setAttribute('aria-pressed', entry.active ? 'true' : 'false');
		group.appendChild(button);
	});
	return group;
}

function buildSelectProxy(entries, options = {}) {
	const select = document.createElement('select');
	select.className = 'property-select';
	select.setAttribute('aria-label', options.label || 'Choose option');
	entries.forEach((entry) => {
		const option = document.createElement('option');
		option.value = String(entry.mode ?? entry.value ?? entry.label);
		option.textContent = entry.label;
		option.selected = Boolean(entry.active);
		select.appendChild(option);
	});
	const hooks = buildSegmented(entries, options);
	hooks.classList.add('property-select-hooks');
	hooks.setAttribute('aria-hidden', 'true');
	const syncOptions = () => {
		let activeValue = '';
		Array.from(hooks.querySelectorAll('.segmented-option')).forEach((button) => {
			const value = button.dataset.mode ?? button.dataset.value ?? button.textContent;
			if (!Array.from(select.options).some((option) => option.value === value)) {
				const option = document.createElement('option');
				option.value = value;
				option.textContent = button.textContent;
				select.appendChild(option);
			}
			if (button.classList.contains('active')) {
				select.value = value;
				activeValue = value;
			}
		});
		const card = hooks.closest('.paint-slot-card');
		if (card && activeValue) {
			if (activeValue !== 'none') card._lastPaintMode = activeValue;
			const toggle = card.querySelector(':scope > .subsection-title input[data-paint-slot-toggle]');
			if (toggle) toggle.checked = activeValue !== 'none';
		}
	};
	select.addEventListener('change', () => {
		const button = Array.from(hooks.querySelectorAll('.segmented-option')).find((candidate) =>
			(candidate.dataset.mode ?? candidate.dataset.value ?? candidate.textContent) === select.value
		);
		button?.click();
	});
	hooks.addEventListener('click', () => requestAnimationFrame(syncOptions));
	new MutationObserver(syncOptions).observe(hooks, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
	syncOptions();
	const control = panelDiv('property-select-control');
	control.append(select, hooks);
	return control;
}

function buildOptionGroup(label, children, rowClasses = '') {
	const group = tplClone('tpl-option-group');
	addPanelClasses(group, rowClasses);
	const labelNode = group.querySelector('.property-label');
	labelNode.textContent = label;
	children.forEach((child) => group.appendChild(child));
	// A label plus one control is a property row (R1/R2), never a set.
	const options = children[0]?.querySelectorAll?.('.segmented-option')?.length || 0;
	const isWide = options === 0 || options > 2 || children.length > 1;
	if (isWide) group.classList.add('is-stacked');
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
	const meta = info.querySelectorAll('.asset-info-meta .property-value');
	if (options.compact) {
		info.querySelector('.asset-info-meta')?.remove();
	} else {
		if (options.redesign) {
			const details = info.querySelector('.asset-info-details');
			const metaRow = info.querySelector('.asset-info-meta');
			if (details && metaRow) details.appendChild(metaRow);
		}
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
		source.querySelector('.property-color-row').before(imageInfo);
	}
	const assetInfo = buildAssetInfo({
		info: `${assetPrefix}Info`,
		thumbnail: slot.assetIds?.thumbnail || `${assetPrefix}Chip`,
		name: slot.assetIds?.name || `${assetPrefix}Label`,
		badges: slot.assetIds?.badges || `${assetPrefix}Badges`,
		change: slot.assetIds?.change || `${assetPrefix}Change`,
		size: slot.assetIds?.size || `${assetPrefix}Size`,
		frames: slot.assetIds?.frames || `${assetPrefix}Frames`,
		redesign: slot.redesign,
		title: slot.chipTitle,
		hidden: slot.activeMode !== 'glitter',
		glitterSource: true
	});
	source.querySelector('.property-color-row').before(assetInfo);
	const sourceEntries = slot.modes.map((mode) => ({
		id: panelRoleId(prefix, `source${panelCap(mode)}`),
		label: slot.modeLabels?.[mode] || panelCap(mode),
		active: mode === slot.activeMode,
		mode
	}));
	const sourceChoices = slot.sourceSelect
		? buildSelectProxy(sourceEntries, { label: `${slot.title} source` })
		: buildSegmented(sourceEntries);
	if (!slot.sourceSelect) sourceChoices.classList.add('choice-grid');
	if (slot.sourceSelect) {
		const sourceRow = buildOptionGroup(slot.sourceLabel || 'Source', [sourceChoices]);
		sourceRow.classList.remove('is-stacked');
		const hooks = sourceRow.querySelector('.property-select-hooks');
		if (hooks) {
			hooks.remove();
			source.prepend(hooks);
		}
		source.prepend(sourceRow);
	} else {
		source.prepend(sourceChoices);
	}
	const colorRow = source.querySelector('.property-color-row');
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
function buildPrimaryRow(prefix, ids = {}, redesign = false) {
	const row = tplClone('tpl-two-column');
	row.classList.add('paint-slot-primary-row');
	row.appendChild(buildSliderRow({ id: ids.scale || `${prefix}Scale`, rowId: ids.scaleRow, slider: 'textureScale', label: redesign ? 'Scale' : null, extraClass: 'paint-slot-scale', role: 'texture-scale' }));
	row.appendChild(buildSliderRow({ id: ids.opacity || `${prefix}Opacity`, rowId: ids.opacityRow, slider: 'slotOpacity', extraClass: 'paint-slot-opacity', role: 'slot-opacity' }));
	return row;
}

// Rule D, tier 2: a set-scoped reset lives at the right edge of the set's own
// label, never as a full-width button of its own. `reset` supplies the id and
// wording; the affordance itself is identical everywhere.
function buildAdvancedControlGroup(title, className, reset = null) {
	const group = panelDiv(`property-set ${className}`);
	const heading = panelDiv('property-set-label');
	heading.textContent = title;
	if (reset) {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'property-revert property-set-reset';
		button.id = reset.id;
		button.title = reset.title || 'Reset to default';
		button.setAttribute('aria-label', reset.title || `Reset ${title}`);
		button.appendChild(createIcon('undo'));
		heading.classList.add('has-set-reset');
		heading.appendChild(button);
	}
	group.appendChild(heading);
	return group;
}

// Advanced = grouped color adjustment, then optional texture coordinates.
function buildAdvancedDisclosure(prefix, ids = {}, options = {}) {
	const advanced = tplClone('tpl-advanced');
	if (options.label) advanced.querySelector('.advanced-disclosure-label').textContent = options.label;
	const content = advanced.querySelector('[data-advanced-content]');
	const colorGroup = buildAdvancedControlGroup('Color adjust', 'advanced-color-adjust-group');
	colorGroup.appendChild(buildSliderRow({ id: ids.hue || `${prefix}Hue`, slider: 'hue' }));
	colorGroup.appendChild(buildSliderRow({ id: ids.saturation || `${prefix}Saturation`, slider: 'saturation' }));
	colorGroup.appendChild(buildSliderRow({ id: ids.brightness || `${prefix}Brightness`, slider: 'brightness' }));
	content.appendChild(colorGroup);

	if (options.texturePosition) {
		const textureGroup = buildAdvancedControlGroup('Texture position', 'advanced-texture-position-group', {
			id: `${prefix}ResetTexturePosition`,
			label: 'Reset',
			title: 'Reset texture anchor and offset'
		});
		const anchor = buildSegmented([
			{ id: `${prefix}TextureAnchorArtwork`, label: 'Artwork', active: true },
			{ id: `${prefix}TextureAnchorCanvas`, label: 'Canvas' }
		], { label: 'Texture anchor' });
		textureGroup.appendChild(buildOptionGroup('Anchor', [anchor]));
		textureGroup.appendChild(buildPairRow({
			label: 'Offset',
			items: [
				{ id: `${prefix}TextureOffsetX`, slider: 'textureOffsetX', mark: 'X', label: 'Offset X' },
				{ id: `${prefix}TextureOffsetY`, slider: 'textureOffsetY', mark: 'Y', label: 'Offset Y' }
			]
		}));
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
	if (slot.redesign) card.dataset.collapsible = '';
	card.dataset.slot = slot.slot;
	card.dataset.role = 'paint-slot';
	if (slot.hidePrimaryModes?.length) card.dataset.hidePrimaryModes = slot.hidePrimaryModes.join(' ');
	const header = card.querySelector('.subsection-title');
	const title = header.querySelector(':scope > span');
	title.textContent = slot.title;
	if (slot.redesign) {
		const swatch = panelDiv('property-module-swatch');
		header.insertBefore(swatch, title);
	}
	let container = card;
	if (slot.toggle) {
		card.dataset.effectCard = '';
		const toggle = tplClone('tpl-checkbox');
		// R5: the enable control leads the module header as the shared compact
		// header switch.
		toggle.classList.add('effect-switch');
		toggle.title = `Enable ${slot.title}`;
		const input = toggle.querySelector('input');
		input.id = `${slot.idPrefix}Enabled`;
		input.dataset.effectToggle = '';
		input.setAttribute('aria-label', `Enable ${slot.title}`);
		toggle.querySelector('span').textContent = 'Enabled';
		header.appendChild(toggle);
		container = panelDiv('property-module-content');
		container.id = `${slot.idPrefix}Controls`;
		card.appendChild(container);
	} else if (slot.redesign && slot.modes.includes('none')) {
		const toggle = tplClone('tpl-checkbox');
		toggle.classList.add('effect-switch', 'paint-slot-enable');
		toggle.title = `Enable ${slot.title}`;
		const input = toggle.querySelector('input');
		input.checked = slot.activeMode !== 'none';
		input.dataset.paintSlotToggle = '';
		input.setAttribute('aria-label', `Enable ${slot.title}`);
		toggle.querySelector('span').textContent = 'Enabled';
		input.addEventListener('change', () => {
			const mode = input.checked ? (card._lastPaintMode || 'glitter') : 'none';
			card.querySelector(`.segmented-option[data-mode="${mode}"]`)?.click();
		});
		header.appendChild(toggle);
	}
	const main = panelDiv('paint-slot-main');
	container.appendChild(main);
	(slot.pre || []).forEach((item) => main.appendChild(buildPanelItem(item)));
	const source = buildPaintSource(slot);
	// R5: Source is a property of the module, so it reads as a row - the old
	// titled option group added a heading level for a single control.
	source.classList.add('paint-slot-source');
	if (slot.sourceLabel && !slot.sourceSelect) {
		// The same component as every other set label, not a lookalike.
		const label = panelDiv('property-set-label paint-slot-source-label');
		label.textContent = slot.sourceLabel;
		source.prepend(label);
	}
	main.appendChild(source);
	(slot.afterSource || []).forEach((item) => main.appendChild(buildPanelItem(item)));
	const primaryRow = buildPrimaryRow(slot.idPrefix, slot.primaryIds, slot.redesign);
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
	const advanced = buildAdvancedDisclosure(slot.idPrefix, slot.advancedIds, {
		texturePosition: slot.texturePosition
	});
	if (slot.advancedStyle === 'flat') {
		const flat = panelDiv('paint-slot-advanced-flat glitter-source-glitter');
		flat.append(...advanced.querySelector('[data-advanced-content]').children);
		container.appendChild(flat);
	} else {
		container.appendChild(advanced);
	}
	return card;
}

function buildPanelItem(item, schema) {
	switch (item.kind) {
		case 'card': {
			const card = tplClone('tpl-card');
			if (item.bare) card.classList.remove('subsection-content-group', 'property-card');
			if (item.id) card.id = item.id;
			if (item.hidden) card.hidden = true;
			// Opt-in collapsibility (rule E). Without this the block renders as a
			// plain titled run of rows; editor-disclosures only stamps a chevron
			// on blocks that ask for one or carry an effect toggle.
			if (item.collapsible) card.dataset.collapsible = '';
			if (item.moduleSummary) card.dataset.moduleSummaryType = item.moduleSummary;
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
				toggle.classList.add('effect-switch');
				toggle.title = item.toggle.title || `Enable ${item.title || ''}`.trim();
				const input = toggle.querySelector('input');
				input.id = item.toggle.id;
				input.dataset.effectToggle = '';
				input.setAttribute('aria-label', toggle.title || item.toggle.label);
				toggle.querySelector('span').textContent = item.toggle.label;
				if (item.toggle.title) toggle.querySelector('span').title = item.toggle.title;
				card.querySelector('.subsection-title').appendChild(toggle);
			}
			const body = panelDiv('subsection-card-body');
			if (item.bare) body.classList.add('subsection-card-body-bare');
			const edgeChildren = [];
			item.items.forEach((child) => {
				const node = buildPanelItem(child, schema);
				// Advanced is an edge-to-edge card footer, not padded body content.
				// Keeping that structural contract here means every future schema card
				// receives the same spacing without a feature-specific selector.
				if (node.classList?.contains('advanced-disclosure')) edgeChildren.push(node);
				else body.appendChild(node);
			});
			card.appendChild(body);
			edgeChildren.forEach((node) => card.appendChild(node));
			return card;
		}
		case 'content': {
			const content = addPanelClasses(panelDiv('subsection-content'), item.classes);
			if (item.id) content.id = item.id;
			if (item.hidden) content.hidden = true;
			item.items.forEach((child) => content.appendChild(buildPanelItem(child, schema)));
			return content;
		}
		// R4. A boolean reads as a labelled switch on its own row, not as a
		// full-width uppercase pill - the pill made every toggle shout louder
		// than the properties around it.
		case 'checkboxList': {
			const content = panelDiv('property-toggle-list');
			if (item.label) {
				const label = panelDiv('property-group-label');
				label.textContent = item.label;
				content.appendChild(label);
			}
			item.items.forEach((entry) => {
				const row = tplClone('tpl-toggle-row');
				const input = row.querySelector('input');
				input.id = entry.id;
				input.checked = Boolean(entry.checked);
				const label = row.querySelector('.property-label');
				label.textContent = entry.label;
				if (entry.title) label.title = entry.title;
				content.appendChild(row);
			});
			return content;
		}
		case 'actionRow': {
			const row = addPanelClasses(panelDiv('property-actions'), item.classes);
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
		case 'pair':
			return buildPairRow(item);
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
			return buildOptionGroup(item.label, [child], item.rowClasses);
		}
		case 'segmented': {
			const group = buildSegmented(item.options, item);
			return item.visibleLabel ? buildOptionGroup(item.visibleLabel, [group], item.rowClasses) : group;
		}
		case 'select': {
			const select = document.createElement('select');
			select.id = item.id;
			addPanelClasses(select, item.classes);
			select.setAttribute('aria-label', item.label || item.visibleLabel);
			item.options.forEach((entry) => {
				const option = document.createElement('option');
				option.value = entry.value;
				option.textContent = entry.label;
				option.selected = Boolean(entry.selected || entry.active);
				select.appendChild(option);
			});
			return item.visibleLabel ? buildOptionGroup(item.visibleLabel, [select], item.rowClasses) : select;
		}
		case 'textarea': {
			const textarea = document.createElement('textarea');
			textarea.id = item.id;
			textarea.rows = item.rows || 4;
			if (item.maxlength) textarea.maxLength = item.maxlength;
			if (item.placeholder) textarea.placeholder = item.placeholder;
			addPanelClasses(textarea, item.controlClasses);
			if (!item.classes) return textarea;
			const wrapper = addPanelClasses(panelDiv('property-inset'), item.classes);
			wrapper.appendChild(textarea);
			return wrapper;
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
			return buildAdvancedDisclosure(item.prefix || schema.prefix, item.ids, { label: item.label });
		case 'stackRow': {
			const row = tplClone('tpl-two-column');
			row.classList.add('effect-stack-row');
			item.groups.forEach((group) => {
				const control = group.control === 'select'
					? buildSelectProxy(group.options, { label: group.label })
					: buildSegmented(group.options);
				const optionRow = buildOptionGroup(group.label, [control]);
				if (group.control === 'select') optionRow.classList.remove('is-stacked');
				row.appendChild(optionRow);
			});
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
		default:
			throw new Error(`panel-renderer: unknown item kind "${item.kind}"`);
	}
}

// R5: a module row states what it is currently set to, so a collapsed effect
// is still readable ("Sparkle Pink - 80%") without expanding it. Managers write
// their values straight into the DOM without firing events, so the summary
// mirrors the card's own nodes through an observer rather than trying to hook
// every manager's sync path.
function buildModuleSummary(card) {
	if (!card || card.querySelector(':scope > .subsection-title > .property-module-summary')) return null;
	const title = card.querySelector(':scope > .subsection-title');
	if (!title) return null;
	const summary = document.createElement('span');
	summary.className = 'property-module-summary';
	summary.setAttribute('aria-hidden', 'true');
	const chevron = title.querySelector('.subsection-chevron');
	title.insertBefore(summary, chevron || null);
	return summary;
}

function readModuleSummary(card) {
	if (card.dataset.moduleSummaryType === 'asset') {
		return card.querySelector('.asset-info-name')?.textContent?.trim() || '';
	}
	// A disabled module shows no summary: the switch beside the title already
	// states the on/off condition, and an "Off" label that vanishes the moment
	// you expand a still-disabled module contradicts itself.
	const toggle = card.querySelector(':scope > .subsection-title input[data-effect-toggle]');
	if (toggle && !toggle.checked) return '';
	const mode = card.dataset.paintMode || card.querySelector('.segmented-option.active[data-mode]')?.dataset.mode || '';
	const parts = [];
	if (mode === 'none') return 'None';
	if (mode === 'glitter') {
		if (card.dataset.slot === 'fill') {
			const name = card.querySelector('.asset-info:not([hidden]) .asset-info-name')?.textContent?.trim();
			if (name) parts.push(name);
		} else {
			parts.push('Glitter');
		}
	} else if (mode === 'solid') {
		parts.push('Solid');
	} else if (mode === 'gradient') {
		parts.push('Gradient');
	}
	const opacity = card.querySelector('.paint-slot-opacity .property-value')?.textContent?.trim();
	if (opacity && opacity !== '100%') parts.push(opacity);
	return parts.join(' · ');
}

function syncModuleSummary(card) {
	const summary = card.querySelector(':scope > .subsection-title > .property-module-summary');
	if (!summary) return;
	const text = readModuleSummary(card);
	if (summary.textContent !== text) summary.textContent = text;
	const swatch = card.querySelector(':scope > .subsection-title > .property-module-swatch');
	if (swatch) {
		const source = card.querySelector('.asset-info:not([hidden]) .asset-info-thumbnail');
		const solid = card.querySelector('.property-color-row:not([hidden]) input[type="color"]');
		swatch.style.background = solid?.value || source?.style.background || source?.style.backgroundImage || '';
	}
}

function initializeModuleSummaries(root = document) {
	root.querySelectorAll('[data-role="paint-slot"][data-effect-card], [data-role="paint-slot"][data-collapsible], [data-module-summary-type]').forEach((card) => {
		if (card.dataset.moduleSummary !== undefined) return;
		card.dataset.moduleSummary = '';
		buildModuleSummary(card);
		syncModuleSummary(card);
		let queued = false;
		const observer = new MutationObserver(() => {
			if (queued) return;
			queued = true;
			requestAnimationFrame(() => {
				queued = false;
				syncModuleSummary(card);
			});
		});
		observer.observe(card, {
			childList: true, subtree: true, characterData: true,
			attributes: true, attributeFilter: ['hidden', 'data-paint-mode', 'value', 'checked', 'class']
		});
		card.addEventListener('change', () => syncModuleSummary(card));
	});
}

function initializeScrollBoundaryFades(root = document) {
	root.querySelectorAll('.text-font-picker').forEach((scrollbox) => {
		if (scrollbox.dataset.scrollBoundaryFade !== undefined) return;
		scrollbox.dataset.scrollBoundaryFade = '';
		const update = () => {
			const remaining = scrollbox.scrollHeight - scrollbox.clientHeight - scrollbox.scrollTop;
			scrollbox.classList.toggle('has-overflow-bottom', remaining > 1);
		};
		scrollbox.addEventListener('scroll', update, { passive: true });
		new MutationObserver(update).observe(scrollbox, { childList: true });
		if (typeof ResizeObserver === 'function') new ResizeObserver(update).observe(scrollbox);
		update();
	});
}

// Rule A, applied mechanically instead of case by case: a block whose title
// only repeats the label of its single control drops the title. The row's own
// label already names it, so keeping both produced the "Opacity > Opacity 100%"
// stutter. Blocks that carry an effect toggle or are collapsible keep their
// title - it is the host for those controls.
function dedupeBlockTitle(card) {
	if (!card?.classList?.contains('subsection-content-group')) return card;
	if (card.classList.contains('subsection-section-group') || card.classList.contains('effects-stack')) return card;
	if (card.dataset.effectCard !== undefined || card.dataset.collapsible !== undefined) return card;
	const title = card.querySelector(':scope > .subsection-title');
	if (!title || title.querySelector('input, button, select')) return card;
	const rows = card.querySelectorAll('.property-row, .property-pair-group > .property-row');
	if (rows.length !== 1) return card;
	const controls = card.querySelectorAll('input, select, textarea');
	if (controls.length !== 1) return card;
	const titleText = (title.querySelector(':scope > span') || title).textContent.trim().toLowerCase();
	const rowLabel = rows[0].querySelector('.property-label')?.textContent.trim().toLowerCase();
	if (!titleText || titleText !== rowLabel) return card;
	title.remove();
	card.classList.remove('has-subsection-title');
	return card;
}

// Legacy/template cards predate the schema body's padding ownership. Normalize
// them to the same structure without pulling edge-to-edge Advanced disclosures
// into the padded body.
function ensureSubsectionCardBody(card) {
	if (!card?.classList?.contains('subsection-content-group')) return card;
	if (card.classList.contains('subsection-section-group') || card.classList.contains('effects-stack')) return card;
	if (card.querySelector(':scope > .subsection-card-body, :scope > .paint-slot-main, :scope > .property-module-content')) return card;
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
	card.querySelector(':scope > .property-module-content')?.classList.toggle('visible', next);
}

// Availability is separate from enablement: a card can retain enabled state
// while its source type makes the effect temporarily inapplicable. The group
// and its shared actions disappear when none of its effect cards are usable.
function syncPanelEffectAvailability(card, available) {
	if (!card) return;
	card.hidden = !available;
	const group = card.closest('[data-effect-group]');
	if (!group) return;
	group.hidden = !Array.from(group.querySelectorAll(':scope > .panel-group-content > .panel-group-blocks > [data-effect-card]'))
		.some((effectCard) => !effectCard.hidden);
}

function initializePanelGroupNode(node, prefix, title, { collapsible = true } = {}) {
	const header = node.querySelector('.subsection-title');
	const label = document.createElement('span');
	label.className = 'panel-group-label';
	if (node.closest('.panel-redesign')) label.classList.add('property-group-label');
	label.textContent = title;
	header.appendChild(label);
	if (!collapsible) return { header, chevron: null };
	node.dataset.collapsibleGroup = '';
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
	const { header, chevron } = initializePanelGroupNode(node, schema.prefix, group.title, { collapsible: group.collapsible !== false });
	if (group.toggle) {
		const toggle = tplClone('tpl-checkbox');
		toggle.querySelector('input').id = group.toggle.id;
		toggle.querySelector('span').textContent = group.toggle.label;
		header.appendChild(toggle);
	}
	if (chevron) header.appendChild(chevron);
	node.dataset.panelGroup = group.title;
	const content = panelDiv('panel-group-content');
	const blocks = panelDiv('panel-group-blocks');
	const actions = [];
	group.items.forEach((item) => {
		const child = buildPanelItem(item, schema);
		if (child.classList?.contains('property-actions')) actions.push(child);
		else blocks.appendChild(child);
	});
	// Keep the block host even when the schema starts empty. Some groups (for
	// example Appearance) adopt controls after the transform panel is rendered.
	// A stable host lets that composition work without special-case placement.
	content.appendChild(blocks);
	actions.forEach((action) => content.appendChild(action));
	node.appendChild(content);
	if (blocks.querySelector(':scope > [data-effect-card]')) node.dataset.effectGroup = '';
	return node;
}

function renderPanelSection(schema) {
	const host = document.getElementById(schema.section.id);
	if (!host) return;
	addPanelClasses(host, schema.section.classes);
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
		const stack = buildPanelGroup({ title: 'Effects', collapsible: false, items: schema.effects }, schema);
		stack.classList.add('effects-stack');
		subsection.appendChild(stack);
	}
	if (schema.controls) {
		const content = fragment.querySelector('.section-content');
		const empty = buildPropertyEmpty({ id: schema.controls.emptyId, visible: true, ...schema.controls.empty });
		const controls = document.createElement('div');
		controls.id = schema.controls.id;
		controls.appendChild(subsection);
		content.replaceChildren(empty, controls);
	}
	// Keep generated section chrome before any retained static host content.
	(schema.sourceTemplate ? document.getElementById(schema.sourceTemplate) : host.querySelector(':scope > template'))?.remove();
	host.prepend(fragment);
	initializeScrollBoundaryFades(host);
	if (schema.section.classes?.split(/\s+/).includes('panel-redesign')) {
		host.querySelectorAll('.property-card').forEach((node) => node.classList.add('panel-card'));
		host.querySelectorAll('.subsection-section-group').forEach((node) => node.classList.add('panel-group'));
		host.querySelectorAll('.panel-group-label').forEach((node) => node.classList.add('property-group-label'));
		host.querySelectorAll('.property-row').forEach((node) => node.classList.add('row'));
		host.querySelectorAll('.segmented-control').forEach((node) => node.classList.add('segmented'));
		host.querySelectorAll('.asset-info').forEach((node) => node.classList.add('asset'));
		host.querySelectorAll('.advanced-disclosure').forEach((node) => node.classList.add('disc'));
		host.querySelectorAll('.property-actions').forEach((node) => node.classList.add('panel-actions'));
		host.querySelectorAll('.paint-slot-card').forEach((node) => node.classList.add('panel-module'));
		initializeEditablePropertyValues(host);
	}
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

function redesignTransformFragment(fragment) {
	const card = fragment.querySelector('[data-transform-card]');
	const grid = card.querySelector('.transform-grid');
	const header = card.querySelector('.transform-panel-title');
	const actions = fragment.querySelector('[data-transform-actions]');
	const [position, size, rotation, align, flip] = grid.querySelectorAll(':scope > .property-set');
	const placeholder = () => {
		const node = document.createElement('span');
		node.className = 'property-revert is-placeholder';
		node.setAttribute('aria-hidden', 'true');
		node.appendChild(createIcon('undo'));
		return node;
	};
	const rowLabel = (text) => {
		const node = document.createElement('span');
		node.className = 'property-label';
		node.textContent = text;
		return node;
	};
	const makePairRow = (set, label) => {
		const pair = set.querySelector('.property-pair');
		set.className = 'property-row row is-pair transform-pair-row';
		set.replaceChildren(rowLabel(label), pair, placeholder());
		return set;
	};

	card.classList.add('panel-card', 'panel-module');
	card.dataset.panelRedesign = '';
	card.dataset.collapsible = '';
	const lock = header.querySelector('[data-transform-lock]');
	lock.className = 'property-row row is-toggle transform-lock-row';
	const lockInput = lock.querySelector('input');
	const lockSwitch = lock.querySelector('span');
	lockSwitch.className = 'property-switch';
	lockSwitch.textContent = '';
	lockSwitch.setAttribute('aria-hidden', 'true');
	lock.replaceChildren(rowLabel('Lock aspect ratio'), lockInput, lockSwitch, placeholder());
	header.querySelector('.transform-panel-title-actions').remove();
	const signal = document.createElement('button');
	signal.type = 'button';
	signal.className = 'property-revert transform-revert-signal';
	signal.title = 'Reset transform';
	signal.setAttribute('aria-label', 'Reset transform');
	signal.dataset.transformRevertSignal = '';
	signal.appendChild(createIcon('undo'));
	header.appendChild(signal);

	makePairRow(position, 'Position');
	const scaleRows = panelDiv('transform-scale-rows');
	scaleRows.append(...size.querySelectorAll('[data-transform-scale-readout]'));
	scaleRows.querySelector('.transform-scale-x > .property-label').textContent = 'Scale';
	const sizeRow = makePairRow(size, 'Size');
	sizeRow.dataset.transformRole = 'sizeGroup';
	sizeRow.querySelector('.property-pair').removeAttribute('data-transform-role');
	sizeRow.before(lock);
	sizeRow.after(scaleRows);

	const rotationRow = rotation.querySelector('.property-row');
	rotationRow.classList.add('row');
	rotationRow.querySelector('.property-label').textContent = 'Rotation';
	rotation.replaceWith(rotationRow);

	align.querySelector(':scope > .property-set-label').remove();
	align.querySelectorAll(':scope > .property-row').forEach((row) => {
		row.classList.remove('is-stacked');
		row.classList.add('row');
		row.querySelector('.segmented-control').classList.add('segmented');
		row.appendChild(placeholder());
	});
	const transformGlyphs = {
		alignLeft: 'transformAlignLeft', alignCenterX: 'transformAlignCenterX', alignRight: 'transformAlignRight',
		alignTop: 'transformAlignTop', alignCenterY: 'transformAlignCenterY', alignBottom: 'transformAlignBottom'
	};
	align.querySelectorAll('.segmented-option[data-transform-role]').forEach((button) => {
		const label = button.textContent;
		button.replaceChildren(createDesignPanelGlyph(transformGlyphs[button.dataset.transformRole]));
		button.setAttribute('aria-label', label);
	});

	const flipControl = panelDiv('segmented-control segmented transform-flip-control');
	flip.querySelectorAll('.property-toggle-list > label').forEach((option, index) => {
		const input = option.querySelector('input');
		const visible = option.querySelector('.property-label');
		option.className = 'segmented-option';
		visible.className = '';
		const label = index === 0 ? 'Horizontal' : 'Vertical';
		visible.textContent = '';
		visible.appendChild(createDesignPanelGlyph(index === 0 ? 'transformFlipX' : 'transformFlipY'));
		option.setAttribute('aria-label', label);
		option.replaceChildren(input, visible);
		flipControl.appendChild(option);
	});
	flip.className = 'property-row row';
	flip.replaceChildren(rowLabel('Flip'), flipControl, placeholder());

	actions.classList.add('panel-actions');
	card.appendChild(actions);
	fragment.querySelector('[data-transform-opacity] .property-row')?.classList.add('row');
}

function buildTransformPanel(editor, container, prefix, capabilities) {
	const ids = editor.getTransformIds(prefix);
	const fragment = document.getElementById('tpl-transform-panel').content.cloneNode(true);
	fragment.querySelectorAll('.subsection-content-group').forEach((card) => card.classList.add('property-card'));
	const buildNumberPair = (roles, labels, min = null) => {
		const pair = tplClone('tpl-number-pair');
		if (capabilities.panelRedesign) pair.className = 'property-pair sticker-position-group';
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
	fragment.querySelector('[data-transform-number-pair="position"]').replaceWith(buildNumberPair(['posX', 'posY'], ['X', 'Y']));
	const sizePair = buildNumberPair(['sizeWidth', 'sizeHeight'], ['W', 'H'], 1);
	if (!capabilities.panelRedesign) sizePair.dataset.transformRole = 'sizeGroup';
	fragment.querySelector('[data-transform-number-pair="size"]').replaceWith(sizePair);
	if (capabilities.panelRedesign) redesignTransformFragment(fragment);
	const transformCard = fragment.querySelector('[data-transform-card]');
	transformCard.dataset.transformPrefix = prefix;
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
	fragment.querySelector('[data-transform-revert-signal]')?.addEventListener('click', () => {
		document.getElementById(ids.resetTransform)?.click();
	});
	if (!capabilities.lockAspect) fragment.querySelector('[data-transform-lock]').remove();
	if (!capabilities.scaleReadout) fragment.querySelectorAll('[data-transform-scale-readout]').forEach((element) => element.remove());
	container.replaceChildren(fragment);
	if (capabilities.panelRedesign) initializeEditablePropertyValues(container);
}

// Shared schema finalization: retitle the transform and opacity cards, move the
// shared action primitive to the group footer, and settle host card order.
function normalizeTransformPanelHost(editor, prefix) {
	const host = document.getElementById(`${prefix}TransformPanelHost`);
	if (!host) return null;
	const card = (id) => document.getElementById(id)?.closest('.subsection-content-group');
	const ids = editor.getTransformIds(prefix);
	const geometry = host.querySelector(':scope > [data-transform-prefix]');
	const opacity = card(ids.opacity);
	const actions = host.querySelector('[data-transform-actions]');

	const setTitle = (section, label) => {
		const title = section?.querySelector(':scope > .subsection-title');
		if (!title) return;
		const labelNode = title.querySelector(':scope > span');
		if (labelNode) labelNode.textContent = label;
		else title.textContent = label;
	};
	setTitle(geometry, 'Transform');
	// "Layer Opacity", not "Opacity": a fill/effect module already contains its
	// own Opacity, and two controls with the same name a few rows apart read as
	// a duplicate rather than two different scopes.
	setTitle(opacity, 'Layer Opacity');
	const opacityLabel = opacity?.querySelector('.property-label');
	if (opacityLabel) opacityLabel.textContent = 'Layer Opacity';

	[geometry, opacity].filter(Boolean).forEach((section) => host.appendChild(section));
	if (actions && geometry && !geometry.hasAttribute('data-panel-redesign')) host.closest('.panel-group-content')?.appendChild(actions);
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
		const blocks = groupNode?.querySelector(':scope > .panel-group-content > .panel-group-blocks');
		const redesign = schema.section.classes?.split(/\s+/).includes('panel-redesign');
		const opacityRow = opacityCard?.querySelector('.property-row');
		if (redesign && blocks && opacityRow) {
			opacityRow.querySelector('.property-label').textContent = 'Opacity';
			blocks.appendChild(opacityRow);
			opacityCard.remove();
		} else if (blocks && opacityCard) blocks.appendChild(opacityCard);
	});
}

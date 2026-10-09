'use strict';

// Sidebar panel renderer. Clones the tpl-*
// <template> primitives in index.html per PANEL_SCHEMAS (ui/panel-schemas.js) and
// stamps ids, labels, and slider ranges (FIELDS, js/core/fields.js). Renders ONCE at
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

// Panel schemas can attach the same maturity marker to any titled feature.
// A string is the common shorthand; the object form allows display text and
// the styling variant to diverge without adding renderer branches.
function buildFeatureBadge(config) {
	const options = typeof config === 'string' ? { label: panelCap(config), variant: config } : config;
	const badge = document.createElement('span');
	badge.className = 'feature-badge';
	if (options.variant) badge.classList.add(`feature-badge-${options.variant}`);
	badge.textContent = options.label;
	return badge;
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

// Panel glyphs (segmented-control align / flip / distribute) ride the shared
// #icon-* sprite like every other icon. Schemas name a bare sprite key
// (`icon: 'align-left'`); createIcon adds the `icon-` prefix. Thin wrapper kept
// as the single seam these call sites route through.
function createPanelGlyph(name) {
	return createIcon(name.startsWith('icon-') ? name.slice(5) : name);
}

const TRANSFORM_ID_GRAMMAR = Object.freeze({
	posX: '{p}PosX',
	posY: '{p}PosY',
	anchorSelect: '{p}TransformAnchor',
	resetAnchor: 'reset{P}TransformAnchor',
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
	resetFlip: 'reset{P}Flip',
	alignLeft: '{p}AlignLeft',
	alignCenterX: '{p}AlignCenterX',
	alignRight: '{p}AlignRight',
	alignTop: '{p}AlignTop',
	alignCenterY: '{p}AlignCenterY',
	alignBottom: '{p}AlignBottom',
	resetTransform: 'reset{P}Transform'
});

// Per-prefix id overrides for the transform grammar. Empty since the v2 opacity
// model removed the transform-panel opacity control (its text-only id override).
const TRANSFORM_ID_EXCEPTIONS = Object.freeze({});

function getPanelTransformIds(prefix) {
	// Every type's transform card has its own ids; an unknown prefix reads the
	// text card's.
	const declared = Object.values(LayerType).some((type) => LAYER_UI_CONFIG[type]?.transformPrefix === prefix);
	const normalizedPrefix = declared ? prefix : 'text';
	const capitalized = panelCap(normalizedPrefix);
	return Object.fromEntries(Object.entries(TRANSFORM_ID_GRAMMAR).map(([role, pattern]) => [
		role,
		TRANSFORM_ID_EXCEPTIONS[normalizedPrefix]?.[role]
			|| pattern.replaceAll('{p}', normalizedPrefix).replaceAll('{P}', capitalized)
	]));
}

function panelRoleId(prefix, role) {
	return prefix + PANEL_ROLES.paintSlot[role];
}

// Every control a spec is applied to carries its default and unit
// (`data-default`, `data-unit`), so rule D's "revert is inert at default" and
// the readout unit hold for every slider without a registry beside the DOM.
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
	input.dataset.default = String(spec.value);
	input.dataset.unit = spec.unit ?? '';
	if (spec.typeMin != null) input.dataset.typeMin = String(spec.typeMin);
	if (spec.typeMax != null) input.dataset.typeMax = String(spec.typeMax);
}

// The revert target for a slider: normally its registered default, but the mask
// brush's Size/Spacing follow the active raster tip's manifest value instead.
function panelSliderDefault(id) {
	const brushDefault = window.editor?.maskEditor?.rasterSliderDefault?.(id);
	if (brushDefault !== undefined) return brushDefault;
	const stamped = document.getElementById(id)?.dataset.default;
	return stamped !== undefined ? Number(stamped) : undefined;
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
	// The non-slider rows that opted into a revert (Mode/Style/Case/Source/Solid
	// Color/Edges/Placement/Layering) are driven by managers that write the DOM
	// without firing an event, so they lean on this same sweep to re-evaluate.
	root.querySelectorAll('.property-option-revert').forEach((button) => button._syncOptionRevert?.());
}

// Rule D for the option rows that opt in via a schema `revert` flag. "Default"
// is whatever the schema rendered active/selected - and for a multi-toggle like
// text Style, no option active is itself the default. Revert replays the same
// gesture a click would, so each manager's existing change handler still records
// the history entry. Handles a <select> (including buildSelectProxy's), a
// .segmented-control, or a bare color input.
function attachOptionRevert(row, control, spec = {}) {
	if (spec.model) {
		const button = spec.button || buildFieldRevert(spec.roleId);
		if (!spec.button) row.appendChild(button);
		const sync = () => { button.disabled = spec.model.isDefault(); };
		button.dataset.revertBound = '';
		button.addEventListener('click', () => { spec.model.reset(); sync(); });
		sync();
		return sync;
	}
	const select = control.tagName === 'SELECT' ? control : control.querySelector?.('select');
	const color = !select && control.matches?.('input[type="color"]') ? control : null;
	const segmented = select || color ? null
		: (control.classList?.contains('segmented-control') ? control : control.querySelector?.('.segmented-control'));
	if (!select && !color && !segmented) return;

	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'property-revert property-option-revert';
	button.dataset.revertBound = '';
	button.dataset.role = `${spec.roleId || 'option'}-reset`;
	button.title = 'Reset to default';
	button.setAttribute('aria-label', `Reset ${spec.label || 'option'}`);
	button.appendChild(createIcon('reset'));
	row.appendChild(button);

	const options = spec.options || [];
	let defaultValue = '';
	if (select) {
		const chosen = options.find((option) => option.selected || option.active) || options[0];
		defaultValue = String(chosen?.value ?? chosen?.mode ?? '');
	} else if (color) {
		defaultValue = String(spec.defaultValue ?? control.getAttribute('value') ?? control.value).toLowerCase();
	} else {
		Array.from(segmented.querySelectorAll('.segmented-option')).forEach((option, index) => {
			if (options[index]?.active) option.dataset.defaultActive = '';
		});
	}

	const isDefault = () => {
		if (select) return String(select.value) === defaultValue;
		if (color) return String(control.value).toLowerCase() === defaultValue;
		return Array.from(segmented.querySelectorAll('.segmented-option'))
			.every((option) => (option.dataset.defaultActive !== undefined) === option.classList.contains('active'));
	};
	const sync = () => { button.disabled = isDefault(); };
	button._syncOptionRevert = sync;

	button.addEventListener('click', () => {
		if (isDefault()) return;
		if (select) {
			select.value = defaultValue;
			select.dispatchEvent(new Event('change', { bubbles: true }));
		} else if (color) {
			control.value = defaultValue;
			control.dispatchEvent(new Event('input', { bubbles: true }));
			control.dispatchEvent(new Event('change', { bubbles: true }));
		} else {
			// Single-select groups (Mode, Edges, Layering, Anchor): click the one
			// default option and let the manager's own radio behaviour clear the
			// rest - clicking the others too would re-fire their handlers and, if a
			// manager mutates synchronously before awaiting, re-apply what we just
			// reverted. Multi-toggles (text Style) have no default-active option, so
			// there we do clear every active one.
			const opts = Array.from(segmented.querySelectorAll('.segmented-option'));
			const wanted = opts.filter((o) => o.dataset.defaultActive !== undefined);
			if (wanted.length) {
				wanted.filter((o) => !o.classList.contains('active')).forEach((o) => o.click());
			} else {
				opts.filter((o) => o.classList.contains('active')).forEach((o) => o.click());
			}
		}
		requestAnimationFrame(sync);
	});

	(select || color || segmented).addEventListener('change', () => requestAnimationFrame(sync));
	if (color) color.addEventListener('input', () => requestAnimationFrame(sync));
	const watched = segmented || control.querySelector?.('.property-select-hooks') || select || color;
	if (watched) new MutationObserver(sync).observe(watched, { subtree: true, attributes: true, attributeFilter: ['class', 'value'] });
	sync();
}

// A `.property-revert[data-revert-for][data-revert-value]` button (from
// buildFieldRevert with a static default) — restore its target and light the
// button when the value differs. One target id or a space-separated list.
function syncFieldRevert(button) {
	if (button.dataset.revertValue === undefined) return;
	const wanted = button.dataset.revertValue;
	const at = (id) => {
		const el = document.getElementById(id);
		if (!el) return true;
		if (el.type === 'checkbox') return String(el.checked) === wanted;
		// A typed "5.0" is still the default 5; an empty field is not 0.
		if ((el.type === 'number' || el.type === 'range') && el.value !== '' && wanted !== '') return Number(el.value) === Number(wanted);
		return String(el.value) === wanted;
	};
	button.disabled = button.dataset.revertFor.split(/\s+/).filter(Boolean).every(at);
}

function syncFieldReverts(root = document) {
	root.querySelectorAll('.property-revert[data-revert-for][data-revert-value]').forEach(syncFieldRevert);
}

function initializePropertyReverts(root = document) {
	syncPropertyReverts(root);
	syncFieldReverts(root);
	if (initializePropertyReverts.bound) return;
	initializePropertyReverts.bound = true;
	document.addEventListener('input', (event) => {
		if (event.target.matches?.('input[type="range"][id]')) syncPropertyRevert(event.target);
	});
	document.addEventListener('change', (event) => {
		if (event.target.matches?.('input[type="range"][id]')) syncPropertyRevert(event.target);
		// A static-default field changed — re-evaluate any revert that targets it.
		const id = event.target.id;
		if (id) document.querySelectorAll(`.property-revert[data-revert-for~="${id}"][data-revert-value]`).forEach(syncFieldRevert);
	});
	// Static-default field reverts (checkboxes, selects, colors built with an
	// explicit default). Dynamic-default ones (canvas W/H) carry no
	// data-revert-value and are handled by their owning manager.
	document.addEventListener('click', (event) => {
		const button = event.target.closest?.('.property-revert[data-revert-for][data-revert-value]');
		if (!button || button.disabled) return;
		event.preventDefault();
		const value = button.dataset.revertValue;
		button.dataset.revertFor.split(/\s+/).filter(Boolean).forEach((id) => {
			const el = document.getElementById(id);
			if (!el) return;
			if (el.type === 'checkbox') el.checked = value === 'true';
			else el.value = value;
			el.dispatchEvent(new Event('input', { bubbles: true }));
			el.dispatchEvent(new Event('change', { bubbles: true }));
		});
		syncFieldRevert(button);
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
	root.querySelectorAll(':is(.property-row, .property-pair-cell) > .property-value').forEach((value) => {
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
		const asPercent = value.dataset.valueScale === 'percent';
		value.setAttribute('aria-valuemin', asPercent ? '0' : (input.dataset.typeMin || input.dataset.scaleMin || input.min));
		value.setAttribute('aria-valuemax', asPercent ? '100' : (input.dataset.typeMax || input.dataset.scaleMax || input.max));
		// Keys (step, Enter, Escape) are the shared numeric listener's (slider.js).
		value.addEventListener('blur', () => commitEditableReadout(value));
	});
}

// Sliders whose range or precision earns a full-width track (R2). Everything
// else uses the compact inline row (R1) - this list is the entire exception.
const PROPERTY_WIDE_SLIDERS = new Set([]);

// One property row (R1): label | control | value | revert. Ids follow the role
// grammar (`{id}Value`, `reset{Id}`); ranges come from FIELDS.
// The boot value text is plain `value+unit` to match the static markup —
// bindSlider swaps in formatUnit markup on first interaction, as it always has.
function buildSliderRow(options) {
	const spec = FIELDS[options.slider];
	const row = tplClone('tpl-slider-row');
	if (options.rowId) row.id = options.rowId;
	if (options.hidden) row.hidden = true;
	if (options.extraClass) row.classList.add(options.extraClass);
	addPanelClasses(row, options.classes);
	row.dataset.role = `${options.role || options.slider}-row`;
	// `valueScale: 'percent'` — the readout is a 0-100% position through the
	// slider's real range (a raw 0.01-0.12 value reads as "45 %").
	if (options.valueScale) row.querySelector('.property-value').dataset.valueScale = options.valueScale;
	const label = row.querySelector('.property-label');
	label.textContent = options.label || spec.label;
	if (options.title) label.title = options.title;
	const value = row.querySelector('.property-value');
	value.id = `${options.id}Value`;
	value.dataset.role = `${options.role || options.slider}-value`;
	const input = row.querySelector('input');
	input.id = options.id;
	applySliderSpec(input, spec);
	value.innerHTML = formatSliderReadout(input, value, spec.value);
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
	row.replaceChildren();
	if (item.rowId) row.id = item.rowId;
	const label = document.createElement('span');
	label.className = 'property-label';
	label.textContent = item.label;
	if (item.title) label.title = item.title;
	row.appendChild(label);

	const pair = panelDiv('property-pair');
	item.items.forEach((entry) => {
		const spec = FIELDS[entry.slider];
		const cell = panelDiv('property-pair-cell');
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
		reset.appendChild(createIcon('reset'));
		cell.appendChild(reset);

		pair.appendChild(cell);
	});
	row.appendChild(pair);
	return row;
}

// A labelled X/Y (or W/H) row of real number inputs - the exact structure the
// transform panel's Position/Size use (tpl-number-pair + .number-field-pair
// inside a .transform-pair-row), so any offset pair reads and behaves the same.
// `revert` (the ids its manager restores) or `resetId` (a button its manager
// binds) adds one shared revert at the row's right edge, outside the fields.
// A revert affordance for a plain (non-slider) field row: the same `.property-revert`
// icon button every panel uses, carrying `data-revert-for` so one delegated
// handler in the owning manager can restore the target(s) to their live default
// and light the button up when the value differs. `target` is one id or a
// space-separated list.
function buildFieldRevert(target, defaultValue) {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'property-revert';
	button.dataset.revertFor = target;
	// A static default → the shared handler in initializePropertyReverts owns it;
	// no default → the owning manager reverts it (dynamic defaults, e.g. canvas
	// W/H that track the current canvas).
	if (defaultValue !== undefined) button.dataset.revertValue = String(defaultValue);
	button.disabled = true;
	button.title = 'Reset to default';
	button.setAttribute('aria-label', 'Reset to default');
	button.appendChild(createIcon('reset'));
	return button;
}

// Editable palette entries share the Layers / Auto Glitter list-row surface.
// Selection is separate from the native picker so a second row click can clear
// selection without opening or dismissing a color editor.
function buildColorListRow({ id, label, coverage, value }) {
	const row = panelDiv('color-list-row list-row');
	const select = document.createElement('button');
	select.type = 'button'; select.className = 'color-list-select list-row-text';
	select.setAttribute('aria-pressed', 'false');
	select.addEventListener('keydown', event => {
		if (event.key !== ' ' && event.key !== 'Enter') return;
		event.preventDefault(); event.stopPropagation();
		if (!event.repeat) select.click();
	});
	const detail = document.createElement('span'); detail.className = 'list-row-meta'; detail.textContent = coverage;
	select.append(detail);
	const control = document.createElement('span'); control.className = 'color-list-control';
	const input = document.createElement('input'); input.type = 'color'; input.id = id; input.value = value; input.setAttribute('aria-label', label);
	const text = document.createElement('input'); text.type = 'text'; text.className = 'color-hex-input'; text.maxLength = 7; text.spellcheck = false; text.value = value; text.setAttribute('aria-label', `Hex ${label.toLowerCase()}`);
	const revert = buildFieldRevert(id, value); revert.setAttribute('aria-label', `Revert ${label.toLowerCase()}`);
	control.append(input, text); row.append(select, control, revert);
	return { row, select, input, text, revert };
}

function buildNumberFieldPair(options) {
	const row = panelDiv('property-row is-pair transform-pair-row');
	if (options.rowId) row.id = options.rowId;
	const label = document.createElement('span');
	label.className = 'property-label';
	label.textContent = options.label;
	if (options.title) label.title = options.title;
	row.appendChild(label);

	const pair = tplClone('tpl-number-pair');
	pair.className = 'property-pair number-field-pair';
	const groups = Array.from(pair.querySelectorAll('.input-group'));
	// One field (document Scale) uses the same boxed `.input-group.horizontal` as
	// the W/H pair above it — just one column instead of two.
	if (options.items.length === 1) {
		pair.classList.add('is-single');
		groups.slice(1).forEach((group) => group.remove());
	}
	options.items.forEach((entry, index) => {
		const spec = entry.slider ? (FIELDS[entry.slider] || {}) : {};
		const group = groups[index];
		const mark = group.querySelector('label');
		const input = group.querySelector('input');
		const suffix = group.querySelector('.input-unit-suffix');
		mark.textContent = entry.mark;
		mark.htmlFor = entry.id;
		mark.classList.add('numeric-scrub-mark');
		input.id = entry.id;
		input.dataset.role = entry.role || entry.slider || 'value';
		if (entry.title) mark.title = entry.title;
		if (entry.min != null) input.min = String(entry.min);
		else if (spec.min != null) input.min = String(spec.min);
		if (entry.max != null) input.max = String(entry.max);
		else if (spec.max != null) input.max = String(spec.max);
		input.step = String(entry.step ?? spec.step ?? 1);
		input.dataset.numericCost = spec.cost || 'style';
		if (entry.inputMode) input.inputMode = entry.inputMode;
		input.setAttribute('aria-label', entry.label || spec.label || entry.mark);
		if (suffix) suffix.textContent = entry.unit ?? spec.unit ?? '';
		if (spec.value != null) input.dataset.default = String(spec.value);
	});
	row.appendChild(pair);

	if (options.revert || options.resetId) {
		const reset = document.createElement('button');
		reset.type = 'button';
		reset.className = 'property-revert';
		if (options.resetId) reset.id = options.resetId;
		if (options.revert) reset.dataset.revertFor = options.revert;
		reset.disabled = true;
		reset.title = options.resetTitle || `Reset ${options.label.toLowerCase()}`;
		reset.setAttribute('aria-label', reset.title);
		reset.appendChild(createIcon('reset'));
		row.appendChild(reset);
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
		if (entry.icon && entry.showLabel) {
			// Glyph beside its word (Portrait / Landscape): the label is visible,
			// so it needs no title or aria-label.
			button.append(createPanelGlyph(entry.icon), entry.label);
		} else if (entry.icon) {
			button.appendChild(createPanelGlyph(entry.icon));
			button.title = entry.label;
			button.setAttribute('aria-label', entry.label);
		} else if (entry.contentTag) {
			// `text` is a short stand-in for the label (B for Bold), shown in
			// the tag that styles it.
			const content = document.createElement(entry.contentTag);
			content.textContent = entry.text || entry.label;
			button.appendChild(content);
			if (entry.text) {
				button.title = entry.label;
				button.setAttribute('aria-label', entry.label);
			}
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
			const toggle = card.querySelector(':scope > .property-card-title input[data-paint-slot-toggle]');
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

function buildOptionGroup(label, children, rowClasses = '', hint) {
	const group = tplClone('tpl-option-group');
	addPanelClasses(group, rowClasses);
	const labelNode = group.querySelector('.property-label');
	labelNode.textContent = label;
	if (hint) labelNode.title = hint;
	children.forEach((child) => group.appendChild(child));
	// A label plus one control is a property row (R1/R2), never a set. A choice
	// control is compact and shares the label's line; anything else, or more
	// than one control, takes the full width under it.
	const compact = children.some((child) => child.matches?.('.segmented-control, select'))
		|| (children.length === 1 && children[0].matches?.('.property-select-control'));
	if (!compact) group.classList.add('is-stacked');
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

// The asset row's button holds a chevron beside its label, so the label is set
// through here rather than with textContent.
function setAssetChangeLabel(button, label) {
	const name = button?.querySelector('.name');
	if (name) name.textContent = label;
}

// The asset row: thumbnail, name and one meta line. The whole row is the
// Change button (it is stretched over the row), so the row never grows.
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
	// "No thumbnail": the chip holds neither a glitter background nor an image.
	// Managers fill it in place, so the chip keeps its own `.is-unset` in step.
	const syncChip = () => chip.classList.toggle('is-unset',
		!chip.classList.contains('glitter-bg') && !chip.querySelector(':scope > img, :scope > svg'));
	syncChip();
	new MutationObserver(syncChip).observe(chip, { childList: true, attributes: true, attributeFilter: ['class'] });
	const name = info.querySelector('.asset-info-name');
	name.id = options.name;
	name.dataset.role = 'asset-name';
	const badges = info.querySelector('.asset-info-badges');
	badges.id = options.badges;
	badges.dataset.role = 'asset-badges';
	const change = info.querySelector('.asset-info-change');
	change.id = options.change;
	change.dataset.role = 'asset-change';
	change.title = options.title || '';
	setAssetChangeLabel(change, options.changeLabel || 'Change');
	const meta = info.querySelectorAll('.asset-info-meta .property-value');
	if (options.compact) {
		info.querySelector('.asset-info-meta')?.remove();
	} else {
		const details = info.querySelector('.asset-info-details');
		const metaRow = info.querySelector('.asset-info-meta');
		if (details && metaRow) details.appendChild(metaRow);
		meta[0].id = options.size;
		meta[1].id = options.frames;
		meta[0].dataset.role = 'asset-size';
		meta[1].dataset.role = 'asset-frames';
	}
	return info;
}

// The paint source of a section: the Source row, then whatever the chosen
// source needs (asset chip, image chip, solid color). It is the section's
// Source set. A flyout section has the room for the sources as tabs. The
// Gradient source's own sets follow it (buildGradientSourceSets).
function buildPaintSource(slot) {
	const prefix = slot.idPrefix;
	const assetPrefix = slot.assetIdPrefix || `${prefix}Glitter`;
	const source = tplClone('tpl-paint-source');
	source.classList.add('property-set', 'paint-slot-source');
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
		title: slot.chipTitle,
		hidden: slot.activeMode !== 'glitter',
		glitterSource: true
	});
	source.querySelector('.property-color-row').before(assetInfo);
	const sourceLabel = slot.sourceLabel || 'Source';
	const sourceEntries = slot.modes.map((mode) => ({
		id: panelRoleId(prefix, `source${panelCap(mode)}`),
		label: slot.modeLabels?.[mode] || panelCap(mode),
		active: mode === slot.activeMode,
		mode
	}));
	if (slot.presentation === 'flyout') {
		source.prepend(buildSegmented(sourceEntries, { label: `${slot.title || sourceLabel} source` }));
		// Tabs carry no row label, so a section with a second source names
		// this one as a set.
		if (slot.sourceLabel) {
			source.setAttribute('role', 'group');
			source.setAttribute('aria-label', slot.sourceLabel);
		}
	} else {
		const sourceChoices = buildSelectProxy(sourceEntries, { label: `${slot.title || sourceLabel} source` });
		const sourceRow = buildOptionGroup(sourceLabel, [sourceChoices]);
		attachOptionRevert(sourceRow, sourceChoices, { options: sourceEntries, roleId: `${prefix}Source`, label: sourceLabel });
		// The option buttons managers bind sit beside the row, not inside it.
		const hooks = sourceRow.querySelector('.property-select-hooks');
		if (hooks) {
			hooks.remove();
			source.prepend(hooks);
		}
		source.prepend(sourceRow);
	}
	const colorRow = source.querySelector('.property-color-row');
	colorRow.id = `${prefix}ColorRow`;
	colorRow.dataset.role = 'solid-color-row';
	colorRow.hidden = slot.activeMode !== 'solid';
	const colorInput = colorRow.querySelector('input');
	colorInput.id = `${prefix}Color`;
	colorInput.dataset.role = 'solid-color';
	colorInput.setAttribute('value', slot.color);
	attachOptionRevert(colorRow, colorInput, { roleId: `${prefix}Color`, label: 'Solid color', defaultValue: slot.color });
	return source;
}

// Canonical paint opacity row. Glitter scale lives with its texture anchor and
// offset controls in Advanced, so every paint section keeps texture geometry
// in one place.
function buildPaintOpacityRow(slot) {
	return buildSliderRow({
		id: slot.ids?.opacity || `${slot.idPrefix}Opacity`, rowId: slot.ids?.opacityRow,
		slider: 'slotOpacity', extraClass: 'paint-slot-opacity', role: 'slot-opacity'
	});
}

// The Gradient source's sets, laid out as the glitter source's are, with no
// set inside a set: Presets (closed until asked for, one remembered state for
// every editor), the stops (the preview bar over its stop table) and the
// Type/Blend/Angle options are sets of the section body; the Smooth blend's
// set joins the section's one Advanced. installEffectGradientEditor binds
// them by `data-gradient-editor`. `owner` names a second paint source, as in
// buildGlitterAdvancedSets.
function buildGradientSourceSets(slot, options = {}) {
	const fragment = document.getElementById('tpl-gradient-editor').content.cloneNode(true);
	const presets = buildPanelSet({ label: 'Presets', collapse: 'closed', rows: [
		{ kind: 'select', label: 'Category', ariaLabel: 'Gradient preset category', options: [] },
		{ kind: 'presetGrid', label: 'Gradient presets', classes: 'property-inset' }
	] }, { prefix: 'gradient' });
	// Gradient-only, through the shared `[data-paint-source-mode]` sync.
	presets.dataset.paintSourceMode = 'gradient';
	presets.hidden = true;
	const parts = {
		presets,
		stops: fragment.querySelector('.gradient-stop-set'),
		options: fragment.querySelector('.effect-gradient-editor'),
		smoothing: fragment.querySelector('.gradient-advanced')
	};
	Object.entries(parts).forEach(([part, set]) => {
		set.dataset.gradientEditor = slot.idPrefix;
		set.dataset.gradientPart = part;
		if (options.owner) set.dataset.paintSlotOwner = options.owner;
	});
	return { body: [parts.presets, parts.stops, parts.options], advanced: parts.smoothing };
}

// A run of built nodes in a `.property-set`. For the renderer's own sets;
// schema sets go through buildPanelSet.
function wrapPropertySet(nodes, classes = '') {
	const set = addPanelClasses(panelDiv('property-set'), classes);
	nodes.forEach((node) => set.appendChild(node));
	return set;
}

// The glitter-only sets of a paint section's Advanced: color adjust, then
// texture coordinates. `.glitter-source-glitter` is what
// syncPaintSlotSourceUI hides for every other source. `owner` names a second
// paint source (Bevel's Shade) whose sets sit in its section's Advanced.
function buildGlitterAdvancedSets(slot, options = {}) {
	const prefix = slot.idPrefix;
	const ids = slot.ids || {};
	const named = (label) => (options.owner ? `${slot.sourceLabel} ${label.toLowerCase()}` : label);
	const buildSet = (label, className) => {
		const set = panelDiv(`property-set glitter-source-glitter ${className}`);
		set.setAttribute('role', 'group');
		set.setAttribute('aria-label', named(label));
		set.hidden = slot.activeMode !== 'glitter';
		if (options.owner) set.dataset.paintSlotOwner = options.owner;
		return set;
	};
	const colorSet = buildSet('Color adjust', 'advanced-color-adjust-group');
	['hue', 'saturation', 'brightness'].forEach((role) => {
		colorSet.appendChild(buildSliderRow({ id: ids[role] || `${prefix}${panelCap(role)}`, slider: role, label: options.owner ? named(FIELDS[role].label) : undefined }));
	});
	colorSet.appendChild(buildActionSet({ actions: [{ id: `${prefix}Recolor`, label: 'Recolor', icon: 'recolor' }] }));
	if (!slot.texturePosition) return [colorSet];

	const textureSet = buildSet('Texture', 'advanced-texture-position-group');
	textureSet.appendChild(buildSliderRow({
		id: ids.scale || `${prefix}Scale`,
		rowId: ids.scaleRow,
		slider: 'textureScale',
		label: named('Scale'),
		extraClass: 'paint-slot-scale',
		role: 'texture-scale'
	}));
	const anchor = buildSegmented([
		{ id: `${prefix}TextureAnchorArtwork`, label: 'Artwork', active: true },
		{ id: `${prefix}TextureAnchorCanvas`, label: 'Canvas' }
	], { label: 'Texture anchor' });
	const anchorRow = buildOptionGroup(named('Anchor'), [anchor]);
	attachOptionRevert(anchorRow, anchor, { options: [{ active: true }, {}], roleId: `${prefix}TextureAnchor`, label: 'Texture anchor' });
	textureSet.appendChild(anchorRow);
	['X', 'Y'].forEach((axis) => {
		textureSet.appendChild(buildSliderRow({ id: `${prefix}TextureOffset${axis}`, slider: `textureOffset${axis}`, label: named(`Offset ${axis}`) }));
	});
	return [colorSet, textureSet];
}

// The one disclosure a section may end with, always labelled "Advanced". It
// holds sets, as the body does. The vacancy observer hides it while every
// set in it is hidden.
function buildAdvancedDisclosure(spec = {}, schema) {
	const advanced = tplClone('tpl-advanced');
	if (spec.id) advanced.id = spec.id;
	const content = advanced.querySelector('[data-advanced-content]');
	(spec.sets || []).forEach((set) => content.appendChild(set instanceof Node ? set : buildPanelSet(set, schema)));
	return advanced;
}

// Section chrome and collapse state are shared by ordinary and paint sections.
function buildPropertyCardToggle(options, title) {
	const toggle = tplClone('tpl-checkbox');
	toggle.classList.add('effect-switch');
	toggle.title = options.title || `Enable ${title || ''}`.trim();
	const input = toggle.querySelector('input');
	if (options.id) input.id = options.id;
	input.setAttribute('aria-label', toggle.title || options.label);
	toggle.querySelector('span').textContent = options.label;
	if (options.title) toggle.querySelector('span').title = options.title;
	return toggle;
}

// A section's title row and empty body.
function buildSectionShell(spec, schema) {
	const card = tplClone('tpl-card');
	if (spec.id) card.id = spec.id;
	if (spec.hidden) card.hidden = true;
	Object.entries(spec.attrs || {}).forEach(([name, value]) => card.setAttribute(name, value));
	// Every titled section collapses (initializeAdvancedDisclosures), and
	// its open state is remembered under this key. `collapsed` starts it
	// closed. A section with an enable switch gets no key: the switch
	// owns its expansion.
	if (spec.title && !spec.toggle) card.dataset.collapseKey = `${schema?.prefix || 'panel'}:${spec.title}`;
	if (spec.collapsed) {
		card.classList.add('is-collapsed');
		card.dataset.collapseDefault = 'closed';
	}
	// `summary: 'asset'` mirrors the section's asset name into its title row.
	if (spec.summary === 'asset') card.dataset.moduleSummaryType = 'asset';
	addPanelClasses(card, spec.classes);
	const title = card.querySelector('.property-card-title');
	if (spec.title) {
		const titleText = title.querySelector(':scope > span');
		titleText.classList.add('property-card-label', 'feature-name');
		titleText.textContent = spec.title;
		if (spec.badge) titleText.appendChild(buildFeatureBadge(spec.badge));
		// `summary: { id, text }` is a readout its manager writes (the project
		// name, the applied style).
		if (spec.summary && spec.summary !== 'asset') {
			card.dataset.titleSummary = '';
			const summary = document.createElement('span');
			summary.className = 'property-card-summary';
			if (spec.summary.id) summary.id = spec.summary.id;
			summary.textContent = spec.summary.text || '';
			title.appendChild(summary);
		}
		if (spec.reset) title.appendChild(buildPanelCardReset(card, spec.title, spec.reset));
	}
	else title.remove();
	if (spec.swatch) title.appendChild(panelDiv('property-card-swatch'));
	if (spec.toggle) {
		card.dataset.effectCard = '';
		card.classList.add('is-off');
		const toggle = buildPropertyCardToggle(spec.toggle, spec.title);
		const input = toggle.querySelector('input');
		input.dataset.effectToggle = '';
		title.appendChild(toggle);
	}
	card.appendChild(panelDiv('property-card-body'));
	return card;
}

// `{ kind: 'section' }`: a title row, then its sets, then at most one
// Advanced. The body holds exactly what the schema lists, in that order.
function buildPanelSection(spec, schema) {
	const card = buildSectionShell(spec, schema);
	const body = card.querySelector(':scope > .property-card-body');
	(spec.sets || []).forEach((set) => body.appendChild(buildPanelSet(set, schema)));
	if (spec.advanced?.length) body.appendChild(buildAdvancedDisclosure({ id: spec.advancedId, sets: spec.advanced }, schema));
	return card;
}

// A second paint source inside a paint section (Bevel's Shade): one set
// holding its own Source row and opacity. It is a paint slot of its own for
// the binder, so it carries the slot hooks a section does.
function buildNestedPaintSet(slot) {
	const set = buildPaintSource(slot);
	set.id = slot.id;
	set.classList.add('paint-slot-card');
	set.dataset.slot = slot.slot;
	set.dataset.role = 'paint-slot';
	set.dataset.nested = '';
	if (!slot.noSlotOpacity) set.appendChild(buildPaintOpacityRow(slot));
	return set;
}

// `{ kind: 'paintSlot' }`: a section whose body is one order for every paint:
// `before` sets (presets), Source and its gradient sets, Opacity directly
// under them (paint first, then shape), the section's own `sets`, then
// Advanced. A paint with no opacity of its own keeps its gradient sets last.
function buildPaintSlotSection(slot, schema) {
	const card = buildSectionShell({
		id: slot.id, title: slot.title, attrs: slot.attrs,
		classes: 'paint-slot-card', swatch: true,
		toggle: slot.toggle ? { id: `${slot.idPrefix}Enabled`, label: 'Enabled' } : null
	}, schema);
	card.dataset.slot = slot.slot;
	card.dataset.role = 'paint-slot';
	if (slot.summaryValue) card.dataset.summaryValue = slot.summaryValue;
	if (slot.hidePrimaryModes?.length) card.dataset.hidePrimaryModes = slot.hidePrimaryModes.join(' ');
	const header = card.querySelector('.property-card-title');
	const body = card.querySelector(':scope > .property-card-body');
	if (slot.toggle) {
		body.id = `${slot.idPrefix}Controls`;
	} else if (slot.modes.includes('none')) {
		const toggle = buildPropertyCardToggle({ label: 'Enabled' }, slot.title);
		toggle.classList.add('paint-slot-enable');
		const input = toggle.querySelector('input');
		input.checked = slot.activeMode !== 'none';
		input.dataset.paintSlotToggle = '';
		input.addEventListener('change', () => {
			// A select source records the last mode itself; tabs leave it to
			// syncPaintSlotSourceUI.
			const mode = input.checked ? (card._lastPaintMode || card.dataset.lastPaintMode || 'glitter') : 'none';
			card.querySelector(`.segmented-option[data-mode="${mode}"]`)?.click();
		});
		header.appendChild(toggle);
	}
	(slot.before || []).forEach((set) => body.appendChild(buildPanelSet(set, schema)));
	body.appendChild(buildPaintSource(slot));
	const gradients = [];
	const addGradient = (paint, options) => {
		if (!paint.modes.includes('gradient')) return [];
		const gradient = buildGradientSourceSets(paint, options);
		gradients.push(gradient.advanced);
		return gradient.body;
	};
	const ownGradient = addGradient(slot);
	if (!slot.noSlotOpacity) body.append(...ownGradient, wrapPropertySet([buildPaintOpacityRow(slot)], 'paint-slot-primary-row'));
	const advanced = (slot.advanced || []).map((set) => buildPanelSet(set, schema));
	advanced.push(...buildGlitterAdvancedSets(slot));
	(slot.sets || []).forEach((set) => {
		if (!set.paint) {
			body.appendChild(buildPanelSet(set, schema));
			return;
		}
		body.append(buildNestedPaintSet(set.paint), ...addGradient(set.paint, { owner: set.paint.id }));
		advanced.push(...buildGlitterAdvancedSets(set.paint, { owner: set.paint.id }));
	});
	if (slot.noSlotOpacity) body.append(...ownGradient);
	advanced.push(...gradients);
	body.appendChild(buildAdvancedDisclosure({ sets: advanced }, schema));
	return card;
}

// A flyout section's switch, repeated on its line and in the window's bar.
// It presses the section's own switch, which stays the one the managers bind.
function buildFlyoutSwitch(card) {
	const source = card.querySelector(':scope > .property-card-title input[type="checkbox"]');
	if (!source) return null;
	const toggle = buildPropertyCardToggle({ label: 'Enabled' }, card.dataset.flyoutTitle);
	toggle.dataset.flyoutSwitchFor = card.id;
	const input = toggle.querySelector('input');
	input.checked = source.checked;
	input.addEventListener('change', () => {
		if (source.checked !== input.checked) source.click();
	});
	return toggle;
}

// `presentation: 'flyout'`: the section is rendered once into its panel's
// flyout host in the window (LibraryWindow shows the open one), and the panel
// keeps one line for it: the section's closed title row. On phones the
// section itself takes the line's place (data-phone-host-for).
function mountFlyoutSection(card, spec, schema) {
	const prefix = schema.sectionPrefix;
	let host = document.getElementById(`${prefix}Flyouts`);
	if (!host) {
		host = panelDiv('settings-subsection flyout-host');
		host.id = `${prefix}Flyouts`;
		document.getElementById('flyoutBody').appendChild(host);
	}
	if (!card.id) card.id = spec.idPrefix ? `${spec.idPrefix}Section` : `${schema.prefix}${panelCap(spec.title)}Section`;
	card.dataset.flyoutKey = spec.slot || spec.title;
	card.dataset.flyoutTitle = spec.title;
	host.appendChild(card);

	const line = tplClone('tpl-card');
	line.classList.add('property-line');
	line.dataset.flyoutFor = card.id;
	line.dataset.phoneHostFor = card.id;
	line.dataset.phoneHostPlace = 'after';
	line.dataset.phoneHostDrawers = '';
	const title = line.querySelector('.property-card-title');
	title.setAttribute('role', 'button');
	title.setAttribute('tabindex', '0');
	title.setAttribute('aria-expanded', 'false');
	title.setAttribute('aria-controls', card.id);
	const label = title.querySelector(':scope > span');
	label.classList.add('property-card-label', 'feature-name');
	label.textContent = spec.title;
	if (spec.badge) label.appendChild(buildFeatureBadge(spec.badge));
	const summary = document.createElement('span');
	summary.className = 'property-card-summary';
	title.appendChild(summary);
	const cardTitle = card.querySelector(':scope > .property-card-title');
	summary.textContent = cardTitle.querySelector(':scope > .property-card-summary')?.textContent || '';
	line.classList.toggle('is-off', card.classList.contains('is-off'));
	if (cardTitle.querySelector(':scope > .property-card-swatch')) title.appendChild(panelDiv('property-card-swatch'));
	// Managers and the summary observer write the section's title row; the
	// line follows it.
	const follow = new MutationObserver(() => syncFlyoutLine(card));
	follow.observe(cardTitle, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] });
	follow.observe(card, { attributes: true, attributeFilter: ['class'] });
	const toggle = buildFlyoutSwitch(card);
	if (toggle) title.appendChild(toggle);
	const chevron = document.createElement('span');
	chevron.className = 'property-card-chevron icon-wrapper';
	chevron.appendChild(createIcon('chevron-right'));
	title.appendChild(chevron);
	return line;
}

// What a flyout section's line and switches show is the section's own state.
function syncFlyoutLine(card) {
	const line = document.querySelector(`.property-line[data-flyout-for="${card.id}"]`);
	if (!line) return;
	const from = (selector) => card.querySelector(`:scope > .property-card-title > ${selector}`);
	const to = (selector) => line.querySelector(`:scope > .property-card-title > ${selector}`);
	to('.property-card-summary').textContent = from('.property-card-summary')?.textContent || '';
	const swatch = from('.property-card-swatch');
	const lineSwatch = to('.property-card-swatch');
	if (swatch && lineSwatch) {
		lineSwatch.style.background = swatch.style.background;
		lineSwatch.classList.toggle('is-unset', swatch.classList.contains('is-unset'));
	}
	line.classList.toggle('is-off', card.classList.contains('is-off'));
	const source = card.querySelector(':scope > .property-card-title input[type="checkbox"]');
	if (source) document.querySelectorAll(`[data-flyout-switch-for="${card.id}"] > input`).forEach((input) => { input.checked = source.checked; });
}

// A set of buttons: `{ actions: [...] }` in a section's `sets` or a group's
// `actions`.
function buildActionSet(set) {
	const row = addPanelClasses(panelDiv('property-set property-actions'), set.classes);
	if (set.id) row.id = set.id;
	if (set.hidden) row.hidden = true;
	Object.entries(set.attrs || {}).forEach(([name, value]) => row.setAttribute(name, value));
	set.actions.forEach((action) => {
		const button = document.createElement('button');
		button.type = 'button';
		// A panel body is the content layer: its buttons are flat, and
		// `primary` marks the one main action of a form.
		button.className = action.primary ? 'btn-flat primary' : 'btn-flat';
		button.id = action.id;
		if (action.command) button.addEventListener('click', () => COMMANDS[action.command]?.run(window.editor));
		if (action.icon) button.appendChild(createIcon(action.icon));
		const name = document.createElement('span');
		name.className = 'name';
		name.textContent = action.label;
		button.appendChild(name);
		if (action.badge) {
			button.appendChild(buildFeatureBadge(action.badge));
		}
		if (action.title) button.title = action.title;
		if (action.disabled) button.disabled = true;
		// `menu: true` → the button opens a choice menu its owner fills
		// (setupMenuPopover). It is built inside its popover root, so
		// opening the menu never re-parents the button.
		if (action.menu) {
			const menu = panelDiv('app-menu app-menu-popover');
			const panel = panelDiv('app-menu-panel');
			panel.hidden = true;
			button.setAttribute('aria-haspopup', 'menu');
			button.setAttribute('aria-expanded', 'false');
			menu.append(button, panel);
			row.appendChild(menu);
			return;
		}
		row.appendChild(button);
	});
	return row;
}

// A collapsible set's name is its toggle (disclosures.js binds
// `[data-set-toggle]`). Its open state is remembered the way a section's is,
// under `prefix:first row id` (or the label where the rows carry no id).
function buildSetToggle(node, set, schema) {
	const toggle = document.createElement('button');
	toggle.type = 'button';
	toggle.className = 'property-set-label';
	toggle.dataset.setToggle = '';
	const chevron = document.createElement('span');
	chevron.className = 'property-set-chevron icon-wrapper';
	chevron.appendChild(createIcon('chevron-down'));
	const name = document.createElement('span');
	name.textContent = set.label;
	toggle.append(chevron, name);
	node.appendChild(toggle);
	node.dataset.collapseKey = `${schema?.prefix || 'panel'}:${set.rows?.[0]?.id || set.label}`;
	if (set.collapse === 'closed') node.dataset.collapseDefault = 'closed';
	setPanelCardCollapsed(node, set.collapse === 'closed');
	applyPanelCardState(node);
}

// A set names related rows through `label`; the finishing pass draws the
// name only in sections with more than one labelled set. `collapse: 'open' |
// 'closed'` makes the name a toggle that folds the rows away: presets that
// are a shortcut beside the controls they fill.
function buildPanelSet(set, schema) {
	if (set.actions) return buildActionSet(set);
	const node = addPanelClasses(panelDiv('property-set'), set.classes);
	if (set.id) node.id = set.id;
	if (set.hidden) node.hidden = true;
	Object.entries(set.attrs || {}).forEach(([name, value]) => node.setAttribute(name, value));
	if (set.label) {
		node.setAttribute('role', 'group');
		if (typeof set.label === 'string') node.setAttribute('aria-label', set.label);
		else {
			node.dataset.setLabelId = set.label.id;
			node.setAttribute('aria-labelledby', set.label.id);
		}
	}
	if (set.collapse) buildSetToggle(node, set, schema);
	(set.rows || []).forEach((row) => node.appendChild(buildPanelItem(row, schema)));
	return node;
}

// Lays a built choice control out as a row. `revert: true` restores the
// schema's default option; a string is the id of a manager-owned revert.
function finishChoiceRow(item, control, revertTarget) {
	const row = buildOptionGroup(item.label, [control], item.rowClasses, item.hint);
	if (item.rowId) row.id = item.rowId;
	if (item.hidden) row.hidden = true;
	if (item.stacked) row.classList.add('is-stacked');
	if (item.revert === true) attachOptionRevert(row, revertTarget, { options: item.options, roleId: item.id || item.options?.[0]?.id || item.label, label: item.label });
	else if (item.revert) row.appendChild(buildFieldRevert(item.revert));
	return row;
}

// One schema item: a section kind, or a row kind inside a set. On every row,
// `label` is the visible text and `ariaLabel` the accessible name where the
// two must differ; a choice control with no `label` fills its set's width.
function buildPanelItem(item, schema) {
	switch (item.kind) {
		case 'section':
			return buildPanelSection(item, schema);
		case 'paintSlot':
			return buildPaintSlotSection(item, schema);
		// The shared transform panel (renderTransformPanels fills it).
		case 'transform': {
			const host = panelDiv('transform-panel-host');
			host.id = `${schema.prefix}TransformPanelHost`;
			return host;
		}
		// Where another schema's section mounts (the document-size form).
		case 'mount': {
			const mount = document.createElement('div');
			mount.id = item.id;
			return mount;
		}
		// R4. A boolean reads as a labelled switch on its own row.
		case 'toggle': {
			const row = tplClone('tpl-toggle-row');
			if (item.rowId) row.id = item.rowId;
			if (item.hidden) row.hidden = true;
			const input = row.querySelector('input');
			input.id = item.id;
			input.checked = Boolean(item.checked);
			const label = row.querySelector('.property-label');
			label.textContent = item.label;
			if (item.title) label.title = item.title;
			// `revert: true` → a static-default revert the shared handler owns
			// (default = the item's initial `checked`); a string → a
			// manager-owned target id.
			if (item.revert === true) row.appendChild(buildFieldRevert(item.id, Boolean(item.checked)));
			else if (item.revert) row.appendChild(buildFieldRevert(item.revert));
			return row;
		}
		// R7. Helper text, a status line or an empty state. It sits in the set
		// of the row it explains.
		case 'note': {
			const note = addPanelClasses(panelDiv('property-note'), item.classes);
			if (item.id) note.id = item.id;
			if (item.hidden) note.hidden = true;
			if (item.text) note.textContent = item.text;
			Object.entries(item.attrs || {}).forEach(([name, value]) => note.setAttribute(name, value));
			return note;
		}
		case 'assetInfo':
			return buildAssetInfo(item);
		case 'slider':
			return buildSliderRow(item);
		case 'pair':
			return buildPairRow(item);
		case 'numberPair':
			return buildNumberFieldPair(item);
		// A single labelled input row: label | control [| unit]. `type` picks the
		// input (text/number/color/…); `unit` wraps it in `.input-unit` with a
		// suffix. Ids/ranges are still driven imperatively by the owning manager
		// (canvas-size.js, the project-name binding) — this only stamps structure.
		case 'field': {
			const input = document.createElement('input');
			input.type = item.type || 'text';
			if (item.id) input.id = item.id;
			if (item.placeholder) input.placeholder = item.placeholder;
			if (item.maxlength != null) input.maxLength = item.maxlength;
			if (item.min != null) input.min = String(item.min);
			if (item.max != null) input.max = String(item.max);
			if (item.step != null) input.step = String(item.step);
			if (item.value != null) input.setAttribute('value', String(item.value));
			if (item.inputMode) input.inputMode = item.inputMode;
			if (item.spellcheck === false) input.spellcheck = false;
			Object.entries(item.attrs || {}).forEach(([name, value]) => input.setAttribute(name, value));

			// A color field IS the paint-slot solid-color row: same
			// `.property-row.property-color-row` markup, same `attachOptionRevert`
			// wiring — one component, not a second color control.
			if (item.type === 'color') {
				const row = addPanelClasses(panelDiv('property-row property-color-row'), item.rowClasses);
				if (item.rowId) row.id = item.rowId;
				if (item.hidden) row.hidden = true;
				if (item.role) row.dataset.role = item.role;
				const label = document.createElement('span');
				label.className = 'property-label';
				label.textContent = item.label || '';
				row.append(label, input);
				if (item.revert) attachOptionRevert(row, input, { roleId: item.id || item.label, label: item.label, defaultValue: item.value });
				return row;
			}

			const row = addPanelClasses(panelDiv('property-row'), item.rowClasses);
			if (item.rowId) row.id = item.rowId;
			if (item.hidden) row.hidden = true;
			if (item.role) row.dataset.role = item.role;
			const label = document.createElement('span');
			label.className = 'property-label';
			label.textContent = item.label || '';
			if (item.title) label.title = item.title;
			row.appendChild(label);
			if (item.unit) {
				const unit = document.createElement('span');
				unit.className = 'input-unit';
				const suffix = document.createElement('span');
				suffix.className = 'input-unit-suffix';
				suffix.textContent = item.unit;
				unit.append(input, suffix);
				row.appendChild(unit);
			} else {
				row.appendChild(input);
			}
			if (item.revert === true) row.appendChild(buildFieldRevert(item.id, item.value ?? ''));
			else if (item.revert) row.appendChild(buildFieldRevert(item.revert));
			return row;
		}
		// A label paired with one arbitrary built control, using the same
		// `.property-row` chrome as every other labelled row. `stacked` overrides
		// buildOptionGroup's width heuristic when the caller knows better.
		case 'labeled': {
			const control = buildPanelItem(item.control, schema);
			const row = buildOptionGroup(item.label, [control], item.rowClasses);
			if (item.stacked === false) row.classList.remove('is-stacked');
			else if (item.stacked === true) row.classList.add('is-stacked');
			if (item.revert) row.appendChild(buildFieldRevert(item.revert));
			return row;
		}
		// A choice among a few options. `display: 'select'` shows the same
		// option buttons as a dropdown (managers still bind the buttons).
		case 'segmented': {
			const control = item.display === 'select'
				? buildSelectProxy(item.options, { label: item.ariaLabel || item.label })
				: buildSegmented(item.options, { id: item.id, classes: item.classes, label: item.ariaLabel || item.label });
			return item.label ? finishChoiceRow(item, control, control) : control;
		}
		case 'select': {
			const select = document.createElement('select');
			if (item.id) select.id = item.id;
			addPanelClasses(select, item.classes);
			select.setAttribute('aria-label', item.ariaLabel || item.label);
			const optgroups = new Map();
			item.options.forEach((entry) => {
				const option = document.createElement('option');
				option.value = entry.value;
				option.textContent = entry.label;
				option.selected = Boolean(entry.selected || entry.active);
				option.disabled = Boolean(entry.disabled);
				let parent = select;
				if (entry.group) {
					parent = optgroups.get(entry.group);
					if (!parent) {
						parent = document.createElement('optgroup');
						parent.label = entry.group;
						optgroups.set(entry.group, parent);
						select.appendChild(parent);
					}
				}
				parent.appendChild(option);
			});
			if (!item.label) return select;
			// `stepper`: compact icon-only prev/next buttons flanking the select
			// (prev on the left, next on the right) so cycling this field's options
			// reads as one control, not a separate action row below it.
			let control = select;
			if (item.stepper) {
				const buildStepButton = (action) => {
					const button = document.createElement('button');
					button.type = 'button';
					button.className = 'btn-icon-simple icon-wrapper';
					button.id = action.id;
		if (action.command) button.addEventListener('click', () => COMMANDS[action.command]?.run(window.editor));
					if (action.title) button.title = action.title;
					button.setAttribute('aria-label', action.title || action.label || '');
					button.appendChild(createIcon(action.icon));
					return button;
				};
				control = panelDiv('animation-select-stepper');
				if (item.stepper.prev) control.appendChild(buildStepButton(item.stepper.prev));
				control.appendChild(select);
				if (item.stepper.next) control.appendChild(buildStepButton(item.stepper.next));
				const row = finishChoiceRow(item, control, select);
				// A stepper is wider than a choice control, but shares the label's line.
				if (!item.stacked) row.classList.remove('is-stacked');
				return row;
			}
			return finishChoiceRow(item, control, select);
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
			group.setAttribute('aria-label', item.ariaLabel || item.label);
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
			return item.label ? buildOptionGroup(item.label, [group]) : group;
		}
		// A control its manager fills (a preset grid host, the symbol grid, the
		// brush dynamics). A row-level item: it never carries structure classes.
		case 'host': {
			const node = document.createElement(item.tag || 'div');
			if (item.id) node.id = item.id;
			if (item.classes) node.className = item.classes;
			if (item.text) node.textContent = item.text;
			Object.entries(item.attrs || {}).forEach(([name, value]) => node.setAttribute(name, value));
			return node;
		}
		case 'sparkleGlyphs':
			return buildSparkleGlyphChips(item);
		case 'presetGrid': {
			const grid = tplClone('tpl-preset-grid');
			if (item.id) grid.id = item.id;
			if (item.label) grid.setAttribute('aria-label', item.label);
			addPanelClasses(grid, item.classes);
			return grid;
		}
		case 'processingStatus':
			return buildProcessingStatus(item);
		default:
			throw new Error(`panel-renderer: unknown item kind "${item.kind}"`);
	}
}

// The pickable sparkle shapes, from the sparkles registry at render time.
// Chip ids are the slot's panelPrefix + the suffix the binder reads
// (ui/paint-slot-controls.js).
function buildSparkleGlyphChips(item) {
	const chips = panelDiv('sparkle-glyph-chips');
	chips.setAttribute('role', 'group');
	chips.setAttribute('aria-label', 'Sparkle shapes');
	Object.values(SPARKLE_GLYPHS).filter((glyph) => glyph.pickable).forEach((glyph) => {
		const chip = document.createElement('button');
		chip.type = 'button';
		chip.className = 'choice-card sparkle-glyph-chip';
		chip.id = `${item.idPrefix}Glyph${panelCap(glyph.id)}`;
		chip.title = glyph.label;
		chip.setAttribute('aria-label', glyph.label);
		chip.setAttribute('aria-pressed', 'false');
		const icon = document.createElement('span');
		icon.className = 'sparkle-glyph-icon';
		const url = getSparkleGlyphMaskUrl(glyph.id, 24);
		icon.style.maskImage = `url(${url})`;
		icon.style.webkitMaskImage = `url(${url})`;
		chip.appendChild(icon);
		chips.appendChild(chip);
	});
	return chips;
}

// R5: a module row states what it is currently set to, so a collapsed effect
// is still readable ("Sparkle Pink - 80%") without expanding it. Managers write
// their values straight into the DOM without firing events, so the summary
// mirrors the card's own nodes through an observer rather than trying to hook
// every manager's sync path.
function buildModuleSummary(card) {
	if (!card || card.querySelector(':scope > .property-card-title > .property-card-summary')) return null;
	const title = card.querySelector(':scope > .property-card-title');
	if (!title) return null;
	const summary = document.createElement('span');
	summary.className = 'property-card-summary';
	summary.setAttribute('aria-hidden', 'true');
	// The summary sits before the swatch (when there is one) so the fixed-size
	// swatch pins to the right edge next to the chevron — a stable anchor across
	// modules — while the variable-width value text grows leftward.
	const anchor = title.querySelector(':scope > .property-card-swatch')
		|| title.querySelector('.property-card-chevron');
	title.insertBefore(summary, anchor || null);
	return summary;
}

function readModuleSummary(card) {
	if (card.dataset.moduleSummaryType === 'asset') {
		return card.querySelector('.asset-info-name')?.textContent?.trim() || '';
	}
	// A disabled effect module reads "Off" beside its title — it pairs with the
	// hatched "unset" swatch (`.is-unset`, stamped by syncModuleSummary) so a
	// switched-off module still states its condition
	// whether collapsed or open, the same way a None paint slot reads "None".
	const toggle = card.querySelector(':scope > .property-card-title input[data-effect-toggle]');
	if (toggle && !toggle.checked) return 'Off';
	const mode = card.dataset.paintMode || card.querySelector('.segmented-option.active[data-mode]')?.dataset.mode || '';
	const parts = [];
	if (mode === 'none') return 'None';
	// The Background slot's Image mode: "None" until a base image is chosen (the
	// image chip carries `.empty` until then), otherwise just "Image" — the
	// asset-info row below already names the file.
	if (mode === 'image') {
		return card.querySelector('.asset-info:not([hidden]) .asset-info-thumbnail.empty') ? 'None' : 'Image';
	}
	if (mode === 'glitter') {
		const name = card.querySelector('.asset-info:not([hidden]) .asset-info-name')?.textContent?.trim();
		parts.push(name || 'Glitter');
	} else if (mode === 'solid') {
		const color = card.querySelector('.property-color-row:not([hidden]) input[type="color"]')?.value;
		parts.push(color ? color.toUpperCase() : 'Solid');
	} else if (mode === 'gradient') {
		const type = card.querySelector('.effect-gradient-editor [data-type].active')?.dataset.type;
		parts.push(type === 'radial' ? 'Radial gradient' : 'Linear gradient');
	}
	// One value after the identifier: the section's defining one where it
	// names one (`summaryValue`), otherwise an opacity that is not full.
	const opacity = card.querySelector('.paint-slot-opacity .property-value')?.textContent?.trim();
	const detail = card.dataset.summaryValue
		? document.getElementById(`${card.dataset.summaryValue}Value`)?.textContent?.trim()
		: (opacity !== '100%' && opacity);
	if (detail) parts.push(detail);
	return parts.join(' · ');
}

function syncModuleSummary(card) {
	const summary = card.querySelector(':scope > .property-card-title > .property-card-summary');
	if (!summary) return;
	const text = readModuleSummary(card);
	if (summary.textContent !== text) summary.textContent = text;
	const swatch = card.querySelector(':scope > .property-card-title > .property-card-swatch');
	if (swatch) {
		const mode = card.dataset.paintMode || card.querySelector('.segmented-option.active[data-mode]')?.dataset.mode || '';
		const chip = card.querySelector('.asset-info:not([hidden]) .asset-info-thumbnail:not(.empty)');
		// The base-image chip holds an <img>, not an inline background (unlike a
		// glitter chip) — mirror its src so Image mode still gets a real swatch.
		const chipImg = chip?.querySelector(':scope > img')?.src;
		const solid = card.querySelector('.property-color-row:not([hidden]) input[type="color"]');
		// Only mirror the gradient editor's preview bar while gradient is the
		// ACTIVE mode — the editor stays in the DOM (hidden) in every other mode
		// with its last gradient still inline, which would otherwise leak in.
		const gradient = mode === 'gradient' ? card.querySelector('.gradient-preview-bar') : null;
		swatch.style.background = solid?.value
			|| chip?.style.background
			|| chip?.style.backgroundImage
			|| (chipImg ? `center / cover no-repeat url("${chipImg}")` : '')
			|| gradient?.style.backgroundImage
			|| '';
		// A switched-off slot, a None source, or a source whose asset chip is
		// still empty all read as "no value": `.is-unset` draws the hatch over
		// whatever background the last active source left inline.
		swatch.classList.toggle('is-unset', Boolean(
			card.querySelector(':scope > .property-card-title input:not(:checked)')
			|| card.querySelector('.segmented-option[data-mode="none"].active')
			|| card.querySelector('.asset-info:not([hidden]) .asset-info-thumbnail.empty')
		));
	}
}

function initializeModuleSummaries(root = document) {
	root.querySelectorAll('[data-role="paint-slot"]:not([data-nested]), [data-module-summary-type]').forEach((card) => {
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
	// `.is-off` is the one switched-off state the stylesheet reads.
	card.classList.toggle('is-off', !next);
	if (previous == null || String(next) !== previous) card.classList.toggle('is-collapsed', !next);
	card.querySelector(':scope > .property-card-title')?.setAttribute('aria-expanded', card.classList.contains('is-collapsed') ? 'false' : 'true');
	if (card.dataset.moduleSummary !== undefined) syncModuleSummary(card);
}

// Remembered open/closed state for collapsible cards, keyed `prefix:title`
// (data-collapse-key). Effect cards carry no key: their switch owns expansion.
const PANEL_CARD_STATE_KEY = STORAGE_KEYS.panelCards.key;

function readPanelCardState() {
	return readStored(PANEL_CARD_STATE_KEY, {});
}

// A section or a collapsible set: the toggle is its title row or its name.
function setPanelCardCollapsed(card, collapsed) {
	card.classList.toggle('is-collapsed', collapsed);
	card.querySelector(':scope > :is(.property-card-title, [data-set-toggle])')?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

// The open state of a `[data-advanced]` disclosure, for every caller.
function setAdvancedDisclosureOpen(disclosure, open) {
	disclosure.classList.toggle('is-open', open);
	disclosure.querySelector(':scope > [data-advanced-toggle]')?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function applyPanelCardState(card) {
	const key = card?.dataset.collapseKey;
	if (!key) return;
	const open = readPanelCardState()[key];
	if (typeof open === 'boolean') setPanelCardCollapsed(card, !open);
}

function rememberPanelCardState(card) {
	const key = card?.dataset.collapseKey;
	if (!key) return;
	const state = readPanelCardState();
	state[key] = !card.classList.contains('is-collapsed');
	writeStored(PANEL_CARD_STATE_KEY, state);
}

function resetPanelCardStates() {
	removeStored(PANEL_CARD_STATE_KEY);
	document.querySelectorAll('[data-collapse-key]').forEach((card) => {
		setPanelCardCollapsed(card, card.dataset.collapseDefault === 'closed');
	});
}

// Rule D, tier 2: a card-scoped reset at the right edge of the card's title.
// It holds no defaults of its own: it replays every lit revert on the rows
// showing in its card, so it is inert exactly when all of them are.
function buildPanelCardReset(node, title, spec) {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'property-revert property-card-reset';
	button.dataset.revertBound = '';
	button.disabled = true;
	button.title = spec.title || `Reset ${title}`;
	button.setAttribute('aria-label', button.title);
	button.appendChild(createIcon('reset'));
	const reverts = () => Array.from(node.querySelectorAll('button.property-revert')).filter((revert) => revert !== button);
	const isLit = (revert) => !revert.disabled && !revert.closest('[hidden]');
	button.addEventListener('click', () => {
		// Checked as it goes: one revert can light, clear or reveal a later one.
		reverts().forEach((revert) => { if (isLit(revert)) revert.click(); });
	});
	new MutationObserver(() => {
		// Assigned only on a change: writing `disabled` again is itself a
		// mutation, which would re-enter this observer forever.
		const inert = !reverts().some(isLit);
		if (button.disabled !== inert) button.disabled = inert;
	}).observe(node, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
	return button;
}

// A group: a label, its sections, then an optional note and the buttons it
// ends with. Its children sit directly in it, so a row has one wrapper chain
// in every panel.
function buildPanelGroup(group, schema) {
	const node = tplClone('tpl-group');
	addPanelClasses(node, group.classes);
	node.dataset.panelGroup = group.title;
	const label = node.querySelector('.property-group-label');
	// A sticky band is chrome around the scrolling groups, not a category of
	// sections, so it carries no label. Every other group is labelled, and
	// none collapses: a collapsed group would hide whether anything inside it
	// is on.
	if (group.region === 'header' || group.region === 'footer') label.remove();
	else label.textContent = group.title;
	// Each section is stamped with its key for the section index
	// (getPanelSectionIndex): a flyout section's line carries its card's key.
	(group.sections || []).forEach((section) => {
		const item = buildPanelItem(section, schema);
		const placed = section.presentation === 'flyout' ? mountFlyoutSection(item, section, schema) : item;
		placed.dataset.sectionKey = section.slot || section.title || section.kind;
		if (section.chips) placed.dataset.sectionChips = section.chips;
		node.appendChild(placed);
	});
	if (group.note) node.appendChild(buildPanelItem({ kind: 'note', ...(typeof group.note === 'string' ? { text: group.note } : group.note) }, schema));
	(group.actions || []).forEach((set) => {
		const actions = buildActionSet(set);
		actions.classList.add('section-actions');
		// Buttons that end a group of sections (Reset effects) are actions
		// too: the index lists them with the Actions group, as one entry.
		if (group.title !== 'Actions') actions.dataset.sectionAction = '';
		node.appendChild(actions);
	});
	if (group.title === 'Actions') {
		node.dataset.sectionKey = 'actions';
		node.dataset.sectionTitle = 'More';
	}
	return node;
}

// The section index of a rendered panel host: one entry per section, in
// panel order. The Inspector draws the same sections as lines and inline
// blocks; the phone bar draws this index as chips. An entry is `{ key, title,
// group, element }`, plus `line` for a flyout section and `button` for a
// section whose buttons stand in the index themselves (`chips: 'buttons'`).
// The panel's actions are one last entry, More: the Actions group and, in
// `extras`, the buttons that end other groups. A sticky-region panel is one
// entry: it only works whole.
function getPanelSectionIndex(host) {
	if (host.classList.contains('has-scroll-region')) {
		return [{ key: 'panel', title: host.dataset.panelTitle || '', group: null, element: host }];
	}
	const label = (node) => node.dataset.sectionTitle
		|| node.querySelector('.property-card-title > span')?.firstChild?.textContent.trim() || '';
	const shown = (element) => !element.closest('[hidden]') && !element.classList.contains('is-vacant');
	const actions = Array.from(host.querySelectorAll('[data-section-key="actions"], [data-section-action]')).filter(shown);
	const more = actions.length ? [{ key: 'actions', title: 'More', group: 'Actions', element: actions[0], extras: actions.slice(1) }] : [];
	return Array.from(host.querySelectorAll('[data-section-key]:not([data-section-key="actions"])')).flatMap((element) => {
		if (!shown(element)) return [];
		const group = element.closest('.property-group').dataset.panelGroup;
		const entry = { key: element.dataset.sectionKey, title: label(element), group, element };
		if (element.dataset.sectionChips === 'buttons') {
			return Array.from(element.querySelectorAll('button')).filter((button) => !button.hidden).map((button, index) => ({
				...entry, key: `${entry.key}:${index}`, button,
				title: button.querySelector('.layer-type-name')?.textContent || button.textContent.trim() || button.title
			}));
		}
		if (element.classList.contains('property-line')) entry.line = element;
		return entry.title ? [entry] : [];
	}).concat(more);
}

// The finishing pass every rendered schema root gets (full section, bare
// section, fragment): set labels and editable value readouts.
function finishPanelMarkup(root) {
	root.querySelectorAll('.property-card-body').forEach((body) => {
		const sets = Array.from(body.querySelectorAll('.property-set[aria-label], .property-set[data-set-label-id]')).filter((set) => set.closest('.property-card-body') === body);
		sets.forEach((set) => {
			if (set.querySelector(':scope > .property-set-label')) return;
			// A lone static name repeats its section's title; a name its manager
			// writes (the chosen look's settings) is always drawn.
			if (sets.length < 2 && !set.dataset.setLabelId) return;
			const label = panelDiv('property-set-label');
			label.textContent = set.getAttribute('aria-label') || '';
			if (set.dataset.setLabelId) label.id = set.dataset.setLabelId;
			label.setAttribute('aria-hidden', 'true');
			set.prepend(label);
		});
	});
	initializeEditablePropertyValues(root);
}

// A container whose content is all hidden takes no space. Managers hide rows
// by setting `hidden` and write values straight into the DOM, so one observer
// keeps `.is-vacant` in step instead of every manager remembering to.
const PANEL_VACANCY_CONTAINERS = [
	'.property-card:not([data-effect-card], .property-line)', '.property-card-body', '.advanced-disclosure-content',
	'.property-pair-group', '.property-set', '.property-actions', '.property-meta-cell'
].join(', ');
// A container's own heading does not count as content.
const PANEL_VACANCY_CHROME = '.property-card-title, .property-group-label, .property-set-label';

function syncPanelVacancy(container) {
	let occupied;
	if (container.matches('.property-meta-cell')) {
		occupied = Boolean(container.querySelector(':scope > .property-value:not(:empty)'));
	} else {
		occupied = Array.from(container.children).some((child) => !child.hidden && !child.matches(PANEL_VACANCY_CHROME));
		// A meta row is only as full as its values.
		if (occupied && container.matches('.asset-info-meta')) {
			occupied = Boolean(container.querySelector(':scope > .property-meta-cell > .property-value:not(:empty)'));
		}
	}
	// A disclosure with nothing to disclose goes with its content.
	(container.matches('.advanced-disclosure-content') ? container.parentElement : container).classList.toggle('is-vacant', !occupied);
}

function initializePanelVacancy() {
	if (initializePanelVacancy.started) return;
	initializePanelVacancy.started = true;
	const sync = (node) => {
		if (node?.matches?.(PANEL_VACANCY_CONTAINERS)) syncPanelVacancy(node);
	};
	const syncTree = (root) => {
		sync(root);
		root.querySelectorAll(PANEL_VACANCY_CONTAINERS).forEach(syncPanelVacancy);
	};
	syncTree(document.body);
	new MutationObserver((mutations) => {
		mutations.forEach((mutation) => {
			if (mutation.type === 'attributes') {
				sync(mutation.target.parentElement);
				return;
			}
			const target = mutation.target;
			sync(target);
			// A value's text decides its meta cell, and the cell its meta row.
			if (target.matches?.('.property-value')) {
				sync(target.parentElement);
				sync(target.parentElement?.parentElement);
			}
			mutation.addedNodes.forEach((node) => {
				if (node.nodeType === Node.ELEMENT_NODE) syncTree(node);
			});
		});
	}).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
}

// Render one or more `.settings-subsection` blocks from a schema.
// `subsections` lets a panel carry several keyed blocks of groups (the
// no-selection panel toggles #noLayerDefaultGroups vs
// #multiLayerSelectionGroup). A form (the New Canvas modal) lists `sections`
// with no group: a modal body is one column of sections.
function renderPanelSubsections(schema, parent) {
	const defs = schema.subsections || [{ groups: schema.groups, sections: schema.sections }];
	defs.forEach((def) => {
		const block = panelDiv('settings-subsection');
		if (def.id) block.id = def.id;
		addPanelClasses(block, def.classes);
		if (def.hidden) block.hidden = true;
		(def.groups || []).forEach((group) => block.appendChild(buildPanelGroup(group, schema)));
		(def.sections || []).forEach((section) => block.appendChild(buildPanelItem(section, schema)));
		parent.appendChild(block);
	});
}

// A "bare" schema section is not one of the Inspector's switched panels: the
// groups render straight into the host's existing `.section-content` (the
// no-selection panel, a form modal's body).
// `preamble` items render ahead of the subsections (the "nothing selected"
// intro note keeps its id so syncNoLayerPanelState still drives its text).
function renderBarePanelSection(schema) {
	const host = document.getElementById(schema.section.id);
	if (!host) return;
	host.classList.add('property-section');
	addPanelClasses(host, schema.section.classes);
	let content = host.querySelector(':scope > .section-content');
	if (!content) {
		content = panelDiv('section-content');
		host.appendChild(content);
	}
	if (content.querySelector(':scope > .settings-subsection')) return;
	content.replaceChildren();
	(schema.preamble || []).forEach((item) => content.appendChild(buildPanelItem(item, schema)));
	renderPanelSubsections(schema, content);
	finishPanelMarkup(host);
}

// A schema that is one section mounted into another schema's `mount` host
// (`mountInto`). The document-size form uses this so ONE section serves both
// the no-selection Size slot and Canvas Properties (managers relocate the
// single node between the two hosts at runtime; it is never rendered twice).
function renderPanelFragment(schema) {
	if (document.getElementById(schema.content.id)) return;
	const mount = document.getElementById(schema.mountInto);
	if (!mount) return;
	const card = buildPanelItem(schema.content, schema);
	mount.appendChild(card);
	finishPanelMarkup(card);
}

function renderPanelSection(schema) {
	if (schema.section?.bare) return renderBarePanelSection(schema);
	const host = document.getElementById(schema.section.id);
	if (!host) return;
	// Every schema-rendered section carries `.property-section`, the scope for
	// the panel vocabulary in css/panels/property/.
	host.classList.add('property-section');
	addPanelClasses(host, schema.section.classes);
	host.dataset.panelTitle = schema.section.title;
	host.replaceChildren();
	document.getElementById(`${schema.sectionPrefix}Flyouts`)?.remove();
	const fragment = document.getElementById('tpl-section').content.cloneNode(true);
	// The panel has no bar of its own: the Inspector's header and the phone's
	// sheet bar read `section.icon`, `title`, `tab` and `badge` from the schema.
	const sectionPrefix = schema.sectionPrefix || `${schema.prefix}Settings`;
	fragment.querySelector('.section-content').id = `${sectionPrefix}Content`;
	const subsection = fragment.querySelector('.settings-subsection');
	// Sticky-region layout: a group's `region` puts it in a fixed `header` /
	// `footer` band or the single scrolling middle. The structural CSS is generic
	// (`.section.has-scroll-region` in panels/property/_regions.scss); declare
	// header/footer groups first/last so DOM order matches. First user: Auto Glitter.
	let scrollRegion = null;
	let hasStickyRegions = false;
	const placeGroup = (group, node) => {
		if (group.region === 'scroll') {
			if (!scrollRegion) {
				scrollRegion = panelDiv('panel-scroll-region');
				subsection.appendChild(scrollRegion);
			}
			scrollRegion.appendChild(node);
			hasStickyRegions = true;
		} else if (group.region === 'header' || group.region === 'footer') {
			node.classList.add(group.region === 'header' ? 'panel-sticky-header' : 'panel-sticky-footer');
			subsection.appendChild(node);
			hasStickyRegions = true;
		} else {
			subsection.appendChild(node);
		}
	};
	// Group order (docs/UI-CONVENTIONS.md): the schema's own groups, then
	// Effects, then Motion, with an Actions group always last.
	const isActions = (group) => group.title === 'Actions';
	schema.groups.filter((group) => !isActions(group)).forEach((group) => placeGroup(group, buildPanelGroup(group, schema)));
	if (schema.effects?.length) {
		const effects = { title: 'Effects', sections: schema.effects };
		// Reset Effects ends the Effects group, and only when there is more
		// than one effect to reset.
		if (schema.effectsReset && schema.effects.length >= 2) {
			effects.actions = [{ classes: 'layer-effects-actions', actions: [
				{ id: schema.effectsReset.id, label: 'Reset effects', title: schema.effectsReset.title }
			] }];
		}
		const stack = buildPanelGroup(effects, schema);
		stack.classList.add('effects-stack');
		subsection.appendChild(stack);
	}
	if (schema.motion?.length) {
		subsection.appendChild(buildPanelGroup({ title: 'Motion', sections: schema.motion }, schema));
	}
	schema.groups.filter(isActions).forEach((group) => placeGroup(group, buildPanelGroup(group, schema)));
	if (hasStickyRegions) {
		host.classList.add('has-scroll-region');
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
	finishPanelMarkup(host);
	const flyouts = document.getElementById(`${schema.sectionPrefix}Flyouts`);
	if (flyouts) finishPanelMarkup(flyouts);
}

// Boot entry point. Must run before renderTransformPanels (it creates the
// transform hosts) and before any manager constructor caches panel elements.
// Fragment schemas (documentSize) run last so their mount hosts — created by an
// earlier section schema — already exist.
function renderPanelSections(editor) {
	Object.values(PANEL_SCHEMAS).forEach((schema) => {
		if (schema.mountInto) renderPanelFragment(schema);
		else renderPanelSection(schema);
		(schema.auxiliarySections || []).forEach((section) => renderPanelSection(section));
	});
	initializePanelVacancy();
}

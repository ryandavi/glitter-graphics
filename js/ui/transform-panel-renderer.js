// ===========================================================================
// TRANSFORM PANEL RENDERER
// ---------------------------------------------------------------------------
// Builds the shared transform card (Position / Size / Scale / Rotation / Align
// / Flip) into the sticker / text / shape panels, applies the panel-redesign
// arrangement, and does the one-time post-render host normalisation.
//
// Plain global script — loads AFTER js/ui/panel-renderer.js (uses its builders
// and PANEL_SCHEMAS) and BEFORE js/editor/transform-panel.js (its only caller).
// ===========================================================================

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
		node.appendChild(createIcon('reset'));
		return node;
	};
	// A real per-row revert for the transform controls that have a meaningful
	// default to return to (Flip, Lock aspect ratio). editor-transform.js wires
	// the click and toggles `disabled` from the layer state; the id is stamped by
	// buildTransformPanel's [data-transform-role] pass.
	const revertControl = (role) => {
		const node = document.createElement('button');
		node.type = 'button';
		node.className = 'property-revert';
		node.dataset.transformRole = role;
		node.title = 'Reset to default';
		node.setAttribute('aria-label', 'Reset to default');
		node.disabled = true;
		node.appendChild(createIcon('reset'));
		return node;
	};
	const rowLabel = (text) => {
		const node = document.createElement('span');
		node.className = 'property-label';
		node.textContent = text;
		return node;
	};
	const makePairRow = (set, label, { revert = true } = {}) => {
		const pair = set.querySelector('.property-pair');
		set.className = 'property-row row is-pair transform-pair-row';
		set.replaceChildren(rowLabel(label), pair, ...(revert ? [placeholder()] : []));
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
	lock.replaceChildren(rowLabel('Lock aspect ratio'), lockInput, lockSwitch, revertControl('resetProportional'));
	header.querySelector('.transform-panel-title-actions').remove();
	const signal = document.createElement('button');
	signal.type = 'button';
	signal.className = 'property-revert transform-revert-signal';
	signal.title = 'Reset transform';
	signal.setAttribute('aria-label', 'Reset transform');
	signal.dataset.transformRevertSignal = '';
	signal.appendChild(createIcon('reset'));
	header.appendChild(signal);

	makePairRow(position, 'Position', { revert: false });
	const scaleRows = panelDiv('transform-scale-rows');
	scaleRows.append(...size.querySelectorAll('[data-transform-scale-readout]'));
	scaleRows.querySelector('.transform-scale-x > .property-label').textContent = 'Scale';
	const sizeRow = makePairRow(size, 'Size');
	sizeRow.dataset.transformRole = 'sizeGroup';
	sizeRow.querySelector('.property-pair').removeAttribute('data-transform-role');

	const rotationRow = rotation.querySelector('.property-row');
	rotationRow.querySelector('.property-label').textContent = 'Rotation';

	align.querySelector(':scope > .property-set-label').textContent = 'Align to canvas';
	align.querySelectorAll(':scope > .property-row').forEach((row) => {
		row.classList.remove('is-stacked');
	});
	const transformGlyphs = {
		alignLeft: 'align-left', alignCenterX: 'align-center-x', alignRight: 'align-right',
		alignTop: 'align-top', alignCenterY: 'align-center-y', alignBottom: 'align-bottom'
	};
	align.querySelectorAll('.segmented-option[data-transform-role]').forEach((button) => {
		const label = button.textContent;
		button.replaceChildren(createPanelGlyph(transformGlyphs[button.dataset.transformRole]));
		button.setAttribute('aria-label', label);
	});

	const flipControl = panelDiv('segmented-control transform-flip-control');
	flip.querySelectorAll('.property-toggle-list > label').forEach((option, index) => {
		const input = option.querySelector('input');
		const visible = option.querySelector('.property-label');
		option.className = 'segmented-option';
		visible.className = '';
		const label = index === 0 ? 'Horizontal' : 'Vertical';
		visible.textContent = '';
		visible.appendChild(createPanelGlyph(index === 0 ? 'flip-x' : 'flip-y'));
		option.setAttribute('aria-label', label);
		option.replaceChildren(input, visible);
		flipControl.appendChild(option);
	});
	flip.className = 'property-row row';
	flip.replaceChildren(rowLabel('Flip'), flipControl, revertControl('resetFlip'));

	// Labelled groups, hairline-divided (.transform-grid > .property-set in
	// panels/_properties.scss). Same three groups for sticker / text / shape.
	// Layer Opacity is adopted into the Appearance group, so it isn't here.
	const makeGroup = (label, nodes) => {
		const set = panelDiv('property-set');
		const heading = panelDiv('property-set-label');
		heading.textContent = label;
		set.append(heading, ...nodes);
		return set;
	};
	grid.replaceChildren(
		makeGroup('Position & size', [position, sizeRow, lock, scaleRows]),
		makeGroup('Rotation & flip', [rotationRow, flip]),
		align
	);

	actions.classList.add('panel-actions');
	card.appendChild(actions);
}

function buildTransformPanel(editor, container, prefix, capabilities) {
	const ids = editor.getTransformIds(prefix);
	const fragment = document.getElementById('tpl-transform-panel').content.cloneNode(true);
	// The transform card is injected AFTER renderPanelSection's
	// applyPanelRedesignClasses pass, so stamp the same redesign aliases here:
	// `property-card`, and `property-block` for the L2-block layout (flex title
	// row, etc.) that keyed off `.subsection-content-group:where(:not(section-group))`
	// before it became a positive class.
	fragment.querySelectorAll('.subsection-content-group').forEach((card) => {
		card.classList.add('property-card');
		if (!card.classList.contains('subsection-section-group') && !card.classList.contains('effects-stack')) {
			card.classList.add('property-block');
		}
	});
	const buildNumberPair = (roles, labels, min = null) => {
		const pair = tplClone('tpl-number-pair');
		if (capabilities.panelRedesign) pair.className = 'property-pair number-field-pair';
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
	// v2 opacity model: whole-layer opacity is a standalone "Layer Opacity" row in
	// each panel's Appearance group, not a card inside the Transform panel.
	fragment.querySelector('[data-transform-opacity]')?.remove();
	container.replaceChildren(fragment);
	if (capabilities.panelRedesign) initializeEditablePropertyValues(container);
}

// Shared schema finalization: retitle the transform card, move the shared action
// primitive to the group footer, and settle host card order. (v2 opacity model:
// there is no transform-panel opacity card any more — whole-layer opacity is a
// standalone "Layer Opacity" row in each panel's Appearance group.)
function normalizeTransformPanelHost(editor, prefix) {
	const host = document.getElementById(`${prefix}TransformPanelHost`);
	if (!host) return null;
	const geometry = host.querySelector(':scope > [data-transform-prefix]');
	const actions = host.querySelector('[data-transform-actions]');

	const title = geometry?.querySelector(':scope > .subsection-title');
	if (title) {
		const labelNode = title.querySelector(':scope > span');
		if (labelNode) labelNode.textContent = 'Transform';
		else title.textContent = 'Transform';
	}

	if (geometry) host.appendChild(geometry);
	if (actions && geometry && !geometry.hasAttribute('data-panel-redesign')) host.closest('.panel-group-content')?.appendChild(actions);
	return host;
}

// Post-transform-render arrangement for schema-rendered panels. Runs once from
// renderTransformPanels.
function finalizePanelSchemaSections(editor) {
	Object.values(PANEL_SCHEMAS).forEach((schema) => {
		if (!schema.groups) return;
		const content = document.getElementById(`${schema.prefix}SettingsContent`);
		if (!content) return;
		normalizeTransformPanelHost(editor, schema.prefix);
	});
}

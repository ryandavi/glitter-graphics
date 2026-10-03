// ===========================================================================
// TRANSFORM PANEL RENDERER
// ---------------------------------------------------------------------------
// Builds the shared Transform section (Position / Size / Scale / Rotation /
// Flip / Align) into the sticker, text, shape, frame and fill panels from
// `tpl-transform-panel`, stamping each type's ids and dropping the rows its
// `transformCapabilities` do not declare.
//
// Plain global script — loads AFTER js/ui/panel-renderer.js (uses its builders
// and PANEL_SCHEMAS) and BEFORE js/editor/transform-panel.js (its only caller).
// ===========================================================================

function buildTransformRevertControl(role) {
	const node = document.createElement('button');
	node.type = 'button';
	node.className = 'property-revert';
	node.dataset.transformRole = role;
	node.title = 'Reset to default';
	node.setAttribute('aria-label', 'Reset to default');
	node.disabled = true;
	node.appendChild(createIcon('reset'));
	return node;
}

function buildTransformPanel(editor, container, prefix, capabilities) {
	const ids = editor.getTransformIds(prefix);
	const fragment = document.getElementById('tpl-transform-panel').content.cloneNode(true);
	const buildNumberPair = (roles, labels, min = null) => {
		const pair = tplClone('tpl-number-pair');
		pair.className = 'property-pair number-field-pair';
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
	fragment.querySelector('[data-transform-number-pair="size"]').replaceWith(buildNumberPair(['sizeWidth', 'sizeHeight'], ['W', 'H'], 1));
	// Anchor is the point Position measures to, so it sits right under it.
	const anchorRow = buildPanelItem({
		kind: 'select',
		id: ids.anchorSelect,
		label: 'Anchor',
		options: ANCHOR_SELECT_OPTIONS
	});
	anchorRow.appendChild(buildTransformRevertControl('resetAnchor'));
	fragment.querySelector('[data-transform-role="sizeGroup"]').before(anchorRow);
	const transformCard = fragment.querySelector('[data-transform-card]');
	transformCard.dataset.transformPrefix = prefix;
	transformCard.dataset.collapseKey = `${prefix}:Transform`;
	fragment.querySelectorAll('[data-transform-role]').forEach((element) => {
		const id = ids[element.dataset.transformRole];
		if (id) element.id = id;
	});
	const transformSliderSpecs = {
		scaleX: FIELDS.transformScale,
		scaleY: FIELDS.transformScale,
		rotation: FIELDS.transformRotation
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
	if (!capabilities.fitCanvas) fragment.querySelector('[data-transform-fit]').remove();
	container.replaceChildren(fragment);
	initializeEditablePropertyValues(container);
}

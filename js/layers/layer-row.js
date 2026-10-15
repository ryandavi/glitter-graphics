'use strict';

const LAYER_ROW_PARTS = [
	{ id: 'handle', variants: ['panel', 'timeline'] },
	{ id: 'visibility', variants: ['panel', 'timeline'] },
	{ id: 'chevron', variants: ['timeline'] },
	{ id: 'clip', variants: ['panel', 'timeline'] },
	{ id: 'swatch', variants: ['panel', 'timeline'] },
	{ id: 'text', variants: ['panel', 'timeline'] },
	{ id: 'detail', variants: ['panel'] },
	{ id: 'badges', variants: ['panel'] },
	{ id: 'lock', variants: ['panel', 'timeline'] },
	{ id: 'locate', variants: ['panel'] },
	{ id: 'delete', variants: ['panel'] }
];

function getLayerRowState(layer) {
	const permanent = Boolean(LAYER_UI_CONFIG[layer.type]?.protectedInStack);
	const cannotDelete = permanent || isLayerFullyLocked(layer);
	return {
		visibility: { icon: layer.visible ? 'eye' : 'eye-slash', title: layer.visible ? 'Hide layer' : 'Show layer' },
		lock: {
			icon: layer.locked ? 'lock' : 'unlock', active: Boolean(layer.locked), permanent,
			title: permanent ? 'Fixed background — editable, but cannot be moved, reordered, or deleted' : layer.locked ? 'Unlock layer' : 'Lock layer'
		},
		delete: { disabled: cannotDelete, title: permanent ? 'Base layer cannot be deleted' : cannotDelete ? 'Unlock layer to delete it' : 'Delete layer' }
	};
}

function renameLayerRow(editor, layer, row = editor.layerManager.layersListContainer.querySelector(`[data-layer-id="${layer.id}"]`)) {
	if (!canEditLayerInStack(layer) || !row) return;
	if (!row.getClientRects().length && editor.mobileManager?.isMobile) editor.mobileManager.openDrawer('layers');
	const name = row.querySelector('.layer-name');
	if (!name) return;
	const input = buildElement('layer-name-input', null, 'input');
	input.type = 'text'; input.maxLength = 80; input.value = layer.name || name.textContent;
	name.replaceWith(input); input.focus(); input.select();
	let finished = false;
	const finish = commit => {
		if (finished) return;
		finished = true;
		const next = input.value.trim();
		if (commit && next && next !== layer.name) { layer.name = next; editor.saveState('Rename layer'); }
		input.replaceWith(name);
		syncLayerRow(row, layer);
		editor.layerManager.renderLayersList();
	};
	input.addEventListener('blur', () => finish(true));
	input.addEventListener('keydown', event => {
		if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
		if (event.key === 'Escape') { event.preventDefault(); finish(false); }
	});
}

function buildLayerRow(editor, layer, { variant = 'panel' } = {}) {
	const manager = editor.layerManager;
	const row = buildElement(`layer-item list-row${variant === 'timeline' ? ' timeline-group-label' : ''}`);
	row.dataset.layerId = layer.id; row.dataset.layerRowVariant = variant; row._editor = editor; row._layer = layer;
	row.setAttribute('role', 'option');
	const current = () => manager.getLayerById(row.dataset.layerId);
	const show = id => LAYER_ROW_PARTS.find(part => part.id === id).variants.includes(variant);
	const action = (className, icon, run) => buildIconButton({ className: `btn-icon-simple icon-wrapper sm list-row-action ${className}`, icon, onClick: event => { event.stopPropagation(); run(current(), event); } });
	const handle = buildElement('layer-drag-handle list-row-handle', null, 'button'); handle.type = 'button';
	const mark = buildElement('drag-handle-mark', null, 'span'); mark.setAttribute('aria-hidden', 'true'); handle.append(mark);
	const swatch = buildElement('layer-swatch list-row-media');
	swatch.addEventListener('click', event => {
		event.stopPropagation();
		const layer = current();
		if (event.ctrlKey || event.metaKey) editor.areaSelect.selectLayerPixels([layer], modeFromModifiers(event));
		else if (variant === 'timeline') manager.setActiveLayer(layer.id);
		else manager.goToLayerSource(layer.id);
	});
	const text = buildElement('list-row-text'), name = buildElement(`layer-name list-row-name${variant === 'timeline' ? ' timeline-group-name' : ''}`);
	name.title = 'Double-click to rename';
	name.addEventListener('dblclick', event => { event.stopPropagation(); renameLayerRow(editor, current(), row); });
	text.append(name, buildElement('list-row-meta'));
	const actions = buildElement('list-row-actions');
	const parts = {
		chevron: action('timeline-group-chevron', 'chevron-down', () => {}), handle,
		visibility: action('layer-visibility', 'eye', layer => manager.toggleLayerVisibility(layer.id)),
		clip: action('layer-clip', 'clip', layer => editor.toggleClippingMask([layer])), swatch, text,
		lock: action('lock', 'lock', layer => manager.pressLayerLock(layer)),
		locate: action('goto-glitter', 'locate', layer => manager.goToLayerSource(layer.id)),
		delete: action('delete', 'trash', layer => manager.deleteLayerFromRow(layer))
	};
	for (const part of LAYER_ROW_PARTS) {
		if (!show(part.id) || !parts[part.id]) continue;
		if (['lock', 'locate', 'delete'].includes(part.id) || (part.id === 'clip' && variant === 'timeline')) actions.append(parts[part.id]);
		else row.append(parts[part.id]);
	}
	row.append(actions);
	row.addEventListener('click', event => {
		const layer = current();
		if (event.altKey && event.pointerType !== 'touch' && row.getBoundingClientRect().bottom - event.clientY <= CONFIG.ui.gestures.dragThresholdPx && editor.canToggleClippingMask([layer])) { editor.toggleClippingMask([layer]); return; }
		window.dispatchEvent(new CustomEvent('layerItemClick', { detail: { layerId: layer.id } }));
		if (event.shiftKey && manager.isLayerMultiSelectable(layer)) manager.selectLayerRange(layer.id, { additive: event.ctrlKey || event.metaKey });
		else if ((event.ctrlKey || event.metaKey) && manager.isLayerMultiSelectable(layer)) manager.toggleLayerSelection(layer.id);
		else manager.setActiveLayer(layer.id);
	});
	bindLayerActionMenu(editor, row);
	syncLayerRow(row, layer);
	return row;
}

function getLayerActions(editor, layer) {
	const manager = editor.layerManager, state = getLayerRowState(layer), editable = canEditLayerInStack(layer);
	const selected = manager.isLayerSelected(layer.id) ? manager.getSelectedLayers() : [layer];
	const select = () => { if (!manager.isLayerSelected(layer.id)) manager.setActiveLayer(layer.id); };
	const runSelected = run => () => { select(); run(); };
	const actions = [
		{ id: 'rename', label: 'Rename', disabled: !editable, run: () => renameLayerRow(editor, layer) },
		{ id: 'duplicate', label: 'Duplicate', disabled: !selected.every(canEditLayerInStack), run: runSelected(() => editor.cloneSelectedLayers()) },
		{ id: 'visibility', label: layer.visible ? 'Hide' : 'Show', run: () => manager.toggleLayerVisibility(layer.id) },
		{ id: 'lock', label: layer.locked ? 'Unlock' : 'Lock', disabled: state.lock.permanent, run: () => manager.pressLayerLock(layer) },
		{ id: 'clip', label: selected.every(layer => layer.clipped) ? 'Release Clip' : 'Clip to Layer Below', disabled: !editor.canToggleClippingMask(selected), run: runSelected(() => editor.toggleClippingMask()) },
		...['Forward', 'Backward', 'Front', 'Back'].map(name => {
			const command = COMMANDS[`arrange${name}`];
			return { id: `arrange${name}`, label: command.label, disabled: !selected.some(canEditLayerInStack), run: runSelected(() => command.run(editor)) };
		})
	];
	if (isAnimatableLayerType(layer.type)) actions.push({ id: 'animation', label: 'Add animation', disabled: !editable || (layer.animations?.length || 0) >= CONFIG.tools.animation.maxStackSize, run: () => editor.addAnimation(layer) });
	actions.push({ id: 'delete', label: 'Delete', disabled: state.delete.disabled, run: () => manager.deleteLayerFromRow(layer) });
	return actions;
}

function bindLayerActionMenu(editor, row) {
	const open = event => {
		if (event.type === 'keydown' && event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
		event.preventDefault(); event.stopPropagation();
		const layer = editor.layerManager.getLayerById(row.dataset.layerId);
		openActionMenu({ root: row, trigger: row, actions: getLayerActions(editor, layer), event: event.type === 'contextmenu' ? event : undefined });
	};
	row.addEventListener('contextmenu', open); row.addEventListener('keydown', open);
}

function syncLayerRow(row, layer) {
	if (!layer) { row.remove(); return; }
	const editor = row._editor, manager = editor.layerManager, variant = row.dataset.layerRowVariant;
	row._layer = layer;
	const state = getLayerRowState(layer), description = describeLayer(layer, editor), clip = getClipBase(manager.layers, layer);
	for (const [name, value] of Object.entries({ selected: manager.isLayerSelected(layer.id), active: manager.activeLayerId === layer.id, 'is-hidden': !layer.visible, 'is-locked': Boolean(layer.locked), 'is-clipped': Boolean(clip) })) row.classList.toggle(name, value);
	row.setAttribute('aria-selected', String(manager.isLayerSelected(layer.id))); row.tabIndex = layer.id === manager.activeLayerId ? 0 : -1;
	const name = row.querySelector('.layer-name');
	if (name) { name.textContent = description.name; name.title = `${description.name}\nDouble-click to rename`; }
	const meta = row.querySelector('.list-row-meta');
	meta.replaceChildren();
	if (LAYER_ROW_PARTS.find(part => part.id === 'detail').variants.includes(variant)) {
		const detail = buildElement('layer-type', description.detail); detail.title = description.detail; meta.append(detail);
	}
	if (LAYER_ROW_PARTS.find(part => part.id === 'badges').variants.includes(variant)) for (const config of LAYER_BADGES) {
		const state = config.getState?.(layer);
		if (!state) continue;
		const badge = buildElement('layer-badge', null, 'span'); badge.title = state.title; badge.setAttribute('aria-label', state.title); badge.append(createIcon(config.icon)); meta.append(badge);
	}
	meta.hidden = !meta.children.length;
	const handle = row.querySelector('.list-row-handle');
	handle.disabled = !canEditLayerInStack(layer); handle.setAttribute('aria-label', handle.disabled ? 'Layer is locked' : `Reorder ${description.name}`);
	for (const [key, selector] of Object.entries({ visibility: '.layer-visibility', lock: '.lock', delete: '.delete' })) {
		const button = row.querySelector(selector), values = state[key];
		if (!button) continue;
		button.title = values.title; button.setAttribute('aria-label', values.title); button.disabled = Boolean(values.disabled);
		button.classList.toggle('active', Boolean(values.active)); button.classList.toggle('permanent', Boolean(values.permanent));
		button.classList.toggle('unavailable', Boolean(values.disabled));
		button.querySelector('use').setAttribute('href', `#icon-${values.icon || 'trash'}`);
	}
	row.querySelector('.layer-visibility').classList.toggle('hidden', !layer.visible);
	const clipButton = row.querySelector('.layer-clip'); clipButton.hidden = !clip;
	clipButton.title = clip ? `Release clip to ${describeLayer(clip, editor).name}` : 'Clip to layer below'; clipButton.setAttribute('aria-label', clipButton.title);
	const swatch = row.querySelector('.layer-swatch'), freshSwatch = buildElement('layer-swatch list-row-media');
	manager.renderLayerSwatch(freshSwatch, layer, { compact: variant === 'timeline' });
	freshSwatch.title = `${freshSwatch.title ? `${freshSwatch.title}\n` : ''}${formatKeyLabel('Ctrl/Cmd')}+click to select its pixels`;
	if (swatch.outerHTML !== freshSwatch.outerHTML) {
		for (const attribute of [...swatch.attributes]) swatch.removeAttribute(attribute.name);
		for (const attribute of freshSwatch.attributes) swatch.setAttribute(attribute.name, attribute.value);
		swatch.replaceChildren(...freshSwatch.childNodes);
	}
	const locate = row.querySelector('.goto-glitter');
	if (locate) {
		const source = LAYER_UI_CONFIG[layer.type]?.goTo;
		locate.disabled = !source; locate.classList.toggle('unavailable', !source);
		locate.title = source ? source === 'asset' ? 'Show sticker in Design' : 'Show glitter in Design' : 'No source asset for this layer'; locate.setAttribute('aria-label', locate.title);
	}
}

const LAYER_VISIBILITY_STROKES = new WeakMap();

function isLayerVisibilityStroking(container) { return Boolean(LAYER_VISIBILITY_STROKES.get(container)?.stroke); }

function bindLayerVisibilityStroke(editor, container) {
	if (LAYER_VISIBILITY_STROKES.has(container)) return;
	const state = { stroke: null, suppressClick: false };
	LAYER_VISIBILITY_STROKES.set(container, state);
	const apply = event => {
		const stroke = state.stroke, bounds = container.getBoundingClientRect();
		const top = Math.max(bounds.top, Math.min(stroke.lastY, event.clientY)), bottom = Math.min(bounds.bottom, Math.max(stroke.lastY, event.clientY));
		container.querySelectorAll('.layer-visibility').forEach(button => {
			const rect = button.getBoundingClientRect();
			if (event.clientX < rect.left || event.clientX > rect.right || rect.bottom < top || rect.top > bottom) return;
			const id = button.closest('.layer-item').dataset.layerId;
			if (editor.layerManager.setLayerVisibility(id, stroke.visible)) stroke.changed.add(id);
		});
		stroke.lastY = event.clientY;
	};
	const finish = () => {
		const stroke = state.stroke;
		if (!stroke) return;
		state.stroke = null;
		if (container.hasPointerCapture(stroke.pointerId)) container.releasePointerCapture(stroke.pointerId);
		if (stroke.changed.size) {
			editor.saveState(stroke.visible ? 'Show layers' : 'Hide layers');
			editor.updateStatus(`${stroke.visible ? 'Shown' : 'Hidden'}: ${formatCount(stroke.changed.size, 'layer')}`);
		}
	};
	container.addEventListener('pointerdown', event => {
		if (state.stroke || event.button !== 0 || !event.isPrimary) return;
		state.suppressClick = false;
		const button = event.target.closest('.layer-visibility'), layer = button && editor.layerManager.getLayerById(button.closest('.layer-item').dataset.layerId);
		if (!layer) return;
		event.preventDefault(); event.stopPropagation(); state.suppressClick = true;
		state.stroke = { pointerId: event.pointerId, visible: !layer.visible, lastY: event.clientY, changed: new Set() };
		container.setPointerCapture(event.pointerId); apply(event);
	}, true);
	container.addEventListener('pointermove', event => {
		if (event.pointerId !== state.stroke?.pointerId) return;
		event.preventDefault(); event.stopPropagation(); apply(event);
	}, true);
	for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) container.addEventListener(type, event => {
		if (event.pointerId !== state.stroke?.pointerId) return;
		event.stopPropagation(); if (type === 'pointerup') apply(event); finish();
	}, true);
	window.addEventListener('blur', finish);
	container.addEventListener('click', event => {
		if (!state.suppressClick || event.detail === 0) return;
		state.suppressClick = false; event.preventDefault(); event.stopPropagation();
	}, true);
}

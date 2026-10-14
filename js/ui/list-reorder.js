'use strict';

const LIST_REORDERS = new WeakMap();

function isReordering(container) {
	return Boolean(LIST_REORDERS.get(container)?.dragging);
}

function bindListReorder(container, { item, handle, scroller = container, ids, canDrag, drop = 'between', resolve, commit, keyboard = true }) {
	const existing = LIST_REORDERS.get(container);
	if (existing) return existing;
	const state = { dragging: false };
	LIST_REORDERS.set(container, state);
	const rows = () => [...container.children].filter(row => row.matches(item));
	const ownRow = target => {
		const row = target.closest(item);
		return row?.parentElement === container ? row : null;
	};
	const line = drop === 'between' ? buildElement('list-insertion-line') : null;
	if (line) container.prepend(line);
	let dragged = null, draggedIds = [], destination = null, marked = null, scrollFrame = null, pointer = null;
	const clearTarget = () => {
		line?.classList.remove('visible');
		marked?.classList.remove('is-drop-target');
		marked = null; destination = null;
	};
	const locate = event => {
		clearTarget();
		const bounds = scroller.getBoundingClientRect();
		if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
		const list = rows();
		const target = list.find(row => {
			const rect = row.getBoundingClientRect();
			return event.clientY < (drop === 'onto' ? rect.bottom : rect.top + rect.height / 2);
		}) || list.at(-1);
		if (!target) return;
		const rect = target.getBoundingClientRect();
		if (drop === 'onto' && event.clientY < rect.top) return;
		const place = drop === 'onto' ? 'onto' : event.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
		destination = resolve({ ids: draggedIds, target, place });
		if (!destination) return;
		if (drop === 'onto') { marked = target; target.classList.add('is-drop-target'); return; }
		const index = list.indexOf(target), adjacent = list[index + (place === 'above' ? -1 : 1)];
		let y = place === 'above' ? rect.top : rect.bottom;
		if (adjacent) {
			const neighbor = adjacent.getBoundingClientRect();
			y = (y + (place === 'above' ? neighbor.bottom : neighbor.top)) / 2;
		}
		const height = line.getBoundingClientRect().height;
		const contentY = y - container.getBoundingClientRect().top - container.clientTop + container.scrollTop;
		line.style.top = `${clampNumber(contentY - height / 2, 0, container.scrollHeight - height)}px`;
		line.classList.add('visible');
	};
	const autoScroll = () => {
		if (!state.dragging) return;
		const rect = scroller.getBoundingClientRect(), { zoneSize, speed } = CONFIG.ui.reorder.autoScroll;
		const y = pointer.clientY - rect.top;
		const delta = y >= 0 && y < zoneSize ? -speed : y <= rect.height && y > rect.height - zoneSize ? speed : 0;
		if (delta) { scroller.scrollTop += delta; locate(pointer); }
		scrollFrame = requestAnimationFrame(autoScroll);
	};
	state.pointerDrag = bindPointerDrag(container, {
		threshold: CONFIG.ui.gestures.dragThresholdPx,
		canStart: event => {
			const row = ownRow(event.target);
			if (!row || !canDrag(row, event)) return false;
			const grip = event.target.closest(handle);
			if (event.pointerType === 'touch' && !grip) return false;
			return Boolean(grip || !event.target.closest('button, input, select, textarea, a, [contenteditable]') || event.target.closest('.list-row-content'));
		},
		start: event => { dragged = ownRow(event.target); draggedIds = ids(dragged); },
		activate: event => {
			state.dragging = true;
			rows().forEach(row => row.classList.toggle('is-dragging', ids(row).some(id => draggedIds.includes(id))));
			pointer = event; scrollFrame = requestAnimationFrame(autoScroll);
		},
		move: event => { pointer = event; locate(event); },
		end: (cancelled, press) => {
			const next = destination;
			state.dragging = false;
			cancelAnimationFrame(scrollFrame);
			rows().forEach(row => row.classList.remove('is-dragging'));
			clearTarget();
			if (!cancelled && press.moved && next) commit(next);
			dragged = null; draggedIds = []; pointer = null;
			container.dispatchEvent(new CustomEvent('listreorderend'));
		}
	});
	if (keyboard) container.addEventListener('keydown', event => {
		if (!['ArrowUp', 'ArrowDown'].includes(event.key) || !event.target.closest(handle)) return;
		const row = ownRow(event.target);
		if (!row) return;
		event.preventDefault(); event.stopImmediatePropagation();
		if (!canDrag(row, event)) return;
		const list = rows(), direction = event.key === 'ArrowUp' ? -1 : 1;
		const selected = ids(row);
		const target = list.slice(direction < 0 ? 0 : list.indexOf(row) + 1, direction < 0 ? list.indexOf(row) : undefined);
		if (direction < 0) target.reverse();
		const neighbor = target.find(candidate => !ids(candidate).some(id => selected.includes(id)));
		if (!neighbor) return;
		const next = resolve({ ids: selected, target: neighbor, place: direction < 0 ? 'above' : 'below' });
		if (next) { commit(next); rows().find(candidate => ids(candidate).includes(selected[0]))?.querySelector(handle)?.focus(); }
	});
	return state;
}

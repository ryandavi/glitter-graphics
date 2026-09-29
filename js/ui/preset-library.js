(function (root) {
	'use strict';

	const libraries = new Map();
	const groupSelections = new Map();

	function clone(value) {
		return value == null ? value : structuredClone(value);
	}

	function deepFreeze(value) {
		if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
		Object.values(value).forEach(deepFreeze);
		return Object.freeze(value);
	}

	function freezeEntry(entry, source) {
		if (!entry?.id || !entry.label || !entry.group || !Object.hasOwn(entry, 'value')) {
			throw new Error('preset-library: entries require id, label, group and value');
		}
		return Object.freeze({
			...entry,
			tags: Object.freeze([...(entry.tags || [])]),
			value: deepFreeze(clone(entry.value)),
			source
		});
	}

	function createPresetLibrary({ id, groups = [], entries = [], sources = null, renderThumbnail = null, apply = null }) {
		if (!id) throw new Error('preset-library: id is required');
		const sourceEntries = sources || { builtIn: entries };
		const allEntries = [];
		Object.entries(sourceEntries).forEach(([sourceId, values]) => {
			(values || []).forEach((entry) => allEntries.push(freezeEntry(entry, sourceId)));
		});
		const byId = new Map();
		const groupIds = new Set(groups.map((group) => group.id));
		allEntries.forEach((entry) => {
			if (byId.has(entry.id)) throw new Error(`preset-library: duplicate ${id} entry "${entry.id}"`);
			if (groupIds.size && !groupIds.has(entry.group)) throw new Error(`preset-library: unknown ${id} group "${entry.group}"`);
			byId.set(entry.id, entry);
		});
		const frozenGroups = Object.freeze(groups.map((group) => Object.freeze({ ...group })));
		const library = Object.freeze({
			id,
			groups: frozenGroups,
			entries: Object.freeze(allEntries),
			get(entryId) { return byId.get(entryId) || null; },
			list(groupId = null) { return allEntries.filter((entry) => groupId == null || entry.group === groupId); },
			search(query = '') {
				const needle = String(query).trim().toLowerCase();
				if (!needle) return [...allEntries];
				return allEntries.filter((entry) => [entry.label, entry.id, ...(entry.tags || [])].some((value) => String(value).toLowerCase().includes(needle)));
			},
			renderThumbnail,
			apply(entryOrId, target) {
				const entry = typeof entryOrId === 'string' ? byId.get(entryOrId) : entryOrId;
				if (!entry) return null;
				const value = clone(entry.value);
				if (apply) apply(entry, target, value);
				else if (target && typeof target === 'object') Object.assign(target, value);
				return value;
			}
		});
		libraries.set(id, library);
		return library;
	}

	function renderPresetGrid(container, library, { activeId = null, contextId = null, onChoose = null, groupFilter = null, onGroupChange = null } = {}) {
		if (!container || !library) return;
		container.dataset.presetLibrary = library.id;
		const groupIds = library.groups.length ? library.groups.map((group) => group.id) : [...new Set(library.entries.map((entry) => entry.group))];
		// The group filter always opens on All and only changes when the user
		// picks a group; a newly active tile is scrolled into view instead.
		const selectionKey = contextId == null ? library.id : `${library.id}:${contextId}`;
		let selection = groupSelections.get(selectionKey);
		const revealActive = !selection || selection.activeId !== activeId;
		if (!selection) selection = { activeId, groupId: null };
		selection.activeId = activeId;
		groupSelections.set(selectionKey, selection);

		const render = () => {
			container.replaceChildren();
			if (groupFilter && groupIds.length > 1) {
				const choices = [{ id: null, label: 'All' }, ...library.groups];
				groupFilter.replaceChildren();
				choices.forEach((choice) => {
					const option = document.createElement('option');
					option.value = choice.id || '';
					option.textContent = choice.label;
					option.selected = choice.id === selection.groupId;
					groupFilter.appendChild(option);
				});
				groupFilter.onchange = () => {
					selection.groupId = groupFilter.value || null;
					render();
					onGroupChange?.(selection.groupId);
					groupFilter.focus();
				};
			}

			const visibleGroupIds = groupFilter && selection.groupId ? [selection.groupId] : groupIds;
			visibleGroupIds.forEach((groupId) => {
				const entries = library.list(groupId);
				if (!entries.length) return;
				const group = document.createElement('section');
				group.className = 'preset-grid-group';
				const groupSpec = library.groups.find((candidate) => candidate.id === groupId);
				if (groupSpec?.label && (!groupFilter || !selection.groupId)) {
					const heading = document.createElement('h4');
					heading.className = 'preset-grid-heading';
					heading.textContent = groupSpec.label;
					group.appendChild(heading);
				}
				const options = document.createElement('div');
				options.className = 'preset-grid-options';
				options.setAttribute('role', 'listbox');
				options.setAttribute('aria-label', groupSpec?.label || 'Presets');
				entries.forEach((entry) => {
					const card = document.createElement('button');
					card.type = 'button';
					card.className = 'choice-card preset-grid-option';
					card.dataset.presetId = entry.id;
					card.setAttribute('role', 'option');
					card.setAttribute('aria-selected', String(entry.id === activeId));
					card.classList.toggle('active', entry.id === activeId);
					const thumbnail = document.createElement('span');
					thumbnail.className = 'preset-grid-thumbnail';
					library.renderThumbnail?.(entry, thumbnail);
					const label = document.createElement('span');
					label.className = 'preset-grid-label';
					label.textContent = entry.label;
					card.append(thumbnail, label);
					card.addEventListener('click', () => {
						selection.activeId = entry.id;
						onChoose?.(entry);
					});
					options.appendChild(card);
				});
				group.appendChild(options);
				container.appendChild(group);
			});
		};
		bindPickerNavigation(container, '.preset-grid-option');
		render();
		if (revealActive) revealActiveOption(container);
	}

	// Scrolls only the grid's own scrollbox (never the panel) so a newly
	// active tile below the fold is visible without moving the page.
	function revealActiveOption(container) {
		const card = container.querySelector('.preset-grid-option.active');
		if (!card || container.scrollHeight <= container.clientHeight) return;
		const box = container.getBoundingClientRect();
		const rect = card.getBoundingClientRect();
		if (rect.top >= box.top && rect.bottom <= box.bottom) return;
		container.scrollTop += rect.top - box.top - (box.height - rect.height) / 2;
	}

	// Arrow-key movement shared by every picker (preset grids, the font list).
	// Columns are measured from the focused option, so a tile grid moves by row
	// and a one-column list moves by item. Delegated and bound once per
	// container, so re-rendering the options needs no rebinding.
	function bindPickerNavigation(container, optionSelector) {
		if (!container || container.dataset.pickerNavigation !== undefined) return;
		container.dataset.pickerNavigation = '';
		container.addEventListener('keydown', (event) => {
			const card = event.target.closest?.(optionSelector);
			if (!card || !container.contains(card)) return;
			const cards = [...container.querySelectorAll(optionSelector)];
			const index = cards.indexOf(card);
			const columns = Math.max(1, Math.round((card.parentElement?.clientWidth || card.offsetWidth) / Math.max(1, card.offsetWidth)));
			const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
			if (!Object.hasOwn(offsets, event.key)) return;
			event.preventDefault();
			cards[Math.max(0, Math.min(cards.length - 1, index + offsets[event.key]))]?.focus();
		});
	}

	function getPresetLibrary(id) {
		return libraries.get(id) || null;
	}

	function listPresetLibraries() {
		return [...libraries.values()];
	}

	const api = { createPresetLibrary, renderPresetGrid, bindPickerNavigation, getPresetLibrary, listPresetLibraries };
	root.GlitterPresetLibrary = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);

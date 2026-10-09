const EDITOR_DISCLOSURE_METHODS = {
initializeCollapsibleSections() {
		// The Inspector's switched panels by sectionPrefix. `.visible` on a host
		// follows the selection and the tool (updateSidePanelUI); of the visible
		// ones exactly one is open, and the header's switch chooses which.
		this.switchPanels = new Map(Object.values(PANEL_SCHEMAS)
			.flatMap((schema) => [schema, ...(schema.auxiliarySections || [])])
			.filter((schema) => schema.sectionPrefix)
			.map((schema) => [schema.sectionPrefix, schema]));
		const sections = [...this.switchPanels.keys()];

		const applyOpen = (name, isOpen) => setCollapsibleSectionState(
			document.getElementById(`${name}Section`), document.getElementById(`${name}Content`), null, isOpen);
		const setOpen = (name, isOpen) => {
			if (isOpen) sections.forEach((other) => applyOpen(other, other === name));
			else applyOpen(name, false);
			this.syncInspectorHeader();
		};
		this.setCollapsibleSectionOpen = setOpen;

		this.syncCollapsibleSections = (preferredName = null) => {
			const visibleSections = this.getVisibleSwitchPanels();
			if (!visibleSections.length) {
				this.syncInspectorHeader();
				return;
			}
			const open = visibleSections.find((name) => document.getElementById(`${name}Section`).classList.contains('is-open'));
			setOpen(visibleSections.includes(preferredName) ? preferredName : (open || visibleSections[0]), true);
		};

		// The Library is never collapsed: its window or drawer opens and closes.
		setCollapsibleSectionState(document.getElementById('designGallerySection'),
			document.getElementById('designGalleryContent'), null, true);
		this.syncCollapsibleSections();
		this.initializeIndependentCollapsibles();

		this.setSettingsEmptyState('layerSettings', true, { title: 'No layer selected', subtext: '' });
		this.setSettingsEmptyState('glitterSettings', true);
		this.setSettingsEmptyState('stickerSettings', true);
	}

	// The Layers column's sections collapse independently (both can stay open).
,
	initializeIndependentCollapsibles() {
		CONFIG.ui.independentCollapsibleSections.forEach((name) => {
			const section = document.getElementById(`${name}Section`);
				const header = document.getElementById(`${name}Header`);
				const toggle = document.getElementById(`${name}Toggle`);
				const content = section?.querySelector(':scope > .section-content');
				if (!section || !header || !toggle || !content) return;

				const setOpen = (isOpen) => {
					setCollapsibleSectionState(section, content, toggle, isOpen);
				};
			setOpen(true);

			header.addEventListener('click', (event) => {
				if (event.target.closest('[data-no-accordion-toggle]')) return;
				// On mobile these sections live in drawers with their own header
				// behavior — mirror the design gallery's guard.
				if (this.mobileManager?.isMobile) return;
				const isOpen = !section.classList.contains('is-open');
				setOpen(isOpen);
				if (isOpen) requestAnimationFrame(() => header.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
			});
		});
	}

	// Reusable "Advanced" disclosure. One delegated click handler drives
	// every `[data-advanced]` block (Glitter Properties, text/shape effect cards),
	// so all instances behave identically. Collapsed by default; open state is
	// intentionally NOT persisted — it resets each session/relayout.
,
	initializeAdvancedDisclosures() {
		const initializeSubsections = (root = document) => {
			const cards = [];
			if (root.matches?.('.property-card')) cards.push(root);
			root.querySelectorAll?.('.property-card').forEach((card) => cards.push(card));
			// R5: give every effect module its collapsed one-line summary.
			initializeModuleSummaries(root.querySelectorAll ? root : document);
			cards.map((card) => card.querySelector(':scope > .property-card-title')).filter(Boolean).forEach((title) => {
				const subsection = title.parentElement;
				const enabled = title.querySelector('input[data-effect-toggle]');
				// Every titled section collapses, so the panel behaves one way. Two
				// exceptions: a section nested in another is a labelled set, and a
				// form modal's groups stay open so its search can always show a row.
				const collapsible = !subsection.parentElement.closest('.property-card') && !subsection.closest('.modal-form');
				if (collapsible) {
					if (subsection.dataset.collapsibleCard === undefined) applyPanelCardState(subsection);
					subsection.dataset.collapsibleCard = '';
					title.dataset.cardToggle = '';
					title.setAttribute('role', 'button');
					title.setAttribute('tabindex', '0');
					title.setAttribute('aria-expanded', subsection.classList.contains('is-collapsed') ? 'false' : 'true');
					if (!title.querySelector('.property-card-chevron')) {
						const chevron = document.createElement('span');
						chevron.className = 'property-card-chevron icon-wrapper';
						chevron.appendChild(createIcon('chevron-down'));
						title.appendChild(chevron);
					}
				}
				if (enabled) syncPanelEffectToggle(enabled, enabled.checked);
			});
		};
		initializeSubsections();
		new MutationObserver((mutations) => {
			mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
				if (node.nodeType === Node.ELEMENT_NODE) initializeSubsections(node);
			}));
		}).observe(document.body, { childList: true, subtree: true });
		// Disabled effect cards stay collapsible and expose an inert preview when
		// manually expanded.
		const toggleSubsection = (toggle) => {
			const subsection = toggle.closest('[data-collapsible-card]');
			if (!subsection) return;
			const isCollapsed = subsection.classList.toggle('is-collapsed');
			toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
			rememberPanelCardState(subsection);
		};
		// Every schema effect toggle uses the same expansion/state contract.
		document.addEventListener('change', (event) => {
			const checkbox = event.target;
			if (!checkbox.matches?.('.property-card-title input[data-effect-toggle]')) return;
			syncPanelEffectToggle(checkbox, checkbox.checked);
		});
		// Interactive controls living in the title (Enabled/Global checkboxes,
		// reset chips) must not also collapse the subsection when clicked.
		const isTitleControl = (target) => Boolean(target.closest?.('.property-header-switch, button, input, select'));
		document.addEventListener('click', (event) => {
			const subsectionToggle = event.target.closest('[data-card-toggle]');
			if (subsectionToggle) {
				if (isTitleControl(event.target)) return;
				toggleSubsection(subsectionToggle);
				return;
			}
			const setToggle = event.target.closest('[data-set-toggle]');
			if (setToggle) {
				const set = setToggle.parentElement;
				setPanelCardCollapsed(set, !set.classList.contains('is-collapsed'));
				rememberPanelCardState(set);
				return;
			}
			const toggle = event.target.closest('[data-advanced-toggle]');
			if (!toggle) return;
			const disclosure = toggle.closest('[data-advanced]');
			if (!disclosure) return;
			setAdvancedDisclosureOpen(disclosure, !disclosure.classList.contains('is-open'));
		});
		document.addEventListener('keydown', (event) => {
			const toggle = event.target.closest?.('[data-card-toggle]');
			if (!toggle || (event.key !== 'Enter' && event.key !== ' ')) return;
			if (isTitleControl(event.target)) return;
			event.preventDefault();
			toggleSubsection(toggle);
		});
	}

	// The colorAdjust that tints a layer's layers-list swatch — the FILL slot's,
	// since that's the glitter the swatch shows. A sticker's swatch is its image.
,
	getLayerFillColorAdjust(layer) {
		if (layer?.type === LayerType.STICKER) return layer.stickerData?.colorAdjust;
		return getLayerFillSlot(layer)?.colorAdjust;
	}

	// Tint the layers-list swatch + mobile swatch for any glitter-bearing layer to
	// match its fill hue. Render paths bake this in too; this is the live-drag path
	// that updates without a full list re-render. Shared by all three layer types.
,
	refreshLayerSwatchFilter(layer) {
		if (!layer) return;
		const filter = buildCssColorFilter(this.getLayerFillColorAdjust(layer));

		const listSwatch = this.layerManager.layersListContainer
			?.querySelector(`[data-layer-id="${layer.id}"] .layer-swatch`);
		if (listSwatch) listSwatch.style.filter = filter;

		if (this.layerManager.activeLayerId === layer.id) {
			const mobileSwatch = document.querySelector('.mobile-layers-swatch');
			if (mobileSwatch) mobileSwatch.style.filter = filter;
		}
	}

	// Glitter-fill: also tint the Glitter Properties asset-info thumbnail. Text and
	// shape tint their own per-slot chips in their managers (refreshSlotSwatch).
,
	refreshGlitterSwatchVisuals(layer) {
		if (!layer || layer.type !== LayerType.GLITTER_FILL) return;
		const thumb = document.getElementById('glitterFillGlitterChip');
		if (thumb) thumb.style.filter = buildCssColorFilter(layer.fill.colorAdjust);
		this.refreshLayerSwatchFilter(layer);
	}

	// A form modal: a property section holding a note and one titled card per
	// command group, each command a property row whose control is its chips.
,
	initializeShortcutsModal() {
		const section = document.getElementById('shortcutSection');
		if (!section) return;
		section.classList.add('property-section');
		const content = panelDiv('section-content');
		const description = panelDiv('property-note');
		description.id = 'shortcutViewDescription';
		const list = panelDiv('settings-subsection');
		list.id = 'shortcutList';
		content.append(description, list);
		section.replaceChildren(content);
		// Native modifier names come from js/core/key-labels.js, shared with the
		// guide so the two never disagree about what a key is called here.
		const keyLabels = getKeyLabels();
		const gestureDescriptions = {
			keyboard: 'Shortcuts use the keys for this device. Alternate bindings are separated by “or.”',
			gesture: 'Trackpad, touch, and pointer controls remain available without changing tools unless noted.'
		};
		description.textContent = gestureDescriptions.keyboard;
		const deviceIcons = {
			trackpad: 'icon-arrows-left-right',
			touch: 'icon-hand-pointer',
			pointer: 'icon-pointer'
		};
		const formatKey = (label) => formatKeyLabel(label, keyLabels);
		const buildShortcutToken = (label, type = 'key', device = null) => {
			const token = document.createElement('span');
			token.className = `shortcut-input-token ${type === 'gesture' ? 'shortcut-gesture' : 'kbd'}`;
			if (type === 'gesture') {
				const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
				icon.setAttribute('class', 'icon shortcut-device-icon');
				icon.setAttribute('aria-hidden', 'true');
				const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
				use.setAttribute('href', `#${deviceIcons[device] || 'icon-pointer'}`);
				icon.appendChild(use);
				token.appendChild(icon);
			}
			const text = document.createElement('span');
			text.textContent = label;
			token.appendChild(text);
			return token;
		};
		const appendKeyboardBinding = (container, command) => {
			command.displayKey.split(' / ').forEach((alternative, index) => {
				if (index) {
					const separator = document.createElement('span');
					separator.className = 'shortcut-alternative';
					separator.textContent = 'or';
					container.appendChild(separator);
				}
				const binding = document.createElement('span');
				binding.className = 'shortcut-binding';
				alternative.split(' + ').forEach((part) => {
					binding.appendChild(buildShortcutToken(formatKey(part)));
				});
				container.appendChild(binding);
			});
		};
		const appendGestureBinding = (container, command) => {
			const binding = command.binding;
			(binding.modifiers || []).forEach((modifier) => {
				const labels = { alt: 'Alt', shift: 'Shift', control: 'Control', command: 'Cmd' };
				container.appendChild(buildShortcutToken(formatKey(labels[modifier] || modifier)));
			});
			container.appendChild(buildShortcutToken(binding.gesture, 'gesture', binding.device));
		};

		['keyboard', 'gesture'].forEach((kind) => getShortcutGroups(kind).forEach(({ title: groupTitle, items }) => {
			// `shortcut-group` / `shortcut-item` are hooks for the scope switch
			// and the search filter.
			const group = buildPanelItem({ kind: 'section', title: groupTitle, sets: [{ rows: items.map((command) => ({
				kind: 'labeled', label: command.label, stacked: false, rowClasses: 'shortcut-item',
				control: { kind: 'host', classes: 'shortcut-keys shortcut-sequence' }
			})) }] });
			group.classList.add('shortcut-group');
			group.dataset.shortcutKind = kind;
			group.hidden = kind !== 'keyboard';

			const rows = group.querySelectorAll('.shortcut-item');
			items.forEach((command, index) => {
				const item = rows[index];
				const keys = item.querySelector('.shortcut-keys');
				item.dataset.searchAliases = `${command.displayKey || ''} ${command.binding?.device || ''} ${command.binding?.gesture || ''} ${(command.binding?.modifiers || []).join(' ')}`;

				if (command.instruction) {
					const instruction = document.createElement('span');
					instruction.className = 'shortcut-instruction';
					instruction.textContent = command.instruction;
					keys.appendChild(instruction);
				}

				if (kind === 'gesture') appendGestureBinding(keys, command);
				else appendKeyboardBinding(keys, command);
			});

			list.appendChild(group);
		}));
		finishPanelMarkup(section);

		// Keyboard vs Canvas Gestures narrows which commands are listed — it is a
		// scope filter, not a set of pages — so it uses the shared segmented
		// control in the chrome bar, alongside the text filter it works with.
		const scopeButtons = Array.from(document.querySelectorAll('#shortcutsModal [data-shortcut-view]'));
		const setView = (kind, options = {}) => {
			scopeButtons.forEach((button) => {
				const active = button.dataset.shortcutView === kind;
				button.classList.toggle('active', active);
				button.setAttribute('aria-pressed', String(active));
			});
			list.querySelectorAll('.shortcut-group').forEach((group) => {
				group.hidden = group.dataset.shortcutKind !== kind;
			});
			description.textContent = gestureDescriptions[kind];
			this.shortcutsFilter?.refresh();
			if (options.focus) scopeButtons.find((button) => button.dataset.shortcutView === kind)?.focus();
		};
		scopeButtons.forEach((button, index) => {
			button.addEventListener('click', () => setView(button.dataset.shortcutView));
			button.addEventListener('keydown', (event) => {
				if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
				event.preventDefault();
				const direction = event.key === 'ArrowRight' ? 1 : -1;
				const next = scopeButtons[(index + direction + scopeButtons.length) % scopeButtons.length];
				setView(next.dataset.shortcutView, { focus: true });
			});
		});
	}

,
	initializeModalFilters() {
		this.shortcutsFilter = createModalFilter({
			root: '#shortcutsModal',
			inputSelector: '#shortcutSearch',
			clearSelector: '[data-modal-filter-clear]',
			statusSelector: '#shortcutSearchStatus',
			emptySelector: '#shortcutSearchEmpty',
			itemSelector: '.shortcut-item',
			groupSelector: '.shortcut-group',
			groupTitleSelector: '.property-card-title',
			singularLabel: 'shortcut',
			pluralLabel: 'shortcuts'
		});
		this.exportSettingsFilter = createModalFilter({
			root: '#exportSettingsModal',
			inputSelector: '#exportSettingsSearch',
			clearSelector: '[data-modal-filter-clear]',
			statusSelector: '#exportSettingsSearchStatus',
			emptySelector: '#exportSettingsSearchEmpty',
			itemSelector: '.settings-row',
			groupSelector: '.settings-group',
			groupTitleSelector: '.property-card-title',
			singularLabel: 'setting',
			pluralLabel: 'settings'
		});
		this.settingsFilter = createModalFilter({
			root: '#settingsModal',
			inputSelector: '#settingsSearch',
			clearSelector: '[data-modal-filter-clear]',
			statusSelector: '#settingsSearchStatus',
			emptySelector: '#settingsSearchEmpty',
			itemSelector: '.settings-row',
			groupSelector: '.settings-group',
			groupTitleSelector: '.property-card-title',
			singularLabel: 'setting',
			pluralLabel: 'settings'
		});
	}
};

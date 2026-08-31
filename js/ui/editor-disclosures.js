const EDITOR_DISCLOSURE_METHODS = {
initializeCollapsibleSections() {
		const sections = ['designGallery', 'autoGlitterSettings', 'baseLayerSettings', 'layerSettings', 'glitterSettings', 'stickerSettings', 'textSettings', 'shapeSettings', 'brushSettings'];

			const setOpen = (name, isOpen, accordion = false) => {
				const section = document.getElementById(`${name}Section`);
				const content = document.getElementById(`${name}Content`);
				const toggle = document.getElementById(`${name}Toggle`);
				setCollapsibleSectionState(section, content, toggle, isOpen);

			if (isOpen && accordion && CONFIG.layers.ui.designPanelAccordion) {
				const isMobile = this.mobileManager?.isMobile;
				sections.forEach((other) => {
					if (other === name) return;
					// On mobile, the Design Gallery lives in its own tab/drawer,
					// separate from the settings sections' drawer — opening one
					// shouldn't collapse the other.
					if (isMobile && (other === 'designGallery' || name === 'designGallery')) return;
					setOpen(other, false, false);
				});
			}
		};
		this.setCollapsibleSectionOpen = setOpen;

		this.syncCollapsibleSections = (preferredName = null) => {
			const visibleSections = sections.filter((name) => {
				const section = document.getElementById(`${name}Section`);
				if (!section) return false;
				return name === 'designGallery' || section.classList.contains('visible');
			});

			if (!visibleSections.length) {
				return;
			}

			const openSections = visibleSections.filter((name) => {
				const content = document.getElementById(`${name}Content`);
				return content?.classList.contains('visible');
			});

			const targetName = visibleSections.includes(preferredName)
				? preferredName
				: (openSections[0] || visibleSections[0]);

			const isMobile = this.mobileManager?.isMobile;
			sections.forEach((name) => {
				// Same mobile scoping as the accordion sweep above: Design Gallery
				// and the settings sections live in separate drawers on mobile, so
				// syncing toward one shouldn't touch the other's open state.
				if (isMobile && (name === 'designGallery') !== (targetName === 'designGallery')) {
					return;
				}
				const shouldOpen = name === targetName;
				setOpen(name, shouldOpen, false);
			});
		};

		sections.forEach((name) => {
			const header = document.getElementById(`${name}Header`);
			const content = document.getElementById(`${name}Content`);
			const toggle = document.getElementById(`${name}Toggle`);
			if (!header || !content || !toggle) return;

			// Start with Design open and the rest collapsed
			setOpen(name, name === 'designGallery');

			header.addEventListener('click', (event) => {
				if (event.target.closest('[data-no-accordion-toggle]')) {
					return;
				}

				// On mobile the design drawer's header closes the drawer
				// (MobileManager) — accordion-collapsing the gallery there would
				// make the next drawer open show a bare header bar.
				if (name === 'designGallery' && this.mobileManager?.isMobile) {
					return;
				}

				const isOpen = !content.classList.contains('visible');
				setOpen(name, isOpen, true);
				if (isOpen) requestAnimationFrame(() => header.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
			});
		});

		this.syncCollapsibleSections('designGallery');
		this.initializeIndependentCollapsibles();

		this.setSettingsEmptyState('layerSettings', true, { title: 'No layer selected', subtext: '' });
		this.setSettingsEmptyState('glitterSettings', true);
		this.setSettingsEmptyState('stickerSettings', true);
	}

	// Image and Layers sections collapse independently (both can stay open) —
	// same header/chevron conventions as the design panel, minus the accordion.
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

	// Reusable "Advanced" disclosure (WP4). One delegated click handler drives
	// every `[data-advanced]` block (Glitter Properties, text/shape effect cards),
	// so all instances behave identically. Collapsed by default; open state is
	// intentionally NOT persisted — it resets each session/relayout.
,
	initializeAdvancedDisclosures() {
		const initializeSubsections = (root = document) => {
			const cards = [];
			if (root.matches?.('.subsection-content-group')) cards.push(root);
			root.querySelectorAll?.('.subsection-content-group').forEach((card) => cards.push(card));
			cards.forEach((card) => ensureSubsectionCardBody(card));
			// Rule A: drop a block title that only repeats its single row's label.
			cards.forEach((card) => dedupeBlockTitle(card));
			// R5: give every effect module its collapsed one-line summary.
			initializeModuleSummaries(root.querySelectorAll ? root : document);
			cards.map((card) => card.querySelector(':scope > .subsection-title')).filter(Boolean).forEach((title) => {
				const subsection = title.parentElement;
				if (!subsection || subsection.classList.contains('subsection-section-group')) return;
				const enabled = title.querySelector('input[data-effect-toggle]');
				// Collapsibility is OPT-IN (property-panel rule E, depth budget).
				// Two things earn a chevron: an effect/module card, whose Enabled
				// toggle already owns an expansion contract, and a block the schema
				// explicitly marks `collapsible`. Every other titled block is a plain
				// run of rows — spacing and typography carry the hierarchy, so a
				// panel can no longer accumulate a collapsible level per card.
				if (subsection.dataset.collapsible !== undefined || enabled) {
					subsection.dataset.collapsibleSubsection = '';
					title.dataset.subsectionToggle = '';
					title.setAttribute('role', 'button');
					title.setAttribute('tabindex', '0');
					title.setAttribute('aria-expanded', 'true');
					if (!title.querySelector('.subsection-chevron')) {
						const chevron = document.createElement('span');
						chevron.className = 'subsection-chevron icon-wrapper';
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
			const subsection = toggle.closest('[data-collapsible-subsection]');
			if (!subsection) return;
			const isCollapsed = subsection.classList.toggle('is-collapsed');
			toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
		};
		// Every schema effect toggle uses the same expansion/state contract.
		document.addEventListener('change', (event) => {
			const checkbox = event.target;
			if (!checkbox.matches?.('.subsection-title input[data-effect-toggle]')) return;
			syncPanelEffectToggle(checkbox, checkbox.checked);
		});
		// Interactive controls living in the title (Enabled/Global checkboxes,
		// reset chips) must not also collapse the subsection when clicked.
		const isTitleControl = (target) => Boolean(target.closest?.('.checkbox-group, button, input, select'));
		document.addEventListener('click', (event) => {
			const subsectionToggle = event.target.closest('[data-subsection-toggle]');
			if (subsectionToggle) {
				if (isTitleControl(event.target)) return;
				toggleSubsection(subsectionToggle);
				return;
			}
			const toggle = event.target.closest('[data-advanced-toggle]');
			if (!toggle) return;
			const disclosure = toggle.closest('[data-advanced]');
			if (!disclosure) return;
			const isOpen = disclosure.classList.toggle('is-open');
			toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
		});
		document.addEventListener('keydown', (event) => {
			const toggle = event.target.closest?.('[data-subsection-toggle]');
			if (!toggle || (event.key !== 'Enter' && event.key !== ' ')) return;
			if (isTitleControl(event.target)) return;
			event.preventDefault();
			toggleSubsection(toggle);
		});
	}

	// Reads the three HSB sliders for a given prefix ('glitter', or a text slot)
	// into a colorAdjust object. Missing sliders fall back to identity.
,
	readColorAdjust(prefix) {
		const num = (id, fallback) => {
			const el = document.getElementById(id);
			const value = el ? parseInt(el.value, 10) : NaN;
			return Number.isFinite(value) ? value : fallback;
		};
		const cap = prefix.charAt(0).toUpperCase() + prefix.slice(1);
		return {
			hue: num(prefix + 'Hue', 0),
			saturation: num(prefix + 'Saturation', 100),
			brightness: num(prefix + 'Brightness', 100)
		};
	}

	// Push a colorAdjust object out to the three HSB sliders + value displays for
	// a prefix. Absent adjust reads as identity.
,
	applyColorAdjustToSliders(prefix, adjust) {
		const a = normalizeColorAdjust(adjust);
		const set = (id, value, suffix) => {
			const slider = document.getElementById(id);
			const display = document.getElementById(id + 'Value');
			if (slider) slider.value = String(value);
			if (display) display.innerHTML = formatUnit(value, suffix);
		};
		set(prefix + 'Hue', a.hue, '°');
		set(prefix + 'Saturation', a.saturation, '%');
		set(prefix + 'Brightness', a.brightness, '%');
		this.updateResetButton(prefix + 'Hue');
		this.updateResetButton(prefix + 'Saturation');
		this.updateResetButton(prefix + 'Brightness');
	}

	// The colorAdjust that tints a layer's layers-list swatch — the FILL slot's,
	// since that's the glitter the swatch shows. Fill aliases layer.settings for
	// glitter-fill + text; shapes keep it on shapeData.fill.
,
	getLayerFillColorAdjust(layer) {
		if (!layer) return null;
		if (layer.type === LayerType.SHAPE) return layer.shapeData?.fill?.colorAdjust;
		if (layer.type === LayerType.BASE_IMAGE) return layer.background?.colorAdjust;
		if (layer.type === LayerType.STICKER) return layer.stickerData?.colorAdjust;
		return layer.settings?.colorAdjust;
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
		const thumb = document.getElementById('glitterAssetThumbnail');
		if (thumb) thumb.style.filter = buildCssColorFilter(layer.settings?.colorAdjust);
		this.refreshLayerSwatchFilter(layer);
	}

	// Wire the Glitter Properties HSB sliders (fill layers). Each live-updates its
	// display, saves the layer settings (which now carry colorAdjust), refreshes
	// the preview, and records one history entry on release.
,
	setupColorAdjustListeners() {
		const specs = [
			['glitterHue', '°'],
			['glitterSaturation', '%'],
			['glitterBrightness', '%']
		];

		specs.forEach(([id, suffix]) => {
			const slider = document.getElementById(id);
			const display = document.getElementById(id + 'Value');
			if (!slider) return;

			const resetBtn = document.getElementById('reset' + id.charAt(0).toUpperCase() + id.slice(1));

			bindSlider(slider, display, {
				suffix,
				resetValue: this.getResetValueForSlider(id),
				resetButton: resetBtn,
				apply: () => {
					this.saveActiveLayerSettings();
					this.refreshGlitterSwatchVisuals(this.layerManager.getActiveLayer());
					this.debouncedSliderUpdate();
				},
				onCommit: () => this.saveState('Edit appearance')
			});
		});
	}

,
	initializeShortcutsModal() {
		const list = document.getElementById('shortcutList');
		if (!list) return;
		list.replaceChildren();
		const platform = navigator.userAgentData?.platform || navigator.platform || '';
		const isMac = /mac/i.test(platform);
		const keyLabels = isMac
			? { 'Ctrl/Cmd': '⌘', Cmd: '⌘', Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧' }
			: { 'Ctrl/Cmd': 'Ctrl', Cmd: 'Ctrl', Control: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Option: 'Alt', Shift: 'Shift' };
		const gestureDescriptions = {
			keyboard: 'Shortcuts use the keys for this device. Alternate bindings are separated by “or.”',
			gesture: 'Trackpad, touch, and pointer controls remain available without changing tools unless noted.'
		};
		const deviceIcons = {
			trackpad: 'icon-arrows-left-right',
			touch: 'icon-hand-pointer',
			pointer: 'icon-pointer'
		};
		const formatKey = (label) => keyLabels[label] || label;
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
			const group = document.createElement('div');
			group.className = 'shortcut-group';
			group.dataset.shortcutKind = kind;
			group.hidden = kind !== 'keyboard';

			const title = document.createElement('div');
			title.className = 'shortcut-group-title';
			title.textContent = groupTitle;
			group.appendChild(title);

			items.forEach((command) => {
				const item = document.createElement('div');
				item.className = 'shortcut-item';

				const action = document.createElement('div');
				action.className = 'shortcut-action';
				action.textContent = command.label;

				const keys = document.createElement('div');
				keys.className = 'shortcut-keys shortcut-sequence';
				item.dataset.searchAliases = `${command.displayKey || ''} ${command.binding?.device || ''} ${command.binding?.gesture || ''} ${(command.binding?.modifiers || []).join(' ')}`;

				if (command.instruction) {
					const instruction = document.createElement('span');
					instruction.className = 'shortcut-instruction';
					instruction.textContent = command.instruction;
					keys.appendChild(instruction);
				}

				if (kind === 'gesture') appendGestureBinding(keys, command);
				else appendKeyboardBinding(keys, command);

				item.appendChild(action);
				item.appendChild(keys);
				group.appendChild(item);
			});

			list.appendChild(group);
		}));

		// Keyboard vs Canvas Gestures narrows which commands are listed — it is a
		// scope filter, not a set of pages — so it uses the shared segmented
		// control in the chrome bar, alongside the text filter it works with.
		const scopeButtons = Array.from(document.querySelectorAll('#shortcutsModal [data-shortcut-view]'));
		const description = document.getElementById('shortcutViewDescription');
		const setView = (kind, options = {}) => {
			scopeButtons.forEach((button) => {
				const active = button.dataset.shortcutView === kind;
				button.classList.toggle('active', active);
				button.setAttribute('aria-pressed', String(active));
			});
			list.querySelectorAll('.shortcut-group').forEach((group) => {
				group.hidden = group.dataset.shortcutKind !== kind;
			});
			if (description) description.textContent = gestureDescriptions[kind];
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
			groupTitleSelector: '.shortcut-group-title',
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
			groupTitleSelector: '.settings-group-title',
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
			groupTitleSelector: '.settings-group-title',
			singularLabel: 'setting',
			pluralLabel: 'settings'
		});
	}
};

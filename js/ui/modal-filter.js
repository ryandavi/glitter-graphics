// Filters repeated modal items without taking ownership of their native
// hidden state, which remains available for format and feature gating.
function createModalFilter(options) {
	const root = typeof options.root === 'string' ? document.querySelector(options.root) : options.root;
	const input = root?.querySelector(options.inputSelector);
	const clearButton = root?.querySelector(options.clearSelector);
	const status = root?.querySelector(options.statusSelector);
	const emptyState = root?.querySelector(options.emptySelector);
	if (!root || !input) return null;

	const normalize = (value) => String(value || '')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
	const equivalentTerms = [
		{ pattern: /\b(ctrl|control|cmd|command|meta)\b/, terms: 'ctrl control cmd command meta' },
		{ pattern: /\b(alt|option)\b/, terms: 'alt option' }
	];
	const expandAliases = (value) => {
		const normalized = normalize(value);
		const aliases = equivalentTerms
			.filter(({ pattern }) => pattern.test(normalized))
			.map(({ terms }) => terms);
		return [normalized, ...aliases].join(' ');
	};
	// Buttons and badges in a group heading are chrome, not searchable content:
	// indexing them made every row under "Optimization · Advanced" match
	// "advanced", and every group with a Reset button match "reset".
	const readableText = (element) => {
		if (!element) return '';
		const copy = element.cloneNode(true);
		copy.querySelectorAll('button, .badge').forEach((node) => node.remove());
		return copy.textContent || '';
	};

	let groups = [];
	let records = [];
	const collect = () => {
		groups = Array.from(root.querySelectorAll(options.groupSelector));
		records = Array.from(root.querySelectorAll(options.itemSelector)).map((item) => {
			const group = item.closest(options.groupSelector);
			const groupTitle = readableText(group?.querySelector(options.groupTitleSelector));
			const itemText = readableText(item);
			return {
				item,
				group,
				// A preset row owns the rows beneath it, so it stays visible
				// whenever anything in its group matches — otherwise a match on
				// a governed row leaves an indented rail under no heading.
				isPinned: item.hasAttribute('data-filter-pin'),
				searchText: expandAliases(`${groupTitle} ${itemText} ${item.dataset.searchAliases || ''}`)
			};
		});
	};

	const apply = () => {
		const query = normalize(input.value);
		const terms = query.split(' ').filter(Boolean);
		let matchCount = 0;

		records.forEach((record) => {
			const isAvailable = !record.item.hidden && !record.group?.hidden;
			const isMatch = !terms.length || (isAvailable && terms.every((term) => record.searchText.includes(term)));
			record.item.classList.toggle('is-filtered-out', !isMatch);
			if (terms.length && isMatch) matchCount++;
		});

		groups.forEach((group) => {
			const groupRecords = records.filter((record) => record.group === group);
			const isVisible = (record) => !record.item.classList.contains('is-filtered-out');
			const hasGovernedMatch = groupRecords.some((record) => !record.isPinned && isVisible(record));
			groupRecords.forEach((record) => {
				if (record.isPinned && hasGovernedMatch) record.item.classList.remove('is-filtered-out');
			});
			group.classList.toggle('is-filtered-out', terms.length > 0 && !groupRecords.some(isVisible));
		});

		// Collapsed disclosures inside the body have to open while a query is
		// active, or a matching row would be filtered "in" but still hidden.
		root.classList.toggle('is-filtering', terms.length > 0);
		if (clearButton) clearButton.hidden = !terms.length;
		if (emptyState) emptyState.hidden = !terms.length || matchCount > 0;
		if (status) {
			status.textContent = terms.length
				? `${matchCount} ${matchCount === 1 ? options.singularLabel : options.pluralLabel}`
				: '';
		}
	};
	const reset = () => {
		input.value = '';
		apply();
	};
	const refresh = () => {
		collect();
		apply();
	};

	input.addEventListener('input', apply);
	input.addEventListener('keydown', (event) => {
		if (event.key !== 'Escape' || !input.value) return;
		event.preventDefault();
		event.stopPropagation();
		reset();
	});
	clearButton?.addEventListener('click', () => {
		reset();
		input.focus();
	});
	refresh();

	return { apply, reset, refresh };
}

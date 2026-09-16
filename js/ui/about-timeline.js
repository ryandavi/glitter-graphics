'use strict';

/**
 * Renders the Preservation modal's Timeline section from ABOUT_TIMELINE (see
 * js/ui/about-timeline-data.js) and wires up its Topic/Country/Decade/company
 * filters. modals-wiring.js calls this from preservationModal's onContentLoaded,
 * before initDocumentModalNavigation indexes the modal for search — so the
 * page's search box sees the (unfiltered) rendered entries too.
 */
function initPreservationTimeline(modalBody) {
	const filtersEl = modalBody.querySelector('#PreservationTimelineFilters');
	const listEl = modalBody.querySelector('#PreservationTimelineList');
	const summaryEl = modalBody.querySelector('#PreservationTimelineSummary');
	if (!filtersEl || !listEl || !summaryEl || typeof ABOUT_TIMELINE === 'undefined') return;
	if (filtersEl.dataset.initialized === 'true') return;
	filtersEl.dataset.initialized = 'true';

	const state = { topic: 'all', country: 'all', decade: 'all', entity: '' };

	const makeSelect = (id, labelText, options) => {
		const wrap = document.createElement('div');
		wrap.className = 'timeline-filter';
		const label = document.createElement('label');
		label.htmlFor = id;
		label.textContent = labelText;
		const select = document.createElement('select');
		select.id = id;
		options.forEach(({ value, label: text }) => {
			const opt = document.createElement('option');
			opt.value = value;
			opt.textContent = text;
			select.appendChild(opt);
		});
		wrap.append(label, select);
		return { wrap, select };
	};

	// Counts let someone judge a filter before touching it ("Search Engines
	// (11)" vs. a blind label) instead of only finding out after selecting.
	const tagCounts = {};
	const countryCounts = {};
	const decadeCounts = {};
	ABOUT_TIMELINE.forEach(item => {
		item.tags.forEach(tag => { tagCounts[tag] = (tagCounts[tag] || 0) + 1; });
		if (item.country) countryCounts[item.country] = (countryCounts[item.country] || 0) + 1;
		if (item.decade) decadeCounts[item.decade] = (decadeCounts[item.decade] || 0) + 1;
	});

	const topicOptions = [{ value: 'all', label: 'All topics' }].concat(
		Object.keys(tagCounts)
			.sort((a, b) => (ABOUT_TIMELINE_TAG_LABELS[a] || a).localeCompare(ABOUT_TIMELINE_TAG_LABELS[b] || b))
			.map(tag => ({ value: tag, label: `${ABOUT_TIMELINE_TAG_LABELS[tag] || tag} (${tagCounts[tag]})` }))
	);
	const countryOptions = [{ value: 'all', label: 'All countries' }].concat(
		Object.keys(countryCounts)
			.sort((a, b) => (ABOUT_TIMELINE_COUNTRY_LABELS[a] || a).localeCompare(ABOUT_TIMELINE_COUNTRY_LABELS[b] || b))
			.map(code => ({ value: code, label: `${ABOUT_TIMELINE_COUNTRY_LABELS[code] || code} (${countryCounts[code]})` }))
	);
	const decadeOptions = [{ value: 'all', label: 'All decades' }].concat(
		Object.keys(decadeCounts).sort().map(decade => ({ value: decade, label: `${decade} (${decadeCounts[decade]})` }))
	);

	const topic = makeSelect('PreservationTimelineTopic', 'Topic', topicOptions);
	const country = makeSelect('PreservationTimelineCountry', 'Country', countryOptions);
	const decade = makeSelect('PreservationTimelineDecade', 'Decade', decadeOptions);

	const entityWrap = document.createElement('div');
	entityWrap.className = 'timeline-filter timeline-filter-search';
	const entityLabel = document.createElement('label');
	entityLabel.htmlFor = 'PreservationTimelineEntity';
	entityLabel.textContent = 'Company / service';
	const entityInputWrap = document.createElement('div');
	entityInputWrap.className = 'search-input-wrapper';
	const entityIcon = document.createElement('span');
	entityIcon.className = 'icon-wrapper search-input-icon';
	entityIcon.setAttribute('aria-hidden', 'true');
	entityIcon.appendChild(createIcon('magnifying-glass'));
	const entityInput = document.createElement('input');
	entityInput.type = 'search';
	entityInput.id = 'PreservationTimelineEntity';
	entityInput.setAttribute('list', 'PreservationTimelineEntityList');
	entityInput.setAttribute('autocomplete', 'off');
	entityInput.placeholder = 'e.g. Yahoo, Blingee, GeoCities…';
	const datalist = document.createElement('datalist');
	datalist.id = 'PreservationTimelineEntityList';
	[...new Set(Object.values(ABOUT_TIMELINE_ENTITY_LABELS))]
		.sort((a, b) => a.localeCompare(b))
		.forEach(label => {
			const opt = document.createElement('option');
			opt.value = label;
			datalist.appendChild(opt);
		});
	entityInputWrap.append(entityIcon, entityInput, datalist);
	entityWrap.append(entityLabel, entityInputWrap);

	const clearBtn = document.createElement('button');
	clearBtn.type = 'button';
	clearBtn.className = 'btn-text-with-icon icon-wrapper secondary timeline-filter-clear';
	clearBtn.appendChild(createIcon('x-mark'));
	const clearLabel = document.createElement('span');
	clearLabel.className = 'name';
	clearLabel.textContent = 'Clear filters';
	clearBtn.appendChild(clearLabel);

	filtersEl.append(topic.wrap, country.wrap, decade.wrap, entityWrap, clearBtn);

	const buildTimelineItem = (item) => {
		const li = document.createElement('li');
		li.className = `timeline-${item.type}`;

		const topicLabels = item.tags.map(tag => ABOUT_TIMELINE_TAG_LABELS[tag]).filter(Boolean);
		const countryLabel = ABOUT_TIMELINE_COUNTRY_LABELS[item.country] || item.country;
		const tooltipParts = [];
		if (topicLabels.length) tooltipParts.push(topicLabels.join(', '));
		if (countryLabel) tooltipParts.push(countryLabel);

		const dateSpan = document.createElement('span');
		dateSpan.className = 'timeline-date';
		dateSpan.textContent = item.date;
		if (tooltipParts.length) dateSpan.dataset.tooltip = tooltipParts.join(' · ');

		const textSpan = document.createElement('span');
		textSpan.innerHTML = item.html;

		li.append(dateSpan, textSpan);
		return li;
	};

	const render = () => {
		const query = state.entity.trim().toLowerCase();
		const matches = ABOUT_TIMELINE.filter(item => {
			if (state.topic !== 'all' && !item.tags.includes(state.topic)) return false;
			if (state.country !== 'all' && item.country !== state.country) return false;
			if (state.decade !== 'all' && item.decade !== state.decade) return false;
			if (query && !item.entities.some(ent => {
				const label = ABOUT_TIMELINE_ENTITY_LABELS[ent] || ent;
				return label.toLowerCase().includes(query) || ent.includes(query);
			})) return false;
			return true;
		});

		listEl.replaceChildren();
		matches.forEach(item => listEl.appendChild(buildTimelineItem(item)));
		listEl.scrollTop = 0;
		initTooltipsInContainer(listEl);

		const filtersActive = state.topic !== 'all' || state.country !== 'all' || state.decade !== 'all' || query !== '';
		clearBtn.disabled = !filtersActive;
		listEl.classList.toggle('timeline-list-empty', matches.length === 0);

		if (matches.length === 0) {
			summaryEl.textContent = 'No timeline events match these filters.';
			return;
		}

		const count = `${matches.length} ${matches.length === 1 ? 'event' : 'events'}`;
		const range = matches.length > 1 ? `${matches[0].date} → ${matches[matches.length - 1].date}` : matches[0].date;
		summaryEl.textContent = filtersActive
			? `${count} match these filters · ${range}`
			: `${count} · ${range}`;
	};

	[[topic.select, 'topic'], [country.select, 'country'], [decade.select, 'decade']].forEach(([select, key]) => {
		select.addEventListener('change', () => {
			state[key] = select.value;
			render();
		});
	});

	let debounceHandle = null;
	entityInput.addEventListener('input', () => {
		clearTimeout(debounceHandle);
		debounceHandle = setTimeout(() => {
			state.entity = entityInput.value;
			render();
		}, 120);
	});

	clearBtn.addEventListener('click', () => {
		state.topic = 'all';
		state.country = 'all';
		state.decade = 'all';
		state.entity = '';
		topic.select.value = 'all';
		country.select.value = 'all';
		decade.select.value = 'all';
		entityInput.value = '';
		render();
	});

	render();
}

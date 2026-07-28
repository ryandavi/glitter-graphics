class AdminDashboard {
	constructor() {
		this.reports = [];
		this.filter = 'all';
		this.issueFilter = null;
		this.showDiagnostics = false;
		// Selected row keys, and the rows currently on screen keyed the same
		// way — the filters rebuild the queue, so a selection is only ever
		// resolved against what is actually visible.
		this.selection = new Set();
		this.visibleIssues = new Map();
		this.bulkBusy = false;
		// Per-file bulk failures outlive the reload that follows the run — a
		// toast that clears in two seconds is how eleven skipped files came to
		// look like a button that does nothing.
		this.bulkReport = null;
		this.bulkReportLineLimit = 8;
		this.categoryCache = new Map();
		// An issue only gets a checkbox if there is one correct thing to do to
		// a whole batch of it. Missing files, duplicates, and unsafe formats
		// each need a per-item decision, so they stay link-only.
		this.bulkActions = {
			activate: { label: count => `Publish ${count}`, confirm: count => `Publish ${count} pending asset(s)? They ship on the next Export JSON.` },
			register: { label: count => `Add ${count} to library`, confirm: count => `Add ${count} unregistered file(s)? Each is analyzed and lands as pending review.` },
			reanalyze: { label: count => `Re-analyze ${count}`, confirm: count => `Re-analyze ${count} asset(s)?` }
		};
		// Each overview tile owns the set of issue codes it counts, so the
		// count and the filtered queue can never disagree.
		this.overviewGroups = {
			'Pending review': ['pending'],
			'Broken references': ['missing', 'unreadable_file', 'unsafe_file_type'],
			'Unregistered files': ['orphan'],
			'Analysis stale/failed': ['analysis_missing', 'analysis_stale']
		};
		this.issueCopy = {
			pending: ['Pending review', 'This upload is waiting for a publishing decision.'],
			missing: ['Missing file', 'The database record points to a file that is not available.'],
			duplicate: ['Duplicate records', 'Multiple database records use the same URL.'],
			orphan: ['Unregistered file', 'This managed file does not have a database record.'],
			analysis_missing: ['Analysis missing', 'No stored analysis exists for this file.'],
			analysis_stale: ['Analysis stale', 'The file changed after its stored analysis was created.'],
			thumbnail_missing: ['Thumbnail missing', 'The stored thumbnail is unavailable.'],
			category_path_mismatch: ['Category path mismatch', 'The URL folder does not match the assigned category slug.'],
			unsafe_file_type: ['Unsupported file', 'The file type is outside the configured safe formats.'],
			unreadable_file: ['Unreadable file', 'The file is empty or cannot be read.']
		};
	}

	init() {
		document.getElementById('refreshHealth').addEventListener('click', () => {
			this.bulkReport = null;
			this.categoryCache.clear();
			this.load();
		});
		document.getElementById('showAllChecks').addEventListener('click', () => {
			this.showDiagnostics = !this.showDiagnostics;
			document.getElementById('showAllChecks').textContent = this.showDiagnostics ? 'Hide passed checks' : 'Show all checks';
			this.render();
		});
		document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
			this.filter = button.dataset.filter;
			document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('selected', item === button));
			this.render();
		}));
		document.getElementById('selectAllIssues').addEventListener('change', event => {
			this.selection = event.target.checked ? new Set(this.visibleIssues.keys()) : new Set();
			this.renderSelectionState();
		});
		this.load();
	}

	async load() {
		const refresh = document.getElementById('refreshHealth');
		refresh.disabled = true;
		refresh.textContent = 'Refreshing…';
		document.getElementById('healthQueue').innerHTML = '<div class="loading-state">Checking assets…</div>';
		try {
			const reportResponses = await Promise.all(CONFIG.asset_types.map(type =>
				AdminAPI.json(`includes/api.php?action=health&type=${encodeURIComponent(type)}`)
			));
			this.reports = reportResponses;
			const activity = await AdminAPI.json('includes/api.php?action=recent_activity&type=glitter&limit=15');
			this.render();
			this.renderActivity(activity);
		} catch (error) {
			this.renderError(error);
		} finally {
			refresh.disabled = false;
			refresh.textContent = 'Refresh';
		}
	}

	render() {
		const reports = this.filter === 'all'
			? this.reports
			: this.reports.filter(report => report.asset_type === this.filter);
		const issues = reports.flatMap(report => report.issues || []);
		this.renderOverview(issues);
		this.renderQueue(reports, issues);
		document.getElementById('exportStatus').innerHTML = reports.map(report => `
			<span class="badge ${report.export?.current ? 'badge-success' : 'badge-warning'}">
				${this.labelType(report.asset_type)} export ${report.export?.current ? 'current' : 'needs regeneration'}
				${report.export?.last_exported_at ? ` · ${this.escape(report.export.last_exported_at)}` : ''}
			</span>
		`).join('');
		const checked = reports.map(report => new Date(report.checked_at)).sort((a, b) => b - a)[0];
		document.getElementById('healthCheckedAt').textContent = checked
			? `Last checked ${checked.toLocaleString()}`
			: 'Health check not yet run';
	}

	renderOverview(issues) {
		const host = document.getElementById('healthOverview');
		host.innerHTML = Object.entries(this.overviewGroups).map(([label, codes]) => {
			const count = issues.filter(item => codes.includes(item.issue)).length;
			const selected = this.issueFilter === label;
			return `<button type="button" class="overview-item overview-${this.overviewTone(label)} ${selected ? 'selected' : ''}"
				data-issue-group="${this.escape(label)}" aria-pressed="${selected}" ${count ? '' : 'disabled'}>
				<span class="overview-count">${count}</span>
				<span>${this.escape(label)}</span>
			</button>`;
		}).join('');
		host.querySelectorAll('[data-issue-group]').forEach(button => button.addEventListener('click', () => {
			// Clicking the active tile clears the filter rather than trapping
			// the queue in a subset with no visible way out.
			this.issueFilter = this.issueFilter === button.dataset.issueGroup ? null : button.dataset.issueGroup;
			this.render();
		}));
	}

	overviewTone(label) {
		return {
			'Pending review': 'warning',
			'Broken references': 'critical',
			'Unregistered files': 'info',
			'Analysis stale/failed': 'neutral'
		}[label] || 'neutral';
	}

	renderQueue(reports, issues) {
		const queue = document.getElementById('healthQueue');
		const codes = this.overviewGroups[this.issueFilter];
		const visible = issues.length && codes ? issues.filter(issue => codes.includes(issue.issue)) : issues;
		this.visibleIssues = new Map(visible.filter(issue => this.bulkActionFor(issue)).map(issue => [this.itemKey(issue), issue]));
		queue.innerHTML = this.bulkReportBlock() + this.queueBody(reports, issues, visible);
		queue.querySelectorAll('img').forEach(image => image.addEventListener('error', () => {
			image.closest('.issue-preview').classList.add('preview-failed');
			image.remove();
		}, { once: true }));
		queue.querySelector('[data-dismiss-report]')?.addEventListener('click', () => {
			this.bulkReport = null;
			this.render();
		});
		queue.querySelectorAll('[data-select-key]').forEach(box => box.addEventListener('change', () => {
			if (box.checked) this.selection.add(box.dataset.selectKey);
			else this.selection.delete(box.dataset.selectKey);
			this.renderSelectionState();
		}));
		this.renderSelectionState();
	}

	queueBody(reports, issues, visible) {
		if (!issues.length) return '<div class="healthy-state"><strong>All checks pass</strong><span>No assets need attention.</span></div>';
		if (!visible.length) {
			return `<div class="empty-row">No ${this.escape(String(this.issueFilter).toLowerCase())} items. Select the tile again to show everything.</div>`;
		}
		const rows = visible.map(issue => this.issueRow(issue)).join('');
		const diagnostics = this.showDiagnostics
			? reports.map(report => `
				<div class="diagnostic-row">
					<span class="status-dot status-dot-success"></span>
					<span>${this.labelType(report.asset_type)} health scan completed</span>
					<span>${report.issues.length} issue${report.issues.length === 1 ? '' : 's'}</span>
				</div>
			`).join('')
			: '';
		return rows + diagnostics;
	}

	// Whatever a bulk run could not do, stated where the run happened and left
	// there until it is dismissed or the report is refreshed.
	bulkReportBlock() {
		if (!this.bulkReport) return '';
		const shown = this.bulkReport.lines.slice(0, this.bulkReportLineLimit);
		const rest = this.bulkReport.lines.length - shown.length;
		return `
			<div class="error-state">
				<strong>${this.escape(this.bulkReport.title)}</strong>
				${shown.map(line => `<span>${this.escape(line)}</span>`).join('')}
				${rest > 0 ? `<span>…and ${rest} more</span>` : ''}
				<button type="button" class="btn btn-secondary btn-sm" data-dismiss-report>Dismiss</button>
			</div>
		`;
	}

	// ===== BULK SELECTION =====

	// Identity has to survive a rerender, and orphans have no row id — the URL
	// is what identifies them.
	itemKey(item) {
		return `${item.asset_type}|${item.issue}|${item.id ?? item.url}`;
	}

	bulkActionFor(item) {
		// Ingest uploads are approved in the upload modal, which is where the
		// category and tag decisions live; only legacy inactive rows publish
		// straight from here.
		if (item.issue === 'pending') return item.details?.ingest ? null : 'activate';
		if (item.issue === 'orphan') return 'register';
		if (item.issue === 'analysis_missing' || item.issue === 'analysis_stale') return 'reanalyze';
		return null;
	}

	// Rebuilds the queue index, drops selections for rows the filters removed,
	// and repaints the header controls. Called after every queue render.
	renderSelectionState() {
		for (const key of [...this.selection]) {
			if (!this.visibleIssues.has(key)) this.selection.delete(key);
		}
		document.querySelectorAll('[data-select-key]').forEach(box => {
			box.checked = this.selection.has(box.dataset.selectKey);
			box.disabled = this.bulkBusy;
		});
		const selectAll = document.getElementById('selectAllIssues');
		const selectable = this.visibleIssues.size;
		selectAll.disabled = this.bulkBusy || !selectable;
		selectAll.checked = selectable > 0 && this.selection.size === selectable;
		selectAll.indeterminate = this.selection.size > 0 && this.selection.size < selectable;

		const counts = new Map();
		for (const item of this.selectedItems()) {
			const action = this.bulkActionFor(item);
			counts.set(action, (counts.get(action) || 0) + 1);
		}
		document.getElementById('bulkCount').textContent = this.selection.size ? `${this.selection.size} selected` : '';
		const host = document.getElementById('bulkActions');
		host.innerHTML = [...counts].map(([action, count]) =>
			`<button type="button" class="btn btn-secondary btn-sm" data-bulk="${action}" ${this.bulkBusy ? 'disabled' : ''}>${this.escape(this.bulkActions[action].label(count))}</button>`
		).join('');
		host.querySelectorAll('[data-bulk]').forEach(button =>
			button.addEventListener('click', () => this.runBulk(button.dataset.bulk)));
	}

	selectedItems() {
		return [...this.selection].map(key => this.visibleIssues.get(key)).filter(Boolean);
	}

	async runBulk(action) {
		const items = this.selectedItems().filter(item => this.bulkActionFor(item) === action);
		if (!items.length || !confirm(this.bulkActions[action].confirm(items.length))) return;
		this.bulkReport = null;
		this.bulkBusy = true;
		this.renderSelectionState();
		try {
			const summary = await ({
				activate: () => this.bulkActivate(items),
				register: () => this.bulkRegister(items),
				reanalyze: () => this.bulkReanalyze(items)
			})[action]();
			this.toast(summary);
			this.selection = new Set();
		} catch (error) {
			this.toast(`Bulk action failed: ${error.message}`);
		} finally {
			this.bulkBusy = false;
			await this.load();
		}
	}

	async bulkActivate(items) {
		let activated = 0;
		for (const [type, group] of this.groupByType(items)) {
			const result = await AdminAPI.json(`includes/api.php?action=activate&type=${encodeURIComponent(type)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ids: group.map(item => item.id) })
			});
			activated += result.activated;
		}
		return `${activated} published — Export JSON to publish them to the editor`;
	}

	// register_existing analyzes each file as it lands, so these go one request
	// at a time with progress rather than one batch that outruns PHP's timeout.
	// A failure on one file must not abandon the rest of the batch.
	async bulkRegister(items) {
		const { targets, skipped } = await this.resolveRegisterCategories(items);
		let added = 0;
		const failures = [...skipped];
		for (const [index, target] of targets.entries()) {
			this.setBulkProgress(`Adding ${index + 1} of ${targets.length}…`);
			try {
				await AdminAPI.json(`includes/api.php?action=register_existing&type=${encodeURIComponent(target.item.asset_type)}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ url: target.item.url, category_id: target.categoryId })
				});
				added++;
			} catch (error) {
				failures.push(`${target.item.name}: ${error.message}`);
			}
		}
		// Files sitting in a folder with no matching category cannot infer one,
		// so every reason travels with the count — otherwise a whole batch
		// reports "failed" with nowhere to look.
		if (!failures.length) return `${added} added as pending`;
		this.bulkReport = { title: `${added} added, ${failures.length} not added`, lines: failures };
		return `${added} added, ${failures.length} not added`;
	}

	// An existing file registers where it sits, so its folder is what picks its
	// category — pointing the record at any other category only produces a path
	// mismatch on the next health check. A folder with no category record is
	// therefore a category that has not been registered yet, which is the one
	// decision this batch cannot make on its own.
	async resolveRegisterCategories(items) {
		const targets = [];
		const unregistered = new Map();
		for (const item of items) {
			const categories = await this.categoriesFor(item.asset_type);
			const category = categories.find(entry => entry.id && this.inFolder(item.url, entry.folder_url));
			if (category) {
				targets.push({ item, categoryId: Number(category.id) });
				continue;
			}
			const slug = this.folderSlug(categories, item.url);
			if (!slug) {
				targets.push({ item, categoryId: null });
				continue;
			}
			const key = `${item.asset_type}|${slug}`;
			if (!unregistered.has(key)) unregistered.set(key, { type: item.asset_type, slug, items: [] });
			unregistered.get(key).items.push(item);
		}
		if (!unregistered.size) return { targets, skipped: [] };

		const folders = [...unregistered.values()];
		const total = folders.reduce((count, folder) => count + folder.items.length, 0);
		const summary = folders.map(folder => `${folder.slug} (${folder.items.length})`).join(', ');
		const skipped = [];
		if (!confirm(`${total} file(s) sit in folders that are not categories yet: ${summary}.\n\nRegister each folder as a category and add its files there? Cancel if these files belong in an existing category — move them into that folder first, then run this again.`)) {
			for (const folder of folders) {
				for (const item of folder.items) skipped.push(`${item.name}: ${folder.slug} is not a category yet`);
			}
			return { targets, skipped };
		}
		for (const folder of folders) {
			this.setBulkProgress(`Creating category ${folder.slug}…`);
			try {
				const categoryId = await this.createCategoryFromFolder(folder.type, folder.slug);
				for (const item of folder.items) targets.push({ item, categoryId });
			} catch (error) {
				for (const item of folder.items) skipped.push(`${item.name}: ${error.message}`);
			}
		}
		return { targets, skipped };
	}

	async categoriesFor(type) {
		if (!this.categoryCache.has(type)) {
			this.categoryCache.set(type, await AdminAPI.json(`includes/api.php?action=categories&type=${encodeURIComponent(type)}`));
		}
		return this.categoryCache.get(type);
	}

	// Slugs are lowercase by rule but older records predate it, so folder
	// matching ignores case rather than offering to create a category that
	// already exists under a different capitalisation.
	inFolder(url, folderUrl) {
		return Boolean(folderUrl) && String(url).toLowerCase().startsWith(String(folderUrl).toLowerCase());
	}

	// Only a file sitting directly in a folder under the managed root names a
	// category; anything nested deeper has no folder a category could own.
	folderSlug(categories, url) {
		const sample = categories.find(category => category.folder_url)?.folder_url;
		if (!sample) return null;
		const root = sample.replace(/[^/]+\/$/, '');
		if (!this.inFolder(url, root)) return null;
		const parts = url.slice(root.length).split('/');
		return parts.length === 2 && parts[0] ? parts[0] : null;
	}

	// The same folder-to-category registration the category manager offers,
	// reached from the queue where the stray files actually show up.
	async createCategoryFromFolder(type, slug) {
		const name = slug.replaceAll('-', ' ').replace(/\b\w/g, character => character.toUpperCase());
		const result = await AdminAPI.json(`includes/api.php?action=add_category&type=${encodeURIComponent(type)}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, slug })
		});
		this.categoryCache.delete(type);
		return Number(result.id);
	}

	async bulkReanalyze(items) {
		let updated = 0;
		for (const [type, group] of this.groupByType(items)) {
			// Glitter palettes are curated by hand and stickers re-read theirs —
			// the same split the asset editor's Analyze all uses.
			const includeColors = type !== 'glitter';
			const ids = group.map(item => item.id);
			for (let offset = 0; offset < ids.length; offset += 10) {
				this.setBulkProgress(`Analyzing ${Math.min(offset + 10, ids.length)} of ${ids.length}…`);
				const result = await AdminAPI.json(`includes/api.php?action=analyze_all&type=${encodeURIComponent(type)}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ ids: ids.slice(offset, offset + 10), include_colors: includeColors })
				});
				updated += result.updated;
			}
		}
		return `${updated} re-analyzed`;
	}

	groupByType(items) {
		const groups = new Map();
		for (const item of items) {
			if (!groups.has(item.asset_type)) groups.set(item.asset_type, []);
			groups.get(item.asset_type).push(item);
		}
		return groups;
	}

	setBulkProgress(text) {
		document.getElementById('bulkCount').textContent = text;
	}

	issueRow(item) {
		const copy = this.issueCopy[item.issue] || [item.issue, 'This item needs review.'];
		const preview = item.thumbnail_url
			? `<img src="../${this.escape(item.thumbnail_url)}" alt="" loading="lazy">`
			: '<span class="missing-preview" aria-label="Source file unavailable">File unavailable</span>';
		const url = item.url ? `<code>${this.escape(item.url)}</code>` : '';
		const details = item.details?.row_count ? `<span>${item.details.row_count} records</span>` : '';
		// The cell is always present so every row's preview and text line up,
		// whether or not the issue has a batchable action.
		const select = this.bulkActionFor(item)
			? `<input type="checkbox" data-select-key="${this.escape(this.itemKey(item))}" aria-label="Select ${this.escape(item.name || 'asset')}">`
			: '';
		return `
			<article class="issue-row issue-${this.escape(item.severity)}">
				<div class="issue-select">${select}</div>
				<div class="issue-preview">${preview}</div>
				<div class="issue-main">
					<div class="issue-title-row">
						<strong>${this.escape(item.name || 'Unnamed asset')}</strong>
						<span class="badge badge-type-${this.escape(item.asset_type)}">${this.labelType(item.asset_type)}</span>
						<span class="badge badge-${this.issueTone(item.issue)}">${this.escape(copy[0])}</span>
					</div>
					<p>${this.escape(copy[1])}</p>
					<div class="issue-meta">${item.category ? `<span>${this.escape(item.category)}</span>` : ''}${details}${url}</div>
				</div>
				<div class="issue-actions">${this.actions(item)}</div>
			</article>
		`;
	}

	issueTone(issue) {
		if (['missing', 'duplicate', 'unsafe_file_type', 'unreadable_file'].includes(issue)) return 'critical';
		if (['orphan', 'thumbnail_missing'].includes(issue)) return 'info';
		if (['pending', 'analysis_missing', 'analysis_stale', 'category_path_mismatch'].includes(issue)) return 'warning';
		return 'info';
	}

	actions(item) {
		const page = item.asset_type === 'glitter' ? 'glitter.php' : 'sticker.php';
		const primary = {
			pending: item.details?.ingest
				? `<a class="btn btn-primary btn-sm" href="${page}?ingest=${item.id}">Review</a>`
				: `<a class="btn btn-primary btn-sm" href="${page}?asset=${item.id}">Review</a>`,
			orphan: `<a class="btn btn-primary btn-sm" href="${page}?addUrl=${encodeURIComponent(item.url)}">Review and add</a>`,
			missing: `<a class="btn btn-primary btn-sm" href="${page}?asset=${item.id}">Open record</a>`,
			duplicate: `<a class="btn btn-primary btn-sm" href="${page}?asset=${item.id}">Review records</a>`,
			analysis_missing: `<a class="btn btn-primary btn-sm" href="${page}?asset=${item.id}&analyze=1">Re-analyze</a>`,
			analysis_stale: `<a class="btn btn-primary btn-sm" href="${page}?asset=${item.id}&analyze=1">Re-analyze</a>`
		}[item.issue] || `<a class="btn btn-secondary btn-sm" href="${page}?asset=${item.id || ''}">Review</a>`;
		return primary;
	}

	renderActivity(events) {
		const host = document.getElementById('recentActivity');
		if (!events.length) {
			host.innerHTML = '<div class="empty-row">Meaningful admin changes will appear here.</div>';
			return;
		}
		host.innerHTML = events.map(event => `
			<div class="activity-row">
				<span class="activity-kind">${this.escape(event.event_type.replaceAll('_', ' '))}</span>
				<span>${this.escape(event.summary?.name || event.summary?.filename || event.summary?.url || event.subject_type)}</span>
				<time datetime="${this.escape(event.created_at)}">${new Date(event.created_at.replace(' ', 'T')).toLocaleString()}</time>
			</div>
		`).join('');
	}

	renderError(error) {
		this.visibleIssues = new Map();
		this.selection = new Set();
		this.renderSelectionState();
		document.getElementById('healthQueue').innerHTML = `
			<div class="error-state">
				<strong>Health report unavailable</strong>
				<span>${this.escape(error.message)}</span>
				<button type="button" class="btn btn-secondary" id="retryHealth">Retry</button>
			</div>
		`;
		document.getElementById('retryHealth').addEventListener('click', () => this.load());
		document.getElementById('recentActivity').innerHTML = '<div class="empty-row">Activity could not be loaded.</div>';
	}

	toast(message) {
		const host = document.getElementById('toastHost');
		const toast = document.createElement('div');
		toast.className = 'toast';
		toast.textContent = message;
		host.appendChild(toast);
		setTimeout(() => toast.remove(), 2400);
	}

	labelType(type) {
		return type === 'sticker' ? 'Sticker' : 'Glitter';
	}

	escape(value) {
		const node = document.createElement('div');
		node.textContent = String(value ?? '');
		return node.innerHTML;
	}
}

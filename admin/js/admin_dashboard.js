class AdminDashboard {
	constructor() {
		this.reports = [];
		this.filter = 'all';
		this.issueFilter = null;
		this.showDiagnostics = false;
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
		document.getElementById('refreshHealth').addEventListener('click', () => this.load());
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
		if (!issues.length) {
			queue.innerHTML = '<div class="healthy-state"><strong>All checks pass</strong><span>No assets need attention.</span></div>';
			return;
		}
		const codes = this.overviewGroups[this.issueFilter];
		const visible = codes ? issues.filter(issue => codes.includes(issue.issue)) : issues;
		if (!visible.length) {
			queue.innerHTML = `<div class="empty-row">No ${this.escape(String(this.issueFilter).toLowerCase())} items. Select the tile again to show everything.</div>`;
			return;
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
		queue.innerHTML = rows + diagnostics;
		queue.querySelectorAll('img').forEach(image => image.addEventListener('error', () => {
			image.closest('.issue-preview').classList.add('preview-failed');
			image.remove();
		}, { once: true }));
		queue.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
			await navigator.clipboard.writeText(button.dataset.copy);
			this.toast('URL copied');
		}));
	}

	issueRow(item) {
		const copy = this.issueCopy[item.issue] || [item.issue, 'This item needs review.'];
		const preview = item.thumbnail_url
			? `<img src="../${this.escape(item.thumbnail_url)}" alt="" loading="lazy">`
			: '<span class="missing-preview" aria-label="Source file unavailable">File unavailable</span>';
		const url = item.url ? `<code>${this.escape(item.url)}</code>` : '';
		const details = item.details?.row_count ? `<span>${item.details.row_count} records</span>` : '';
		return `
			<article class="issue-row issue-${this.escape(item.severity)}">
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
		const copy = item.url ? `<button type="button" class="btn btn-quiet btn-sm" data-copy="${this.escape(item.url)}">Copy URL</button>` : '';
		return primary + copy;
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

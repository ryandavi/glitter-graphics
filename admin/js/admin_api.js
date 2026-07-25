window.AdminAPI = {
    csrfToken: typeof ADMIN_CSRF_TOKEN === 'string' ? ADMIN_CSRF_TOKEN : '',
    mutatingActions: new Set([
        'update',
        'delete',
        'add',
        'reorder',
        'analyze',
        'analyze_all',
        'save_export',
        'save_categories_export',
        'add_category',
        'delete_category',
        'update_category',
        'add_tag',
        'delete_tag',
        'upload',
        'reject',
        'ingest_upload',
        'ingest_update',
        'ingest_approve',
        'ingest_reject',
        'register_existing',
        'tag_alias_add',
        'tag_update',
        'tag_merge'
    ]),

    isMutatingRequest(url, options = {}) {
        const requestUrl = new URL(url, window.location.href);
        const action = requestUrl.searchParams.get('action');
        const method = (options.method || 'GET').toUpperCase();

        if (this.mutatingActions.has(action)) {
            return true;
        }

        return !['GET', 'HEAD', 'OPTIONS'].includes(method);
    },

    async fetch(url, options = {}) {
        const headers = new Headers(options.headers || {});

        if (this.isMutatingRequest(url, options) && this.csrfToken) {
            headers.set('X-CSRF-Token', this.csrfToken);
        }

        const response = await fetch(url, {
            ...options,
            headers
        });

        if (response.status === 401 && !window.location.pathname.endsWith('/login.php')) {
            window.location.href = 'login.php';
        }

        return response;
    },

    async json(url, options = {}) {
        const response = await this.fetch(url, options);
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.success === false) {
            const error = data?.error;
            throw new Error(typeof error === 'object' ? error.message : (error || `Request failed (${response.status})`));
        }
        return data;
    }
};

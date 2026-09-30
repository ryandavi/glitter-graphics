'use strict';

const TemplateLibrary = (() => {
	let manifestPromise = null;
	const projects = new Map();

	async function loadManifest() {
		if (!manifestPromise) {
			manifestPromise = fetch('data/templates.json')
				.then((response) => {
					if (!response.ok) throw new Error(`Template manifest returned ${response.status}`);
					return response.json();
				})
				.then((data) => {
					const entries = Array.isArray(data?.templates) ? data.templates : [];
					const ids = new Set();
					entries.forEach((entry) => {
						if (!entry?.id || ids.has(entry.id)) throw new Error('Template ids must be unique and non-empty.');
						if (!['project', 'overlay'].includes(entry.mode)) throw new Error(`Unknown template mode: ${entry.mode}`);
						if (!entry.src || !entry.label) throw new Error(`Template ${entry.id} is incomplete.`);
						ids.add(entry.id);
					});
					return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
				});
		}
		return manifestPromise;
	}

	async function list(mode = null) {
		const entries = await loadManifest();
		return entries.filter((entry) => !mode || entry.mode === mode);
	}

	async function get(id) {
		return (await loadManifest()).find((entry) => entry.id === id) || null;
	}

	async function loadProject(id) {
		if (projects.has(id)) return structuredClone(await projects.get(id));
		const entry = await get(id);
		if (!entry) throw new Error(`Unknown template: ${id}`);
		const promise = fetch(entry.src).then((response) => {
			if (!response.ok) throw new Error(`Template ${entry.label} returned ${response.status}`);
			return response.json();
		});
		projects.set(id, promise);
		return structuredClone(await promise);
	}

	return Object.freeze({ loadManifest, list, get, loadProject });
})();

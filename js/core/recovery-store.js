'use strict';

// Recovery drafts: the last few documents, each written as it is edited, so
// leaving without a file save loses nothing (js/editor/document-recovery.js
// writes them). Each draft is keyed by its document's draft id in two
// stores: `drafts` holds the whole record and `summaries` the same record
// without its project, so the start card tiles never read a project back.
// Every call fails soft: the first failure turns recovery off for the session
// and logs once, and the editor carries on as if it never had it.
class RecoveryStore {
	static DATABASE = 'glitter';
	static VERSION = 2;
	static STORES = Object.freeze({ drafts: 'drafts', summaries: 'summaries' });

	constructor(factory = globalThis.indexedDB) {
		this.factory = factory || null;
		this.disabled = !this.factory;
		this.database = null;
	}

	get available() { return !this.disabled; }

	// Version 1 held one draft under fixed keys; it is dropped, not migrated.
	open() {
		this.database ||= new Promise((resolve, reject) => {
			const request = this.factory.open(RecoveryStore.DATABASE, RecoveryStore.VERSION);
			request.onupgradeneeded = () => {
				const database = request.result;
				[...database.objectStoreNames].forEach(name => database.deleteObjectStore(name));
				Object.values(RecoveryStore.STORES).forEach(name => database.createObjectStore(name));
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
			request.onblocked = () => reject(new Error('Recovery storage is blocked by another tab.'));
		});
		return this.database;
	}

	// Runs `work(stores)` in one transaction over both stores. Resolves once it
	// commits, with the result of the request `work` returns (true when it
	// returns none); null when storage is off or fails.
	async run(mode, work) {
		if (this.disabled) return null;
		try {
			const database = await this.open();
			return await new Promise((resolve, reject) => {
				const names = Object.values(RecoveryStore.STORES);
				const transaction = database.transaction(names, mode);
				const request = work({
					drafts: transaction.objectStore(RecoveryStore.STORES.drafts),
					summaries: transaction.objectStore(RecoveryStore.STORES.summaries)
				});
				transaction.oncomplete = () => resolve(request ? request.result : true);
				transaction.onerror = () => reject(transaction.error);
				transaction.onabort = () => reject(transaction.error || new Error('Recovery write aborted.'));
			});
		} catch (error) {
			this.disabled = true;
			console.warn('Recovery drafts turned off for this session:', error);
			return null;
		}
	}

	read(id) {
		return this.run('readonly', ({ drafts }) => drafts.get(id)).then(record => record || null);
	}

	// Every draft without its `project`, newest first.
	listSummaries() {
		return this.run('readonly', ({ summaries }) => summaries.getAll())
			.then(list => (list || []).sort((a, b) => b.savedAt - a.savedAt));
	}

	// Writes `record` under `record.id`, then drops the oldest drafts past `keep`.
	write(record, { keep = Infinity } = {}) {
		return this.run('readwrite', ({ drafts, summaries }) => {
			const summary = { ...record };
			delete summary.project;
			drafts.put(record, record.id);
			summaries.put(summary, record.id);
			const all = summaries.getAll();
			all.onsuccess = () => {
				const others = all.result.filter(entry => entry.id !== record.id).sort((a, b) => b.savedAt - a.savedAt);
				others.slice(Math.max(0, keep - 1)).forEach(({ id }) => {
					drafts.delete(id);
					summaries.delete(id);
				});
			};
		});
	}

	// Merges `changes` (never `project`) into one draft.
	patch(id, changes) {
		return this.run('readwrite', (stores) => {
			Object.values(stores).forEach((store) => {
				const request = store.get(id);
				request.onsuccess = () => {
					if (request.result) store.put({ ...request.result, ...changes }, id);
				};
			});
		});
	}

	remove(id) {
		return this.run('readwrite', stores => Object.values(stores).forEach(store => store.delete(id)));
	}

	clear() {
		return this.run('readwrite', stores => Object.values(stores).forEach(store => store.clear()));
	}
}

const RECOVERY_STORE = new RecoveryStore();

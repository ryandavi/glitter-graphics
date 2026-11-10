'use strict';

// One IndexedDB slot that mirrors the document open last, so leaving without
// a file save loses nothing (js/editor/document-recovery.js writes it). Two
// keys in one store: `current` holds the whole record and `summary` the same
// record without its project, so the start card tile and the multi-tab check
// never read the project back. Every call fails soft: the first failure turns recovery off
// for the session and logs once, and the editor carries on as if it never had it.
class RecoveryStore {
	static DATABASE = 'glitter';
	static STORE = 'recovery';
	static KEYS = Object.freeze({ record: 'current', summary: 'summary' });

	constructor(factory = globalThis.indexedDB) {
		this.factory = factory || null;
		this.disabled = !this.factory;
		this.database = null;
	}

	get available() { return !this.disabled; }

	open() {
		this.database ||= new Promise((resolve, reject) => {
			const request = this.factory.open(RecoveryStore.DATABASE, 1);
			request.onupgradeneeded = () => request.result.createObjectStore(RecoveryStore.STORE);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
			request.onblocked = () => reject(new Error('Recovery storage is blocked by another tab.'));
		});
		return this.database;
	}

	// Runs `work(store)` in one transaction. Resolves once it commits, with
	// the result of the request `work` returns (true when it returns none);
	// null when storage is off or fails.
	async run(mode, work) {
		if (this.disabled) return null;
		try {
			const database = await this.open();
			return await new Promise((resolve, reject) => {
				const transaction = database.transaction(RecoveryStore.STORE, mode);
				const request = work(transaction.objectStore(RecoveryStore.STORE));
				transaction.oncomplete = () => resolve(request ? request.result : true);
				transaction.onerror = () => reject(transaction.error);
				transaction.onabort = () => reject(transaction.error || new Error('Recovery write aborted.'));
			});
		} catch (error) {
			this.disabled = true;
			console.warn('Recovery copy turned off for this session:', error);
			return null;
		}
	}

	read() {
		return this.run('readonly', store => store.get(RecoveryStore.KEYS.record)).then(record => record || null);
	}

	// The record without `project`.
	readSummary() {
		return this.run('readonly', store => store.get(RecoveryStore.KEYS.summary)).then(summary => summary || null);
	}

	write(record) {
		return this.run('readwrite', (store) => {
			const summary = { ...record };
			delete summary.project;
			store.put(record, RecoveryStore.KEYS.record);
			store.put(summary, RecoveryStore.KEYS.summary);
		});
	}

	// Merges `changes` (never `project`) into the stored record.
	patch(changes) {
		return this.run('readwrite', (store) => {
			Object.values(RecoveryStore.KEYS).forEach((key) => {
				const request = store.get(key);
				request.onsuccess = () => {
					if (request.result) store.put({ ...request.result, ...changes }, key);
				};
			});
		});
	}

	clear() {
		return this.run('readwrite', (store) => {
			Object.values(RecoveryStore.KEYS).forEach(key => store.delete(key));
		});
	}
}

const RECOVERY_STORE = new RecoveryStore();

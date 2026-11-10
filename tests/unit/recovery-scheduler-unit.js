'use strict';

// RecoveryScheduler (js/editor/document-recovery.js): debounce, max wait,
// one write in flight, and the wait while a session holds edits.
const assert = require('assert');
const { RecoveryScheduler } = require('../../js/editor/document-recovery.js');

function fakeClock() {
	let now = 0, nextId = 1;
	const timers = new Map();
	return {
		now: () => now,
		setTimeout: (callback, ms) => { timers.set(nextId, { at: now + ms, callback }); return nextId++; },
		clearTimeout: id => timers.delete(id),
		// Runs every timer due by `ms` from now, in order.
		async advance(ms) {
			const end = now + ms;
			for (;;) {
				const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
				if (!due) break;
				timers.delete(due[0]);
				now = due[1].at;
				due[1].callback();
				await settle();
			}
			now = end;
		}
	};
}

const settle = () => new Promise(resolve => setImmediate(resolve));

function setup({ canWrite = () => true } = {}) {
	const clock = fakeClock();
	const writes = [];
	let release = null;
	const state = { block: false };
	const scheduler = new RecoveryScheduler({
		debounceMs: 2000,
		maxWaitMs: 30000,
		clock,
		canWrite,
		write: () => {
			writes.push(clock.now());
			if (!state.block) return Promise.resolve();
			return new Promise(resolve => { release = resolve; });
		}
	});
	return { clock, writes, scheduler, state, release: () => release() };
}

(async () => {
	// Debounce: a burst of edits writes once, debounceMs after the last.
	{
		const { clock, writes, scheduler } = setup();
		scheduler.schedule();
		await clock.advance(1000);
		scheduler.schedule();
		await clock.advance(1999);
		assert.deepStrictEqual(writes, [], 'No write before the debounce ends');
		await clock.advance(1);
		assert.deepStrictEqual(writes, [3000], 'One write, debounceMs after the last edit');
		await clock.advance(10000);
		assert.strictEqual(writes.length, 1, 'Nothing more without a new edit');
	}

	// Max wait: continuous edits still write every maxWaitMs.
	{
		const { clock, writes, scheduler } = setup();
		for (let t = 0; t < 65000; t += 500) {
			scheduler.schedule();
			await clock.advance(500);
		}
		assert.deepStrictEqual(writes, [30000, 60000], 'A long drag is written at the max wait');
	}

	// One write in flight: edits during a write give exactly one more write.
	{
		const { clock, writes, scheduler, state, release } = setup();
		state.block = true;
		scheduler.schedule();
		await clock.advance(2000);
		assert.strictEqual(writes.length, 1);
		scheduler.schedule();
		scheduler.schedule();
		await clock.advance(2000);
		assert.strictEqual(writes.length, 1, 'No second write while one runs');
		state.block = false;
		release();
		await settle();
		await scheduler.idle();
		assert.strictEqual(writes.length, 2, 'The dirty copy is written once more after the running write');
		await clock.advance(10000);
		assert.strictEqual(writes.length, 2, 'No queued extra writes');
	}

	// flush writes at once; with nothing dirty it does nothing.
	{
		const { writes, scheduler } = setup();
		await scheduler.flush();
		assert.strictEqual(writes.length, 0, 'Flush without an edit does not write');
		scheduler.schedule();
		await scheduler.flush();
		assert.strictEqual(writes.length, 1, 'Flush writes a dirty copy immediately');
	}

	// cancel drops a write that has not started.
	{
		const { clock, writes, scheduler } = setup();
		scheduler.schedule();
		scheduler.cancel();
		await clock.advance(60000);
		assert.strictEqual(writes.length, 0, 'A cancelled write never runs');
	}

	// canWrite false: the copy stays dirty and is retried after a debounce.
	{
		let open = false;
		const { clock, writes, scheduler } = setup({ canWrite: () => open });
		scheduler.schedule();
		await clock.advance(6000);
		assert.strictEqual(writes.length, 0, 'No write while a session holds edits');
		assert.strictEqual(scheduler.pending, true, 'The copy stays dirty');
		open = true;
		await clock.advance(2000);
		assert.strictEqual(writes.length, 1, 'Written once the session ends');
	}

	// A failing write is logged and does not wedge the scheduler.
	{
		const clock = fakeClock();
		let calls = 0;
		const warn = console.warn;
		console.warn = () => {};
		const scheduler = new RecoveryScheduler({ debounceMs: 10, maxWaitMs: 100, clock, write: async () => { calls++; throw new Error('quota'); } });
		scheduler.schedule();
		await clock.advance(10);
		scheduler.schedule();
		await clock.advance(10);
		console.warn = warn;
		assert.strictEqual(calls, 2, 'A failed write leaves the scheduler usable');
	}

	console.log('Recovery scheduler unit verification passed');
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});

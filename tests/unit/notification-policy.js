'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const notify = fs.readFileSync(path.join(root, 'js/ui/notify.js'), 'utf8');
const sources = fs.readdirSync(path.join(root, 'js'), { recursive: true })
	.filter((entry) => entry.endsWith('.js') && !entry.includes('vendor'))
	.map((entry) => ({
		file: entry,
		source: fs.readFileSync(path.join(root, 'js', entry), 'utf8')
	}));

if (!/id="statusText"[^>]*role="status"[^>]*aria-live="polite"/.test(index)) {
	throw new Error('Status feedback is missing its polite live-region contract');
}
if (!/id="errorToast"[^>]*role="alert"[^>]*aria-live="assertive"[^>]*aria-atomic="true"/.test(index)) {
	throw new Error('Error toast is missing its assertive live-region contract');
}
if (!/id="errorClose"[^>]*aria-label="Dismiss error"/.test(index)) {
	throw new Error('Error dismissal control has no accessible name');
}
for (const contract of ['queue: true', 'activeToken', 'drainErrors', 'dismissError']) {
	if (!notify.includes(contract)) throw new Error(`Notification queue contract is missing ${contract}`);
}

const failureCopy = /\b(?:cannot|could not|failed|failure|please select|please create|nothing to|unlock this)\b/i;
for (const { file, source } of sources) {
	for (const match of source.matchAll(/updateStatus\((['"`])([\s\S]*?)\1\)/g)) {
		if (failureCopy.test(match[2])) {
			throw new Error(`${file} routes failed-action copy through status: ${match[2]}`);
		}
	}
}

process.stdout.write('Notification policy verification passed\n');

// Known slow work bypasses the delay; replacing its key preserves ownership
// and the minimum visible time when the older render finally exits.
{
	const vm = require('vm');
	let now = 1000;
	let timerId = 0;
	const timers = new Map();
	const context = {
		CONFIG: { ui: { activity: { showDelayMs: 250, minVisibleMs: 300 } } },
		Date: { now: () => now },
		setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
		clearTimeout: (id) => timers.delete(id)
	};
	vm.runInNewContext(`${notify}\nglobalThis.Center = NotificationCenter;`, context);
	const center = Object.create(context.Center.prototype);
	Object.assign(center, { activities: new Map(), activityShown: false, renderActivity() {} });
	const oldDone = center.beginActivity('preview', 'Rendering preview');
	if (center.activityShown || timers.size !== 1) throw new Error('Fast work must keep the activity delay');
	const done = center.beginActivity('preview', 'Rendering preview', { immediate: true });
	if (!center.activityShown || timers.size) throw new Error('Immediate work must show and clear the delayed timer');
	oldDone();
	if (!center.activities.size) throw new Error('Superseded done must not clear its replacement');
	now += 100; done(); done();
	const timer = [...timers.values()][0];
	if (!center.activityShown || timer.delay !== 200) throw new Error('Immediate work must retain minimum visibility');
	timer.callback();
	if (center.activityShown) throw new Error('Activity must hide after its minimum duration');
}

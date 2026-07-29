'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
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

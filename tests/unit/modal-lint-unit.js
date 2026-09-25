'use strict';

const fs = require('fs');
const path = require('path');
const { tokenize } = require('../../tools/modal-tokenize');
const { RULES, PROSE_RULES, lintSource } = require('../../tools/modal-lint');

const root = path.resolve(__dirname, '..', '..');
const fixtureRoot = path.join(__dirname, '..', 'fixtures', 'modal-lint');
const realFiles = fs.readdirSync(path.join(root, 'modals')).filter(file => file.endsWith('.html')).map(file => `modals/${file}`);
const fixtureRegistry = {
	webtv: { kind: 'site', name: 'WebTV' },
	tripod: { kind: 'site', name: 'Tripod' },
	user: { kind: 'handle', name: 'User', host: 'webtv' }
};
let failures = 0;

function test(name, callback) {
	try {
		callback();
		process.stdout.write(`PASS ${name}\n`);
	} catch (error) {
		failures += 1;
		process.stdout.write(`FAIL ${name}: ${error.message}\n`);
	}
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

for (const relativeFile of realFiles) {
	test(`tokenizer round trip ${relativeFile}`, () => {
		const source = fs.readFileSync(path.join(root, relativeFile), 'utf8');
		assert(tokenize(source).map(token => token.raw).join('') === source, 'tokens did not reconstruct the source');
	});
}

for (const rule of Object.keys(RULES)) {
	test(`fixtures ${rule}`, () => {
		const bad = fs.readFileSync(path.join(fixtureRoot, `${rule}.bad.html`), 'utf8');
		const good = fs.readFileSync(path.join(fixtureRoot, `${rule}.good.html`), 'utf8');
		const options = { rule, registry: fixtureRegistry };
		const badFindings = lintSource(`${rule}.bad.html`, bad, options);
		const goodFindings = lintSource(`${rule}.good.html`, good, options);
		assert(badFindings.length === 1 && badFindings[0].rule === rule, `bad fixture produced ${badFindings.length} findings`);
		assert(goodFindings.length === 0, `good fixture produced ${goodFindings.length} findings`);
	});
}

test('prose rules run on articles only', () => {
	const html = '<p>WebTV in 2001 — a dash.</p>';
	const article = lintSource('modals/history.html', html, { registry: fixtureRegistry }).map(item => item.rule);
	const guide = lintSource('modals/guide.html', html, { registry: fixtureRegistry }).map(item => item.rule);
	assert([...PROSE_RULES].every(rule => article.includes(rule)), `article missed prose rules: ${article}`);
	assert(!guide.some(rule => PROSE_RULES.has(rule)), `guide got prose rules: ${guide}`);
});

test('every modal lints with no errors', () => {
	for (const relativeFile of realFiles) {
		const errors = lintSource(relativeFile, fs.readFileSync(path.join(root, relativeFile), 'utf8')).filter(item => item.severity === 'error');
		assert(!errors.length, `${relativeFile}: ${JSON.stringify(errors.slice(0, 3))}`);
	}
});

if (failures) {
	process.stdout.write(`${failures} modal lint unit case(s) failed.\n`);
	process.exitCode = 1;
} else {
	process.stdout.write('All modal lint unit cases passed.\n');
}

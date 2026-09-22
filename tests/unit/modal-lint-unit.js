'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { tokenize } = require('../../tools/modal-tokenize');
const { RULES, lintSource } = require('../../tools/modal-lint');
const { run: runSeed, serializeRegistry } = require('../../tools/modal-entities-seed');

const root = path.resolve(__dirname, '..', '..');
const fixtureRoot = path.join(__dirname, '..', 'fixtures', 'modal-lint');
const realFiles = [
	'modals/history.html',
	'modals/personal-web.html',
	'modals/aylana.html',
	'modals/about.html'
];
const fixtureRegistry = {
	platforms: {
		other: { label: 'Other' },
		webtv: { label: 'WebTV' }
	},
	usernames: {
		user: { display: 'User', aliases: [], platform: 'webtv' }
	},
	persons: {}
};
const fixturePlatforms = new Set(['other', 'webtv', 'tool', 'independent']);
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

function quietSeed(args, options) {
	const stdoutWrite = process.stdout.write;
	const stderrWrite = process.stderr.write;
	process.stdout.write = () => true;
	process.stderr.write = () => true;
	try {
		return runSeed(args, options);
	} finally {
		process.stdout.write = stdoutWrite;
		process.stderr.write = stderrWrite;
	}
}

for (const relativeFile of realFiles) {
	const absoluteFile = path.join(root, relativeFile);
	if (!fs.existsSync(absoluteFile)) continue;
	test(`tokenizer round trip ${relativeFile}`, () => {
		const source = fs.readFileSync(absoluteFile, 'utf8');
		assert(tokenize(source).map(token => token.raw).join('') === source, 'tokens did not reconstruct the source');
	});
}

for (const rule of Object.keys(RULES)) {
	test(`fixtures ${rule}`, () => {
		const bad = fs.readFileSync(path.join(fixtureRoot, `${rule}.bad.html`), 'utf8');
		const good = fs.readFileSync(path.join(fixtureRoot, `${rule}.good.html`), 'utf8');
		const options = { rule, registry: fixtureRegistry, platformSlugs: fixturePlatforms };
		const badFindings = lintSource(`${rule}.bad.html`, bad, options);
		const goodFindings = lintSource(`${rule}.good.html`, good, options);
		assert(badFindings.length === 1 && badFindings[0].rule === rule, `bad fixture produced ${badFindings.length} findings`);
		assert(goodFindings.length === 0, `good fixture produced ${goodFindings.length} findings`);
	});
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'glitter-modal-registry-'));
const tempRegistry = path.join(tempRoot, 'entities.json');
const realRegistry = path.join(root, 'content', 'entities.json');
try {
	fs.copyFileSync(realRegistry, tempRegistry);
	test('registry --merge is idempotent', () => {
		const before = fs.readFileSync(tempRegistry, 'utf8');
		assert(quietSeed(['--merge'], { registryPath: tempRegistry }) === 0, '--merge returned nonzero');
		assert(fs.readFileSync(tempRegistry, 'utf8') === before, '--merge changed the complete registry');
	});
	test('registry --check passes', () => {
		assert(quietSeed(['--check'], { registryPath: tempRegistry }) === 0, '--check returned nonzero');
	});
	test('registry missing entry check and merge', () => {
		const complete = JSON.parse(fs.readFileSync(tempRegistry, 'utf8'));
		const missingKey = Object.keys(complete.usernames).find(key => !key.startsWith('_'));
		const expectedEntry = complete.usernames[missingKey];
		delete complete.usernames[missingKey];
		fs.writeFileSync(tempRegistry, serializeRegistry(complete), 'utf8');
		const retained = fs.readFileSync(tempRegistry, 'utf8');
		assert(quietSeed(['--check'], { registryPath: tempRegistry }) === 1, '--check did not detect the missing entry');
		assert(fs.readFileSync(tempRegistry, 'utf8') === retained, '--check changed the registry');
		assert(quietSeed(['--merge'], { registryPath: tempRegistry }) === 0, '--merge returned nonzero');
		const restored = JSON.parse(fs.readFileSync(tempRegistry, 'utf8'));
		assert(JSON.stringify(restored.usernames[missingKey]) === JSON.stringify(expectedEntry), '--merge did not restore the extracted entry');
		delete restored.usernames[missingKey];
		assert(JSON.stringify(restored) === JSON.stringify(complete), '--merge changed retained entries');
	});
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}

if (failures) {
	process.stdout.write(`${failures} modal lint unit case(s) failed.\n`);
	process.exitCode = 1;
} else {
	process.stdout.write('All modal lint unit cases passed.\n');
}

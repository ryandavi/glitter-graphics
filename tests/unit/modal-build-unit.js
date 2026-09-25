'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { compile, buildOne, stampWiring, renderSource, formatIsoDate, loadRegistry, discoverNames } = require('../../tools/build-modals');
const { lintSource } = require('../../tools/modal-lint');
const { planTags } = require('../../tools/entities');
const { waybackParts } = require('../../tools/cite');
const contentRegistry = require('../../tools/content-registry');

const root = path.resolve(__dirname, '..', '..');
let failures = 0;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function test(name, callback) {
	try {
		callback();
		process.stdout.write(`PASS ${name}\n`);
	} catch (error) {
		failures += 1;
		process.stdout.write(`FAIL ${name}: ${error.message}\n`);
	}
}

// A small registry so the cases don't move when content/*.json changes.
const entities = {
	webtv: { kind: 'site', name: 'WebTV', gloss: 'A TV set-top box for the web' },
	tripod: { kind: 'site', name: 'Tripod', domains: ['tripod.com'], closed: 'host-closed' },
	sparkelies: { kind: 'site', name: 'Sparkelies', host: 'tripod', owner: 'dan' },
	dan: { kind: 'person', name: 'Dan' },
	'dan-411': { kind: 'handle', name: 'DAN-411', host: 'webtv', person: 'dan', gloss: 'The WebTV username' },
	geekwire: { kind: 'site', name: 'GeekWire' },
	'paint-shop-pro': { kind: 'software', name: 'Paint Shop Pro' },
	'sailor-moon': { kind: 'work', name: 'Sailor Moon' },
	'olia-lialina': { kind: 'person', name: 'Olia Lialina', sortName: 'Lialina, Olia' },
	microsoft: { kind: 'org', name: 'Microsoft' },
	draftsite: { kind: 'site', status: 'draft', name: 'Draft Site' },
	gif: { kind: 'software', name: 'GIF', tags: ['term'] }
};
const sources = {
	a: { title: 'Alpha', url: 'https://example.com/a' },
	b: { author: '@olia-lialina', title: 'Beta', url: 'https://example.com/b', note: 'Cites [@c].' },
	c: { title: 'Gamma', url: 'http://members.tripod.com/~x/', status: 'dead', archive: { url: 'https://web.archive.org/web/20040624034824/http://members.tripod.com/~x/', date: '2004-06-24' } },
	d: { description: 'Hand-formatted citation', general: ['sample'] },
	f: { title: 'A Manual', type: 'book', publisher: '@microsoft', date: '2000', note: 'Note.' },
	g: { author: '@microsoft', description: 'Email to subscribers' },
	e: { author: 'Beschizza, Rob', title: 'Epsilon', url: 'https://example.com/e', general: ['sample'] }
};
const fixture = { entities, sources, iconFiles: new Map([['link', { file: 'link.svg', color: false }], ['tripod', { file: 'tripod.color.svg', color: true }]]), problems: [] };

function run(source, options = {}) {
	return compile(source, { header: false, name: 'sample', registry: fixture, ...options });
}

function clean(source, options) {
	const result = run(source, options);
	assert(result.diagnostics.length === 0, `unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
	return result.output;
}

const tokenCases = [
	['date', '{date:2001-06-07|7 June 2001}', '<time datetime="2001-06-07">7 June 2001</time>'],
	['year', '{y:2001}', '<time datetime="2001">2001</time>'],
	['file', '{file:FB12.gif}', '<span class="file-name">FB12.gif</span>'],
	['directory', '{dir:/BAR}', '<span class="file-name file-name-directory">/BAR</span>'],
	['page', '{page:TOOLS.html}', '<span class="file-name file-name-page">TOOLS.html</span>'],
	['software', '{@paint-shop-pro}', '<span class="entity entity-software" data-entity="paint-shop-pro">Paint Shop Pro</span>'],
	['work', '{@sailor-moon}', '<span class="entity entity-work" data-entity="sailor-moon">Sailor Moon</span>'],
	['org', '{@microsoft}', '<span class="entity entity-org" data-entity="microsoft">Microsoft</span>'],
	['person reads in text order', '{@olia-lialina}', '<span class="entity entity-person" data-entity="olia-lialina">Olia Lialina</span>'],
	['override text', '{@olia-lialina|Lialina}', '<span class="entity entity-person" data-entity="olia-lialina">Lialina</span>'],
	['handle gets its gloss and a card', '{@dan-411}', '<span class="entity entity-handle context" data-entity="dan-411" data-tooltip="The WebTV username" data-card>DAN-411</span>'],
	['person with handles gets a card', '{@dan}', '<span class="entity entity-person" data-entity="dan" data-card>Dan</span>'],
	['site without a logo gets no generic glyph', '{@geekwire}', '<span class="entity entity-site" data-entity="geekwire">GeekWire</span>'],
	['newsgroup by name', '{usenet:alt.discuss.4-webtv}', '<span class="usenet-address">alt.discuss.4-webtv</span>'],
	['hosted site takes its host icon', '{@sparkelies}', '<span class="entity entity-site" data-entity="sparkelies" data-icon="tripod" data-card>Sparkelies</span>'],
	['tooltip', '{tip:A short explanation}term{/tip}', '<strong class="context" data-tooltip="A short explanation">term</strong>'],
	['span tooltip', '{tip:Inline note|tag=span}term{/tip}', '<span class="context" data-tooltip="Inline note">term</span>'],
	['archive link with date', '{link:archive-wayback|https://web.archive.org/web/example}{date:2002-12|December 2002}{/link}', '<a href="https://web.archive.org/web/example" class="external archive-link archive-wayback" target="_blank" rel="noopener noreferrer"><time datetime="2002-12">December 2002</time></a>'],
	['archive service link', '{link:archive-service|https://www.oocities.org/}oocities.org{/link}', '<a href="https://www.oocities.org/" class="external archive-service" target="_blank" rel="noopener noreferrer">oocities.org</a>'],
	['preservation mirror link', '{link:archive-mirror|https://example.com/copy|preservation}Copy{/link}', '<a href="https://example.com/copy" class="external archive-link archive-mirror preservation-copy" target="_blank" rel="noopener noreferrer">Copy</a>'],
	['entity link', '{link:archive-wayback|https://example.com|@sparkelies}Sparkelies{/link}', '<a href="https://example.com" class="external archive-link archive-wayback entity entity-site" target="_blank" rel="noopener noreferrer" data-entity="sparkelies" data-icon="tripod">Sparkelies</a>'],
	['tooltip link', '{link:external|https://example.com|tip=A tool}Tool{/link}', '<a href="https://example.com" class="external context" target="_blank" rel="noopener noreferrer" data-tooltip="A tool">Tool</a>'],
	['in-page anchor', '{goto:HistoryMakingGlitter}Making{/goto}', '<a href="#HistoryMakingGlitter">Making</a>'],
	['open modal button', '{open:personalWebModal}Personal Web{/open}', '<button type="button" class="doc-inline-link" data-open-modal="personalWebModal">Personal Web</button>'],
	['host dead link', '{dead:host-closed|host=tripod|href=http://example.com|tip=Offline}Example{/dead}', '<span class="dead-link host-closed host-tripod" data-host="tripod" data-href="http://example.com" data-tooltip="Offline">Example</span>'],
	['entity dead link', '{dead:page-offline|@sparkelies|href=http://example.com|tip=Offline}Sparkelies{/dead}', '<span class="dead-link page-offline entity entity-site" data-entity="sparkelies" data-icon="tripod" data-href="http://example.com" data-tooltip="Offline">Sparkelies</span>']
];
for (const [name, source, expected] of tokenCases) {
	test(`compile token ${name}`, () => {
		const output = clean(source);
		assert(output === expected, `got ${output}`);
	});
}

test('gloss is a tooltip on the first eligible mention only', () => {
	const output = clean('<h2 id="A">{@webtv}</h2>\n<p>{@webtv} and {@webtv}</p>');
	assert((output.match(/data-tooltip=/gu) || []).length === 1, 'expected exactly one gloss');
	assert(/<p><span class="entity entity-site context" data-entity="webtv" data-tooltip="A TV set-top box for the web" data-card>WebTV<\/span> and/u.test(output), 'gloss did not land on the first paragraph mention');
});

test('|notip moves the gloss on; |tip places it by hand', () => {
	const secondHasGloss = output => {
		const spans = output.match(/<span [^>]*>WebTV<\/span>/gu);
		return spans.length === 2 && !/data-tooltip/u.test(spans[0]) && /data-tooltip/u.test(spans[1]);
	};
	assert(secondHasGloss(clean('<p>{@webtv|notip} and {@webtv}</p>')), '|notip did not pass the gloss to the next mention');
	assert(secondHasGloss(clean('<p>{@webtv} and {@webtv|tip}</p>')), '|tip did not take the gloss');
});

test('{?Name} renders the name and lists it', () => {
	const result = run('<p>{?Neonlove}</p>');
	assert(result.output === '<p>Neonlove</p>' && result.diagnostics.some(item => item.rule === 'todo-tag'), 'tag-later token differed');
});

test('|tip on an entity without a gloss is an error', () => {
	assert(run('<p>{@microsoft|tip}</p>').diagnostics.some(item => item.rule === 'entity-option' && item.severity === 'error'), 'entity-option did not fire');
});

test('a hand-placed tooltip with the gloss text suppresses the automatic one', () => {
	const output = clean('<p>{@webtv}, then {tip:A TV set-top box for the web}{@webtv}{/tip}</p>');
	assert((output.match(/data-tooltip=/gu) || []).length === 1, 'gloss appeared twice');
});

test('site icons appear on the first mention per section; --icons=all shows every one', () => {
	const source = '<h2 id="A">A</h2>\n<p>{@sparkelies} {@sparkelies}</p>\n<h2 id="B">B</h2>\n<p>{@sparkelies}</p>';
	assert((clean(source).match(/data-icon=/gu) || []).length === 2, 'expected one icon per section');
	assert((clean(source, { iconsAll: true }).match(/data-icon=/gu) || []).length === 3, '--icons=all did not show every icon');
});

test('references number by first citation, then from notes', () => {
	const source = '<p>[@b][@a]</p>\n<ol id="TestReferencesList">\n    {references}\n</ol>';
	const output = clean(source);
	assert(output.startsWith('<p><sup>[1][2]</sup></p>'), 'citation numbers differed');
	const items = output.match(/<li>[\s\S]*?<\/li>/gu);
	assert(items.length === 3 && /Beta/u.test(items[0]) && /Alpha/u.test(items[1]) && /Gamma/u.test(items[2]), 'reference order differed');
	assert(/Lialina, Olia/u.test(items[0]), 'person author did not use sortName');
	assert(/<sup>\[3\]<\/sup>/u.test(items[0]), 'a citation inside a note was not numbered');
});

test('general references list sources tagged for the document, alphabetically', () => {
	const output = clean('<ul id="TestGeneralReferencesList" class="general-references-list">\n    {references:general}\n</ul>');
	const items = output.match(/<li>[\s\S]*?<\/li>/gu);
	assert(items.length === 2 && /Beschizza/u.test(items[0]) && /Hand-formatted/u.test(items[1]), 'general list differed');
});

test('a dead source renders as a dead link with its host and archive', () => {
	const rendered = renderSource('c', sources.c, { name: 'sample', entities });
	assert(rendered === '"{dead:host-closed|host=tripod|href=http://members.tripod.com/~x/|tip=Offline: this site no longer exists}Gamma{/dead}". {link:archive-wayback|https://web.archive.org/web/20040624034824/http://members.tripod.com/~x/}Archived {date:2004-06-24|24 June 2004}{/link}.', `got ${rendered}`);
	assert(formatIsoDate('2004-08') === 'August 2004' && formatIsoDate('2004') === '2004', 'date formatting differed');
});

test('[@todo: ...] renders nothing and is listed', () => {
	const result = run('<p>Claim.[@todo: Stardrops capture]</p>');
	assert(result.output === '<p>Claim.</p>', 'todo rendered output');
	assert(result.diagnostics.some(item => item.rule === 'todo-cite' && item.severity === 'warning' && /Stardrops/u.test(item.message)), 'todo was not listed');
});

test('drafts warn; unknown slugs and sources fail --check but only warn while drafting', () => {
	assert(run('<p>{@draftsite}</p>').diagnostics.some(item => item.rule === 'entity-draft' && item.severity === 'warning'), 'draft entity did not warn');
	const strict = run('<p>{@nobody} [@nothing]</p>');
	assert(strict.diagnostics.some(item => item.rule === 'slug-unknown' && item.severity === 'error'), 'unknown slug was not an error');
	assert(strict.diagnostics.some(item => item.rule === 'source-unknown' && item.severity === 'error'), 'unknown source was not an error');
	const draft = run('<p>{@nobody|Nobody} [@nothing]</p>', { draft: true });
	assert(!draft.diagnostics.some(item => item.severity === 'error'), 'draft mode still errored');
	assert(/draft-marker/u.test(draft.output) && /Nobody/u.test(draft.output), 'draft mode did not mark the unknown slug');
});

const errorCases = [
	['token-syntax', '<p>{unknown:value}</p>'],
	['token-syntax', '<p>{site:webtv}</p>'],
	['refs-missing', '<p>[@a]</p>'],
	['refs-multiple', '<p>[@a]</p><ol id="AReferencesList">{references}</ol><ol id="BReferencesList">{references}</ol>'],
	['toc-misplaced', '<p>{toc:TestTOC}</p>\n<h2 id="One">One</h2>'],
	['toc-multiple', '{toc:OneTOC}\n{toc:TwoTOC}\n<h2 id="One">One</h2>'],
	['toc-empty', '{toc:TestTOC}\n<p>No headings</p>']
];
for (const [rule, source] of errorCases) {
	test(`compile error ${rule}`, () => {
		assert(run(source).diagnostics.some(item => item.rule === rule && item.severity === 'error'), `${rule} did not fire`);
	});
}

test('tokens preserve line count; a references list maps to its token line', () => {
	const source = '<p>{y:2001} {file:a.gif} [@a][@b]</p>\n<ol id="TestReferencesList">\n{references}\n</ol>\n';
	const result = run(source);
	assert(!result.diagnostics.some(item => item.severity === 'error'), 'fixture did not compile');
	assert(result.lineMap.length === result.output.split('\n').length, 'line map length differed from output');
	assert(result.lineMap.at(-1) === source.split('\n').length, 'last line did not map to the last source line');
	assert(result.lineMap[3] === 3 && result.lineMap[4] === 3, 'generated reference lines did not map to the token line');
});

test('TOC copies heading markup without tooltips or cards', () => {
	const result = run('{toc:TestTOC}\n<h2 id="One">{@dan}</h2>\n<h3 id="Two">Two</h3>');
	assert(result.diagnostics.length === 0, `TOC diagnostics: ${JSON.stringify(result.diagnostics)}`);
	assert(result.output.includes('<a href="#One"><span class="entity entity-person" data-entity="dan">Dan</span></a>'), 'TOC entry differed');
	assert(result.lineMap.slice(0, 11).every(line => line === 1), 'TOC lines did not map to the token line');
});

test('newsgroups are written without news:', () => {
	const result = run('<p>{usenet:news:alt.test}</p>');
	assert(result.diagnostics.some(item => item.rule === 'token-syntax' && /news:/u.test(item.message)), 'news: prefix was accepted');
});

test('books take an italic title and untitled items a description', () => {
	const output = clean('<p>[@f][@g]</p>\n<ol id="SampleReferencesList">\n\t{references}\n</ol>');
	assert(output.includes('<em>A Manual</em>. <span class="entity entity-org" data-entity="microsoft">Microsoft</span>, <time datetime="2000">2000</time>. Note.'), 'book citation differed');
	assert(output.includes('Microsoft</span>. Email to subscribers.'), 'description citation differed');
});

test('header defaults on and can be disabled', () => {
	const withHeader = compile('<p>Body</p>', { name: 'sample', registry: fixture }).output;
	assert(withHeader === '<!-- GENERATED from content/src/sample.src.html by tools/build-modals.js. Do not edit. -->\n<p>Body</p>', 'header text differed');
	assert(run('<p>Body</p>').output === '<p>Body</p>', 'header:false did not suppress the header');
});

test('tag sweep tags the first untagged mention per section', () => {
	const source = '<h2 id="A">A</h2>\n<p>WebTV and WebTV, DAN-411, a GIF, {link:external|https://x}WebTV{/link}</p>\n<h2 id="B">B</h2>\n<p>{@webtv} then WebTV</p>';
	const { edits } = planTags(source, entities);
	const replacements = edits.map(edit => edit.replacement);
	assert(JSON.stringify(replacements) === JSON.stringify(['{@webtv}', '{@dan-411}']), `got ${JSON.stringify(replacements)}`);
});

test('bare-name lint agrees with the tag sweep', () => {
	const html = '<h2 id="A">A</h2><p>WebTV and WebTV</p><h2 id="B">B</h2><p><span class="entity" data-entity="webtv">WebTV</span> then WebTV</p>';
	const findings = lintSource('sample.html', html, { registry: entities, rule: 'bare-name' });
	assert(findings.length === 1, `expected one finding, got ${findings.length}`);
});

test('cite splits a Wayback URL into original and capture date', () => {
	const parts = waybackParts('https://web.archive.org/web/20040820033248/http://www.scri8e.com/stars/flashites/index.html');
	assert(parts.original === 'http://www.scri8e.com/stars/flashites/index.html' && parts.date === '2004-08-20', 'wayback parts differed');
});

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'glitter-modal-build-'));
const sourceDir = path.join(tempRoot, 'src');
const outDir = path.join(tempRoot, 'out');
fs.mkdirSync(sourceDir, { recursive: true });
try {
	test('--check and --out-dir behavior', () => {
		fs.writeFileSync(path.join(sourceDir, 'sample.src.html'), '<p>{y:2001}</p>\n', 'utf8');
		const built = buildOne('sample', { sourceDir, outDir, lint: false, stamp: false, registry: fixture });
		assert(built.ok && fs.existsSync(path.join(outDir, 'sample.html')), 'initial temp build failed');
		assert(buildOne('sample', { sourceDir, outDir, lint: false, stamp: false, check: true, registry: fixture }).ok, '--check did not accept matching output');
		fs.appendFileSync(path.join(outDir, 'sample.html'), 'changed', 'utf8');
		const mismatch = buildOne('sample', { sourceDir, outDir, lint: false, stamp: false, check: true, registry: fixture });
		assert(!mismatch.ok && mismatch.mismatch, '--check did not reject changed output');
		assert(fs.readFileSync(path.join(outDir, 'sample.html'), 'utf8').endsWith('changed'), '--check rewrote the mismatching output');
	});

	test('prose lint maps back across the generated header, for articles only', () => {
		fs.writeFileSync(path.join(sourceDir, 'history.src.html'), '<p>2001</p>\n', 'utf8');
		const article = buildOne('history', { sourceDir, outDir, stamp: false, registry: fixture });
		const warning = article.diagnostics.find(item => item.rule === 'bare-date');
		assert(article.ok && warning && warning.line === 1, 'article lint diagnostic did not map to source line 1');
		fs.writeFileSync(path.join(sourceDir, 'guide.src.html'), '<p>2001 — dash</p>\n', 'utf8');
		const guide = buildOne('guide', { sourceDir, outDir, stamp: false, registry: fixture });
		assert(guide.ok && !guide.diagnostics.some(item => ['bare-date', 'em-dash'].includes(item.rule)), 'prose rules ran on a non-article');
	});

	test('lint diagnostics map back after an expanded TOC', () => {
		fs.writeFileSync(path.join(sourceDir, 'about.src.html'), '{toc:TestTOC}\n<h2 id="One">One</h2>\n<p>2001</p>\n', 'utf8');
		const result = buildOne('about', { sourceDir, outDir, stamp: false, registry: fixture });
		const warning = result.diagnostics.find(item => item.rule === 'bare-date');
		assert(result.ok && warning && warning.line === 3, 'lint diagnostic after TOC did not map to source line 3');
	});

	test('cache stamp updates a temp wiring copy', () => {
		const wiring = path.join(tempRoot, 'valid-wiring.js');
		fs.writeFileSync(wiring, "const modal = { externalContentUrl: 'modals/history.html?v=old' };\n", 'utf8');
		const generated = '<p>generated</p>\n';
		const expected = crypto.createHash('md5').update(generated).digest('hex').slice(0, 8);
		const result = stampWiring('history', generated, wiring);
		assert(result.found && result.oldValue === 'old' && result.newValue === expected, 'stamp result was incorrect');
		assert(fs.readFileSync(wiring, 'utf8').includes(`?v=${expected}'`), 'temp wiring did not receive the hash');
	});

	test('cache stamp restores a broken temp wiring copy', () => {
		const wiring = path.join(tempRoot, 'broken-wiring.js');
		const original = "const = { externalContentUrl: 'modals/history.html?v=old' };\n";
		fs.writeFileSync(wiring, original, 'utf8');
		let failed = false;
		try {
			stampWiring('history', '<p>generated</p>\n', wiring);
		} catch (error) {
			failed = /restored original/u.test(error.message);
		}
		assert(failed, 'broken wiring did not fail its parse check');
		assert(fs.readFileSync(wiring, 'utf8') === original, 'broken wiring was not restored byte for byte');
	});

	test('cache stamp skips an unwired modal', () => {
		const wiring = path.join(tempRoot, 'unwired.js');
		fs.writeFileSync(wiring, "const modal = { externalContentUrl: 'modals/history.html?v=old' };\n", 'utf8');
		const result = stampWiring('aylana', '<p>generated</p>\n', wiring);
		assert(!result.found && /no wiring registration/u.test(result.message), 'unwired modal was not skipped');
	});
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}

// The real content: the registry is valid, every page builds clean and
// matches its committed output, and the timeline only names known entities.
const real = loadRegistry({ fresh: true });
test('content/entities.json and content/sources.json are valid', () => {
	assert(real.problems.length === 0, real.problems.slice(0, 5).join('\n'));
});
for (const name of discoverNames()) {
	test(`content/src/${name}.src.html builds with no errors and matches modals/${name}.html`, () => {
		const result = buildOne(name, { check: true, stamp: false, registry: real });
		const errors = result.diagnostics.filter(item => item.severity === 'error');
		assert(!errors.length, JSON.stringify(errors.slice(0, 3)));
		assert(result.ok, `modals/${name}.html is out of date: run node tools/build-modals.js`);
	});
}
test('every Preservation timeline entity is in content/entities.json', () => {
	const context = {};
	vm.createContext(context);
	vm.runInContext(`${fs.readFileSync(path.join(root, 'js/ui/about-timeline-data.js'), 'utf8')}\nglobalThis.__timeline = ABOUT_TIMELINE;`, context);
	const missing = [...new Set(context.__timeline.flatMap(item => item.entities))].filter(slug => !real.entities[slug]);
	assert(!missing.length, `unknown timeline entities: ${missing.join(', ')}`);
});
test('every icon an entity names exists', () => {
	const files = contentRegistry.iconFiles();
	const missing = Object.entries(real.entities).filter(([, entry]) => entry.icon && !files.has(entry.icon)).map(([slug]) => slug);
	assert(!missing.length, `entities with a missing icon file: ${missing.join(', ')}`);
});

if (failures) {
	process.stdout.write(`${failures} modal build unit case(s) failed.\n`);
	process.exitCode = 1;
} else {
	process.stdout.write('All modal build unit cases passed.\n');
}

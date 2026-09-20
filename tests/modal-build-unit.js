'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { compile, buildOne, stampWiring } = require('../tools/build-modals');
const { decompile, decompileDetailed } = require('../tools/decompile-modal');
const { lintSource } = require('../tools/modal-lint');

const root = path.resolve(__dirname, '..');
const realNames = ['history', 'personal-web', 'aylana'];
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

function compileClean(source, options = {}) {
	const result = compile(source, { header: false, ...options });
	assert(result.diagnostics.length === 0, `unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
	return result.output;
}

const tokenCases = [
	['date', '{date:2001-06-07|7 June 2001}', '<time datetime="2001-06-07">7 June 2001</time>'],
	['year', '{y:2001}', '<time datetime="2001">2001</time>'],
	['file', '{file:FB12.gif}', '<span class="file-name">FB12.gif</span>'],
	['directory', '{dir:/BAR}', '<span class="file-name file-name-directory">/BAR</span>'],
	['page', '{page:TOOLS.html}', '<span class="file-name file-name-page">TOOLS.html</span>'],
	['site short', '{site:webtv}', '<span class="site-name" data-platform="webtv">WebTV</span>'],
	['site explicit', '{site:webtv|Glitter Connection}', '<span class="site-name" data-platform="webtv">Glitter Connection</span>'],
	['site owner', '{site:wtv-zone|Flashites|user=moondogee}', '<span class="site-name" data-platform="wtv-zone" data-username="moondogee">Flashites</span>'],
	['user short', '{user:mica}', '<span class="username username-cast" data-username="mica" data-platform="wtv-zone">Mica</span>'],
	['user explicit and entity text', '{user:aylana|designbyAylana&trade;}', '<span class="username username-cast" data-username="aylana" data-platform="wtv-zone">designbyAylana&trade;</span>'],
	['person short', '{person:jane}', '<span class="person" data-person="jane" data-platform="other">Jane</span>'],
	['person explicit', '{person:jane|Jane Doe}', '<span class="person" data-person="jane" data-platform="other">Jane Doe</span>'],
	['tool', '{tool:Paint Shop Pro}', '<span class="site-name" data-platform="tool">Paint Shop Pro</span>'],
	['franchise', '{franchise:Sailor Moon}', '<span class="site-name" data-platform="franchise">Sailor Moon</span>'],
	['entity text permits greater-than', '{tool:A > B}', '<span class="site-name" data-platform="tool">A > B</span>']
];
for (const [name, source, expected] of tokenCases) {
	test(`compile token ${name}`, () => assert(compileClean(source) === expected, 'compiled markup differed'));
}

test('number out-of-order references and merge contiguous citations', () => {
	const source = '<p>[@b][@a]</p>\n<ol id="TestReferencesList">\n{ref a}A{/ref}\n{ref b}B{/ref}\n</ol>';
	const expected = '<p><sup>[1][2]</sup></p>\n<ol id="TestReferencesList">\n<li>B</li>\n<li>A</li>\n</ol>';
	assert(compileClean(source) === expected, 'references were not renumbered and reordered');
});

test('number citation reached from a reference body', () => {
	const source = '<p>[@a]</p>\n<ol id="TestReferencesList">\n{ref a}A cites [@b].{/ref}\n{ref b}B{/ref}\n</ol>';
	const expected = '<p><sup>[1]</sup></p>\n<ol id="TestReferencesList">\n<li>A cites <sup>[2]</sup>.</li>\n<li>B</li>\n</ol>';
	assert(compileClean(source) === expected, 'transitive reference citation was not numbered');
});

test('raw reference entries keep their fixed slots', () => {
	const source = '<p>[@b][@a]</p>\n<ol id="TestReferencesList">\n{ref a}A{/ref}\n<li>Fixed raw entry</li>\n{ref b}B{/ref}\n</ol>';
	const expected = '<p><sup>[1][3]</sup></p>\n<ol id="TestReferencesList">\n<li>B</li>\n<li>Fixed raw entry</li>\n<li>A</li>\n</ol>';
	assert(compileClean(source) === expected, 'raw reference slot moved or keyed slots were numbered incorrectly');
});

test('unused reference warning', () => {
	const source = '<p>[@a]</p>\n<ol id="TestReferencesList">\n{ref a}A{/ref}\n{ref b}B{/ref}\n</ol>';
	const result = compile(source, { header: false });
	assert(result.diagnostics.length === 1 && result.diagnostics[0].rule === 'ref-unused' && result.diagnostics[0].severity === 'warning', 'unused reference warning was missing');
});

const errorCases = [
	['token-syntax', '<p>{unknown:value}</p>'],
	['ref-missing', '<p>[@missing]</p><ol id="TestReferencesList"></ol>'],
	['ref-duplicate', '<ol id="TestReferencesList">{ref a}A{/ref}{ref a}B{/ref}</ol>'],
	['ref-misplaced', '<p>{ref a}A{/ref}</p>'],
	['refs-multiple', '<ol id="AReferencesList"></ol><ol id="BReferencesList"></ol>'],
	['ref-ambiguous', '<p><sup>[2]</sup></p><ol id="TestReferencesList">{ref a}A{/ref}</ol>'],
	['token-entity', '<p>{site:not-a-platform}</p>'],
	['token-entity', '<p>{user:not-a-user}</p>'],
	['token-entity', '<p>{person:not-a-person}</p>'],
	['token-entity', '<p>{site:tool}</p>'],
	['token-entity', '<p>{site:franchise}</p>'],
	['token-entity', '<p>{site:independent}</p>'],
	['token-entity', '<p>{site:other}</p>'],
	['token-entity', '<p>{site:webtv|user=mica}</p>'],
	['toc-misplaced', '<p>{toc:TestTOC}</p>\n<h2 id="One">One</h2>'],
	['toc-multiple', '{toc:OneTOC}\n{toc:TwoTOC}\n<h2 id="One">One</h2>'],
	['toc-empty', '{toc:TestTOC}\n<p>No headings</p>']
];
for (const [rule, source] of errorCases) {
	test(`compile error ${rule}`, () => {
		const findings = compile(source, { header: false }).diagnostics.filter(item => item.rule === rule && item.severity === 'error');
		assert(findings.length >= 1, `${rule} did not fire`);
	});
}

test('tokens preserve line count', () => {
	const source = '<p>{y:2001} {file:a.gif} [@a]</p>\n<ol id="TestReferencesList">\n{ref a}{date:2001-01|January 2001}{/ref}\n</ol>\n';
	const result = compile(source, { header: false });
	assert(!result.diagnostics.some(item => item.severity === 'error'), 'fixture did not compile');
	assert(result.output.split('\n').length === source.split('\n').length, 'fixture line count changed');
});

test('TOC generation preserves canonical nesting and compiled heading markup', () => {
	const source = '{toc:TestTOC}\n<h2 id="One">{site:webtv}</h2>\n<h3 id="Two">Two</h3>\n<h4 id="Three">{user:mica}</h4>\n<h2 id="Four">Four</h2>';
	const expected = '<div class="toc" id="TestTOC">\n    <h3>Contents</h3>\n    <ol>\n        <li>\n            <a href="#One"><span class="site-name" data-platform="webtv">WebTV</span></a>\n            <ol>\n                <li>\n                    <a href="#Two">Two</a>\n                    <ol>\n                        <li><a href="#Three"><span class="username username-cast" data-username="mica" data-platform="wtv-zone">Mica</span></a></li>\n                    </ol>\n                </li>\n            </ol>\n        </li>\n        <li><a href="#Four">Four</a></li>\n    </ol>\n</div>\n<h2 id="One"><span class="site-name" data-platform="webtv">WebTV</span></h2>\n<h3 id="Two">Two</h3>\n<h4 id="Three"><span class="username username-cast" data-username="mica" data-platform="wtv-zone">Mica</span></h4>\n<h2 id="Four">Four</h2>';
	const result = compile(source, { header: false });
	assert(result.diagnostics.length === 0, `TOC diagnostics: ${JSON.stringify(result.diagnostics)}`);
	assert(result.output === expected, 'generated TOC differed');
	assert(result.lineMap.slice(0, 17).every(line => line === 1), 'TOC output lines did not map to the token line');
	assert(result.lineMap[17] === 2 && result.lineMap.at(-1) === 5, 'lines after the TOC did not map to source lines');
});

const helperCases = [
	['usenet', '{usenet:news:alt.discuss.4-webtv}', '<span class="usenet-address">news:alt.discuss.4-webtv</span>'],
	['tooltip', '{tip:A short explanation}term{/tip}', '<strong class="context" data-tooltip="A short explanation">term</strong>'],
	['platform tooltip', '{tip:A WebTV explanation|platform=webtv}WebTV{/tip}', '<strong class="context" data-platform="webtv" data-tooltip="A WebTV explanation">WebTV</strong>'],
	['tooltip with entity', '{tip:Identity note}{user:aylana} Ciane{/tip}', '<strong class="context" data-tooltip="Identity note"><span class="username username-cast" data-username="aylana" data-platform="wtv-zone">Aylana</span> Ciane</strong>'],
	['span tooltip', '{tip:Inline note|tag=span}term{/tip}', '<span class="context" data-tooltip="Inline note">term</span>'],
	['person tooltip', '{tip:Artist note|person=mia}M.I.A.{/tip}', '<strong class="context person" data-person="mia" data-platform="other" data-tooltip="Artist note">M.I.A.</strong>'],
	['archive link with date', '{link:archive-wayback|https://web.archive.org/web/example}{date:2002-12|December 2002}{/link}', '<a href="https://web.archive.org/web/example" class="external archive-link archive-wayback" target="_blank" rel="noopener noreferrer"><time datetime="2002-12">December 2002</time></a>'],
	['external file link', '{link:external|http://example.com/FB12.gif}FB12.gif{/link}', '<a href="http://example.com/FB12.gif" class="external" target="_blank" rel="noopener noreferrer">FB12.gif</a>'],
	['archive service link', '{link:archive-service|https://www.oocities.org/|class-first}oocities.org{/link}', '<a class="external archive-service" href="https://www.oocities.org/" target="_blank" rel="noopener noreferrer">oocities.org</a>'],
	['preservation mirror link', '{link:archive-mirror|https://example.com/copy|class-first|preservation}Copy{/link}', '<a class="external archive-link archive-mirror preservation-copy" href="https://example.com/copy" target="_blank" rel="noopener noreferrer">Copy</a>'],
	['tooltip link with site identity', '{link:external|https://www.picmix.com/|platform=picmix|tip=A web-based tool}PicMix{/link}', '<a href="https://www.picmix.com/" class="external site-name context" target="_blank" rel="noopener noreferrer" data-platform="picmix" data-tooltip="A web-based tool">PicMix</a>'],
	['in-page anchor', '{goto:HistoryMakingGlitter}Making Glitter Graphics{/goto}', '<a href="#HistoryMakingGlitter">Making Glitter Graphics</a>'],
	['open modal button', '{open:personalWebModal}Personal Web{/open}', '<button type="button" class="doc-inline-link" data-open-modal="personalWebModal">Personal Web</button>'],
	['class-first link', '{link:external|https://example.com|class-first}Example{/link}', '<a class="external" href="https://example.com" target="_blank" rel="noopener noreferrer">Example</a>'],
	['owned site archive link', '{link:archive-wayback|https://example.com|platform=tripod|user=dan-411}Sparkelies{/link}', '<a href="https://example.com" class="external archive-link archive-wayback site-name" target="_blank" rel="noopener noreferrer" data-platform="tripod" data-username="dan-411">Sparkelies</a>'],
	['host dead link', '{dead:host-closed|host=tripod|href=http://example.com|tip=Offline: this site no longer exists}Example{/dead}', '<span class="dead-link host-closed host-tripod" data-host="tripod" data-href="http://example.com" data-tooltip="Offline: this site no longer exists">Example</span>'],
	['host marker without URL', '{dead:host-closed|host=geocities|tip=Offline: this site no longer exists}{site:geocities}{/dead}', '<span class="dead-link host-closed host-geocities" data-host="geocities" data-tooltip="Offline: this site no longer exists"><span class="site-name" data-platform="geocities">GeoCities</span></span>'],
	['site-name dead link', '{dead:page-offline|platform=independent|href=http://example.com|tip=Offline: this page is gone}Example Site{/dead}', '<span class="site-name dead-link page-offline" data-platform="independent" data-href="http://example.com" data-tooltip="Offline: this page is gone">Example Site</span>'],
	['plain dead link', '{dead:service-closed|href=http://example.com|tip=Offline: this service closed}{site:blingee}{/dead}', '<span class="dead-link service-closed" data-href="http://example.com" data-tooltip="Offline: this service closed"><span class="site-name" data-platform="blingee">Blingee</span></span>']
];
for (const [name, source, expected] of helperCases) {
	test(`compile helper ${name}`, () => assert(compileClean(source) === expected, 'compiled helper markup differed'));
}

test('tooltip rejects an unknown platform', () => {
	const findings = compile('{tip:Gloss|platform=missing}Term{/tip}', { header: false }).diagnostics;
	assert(findings.some(item => item.rule === 'token-entity' && item.severity === 'error'), 'unknown tooltip platform was accepted');
});

test('compiler diagnostics after a TOC keep source lines', () => {
	const source = '{toc:TestTOC}\n<h2 id="One">One</h2>\n<p>ok</p>\n<p>{user:missing}</p>';
	const finding = compile(source, { header: false }).diagnostics.find(item => item.rule === 'token-entity');
	assert(finding && finding.line === 4, 'compiler diagnostic did not retain source line 4');
});

test('header defaults on and can be disabled', () => {
	const withHeader = compile('<p>Body</p>', { name: 'sample' }).output;
	const withoutHeader = compile('<p>Body</p>', { name: 'sample', header: false }).output;
	assert(withHeader === '<!-- GENERATED from content/src/sample.src.html by tools/build-modals.js. Do not edit. -->\n<p>Body</p>', 'header text differed');
	assert(withoutHeader === '<p>Body</p>', 'header:false did not suppress the header');
});

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'glitter-modal-build-'));
const sourceDir = path.join(tempRoot, 'src');
const outDir = path.join(tempRoot, 'out');
fs.mkdirSync(sourceDir, { recursive: true });
try {
	test('--check and --out-dir behavior', () => {
		fs.writeFileSync(path.join(sourceDir, 'sample.src.html'), '<p>{y:2001}</p>\n', 'utf8');
		const built = buildOne('sample', { sourceDir, outDir, lint: false, stamp: false });
		assert(built.ok && fs.existsSync(path.join(outDir, 'sample.html')), 'initial temp build failed');
		assert(buildOne('sample', { sourceDir, outDir, lint: false, stamp: false, check: true }).ok, '--check did not accept matching output');
		fs.appendFileSync(path.join(outDir, 'sample.html'), 'changed', 'utf8');
		const mismatch = buildOne('sample', { sourceDir, outDir, lint: false, stamp: false, check: true });
		assert(!mismatch.ok && mismatch.mismatch, '--check did not reject changed output');
		assert(fs.readFileSync(path.join(outDir, 'sample.html'), 'utf8').endsWith('changed'), '--check rewrote the mismatching output');
	});

	test('lint diagnostics map back across the generated header', () => {
		fs.writeFileSync(path.join(sourceDir, 'lint-line.src.html'), '<p>2001</p>\n', 'utf8');
		const result = buildOne('lint-line', { sourceDir, outDir, stamp: false });
		const warning = result.diagnostics.find(item => item.rule === 'bare-date');
		assert(result.ok && warning && warning.line === 1, 'lint diagnostic did not map to source line 1');
	});

	test('lint diagnostics map back after an expanded TOC', () => {
		fs.writeFileSync(path.join(sourceDir, 'lint-toc.src.html'), '{toc:TestTOC}\n<h2 id="One">One</h2>\n<p>2001</p>\n', 'utf8');
		const result = buildOne('lint-toc', { sourceDir, outDir, stamp: false });
		const warning = result.diagnostics.find(item => item.rule === 'bare-date');
		assert(result.ok && warning && warning.line === 3, 'lint diagnostic after TOC did not map to source line 3');
	});

	test('cache stamp updates a temp wiring copy', () => {
		const wiring = path.join(tempRoot, 'valid-wiring.js');
		const content = "const modal = { externalContentUrl: 'modals/history.html?v=old' };\n";
		fs.writeFileSync(wiring, content, 'utf8');
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

for (const name of realNames) {
	const modalPath = path.join(root, 'modals', `${name}.html`);
	if (!fs.existsSync(modalPath)) continue;
	const original = fs.readFileSync(modalPath, 'utf8');
	for (const steps of [allStepsLabel(), ['time'], ['file'], ['refs'], ['entities'], ['helpers'], ['toc']]) {
		const label = Array.isArray(steps) ? steps[0] : steps;
		test(`round trip ${name} ${label}`, () => {
			const source = decompile(original, { steps: label === 'all' ? undefined : steps });
			const result = compile(source, { name, header: false });
			assert(result.diagnostics.length === 0, `compile diagnostics: ${JSON.stringify(result.diagnostics)}`);
			assert(result.output === original, 'round trip was not byte-identical');
			assert(result.lineMap.length === result.output.split('\n').length, 'line map length differed from output');
			assert(result.lineMap.at(-1) === source.split('\n').length, 'last output line did not map to the last source line');
		});
	}
	test(`compiled output lints clean ${name}`, () => {
		const source = decompile(original);
		const result = compile(source, { name, header: true });
		assert(result.diagnostics.length === 0, 'compiler reported diagnostics');
		const findings = lintSource(`modals/${name}.html`, result.output);
		assert(findings.length === 0, `lint findings: ${JSON.stringify(findings)}`);
	});
	test(`decompile counts ${name}`, () => {
		const result = decompileDetailed(original);
		assert(result.stats.converted.time >= 0 && result.stats.converted.references > 0, 'conversion stats were not populated');
	});
}

test('decompiler refuses malformed HTML', () => {
	let failed = false;
	try {
		decompile('<p><span>broken</p>');
	} catch (error) {
		failed = /Tokenizer failed/u.test(error.message);
	}
	assert(failed, 'malformed HTML was accepted');
});

test('decompiler keeps noncanonical constructs raw', () => {
	const original = '<p><time datetime="yesterday"><em>Then</em></time> <time datetime=\'2001\'>2001</time> <span class="file-name" title="x">a.gif</span><sup>[1]</sup></p>\n<ol id="TestReferencesList">\n<li class="source">Attributed entry</li>\n</ol>';
	const result = decompileDetailed(original);
	assert(result.source === original, 'noncanonical constructs were changed');
	assert(result.stats.raw.timeMarkup === 1, 'time-with-markup count was missing');
	assert(result.stats.raw.timeNoncanonical === 1, 'noncanonical time count was missing');
	assert(result.stats.raw.fileNoncanonical === 1, 'noncanonical file count was missing');
	assert(result.stats.raw.referenceAttributes === 1, 'attributed reference count was missing');
	assert(result.stats.raw.citationRawTarget === 1, 'citation-to-raw-reference count was missing');
});

test('decompiler leaves multi-line references raw', () => {
	const original = '<ol id="TestReferencesList">\n<li>\nMultiple lines\n</li>\n</ol>';
	const result = decompileDetailed(original);
	assert(result.source === original, 'multi-line reference was changed');
	assert(result.stats.raw.referenceMultiline === 1, 'multi-line reference count was missing');
});

test('decompiler key collisions are stable', () => {
	const original = '<p><sup>[1][2]</sup></p>\n<ol id="TestReferencesList">\n<li>"<a href="#">Same title</a>".</li>\n<li>"<a href="#">Same title</a>" again.</li>\n</ol>';
	const source = decompile(original);
	assert(source.includes('[@same-title][@same-title-2]'), 'citation keys did not receive stable collision suffixes');
	assert(source.includes('{ref same-title}') && source.includes('{ref same-title-2}'), 'reference keys did not receive stable collision suffixes');
	assert(compileClean(source) === original, 'collision-key fixture did not round trip');
});

test('decompiler rejects citation beyond the list', () => {
	let failed = false;
	try {
		decompile('<p><sup>[2]</sup></p><ol id="TestReferencesList"><li>Only one</li></ol>');
	} catch (error) {
		failed = /Citation \[2\]/u.test(error.message);
	}
	assert(failed, 'out-of-range citation was accepted');
});

test('decompiler keeps registry disagreements and compound entities raw', () => {
	const original = '<p><span class="username" data-username="mica" data-platform="reddit">Mica</span> <span class="username" data-username="mica" data-platform="wtv-zone">Mica</span> <strong class="context person" data-person="jane" data-platform="other">Jane</strong> <span class="site-name"><em>WebTV</em></span></p>';
	const result = decompileDetailed(original, { steps: ['entities'] });
	assert(result.source === original, 'noncanonical entities were changed');
	assert(result.stats.raw.entityPlatformDiffers === 1, 'platform mismatch was not counted');
	assert(result.stats.raw.entityCastDiffers === 1, 'cast mismatch was not counted');
	assert(result.stats.raw.entityCompound === 1, 'compound entity was not counted');
	assert(result.stats.raw.entityTextMarkup === 1, 'entity text markup was not counted');
});

test('decompiler emits short, explicit, owner, and sugar entity tokens', () => {
	const original = '<p><span class="site-name" data-platform="webtv">WebTV</span> <span class="site-name" data-platform="webtv">Glitter Connection</span> <span class="site-name" data-platform="wtv-zone" data-username="moondogee">Flashites</span> <span class="username username-cast" data-username="mica" data-platform="wtv-zone">Mica</span> <span class="username username-cast" data-username="mica" data-platform="wtv-zone">Stardrops</span> <span class="person" data-person="jane" data-platform="other">Jane</span> <span class="site-name" data-platform="tool">A > B</span> <span class="site-name" data-platform="franchise">Sailor Moon</span></p>';
	const source = decompile(original, { steps: ['entities'] });
	const expected = '<p>{site:webtv} {site:webtv|Glitter Connection} {site:wtv-zone|Flashites|user=moondogee} {user:mica} {user:mica|Stardrops} {person:jane} {tool:A > B} {franchise:Sailor Moon}</p>';
	assert(source === expected, 'entity token selection differed');
	assert(compileClean(source) === original, 'entity token fixture did not round trip');
});

test('decompiler emits canonical inline helper tokens', () => {
	const original = '<p><span class="usenet-address">news:alt.discuss.4-webtv</span> <strong class="context" data-platform="webtv" data-tooltip="A WebTV explanation">WebTV</strong> <span class="context" data-tooltip="Inline note">term</span> <a href="https://web.archive.org/web/example" class="external archive-link archive-wayback" target="_blank" rel="noopener noreferrer"><time datetime="2002-12">December 2002</time></a> <a href="http://example.com/FB12.gif" class="external" target="_blank" rel="noopener noreferrer">FB12.gif</a> <a class="external archive-link archive-wayback site-name" href="https://example.com" target="_blank" rel="noopener noreferrer" data-platform="tripod" data-username="dan-411">Sparkelies</a></p>';
	const source = decompile(original, { steps: ['time', 'helpers'] });
	const expected = '<p>{usenet:news:alt.discuss.4-webtv} {tip:A WebTV explanation|platform=webtv}WebTV{/tip} {tip:Inline note|tag=span}term{/tip} {link:archive-wayback|https://web.archive.org/web/example}{date:2002-12|December 2002}{/link} {link:external|http://example.com/FB12.gif}FB12.gif{/link} {link:archive-wayback|https://example.com|platform=tripod|user=dan-411|class-first}Sparkelies{/link}</p>';
	assert(source === expected, 'inline helper token selection differed');
	assert(compileClean(source) === original, 'inline helper fixture did not round trip');
});

test('decompiler keeps noncanonical helper wrappers raw', () => {
	const original = '<p><span class="usenet-address" title="x">news:test</span> <strong data-tooltip="Gloss" class="context">term</strong> <a class="external extra" href="https://example.com" target="_blank" rel="noopener noreferrer">Example</a></p>';
	assert(decompile(original, { steps: ['helpers'] }) === original, 'noncanonical helper wrapper was changed');
});

test('decompiler emits dead-link tokens with identity and nested tokens', () => {
	const original = '<p><span class="dead-link host-closed host-geocities" data-host="geocities" data-tooltip="Offline: this site no longer exists"><span class="site-name" data-platform="geocities">GeoCities</span></span> <span class="site-name dead-link page-offline" data-platform="independent" data-href="http://example.com" data-tooltip="Offline: this page is gone">Example Site</span></p>';
	const source = decompile(original, { steps: ['entities', 'helpers'] });
	const expected = '<p>{dead:host-closed|host=geocities|tip=Offline: this site no longer exists}{site:geocities}{/dead} {dead:page-offline|platform=independent|href=http://example.com|tip=Offline: this page is gone}Example Site{/dead}</p>';
	assert(source === expected, 'dead-link token selection differed');
	assert(compileClean(source) === original, 'dead-link fixture did not round trip');
});

function allStepsLabel() {
	return 'all';
}

if (failures) {
	process.stdout.write(`${failures} modal build unit case(s) failed.\n`);
	process.exitCode = 1;
} else {
	process.stdout.write('All modal build unit cases passed.\n');
}

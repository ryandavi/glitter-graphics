// An optional second pass on an article's prose, never part of the build:
// flags likely teasers, negation setups and kicker closers (the patterns in
// the history style guide's "Every sentence earns its place"). Heuristics are
// noisy, so every finding is only a suggestion.
//
//   node tools/voice-check.js history
const fs = require('fs');
const path = require('path');
const { compile, loadRegistry } = require('./build-modals');
const { tokenize, buildTree, walk, textContent } = require('./modal-tokenize');

const root = path.resolve(__dirname, '..');

const TEASERS = [
	/\bhad an? (?:\w+ )?parallel\b/iu,
	/\bcame in (?:two|three|four|several|many) (?:main )?(?:forms|kinds|types|flavors)\b/iu,
	/\btends? to get lost\b/iu,
	/\bcame later\b/iu,
	/\bwas only one\b/iu,
	/\bis worth (?:keeping|noting|mentioning)\b/iu,
	/\b(?:here's|here is) (?:the|what)\b/iu,
	/\bthe (?:answer|reason|story|catch) is\b/iu,
	/\b(?:this|that|it) matters\b/iu
];
const NEGATIONS = [
	/^None of\b/u,
	/^(?:It|This|That|They|These|Those) (?:did|was|were|is|are) not\b/u,
	/^(?:It|This|That|They|These|Those) (?:didn't|wasn't|weren't|isn't|aren't)\b/u,
	/^Not (?:because|that|every|all|just|only)\b/u,
	/\bbut (?:they|it) (?:are|is|were|was) not the same\b/iu
];

function sentences(text) {
	return text.replace(/\s+/gu, ' ').trim().split(/(?<=[.!?]["”)]?)\s+(?=[A-Z"“(])/u).filter(Boolean);
}

function words(sentence) {
	return sentence.split(/\s+/u).filter(Boolean).length;
}

function check(name) {
	const sourcePath = path.join(root, 'content', 'src', `${name}.src.html`);
	if (!fs.existsSync(sourcePath)) {
		process.stderr.write(`No source content/src/${name}.src.html\n`);
		return 1;
	}
	const source = fs.readFileSync(sourcePath, 'utf8');
	const compiled = compile(source, { name, header: false, draft: true, registry: loadRegistry() });
	const tree = buildTree(tokenize(compiled.output));
	const findings = [];
	walk(tree, node => {
		if (node.type !== 'element' || node.tag !== 'p') return;
		const outputLine = node.open.line;
		const line = compiled.lineMap[outputLine - 1] || outputLine;
		const list = sentences(textContent(node).replace(/\[\d+\]/gu, ''));
		list.forEach((sentence, index) => {
			const short = words(sentence) <= 12;
			const next = list[index + 1];
			if (short && next && TEASERS.some(pattern => pattern.test(sentence))) findings.push([line, 'teaser', sentence]);
			else if (NEGATIONS.some(pattern => pattern.test(sentence))) findings.push([line, 'negation', sentence]);
			else if (index === list.length - 1 && list.length >= 3 && short && !/[?]$/u.test(sentence) && !/["”]$/u.test(sentence)) findings.push([line, 'kicker', sentence]);
		});
	});
	const advice = {
		teaser: 'announces the next sentence; delete it or merge the two',
		negation: 'sets up a claim with a negation; state the claim, or say whose belief it corrects',
		kicker: 'short closer; keep it only if it adds a fact or a joke'
	};
	for (const [line, kind, sentence] of findings) {
		process.stdout.write(`content/src/${name}.src.html(${line},1): warning voice-${kind}: "${sentence.slice(0, 110)}" ${advice[kind]}.\n`);
	}
	process.stdout.write(`${findings.length} suggestion(s). These are heuristics: ignore any that are doing real work.\n`);
	return 0;
}

if (require.main === module) {
	const name = process.argv[2];
	if (!name) {
		process.stdout.write('usage: node tools/voice-check.js <page>\n');
		process.exitCode = 1;
	} else process.exitCode = check(name);
}

module.exports = { sentences, check };

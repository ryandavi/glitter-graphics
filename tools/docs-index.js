#!/usr/bin/env node
'use strict';

// Regenerates the document tables in docs/README.md from the files themselves,
// so the index can never drift from what is on disk. A document's folder is its
// lifecycle state; an in-file "Status:" line is shown only for active plans,
// because archived plans keep whatever status they had when they were written.
//
//   node tools/docs-index.js           rewrite docs/README.md
//   node tools/docs-index.js --check   exit 1 if docs/README.md is out of date
//
// Everything above BEGIN_MARKER in docs/README.md is hand-written and preserved.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const docsDir = path.join(root, 'docs');
const readmePath = path.join(docsDir, 'README.md');
const BEGIN_MARKER = '<!-- BEGIN GENERATED INDEX: node tools/docs-index.js -->';
const END_MARKER = '<!-- END GENERATED INDEX -->';
const SUMMARY_LENGTH = 160;
const STATUS_LENGTH = 110;

const SECTIONS = [
	{ dir: '', title: 'Reference (tracked in git)', blurb: 'The system as it is today. Keep these current; they are never archived.', status: false },
	{ dir: 'local', title: 'Local reference', blurb: 'Reference material that stays out of git.', status: false },
	{ dir: 'plans', title: 'Active plans', blurb: 'Work that is proposed, approved or in progress.', status: true },
	{ dir: '!old', title: 'Archive', blurb: 'Finished, superseded or abandoned plans, kept as decision records.', status: false }
];

function truncate(text, length) {
	return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}

function cleanInline(text) {
	return text
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/\*\*|__/g, '')
		.replace(/\|/g, '\\|')
		.replace(/\s+/g, ' ')
		.trim();
}

function isMetaLine(line) {
	return /^(\**\s*)?(status|date|type|branch)\b[^:]*:/i.test(line.replace(/^[>*\s]+/, ''))
		|| /^\*\*date:\*\*/i.test(line);
}

function describe(filePath) {
	const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
	const titleLine = lines.find((line) => /^#\s+/.test(line));
	const title = titleLine ? cleanInline(titleLine.replace(/^#\s+/, '')) : path.basename(filePath, '.md');

	let status = '';
	for (const line of lines.slice(0, 25)) {
		const match = line.replace(/^[>*\s]+/, '').match(/^status[^:]*:\**\s*(.+)$/i);
		if (match) {
			status = truncate(cleanInline(match[1]), STATUS_LENGTH);
			break;
		}
	}

	let summary = '';
	let inMeta = false;
	const start = titleLine ? lines.indexOf(titleLine) + 1 : 0;
	for (const line of lines.slice(start, start + 40)) {
		const trimmed = line.trim();
		// A status or date line can wrap; skip its continuation up to the next blank line.
		if (isMetaLine(trimmed)) { inMeta = true; continue; }
		if (inMeta) { if (!trimmed) inMeta = false; continue; }
		if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('|') || trimmed.startsWith('```')
			|| trimmed.startsWith('<!--') || /^[-*_]{3,}$/.test(trimmed)) {
			if (summary) break;
			continue;
		}
		summary += `${summary ? ' ' : ''}${trimmed}`;
		if (summary.length >= SUMMARY_LENGTH) break;
	}
	return { title, status, summary: truncate(cleanInline(summary), SUMMARY_LENGTH) };
}

function linkFor(dir, file) {
	const target = dir ? `${dir}/${file}` : file;
	return /[\s()<>]/.test(target) ? `<${target}>` : target;
}

function buildSection(section) {
	const dirPath = path.join(docsDir, section.dir);
	if (!fs.existsSync(dirPath)) return '';
	const files = fs.readdirSync(dirPath)
		.filter((file) => file.endsWith('.md') && !(section.dir === '' && file === 'README.md'))
		.sort((a, b) => a.localeCompare(b));
	const out = [`## ${section.title}`, '', section.blurb, ''];
	if (!files.length) return [...out, '_None._', ''].join('\n');
	out.push(section.status ? '| Document | Status | Summary |' : '| Document | Summary |');
	out.push(section.status ? '|---|---|---|' : '|---|---|');
	files.forEach((file) => {
		const info = describe(path.join(dirPath, file));
		const cell = `[${info.title}](${linkFor(section.dir, file)})`;
		out.push(section.status
			? `| ${cell} | ${info.status || '—'} | ${info.summary} |`
			: `| ${cell} | ${info.summary} |`);
	});
	out.push('');
	return out.join('\n');
}

function main() {
	const check = process.argv.includes('--check');
	const current = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8').replace(/\r\n/g, '\n') : '';
	const beginIndex = current.indexOf(BEGIN_MARKER);
	const header = beginIndex >= 0 ? current.slice(0, beginIndex) : `${current.trimEnd()}\n\n`;
	const body = SECTIONS.map(buildSection).filter(Boolean).join('\n');
	const next = `${header}${BEGIN_MARKER}\n\n${body}${END_MARKER}\n`;

	if (check) {
		if (next !== current) {
			process.stderr.write('docs/README.md is out of date. Run: node tools/docs-index.js\n');
			process.exit(1);
		}
		process.stdout.write('PASS docs/README.md index is current\n');
		return;
	}
	fs.writeFileSync(readmePath, next);
	process.stdout.write(`Wrote ${path.relative(root, readmePath)}\n`);
}

main();

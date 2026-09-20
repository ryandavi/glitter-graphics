const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tokenize, buildTree, walk } = require('./modal-tokenize');
const { lintSource } = require('./modal-lint');

const entities = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'content', 'entities.json'), 'utf8'));
const categoryPlatforms = new Set(['independent', 'other', 'tool', 'franchise']);

const root = path.resolve(__dirname, '..');
const defaultSourceDir = path.join(root, 'content', 'src');
const defaultOutputDir = path.join(root, 'modals');
const defaultWiringPath = path.join(root, 'js', 'editor', 'modals-wiring.js');
const keyPattern = '[a-z0-9][a-z0-9-]*';

function lineColAt(source, offset) {
	const before = source.slice(0, offset);
	const lines = before.split('\n');
	return { line: lines.length, col: lines[lines.length - 1].length + 1 };
}

function diagnostic(source, offset, severity, rule, message) {
	return { ...lineColAt(source, Math.max(0, offset)), severity, rule, message };
}

function hasErrors(diagnostics) {
	return diagnostics.some(item => item.severity === 'error');
}

function referenceLists(tree) {
	const lists = [];
	walk(tree, node => {
		if (node.type === 'element' && node.tag === 'ol' && String(node.attrs.id || '').endsWith('ReferencesList')) lists.push(node);
	});
	return lists;
}

function collectCitations(source, start = 0, end = source.length) {
	const citations = [];
	const pattern = new RegExp(`\\[@(${keyPattern})\\]`, 'gu');
	pattern.lastIndex = start;
	let match;
	while ((match = pattern.exec(source)) && match.index < end) {
		citations.push({ key: match[1], start: match.index, end: pattern.lastIndex });
	}
	return citations;
}

function collectRawNumericCitations(parsed) {
	const citations = [];
	if (!parsed.tree) return citations;
	walk(parsed.tree, node => {
		if (node.type !== 'element' || node.tag !== 'sup' || !node.close || node.attrList.length) return;
		if (!node.children.every(child => child.type === 'text')) return;
		const value = node.children.map(child => child.value).join('');
		const matches = [...value.matchAll(/\[(\d+)\]/gu)];
		if (!matches.length || matches.map(match => match[0]).join('') !== value) return;
		for (const match of matches) citations.push({ number: Number(match[1]), start: node.open.start });
	});
	return citations;
}

function parseReferences(source) {
	const diagnostics = [];
	let tokens;
	let tree;
	try {
		tokens = tokenize(source);
		tree = buildTree(tokens);
	} catch (error) {
		diagnostics.push({
			line: error.line || 1,
			col: error.col || 1,
			severity: 'error',
			rule: 'token-syntax',
			message: error.message.replace(/ at \d+:\d+$/u, '')
		});
		return { diagnostics, tokens: [], tree: null, list: null, slots: [], blocks: new Map() };
	}

	const lists = referenceLists(tree);
	if (lists.length > 1) diagnostics.push(diagnostic(source, lists[1].open.start, 'error', 'refs-multiple', 'More than one numbered references list was found.'));
	const list = lists[0] || null;
	const blocks = new Map();
	const slots = [];
	const matchedMarkerRanges = [];
	if (list && list.close) {
		const innerStart = list.open.end;
		const innerEnd = list.close.start;
		const inner = source.slice(innerStart, innerEnd);
		const blockPattern = new RegExp(`\\{ref (${keyPattern})\\}([^\\r\\n]*?)\\{\\/ref\\}`, 'gu');
		let match;
		while ((match = blockPattern.exec(inner))) {
			const start = innerStart + match.index;
			const end = innerStart + blockPattern.lastIndex;
			const block = { type: 'ref', key: match[1], body: match[2], start, end, sourceIndex: slots.length };
			if (blocks.has(block.key)) diagnostics.push(diagnostic(source, start, 'error', 'ref-duplicate', `Duplicate reference key "${block.key}".`));
			else blocks.set(block.key, block);
			slots.push(block);
			matchedMarkerRanges.push([start, end]);
		}
		for (const child of list.children) {
			if (child.type === 'element' && child.tag === 'li' && child.close) {
				slots.push({
					type: 'raw',
					body: source.slice(child.open.end, child.close.start),
					raw: source.slice(child.open.start, child.close.end),
					start: child.open.start,
					end: child.close.end,
					node: child
				});
			}
		}
		slots.sort((left, right) => left.start - right.start);
		for (let index = 0; index < slots.length; index += 1) slots[index].slot = index + 1;
		let cursor = innerStart;
		for (const slot of slots) {
			if (slot.start < cursor) continue;
			const gap = source.slice(cursor, slot.start);
			if (/\S/u.test(gap)) diagnostics.push(diagnostic(source, cursor + gap.search(/\S/u), 'error', 'ref-ambiguous', 'References list contains content that is neither a keyed reference nor a raw <li>.'));
			cursor = slot.end;
		}
		const tail = source.slice(cursor, innerEnd);
		if (/\S/u.test(tail)) diagnostics.push(diagnostic(source, cursor + tail.search(/\S/u), 'error', 'ref-ambiguous', 'References list contains content that is neither a keyed reference nor a raw <li>.'));
	}

	const markerPattern = new RegExp(`\\{ref(?: ${keyPattern})?\\}|\\{\\/ref\\}`, 'gu');
	for (const match of source.matchAll(markerPattern)) {
		const insideList = Boolean(list && match.index >= list.open.end && match.index < list.close.start);
		const insideBlock = matchedMarkerRanges.some(([start, end]) => match.index >= start && match.index < end);
		if (!insideList) diagnostics.push(diagnostic(source, match.index, 'error', 'ref-misplaced', 'Reference block marker appears outside the numbered references list.'));
		else if (!insideBlock) diagnostics.push(diagnostic(source, match.index, 'error', 'token-syntax', 'Malformed or multi-line reference block.'));
	}
	return { diagnostics, tokens, tree, list, slots, blocks };
}

function numberReferences(source) {
	const parsed = parseReferences(source);
	const diagnostics = [...parsed.diagnostics];
	const numbers = new Map();
	if (!parsed.tree) return { source, diagnostics, numbers };
	const allCitations = collectCitations(source);
	for (const citation of allCitations) {
		if (!parsed.blocks.has(citation.key)) diagnostics.push(diagnostic(source, citation.start, 'error', 'ref-missing', `Citation key "${citation.key}" has no reference block.`));
	}
	if (!parsed.list) {
		return { source, diagnostics, numbers };
	}
	const listStart = parsed.list.open.end;
	const listEnd = parsed.list.close.start;
	const availableSlots = parsed.slots.filter(slot => slot.type === 'ref').map(slot => slot.slot);
	let availableIndex = 0;
	function assign(key) {
		if (numbers.has(key) || !parsed.blocks.has(key)) return;
		while (availableIndex < availableSlots.length && [...numbers.values()].includes(availableSlots[availableIndex])) availableIndex += 1;
		const number = availableSlots[availableIndex++];
		if (number == null) {
			diagnostics.push(diagnostic(source, parsed.blocks.get(key).start, 'error', 'ref-ambiguous', `No reference-list slot is available for key "${key}".`));
			return;
		}
		numbers.set(key, number);
	}
	for (const citation of collectRawNumericCitations(parsed)) {
		const slot = parsed.slots[citation.number - 1];
		if (!slot) {
			diagnostics.push(diagnostic(source, citation.start, 'error', 'ref-ambiguous', `Raw citation [${citation.number}] has no reference-list slot.`));
			continue;
		}
		if (slot.type === 'ref') {
			if (numbers.has(slot.key) && numbers.get(slot.key) !== citation.number) diagnostics.push(diagnostic(source, citation.start, 'error', 'ref-ambiguous', `Raw citation [${citation.number}] conflicts with keyed reference numbering.`));
			else numbers.set(slot.key, citation.number);
		}
	}

	for (const citation of allCitations.filter(item => item.start < listStart || item.start >= listEnd)) assign(citation.key);
	const processed = new Set();
	let madeProgress = true;
	while (madeProgress) {
		madeProgress = false;
		for (const slot of parsed.slots) {
			const processKey = slot.type === 'raw' ? `raw:${slot.slot}` : slot.key;
			if (processed.has(processKey)) continue;
			if (slot.type === 'ref' && !numbers.has(slot.key)) continue;
			processed.add(processKey);
			madeProgress = true;
			for (const citation of collectCitations(slot.body)) assign(citation.key);
		}
	}
	for (const slot of parsed.slots) {
		if (slot.type !== 'ref' || numbers.has(slot.key)) continue;
		assign(slot.key);
		diagnostics.push(diagnostic(source, slot.start, 'warning', 'ref-unused', `Reference key "${slot.key}" is never cited.`));
	}

	const targetKeys = new Map([...numbers.entries()].map(([key, number]) => [number, key]));
	const willReorder = parsed.slots.some(slot => slot.type === 'ref' && targetKeys.get(slot.slot) !== slot.key);
	if (willReorder && /<sup>\s*\[\d+\]/u.test(source)) {
		diagnostics.push(diagnostic(source, source.search(/<sup>\s*\[\d+\]/u), 'error', 'ref-ambiguous', 'Raw numeric citations cannot be preserved while keyed references are reordered.'));
	}
	if (hasErrors(diagnostics)) return { source, diagnostics, numbers };

	let reordered = '';
	let cursor = 0;
	for (const slot of parsed.slots) {
		reordered += source.slice(cursor, slot.start);
		if (slot.type === 'raw') {
			reordered += slot.raw;
		} else {
			const key = targetKeys.get(slot.slot);
			const block = parsed.blocks.get(key);
			reordered += `<li>${block.body}</li>`;
		}
		cursor = slot.end;
	}
	reordered += source.slice(cursor);
	return { source: reordered, diagnostics, numbers };
}

function validIso(value) {
	const match = value.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u);
	if (!match) return false;
	if (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 12)) return false;
	if (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 31)) return false;
	return true;
}

function entityError(originalSource, offset, diagnostics, message) {
	diagnostics.push(diagnostic(originalSource, offset, 'error', 'token-entity', message));
}

function expandHelper(remaining, token, index, originalSource, numbers, diagnostics) {
	let match = remaining.match(/^\{usenet:([^|{}<\r\n]+)\}/u);
	if (match) return { value: `<span class="usenet-address">${match[1]}</span>`, length: match[0].length };

	if (remaining.startsWith('{tip:')) {
		const headerEnd = remaining.indexOf('}');
		const header = headerEnd === -1 ? null : remaining.slice(5, headerEnd).split('|');
		const tooltip = header && header.shift();
		const options = new Set(header || []);
		const platformOption = [...options].find(value => value.startsWith('platform='));
		const personOption = [...options].find(value => value.startsWith('person='));
		const tagOption = [...options].find(value => value.startsWith('tag='));
		const known = [...options].every(value => /^(?:platform|person|tag)=[^=]+$/u.test(value));
		const tag = tagOption ? tagOption.slice(4) : 'strong';
		const platform = platformOption ? platformOption.slice(9) : null;
		const person = personOption ? personOption.slice(7) : null;
		const openLength = headerEnd + 1;
		const close = remaining.indexOf('{/tip}', openLength);
		if (!tooltip || /["{}<\r\n]/u.test(tooltip) || !known || !['strong', 'span'].includes(tag) || (person && (platform || tag !== 'strong'))) return null;
		if (close !== -1) {
			const body = remaining.slice(openLength, close);
			if (!body || /[<\r\n]/u.test(body)) return null;
			if (platform && (!entities.platforms[platform] || platform.startsWith('_'))) {
				entityError(originalSource, token.start + index, diagnostics, `Unknown platform slug "${platform}".`);
				return { value: remaining.slice(0, close + 6), length: close + 6 };
			}
			const personEntry = person ? entities.persons[person] : null;
			if (person && (!personEntry || person.startsWith('_'))) {
				entityError(originalSource, token.start + index, diagnostics, `Unknown person slug "${person}".`);
				return { value: remaining.slice(0, close + 6), length: close + 6 };
			}
			const expanded = expandText(body, { start: token.start + index + openLength }, originalSource, numbers, diagnostics);
			let attributes = 'class="context"';
			if (person) attributes = `class="context person" data-person="${person}" data-platform="${personEntry.platform}"`;
			else if (platform) attributes += ` data-platform="${platform}"`;
			return {
				value: `<${tag} ${attributes} data-tooltip="${tooltip}">${expanded}</${tag}>`,
				length: close + 6
			};
		}
	}

	if (remaining.startsWith('{link:')) {
		const headerEnd = remaining.indexOf('}');
		const header = headerEnd === -1 ? [] : remaining.slice(6, headerEnd).split('|');
		const kind = header.shift();
		const href = header.shift();
		const options = new Set(header);
		const platformOption = [...options].find(value => value.startsWith('platform='));
		const userOption = [...options].find(value => value.startsWith('user='));
		const platform = platformOption ? platformOption.slice(9) : null;
		const username = userOption ? userOption.slice(5) : null;
		const classFirst = options.has('class-first');
		const preservation = options.has('preservation');
		const tipOption = [...options].find(value => value.startsWith('tip='));
		const tooltip = tipOption ? tipOption.slice(4) : null;
		const known = [...options].every(value => value === 'class-first' || value === 'preservation' || /^(?:platform|user)=[^=]+$/u.test(value) || /^tip=[^=|]/u.test(value));
		const kinds = new Set(['external', 'archive-wayback', 'archive-index', 'archive-mirror', 'archive-service', 'historical-snapshot']);
		const openLength = headerEnd + 1;
		const close = remaining.indexOf('{/link}', openLength);
		if (!kinds.has(kind) || !href || /["{}<>\r\n]/u.test(href) || !known || (username && !platform) || (tooltip && /["{}<\r\n]/u.test(tooltip)) || (preservation && kind !== 'archive-mirror')) return null;
		if (close !== -1) {
			const body = remaining.slice(openLength, close);
			if (!body || /[<\r\n]/u.test(body)) return null;
			if (platform && (!entities.platforms[platform] || platform.startsWith('_'))) {
				entityError(originalSource, token.start + index, diagnostics, `Unknown platform slug "${platform}".`);
				return { value: remaining.slice(0, close + 7), length: close + 7 };
			}
			if (username && (!entities.usernames[username] || username.startsWith('_'))) {
				entityError(originalSource, token.start + index, diagnostics, `Unknown username slug "${username}".`);
				return { value: remaining.slice(0, close + 7), length: close + 7 };
			}
			const expanded = expandText(body, { start: token.start + index + openLength }, originalSource, numbers, diagnostics);
			// archive-service is a bare service link (oocities.org), not an archive-link capture.
			const baseClass = kind === 'external' ? 'external' : kind === 'archive-service' ? 'external archive-service' : `external archive-link ${kind}`;
			const className = `${baseClass}${preservation ? ' preservation-copy' : ''}${platform ? ' site-name' : ''}${tooltip ? ' context' : ''}`;
			const leading = classFirst ? `class="${className}" href="${href}"` : `href="${href}" class="${className}"`;
			const identity = (platform ? ` data-platform="${platform}"${username ? ` data-username="${username}"` : ''}` : '') + (tooltip ? ` data-tooltip="${tooltip}"` : '');
			return {
				value: `<a ${leading} target="_blank" rel="noopener noreferrer"${identity}>${expanded}</a>`,
				length: close + 7
			};
		}
	}

	// In-page anchor and "open another modal" links, both inline in prose.
	for (const [name, build] of [
		['goto', id => `<a href="#${id}">`],
		['open', id => `<button type="button" class="doc-inline-link" data-open-modal="${id}">`]
	]) {
		if (!remaining.startsWith(`{${name}:`)) continue;
		const headerEnd = remaining.indexOf('}');
		const id = headerEnd === -1 ? '' : remaining.slice(name.length + 2, headerEnd);
		const openLength = headerEnd + 1;
		const closeTag = `{/${name}}`;
		const close = remaining.indexOf(closeTag, openLength);
		if (!/^[A-Za-z][\w-]*$/u.test(id) || close === -1) return null;
		const body = remaining.slice(openLength, close);
		if (!body || /[<\r\n]/u.test(body)) return null;
		const expanded = expandText(body, { start: token.start + index + openLength }, originalSource, numbers, diagnostics);
		return { value: `${build(id)}${expanded}${name === 'goto' ? '</a>' : '</button>'}`, length: close + closeTag.length };
	}

	if (remaining.startsWith('{dead:')) {
		const headerEnd = remaining.indexOf('}');
		const header = headerEnd === -1 ? [] : remaining.slice(6, headerEnd).split('|');
		const state = header.shift();
		const options = new Map();
		let validOptions = true;
		for (const option of header) {
			const separator = option.indexOf('=');
			const key = separator === -1 ? '' : option.slice(0, separator);
			const value = separator === -1 ? '' : option.slice(separator + 1);
			if (!['host', 'platform', 'href', 'tip'].includes(key) || !value || options.has(key)) validOptions = false;
			else options.set(key, value);
		}
		const host = options.get('host');
		const platform = options.get('platform');
		const href = options.get('href');
		const tooltip = options.get('tip');
		const states = new Set(['domain-repurposed', 'host-closed', 'page-offline', 'service-closed']);
		const openLength = headerEnd + 1;
		const close = remaining.indexOf('{/dead}', openLength);
		if (!states.has(state) || !validOptions || !tooltip || (host && platform) || /["{}<\r\n]/u.test(tooltip) || (href && /["{}<>\r\n]/u.test(href))) return null;
		if (close !== -1) {
			const body = remaining.slice(openLength, close);
			if (!body || /[<\r\n]/u.test(body)) return null;
			const registrySlug = platform || host;
			if (registrySlug && (!entities.platforms[registrySlug] || registrySlug.startsWith('_'))) {
				entityError(originalSource, token.start + index, diagnostics, `Unknown platform slug "${registrySlug}".`);
				return { value: remaining.slice(0, close + 7), length: close + 7 };
			}
			const expanded = expandText(body, { start: token.start + index + openLength }, originalSource, numbers, diagnostics);
			const className = platform ? `site-name dead-link ${state}` : `dead-link ${state}${host ? ` host-${host}` : ''}`;
			const identity = platform ? ` data-platform="${platform}"` : host ? ` data-host="${host}"` : '';
			const oldUrl = href ? ` data-href="${href}"` : '';
			return {
				value: `<span class="${className}"${identity}${oldUrl} data-tooltip="${tooltip}">${expanded}</span>`,
				length: close + 7
			};
		}
	}
	return null;
}

function expandEntity(remaining, originalSource, offset, diagnostics) {
	let match = remaining.match(/^\{site:([^|{}<>\r\n]+)(?:\|([^|{}<\r\n]+))?(?:\|user=([^|{}<>\r\n]+))?\}/u);
	if (match) {
		const [, platform, text, username] = match;
		const entry = entities.platforms[platform];
		if (!entry || platform.startsWith('_')) entityError(originalSource, offset, diagnostics, `Unknown platform slug "${platform}".`);
		else if (!text && (categoryPlatforms.has(platform) || !entry.label)) entityError(originalSource, offset, diagnostics, `Platform "${platform}" requires explicit text.`);
		else if ((!username && text && text.startsWith('user=')) || (username && !text)) entityError(originalSource, offset, diagnostics, 'A site token with user= requires explicit text.');
		else if (username && (!entities.usernames[username] || username.startsWith('_'))) entityError(originalSource, offset, diagnostics, `Unknown username slug "${username}".`);
		else {
			const userAttribute = username ? ` data-username="${username}"` : '';
			return { value: `<span class="site-name" data-platform="${platform}"${userAttribute}>${text || entry.label}</span>`, length: match[0].length };
		}
		return { value: match[0], length: match[0].length };
	}
	match = remaining.match(/^\{(user|person):([^|{}<>\r\n]+)(?:\|([^|{}<\r\n]+))?\}/u);
	if (match) {
		const [, kind, slug, text] = match;
		const registry = kind === 'user' ? entities.usernames : entities.persons;
		const entry = registry[slug];
		if (!entry || slug.startsWith('_')) entityError(originalSource, offset, diagnostics, `Unknown ${kind} slug "${slug}".`);
		else if (!entry.platform || !entry.display) entityError(originalSource, offset, diagnostics, `${kind} "${slug}" lacks a platform or display value.`);
		else {
			const className = kind === 'user' ? `username${entry.cast ? ' username-cast' : ''}` : 'person';
			const slugAttribute = kind === 'user' ? 'data-username' : 'data-person';
			return { value: `<span class="${className}" ${slugAttribute}="${slug}" data-platform="${entry.platform}">${text || entry.display}</span>`, length: match[0].length };
		}
		return { value: match[0], length: match[0].length };
	}
	match = remaining.match(/^\{(tool|franchise):([^|{}<\r\n]+)\}/u);
	if (match) return { value: `<span class="site-name" data-platform="${match[1]}">${match[2]}</span>`, length: match[0].length };
	return null;
}

function expandText(raw, token, originalSource, numbers, diagnostics) {
	let output = '';
	let index = 0;
	while (index < raw.length) {
		const remaining = raw.slice(index);
		if (remaining.startsWith('[@')) {
			const citations = [];
			let consumed = 0;
			while (true) {
				const match = remaining.slice(consumed).match(new RegExp(`^\\[@(${keyPattern})\\]`, 'u'));
				if (!match) break;
				citations.push(match[1]);
				consumed += match[0].length;
			}
			if (citations.length) {
				if (citations.every(key => numbers.has(key))) output += `<sup>${citations.map(key => `[${numbers.get(key)}]`).join('')}</sup>`;
				else output += remaining.slice(0, consumed);
				index += consumed;
				continue;
			}
			const end = remaining.indexOf(']');
			diagnostics.push(diagnostic(originalSource, token.start + index, 'error', 'token-syntax', 'Malformed citation token.'));
			const length = end === -1 ? 2 : end + 1;
			output += remaining.slice(0, length);
			index += length;
			continue;
		}
		if (remaining[0] === '{') {
			const helper = expandHelper(remaining, token, index, originalSource, numbers, diagnostics);
			if (helper) {
				output += helper.value;
				index += helper.length;
				continue;
			}
			const entity = expandEntity(remaining, originalSource, token.start + index, diagnostics);
			if (entity) {
				output += entity.value;
				index += entity.length;
				continue;
			}
			const toc = remaining.match(/^\{toc:[A-Za-z][\w:.-]*\}/u);
			if (toc) {
				output += toc[0];
				index += toc[0].length;
				continue;
			}
			let match = remaining.match(/^\{y:(\d{4})\}/u);
			if (match) {
				output += `<time datetime="${match[1]}">${match[1]}</time>`;
				index += match[0].length;
				continue;
			}
			match = remaining.match(/^\{date:([^|{}<>\r\n]+)\|([^|{}<>\r\n]+)\}/u);
			if (match && validIso(match[1])) {
				output += `<time datetime="${match[1]}">${match[2]}</time>`;
				index += match[0].length;
				continue;
			}
			match = remaining.match(/^\{(file|dir|page):([^|{}<>\r\n]+)\}/u);
			if (match) {
				const className = match[1] === 'file' ? 'file-name' : `file-name file-name-${match[1] === 'dir' ? 'directory' : 'page'}`;
				output += `<span class="${className}">${match[2]}</span>`;
				index += match[0].length;
				continue;
			}
			const end = remaining.indexOf('}');
			diagnostics.push(diagnostic(originalSource, token.start + index, 'error', 'token-syntax', 'Unrecognized or malformed token.'));
			const length = end === -1 ? 1 : end + 1;
			output += remaining.slice(0, length);
			index += length;
			continue;
		}
		if (remaining[0] === '}' || remaining[0] === '|') {
			diagnostics.push(diagnostic(originalSource, token.start + index, 'error', 'token-syntax', `Unexpected "${remaining[0]}" outside a token.`));
		}
		output += remaining[0];
		index += 1;
	}
	return output;
}

function innerHtml(source, node) {
	return source.slice(node.open.end, node.close.start);
}

function tocItems(source, tree) {
	const roots = [];
	const stack = [];
	walk(tree, node => {
		if (node.type !== 'element' || !/^h[2-5]$/u.test(node.tag) || !node.close || !node.attrs.id || node.attrs['data-toc'] === 'off') return;
		let ancestor = node.parent;
		while (ancestor) {
			if (ancestor.type === 'element' && String(ancestor.attrs.class || '').split(/\s+/u).includes('toc')) return;
			ancestor = ancestor.parent;
		}
		const item = { level: Number(node.tag[1]), id: node.attrs.id, html: innerHtml(source, node), children: [] };
		while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop();
		if (stack.length) stack[stack.length - 1].children.push(item);
		else roots.push(item);
		stack.push(item);
	});
	return roots;
}

function renderTocItems(items, depth) {
	const indent = '    '.repeat(depth);
	const lines = [`${indent}<ol>`];
	for (const item of items) {
		const link = `<a href="#${item.id}">${item.html}</a>`;
		if (!item.children.length) {
			lines.push(`${indent}    <li>${link}</li>`);
			continue;
		}
		lines.push(`${indent}    <li>`);
		lines.push(`${indent}        ${link}`);
		lines.push(...renderTocItems(item.children, depth + 2));
		lines.push(`${indent}    </li>`);
	}
	lines.push(`${indent}</ol>`);
	return lines;
}

function renderToc(id, items, indentation = '') {
	return [
		`${indentation}<div class="toc" id="${id}">`,
		`${indentation}    <h3>Contents</h3>`,
		...renderTocItems(items, 1).map(line => `${indentation}${line}`),
		`${indentation}</div>`
	].join('\n');
}

function expandToc(source, originalSource, diagnostics) {
	const pattern = /\{toc:([A-Za-z][\w:.-]*)\}/gu;
	const matches = [...source.matchAll(pattern)];
	for (const match of matches) {
		const lineStart = source.lastIndexOf('\n', match.index - 1) + 1;
		const lineEnd = source.indexOf('\n', match.index);
		const fullLine = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
		if (!/^\s*\{toc:[A-Za-z][\w:.-]*\}\s*$/u.test(fullLine)) diagnostics.push(diagnostic(originalSource, match.index, 'error', 'toc-misplaced', 'The TOC token must stand alone on its line.'));
	}
	if (matches.length > 1) diagnostics.push(diagnostic(originalSource, matches[1].index, 'error', 'toc-multiple', 'More than one TOC token was found.'));
	if (!matches.length || hasErrors(diagnostics)) return { output: source, lineMap: source.split('\n').map((value, index) => index + 1) };
	let tree;
	try {
		tree = buildTree(tokenize(source));
	} catch (error) {
		diagnostics.push({ line: error.line || 1, col: error.col || 1, severity: 'error', rule: 'token-syntax', message: error.message.replace(/ at \d+:\d+$/u, '') });
		return { output: source, lineMap: source.split('\n').map((value, index) => index + 1) };
	}
	const items = tocItems(source, tree);
	if (!items.length) {
		diagnostics.push(diagnostic(originalSource, matches[0].index, 'error', 'toc-empty', 'The document has no eligible headings for a TOC.'));
		return { output: source, lineMap: source.split('\n').map((value, index) => index + 1) };
	}
	const lines = source.split('\n');
	const sourceLine = source.slice(0, matches[0].index).split('\n').length;
	const line = lines[sourceLine - 1];
	const indentation = line.match(/^\s*/u)[0];
	const blockLines = renderToc(matches[0][1], items, indentation).split('\n');
	lines.splice(sourceLine - 1, 1, ...blockLines);
	const lineMap = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (index < sourceLine - 1) lineMap.push(index + 1);
		else if (index < sourceLine - 1 + blockLines.length) lineMap.push(sourceLine);
		else lineMap.push(index - blockLines.length + 2);
	}
	return { output: lines.join('\n'), lineMap };
}

function compile(source, options = {}) {
	const numbered = numberReferences(source);
	const diagnostics = [...numbered.diagnostics];
	let output = numbered.source;
	if (!hasErrors(diagnostics)) {
		let tokens;
		try {
			tokens = tokenize(numbered.source);
		} catch (error) {
			diagnostics.push({ line: error.line || 1, col: error.col || 1, severity: 'error', rule: 'token-syntax', message: error.message.replace(/ at \d+:\d+$/u, '') });
			tokens = [];
		}
		if (tokens.length) {
			output = tokens.map(token => token.type === 'text' ? expandText(token.raw, token, numbered.source, numbered.numbers, diagnostics) : token.raw).join('');
		}
	}
	const tocResult = expandToc(output, source, diagnostics);
	output = tocResult.output;
	const lineMap = tocResult.lineMap;
	if (options.header !== false) {
		const name = options.name || 'modal';
		output = `<!-- GENERATED from content/src/${name}.src.html by tools/build-modals.js. Do not edit. -->\n${output}`;
	}
	return { output, diagnostics, lineMap };
}

function formatDiagnostic(file, item) {
	return `${file.replace(/\\/gu, '/')}(${item.line},${item.col}): ${item.severity} ${item.rule}: ${item.message}`;
}

function stampWiring(name, generatedContent, wiringPath = defaultWiringPath) {
	const original = fs.readFileSync(wiringPath, 'utf8');
	const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	const pattern = new RegExp(`(externalContentUrl:\\s*'modals/${escapedName}\\.html\\?v=)([^']+)(')`, 'u');
	const match = original.match(pattern);
	if (!match) return { found: false, message: `no wiring registration for ${name}` };
	const next = crypto.createHash('md5').update(generatedContent).digest('hex').slice(0, 8);
	const updated = original.replace(pattern, `$1${next}$3`);
	fs.writeFileSync(wiringPath, updated, 'utf8');
	const checked = spawnSync(process.execPath, ['--check', wiringPath], { encoding: 'utf8' });
	if (checked.status !== 0) {
		fs.writeFileSync(wiringPath, original, 'utf8');
		throw new Error(`Wiring parse check failed; restored original file: ${(checked.stderr || checked.stdout).trim()}`);
	}
	return { found: true, oldValue: match[2], newValue: next, message: `${name} wiring ${match[2]} -> ${next}` };
}

function parseArgs(args) {
	const options = { names: [], check: false, watch: false, lint: true, stamp: true, outDir: defaultOutputDir, wiringPath: defaultWiringPath };
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === '--check') options.check = true;
		else if (argument === '--watch') options.watch = true;
		else if (argument === '--no-lint') options.lint = false;
		else if (argument === '--no-stamp') options.stamp = false;
		else if (argument === '--out-dir') options.outDir = path.resolve(root, args[++index]);
		else if (argument === '--wiring') options.wiringPath = path.resolve(root, args[++index]);
		else if (argument.startsWith('--')) throw new Error(`Unknown option "${argument}".`);
		else if (!/^[a-z0-9][a-z0-9-]*$/u.test(argument)) throw new Error(`Invalid modal name "${argument}".`);
		else options.names.push(argument);
	}
	return options;
}

function discoverNames(sourceDir = defaultSourceDir) {
	if (!fs.existsSync(sourceDir)) return [];
	return fs.readdirSync(sourceDir)
		.filter(file => file.endsWith('.src.html'))
		.map(file => file.slice(0, -'.src.html'.length))
		.sort();
}

function buildOne(name, options = {}) {
	const sourceDir = options.sourceDir || defaultSourceDir;
	const outDir = options.outDir || defaultOutputDir;
	const sourcePath = path.join(sourceDir, `${name}.src.html`);
	const outputPath = path.join(outDir, `${name}.html`);
	const sourceFile = path.relative(root, sourcePath).replace(/\\/gu, '/');
	if (!fs.existsSync(sourcePath)) return { ok: false, missing: true, name, diagnostics: [{ line: 1, col: 1, severity: 'error', rule: 'token-syntax', message: 'Requested source file does not exist.' }] };
	const started = Date.now();
	const source = fs.readFileSync(sourcePath, 'utf8');
	const compiled = compile(source, { name, header: true });
	const diagnostics = [...compiled.diagnostics];
	if (!hasErrors(diagnostics) && options.lint !== false) {
		for (const item of lintSource(sourceFile, compiled.output)) {
			const outputLine = Math.max(1, item.line - 1);
			diagnostics.push({ ...item, file: undefined, line: compiled.lineMap[outputLine - 1] || outputLine });
		}
	}
	if (hasErrors(diagnostics)) return { ok: false, name, sourceFile, outputPath, output: compiled.output, diagnostics, duration: Date.now() - started };
	if (options.check) {
		const matches = fs.existsSync(outputPath) && fs.readFileSync(outputPath, 'utf8') === compiled.output;
		return { ok: matches, mismatch: !matches, name, sourceFile, outputPath, output: compiled.output, diagnostics, duration: Date.now() - started };
	}
	fs.mkdirSync(outDir, { recursive: true });
	fs.writeFileSync(outputPath, compiled.output, 'utf8');
	let stamp = null;
	if (options.stamp !== false) stamp = stampWiring(name, compiled.output, options.wiringPath || defaultWiringPath);
	return { ok: true, name, sourceFile, outputPath, output: compiled.output, diagnostics, stamp, duration: Date.now() - started };
}

function printResult(result) {
	const file = result.sourceFile || `content/src/${result.name}.src.html`;
	for (const item of result.diagnostics || []) process.stdout.write(`${formatDiagnostic(file, item)}\n`);
	if (result.mismatch) process.stdout.write(`${path.relative(root, result.outputPath).replace(/\\/gu, '/')} differs or is missing\n`);
	if (result.stamp) process.stdout.write(`${result.stamp.message}\n`);
	if (!result.missing) {
		const errors = (result.diagnostics || []).filter(item => item.severity === 'error').length;
		const warnings = (result.diagnostics || []).filter(item => item.severity === 'warning').length;
		process.stdout.write(`${result.ok ? 'built' : 'failed'} ${result.name} in ${result.duration} ms, ${errors} errors, ${warnings} warnings\n`);
	}
}

function runBuild(options) {
	const sourceDir = options.sourceDir || defaultSourceDir;
	const explicit = options.names.length > 0;
	const names = explicit ? options.names : discoverNames(sourceDir);
	let failed = false;
	for (const name of names) {
		const result = buildOne(name, { ...options, sourceDir });
		if (result.missing && !explicit) continue;
		printResult(result);
		if (!result.ok) failed = true;
	}
	return failed ? 1 : 0;
}

function watchSources(options) {
	const sourceDir = options.sourceDir || defaultSourceDir;
	if (!fs.existsSync(sourceDir)) throw new Error(`Source directory does not exist: ${sourceDir}`);
	const timers = new Map();
	const watcher = fs.watch(sourceDir, (eventType, filename) => {
		if (!filename || !filename.endsWith('.src.html')) return;
		const name = filename.slice(0, -'.src.html'.length);
		if (options.names.length && !options.names.includes(name)) return;
		if (timers.has(name)) clearTimeout(timers.get(name));
		timers.set(name, setTimeout(() => {
			timers.delete(name);
			const sourcePath = path.join(sourceDir, filename);
			if (!fs.existsSync(sourcePath)) return;
			printResult(buildOne(name, { ...options, sourceDir, check: false }));
		}, 100));
	});
	return watcher;
}

function main(args = process.argv.slice(2)) {
	const options = parseArgs(args);
	const status = runBuild(options);
	if (options.watch) {
		const watcher = watchSources(options);
		process.stdout.write('watching content/src for modal changes\n');
		const close = () => {
			watcher.close();
			process.stdout.write('stopped watching content/src\n');
			process.exit(status);
		};
		process.once('SIGINT', close);
	}
	return status;
}

if (require.main === module) {
	try {
		process.exitCode = main();
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		process.exitCode = 1;
	}
}

module.exports = {
	compile,
	numberReferences,
	stampWiring,
	parseArgs,
	discoverNames,
	buildOne,
	runBuild,
	watchSources,
	formatDiagnostic
};

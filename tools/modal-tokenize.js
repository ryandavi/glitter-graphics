const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT_TAGS = new Set(['script', 'style']);

function parseError(message, line, col, offset) {
	const error = new Error(`${message} at ${line}:${col}`);
	error.line = line;
	error.col = col;
	error.offset = offset;
	return error;
}

function tokenize(source) {
	const tokens = [];
	const stack = [];
	let offset = 0;
	let line = 1;
	let col = 1;

	function addToken(type, end, details = {}) {
		const raw = source.slice(offset, end);
		const token = {
			type,
			tag: details.tag || null,
			attrs: details.attrs || {},
			attrList: details.attrList || [],
			raw,
			start: offset,
			end,
			line,
			col
		};
		tokens.push(token);
		for (const character of raw) {
			if (character === '\n') {
				line += 1;
				col = 1;
			} else {
				col += 1;
			}
		}
		offset = end;
		return token;
	}

	function findTagEnd(start) {
		let quote = null;
		for (let index = start; index < source.length; index += 1) {
			const character = source[index];
			if (quote) {
				if (character === quote) quote = null;
				continue;
			}
			if (character === '"' || character === "'") {
				quote = character;
			} else if (character === '>') {
				return index + 1;
			}
		}
		throw parseError('Unterminated tag', line, col, offset);
	}

	function parseAttributes(raw, tagNameLength, closing) {
		const attrs = {};
		const attrList = [];
		let index = 1 + tagNameLength;
		const limit = raw.length - (closing ? 2 : 1);
		while (index < limit) {
			while (index < limit && /\s/u.test(raw[index])) index += 1;
			if (index >= limit || raw[index] === '/') break;
			const nameStart = index;
			while (index < limit && !/[\s=/>]/u.test(raw[index])) index += 1;
			if (index === nameStart) break;
			const name = raw.slice(nameStart, index).toLowerCase();
			while (index < limit && /\s/u.test(raw[index])) index += 1;
			let value = true;
			if (raw[index] === '=') {
				index += 1;
				while (index < limit && /\s/u.test(raw[index])) index += 1;
				if (raw[index] === '"' || raw[index] === "'") {
					const quote = raw[index];
					index += 1;
					const valueStart = index;
					while (index < limit && raw[index] !== quote) index += 1;
					if (index >= limit) throw parseError(`Unterminated ${name} attribute`, line, col, offset);
					value = raw.slice(valueStart, index);
					index += 1;
				} else {
					const valueStart = index;
					while (index < limit && !/[\s>]/u.test(raw[index])) index += 1;
					value = raw.slice(valueStart, index);
				}
			}
			attrs[name] = value;
			attrList.push([name, value]);
		}
		return { attrs, attrList };
	}

	while (offset < source.length) {
		const rawTextTag = stack.length ? stack[stack.length - 1].tag : null;
		if (RAW_TEXT_TAGS.has(rawTextTag)) {
			const closePattern = new RegExp(`<\\/\\s*${rawTextTag}\\s*>`, 'igu');
			closePattern.lastIndex = offset;
			const match = closePattern.exec(source);
			if (!match) throw parseError(`Unclosed <${rawTextTag}>`, stack[stack.length - 1].line, stack[stack.length - 1].col, stack[stack.length - 1].start);
			if (match.index > offset) addToken('text', match.index);
			continue;
		}

		if (source[offset] !== '<') {
			const next = source.indexOf('<', offset);
			addToken('text', next === -1 ? source.length : next);
			continue;
		}

		if (source.startsWith('<!--', offset)) {
			const commentEnd = source.indexOf('-->', offset + 4);
			if (commentEnd === -1) throw parseError('Unterminated comment', line, col, offset);
			addToken('comment', commentEnd + 3);
			continue;
		}

		if (/^<!doctype\b/iu.test(source.slice(offset))) {
			addToken('doctype', findTagEnd(offset + 2));
			continue;
		}

		const tagEnd = findTagEnd(offset + 1);
		const raw = source.slice(offset, tagEnd);
		const closeMatch = raw.match(/^<\/\s*([A-Za-z][\w:-]*)\s*>$/u);
		if (closeMatch) {
			const tag = closeMatch[1].toLowerCase();
			const expected = stack.pop();
			if (!expected || expected.tag !== tag) {
				const wanted = expected ? `</${expected.tag}>` : 'no closing tag';
				throw parseError(`Unexpected </${tag}>; expected ${wanted}`, line, col, offset);
			}
			addToken('close', tagEnd, { tag });
			continue;
		}

		const openMatch = raw.match(/^<\s*([A-Za-z][\w:-]*)/u);
		if (!openMatch) {
			addToken('text', offset + 1);
			continue;
		}
		const tag = openMatch[1].toLowerCase();
		const syntacticSelfClose = /\/\s*>$/u.test(raw);
		const selfClose = syntacticSelfClose || VOID_TAGS.has(tag);
		const parsed = parseAttributes(raw, openMatch[0].length - 1, syntacticSelfClose);
		const token = addToken(selfClose ? 'selfclose' : 'open', tagEnd, { tag, ...parsed });
		if (!selfClose) stack.push(token);
	}

	if (stack.length) {
		const unclosed = stack[stack.length - 1];
		throw parseError(`Unclosed <${unclosed.tag}>`, unclosed.line, unclosed.col, unclosed.start);
	}
	return tokens;
}

function buildTree(tokens) {
	const root = { type: 'root', tag: null, attrs: {}, children: [], open: null, close: null, parent: null };
	const stack = [root];
	for (const token of tokens) {
		const parent = stack[stack.length - 1];
		if (token.type === 'open' || token.type === 'selfclose') {
			const node = {
				type: 'element',
				tag: token.tag,
				attrs: token.attrs,
				attrList: token.attrList,
				children: [],
				open: token,
				close: null,
				parent
			};
			parent.children.push(node);
			if (token.type === 'open') stack.push(node);
		} else if (token.type === 'close') {
			const node = stack.pop();
			node.close = token;
		} else {
			parent.children.push({
				type: token.type,
				tag: null,
				attrs: {},
				children: [],
				open: token,
				close: null,
				raw: token.raw,
				value: token.type === 'text' ? token.raw : '',
				parent
			});
		}
	}
	return root;
}

function walk(node, fn) {
	fn(node);
	for (const child of node.children || []) walk(child, fn);
}

function textContent(node) {
	if (node.type === 'text') return node.value;
	return (node.children || []).map(textContent).join('');
}

function closest(node, predicate) {
	let current = node ? node.parent : null;
	while (current) {
		if (predicate(current)) return current;
		current = current.parent;
	}
	return null;
}

module.exports = { tokenize, buildTree, walk, textContent, closest };

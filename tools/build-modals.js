const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tokenize, buildTree, walk } = require('./modal-tokenize');
const { lintSource } = require('./modal-lint');
const registry = require('./content-registry');

const root = registry.root;
const defaultSourceDir = path.join(root, 'content', 'src');
const defaultOutputDir = path.join(root, 'modals');
const defaultWiringPath = path.join(root, 'js', 'editor', 'modals-wiring.js');
const generatedScssPath = path.join(root, 'css', 'generated', '_entity-icons.scss');
const generatedDataPath = path.join(root, 'js', 'generated', 'entities-data.js');
const generatedSnippetsPath = path.join(root, '.vscode', 'content.code-snippets');
const keyPattern = '[a-z0-9][a-z0-9-]*';
// Long-form articles get the prose-style lint rules (em dash, bare dates and
// names). Every other modal gets only the token and structure rules.
const articles = new Set(['history', 'personal-web', 'aylana', 'preservation', 'about']);
const DEAD_TIP = 'Offline: this site no longer exists';
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// App registries the guide mirrors (tools, commands, panel titles), loaded
// from the browser scripts once per build.
let appRegistries = null;
function getAppRegistries() {
	if (appRegistries) return appRegistries;
	const vm = require('vm');
	const context = {
		console,
		navigator: { hardwareConcurrency: 4, userAgent: '' },
		window: {},
		document: {},
		localStorage: { getItem: () => null }
	};
	vm.createContext(context);
	[
		'js/core/releases.js', 'js/core/fields.js', 'js/core/config.js', 'js/core/tools.js',
		'js/core/layer-types.js', 'js/core/options.js', 'js/core/key-labels.js', 'js/core/commands.js',
		'js/ui/panel-schemas.js'
	].forEach(file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
	vm.runInContext('globalThis.__registries = { TOOLS, COMMANDS, PANEL_SCHEMAS, getShortcutGroups };', context);
	appRegistries = context.__registries;
	return appRegistries;
}

function escapeHtml(value) {
	return String(value).replace(/[&<>"]/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

// "Ctrl/Cmd + Shift + Z / Ctrl/Cmd + Y" -> alternatives of kbd sequences.
function renderKeys(displayKey) {
	return displayKey.split(' / ').map(alternative => {
		const keys = alternative.split(' + ').map(key => `<kbd class="guide-kbd">${escapeHtml(key)}</kbd>`);
		return keys.length > 1 ? `<span class="guide-shortcut">${keys.join('')}</span>` : keys[0];
	}).join(' or ');
}

function renderGesture(command) {
	const labels = { alt: 'Alt', shift: 'Shift', control: 'Ctrl', command: 'Cmd' };
	const device = { pointer: 'Mouse', touch: 'Touch', trackpad: 'Trackpad' }[command.binding.device] || command.binding.device;
	const modifiers = (command.binding.modifiers || []).map(modifier => `<kbd class="guide-kbd">${labels[modifier] || modifier}</kbd>`).join('');
	return `${device}: ${modifiers ? `${modifiers}-` : ''}${escapeHtml(command.binding.gesture.toLowerCase())}`;
}

// The full shortcut reference, generated from COMMANDS.
function renderShortcutReference() {
	const { getShortcutGroups } = getAppRegistries();
	// Same two-column guide-item as the hand-written sections: icon cell, then content.
	const icons = { keyboard: 'keyboard', gesture: 'pointer' };
	const block = (kind, render) => Array.from(getShortcutGroups(kind), ({ title, items }) => [
		'            <div class="guide-item">',
		'                <div class="guide-item-icon">',
		'                    <span class="icon-wrapper sm">',
		'                        <svg class="icon">',
		`                            <use href="#icon-${icons[kind]}"></use>`,
		'                        </svg>',
		'                    </span>',
		'                </div>',
		'                <div class="guide-item-content">',
		`                    <p><strong>${escapeHtml(title)}</strong></p>`,
		'                    <ul>',
		...items.map(command => `                        <li><strong>${escapeHtml(command.label)}</strong> – ${command.instruction ? `${escapeHtml(command.instruction)} ` : ''}${render(command)}</li>`),
		'                    </ul>',
		'                </div>',
		'            </div>'
	].join('\n')).join('\n\n');
	return `${block('keyboard', command => renderKeys(command.displayKey))}\n\n${block('gesture', renderGesture)}`;
}

function panelTitle(sectionId) {
	const schema = Object.values(getAppRegistries().PANEL_SCHEMAS).find(entry => entry?.section?.id === sectionId);
	return schema?.section?.title || null;
}

// App-UI helpers, namespaced so prose tokens can never collide with app
// registries: {ui-tool:select}, {ui-tool-icon:select}, {ui-panel:sectionId}
// and {ui-shortcuts}.
function expandRegistryHelper(remaining, offset, ctx) {
	const match = remaining.match(/^\{ui-(tool|tool-icon|panel):([A-Za-z][\w-]*)\}/u) || remaining.match(/^\{ui-(shortcuts)\}/u);
	if (!match) return null;
	const [text, kind, name] = match;
	const fail = message => {
		report(ctx, offset, 'error', 'registry-token', message);
		return { value: text, length: text.length };
	};
	const { TOOLS, COMMANDS } = getAppRegistries();
	if (kind === 'shortcuts') return { value: renderShortcutReference(), length: text.length };
	if (kind === 'panel') {
		const title = panelTitle(name);
		return title ? { value: escapeHtml(title), length: text.length } : fail(`Unknown panel section "${name}".`);
	}
	const tool = TOOLS[name];
	if (!tool) return fail(`Unknown tool "${name}".`);
	if (kind === 'tool-icon') return { value: `<use href="#icon-${tool.icon}"></use>`, length: text.length };
	const key = COMMANDS[tool.command]?.displayKey;
	return { value: `${escapeHtml(tool.hintName || tool.name)}${key ? ` (${renderKeys(key)})` : ''}`, length: text.length };
}

function lineColAt(source, offset) {
	const before = source.slice(0, offset);
	const lines = before.split('\n');
	return { line: lines.length, col: lines[lines.length - 1].length + 1 };
}

function diagnostic(source, offset, severity, rule, message) {
	return { ...lineColAt(source, Math.max(0, offset)), severity, rule, message };
}

function report(ctx, offset, severity, rule, message) {
	ctx.diagnostics.push(diagnostic(ctx.source, offset, severity, rule, message));
}

// Unknown slugs and sources stop a --check (the commit gate) but only warn
// while drafting under --watch, so a half-finished thought can be previewed.
function reportMissing(ctx, offset, rule, message) {
	report(ctx, offset, ctx.draft ? 'warning' : 'error', rule, message);
}

function hasErrors(diagnostics) {
	return diagnostics.some(item => item.severity === 'error');
}

function validIso(value) {
	const match = value.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u);
	if (!match) return false;
	if (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 12)) return false;
	if (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 31)) return false;
	return true;
}

// "2004-08-20" -> "20 August 2004", "2004-08" -> "August 2004".
function formatIsoDate(iso) {
	const [year, month, day] = iso.split('-');
	if (day) return `${Number(day)} ${monthNames[Number(month) - 1]} ${year}`;
	if (month) return `${monthNames[Number(month) - 1]} ${year}`;
	return year;
}

// ---------- entities ----------

function entityUnknown(ctx, offset, slug, text) {
	reportMissing(ctx, offset, 'slug-unknown', `Unknown entity "${slug}". Run node tools/entities.js find "${text || slug}", or add it to content/entities.json as a draft.`);
	return `<span class="draft-marker" data-missing="${escapeHtml(slug)}">${text || escapeHtml(slug)}</span>`;
}

function noteDraft(ctx, offset, slug) {
	if (ctx.entities[slug]?.status !== 'draft' || ctx.draftsSeen.has(slug)) return;
	ctx.draftsSeen.add(slug);
	report(ctx, offset, 'warning', 'entity-draft', `Entity "${slug}" is a draft; confirm its fields in content/entities.json.`);
}

// Decides the classes and attributes one entity mention carries. Icons mark
// places: only sites get one, on their first mention per section (or every
// mention with --icons=all). A gloss is a tooltip on the first eligible
// mention per document.
function entityPresentation(slug, ctx, flags, options = {}) {
	const entry = ctx.entities[slug];
	const classes = ['entity', `entity-${entry.kind}`];
	const attributes = [`data-entity="${slug}"`];
	if (entry.accent) classes.push('entity-accent');
	if (entry.kind === 'site') {
		const sectionKey = `${flags.section}:${slug}`;
		const icon = registry.resolveIcon(ctx.entities, slug, ctx.iconFiles);
		if (icon && (ctx.iconsAll || !ctx.iconsShown.has(sectionKey))) {
			ctx.iconsShown.add(sectionKey);
			attributes.push(`data-icon="${icon}"`);
		}
	}
	let gloss = null;
	if (entry.gloss && !options.noTooltip) {
		const forced = options.tip === true;
		const eligible = !flags.noGloss && options.tip !== false && !ctx.forcedTips.has(slug) && !ctx.glossed.has(slug);
		if (forced || eligible) {
			gloss = entry.gloss;
			ctx.glossed.add(slug);
		}
	}
	if (gloss) {
		classes.push('context');
		attributes.push(`data-tooltip="${escapeHtml(gloss)}"`);
	}
	// The card's contents come from js/generated/entities-data.js at hover time.
	if (!options.noTooltip && (gloss || (!flags.noCard && cardWorthy(ctx.entities, slug)))) attributes.push('data-card');
	return { classes, attributes };
}

// Handles, and sites that lived on a host, get a hover card on every mention;
// anything else only when it carries a gloss.
function cardWorthy(entities, slug) {
	const entry = entities[slug];
	if (entry.kind === 'handle') return Boolean(entry.host || entry.person);
	if (entry.kind === 'site') return Boolean(entry.host || entry.owner);
	if (entry.kind === 'person') return Object.values(entities).some(other => other.person === slug);
	return false;
}

// {@slug}, {@slug|text}, {@slug|tip}, {@slug|notip}, {@slug|text|notip}
function expandEntityToken(remaining, offset, ctx, flags) {
	const match = remaining.match(/^\{@([a-z0-9-]+)((?:\|[^|{}<\r\n]*)*)\}/u);
	if (!match) return null;
	const [whole, slug, rest] = match;
	const options = rest ? rest.slice(1).split('|') : [];
	let tip = null;
	let text = null;
	for (const option of options) {
		if (option === 'tip') tip = true;
		else if (option === 'notip') tip = false;
		else if (text === null && option) text = option;
		else report(ctx, offset, 'error', 'token-syntax', `Unexpected option "${option}" in ${whole}.`);
	}
	const entry = ctx.entities[slug];
	if (!entry) return { value: entityUnknown(ctx, offset, slug, text), length: whole.length };
	noteDraft(ctx, offset, slug);
	if (tip === true && !entry.gloss) report(ctx, offset, 'error', 'entity-option', `"${slug}" has no gloss, so |tip has nothing to show.`);
	const visible = text === null ? escapeHtml(entry.name) : text;
	const { classes, attributes } = entityPresentation(slug, ctx, flags, { tip });
	return { value: `<span class="${classes.join(' ')}" ${attributes.join(' ')}>${visible}</span>`, length: whole.length };
}

// ---------- inline helpers ----------

function expandHelper(remaining, offset, ctx, flags) {
	const registryHelper = expandRegistryHelper(remaining, offset, ctx);
	if (registryHelper) return registryHelper;

	let match = remaining.match(/^\{usenet:([^|{}<\r\n]+)\}/u);
	if (match) return { value: `<span class="usenet-address">${match[1]}</span>`, length: match[0].length };

	// {?Name}: "this should be an entity, deal with it later".
	match = remaining.match(/^\{\?([^{}<\r\n]+)\}/u);
	if (match) {
		ctx.todos.push({ offset, kind: 'tag-later', text: match[1] });
		return { value: match[1], length: match[0].length };
	}

	if (remaining.startsWith('{tip:')) {
		const headerEnd = remaining.indexOf('}');
		const header = headerEnd === -1 ? null : remaining.slice(5, headerEnd).split('|');
		const tooltip = header && header.shift();
		const options = header || [];
		const tagOption = options.find(value => value.startsWith('tag='));
		const known = options.every(value => /^tag=(?:strong|span)$/u.test(value));
		const tag = tagOption ? tagOption.slice(4) : 'strong';
		const openLength = headerEnd + 1;
		const close = remaining.indexOf('{/tip}', openLength);
		if (!tooltip || /["{}<\r\n]/u.test(tooltip) || !known || close === -1) return null;
		const body = remaining.slice(openLength, close);
		if (!body || /[<\r\n]/u.test(body)) return null;
		const expanded = expandText(body, offset + openLength, ctx, { ...flags, noGloss: true, noCard: true });
		return { value: `<${tag} class="context" data-tooltip="${tooltip}">${expanded}</${tag}>`, length: close + 6 };
	}

	if (remaining.startsWith('{link:')) {
		const headerEnd = remaining.indexOf('}');
		const header = headerEnd === -1 ? [] : remaining.slice(6, headerEnd).split('|');
		const kind = header.shift();
		const href = header.shift();
		let slug = null;
		let tooltip = null;
		let preservation = false;
		let validOptions = true;
		for (const option of header) {
			if (option.startsWith('@') && !slug) slug = option.slice(1);
			else if (option.startsWith('tip=') && !tooltip) tooltip = option.slice(4);
			else if (option === 'preservation') preservation = true;
			else validOptions = false;
		}
		const kinds = new Set(['external', 'archive-wayback', 'archive-index', 'archive-mirror', 'archive-service', 'historical-snapshot']);
		const openLength = headerEnd + 1;
		const close = remaining.indexOf('{/link}', openLength);
		if (!kinds.has(kind) || !href || /["{}<>\r\n]/u.test(href) || !validOptions || (tooltip && /["{}<\r\n]/u.test(tooltip)) || (preservation && kind !== 'archive-mirror') || close === -1) return null;
		const body = remaining.slice(openLength, close);
		if (!body || /[<\r\n]/u.test(body)) return null;
		const expanded = expandText(body, offset + openLength, ctx, { ...flags, noGloss: true, noCard: true });
		// archive-service is a bare service link (oocities.org), not an archive-link capture.
		const classes = [kind === 'external' ? 'external' : kind === 'archive-service' ? 'external archive-service' : `external archive-link ${kind}`];
		if (preservation) classes.push('preservation-copy');
		const attributes = [];
		if (slug) {
			if (!ctx.entities[slug]) {
				reportMissing(ctx, offset, 'slug-unknown', `Unknown entity "${slug}" on a link.`);
			} else {
				noteDraft(ctx, offset, slug);
				const presentation = entityPresentation(slug, ctx, flags, { noTooltip: true });
				classes.push(...presentation.classes);
				attributes.push(...presentation.attributes);
			}
		}
		if (tooltip) {
			classes.push('context');
			attributes.push(`data-tooltip="${tooltip}"`);
		}
		return {
			value: `<a href="${href}" class="${classes.join(' ')}" target="_blank" rel="noopener noreferrer"${attributes.length ? ` ${attributes.join(' ')}` : ''}>${expanded}</a>`,
			length: close + 7
		};
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
		const expanded = expandText(body, offset + openLength, ctx, { ...flags, noGloss: true, noCard: true });
		return { value: `${build(id)}${expanded}${name === 'goto' ? '</a>' : '</button>'}`, length: close + closeTag.length };
	}

	if (remaining.startsWith('{dead:')) {
		const headerEnd = remaining.indexOf('}');
		const header = headerEnd === -1 ? [] : remaining.slice(6, headerEnd).split('|');
		const state = header.shift();
		const options = new Map();
		let slug = null;
		let validOptions = true;
		for (const option of header) {
			if (option.startsWith('@') && !slug) {
				slug = option.slice(1);
				continue;
			}
			const separator = option.indexOf('=');
			const key = separator === -1 ? '' : option.slice(0, separator);
			const value = separator === -1 ? '' : option.slice(separator + 1);
			if (!['host', 'href', 'tip'].includes(key) || !value || options.has(key)) validOptions = false;
			else options.set(key, value);
		}
		const host = options.get('host');
		const href = options.get('href');
		const tooltip = options.get('tip');
		const openLength = headerEnd + 1;
		const close = remaining.indexOf('{/dead}', openLength);
		if (!registry.DEAD_STATES.has(state) || !validOptions || !tooltip || (host && slug) || /["{}<\r\n]/u.test(tooltip) || (href && /["{}<>\r\n]/u.test(href)) || close === -1) return null;
		const body = remaining.slice(openLength, close);
		if (!body || /[<\r\n]/u.test(body)) return null;
		const expanded = expandText(body, offset + openLength, ctx, { ...flags, noGloss: true, noCard: true });
		const classes = ['dead-link', state];
		const attributes = [];
		if (host) {
			if (!ctx.entities[host]) reportMissing(ctx, offset, 'slug-unknown', `Unknown host "${host}".`);
			else if (ctx.entities[host].kind !== 'site') report(ctx, offset, 'error', 'entity-option', `host=${host} must name a site.`);
			classes.push(`host-${host}`);
			attributes.push(`data-host="${host}"`);
		}
		if (slug) {
			if (!ctx.entities[slug]) {
				reportMissing(ctx, offset, 'slug-unknown', `Unknown entity "${slug}" on a dead link.`);
			} else {
				noteDraft(ctx, offset, slug);
				const presentation = entityPresentation(slug, ctx, flags, { noTooltip: true });
				classes.push(...presentation.classes);
				attributes.push(...presentation.attributes);
			}
		}
		if (href) attributes.push(`data-href="${href}"`);
		attributes.push(`data-tooltip="${tooltip}"`);
		return { value: `<span class="${classes.join(' ')}" ${attributes.join(' ')}>${expanded}</span>`, length: close + 7 };
	}
	return null;
}

function expandCitations(remaining, offset, ctx) {
	let consumed = 0;
	const numbers = [];
	let unknown = false;
	while (true) {
		const rest = remaining.slice(consumed);
		const todo = rest.match(/^\[@todo:\s*([^\]\r\n]*)\]/u);
		if (todo) {
			ctx.todos.push({ offset: offset + consumed, kind: 'todo', text: todo[1].trim() });
			consumed += todo[0].length;
			continue;
		}
		const match = rest.match(new RegExp(`^\\[@(${keyPattern})\\]`, 'u'));
		if (!match) break;
		const key = match[1];
		if (!ctx.sources[key]) {
			reportMissing(ctx, offset + consumed, 'source-unknown', `No source "${key}" in content/sources.json; run node tools/cite.js add <url>.`);
			unknown = true;
		} else if (!ctx.numbers.has(key)) {
			report(ctx, offset + consumed, 'error', 'refs-missing', `Citation "${key}" has no {references} list to appear in.`);
		} else {
			numbers.push(ctx.numbers.get(key));
		}
		consumed += match[0].length;
	}
	if (!consumed) return null;
	let value = numbers.length ? `<sup>${numbers.map(number => `[${number}]`).join('')}</sup>` : '';
	if (unknown && ctx.draft) value += '<sup class="draft-marker">[?]</sup>';
	return { value, length: consumed };
}

function expandText(raw, offset, ctx, flags) {
	let output = '';
	let index = 0;
	while (index < raw.length) {
		const remaining = raw.slice(index);
		if (remaining.startsWith('[@')) {
			const citation = expandCitations(remaining, offset + index, ctx);
			if (citation) {
				output += citation.value;
				index += citation.length;
				continue;
			}
			const end = remaining.indexOf(']');
			report(ctx, offset + index, 'error', 'token-syntax', 'Malformed citation token.');
			const length = end === -1 ? 2 : end + 1;
			output += remaining.slice(0, length);
			index += length;
			continue;
		}
		if (remaining[0] === '{') {
			const entity = expandEntityToken(remaining, offset + index, ctx, flags);
			if (entity) {
				output += entity.value;
				index += entity.length;
				continue;
			}
			const helper = expandHelper(remaining, offset + index, ctx, flags);
			if (helper) {
				output += helper.value;
				index += helper.length;
				continue;
			}
			const references = remaining.match(/^\{references(?::(general))?\}/u);
			if (references) {
				output += renderReferenceList(references[1] === 'general', offset + index, ctx, flags);
				index += references[0].length;
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
			report(ctx, offset + index, 'error', 'token-syntax', `Unrecognized or malformed token "${remaining.slice(0, end === -1 ? 20 : Math.min(end + 1, 60))}". The token list is in content/AUTHORING.md.`);
			const length = end === -1 ? 1 : end + 1;
			output += remaining.slice(0, length);
			index += length;
			continue;
		}
		if (remaining[0] === '}' || remaining[0] === '|') {
			report(ctx, offset + index, 'error', 'token-syntax', `Unexpected "${remaining[0]}" outside a token.`);
		}
		output += remaining[0];
		index += 1;
	}
	return output;
}

// ---------- references ----------

function citationKeys(text) {
	return [...String(text || '').matchAll(new RegExp(`\\[@(${keyPattern})\\]`, 'gu'))].map(match => match[1]);
}

function sourceNote(source, name) {
	return source.notes && Object.prototype.hasOwnProperty.call(source.notes, name) ? source.notes[name] : source.note;
}

// "@slug" means an entity; a person author reads in bibliography order.
function sourceParty(value, entities) {
	const match = String(value).match(/^@([a-z0-9-]+)$/u);
	if (!match) return value;
	const entry = entities[match[1]];
	if (entry?.sortName) return `{@${match[1]}|${entry.sortName}}`;
	return `{@${match[1]}}`;
}

function kindForUrl(url) {
	if (/web\.archive\.org\/web\/\d*\*\//u.test(url)) return 'archive-index';
	if (/web\.archive\.org\/web\/\d+/u.test(url)) return 'archive-wayback';
	return 'external';
}

// One citation style for every document:
// Author. "Title". <em>Publisher</em>. Archived D Month YYYY. Note
function renderSource(key, source, ctx) {
	const note = sourceNote(source, ctx.name);
	if (source.cite) return `${source.cite}${note ? ` ${note}` : ''}`;
	let text = '';
	if (source.author) {
		const author = sourceParty(source.author, ctx.entities);
		text += /[.!?]$/u.test(source.author) ? `${author} ` : `${author}. `;
	}
	const url = source.url;
	let title;
	if (!url) {
		title = source.title;
	} else if (source.status === 'dead') {
		const dead = source.dead || {};
		const hostSlug = dead.host === undefined ? registry.entityForUrl(ctx.entities, url) : dead.host;
		const host = hostSlug && ctx.entities[hostSlug]?.closed ? hostSlug : null;
		const state = dead.state || (host ? ctx.entities[host].closed : 'page-offline');
		title = `{dead:${state}${host ? `|host=${host}` : ''}|href=${url}|tip=${dead.tip || DEAD_TIP}}${source.title}{/dead}`;
	} else {
		title = `{link:${source.link || kindForUrl(url)}|${url}}${source.title}{/link}`;
	}
	text += `"${title}".`;
	if (source.publisher) text += ` <em>${sourceParty(source.publisher, ctx.entities)}</em>.`;
	if (source.archive) {
		const archive = source.archive;
		const label = archive.label || (archive.date ? `Archived {date:${archive.date}|${formatIsoDate(archive.date)}}` : 'Archived');
		text += archive.url ? ` {link:${archive.link || kindForUrl(archive.url)}|${archive.url}}${label}{/link}.` : ` ${label}.`;
	}
	if (note) text += ` ${note}`;
	return text;
}

// First-citation order in the document, then sources first cited from other
// sources' notes, in list order.
function numberSources(source, ctx) {
	const order = [];
	const add = key => {
		if (ctx.sources[key] && !order.includes(key)) order.push(key);
	};
	for (const key of citationKeys(source)) add(key);
	for (let index = 0; index < order.length; index += 1) {
		const entry = ctx.sources[order[index]];
		for (const field of [entry.author, entry.title, entry.publisher, sourceNote(entry, ctx.name), entry.cite, entry.archive?.label]) {
			for (const key of citationKeys(field)) add(key);
		}
	}
	return new Map(order.map((key, index) => [key, index + 1]));
}

function renderReferenceList(general, offset, ctx, flags) {
	const lineStart = ctx.source.lastIndexOf('\n', offset - 1) + 1;
	const indentation = ctx.source.slice(lineStart, offset).match(/^\s*/u)[0];
	let keys;
	if (general) {
		keys = Object.keys(ctx.sources)
			.filter(key => (ctx.sources[key].general || []).includes(ctx.name))
			.sort((left, right) => generalSortKey(ctx, left).localeCompare(generalSortKey(ctx, right)));
		if (!keys.length) report(ctx, offset, 'warning', 'refs-empty', `No source lists "${ctx.name}" in its general field.`);
	} else {
		if (ctx.referenceLists > 0) report(ctx, offset, 'error', 'refs-multiple', 'More than one {references} list.');
		ctx.referenceLists += 1;
		keys = [...ctx.numbers.keys()];
	}
	const items = keys.map(key => {
		const entry = ctx.sources[key];
		if (entry.status === 'draft') report(ctx, offset, 'warning', 'source-draft', `Source "${key}" is a draft; confirm it in content/sources.json.`);
		const body = expandText(renderSource(key, entry, ctx), offset, ctx, { ...flags, noGloss: true, noCard: true, inReferences: true });
		return `<li>${body}</li>`;
	});
	return items.join(`\n${indentation}`);
}

function generalSortKey(ctx, key) {
	const entry = ctx.sources[key];
	const author = String(entry.author || '').match(/^@([a-z0-9-]+)$/u);
	const authorName = author ? (ctx.entities[author[1]]?.sortName || ctx.entities[author[1]]?.name || author[1]) : (entry.author || '');
	return `${authorName} ${entry.title || entry.cite || ''}`.toLowerCase().replace(/[^a-z0-9 ]/gu, '').trim();
}

// ---------- structure ----------

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

function identityLineMap(text) {
	return text.split('\n').map((value, index) => index + 1);
}

// The TOC copies each heading's markup, minus tooltips and hover cards: a
// contents entry is a link, not a term to explain.
function tocHeadingHtml(html) {
	return html.replace(/ data-(?:tooltip|card(?:-[a-z]+)?)="[^"]*"/gu, '').replace(/ context"/gu, '"');
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
	if (!matches.length || hasErrors(diagnostics)) return { output: source, lineMap: identityLineMap(source) };
	let tree;
	try {
		tree = buildTree(tokenize(source));
	} catch (error) {
		diagnostics.push({ line: error.line || 1, col: error.col || 1, severity: 'error', rule: 'token-syntax', message: error.message.replace(/ at \d+:\d+$/u, '') });
		return { output: source, lineMap: identityLineMap(source) };
	}
	const items = tocItems(source, tree);
	if (!items.length) {
		diagnostics.push(diagnostic(originalSource, matches[0].index, 'error', 'toc-empty', 'The document has no eligible headings for a TOC.'));
		return { output: source, lineMap: identityLineMap(source) };
	}
	const strip = list => list.forEach(item => {
		item.html = tocHeadingHtml(item.html);
		strip(item.children);
	});
	strip(items);
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

function hasClass(node, name) {
	return String(node.attrs?.class || '').split(/\s+/u).includes(name);
}

// Where each text token sits: its section (for per-section icons) and
// whether a gloss or hover card may attach there.
function textFlags(tree) {
	const flags = new Map();
	let section = 0;
	walk(tree, node => {
		if (node.type === 'element' && /^h[2-5]$/u.test(node.tag)) section += 1;
		if (node.type !== 'text') return;
		const value = { section, noGloss: false, noCard: false, inReferences: false };
		for (let ancestor = node.parent; ancestor && ancestor.type === 'element'; ancestor = ancestor.parent) {
			if (/^h[1-6]$/u.test(ancestor.tag) || ancestor.tag === 'a' || hasClass(ancestor, 'toc') || ancestor.attrs['data-tooltip']) {
				value.noGloss = true;
				if (/^h[1-6]$/u.test(ancestor.tag) || ancestor.tag === 'a' || ancestor.attrs['data-tooltip']) value.noCard = true;
			}
			const id = String(ancestor.attrs.id || '');
			if (id.endsWith('ReferencesList') || hasClass(ancestor, 'general-references-list')) {
				value.noGloss = true;
				value.inReferences = true;
			}
		}
		flags.set(node.open.start, value);
	});
	return flags;
}

// Entities whose gloss the author placed by hand ({@x|tip}, or a {tip} or a
// link tip= carrying the same text) never get the automatic first-use gloss.
function explicitTooltipEntities(source, entities) {
	const slugs = new Set([...source.matchAll(/\{@([a-z0-9-]+)(?:\|[^|{}<\r\n]*)*\|tip(?:\|[^{}]*)?\}/gu)].map(match => match[1]));
	for (const match of source.matchAll(/\{tip:([^|}]*)[^}]*\}(.*?)\{\/tip\}|\{link:[^}]*\|tip=([^|}]*)[^}]*\}(.*?)\{\/link\}/gu)) {
		const tooltip = match[1] ?? match[3];
		for (const entity of (match[2] ?? match[4]).matchAll(/\{@([a-z0-9-]+)/gu)) {
			if (entities[entity[1]]?.gloss && escapeHtml(entities[entity[1]].gloss) === tooltip) slugs.add(entity[1]);
		}
	}
	return slugs;
}

function createContext(source, options) {
	const loaded = options.registry || loadRegistry();
	return {
		name: options.name || 'modal',
		source,
		entities: loaded.entities,
		sources: loaded.sources,
		iconFiles: loaded.iconFiles,
		draft: Boolean(options.draft),
		iconsAll: Boolean(options.iconsAll),
		diagnostics: [],
		numbers: new Map(),
		glossed: new Set(),
		forcedTips: explicitTooltipEntities(source, loaded.entities),
		iconsShown: new Set(),
		draftsSeen: new Set(),
		todos: [],
		referenceLists: 0
	};
}

function compile(source, options = {}) {
	const ctx = createContext(source, options);
	let tokens = [];
	let tree = null;
	try {
		tokens = tokenize(source);
		tree = buildTree(tokens);
	} catch (error) {
		ctx.diagnostics.push({ line: error.line || 1, col: error.col || 1, severity: 'error', rule: 'token-syntax', message: error.message.replace(/ at \d+:\d+$/u, '') });
	}
	let output = source;
	let lineMap = identityLineMap(source);
	if (tree) {
		if (/\{references\}/u.test(source)) ctx.numbers = numberSources(source, ctx);
		const flagsByToken = textFlags(tree);
		const pieces = [];
		lineMap = [];
		let sourceLine = 1;
		for (const token of tokens) {
			const value = token.type === 'text'
				? expandText(token.raw, token.start, ctx, flagsByToken.get(token.start) || { section: 0 })
				: token.raw;
			const rawLines = token.raw.split('\n').length - 1;
			const valueLines = value.split('\n').length - 1;
			// Extra generated lines (a references list) map to the token's last line.
			for (let line = 0; line < valueLines; line += 1) lineMap.push(Math.min(sourceLine + line, sourceLine + Math.max(0, rawLines - 1)));
			sourceLine += rawLines;
			pieces.push(value);
		}
		lineMap.push(sourceLine);
		output = pieces.join('');
		const firstKnown = citationKeys(source).find(key => ctx.sources[key]);
		if (firstKnown && !ctx.referenceLists) {
			report(ctx, source.indexOf(`[@${firstKnown}]`), 'error', 'refs-missing', 'The document cites sources but has no {references} list.');
		}
	}
	const tocResult = expandToc(output, source, ctx.diagnostics);
	output = tocResult.output;
	lineMap = tocResult.lineMap.map(line => lineMap[line - 1] || line);
	if (options.header !== false) {
		const name = options.name || 'modal';
		output = `<!-- GENERATED from content/src/${name}.src.html by tools/build-modals.js. Do not edit. -->\n${output}`;
	}
	for (const todo of ctx.todos) {
		const label = todo.kind === 'todo' ? `Citation needed: ${todo.text || '(no description)'}` : `Tag later: ${todo.text}`;
		report(ctx, todo.offset, 'warning', todo.kind === 'todo' ? 'todo-cite' : 'todo-tag', label);
	}
	return { output, diagnostics: ctx.diagnostics, lineMap, todos: ctx.todos };
}

// ---------- registry + generated files ----------

let registryCache = null;
function loadRegistry({ fresh = false } = {}) {
	if (registryCache && !fresh) return registryCache;
	const entities = registry.loadEntities();
	const sources = registry.loadSources();
	const problems = [...registry.validateEntities(entities), ...registry.validateSources(sources)];
	registryCache = { entities, sources, iconFiles: registry.iconFiles(), problems };
	return registryCache;
}

const GENERATED_NOTE = 'GENERATED by tools/build-modals.js from content/entities.json and images/modal/history/platform-icons/. Do not edit.';

// One variable block per icon file an entity resolves to, the domain rules
// for links whose text isn't an entity, and the handle accent colors.
function renderEntityScss(loaded) {
	const { entities, iconFiles } = loaded;
	const used = new Set(['link', 'tool']);
	for (const slug of Object.keys(entities)) {
		const icon = registry.resolveIcon(entities, slug, iconFiles);
		if (icon) used.add(icon);
	}
	const iconVariables = icon => {
		const file = iconFiles.get(icon);
		const url = `url("../images/modal/history/platform-icons/${file.file}")`;
		return file.color
			? `--entity-icon-image: ${url}; --entity-icon-mask: none; --entity-icon-tint: transparent;`
			: `--entity-icon-image: none; --entity-icon-mask: ${url}; --entity-icon-tint: currentColor;`;
	};
	const lines = [`// ${GENERATED_NOTE}`, '', '// Icons: a plain .svg is a currentColor mask; a .color.svg is drawn as is.'];
	for (const icon of [...used].sort()) {
		if (iconFiles.has(icon)) lines.push(`[data-icon="${icon}"] { ${iconVariables(icon)} }`);
	}
	lines.push('', '// Handle accents.');
	for (const [slug, entry] of Object.entries(entities)) {
		if (entry.accent) lines.push(`[data-entity="${slug}"] { --entity-accent: ${entry.accent}; }`);
	}
	const byIcon = new Map();
	for (const [slug, entry] of Object.entries(entities)) {
		for (const domain of entry.domains || []) {
			const icon = registry.resolveIcon(entities, slug, iconFiles);
			if (!icon || !iconFiles.get(icon)) continue;
			if (!byIcon.has(icon)) byIcon.set(icon, []);
			byIcon.get(icon).push(domain);
		}
	}
	lines.push('', '// A link whose text is not itself an entity gets the icon of the entity that', '// owns its domain; _modals.scss turns this map into selectors.', '$domain-icons: (');
	for (const icon of [...byIcon.keys()].sort()) {
		const domains = [...new Set(byIcon.get(icon))].sort();
		const file = iconFiles.get(icon);
		const url = `url("../images/modal/history/platform-icons/${file.file}")`;
		const paint = file.color ? `image: ${url}, mask: none, tint: transparent` : `image: none, mask: ${url}, tint: currentColor`;
		lines.push(`\t"${icon}": (domains: (${domains.map(domain => `"${domain}"`).join(', ')}), ${paint}),`);
	}
	lines.push(');', '');
	return lines.join('\n');
}

// Everything a script needs to name an entity or draw its hover card, so the
// modal markup only carries data-entity.
function renderEntitiesData(loaded) {
	const { entities, iconFiles } = loaded;
	const data = {};
	for (const [slug, entry] of Object.entries(entities)) {
		const item = { name: entry.name, kind: entry.kind };
		if (entry.aliases?.length) item.aliases = entry.aliases;
		for (const field of ['host', 'owner', 'person']) if (entry[field]) item[field] = entry[field];
		const icon = registry.resolveIcon(entities, slug, iconFiles);
		if (icon) item.icon = icon;
		const handles = Object.keys(entities).filter(other => entities[other].person === slug);
		if (handles.length) item.handles = handles;
		data[slug] = item;
	}
	return [
		'// GENERATED by tools/build-modals.js from content/entities.json. Do not edit.',
		'// Names, kinds and relations for scripts that show entities: the modal hover',
		'// cards (js/ui/tooltip.js) and the Preservation timeline filter.',
		`const ENTITY_KIND_LABELS = ${JSON.stringify(registry.KINDS)};`,
		`const ENTITY_DATA = ${JSON.stringify(data, null, '\t')};`,
		''
	].join('\n');
}

// Autocomplete for the source files: one snippet per entity and source, and
// one per token so the whole grammar is reachable from "{".
function renderSnippets(loaded) {
	const snippets = {};
	const scope = 'html';
	const tokens = [
		['date', '{date:${1:2001-06-07}|${2:7 June 2001}}', 'A date: ISO value, then visible text'],
		['y', '{y:${1:2001}}', 'A bare year'],
		['file', '{file:${1:FB12.gif}}', 'A file name'],
		['dir', '{dir:${1:/BAR}}', 'A directory name'],
		['page', '{page:${1:TOOLS.html}}', 'A page file name'],
		['tip', '{tip:${1:Explanation}}${2:term}{/tip}', 'A tooltip on a term that is not an entity'],
		['link', '{link:${1|external,archive-wayback,archive-index,archive-mirror,archive-service,historical-snapshot|}|${2:https://}}${3:text}{/link}', 'A link'],
		['dead', '{dead:${1|page-offline,host-closed,domain-repurposed,service-closed|}|href=${2:http://}|tip=${3:Offline: this site no longer exists}}${4:text}{/dead}', 'A link to a page that is gone'],
		['goto', '{goto:${1:HeadingId}}${2:text}{/goto}', 'A link to a heading on this page'],
		['open', '{open:${1:historyModal}}${2:text}{/open}', 'A link that opens another modal'],
		['tag-later', '{?${1:Name}}', 'Mark a name to tag as an entity later'],
		['todo-cite', '[@todo: ${1:what source is needed}]', 'A missing citation'],
		['references', '{references}', 'The numbered references list']
	];
	for (const [name, body, description] of tokens) snippets[`token ${name}`] = { scope, prefix: `{${name}`, body, description };
	for (const [slug, entry] of Object.entries(loaded.entities)) {
		const prefixes = [`@${slug}`, ...(entry.aliases || []).map(alias => `@${registry.normalize(alias).replace(/ /gu, '-')}`)];
		snippets[`@${slug}`] = { scope, prefix: [...new Set(prefixes)], body: `{@${slug}}`, description: `${entry.name} (${entry.kind})` };
	}
	// Tracked, so it lists only the shared sources: the same on every machine.
	for (const [key, source] of Object.entries(registry.loadSources(registry.sourcesPath, { local: false }))) {
		snippets[`[@${key}`] = { scope, prefix: `[@${key}`, body: `[@${key}]`, description: String(source.title || source.cite || key).replace(/\{[^}]*\}/gu, '').slice(0, 80) };
	}
	return `${JSON.stringify(snippets, null, '\t')}\n`;
}

function generatedFiles(loaded) {
	return [
		[generatedScssPath, renderEntityScss(loaded)],
		[generatedDataPath, renderEntitiesData(loaded)],
		[generatedSnippetsPath, renderSnippets(loaded)]
	];
}

function writeGenerated(loaded, check) {
	const stale = [];
	for (const [file, content] of generatedFiles(loaded)) {
		const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
		if (current === content) continue;
		if (check) stale.push(path.relative(root, file).replace(/\\/gu, '/'));
		else {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, content, 'utf8');
			process.stdout.write(`wrote ${path.relative(root, file).replace(/\\/gu, '/')}\n`);
		}
	}
	return stale;
}

// ---------- CLI ----------

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
	if (updated === original) return { found: true, oldValue: match[2], newValue: next, message: `${name} wiring ${match[2]} -> ${next}` };
	fs.writeFileSync(wiringPath, updated, 'utf8');
	const checked = spawnSync(process.execPath, ['--check', wiringPath], { encoding: 'utf8' });
	if (checked.status !== 0) {
		fs.writeFileSync(wiringPath, original, 'utf8');
		throw new Error(`Wiring parse check failed; restored original file: ${(checked.stderr || checked.stdout).trim()}`);
	}
	return { found: true, oldValue: match[2], newValue: next, message: `${name} wiring ${match[2]} -> ${next}` };
}

function parseArgs(args) {
	const options = { names: [], check: false, watch: false, todo: false, iconsAll: false, lint: true, stamp: true, outDir: defaultOutputDir, wiringPath: defaultWiringPath };
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === '--check') options.check = true;
		else if (argument === '--watch') options.watch = true;
		else if (argument === '--todo') options.todo = true;
		else if (argument === '--icons=all') options.iconsAll = true;
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
	const loaded = options.registry || loadRegistry();
	const compiled = compile(source, { name, header: true, draft: Boolean(options.watch && !options.check), iconsAll: options.iconsAll, registry: loaded });
	const diagnostics = [...compiled.diagnostics];
	if (!hasErrors(diagnostics) && options.lint !== false) {
		for (const item of lintSource(sourceFile, compiled.output, { registry: loaded.entities, prose: articles.has(name) })) {
			const outputLine = Math.max(1, item.line - 1);
			diagnostics.push({ ...item, file: undefined, line: compiled.lineMap[outputLine - 1] || outputLine });
		}
	}
	const result = { name, sourceFile, outputPath, output: compiled.output, diagnostics, todos: compiled.todos, duration: 0 };
	if (hasErrors(diagnostics)) return { ...result, ok: false, duration: Date.now() - started };
	if (options.check) {
		const matches = fs.existsSync(outputPath) && fs.readFileSync(outputPath, 'utf8') === compiled.output;
		return { ...result, ok: matches, mismatch: !matches, duration: Date.now() - started };
	}
	fs.mkdirSync(outDir, { recursive: true });
	fs.writeFileSync(outputPath, compiled.output, 'utf8');
	let stamp = null;
	if (options.stamp !== false) stamp = stampWiring(name, compiled.output, options.wiringPath || defaultWiringPath);
	return { ...result, ok: true, stamp, duration: Date.now() - started };
}

function printResult(result) {
	const file = result.sourceFile || `content/src/${result.name}.src.html`;
	for (const item of result.diagnostics || []) process.stdout.write(`${formatDiagnostic(file, item)}\n`);
	if (result.mismatch) process.stdout.write(`${path.relative(root, result.outputPath).replace(/\\/gu, '/')} differs or is missing\n`);
	if (result.stamp && result.stamp.oldValue !== result.stamp.newValue) process.stdout.write(`${result.stamp.message}\n`);
	if (!result.missing) {
		const errors = (result.diagnostics || []).filter(item => item.severity === 'error').length;
		const warnings = (result.diagnostics || []).filter(item => item.severity === 'warning').length;
		process.stdout.write(`${result.ok ? 'built' : 'failed'} ${result.name} in ${result.duration} ms, ${errors} errors, ${warnings} warnings\n`);
	}
}

function printRegistryProblems(loaded) {
	for (const problem of loaded.problems) process.stdout.write(`content/entities.json(1,1): error registry: ${problem}\n`);
	return loaded.problems.length > 0;
}

function runBuild(options) {
	const sourceDir = options.sourceDir || defaultSourceDir;
	const explicit = options.names.length > 0;
	const names = explicit ? options.names : discoverNames(sourceDir);
	const loaded = loadRegistry({ fresh: true });
	let failed = printRegistryProblems(loaded);
	for (const name of names) {
		const result = buildOne(name, { ...options, sourceDir, registry: loaded });
		if (result.missing && !explicit) continue;
		printResult(result);
		if (!result.ok) failed = true;
	}
	const stale = writeGenerated(loaded, options.check);
	for (const file of stale) process.stdout.write(`${file} is out of date: run node tools/build-modals.js\n`);
	if (stale.length) failed = true;
	return failed ? 1 : 0;
}

// Every {?Name}, [@todo], draft entity and draft source, by file and line.
function runTodo(options) {
	const sourceDir = options.sourceDir || defaultSourceDir;
	const names = options.names.length ? options.names : discoverNames(sourceDir);
	const loaded = loadRegistry({ fresh: true });
	let count = 0;
	for (const name of names) {
		const sourcePath = path.join(sourceDir, `${name}.src.html`);
		if (!fs.existsSync(sourcePath)) continue;
		const compiled = compile(fs.readFileSync(sourcePath, 'utf8'), { name, header: false, draft: true, registry: loaded });
		for (const item of compiled.diagnostics.filter(entry => /^(todo-|entity-draft|source-draft|slug-unknown|source-unknown)/u.test(entry.rule))) {
			process.stdout.write(`${formatDiagnostic(`content/src/${name}.src.html`, { ...item, severity: 'warning' })}\n`);
			count += 1;
		}
	}
	const drafts = Object.entries(loaded.entities).filter(([, entry]) => entry.status === 'draft').map(([slug]) => slug);
	if (drafts.length) process.stdout.write(`content/entities.json(1,1): warning entity-draft: Draft entities: ${drafts.join(', ')}\n`);
	const draftSources = Object.entries(loaded.sources).filter(([, entry]) => entry.status === 'draft').map(([key]) => key);
	if (draftSources.length) process.stdout.write(`content/sources.json(1,1): warning source-draft: Draft sources: ${draftSources.join(', ')}\n`);
	process.stdout.write(`${count} open items in sources, ${drafts.length} draft entities, ${draftSources.length} draft sources\n`);
	return 0;
}

function watchSources(options) {
	const sourceDir = options.sourceDir || defaultSourceDir;
	if (!fs.existsSync(sourceDir)) throw new Error(`Source directory does not exist: ${sourceDir}`);
	const timers = new Map();
	const schedule = (key, run) => {
		if (timers.has(key)) clearTimeout(timers.get(key));
		timers.set(key, setTimeout(() => {
			timers.delete(key);
			run();
		}, 100));
	};
	const buildNames = names => {
		const loaded = loadRegistry({ fresh: true });
		printRegistryProblems(loaded);
		for (const name of names) printResult(buildOne(name, { ...options, sourceDir, check: false, registry: loaded }));
		writeGenerated(loaded, false);
		process.stdout.write('watching content/src for modal changes\n');
	};
	const sourceWatcher = fs.watch(sourceDir, (eventType, filename) => {
		if (!filename || !filename.endsWith('.src.html')) return;
		const name = filename.slice(0, -'.src.html'.length);
		if (options.names.length && !options.names.includes(name)) return;
		if (!fs.existsSync(path.join(sourceDir, filename))) return;
		schedule(name, () => buildNames([name]));
	});
	// Registry edits can change any page.
	const registryWatcher = fs.watch(path.join(root, 'content'), (eventType, filename) => {
		if (filename !== 'entities.json' && filename !== 'sources.json') return;
		schedule('registry', () => buildNames(options.names.length ? options.names : discoverNames(sourceDir)));
	});
	return { close: () => { sourceWatcher.close(); registryWatcher.close(); } };
}

function main(args = process.argv.slice(2)) {
	const options = parseArgs(args);
	if (options.todo) return runTodo(options);
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
	renderSource,
	formatIsoDate,
	kindForUrl,
	loadRegistry,
	renderEntityScss,
	stampWiring,
	parseArgs,
	discoverNames,
	buildOne,
	runBuild,
	watchSources,
	formatDiagnostic
};

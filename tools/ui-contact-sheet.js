'use strict';
// Contact sheet: the required check for a styling change that is meant to be
// visible. Screenshots the real app in every state worth looking at (panels,
// Library, layers, modals, phone drawer; desktop, laptop and phone; two
// themes), then lays a "before" capture beside an "after" capture in one page.
//
//   node tools/ui-contact-sheet.js capture <dir> [--css compiled.css] [--only name] [--viewport desk|laptop|phone [--theme light]]
//   node tools/ui-contact-sheet.js build <beforeDir> <afterDir> <out.html>
//
// Capture "before" from the commit you are leaving and "after" from the working
// tree. `--css` views a scratch compile without touching css/style.css.

const fs = require('fs');
const path = require('path');
const { chromium, VIEWPORTS, boot, wait, desktopStates, phoneStates } = require('./ui-states');

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const slug = (name) => name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

// The second theme is a light one: literal colors that ignore themes show there.
const THEMES = [null, 'light'];
// UI_TALL raises it for a panel taller than this with everything open.
const TALL = Number(process.env.UI_TALL) || 3200;

async function capture(dir) {
	fs.mkdirSync(dir, { recursive: true });
	const cssFile = option('--css');
	const css = cssFile ? { main: fs.readFileSync(cssFile) } : {};
	const only = option('--only');
	const index = [];
	const browser = await chromium.launch({ headless: true });

	const shooter = (page, viewport, theme) => async (name, hints = {}) => {
		const label = theme ? `${name} (${theme})` : name;
		if (only && !label.includes(only)) return;
		const file = `${slug(label)}.png`;
		const target = path.join(dir, file);
		try {
			if (hints.tall) {
				await page.setViewportSize({ width: viewport.width, height: TALL });
				await wait(page, 250);
			}
			const el = hints.shot ? await page.$(hints.shot) : null;
			if (el && await el.isVisible()) {
				// A tall panel is clipped to its content, not to the tall viewport.
				const box = await el.boundingBox();
				const used = hints.tall ? await el.evaluate((node) => {
					let bottom = 0;
					node.querySelectorAll('*').forEach((child) => {
						const r = child.getBoundingClientRect();
						// Leaves only: a container stretched to the tall viewport says nothing about where content ends.
						if (r.width && r.height && !child.children.length && !child.matches('.panel-resize-handle')) bottom = Math.max(bottom, r.bottom);
					});
					return bottom - node.getBoundingClientRect().top;
				}) : box.height;
				await page.screenshot({ path: target, clip: { x: box.x, y: box.y, width: box.width, height: Math.max(40, Math.min(box.height, used + 16)) } });
			} else {
				await page.screenshot({ path: target });
			}
			index.push({ name: label, file });
		} catch (e) {
			console.log(`(shot ${label}: ${e.message.split('\n')[0]})`);
		} finally {
			if (hints.tall) {
				await page.setViewportSize(viewport);
				await wait(page, 150);
			}
		}
		process.stderr.write(`${label}\n`);
	};

	const run = async (viewportName, theme) => {
		const viewport = VIEWPORTS[viewportName];
		const phone = viewportName === 'phone';
		const ctx = await browser.newContext(phone ? { viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport });
		const page = await ctx.newPage();
		page.on('pageerror', (e) => console.log(`PAGE ERROR (${viewportName}): ${e.message}`));
		await boot(page, css);
		if (theme) await page.evaluate((name) => { document.documentElement.dataset.theme = name; }, theme);
		const visit = shooter(page, viewport, theme);
		if (phone) await phoneStates(page, visit, { set: 'sheet' });
		else await desktopStates(page, visit, { set: 'sheet', viewport: viewportName });
		await ctx.close();
	};

	const viewportOnly = option('--viewport');
	if (viewportOnly) {
		await run(viewportOnly, option('--theme'));
	} else {
		for (const theme of THEMES) {
			await run('desk', theme);
			await run('phone', theme);
		}
		await run('laptop', null);
	}
	await browser.close();
	fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, '\t'));
	console.log(`${index.length} screenshots in ${dir}`);
}

function build(beforeDir, afterDir, out) {
	const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
	const before = new Map(read(beforeDir).map((e) => [e.name, e.file]));
	const after = read(afterDir);
	const rel = (dir, file) => path.relative(path.dirname(out), path.join(dir, file)).split(path.sep).join('/');
	const groups = new Map();
	for (const entry of after) {
		const group = entry.name.split(' ')[0];
		if (!groups.has(group)) groups.set(group, []);
		groups.get(group).push(entry);
	}
	const cell = (dir, file, label) => (file
		? `<figure><figcaption>${label}</figcaption><a href="${rel(dir, file)}"><img loading="lazy" src="${rel(dir, file)}" alt=""></a></figure>`
		: `<figure><figcaption>${label}</figcaption><p class="none">not captured</p></figure>`);
	const sections = [...groups.entries()].map(([group, entries]) => `
<section>
<h2>${group}</h2>
${entries.map((e) => `<article id="${slug(e.name)}"><h3>${e.name}</h3><div class="pair">${cell(beforeDir, before.get(e.name), 'Before')}${cell(afterDir, e.file, 'After')}</div></article>`).join('\n')}
</section>`).join('\n');
	const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>UI contact sheet</title>
<style>
body{margin:0;padding:24px;background:#16181c;color:#dfe2e6;font:13px/1.5 "Segoe UI",sans-serif}
h1{font-size:20px;margin:0 0 4px}
h2{font-size:14px;text-transform:uppercase;letter-spacing:.08em;margin:40px 0 12px;color:#858c95}
h3{font-size:13px;margin:0 0 8px}
nav{display:flex;flex-wrap:wrap;gap:4px 12px;margin:12px 0 0}
nav a{color:#449eff;text-decoration:none}
article{margin:0 0 32px;padding-top:16px;border-top:1px solid #383d44}
.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}
figure{margin:0}
figcaption{font-size:11px;color:#858c95;margin-bottom:4px}
img{max-width:100%;height:auto;border:1px solid #383d44;display:block}
.none{color:#646a73}
</style>
<h1>UI contact sheet</h1>
<p>${after.length} states. Click an image for full size.</p>
<nav>${after.map((e) => `<a href="#${slug(e.name)}">${e.name}</a>`).join('')}</nav>
${sections}
</html>
`;
	fs.writeFileSync(out, html);
	console.log(`wrote ${out}`);
}

const [command, ...rest] = args;
if (command === 'capture' && rest[0]) {
	capture(rest[0]).catch((e) => { console.error(e); process.exit(1); });
} else if (command === 'build' && rest.length >= 3) {
	build(rest[0], rest[1], rest[2]);
} else {
	console.error('usage:\n  node tools/ui-contact-sheet.js capture <dir> [--css compiled.css] [--only name]\n  node tools/ui-contact-sheet.js build <beforeDir> <afterDir> <out.html>');
	process.exit(2);
}

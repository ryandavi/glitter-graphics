'use strict';
// Enforces THE GUTTER RULE (css/panels/_properties.scss): horizontal inset is
// applied exactly once on any path from a panel body down to a control. Any
// element that insets while an ancestor inside the same block already did is a
// double-padding bug - the class of defect that made the sidebar's spacing look
// arbitrary. Run after any change to the property styles.
//
//   node tools/gutter-check.js

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.GLITTER_PORT || 8977;
const CHROME = process.env.CHROME_PATH
	|| '/Users/amberellis/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

(async () => {
	const srv = spawn('python3', ['-m', 'http.server', String(PORT)], {
		cwd: path.join(__dirname, '..'), stdio: 'ignore', detached: true
	});
	const stop = () => { try { process.kill(-srv.pid); } catch (e) { /* gone */ } };
	try {
		await new Promise((r) => setTimeout(r, 900));
		const browser = await chromium.launch({ executablePath: CHROME });
		const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
		await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
		await page.evaluate(() => document.querySelectorAll('.modal-overlay.visible').forEach((n) => n.classList.remove('visible')));
		await page.evaluate(async () => { await window.editor.loadBlankImage(500, 400, '#ffffff'); });
		await page.waitForFunction(() => Boolean(window.editor?.originalImage));
		await page.evaluate(async () => { await window.editor.textGlitterManager?.addTextLayer?.(); });
		await page.waitForTimeout(900);
		await page.evaluate(() => {
			document.querySelectorAll('.section.collapsible-section').forEach((s) => {
				s.classList.add('visible', 'is-open');
				s.querySelector(':scope > .section-content')?.classList.add('visible');
			});
			document.querySelectorAll('.collapsed, .is-collapsed').forEach((n) => n.classList.remove('collapsed', 'is-collapsed'));
			document.querySelectorAll('[data-advanced]').forEach((n) => n.classList.add('is-open'));
			document.querySelectorAll('input[data-effect-toggle]').forEach((c) => { if (!c.checked) c.click(); });
		});
		await page.waitForTimeout(600);

		const auditLayout = () => page.evaluate(() => {
			// Only structural containers are in scope. A control's own padding
			// (a button, an input, a segmented option) is its chrome, not a
			// gutter, and nesting it inside an inset container is correct.
			const STRUCTURAL = [
				'property-row', 'property-pair-group', 'property-pair', 'property-toggle-list', 'property-block',
				'subsection-card-body', 'paint-slot-main', 'subsection-content',
				'subsection-content-group', 'effect-option-group', 'functional-control-group',
				'advanced-control-group', 'property-set', 'settings-action-row', 'property-actions',
				'glitter-source', 'paint-slot-source', 'asset-info', 'selected-colors-display',
				'advanced-disclosure-content', 'settings-toggle-list',
				// Labels inset themselves, so a set that also insets double-indents
				// them - the defect that pushed "Anchor" past its own group title.
				'effect-option-label', 'functional-control-group-title',
				'advanced-control-group-title', 'control-group-label', 'property-set-label',
				'property-label', 'sticker-position-group', 'transform-grid'
			];
			const isStructural = (el) => STRUCTURAL.some((c) => el.classList.contains(c));
			const gutter = parseFloat(getComputedStyle(document.querySelector('.design-panel'))
				.getPropertyValue('--property-gutter')) || 10;
			// Only an inset at (or beyond) the gutter counts; small nudges are
			// deliberate optical spacing, not a second gutter.
			const inset = (el) => {
				const cs = getComputedStyle(el);
				const value = parseFloat(cs.paddingLeft) + parseFloat(cs.marginLeft);
				return value >= gutter ? value : 0;
			};
			const label = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${(el.className || '').toString().trim().split(/\s+/).slice(0, 3).join('.')}`;
			const out = [];
			document.querySelectorAll('#designPanel .settings-subsection').forEach((root) => {
				root.querySelectorAll('*').forEach((el) => {
					if (!isStructural(el)) return;
					const own = inset(el);
					if (own <= 0) return;
					// Walk up to the nearest block boundary looking for another inset.
					let node = el.parentElement;
					while (node && node !== root && !node.classList.contains('settings-subsection')) {
						// A bordered card is a new box: it legitimately insets from
						// its parent, and its contents inset again from it. Stop the
						// walk at that boundary rather than counting both.
						if (node.classList.contains('subsection-content-group')) break;
						if (isStructural(node) && inset(node) > 0) {
							out.push({ el: label(el), own, ancestor: label(node), ancestorInset: inset(node) });
							return;
						}
						node = node.parentElement;
					}
				});
			});
			// The mirror defect: actual CONTENT touching the panel wall. Containers
			// are legitimately flush - their child rows apply the gutter - so the
			// only meaningful test is whether something you can see or click ends
			// up against the edge. Zeroing a shared rule causes exactly this.
			document.querySelectorAll('#designPanel .settings-subsection').forEach((root) => {
				const rootLeft = root.getBoundingClientRect().left;
				root.querySelectorAll('input, select, textarea, button, .property-label, .property-value, .segmented-control, .asset-info').forEach((el) => {
					if (!el.getClientRects().length) return;
					if (el.type === 'checkbox' || el.type === 'radio') return; // visually hidden
					if (el.closest('.panel-resize-handle')) return;
					// An element that insets its own contents (a full-width click
					// strip, a padded label) is legitimately flush as a box.
					if (parseFloat(getComputedStyle(el).paddingLeft) >= gutter - 2) return;
					const left = el.getBoundingClientRect().left;
					if (left - rootLeft >= gutter - 2) return;
					const owner = el.closest('.subsection-content-group');
					out.push({
						el: label(el),
						own: 0,
						ancestor: `FLUSH AGAINST PANEL EDGE  [in ${owner ? label(owner) : '?'}]`,
						ancestorInset: 0
					});
				});
			});

			// Overflow: anything rendering past the panel's right edge. `width:100%`
			// combined with a horizontal margin is the usual cause, and it is
			// invisible in a narrow screenshot until a field is already clipped.
			document.querySelectorAll('#designPanel .settings-subsection').forEach((root) => {
				const rootRight = root.getBoundingClientRect().right;
				root.querySelectorAll('*').forEach((el) => {
					if (!el.getClientRects().length) return;
					if (getComputedStyle(el).position === 'absolute') return;
					const right = el.getBoundingClientRect().right;
					if (right - rootRight < 1) return;
					out.push({
						el: label(el),
						own: Math.round(right - rootRight),
						ancestor: 'OVERFLOWS PANEL RIGHT EDGE by',
						ancestorInset: 0
					});
				});
			});

			// Vertical clearance: a bordered card whose last child sits on the
			// bottom border. The counterpart to the horizontal checks - it is the
			// same defect turned ninety degrees, and just as easy to miss.
			document.querySelectorAll('#designPanel .subsection-content-group').forEach((card) => {
				const cs = getComputedStyle(card);
				if (parseFloat(cs.borderBottomWidth) < 1) return;
				if (!card.getClientRects().length) return;
				const cardBottom = card.getBoundingClientRect().bottom - parseFloat(cs.borderBottomWidth);
				const kids = [...card.children].filter((k) => k.getClientRects().length);
				const last = kids[kids.length - 1];
				if (!last) return;
				// Descend to the deepest last visible element: a wrapper's box
				// includes its own padding, so measuring the wrapper would report
				// zero clearance even when its content is correctly inset.
				let target = last;
				for (let depth = 0; depth < 8; depth += 1) {
					const kids = [...target.children].filter((k) => k.getClientRects().length);
					if (!kids.length) break;
					target = kids[kids.length - 1];
				}
				const clearance = cardBottom - target.getBoundingClientRect().bottom;
				if (clearance >= 3) return;
				out.push({
					el: label(target),
					own: Math.round(clearance),
					ancestor: `TOUCHES CARD BOTTOM BORDER (clearance px) in ${label(card)}`,
					ancestorInset: 0
				});
			});

			// Actions owns one equal inset around its buttons. If a card or wrapper
			// adds another trailing gutter, the last button looks vertically off-
			// centre even though the Actions rule itself is symmetric.
			document.querySelectorAll('#designPanel .property-actions').forEach((actions) => {
				if (!actions.getClientRects().length) return;
				const buttons = [...actions.children].filter((child) => child.matches('button') && child.getClientRects().length);
				if (!buttons.length) return;
				const rect = actions.getBoundingClientRect();
				const top = buttons[0].getBoundingClientRect().top - rect.top;
				const bottom = rect.bottom - buttons[buttons.length - 1].getBoundingClientRect().bottom;
				if (Math.abs(top - bottom) <= 1) return;
				out.push({
					el: label(actions),
					own: Math.round(bottom),
					ancestor: `ASYMMETRIC ACTION INSET (top ${Math.round(top)}px / bottom ${Math.round(bottom)}px)`,
					ancestorInset: 0
				});
			});

			document.querySelectorAll('#designPanel .subsection-content-group').forEach((card) => {
				const cs = getComputedStyle(card);
				if (parseFloat(cs.borderBottomWidth) < 1 || !card.getClientRects().length) return;
				let node = card;
				let trailingActions = null;
				for (let depth = 0; depth < 10; depth += 1) {
					const kids = [...node.children].filter((child) => child.getClientRects().length);
					if (!kids.length) break;
					node = kids[kids.length - 1];
					if (node.classList.contains('property-actions')) trailingActions = node;
				}
				if (!trailingActions || !node.matches('button')) return;
				const innerBottom = card.getBoundingClientRect().bottom - parseFloat(cs.borderBottomWidth);
				const clearance = innerBottom - node.getBoundingClientRect().bottom;
				const expected = parseFloat(getComputedStyle(trailingActions).paddingBottom);
				if (Math.abs(clearance - expected) <= 1) return;
				out.push({
					el: label(node),
					own: Math.round(clearance),
					ancestor: `TRAILING ACTION HAS STACKED CARD CLEARANCE (expected ${Math.round(expected)}px) in ${label(card)}`,
					ancestorInset: 0
				});
			});

			// Collapse duplicates - one report per class pair is enough.
			const seen = new Map();
			out.forEach((f) => {
				const key = `${f.el}|${f.ancestor}`;
				if (!seen.has(key)) seen.set(key, { ...f, count: 0 });
				seen.get(key).count += 1;
			});
			return [...seen.values()].sort((a, b) => b.count - a.count);
		});

		const findings = [];
		const widths = [280, 320, 360, 400, 450];
		const themes = ['dark', 'light'];
		for (const theme of themes) {
		for (const width of widths) {
			await page.evaluate((value) => {
				document.documentElement.style.setProperty('--glitter-panel-width', `${value}px`);
				document.querySelectorAll('.subsection-section-group, .effects-stack')
					.forEach((node) => node.classList.remove('collapsed'));
			}, width);
			await page.waitForTimeout(80);
			await page.evaluate((value) => {
				if (value === 'dark') document.documentElement.removeAttribute('data-theme');
				else document.documentElement.dataset.theme = value;
			}, theme);
			(await auditLayout()).forEach((finding) => findings.push({ ...finding, state: `${theme}/${width}px/open` }));

			await page.evaluate(() => {
				document.querySelectorAll('.subsection-section-group, .effects-stack')
					.forEach((node, index) => node.classList.toggle('collapsed', index % 2 === 0));
			});
			await page.waitForTimeout(80);
			(await auditLayout()).forEach((finding) => findings.push({ ...finding, state: `${theme}/${width}px/mixed` }));
		}
		}

		await browser.close();
		if (!findings.length) {
			console.log('OK - gutter applied exactly once on every path.');
			return;
		}
		console.log(`!!! ${findings.length} layout findings across the width/state matrix !!!\n`);
		findings.forEach((f) => {
			console.log(`  [${f.state}] ${f.el}  (+${f.own}px)\n    inside ${f.ancestor}  (+${f.ancestorInset}px)   x${f.count}`);
		});
		process.exitCode = 1;
	} finally { stop(); }
})();

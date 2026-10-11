'use strict';

const fs = require('fs');
const { chromium } = require('playwright');
const assert = require('assert/strict');

(async () => {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		if (process.env.GLITTER_TEST_CSS) await page.route('**/css/style.css*', route => route.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.GLITTER_TEST_CSS) }));
		await page.goto(process.env.GLITTER_URL || 'http://localhost/glitter/');
		await page.waitForFunction(() => window.editor);
		const types = await page.evaluate(() => Object.keys(PATTERN_TYPES));
		const cases = [...types.map(type => ({ type })), { type: 'motif', transparentBackground: true, shapeId: 'heart', shapeSize: 100, rotation: 45 }, { type: 'stripes', scroll: 'down-right' },
			...['grid', 'brick-row', 'brick-column', 'hex-row', 'hex-column'].flatMap(tileType => [true, false].map(crisp => ({ type: 'motif', tileType, brickOffset: '0.3333333333333333', spacing: 37, shapeSize: 170, rotation: 30, transparentBackground: true, scroll: 'down-right', crisp })))];
		for (const [index, pattern] of cases.entries()) {
			await page.evaluate(pattern => {
				PREFERENCES.set('crispMaskEdges', pattern.crisp !== false);
				document.getElementById('pattern-parity-fixture')?.remove();
				const node = document.createElement('div');
				node.id = 'pattern-parity-fixture';
				node.style.cssText = 'position:fixed;left:0;top:0;width:64px;height:64px;z-index:999999;background-color:white;';
				const paint = document.createElement('div');
				paint.style.cssText = 'width:64px;height:64px;';
				node.appendChild(paint);
				document.body.appendChild(node);
				window.patternParitySource = resolveEffectPaintSource({ mode: 'pattern', pattern, scale: 137, textureOffsetX: 3, textureOffsetY: -7 });
				applyPaintSourceToElement(paint, window.patternParitySource);
			}, pattern);
			const times = pattern.scroll ? [0, 250, 1000, 1999, 2000] : [0];
			for (const time of times) {
				await page.evaluate(time => {
					const animations = document.querySelector('#pattern-parity-fixture > div').getAnimations();
					if (window.patternParitySource.pattern.scroll !== 'none' && !animations.length) throw Error('Scrolling preview animation is missing; use GLITTER_TEST_CSS with compiled Sass');
					for (const animation of animations) { animation.pause(); animation.currentTime = time; }
				}, time);
				await page.waitForTimeout(25);
				const shot = await page.locator('#pattern-parity-fixture').screenshot({ animations: 'allow' });
				const difference = await page.evaluate(async ({ png, time }) => {
					const img = await loadImageElement(`data:image/png;base64,${png}`);
					const preview = createAppCanvas(64, 64, 'tests/pattern-preview');
					preview.getContext('2d').drawImage(img, 0, 0);
					const exported = createAppCanvas(64, 64, 'tests/pattern-export');
					const ctx = exported.getContext('2d');
					ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 64, 64);
					editor.sceneCompositor._paintSourceInto(ctx, 64, 64, window.patternParitySource, { sourceKey: 'test', sourceSelectionMap: new Map([['__pattern_test', { time }]]) });
					const actual = preview.getContext('2d').getImageData(0, 0, 64, 64).data;
					const expected = ctx.getImageData(0, 0, 64, 64).data;
					return actual.findIndex((value, i) => value !== expected[i]);
				}, { png: shot.toString('base64'), time });
				assert.equal(difference, -1, `Pattern case ${index} (${pattern.type}) at ${time}ms differs at byte ${difference}`);
			}
		}
		console.log('PASS pattern preview/export pixels: every type, transparent rotated motifs, scale, offsets and scroll steps');
	} finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

'use strict';

const assert = require('assert');
const { chromium } = require('playwright');

(async () => {
	const browser = await chromium.launch({ headless: true });
	try {
		for (const width of [1440, 390]) {
			const page = await browser.newPage({ viewport: { width, height: 900 } });
			const errors = [];
			page.on('pageerror', error => errors.push(error.message));
			if (process.env.GLITTER_TEST_CSS) await page.route('**/css/style.css*', route => route.fulfill({ path: process.env.GLITTER_TEST_CSS, contentType: 'text/css' }));
			await page.goto(process.env.GLITTER_URL || 'http://localhost/glitter/');
			await page.waitForFunction(() => window.editor?.modalManager);
			await page.evaluate(async () => {
				editor.modalManager.closeAll({ force: true });
				await editor.modalManager.pendingHistoryBack;
			});
			const settle = () => page.evaluate(async () => {
				await editor.modalManager.pendingHistoryBack;
				await new Promise(requestAnimationFrame);
			});
			const ask = (options = {}) => page.evaluate(options => {
				window.answer = 'pending';
				editor.confirmAction(options).then(value => { window.answer = value; });
			}, options);
			await page.evaluate(() => editor.modalManager.open('settingsModal'));
			await page.locator('#showHelpfulHints').focus();
			for (const dismiss of ['Escape', 'Back', 'Cancel', 'X', 'Outside']) {
				await ask({ tone: 'danger' });
				await page.waitForFunction(() => document.activeElement?.id === 'confirmationCancelBtn');
				assert(await page.evaluate(() => document.getElementById('settingsModal').classList.contains('visible') && document.getElementById('settingsModal').inert && !document.getElementById('confirmationModal').inert));
				if (process.env.GLITTER_TEST_CSS) assert.strictEqual(await page.locator('#confirmationModal').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
				if (dismiss === 'Escape') await page.keyboard.press('Escape');
				if (dismiss === 'Back') await page.evaluate(() => history.back());
				if (dismiss === 'Cancel') await page.click('#confirmationCancelBtn');
				if (dismiss === 'X') await page.click('#confirmationModalClose');
				if (dismiss === 'Outside') await page.locator('#confirmationModal').click({ position: { x: 2, y: 2 } });
				await page.waitForFunction(() => window.answer === false);
				await settle();
				assert(await page.evaluate(() => editor.modalManager.stack.length === 1 && !document.getElementById('settingsModal').inert && document.getElementById('settingsModal').contains(document.activeElement)));
			}
			await ask({ tone: 'danger' });
			await page.waitForFunction(() => document.activeElement?.id === 'confirmationCancelBtn');
			await page.keyboard.press('Enter');
			await page.waitForFunction(() => window.answer === false);
			await settle();
			await page.evaluate(() => PREFERENCES.set('confirmDestructiveActions', false));
			await ask({ tone: 'danger', skippable: true });
			await page.waitForFunction(() => window.answer === true);
			await ask({ tone: 'danger', skippable: false });
			await page.waitForSelector('#confirmationModal.visible');
			await page.click('#confirmationConfirmBtn');
			await page.waitForFunction(() => window.answer === true);
			await page.evaluate(() => editor.modalManager.close('settingsModal'));
			await settle();
			assert(await page.evaluate(() => !history.state?.glitterModal && !editor.modalManager.isAnyOpen()));
			await ask();
			await page.waitForFunction(() => document.activeElement?.id === 'confirmationConfirmBtn');
			assert(await page.evaluate(() => !document.getElementById('confirmationModal').classList.contains('is-stacked')));
			await page.keyboard.press('Enter');
			await page.waitForFunction(() => window.answer === true);
			await settle();
			// A cancelled Back guard restores the base entry before asking.
			await page.evaluate(async () => {
				const m = editor.modalManager;
				await m.open('settingsModal');
				m.modals.get('settingsModal').beforeClose = () => editor.confirmAction({ tone: 'danger' });
				history.back();
			});
			await page.waitForSelector('#confirmationModal.visible');
			await page.click('#confirmationCancelBtn');
			await settle();
			assert.deepStrictEqual(await page.evaluate(() => history.state.glitterModal), ['settingsModal']);
			await page.evaluate(() => history.back());
			await page.waitForSelector('#confirmationModal.visible');
			await page.click('#confirmationConfirmBtn');
			await page.waitForFunction(() => !editor.modalManager.isAnyOpen());
			await settle();
			assert(await page.evaluate(() => !history.state?.glitterModal));
			await page.evaluate(() => { editor.modalManager.modals.get('settingsModal').beforeClose = null; history.forward(); });
			await page.waitForFunction(() => editor.modalManager.stack.length === 1);
			await page.evaluate(() => history.forward());
			await page.waitForTimeout(100);
			assert.deepStrictEqual(await page.evaluate(() => editor.modalManager.stack.map(config => config.id)), ['settingsModal']);
			await page.evaluate(() => {
				window.choice = 'pending';
				editor.chooseAction({ tone: 'danger', actions: [{ id: 'discard', label: "Don't Save" }, { id: 'cancel', label: 'Cancel' }, { id: 'save', label: 'Save', primary: true }] }).then(value => { window.choice = value; });
			});
			await page.waitForFunction(() => document.activeElement?.id === 'confirmationCancelBtn');
			assert.strictEqual(await page.locator('#confirmationModal .modal-footer > .btn-text').textContent(), "Don't Save");
			await page.locator('[data-dialog-action="save"]').click();
			await page.waitForFunction(() => window.choice === 'save');
			await settle();
			await page.evaluate(async () => {
				const m = editor.modalManager;
				m.closeAll({ force: true });
				await m.pendingHistoryBack;
				const first = editor.confirmAction();
				const second = editor.confirmAction({ tone: 'danger' });
				window.firstAnswer = await first;
				second.then(value => { window.secondAnswer = value; });
			});
			assert.strictEqual(await page.evaluate(() => window.firstAnswer), false);
			await page.waitForFunction(() => document.activeElement?.id === 'confirmationCancelBtn');
			await page.keyboard.press('Enter');
			await page.waitForFunction(() => window.secondAnswer === false);
			await settle();
			assert(await page.evaluate(() => !history.state?.glitterModal));
			// The serializer must finish saving before it begins replacing the document.
			const projectChoices = await page.evaluate(async () => {
				const results = [];
				for (const [action, saves] of [['save', true], ['save', false], ['discard', false], ['cancel', false], [null, false]]) {
					const events = [];
					const owner = {
						originalImage: true, isSaved: false,
						chooseAction: async () => action,
						saveProjectFile: async function () { events.push('save'); this.isSaved = saves; }
					};
					for (const key of ['textGlitterManager', 'shapeGlitterManager', 'stickerManager', 'glitterManager', 'baseBackgroundManager']) owner[key] = { closePickerSession() {} };
					const serializer = new ProjectSerializer(owner);
					serializer.validateProjectData = () => {};
					serializer.runMigrations = data => data;
					serializer.preflight = async () => ({ issues: [] });
					serializer.loadBaseImage = async () => { events.push('replace'); throw new Error('replacement reached'); };
					try { await serializer.load({}); }
					catch (error) { if (error.message !== 'replacement reached') throw error; }
					results.push(events);
				}
				return results;
			});
			assert.deepStrictEqual(projectChoices, [['save', 'replace'], ['save'], ['replace'], [], []]);
			await page.evaluate(async () => {
				const canvas = document.createElement('canvas');
				canvas.width = canvas.height = 1;
				const blob = await new Promise(resolve => canvas.toBlob(resolve));
				const target = getActiveExportTarget(editor.exportSettings, { mp4Supported: false });
				editor.exportResultPresenter.show({ blob, file: new File([blob], 'test.png'), target, width: 1, height: 1 });
			});
			await page.waitForFunction(() => editor.modalManager.getTopOpenModalConfig()?.id === 'exportPreviewModal');
			await page.keyboard.press('Escape');
			await settle();
			assert(await page.evaluate(() => !editor.exportResultPresenter.previewBlobUrl && !history.state?.glitterModal));
			assert.deepStrictEqual(errors, []);
			console.log(`PASS modal stack, focus, history and actions at ${width}px`);
			await page.close();
		}
	} finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

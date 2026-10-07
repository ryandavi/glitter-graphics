'use strict';

function bindGlitterRecolorAction(editor, getLayer, slot, prefix) {
	document.getElementById(`${prefix}Recolor`)?.addEventListener('click', () => {
		const layer = getLayer();
		if (layer && editor.canEditLayer(layer, { notify: true })) COMMANDS.recolorGlitter.run(editor, { layerId: layer.id, slot });
	});
}

function syncGlitterRecolorAction(editor, layer, slot, prefix, getLayer) {
	const button = document.getElementById(`${prefix}Recolor`);
	if (!button) return;
	button.hidden = true;
	const data = getLayerPaintSlot(layer, slot);
	const id = data?.glitterId;
	const item = data?.mode === 'glitter' && editor.glitterLibrary?.getItemById(id);
	editor.glitterLibrary?.canRecolor(item).then(allowed => {
		const current = getLayerPaintSlot(layer, slot);
		if (getLayer() !== layer || current?.mode !== 'glitter' || current.glitterId !== id) return;
		button.hidden = !allowed;
		button.querySelector('.name').textContent = item?.recipe ? 'Edit colors' : 'Recolor';
	});
}

class GlitterRecolorController {
	constructor(editor) {
		this.editor = editor;
		this.library = editor.glitterLibrary;
		this.pickerSession = null;
		this.selectedId = null;
		this.session = null;
		this.eligible = new Map();
		document.body.appendChild(document.getElementById('tpl-glitter-recolor').content.cloneNode(true));
		this.modal = document.getElementById('glitterRecolorModal');
		this.byId = id => this.modal.querySelector(`#${id}`);
		renderPanelSection(PANEL_SCHEMAS.glitterRecolor);
		editor.modalManager.register('glitterRecolorModal', {
			closeBtnId: ['recolorClose', 'recolorCancel'], initialFocusSelector: '#recolorStage',
			beforeClose: () => this.confirmDiscard(), onClose: () => this.finish()
		});
		editor.pickers.register(this);
		this.byId('recolorSave').addEventListener('click', () => this.save(Boolean(this.session?.canReplace)));
		this.byId('recolorCopy').addEventListener('click', () => this.save(false));
		this.byId('recolorDelete').addEventListener('click', () => this.delete());
		this.byId('recolorName').addEventListener('change', () => this.commit());
		this.byId('recolorAll').addEventListener('input', event => {
			if (!this.session || this.pending()) return;
			this.session.colors = GlitterRecolor.shiftAll(this.session.colors, this.session.analysis.swatches, event.target.value);
			this.sync();
		});
		this.byId('recolorAll').addEventListener('change', () => this.commit());
		this.allText = this.addHexControl(this.byId('recolorAll'), 'Hex color for all colors');
		this.allText.addEventListener('change', () => {
			try {
				const color = GlitterRecolor.hex(GlitterRecolor.rgb(this.allText.value));
				this.allText.setCustomValidity('');
				this.session.colors = GlitterRecolor.shiftAll(this.session.colors, this.session.analysis.swatches, color);
				this.commit(); this.sync();
			} catch { this.allText.setCustomValidity('Enter a six-digit hex color'); this.allText.reportValidity(); }
		});
		this.allRevert = buildFieldRevert('recolorAll');
		this.byId('recolorAll').closest('.property-row').appendChild(this.allRevert);
		this.allRevert.dataset.revertBound = '';
		this.allRevert.addEventListener('click', () => {
			if (!this.session || this.pending()) return;
			this.session.colors = Object.fromEntries(this.session.analysis.swatches.map(swatch => [swatch.key, swatch.key]));
			this.commit(); this.sync();
		});
		for (const axis of ['Hue', 'Saturation', 'Lightness', 'Contrast']) {
			bindSlider(this.byId(`recolor${axis}`), this.byId(`recolor${axis}Value`), {
				onInput: () => this.sync(), resetValue: FIELDS[`recolor${axis}`].value,
				resetButton: this.byId(`resetRecolor${axis}`)
			});
		}
		this.byId('recolorApplyAdjust').addEventListener('click', () => this.applyAdjustment());
		this.byId('recolorCancelAdjust').addEventListener('click', () => { this.resetAdjustments(); this.sync(); });
		this.byId('recolorPlay').addEventListener('click', () => { this.playing = !this.playing; this.transport(); });
		this.byId('recolorBackdrop').addEventListener('change', event => { this.modal.dataset.backdrop = event.target.value; });
		const stage = this.byId('recolorStage');
		stage.addEventListener('click', event => {
			if (this.pending()) return;
			const index = this.hitTest(event);
			if (index >= 0) {
				if (index === this.selected) this.clearSelection();
				else this.selectSwatch(index, true);
			} else this.clearSelection();
		});
		this.byId('recolorStageHost').addEventListener('click', event => {
			if (event.target === event.currentTarget) this.clearSelection();
		});
		stage.addEventListener('keydown', event => {
			if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
				event.preventDefault(); this.setFrame(this.frame + (event.key === 'ArrowLeft' ? -1 : 1));
			}
		});
		document.addEventListener('keydown', event => {
			if (this.session && this.modal.classList.contains('visible') && !this.confirming && event.key === 'Escape' && this.selected >= 0) {
				event.preventDefault(); event.stopImmediatePropagation(); this.clearSelection();
			} else if (this.session && this.modal.classList.contains('visible') && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
				event.preventDefault(); event.stopImmediatePropagation(); this.undo(event.shiftKey ? 1 : -1);
			} else if (this.pickerSession && event.key === 'Escape') {
				event.preventDefault(); event.stopImmediatePropagation(); this.closePickerSession();
			}
		}, true);
	}

	installLibraryActions() {
		const button = document.getElementById('recolorGlitterBtn');
		button.addEventListener('click', () => COMMANDS.recolorGlitter.run(this.editor));
		this.libraryButton = button;
		const header = this.library.browser.setHeader;
		const render = header.render.bind(header);
		header.render = (category, items) => {
			render(category, items);
			if (category?.id !== 'custom') return;
			const edit = document.createElement('button');
			edit.type = 'button'; edit.className = 'btn-flat'; edit.textContent = 'Edit colors';
			edit.disabled = !items.some(item => item.id === this.selectedId);
			edit.addEventListener('click', () => COMMANDS.recolorGlitter.run(this.editor, { itemId: this.selectedId }));
			header.element.querySelector('.asset-set-header-line').appendChild(edit);
		};
		this.library.browser.refresh();
	}

	async command(target) {
		try {
			if (target?.layerId) {
				const layer = this.editor.layerManager.getLayerById(target.layerId);
				if (!layer || !this.editor.canEditLayer(layer, { notify: true })) return;
				const data = getLayerPaintSlot(layer, target.slot);
				await this.open(this.library.getItemById(data?.glitterId), target);
			} else if (target?.itemId) await this.open(this.library.getItemById(target.itemId));
			else if (this.pickerSession) this.closePickerSession();
			else {
				this.editor.pickers.closeAll();
				pickerOpenSession(this, { slot: 'recolor' });
				renderPickerStrip(this.getPickerStripState());
				this.libraryButton.setAttribute('aria-pressed', 'true');
				this.libraryButton.classList.add('active');
				await revealAssetBrowser(this.editor, this.library);
				const session = this.pickerSession;
				const done = this.editor.beginActivity('glitter-recolor-gate', 'Checking glitter colors');
				try {
					await Promise.all(this.library.getAllContent().map(async item => { this.eligible.set(item.id, await this.library.canRecolor(item)); }));
					if (session === this.pickerSession) this.library.browser.refresh();
				} finally { done(); }
			}
		} catch (error) { this.editor.showError(error.message); }
	}

	closePickerSession() {
		if (!this.pickerSession) return;
		pickerCloseSession(this);
		this.libraryButton.setAttribute('aria-pressed', 'false');
		this.libraryButton.classList.remove('active');
		renderPickerStrip({ ownsStrip: true, visible: false });
		this.library.browser.refresh();
	}
	getPickerStripState() { return { ownsStrip: true, visible: true, armed: true, library: 'glitter', title: 'Pick a glitter to recolor', showDone: false }; }

	async pick(item) {
		if (!await this.library.canRecolor(item)) { this.editor.updateStatus('Choose a tile with eight colors or fewer from an enabled style'); return; }
		this.closePickerSession();
		await this.open(item);
	}

	async open(item, target = null) {
		if (this.session || this.opening || !item) return;
		this.opening = true;
		const done = this.editor.beginActivity('glitter-recolor-open', 'Loading glitter colors');
		try {
			if (!await this.library.canRecolor(item)) throw new Error('This glitter cannot be recolored');
			const { source, bytes, analysis } = await this.library.getRecolorSource(item);
			const decoded = await decodeGif(bytes);
			const colors = Object.fromEntries(analysis.swatches.map(swatch => [swatch.key, item.recipe?.colors[swatch.key] || swatch.key]));
			this.session = { item, target, source, bytes, analysis, colors, canReplace: this.library.userContent.includes(item) };
			this.frames = this.composeFrames(decoded, analysis.swatches);
			this.byId('recolorName').value = item.recipe ? item.name : `${item.name} custom`;
			this.byId('recolorTitle').textContent = `Recolor glitter: ${item.name}`;
			this.byId('recolorCredit').replaceChildren(this.library.createAssetProvenance(item.recipe ? item : { recipe: { sourceName: source.name }, attribution: this.library.browser.getAssetAttribution(source) }));
			this.byId('recolorSave').querySelector('.name').textContent = this.session.canReplace ? 'Replace' : 'Save to My Glitter';
			this.byId('recolorCopy').hidden = this.byId('recolorDelete').hidden = !this.library.userContent.includes(item);
			this.byId('recolorBackdropRow').hidden = !this.frames.some(frame => frame.map.includes(-1));
			this.frame = 0; this.selected = -1;
			this.resetAdjustments(); this.buildSwatches(); this.buildFrames();
			this.history = [this.snapshot()]; this.historyIndex = 0; this.initial = JSON.stringify(this.snapshot());
			this.playing = !PREFERENCES.get('reduceMotion');
			await this.editor.modalManager.open('glitterRecolorModal');
			this.sync(); this.transport();
			this.resizeObserver = new ResizeObserver(() => this.draw());
			this.resizeObserver.observe(this.byId('recolorStageHost'));
		} catch (error) { this.finish(); this.editor.showError(error.message); }
		finally { this.opening = false; done(); }
	}

	composeFrames(decoded, swatches) {
		const keys = new Map(swatches.map((swatch, index) => [swatch.key, index]));
		const canvas = document.createElement('canvas'); canvas.width = decoded.width; canvas.height = decoded.height;
		const ctx = canvas.getContext('2d');
		let previous = null, restore = null;
		return decoded.frames.map((frame, index) => {
			if (previous?.disposal === 2) ctx.clearRect(previous.x, previous.y, previous.width, previous.height);
			if (previous?.disposal === 3 && restore) ctx.putImageData(restore, 0, 0);
			restore = frame.disposal === 3 ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
			const patch = document.createElement('canvas'); patch.width = canvas.width; patch.height = canvas.height;
			patch.getContext('2d').putImageData(frame.imageData, 0, 0); ctx.drawImage(patch, 0, 0);
			const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const map = new Int16Array(canvas.width * canvas.height).fill(-1);
			for (let pixel = 0; pixel < map.length; pixel++) {
				const offset = pixel * 4;
				if (image.data[offset + 3]) map[pixel] = keys.get(GlitterRecolor.hex(Array.from(image.data.subarray(offset, offset + 3)))) ?? -1;
			}
			previous = frame;
			return { map, delay: decoded.frameDelays[index] };
		});
	}

	addHexControl(input, label) {
		input.closest('.property-row').classList.add('recolor-palette-row');
		const text = document.createElement('input'); text.type = 'text'; text.maxLength = 7; text.className = 'color-hex-input'; text.setAttribute('aria-label', label); text.spellcheck = false;
		const control = document.createElement('span'); control.className = 'recolor-color-control';
		const swatch = input.closest('.color-input-with-eyedropper') || input;
		swatch.before(control); control.append(swatch);
		if (swatch !== input) {
			swatch.classList.add('has-hex'); swatch.insertBefore(text, swatch.querySelector('.color-eyedropper-button'));
		} else control.append(text);
		return text;
	}

	buildSwatches() {
		const host = this.byId('recolorSwatches'); host.replaceChildren(); this.rows = [];
		this.session.analysis.swatches.forEach((swatch, index) => {
			const entry = buildColorListRow({ id: `recolorSwatch${index}`, label: `Color ${index + 1}`, coverage: `${Math.round(swatch.share * 100)}%`, value: `#${swatch.key}` });
			const { row, select, input, text, revert } = entry;
			revert.dataset.revertBound = '';
			const change = value => {
				if (this.pending()) return;
				try { this.session.colors[swatch.key] = GlitterRecolor.hex(GlitterRecolor.rgb(value)); text.setCustomValidity(''); this.sync(); }
				catch { text.setCustomValidity('Enter a six-digit hex color'); text.reportValidity(); }
			};
			input.addEventListener('input', () => change(input.value)); input.addEventListener('change', () => this.commit());
			text.addEventListener('change', () => { change(text.value); this.commit(); });
			revert.addEventListener('click', () => { change(swatch.key); this.commit(); });
			input.addEventListener('click', () => this.selectSwatch(index));
			text.addEventListener('focus', () => this.selectSwatch(index));
			row.addEventListener('click', event => {
				if (event.target.closest('input, .color-eyedropper-button, .property-revert')) return;
				if (this.selected === index) this.clearSelection(); else this.selectSwatch(index);
			});
			select.setAttribute('aria-label', `Select color ${index + 1}`);
			host.appendChild(row); this.rows.push(entry);
		});
	}

	buildFrames() {
		const host = this.byId('recolorFrames'); host.replaceChildren();
		if (this.frames.length > 8) {
			const slider = document.createElement('input'); slider.type = 'range'; slider.min = 0; slider.max = this.frames.length - 1; slider.step = 1; slider.setAttribute('aria-label', 'Frame');
			slider.addEventListener('input', () => this.setFrame(Number(slider.value))); host.appendChild(slider);
		} else this.frames.forEach((_frame, index) => {
			const button = document.createElement('button'); button.type = 'button'; button.className = 'segmented-option'; button.textContent = index + 1; button.setAttribute('aria-label', `Frame ${index + 1}`);
			button.addEventListener('click', () => this.setFrame(index)); host.appendChild(button);
		});
	}

	selectSwatch(index, openPicker = false) {
		if (!this.session || this.pending()) return;
		this.selected = index;
		if (!this.frames[this.frame].map.includes(index)) {
			const frame = this.frames.findIndex(frame => frame.map.includes(index)); if (frame >= 0) this.setFrame(frame);
		}
		this.playing = false; this.transport();
		if (openPicker) this.rows[index].row.scrollIntoView({ block: 'nearest' });
		this.syncSelection();
		if (openPicker) {
			const input = this.rows[index].input;
			try { input.showPicker(); } catch { input.click(); }
		}
	}

	clearSelection() { this.selected = -1; this.syncSelection(); }
	syncSelection() {
		this.rows.forEach((entry, index) => {
			const selected = index === this.selected;
			entry.row.classList.toggle('selected', selected);
			entry.select.setAttribute('aria-pressed', String(selected));
			entry.select.setAttribute('aria-label', `${selected ? 'Deselect' : 'Select'} color ${index + 1}`);
		});
	}

	adjustments() { return Object.fromEntries(['Hue', 'Saturation', 'Lightness', 'Contrast'].map(axis => [axis.toLowerCase(), Number(this.byId(`recolor${axis}`).value)])); }
	pending() { return Boolean(this.session) && Object.values(this.adjustments()).some(value => value !== 0); }
	previewColors() { return GlitterRecolor.adjust(this.session.colors, this.session.analysis.swatches, this.adjustments()); }
	resetAdjustments() {
		for (const axis of ['Hue', 'Saturation', 'Lightness', 'Contrast']) syncSlider(this.byId(`recolor${axis}`), FIELDS[`recolor${axis}`].value);
	}
	applyAdjustment() { if (!this.pending()) return; this.session.colors = this.previewColors(); this.resetAdjustments(); this.commit(); this.sync(); }
	snapshot() { return { colors: { ...this.session.colors }, name: this.byId('recolorName').value }; }
	commit() {
		if (!this.session || JSON.stringify(this.snapshot()) === JSON.stringify(this.history[this.historyIndex])) return;
		this.history.splice(this.historyIndex + 1); this.history.push(this.snapshot()); this.historyIndex++;
	}
	undo(direction) {
		if (this.pending()) { this.resetAdjustments(); this.sync(); return; }
		this.commit(); this.historyIndex = Math.max(0, Math.min(this.history.length - 1, this.historyIndex + direction));
		const state = this.history[this.historyIndex]; this.session.colors = { ...state.colors }; this.byId('recolorName').value = state.name; this.sync();
	}
	sync() {
		if (!this.session) return;
		const colors = this.previewColors(), pending = this.pending();
		this.byId('recolorApplyAdjust').disabled = this.byId('recolorCancelAdjust').disabled = !pending;
		this.byId('recolorAll').disabled = pending;
		this.allText.disabled = pending;
		this.allRevert.disabled = pending || this.session.analysis.swatches.every(swatch => (colors[swatch.key] || swatch.key) === swatch.key);
		this.byId('recolorSwatches').inert = pending;
		this.byId('recolorAll').value = `#${colors[this.session.analysis.swatches[0].key] || this.session.analysis.swatches[0].key}`;
		this.allText.value = this.byId('recolorAll').value;
		this.rows.forEach((entry, index) => {
			const key = this.session.analysis.swatches[index].key, value = colors[key] || key;
			entry.input.value = entry.text.value = `#${value}`; entry.input.disabled = entry.text.disabled = pending;
			entry.revert.disabled = pending || value === key;
		});
		this.syncSelection();
		this.draw();
	}
	hitTest(event) {
		if (!this.session) return -1;
		const bounds = this.byId('recolorStage').getBoundingClientRect(), { width, height } = this.session.analysis;
		const x = Math.floor((event.clientX - bounds.left) * width / bounds.width), y = Math.floor((event.clientY - bounds.top) * height / bounds.height);
		return x >= 0 && x < width && y >= 0 && y < height ? this.frames[this.frame].map[y * width + x] : -1;
	}
	draw() {
		if (!this.session) return;
		const { width, height, swatches } = this.session.analysis;
		const colors = this.previewColors(), image = new ImageData(width, height);
		this.frames[this.frame].map.forEach((index, pixel) => {
			if (index < 0) return;
			image.data.set(GlitterRecolor.rgb(colors[swatches[index].key] || swatches[index].key), pixel * 4);
			image.data[pixel * 4 + 3] = 255;
		});
		const tile = document.createElement('canvas'); tile.width = width; tile.height = height; tile.getContext('2d').putImageData(image, 0, 0);
		const stage = this.byId('recolorStage'), host = this.byId('recolorStageHost');
		const zoom = Math.max(1, Math.min(CONFIG.tools.glitter.recolor.stageZoom, Math.floor(host.clientWidth / width), Math.floor(host.clientHeight / height)));
		stage.width = width * zoom; stage.height = height * zoom;
		const ctx = stage.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(tile, 0, 0, stage.width, stage.height);
		const repeat = this.byId('recolorRepeat'); repeat.width = host.clientWidth || width * 4; repeat.height = height * 2;
		const repeatCtx = repeat.getContext('2d'); repeatCtx.fillStyle = repeatCtx.createPattern(tile, 'repeat'); repeatCtx.fillRect(0, 0, repeat.width, repeat.height);
		this.byId('recolorFrames').querySelectorAll('button').forEach((button, index) => { button.classList.toggle('active', index === this.frame); button.setAttribute('aria-pressed', String(index === this.frame)); });
		const slider = this.byId('recolorFrames').querySelector('input'); if (slider) slider.value = this.frame;
	}
	setFrame(frame) { this.frame = (frame + this.frames.length) % this.frames.length; this.playing = false; this.transport(); this.draw(); }
	transport() {
		clearTimeout(this.timer);
		const button = this.byId('recolorPlay'), label = this.playing ? 'Pause' : 'Play';
		button.title = label; button.setAttribute('aria-label', label);
		button.querySelector('use').setAttribute('href', this.playing ? '#icon-motion-pause' : '#icon-motion-play');
		if (this.playing && this.session) this.timer = setTimeout(() => { this.frame = (this.frame + 1) % this.frames.length; this.draw(); this.transport(); }, this.frames[this.frame].delay);
	}
	async confirmDiscard() {
		if (this.saving || this.confirming) return false;
		if (!this.session || (!this.pending() && JSON.stringify(this.snapshot()) === this.initial)) return true;
		return this.confirm({ title: 'Discard recolor?', message: 'Your unsaved color changes will be lost.', confirmLabel: 'Discard' });
	}
	async confirm(options) {
		this.confirming = true;
		const manager = this.editor.modalManager;
		// Keep the recipe alive while the standard dialog owns focus and inert
		// background state. Reopening also restores the modal's Back entry.
		this.modal.classList.remove('visible');
		manager.restoreBackground(manager.modals.get('glitterRecolorModal'));
		try { return await this.editor.confirmAction(options); }
		finally {
			if (manager.pendingHistoryBack) await manager.pendingHistoryBack;
			await manager.open('glitterRecolorModal');
			this.confirming = false;
		}
	}
	async save(replace) {
		if (!this.session || this.saving) return;
		this.applyAdjustment(); const name = this.byId('recolorName').value.trim();
		if (!name) { this.byId('recolorName').focus(); this.editor.showError('Enter a name for your glitter'); return; }
		this.saving = true; const done = this.editor.beginActivity('glitter-recolor-save', 'Saving glitter');
		try {
			const { source, colors, target, item } = this.session;
			await this.library.saveCustomGlitter({ id: `custom-${crypto.randomUUID()}`, name, sourceId: source.id, sourceName: source.name, attribution: this.library.browser.getAssetAttribution(source), colors }, { replaceId: replace ? item.id : null, target });
			this.editor.modalManager.close('glitterRecolorModal', { force: true });
		} catch (error) { this.editor.showError(error.message); }
		finally { this.saving = false; done(); }
	}
	async delete() {
		if (!this.session || this.saving) return;
		const confirmed = await this.confirm({ title: 'Delete glitter?', message: 'Remove this tile from My Glitter? Layers using it will keep working. Undo cannot restore it to the Library.', confirmLabel: 'Delete' });
		if (!confirmed) return;
		this.library.retireCustomGlitter(this.session.item.id); this.editor.modalManager.close('glitterRecolorModal', { force: true });
	}
	finish() { clearTimeout(this.timer); this.resizeObserver?.disconnect(); this.session = null; this.frames = null; }
}

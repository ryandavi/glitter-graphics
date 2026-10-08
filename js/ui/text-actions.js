const TEXT_ACTION_METHODS = {
	setupTextActions() {
		const bind = (selector, command) => document.querySelectorAll(selector).forEach(button => button.addEventListener('click', () => COMMANDS[typeof command === 'function' ? command(button) : command]?.run(this.editor)));
		bind('#textFontBold', 'textToggleBold');
		bind('#textFontItalic', 'textToggleItalic');
		bind('#textUnderline', 'textToggleUnderline');
		bind('#textStrikethrough', 'textToggleStrikethrough');
		bind('[data-text-align]', button => 'textAlign' + button.dataset.textAlign[0].toUpperCase() + button.dataset.textAlign.slice(1));
		document.getElementById('textSplit')?.addEventListener('click', () => COMMANDS.splitText.run(this.editor));
		bind('#textCopyStyleAsPreset', 'copyStyleAsPreset');
		document.getElementById('textSymbols')?.replaceChildren(...CONFIG.tools.text.symbols.map(symbol => { const button = document.createElement('button'); button.className = 'btn-flat'; button.type = 'button'; button.textContent = symbol; button.title = `Insert ${symbol}`; button.addEventListener('click', () => this.insertTextSymbol(symbol)); return button; }));
		document.getElementById('textSymbols')?.addEventListener('mousedown', event => event.preventDefault());
		const emoji = document.getElementById('textColorEmoji');
		emoji?.addEventListener('change', () => {
			const layer = this.getActiveTextLayer();
			if (layer && this.editor.canEditLayer(layer)) this.runLayoutRefreshWithAnchor(layer, () => { layer.textData.colorEmoji = emoji.checked; }, { saveHistory: true });
		});
	},
	openTextMenu(triggerId, entries) {
		const trigger = document.getElementById(triggerId);
		// The schema renders the popover root and panel (an action with `menu: true`).
		const root = trigger?.closest('.app-menu-popover');
		const panel = root?.querySelector('.app-menu-panel');
		if (!panel) return;
		if (root._textMenu?.isOpen()) { root._textMenu.close(); return; }
		panel.replaceChildren(...entries.map(entry => { const button = document.createElement('button'); button.className = 'app-menu-item'; button.type = 'button'; button.textContent = entry.label; button.addEventListener('click', entry.run); return button; }));
		if (!root._textMenu) root._textMenu = setupMenuPopover({ root, trigger, panel, bindTrigger: false });
		root._textMenu.open();
	},
	insertTextSymbol(symbol) {
		const layer = this.getActiveTextLayer();
		if (!layer) return;
		const session = this.editSession;
		const start = session?.selectionStart ?? this.ui.textInput.selectionStart;
		const end = session?.selectionEnd ?? this.ui.textInput.selectionEnd;
		const value = layer.textData.text.slice(0, start) + symbol + layer.textData.text.slice(end);
		this.applyTextEdit(layer, value, { start: start + symbol.length, end: start + symbol.length });
		// The symbol buttons never take focus, so typing carries on in whichever
		// field had it.
		if (document.activeElement === this.textProxy || document.activeElement === this.ui.textInput) return;
		if (session) this.textProxy.focus({ preventScroll: true });
		else this.ui.textInput.focus();
	},
	async runTextCommand(action, value) {
		const layer = this.getActiveTextLayer();
		if (!layer || !this.editor.canEditLayer(layer, { notify: true })) return;
		if (action === 'align' && value === 'justify' && layer.textData.boxMode === 'point') return;
		await this.runLayoutRefreshWithAnchor(layer, () => {
			const data = layer.textData;
			if (action === 'bold') data.fontWeight = data.fontWeight === 700 ? 400 : 700;
			else if (action === 'italic') data.fontStyle = data.fontStyle === 'italic' ? 'normal' : 'italic';
			else if (action === 'underline' || action === 'strikethrough') data.decoration[action] = !data.decoration[action];
			else if (action === 'align') data.align = value;
			else if (action === 'size') data.fontSize = value;
		}, { saveHistory: !this.editSession });
		if (this.editSession) this.editSession.dirty = true;
		this.syncTextActionUI(layer);
	},
	syncTextActionUI(layer) {
		const data = layer.textData;
		for (const [id, active] of [['textUnderline', data.decoration.underline], ['textStrikethrough', data.decoration.strikethrough]]) {
			const button = document.getElementById(id); button?.classList.toggle('active', active); button?.setAttribute('aria-pressed', String(active));
		}
		const emoji = document.getElementById('textColorEmoji'); if (emoji) { emoji.checked = data.colorEmoji; syncFieldReverts(emoji.closest('.property-row')); }
		const toolbar = document.getElementById('textEditControls');
		toolbar?.querySelectorAll('[data-text-action]').forEach(button => {
			const action = button.dataset.textAction;
			const active = action === 'bold' ? data.fontWeight === 700 : action === 'italic' ? data.fontStyle === 'italic' : action.startsWith('align:') ? data.align === action.slice(6) : data.decoration[action];
			button.classList.toggle('active', Boolean(active)); button.setAttribute('aria-pressed', String(Boolean(active)));
			button.disabled = action === 'align:justify' && data.boxMode === 'point';
		});
		const size = document.getElementById('contextTextSize'); if (size) size.value = data.fontSize;
		const sizeValue = document.getElementById('contextTextSizeValue'); if (sizeValue) sizeValue.textContent = data.fontSize;
		this.ui.alignButtons.forEach(button => { button.hidden = button.dataset.textAlign === 'justify' && data.boxMode === 'point'; });
	},
	async splitText(mode) {
		const layer = this.getActiveTextLayer();
		if (!layer || !this.editor.canEditLayer(layer, { notify: true })) return;
		await FontLibrary.ensureLoaded(layer.textData.fontId);
		const entry = this.getMeasurementEntry(layer);
		const glyphs = entry.layout.glyphs;
		const pieces = [];
		let group = null;
		glyphs.forEach((glyph, index) => {
			if (/^\s+$/u.test(glyph.char)) { if (mode !== 'lines') group = null; else if (group) group.text += glyph.char; return; }
			if (!group || mode === 'characters' || group.line !== glyph.line) {
				group = { text: '', glyph, index, line: glyph.line }; pieces.push(group);
			}
			group.text += glyph.char;
		});
		if (!pieces.length) return;
		const manager = this.editor.layerManager;
		const gate = manager.canAddLayers(pieces.length - 1);
		if (!gate.ok) { this.editor.updateStatus(`Splitting into ${pieces.length} ${mode} needs ${pieces.length - 1} more layers; ${gate.remaining} are available. Try Words or Lines.`); return; }
		if (entry.hasOverflow && !await this.editor.confirmAction({ title: 'Split visible text?', message: 'Hidden overflow lines will be dropped. Undo restores the original text.', confirmLabel: 'Split', tone: 'danger', skippable: true })) return;
		this.endTextEdit();
		const clones = pieces.map(piece => {
			const clone = manager.buildClonedLayer(layer, { positionOffset: { x: 0, y: 0 } });
			const data = clone.textData;
			data.text = piece.text.trimEnd(); data.textCase = 'none'; data.boxMode = 'point'; data.align = 'left'; data.verticalAlign = 'top';
			delete data.boxWidth; delete data.boxHeight;
			data.warp = normalizeTextWarp({ type: 'none', bend: 0 });
			clone.name = this.getLayerName(data.text);
			this.normalizeLayer(clone);
			const warped = entry.warpedGlyphs?.[piece.index];
			let x = piece.glyph.x, y = piece.glyph.baseline;
			if (warped) { x = warped.placement.x - piece.glyph.advance / 2 * Math.cos(warped.placement.rotation); y = warped.placement.y - piece.glyph.advance / 2 * Math.sin(warped.placement.rotation); clone.transform.rotation += warped.placement.rotation * 180 / Math.PI; clone.transform.scale.y *= warped.placement.scaleY; }
			const local = { x: x + entry.layoutOffsetX - entry.width / 2, y: y + entry.layoutOffsetY - entry.height / 2 };
			this.setTextOriginWorldPosition(clone, this.getWorldPointFromLocal(layer.transform, local));
			return clone;
		});
		const index = manager.layers.indexOf(layer);
		manager.deleteLayer(layer.id, { skipHistory: true });
		manager.layers.splice(index, 0, ...clones.slice().reverse());
		manager.setSelection(clones.map(clone => clone.id), { activeLayerId: clones[0].id });
		manager.renderLayersList(); manager.reorderLayers();
		this.editor.saveState('Split text'); this.editor.requestPreviewUpdate();
		this.editor.updateStatus(`Split into ${clones.length} ${mode}.${layer.textData.textBackground?.enabled ? ' Each piece has its own background plate.' : ''}`);
	}
};

'use strict';

function createTextAt(editor, options = {}) {
	const position = options.position || { x: editor.originalCanvas.width / 2, y: editor.originalCanvas.height / 2 };
	const placeholder = options.text === undefined;
	const layer = editor.layerManager.addLayer(LayerType.TEXT_GLITTER, { skipHistory: true, textLayer: { ...options, text: placeholder ? CONFIG.tools.text.placeholderText : options.text, position, align: 'left' } });
	if (!layer) return null;
	editor.finishLayerCreation(layer);
	const manager = editor.textGlitterManager;
	const placeText = () => {
		const entry = manager.getMeasurementEntry(layer);
		if (layer.textData.boxMode === 'point') manager.setTextOriginWorldPosition(layer, position, entry);
		else manager.setWorldPointFromLocal(layer.transform, { x: entry.layoutOffsetX - entry.width / 2, y: entry.layoutOffsetY - entry.height / 2 }, position);
	};
	placeText();
	manager.beginTextEdit(layer, { created: true, selectAll: placeholder });
	FontLibrary.ensureLoaded(layer.textData.fontId).then(() => {
		if (!editor.layers.includes(layer)) return;
		placeText();
		manager.renderTextSelection();
	}).catch(error => manager.reportFontLoadError(error));
	return layer;
}

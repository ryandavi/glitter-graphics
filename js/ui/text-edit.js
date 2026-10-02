// Edit sessions are UI state; export reads only the layer and its layout.
const TEXT_EDIT_METHODS = {
	setupTextEditing() {
		this.editSession = null;
		this.textProxy = document.createElement('textarea');
		this.textProxy.id = 'canvasTextInput';
		this.textProxy.className = 'text-input-proxy ui-ignore-gestures';
		this.textProxy.spellcheck = false;
		// Native maxlength counts UTF-16 units; the shared edit path limits graphemes.
		this.textProxy.dataset.maxGraphemes = CONFIG.tools.text.maxTextLength;
		this.ui.textInput?.removeAttribute('maxlength');
		this.textProxy.setAttribute('aria-label', 'Edit canvas text');
		this.textProxy.hidden = true;
		this.editor.previewContainer.appendChild(this.textProxy);
		let composing = false;
		this.textProxy.addEventListener('compositionstart', () => { composing = true; });
		this.textProxy.addEventListener('compositionend', () => { composing = false; this.writeProxyText(); });
		this.textProxy.addEventListener('input', () => { if (!composing) this.writeProxyText(); });
		for (const type of ['select', 'keyup', 'click']) this.textProxy.addEventListener(type, () => this.readTextSelection(this.textProxy));
		this.textProxy.addEventListener('keydown', event => {
			if (event.isComposing) return;
			if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.endTextEdit(); }
			if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
				event.preventDefault();
				this.moveTextCaretVertically(event.key === 'ArrowUp' ? -1 : 1, event.shiftKey);
			}
		});
		this.ui.textInput?.addEventListener('focus', () => {
			const layer = this.getActiveTextLayer();
			if (layer && !this.editSession) this.beginTextEdit(layer, { focus: false });
		});
		this.ui.textInput?.addEventListener('keydown', event => {
			if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); this.endTextEdit(); }
		});
		this.ui.textInput?.addEventListener('select', () => this.readTextSelection(this.ui.textInput));
		document.addEventListener('pointerdown', event => {
			if (!this.editSession) return;
			const layer = this.editor.layerManager.getLayerById(this.editSession.layerId);
			if (event.target.closest('.transform-handle-wrapper, .transform-handles') && !this.isTextEditTarget(layer, event.target)) return;
			if (this.isTextEditTarget(layer, event.target) && event.button === 0) {
				event.preventDefault();
				event.stopPropagation();
				const start = this.hitTextBoundary(layer, event.clientX, event.clientY);
				this.setTextSelection(start, start);
				this.textProxy.focus({ preventScroll: true });
				const move = next => { if (next.pointerId === event.pointerId) this.setTextSelection(start, this.hitTextBoundary(layer, next.clientX, next.clientY)); };
				const end = () => { document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', end, true); document.removeEventListener('pointercancel', end, true); };
				document.addEventListener('pointermove', move, true);
				document.addEventListener('pointerup', end, true);
				document.addEventListener('pointercancel', end, true);
				return;
			}
			if (event.target === this.textProxy || event.target === this.ui.textInput || event.target.closest('#textSettingsSection, #textEditControls, .app-menu-popover')) return;
			this.endTextEdit();
		}, true);
		document.addEventListener('dblclick', event => {
			if (this.editor.currentTool !== ToolType.SELECT) return;
			const layer = this.editor.layerManager.getActiveLayer();
			if (layer?.type !== LayerType.TEXT_GLITTER || !this.isTextEditTarget(layer, event.target)) return;
			this.beginTextEdit(layer);
			if (!this.editSession) return;
			event.preventDefault(); event.stopPropagation();
			const index = this.hitTextBoundary(layer, event.clientX, event.clientY);
			const text = layer.textData.text;
			let start = index, end = index;
			while (start > 0 && !/\s/u.test(text[start - 1])) start--;
			while (end < text.length && !/\s/u.test(text[end])) end++;
			this.setTextSelection(start, end);
		}, true);
		window.visualViewport?.addEventListener('resize', () => this.syncTextKeyboardViewport());
		window.visualViewport?.addEventListener('scroll', () => this.syncTextKeyboardViewport());
	},
	isTextEditTarget(layer, target) {
		return Boolean(this.layerElements.get(layer?.id)?.contains(target) || (target.closest('[data-handle-type="move"]') && target.closest('.transform-handles')?.dataset.layerId === layer?.id));
	},
	beginTextEdit(layer, { focus = true, selectAll = false, created = false } = {}) {
		if (layer?.type !== LayerType.TEXT_GLITTER || !this.editor.canEditLayer(layer, { notify: true })) return;
		if (this.editSession?.layerId !== layer.id) {
			this.endTextEdit();
			this.editSession = { layerId: layer.id, selectionStart: layer.textData.text.length, selectionEnd: layer.textData.text.length, initialText: layer.textData.text, created, dirty: false, coalesceKey: `textEdit:${layer.id}:${performance.now()}` };
		}
		this.textProxy.value = layer.textData.text;
		this.textProxy.hidden = !CONFIG.tools.text.canvasEditing;
		this.setTextSelection(selectAll ? 0 : this.editSession.selectionStart, selectAll ? layer.textData.text.length : this.editSession.selectionEnd);
		this.renderLayer(layer);
		this.editor.updateContextToolbars();
		this.syncTextKeyboardViewport();
		if (focus) {
			if (CONFIG.tools.text.canvasEditing) this.textProxy.focus({ preventScroll: true });
			else this.focusTextInput(selectAll);
		}
	},
	endTextEdit() {
		const session = this.editSession;
		if (!session) return;
		const layer = this.editor.layerManager.getLayerById(session.layerId);
		this.editSession = null;
		clearTimeout(this.textInputTimer);
		this.textProxy.hidden = true;
		this.textProxy.blur();
		document.getElementById('textEditControls')?.style.removeProperty('bottom');
		this.layerElements.get(session.layerId)?.querySelector('.text-edit-overlay')?.remove();
		if (layer) {
			if (!layer.textData.text.trim()) this.editor.layerManager.deleteLayer(layer.id, { skipHistory: true });
			if (session.created || session.dirty || session.initialText !== layer.textData.text || !layer.textData.text.trim()) this.editor.saveState('Edit text', { coalesceKey: session.coalesceKey });
		}
		this.editor.updateContextToolbars();
		this.editor.requestPreviewUpdate();
	},
	applyTextEdit(layer, value, selection = null) {
		if (!layer || !this.editor.canEditLayer(layer)) return;
		value = clampTextLength(value, CONFIG.tools.text.maxTextLength);
		this.preparePendingAnchorPreservation(layer);
		layer.textData.text = value;
		layer.name = this.getLayerName(value);
		for (const input of [this.ui.textInput, this.textProxy]) if (input && input.value !== value) input.value = value;
		if (selection && this.editSession?.layerId === layer.id) this.setTextSelection(Math.min(value.length, selection.start), Math.min(value.length, selection.end));
		this.applyPointAnchorSnapshot(layer, layer._pendingPointAnchorSnapshot);
		this.editor.requestPreviewUpdate();
		this.editor.layerManager.renderLayersList();
		this.editor.updateActionButtons();
		this.scheduleTextCommit(layer);
	},
	writeProxyText() {
		const layer = this.editor.layerManager.getLayerById(this.editSession?.layerId);
		this.applyTextEdit(layer, this.textProxy.value, { start: this.textProxy.selectionStart, end: this.textProxy.selectionEnd });
	},
	readTextSelection(input) {
		if (!this.editSession) return;
		this.editSession.selectionStart = input.selectionStart;
		this.editSession.selectionEnd = input.selectionEnd;
		this.renderTextSelection();
	},
	setTextSelection(start, end) {
		if (!this.editSession) return;
		const direction = start > end ? 'backward' : 'forward';
		this.editSession.selectionStart = Math.min(start, end);
		this.editSession.selectionEnd = Math.max(start, end);
		this.textProxy.setSelectionRange(Math.min(start, end), Math.max(start, end), direction);
		this.ui.textInput?.setSelectionRange(Math.min(start, end), Math.max(start, end), direction);
		this.renderTextSelection();
	},
	getTextBoundaries(layer) {
		const entry = this.getMeasurementEntry(layer);
		const glyphs = entry.layout.glyphs;
		const boundaries = [];
		glyphs.forEach((glyph, index) => {
			const warped = entry.warpedGlyphs?.[index];
			const rotation = warped?.placement.rotation || 0;
			const x = warped ? warped.placement.x - glyph.advance / 2 * Math.cos(rotation) : glyph.x;
			const y = warped ? warped.placement.y - glyph.advance / 2 * Math.sin(rotation) : glyph.baseline;
			boundaries.push({ index: glyph.sourceIndex, x, y, line: glyph.line, rotation: warped?.placement.rotation || 0, scaleY: warped?.placement.scaleY || 1 });
			boundaries.push({ index: glyph.sourceEnd, x: x + glyph.advance * Math.cos(rotation), y: y + glyph.advance * Math.sin(rotation), line: glyph.line, rotation: warped?.placement.rotation || 0, scaleY: warped?.placement.scaleY || 1 });
		});
		entry.layout.visibleLines.forEach((line, index) => {
			const last = boundaries.filter(boundary => boundary.line === index).at(-1);
			const next = entry.layout.lines[index + 1];
			if (last && next) {
				let offset = line.sourceEnd;
				for (const char of splitGraphemes(layer.textData.text.slice(offset, next.sourceStart))) { boundaries.push({ ...last, index: offset }); offset += char.length; }
			}
			if (!line.text) boundaries.push({ index: line.sourceStart, x: 0, y: entry.contentOffsetY + entry.ascent + index * entry.lineHeightPx, line: index, rotation: 0, scaleY: 1 });
		});
		if (!boundaries.length) boundaries.push({ index: 0, x: 0, y: entry.ascent, line: 0, rotation: 0, scaleY: 1 });
		return boundaries;
	},
	hitTextBoundary(layer, clientX, clientY) {
		const entry = this.getMeasurementEntry(layer);
		const point = this.editor.viewport.screenToCanvas(clientX, clientY);
		const transform = getLayerTransform(layer);
		const angle = -transform.rotation * Math.PI / 180;
		const dx = point.x - transform.position.x, dy = point.y - transform.position.y;
		const x = (dx * Math.cos(angle) - dy * Math.sin(angle)) / (transform.scale.x / 100 * (transform.flipX ? -1 : 1)) + entry.width / 2 - entry.layoutOffsetX;
		const y = (dx * Math.sin(angle) + dy * Math.cos(angle)) / (transform.scale.y / 100 * (transform.flipY ? -1 : 1)) + entry.height / 2 - entry.layoutOffsetY;
		let boundaries = this.getTextBoundaries(layer);
		if (!entry.warpedGlyphs) {
			const nearest = boundaries.reduce((best, boundary) => Math.abs(boundary.y - entry.ascent / 2 - y) < Math.abs(best.y - entry.ascent / 2 - y) ? boundary : best);
			boundaries = boundaries.filter(boundary => boundary.line === nearest.line);
		}
		const distance = boundary => Math.hypot(boundary.x + entry.ascent / 2 * Math.sin(boundary.rotation) - x, boundary.y - entry.ascent / 2 * Math.cos(boundary.rotation) - y);
		return boundaries.sort((a, b) => distance(a) - distance(b))[0].index;
	},
	moveTextCaretVertically(direction, extend) {
		const layer = this.editor.layerManager.getLayerById(this.editSession?.layerId);
		if (!layer) return;
		const boundaries = this.getTextBoundaries(layer);
		const backwards = this.textProxy.selectionDirection === 'backward';
		const focus = backwards ? this.textProxy.selectionStart : this.textProxy.selectionEnd;
		const anchor = backwards ? this.textProxy.selectionEnd : this.textProxy.selectionStart;
		const current = boundaries.find(boundary => boundary.index === focus) || boundaries.at(-1);
		const target = boundaries.filter(boundary => boundary.line === current.line + direction).sort((a, b) => Math.abs(a.x - current.x) - Math.abs(b.x - current.x))[0];
		if (target) this.setTextSelection(extend ? anchor : target.index, target.index);
	},
	syncTextKeyboardViewport() {
		if (!this.editSession || !this.editor.mobileManager?.isMobile) return;
		this.renderTextSelection();
		const viewport = window.visualViewport;
		if (!viewport) return;
		const container = this.editor.previewContainer.getBoundingClientRect();
		const occluded = Math.max(0, container.bottom - viewport.offsetTop - viewport.height);
		const toolbar = document.getElementById('textEditControls');
		if (toolbar) toolbar.style.bottom = `calc(${occluded}px + var(--mobile-floating-inset))`;
		const caret = this.layerElements.get(this.editSession.layerId)?.querySelector('.text-edit-caret')?.getBoundingClientRect();
		if (!caret) return;
		const safeTop = Math.max(container.top, viewport.offsetTop);
		const safeBottom = Math.min(container.bottom, viewport.offsetTop + viewport.height) - (toolbar?.offsetHeight || 0);
		if (caret.bottom > safeBottom) this.editor.viewport.panBy(0, safeBottom - caret.bottom);
		else if (caret.top < safeTop) this.editor.viewport.panBy(0, safeTop - caret.top);
	},

	renderTextSelection() {
		const session = this.editSession;
		const layer = this.editor.layerManager.getLayerById(session?.layerId);
		const wrapper = this.layerElements.get(layer?.id);
		if (!layer || !wrapper || !CONFIG.tools.text.canvasEditing) return;
		const entry = this.getMeasurementEntry(layer);
		let overlay = wrapper.querySelector('.text-edit-overlay');
		if (!overlay) { overlay = document.createElement('div'); overlay.className = 'text-edit-overlay ui-ignore-gestures'; wrapper.appendChild(overlay); }
		overlay.replaceChildren();
		const boundaries = this.getTextBoundaries(layer);
		const caret = boundaries.find(boundary => boundary.index === (this.textProxy.selectionDirection === 'backward' ? session.selectionStart : session.selectionEnd)) || boundaries.at(-1);
		const addRect = (className, x, y, width, height, rotation = 0) => {
			const rect = document.createElement('span'); rect.className = className;
			Object.assign(rect.style, { left: `${entry.layoutOffsetX + x}px`, top: `${entry.layoutOffsetY + y}px`, width: `${width}px`, height: `${height}px`, transform: `rotate(${rotation}rad)`, transformOrigin: `0 ${height * entry.ascent / (entry.ascent + entry.descent)}px` });
			overlay.appendChild(rect);
		};
		if (session.selectionStart === session.selectionEnd) addRect('text-edit-caret', caret.x, caret.y - entry.ascent * caret.scaleY, 1, (entry.ascent + entry.descent) * caret.scaleY, caret.rotation);
		else entry.layout.visibleLines.forEach((line, lineIndex) => {
			const selected = entry.layout.glyphs.filter(glyph => glyph.line === lineIndex && glyph.sourceEnd > session.selectionStart && glyph.sourceIndex < session.selectionEnd);
			if (!selected.length) return;
			if (entry.warpedGlyphs) selected.forEach(glyph => {
				const boundary = boundaries.find(item => item.index === glyph.sourceIndex);
				addRect('text-edit-selection', boundary.x, boundary.y - entry.ascent * boundary.scaleY, glyph.advance, (entry.ascent + entry.descent) * boundary.scaleY, boundary.rotation);
			});
			else addRect('text-edit-selection', selected[0].x, selected[0].baseline - entry.ascent, selected.at(-1).x + selected.at(-1).advance - selected[0].x, entry.ascent + entry.descent);
		});
		const caretRect = overlay.lastElementChild?.getBoundingClientRect();
		const containerRect = this.editor.previewContainer.getBoundingClientRect();
		if (caretRect) { this.textProxy.style.left = `${caretRect.left - containerRect.left}px`; this.textProxy.style.top = `${caretRect.top - containerRect.top}px`; }
	}
};

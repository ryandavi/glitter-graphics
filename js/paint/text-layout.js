// Shared text-local layout; contexts are supplied by the caller.
const TextLayout = {
	getAlignOffset(align, maxWidth, lineWidth) {
		if (align === 'center') return (maxWidth - lineWidth) / 2;
		if (align === 'right') return maxWidth - lineWidth;
		return 0;
	},
	getVerticalAlignOffset(verticalAlign, boxHeight, contentHeight) {
		if (verticalAlign === 'middle') {
			return Math.max(0, (boxHeight - contentHeight) / 2);
		}
		if (verticalAlign === 'bottom') {
			return Math.max(0, boxHeight - contentHeight);
		}
		return 0;
	},
	measureLine(ctx, text, letterSpacing, fontSize) {
		if (!text) {
			return { text, width: 0, ascent: 0, descent: 0, inkLeft: 0, inkRight: 0 };
		}

		const lineMetrics = ctx.measureText(text);
		const ascent = lineMetrics.actualBoundingBoxAscent ?? fontSize * 0.8;
		const descent = lineMetrics.actualBoundingBoxDescent ?? fontSize * 0.2;

		if (!letterSpacing) {
			return {
				text,
				width: lineMetrics.width,
				ascent,
				descent,
				inkLeft: lineMetrics.actualBoundingBoxLeft ?? 0,
				inkRight: lineMetrics.actualBoundingBoxRight ?? lineMetrics.width
			};
		}

		let advance = 0;
		let minX = Infinity;
		let maxX = -Infinity;
		const chars = splitGraphemes(text);
		for (let index = 0; index < chars.length; index++) {
			const charMetrics = ctx.measureText(chars[index]);
			minX = Math.min(minX, advance - (charMetrics.actualBoundingBoxLeft ?? 0));
			maxX = Math.max(maxX, advance + (charMetrics.actualBoundingBoxRight ?? charMetrics.width));
			advance += charMetrics.width;
			if (index < chars.length - 1) {
				advance += letterSpacing;
			}
		}

		return { text, width: advance, ascent, descent, inkLeft: -minX, inkRight: maxX };
	},
	wrapTextLines(ctx, sourceLines, boxWidth, letterSpacing, fontSize) {
		const wrappedLines = [];

		sourceLines.forEach((sourceLine) => {
			if (sourceLine === '') {
				wrappedLines.push(this.measureLine(ctx, '', letterSpacing, fontSize));
				return;
			}

			const tokens = sourceLine.split(/(\s+)/);
			let current = '';

			const pushMeasured = (value) => {
				wrappedLines.push(this.measureLine(ctx, value, letterSpacing, fontSize));
			};

			for (const token of tokens) {
				if (token === '') continue;

				const candidate = current + token;
				if (this.measureLine(ctx, candidate, letterSpacing, fontSize).width <= boxWidth) {
					current = candidate;
					continue;
				}

				if (/^\s+$/.test(token)) {
					pushMeasured(current.trimEnd());
					current = '';
					continue;
				}

				if (current.trim().length > 0) {
					pushMeasured(current.trimEnd());
					current = '';
				}

				let remaining = token;
				while (remaining) {
					let slice = '';
					let consumed = 0;
					let offset = 0;
					for (const char of splitGraphemes(remaining)) {
						const next = slice + char;
						const width = this.measureLine(ctx, next, letterSpacing, fontSize).width;
						if (slice && width > boxWidth) {
							break;
						}
						slice = next;
						offset += char.length;
						consumed = offset;
						if (width > boxWidth) {
							break;
						}
					}

					if (!slice) {
						slice = splitGraphemes(remaining)[0];
						consumed = slice.length;
					}

					const rest = remaining.slice(consumed);
					if (rest) {
						pushMeasured(slice);
						remaining = rest;
					} else {
						current = slice;
						remaining = '';
					}
				}
			}

			if (current || wrappedLines.length === 0) {
				pushMeasured(current.trimEnd());
			}
		});

		return { lines: wrappedLines };
	},
	layoutWarpedTextGlyphs(ctx, lines, options) {
		const { warp, ascent, fontSize, inkRect } = options;
		const glyphs = options.glyphs.map(glyph => {
			const metric = ctx.measureText(glyph.char);
			const ink = { left: -glyph.advance / 2 - (metric.actualBoundingBoxLeft ?? 0), right: -glyph.advance / 2 + (metric.actualBoundingBoxRight ?? glyph.advance), top: -(metric.actualBoundingBoxAscent ?? fontSize * 0.8), bottom: metric.actualBoundingBoxDescent ?? fontSize * 0.2 };
			return { ...glyph, x: glyph.x + glyph.advance / 2, y: glyph.baseline, ink: /^\s+$/u.test(glyph.char) ? null : ink };
		});
		const metrics = this.getWarpMetrics(inkRect, fontSize, ascent);
		const placements = layoutWarpedGlyphs(warp, glyphs, metrics);
		// An envelope bends a glyph's own edges, so its box comes from the
		// envelope, not from the per-letter placement.
		const envelope = hasWarpEnvelope(warp);
		const getBounds = (glyph, index) => (envelope
			? getEnvelopeWarpBounds(warp, { left: glyph.x + glyph.ink.left, top: glyph.y + glyph.ink.top, right: glyph.x + glyph.ink.right, bottom: glyph.y + glyph.ink.bottom }, metrics)
			: getWarpedGlyphBounds(placements[index], glyph.ink));
		return glyphs.map((glyph, index) => ({
			char: glyph.char,
			advance: glyph.advance,
			line: glyph.line,
			placement: placements[index],
			bounds: glyph.ink ? getBounds(glyph, index) : null
		}));
	},
	// The flat ink block a warp bends (js/paint/text-warp.js).
	getWarpMetrics(inkRect, fontSize, ascent) {
		return {
			centerX: (inkRect.left + inkRect.right) / 2,
			centerY: (inkRect.top + inkRect.bottom) / 2,
			width: inkRect.right - inkRect.left,
			height: inkRect.bottom - inkRect.top,
			fontSize,
			ascent
		};
	}
};

// Source ranges use the raw string even when case conversion expands a glyph.
TextLayout.layout = function(ctx, text, data, options) {
	const { fontSize, letterSpacing, lineHeightPx, ascent, descent, minBoxSize } = options;
	const source = getTextContent(text, data.textCase);
	const display = source.map(glyph => glyph.char).join('');
	const stacked = data.orientation === 'stacked';
	const boxed = data.boxMode !== 'point';
	const layoutWidth = boxed ? Math.max(minBoxSize, Math.round(data.boxWidth || minBoxSize)) : null;
	let lines = stacked ? [] : boxed ? this.wrapTextLines(ctx, display.split('\n'), layoutWidth, letterSpacing, fontSize).lines : display.split('\n').map(line => this.measureLine(ctx, line, letterSpacing, fontSize));
	let stackWidth = 0;
	let stackRows = 0;
	if (stacked) {
		const columns = [[]];
		for (const glyph of source) {
			if (glyph.char === '\n') columns.push([]);
			else columns.at(-1).push(glyph);
		}
		lines = [];
		let emptyStart = 0;
		columns.forEach((column, columnIndex) => {
			const measured = column.map(glyph => ({ ...this.measureLine(ctx, glyph.char, 0, fontSize), displayStart: glyph.displayIndex, sourceStart: glyph.sourceIndex, sourceEnd: glyph.sourceEnd }));
			const columnWidth = measured.length ? Math.max(...measured.map(line => line.width)) : ctx.measureText('M').width;
			if (!measured.length) {
				const sourceIndex = source.find(glyph => glyph.displayIndex === emptyStart)?.sourceIndex ?? text.length;
				measured.push({ ...this.measureLine(ctx, '', 0, fontSize), displayStart: emptyStart, sourceStart: sourceIndex, sourceEnd: sourceIndex });
			}
			measured.forEach((line, row) => lines.push({ ...line, row, column: columnIndex, columnX: stackWidth, columnWidth }));
			stackWidth += columnWidth + (columnIndex < columns.length - 1 ? Math.max(0, letterSpacing) : 0);
			stackRows = Math.max(stackRows, measured.length);
			emptyStart = (column.at(-1)?.displayIndex ?? emptyStart) + (column.at(-1)?.char.length ?? 0) + 1;
		});
	}
	let cursor = 0;
	lines.forEach((line, index) => {
		const found = display.indexOf(line.text, cursor);
		line.displayStart = stacked ? line.displayStart : found < 0 ? cursor : found;
		cursor = line.displayStart + line.text.length;
		const nextBreak = display.indexOf('\n', cursor);
		line.wrapped = !stacked && boxed && index < lines.length - 1 && (nextBreak < 0 || /\S/u.test(display.slice(cursor, nextBreak)));
		const first = source.find(glyph => glyph.displayIndex >= line.displayStart);
		const last = source.filter(glyph => glyph.displayIndex < cursor).at(-1);
		line.sourceStart = stacked ? line.sourceStart : first?.sourceIndex ?? text.length;
		line.sourceEnd = stacked ? line.sourceEnd : last?.sourceEnd ?? line.sourceStart;
		if (display[cursor] === '\n') cursor++;
	});
	const width = layoutWidth ?? (stacked ? stackWidth : lines.reduce((max, line) => Math.max(max, line.width), 0));
	const contentHeight = ascent + descent + lineHeightPx * Math.max((stacked ? stackRows : lines.length) - 1, 0);
	const height = data.boxMode === 'fixed' ? Math.max(minBoxSize, Math.round(data.boxHeight || minBoxSize)) : contentHeight;
	const fittingLines = data.boxMode === 'fixed' ? lines.filter((line, index) => ascent + (stacked ? line.row : index) * lineHeightPx + line.descent <= height && (!stacked || line.columnX + line.columnWidth <= width)) : lines;
	const visibleLines = stacked ? fittingLines : lines.slice(0, fittingLines.length);
	const visible = visibleLines.length;
	let offsetY = 0;
	if (data.boxMode === 'fixed' && visible) {
		const top = Math.min(...visibleLines.map((line, index) => ascent + (stacked ? line.row : index) * lineHeightPx - line.ascent));
		const bottom = Math.max(...visibleLines.map((line, index) => ascent + (stacked ? line.row : index) * lineHeightPx + line.descent));
		offsetY = this.getVerticalAlignOffset(data.verticalAlign, height, bottom - top) - top;
	}
	const glyphs = [];
	const runs = [];
	const decorations = [];
	visibleLines.forEach((line, lineIndex) => {
		const baseline = offsetY + ascent + (stacked ? line.row : lineIndex) * lineHeightPx;
		const startX = stacked ? this.getAlignOffset(data.align, width, stackWidth) + line.columnX + (line.columnWidth - line.width) / 2 : this.getAlignOffset(data.align, width, line.width);
		line.x = startX;
		line.baseline = baseline;
		const firstGlyph = glyphs.length;
		const chars = splitGraphemes(line.text);
		const gaps = (line.text.match(/\s+/gu) || []).length;
		const justify = data.align === 'justify' && boxed && line.wrapped && gaps > 0;
		const extra = justify ? Math.max(0, width - line.width) / gaps : 0;
		let x = startX;
		let displayOffset = line.displayStart;
		let prefix = '';
		let inGap = false;
		chars.forEach((char, index) => {
			const metric = ctx.measureText(char);
			if (!letterSpacing && !isTextWarpActive(data.warp) && !justify) x = startX + ctx.measureText(prefix + char).width - metric.width;
			const mapping = source.find(item => item.displayIndex === displayOffset);
			glyphs.push({ char, x, y: baseline, baseline, advance: metric.width, line: lineIndex, sourceIndex: mapping?.sourceIndex ?? line.sourceStart, sourceEnd: mapping?.sourceEnd ?? line.sourceEnd,
				ink: { left: x - (metric.actualBoundingBoxLeft ?? 0), right: x + (metric.actualBoundingBoxRight ?? metric.width), top: baseline - (metric.actualBoundingBoxAscent ?? fontSize * 0.8), bottom: baseline + (metric.actualBoundingBoxDescent ?? fontSize * 0.2) } });
			if (letterSpacing || isTextWarpActive(data.warp)) runs.push({ text: char, x, baseline, line: lineIndex });
			x += metric.width + (index < chars.length - 1 ? letterSpacing : 0);
			if (justify && /\s/u.test(char) && !inGap) x += extra;
			inGap = /\s/u.test(char);
			prefix += char;
			displayOffset += char.length;
		});
		if (!letterSpacing && !isTextWarpActive(data.warp)) {
			if (justify) {
				let wordX = startX;
				let glyphIndex = firstGlyph;
				for (const token of line.text.split(/(\s+)/u)) {
					if (!token) continue;
					let wordPrefix = '';
					for (const char of splitGraphemes(token)) {
						const glyph = glyphs[glyphIndex++];
						const nextX = wordX + ctx.measureText(wordPrefix + char).width - glyph.advance;
						const shift = nextX - glyph.x; glyph.x = nextX; glyph.ink.left += shift; glyph.ink.right += shift;
						wordPrefix += char;
					}
					if (/^\s+$/u.test(token)) wordX += ctx.measureText(token).width + extra;
					else { runs.push({ text: token, x: wordX, baseline, line: lineIndex }); wordX += ctx.measureText(token).width; }
				}
			} else runs.push({ text: line.text, x: startX, baseline, line: lineIndex });
		}
		if (justify) { line.width = width; line.inkRight += width - ctx.measureText(line.text).width; }
		const ratios = CONFIG.tools.text.decoration;
		for (const kind of ['underline', 'strikethrough']) if (data.decoration?.[kind] && line.text) decorations.push({ x: startX, y: baseline + fontSize * ratios[kind], width: justify ? width : line.width, height: Math.max(1, fontSize * ratios.thickness), line: lineIndex });
	});
	return { lines, visibleLines, glyphs, runs, decorations, contentWidth: stacked ? stackWidth : Math.max(0, ...lines.map(line => line.width)), contentHeight, layoutWidth: width, layoutHeight: height, contentOffsetY: offsetY, hasOverflow: visible < lines.length };
};

TextLayout.warpDecorations = function(layout, glyphs, letterSpacing) {
	return layout.glyphs.flatMap((glyph, index) => layout.decorations.filter(rect => rect.line === glyph.line).map(rect => {
		const ink = { left: -glyph.advance / 2, right: glyph.advance / 2 + letterSpacing, top: rect.y - glyph.baseline, bottom: rect.y - glyph.baseline + rect.height };
		const placement = glyphs[index].placement;
		return { x: ink.left, y: ink.top, width: ink.right - ink.left, height: rect.height, line: glyph.line, placement, bounds: getWarpedGlyphBounds(placement, ink) };
	}));
};
TextLayout.drawDecorations = function(ctx, rectangles, offsetX, offsetY) {
	rectangles.forEach(rect => {
		ctx.save();
		if (rect.placement) { ctx.translate(offsetX + rect.placement.x, offsetY + rect.placement.y); ctx.rotate(rect.placement.rotation); ctx.scale(1, rect.placement.scaleY); ctx.fillRect(rect.x, rect.y, rect.width, rect.height); }
		else ctx.fillRect(offsetX + rect.x, offsetY + rect.y, rect.width, rect.height);
		ctx.restore();
	});
};

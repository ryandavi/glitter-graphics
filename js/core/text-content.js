// Text indexes remain UTF-16 offsets for native textarea selection.
const TEXT_SEGMENTER = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
function splitGraphemes(text) {
	return TEXT_SEGMENTER ? Array.from(TEXT_SEGMENTER.segment(String(text)), part => part.segment) : Array.from(String(text));
}
function clampTextLength(text, max) {
	return splitGraphemes(text).slice(0, max).join('');
}
function getTextContent(text, mode) {
	const content = [];
	let letter = 0, sourceIndex = 0, displayIndex = 0;
	let wordStart = true;
	for (const raw of splitGraphemes(text)) {
		let value = raw;
		if (mode === 'upper') value = raw.toLocaleUpperCase();
		if (mode === 'lower') value = raw.toLocaleLowerCase();
		if (mode === 'title' && wordStart) value = raw.toLocaleUpperCase();
		if (mode === 'alternating' && /\p{L}/u.test(raw)) value = letter++ % 2 ? raw.toLocaleUpperCase() : raw.toLocaleLowerCase();
		for (const char of splitGraphemes(value)) {
			content.push({ char, sourceIndex, sourceEnd: sourceIndex + raw.length, displayIndex });
			displayIndex += char.length;
		}
		sourceIndex += raw.length;
		wordStart = /\s/u.test(raw);
	}
	return content;
}
function applyTextCase(text, mode) {
	return getTextContent(text, mode).map(glyph => glyph.char).join('');
}
function isEmojiCandidate(char) {
	return /\p{Extended_Pictographic}|\p{Regional_Indicator}{2}/u.test(char);
}

const COLOR_GLYPH_CACHE = new Map();
function isColorTextGlyph(ctx, char, font) {
	if (!isEmojiCandidate(char)) return false;
	const key = `${font}|${char}`;
	if (COLOR_GLYPH_CACHE.has(key)) return COLOR_GLYPH_CACHE.get(key);
	ctx.font = font;
	ctx.textBaseline = 'alphabetic';
	const draw = color => {
		ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		ctx.fillStyle = color;
		ctx.fillText(char, CONFIG.tools.text.colorGlyphProbe.x, CONFIG.tools.text.colorGlyphProbe.baseline);
		return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data;
	};
	const first = draw('#ff0000'), second = draw('#0000ff');
	const colored = first.some((value, index) => index % 4 === 3 && value > 0) && first.every((value, index) => value === second[index]);
	COLOR_GLYPH_CACHE.set(key, colored);
	return colored;
}

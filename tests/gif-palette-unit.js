'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const context = { Map, Math, Number };
vm.createContext(context);
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'classes', 'GifPalette.js'), 'utf8');
vm.runInContext(`${source}\nglobalThis.GifPaletteExport = GifPalette;`, context);
const GifPalette = context.GifPaletteExport;

function frame(colors) {
	const data = new Uint8ClampedArray(colors.length * 4);
	colors.forEach((color, index) => data.set([...color, 255], index * 4));
	return { data, width: colors.length, height: 1 };
}

const key = 0xff00ff;
const palette = GifPalette.build([
	frame([[255, 0, 255], [255, 0, 0], [0, 255, 0]]),
	frame([[255, 0, 255], [0, 0, 255], [255, 255, 0]])
], 4, { transparentColor: key });
if (palette.length > 12) throw new Error('Palette exceeded requested color count.');
if (palette.slice(0, 3).join(',') !== '255,0,255') throw new Error('Transparency key was not reserved exactly.');
if (GifPalette.resolveColorCount(64) !== 64 || GifPalette.resolveColorCount('auto', { observedColorCount: 100 }) !== 128) {
	throw new Error('Color-count selection failed.');
}
const webSafe = GifPalette.build([frame([[17, 83, 149], [242, 118, 33]])], 32, { style: 'websafe' });
if (!webSafe.every((channel) => channel % 51 === 0)) throw new Error('Web-safe palette contains a non-web-safe channel.');
console.log('PASS shared GIF palette fixtures: limits, automatic sizing, and transparency reservation.');

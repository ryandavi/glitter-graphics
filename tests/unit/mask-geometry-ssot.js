'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SHARED_GEOMETRY = [
	'createMaskDifferenceCanvas', 'createDilatedMaskCanvas', 'createErodedMaskCanvas', 'createOffsetMaskCanvas',
	'getMorphOffsets', 'getBorderPlacement', 'getBorderEdgeStyle', 'getBorderDrawOrder'
];

// Mask morphology and border option parsing live only in mask-geometry.js:
// no layer manager or exporter may define (or wrap) its own copy.
function listJs(directory) {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const target = path.join(directory, entry.name);
		if (entry.isDirectory()) return entry.name === 'vendor' ? [] : listJs(target);
		return entry.name.endsWith('.js') ? [target] : [];
	});
}
listJs(path.join(ROOT, 'js'))
	.filter((file) => !file.endsWith(path.join('paint', 'mask-geometry.js')))
	.forEach((file) => {
		const source = fs.readFileSync(file, 'utf8');
		SHARED_GEOMETRY.forEach((name) => {
			const definition = new RegExp(`(?:^|\\n)(?:function\\s+|\\t+_?)${name}\\([^)]*\\)\\s*\\{`);
			assert(!definition.test(source), `${path.relative(ROOT, file)} redefines ${name}; call the mask-geometry.js function`);
		});
	});

process.stdout.write('PASS mask geometry delegates to one implementation\n');

const createCanvas = () => {
	const canvas = { width: 0, height: 0, pixels: new Uint8Array() };
	const ensurePixels = () => {
		if (canvas.pixels.length !== canvas.width * canvas.height) {
			canvas.pixels = new Uint8Array(canvas.width * canvas.height);
		}
	};
	const context = {
		globalCompositeOperation: 'source-over',
		clearRect: () => {
			ensurePixels();
			canvas.pixels.fill(0);
		},
		drawImage: (source, offsetX, offsetY) => {
			ensurePixels();
			const sourcePixels = source.pixels.slice();
			for (let y = 0; y < canvas.height; y++) {
				for (let x = 0; x < canvas.width; x++) {
					const sourceX = x - offsetX;
					const sourceY = y - offsetY;
					const sourceValue = sourceX >= 0 && sourceX < source.width && sourceY >= 0 && sourceY < source.height
						? sourcePixels[sourceY * source.width + sourceX]
						: 0;
					const index = y * canvas.width + x;
					canvas.pixels[index] = context.globalCompositeOperation === 'destination-in'
						? Math.min(canvas.pixels[index], sourceValue)
						: Math.max(canvas.pixels[index], sourceValue);
				}
			}
		}
	};
	canvas.getContext = () => context;
	return canvas;
};
const geometrySource = fs.readFileSync(path.join(ROOT, 'js/paint/mask-geometry.js'), 'utf8');
const geometry = vm.runInNewContext(`${geometrySource}; ({ createDilatedMaskCanvas, createErodedMaskCanvas });`, {
	CONFIG: { rendering: { borderSampling: { minSteps: 16, maxSteps: 64, stepsPerPixel: 4 } } },
	document: { createElement: createCanvas },
	createAppCanvas: createCanvas,
	getOptionValues: () => ['inside', 'center', 'outside'],
	Math,
	Set
});
const sourceCanvas = createCanvas();
sourceCanvas.width = 16;
sourceCanvas.height = 16;
sourceCanvas.getContext().clearRect();
sourceCanvas.pixels[8 * sourceCanvas.width + 8] = 255;
const hardDilation = geometry.createDilatedMaskCanvas(sourceCanvas, 2, 'hard');
const filled = (x, y) => hardDilation.pixels[y * hardDilation.width + x] === 255;
assert(filled(10, 8), 'Hard border must expand two pixels along cardinal directions');
assert(filled(9, 9), 'Hard border must retain diagonal contour steps inside the cross');
assert(!filled(10, 10), 'Hard border must omit square corner pixels outside four-neighbor reach');
assert.strictEqual(hardDilation.pixels.filter(Boolean).length, 13, 'Radius-two hard border must use a Manhattan-distance cross');
process.stdout.write('PASS hard border uses four-neighbor expansion\n');

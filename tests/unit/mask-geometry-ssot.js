'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SHARED_GEOMETRY = [
	'createMaskDifferenceCanvas', 'createOutlineCutoutCanvas', 'createOutlineMaskCanvas', 'createBorderMaskCanvas', 'createDilatedMaskCanvas', 'createErodedMaskCanvas', 'createOffsetMaskCanvas',
	'fillEnclosedMaskAreas', 'getMorphOffsets', 'getBorderPlacement', 'getBorderEdgeStyle', 'getBorderDrawOrder'
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
					if (context.globalCompositeOperation === 'destination-in') {
						canvas.pixels[index] = Math.min(canvas.pixels[index], sourceValue);
					} else if (context.globalCompositeOperation === 'destination-out') {
						canvas.pixels[index] = sourceValue ? 0 : canvas.pixels[index];
					} else {
						canvas.pixels[index] = Math.max(canvas.pixels[index], sourceValue);
					}
				}
			}
		},
		createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
		getImageData: () => {
			ensurePixels();
			const data = new Uint8ClampedArray(canvas.pixels.length * 4);
			canvas.pixels.forEach((alpha, index) => { data[index * 4 + 3] = alpha; });
			return { data, width: canvas.width, height: canvas.height };
		},
		putImageData: (image) => {
			ensurePixels();
			for (let index = 0; index < canvas.pixels.length; index++) canvas.pixels[index] = image.data[index * 4 + 3];
		}
	};
	canvas.getContext = () => context;
	return canvas;
};
const geometrySource = fs.readFileSync(path.join(ROOT, 'js/paint/mask-geometry.js'), 'utf8');
const geometry = vm.runInNewContext(`${geometrySource}; ({ createOutlineMaskCanvas, createDilatedMaskCanvas, createErodedMaskCanvas, fillEnclosedMaskAreas });`, {
	CONFIG: { rendering: { borderSampling: { minSteps: 16, maxSteps: 64, stepsPerPixel: 4 }, maskAlphaThreshold: 128 } },
	document: { createElement: createCanvas },
	createAppCanvas: createCanvas,
	getOptionValues: () => ['inside', 'center', 'outside'],
	shouldUseCrispMaskEdges: () => true,
	Math,
	Set
});
const sourceCanvas = createCanvas();
sourceCanvas.width = 16;
sourceCanvas.height = 16;
sourceCanvas.getContext().clearRect();
sourceCanvas.pixels[8 * sourceCanvas.width + 8] = 255;
const sharpDilation = geometry.createDilatedMaskCanvas(sourceCanvas, 2, 'miter');
assert.strictEqual(sharpDilation.pixels[10 * 16 + 10], 255, 'Sharp dilation must retain square corners');
assert.strictEqual(sharpDilation.pixels.filter(Boolean).length, 25, 'Sharp dilation must fill a square');
const hardDilation = geometry.createDilatedMaskCanvas(sourceCanvas, 2, 'hard');
const filled = (x, y) => hardDilation.pixels[y * hardDilation.width + x] === 255;
assert(filled(10, 8), 'Hard border must expand two pixels along cardinal directions');
assert(filled(9, 9), 'Hard border must retain diagonal contour steps inside the cross');
assert(!filled(10, 10), 'Hard border must omit square corner pixels outside four-neighbor reach');
assert.strictEqual(hardDilation.pixels.filter(Boolean).length, 13, 'Radius-two hard border must use a Manhattan-distance cross');
process.stdout.write('PASS hard border uses four-neighbor expansion\n');

const ring = geometry.createOutlineMaskCanvas(sourceCanvas, 1, 'hard', false);
const backing = geometry.createOutlineMaskCanvas(sourceCanvas, 1, 'hard', true);
assert.strictEqual(ring.pixels[8 * ring.width + 8], 0, 'Outline-only mask must subtract the sticker interior');
assert.strictEqual(ring.pixels[8 * ring.width + 9], 255, 'Outline-only mask must retain the expanded edge');
assert.strictEqual(backing.pixels[8 * backing.width + 8], 255, 'Filled outline mask must retain the sticker interior');
process.stdout.write('PASS sticker backing can fill the outline interior\n');

const counters = createCanvas();
counters.width = 20;
counters.height = 9;
counters.getContext().clearRect();
for (let x = 1; x <= 6; x++) {
	counters.pixels[1 * counters.width + x] = 255;
	counters.pixels[7 * counters.width + x] = 255;
}
for (let y = 1; y <= 7; y++) {
	counters.pixels[y * counters.width + 1] = 255;
	counters.pixels[y * counters.width + 6] = 255;
	counters.pixels[y * counters.width + 10] = 255;
	counters.pixels[y * counters.width + 17] = 255;
}
for (let x = 10; x <= 17; x++) counters.pixels[7 * counters.width + x] = 255;
const enclosed = geometry.createOutlineMaskCanvas(counters, 1, 'hard', false, true);
assert.strictEqual(enclosed.pixels[4 * enclosed.width + 3], 255, 'Closed transparent counters must be filled');
assert.strictEqual(enclosed.pixels[4 * enclosed.width + 13], 0, 'Open concave regions must remain transparent');
process.stdout.write('PASS outline fills only enclosed transparent areas\n');

// The source has a wide open chamber with a one-pixel doorway. The completed
// outline closes that doorway, so enclosure detection must use the generated
// silhouette rather than the source alpha alone.
const postOutlineClosure = createCanvas();
postOutlineClosure.width = 15;
postOutlineClosure.height = 13;
postOutlineClosure.getContext().clearRect();
for (let y = 3; y <= 10; y++) {
	postOutlineClosure.pixels[y * postOutlineClosure.width + 2] = 255;
	postOutlineClosure.pixels[y * postOutlineClosure.width + 12] = 255;
}
for (let x = 2; x <= 12; x++) postOutlineClosure.pixels[10 * postOutlineClosure.width + x] = 255;
for (let x = 2; x <= 6; x++) postOutlineClosure.pixels[3 * postOutlineClosure.width + x] = 255;
for (let x = 8; x <= 12; x++) postOutlineClosure.pixels[3 * postOutlineClosure.width + x] = 255;
const closedByOutline = geometry.createOutlineMaskCanvas(postOutlineClosure, 1, 'hard', false, true);
assert.strictEqual(postOutlineClosure.pixels[3 * postOutlineClosure.width + 7], 0, 'Fixture doorway must be transparent in the source');
assert.strictEqual(closedByOutline.pixels[6 * closedByOutline.width + 7], 255, 'Areas enclosed only by the completed outline must be filled');
assert.strictEqual(closedByOutline.pixels[1 * closedByOutline.width + 7], 0, 'Exterior transparency must remain unfilled');
assert.strictEqual(closedByOutline.pixels[10 * closedByOutline.width + 7], 0, 'Source artwork inside the silhouette must not become outline paint');
process.stdout.write('PASS outline fills regions enclosed by post-stroke connections\n');

const antialiasedSource = createCanvas();
antialiasedSource.width = 5;
antialiasedSource.height = 5;
antialiasedSource.getContext().clearRect();
const createAntialiasedRing = (doorwayAlpha) => {
	const canvas = createCanvas();
	canvas.width = 5;
	canvas.height = 5;
	canvas.getContext().clearRect();
	for (let x = 1; x <= 3; x++) {
		canvas.pixels[1 * canvas.width + x] = 255;
		canvas.pixels[3 * canvas.width + x] = 255;
	}
	for (let y = 1; y <= 3; y++) {
		canvas.pixels[y * canvas.width + 1] = 255;
		canvas.pixels[y * canvas.width + 3] = 255;
	}
	canvas.pixels[1 * canvas.width + 2] = doorwayAlpha;
	return canvas;
};
const closedAntialiasedRing = createAntialiasedRing(200);
geometry.fillEnclosedMaskAreas(closedAntialiasedRing, antialiasedSource);
assert.strictEqual(closedAntialiasedRing.pixels[2 * closedAntialiasedRing.width + 2], 255, 'Above-threshold antialiased outline pixels must close an enclosed area');
const openAntialiasedRing = createAntialiasedRing(127);
geometry.fillEnclosedMaskAreas(openAntialiasedRing, antialiasedSource);
assert.strictEqual(openAntialiasedRing.pixels[2 * openAntialiasedRing.width + 2], 0, 'Below-threshold outline pixels must remain an exterior path');
process.stdout.write('PASS enclosure detection thresholds antialiased outline pixels\n');

const distanceGeometry = vm.runInNewContext(`${geometrySource}; ({ exactEuclideanDistanceTransform });`, {
	CONFIG: { rendering: { borderSampling: { minSteps: 16, maxSteps: 64, stepsPerPixel: 4 }, maskAlphaThreshold: 128 } },
	createAppCanvas: createCanvas,
	getOptionValues: () => ['inside', 'center', 'outside'],
	Math,
	Set,
	Float64Array,
	Float32Array,
	Int32Array,
	Uint8Array
});
const fixture = new Uint8Array(25);
fixture[2 * 5 + 2] = 1;
const squared = distanceGeometry.exactEuclideanDistanceTransform(fixture, 5, 5, 1);
assert.strictEqual(squared[2 * 5 + 2], 0, 'Distance at the target pixel must be zero');
assert.strictEqual(squared[2 * 5 + 4], 4, 'Cardinal distance must be exact');
assert.strictEqual(squared[4 * 5 + 4], 8, 'Diagonal distance must be exact');
// Three or more sites per row exercise the lower-envelope pops; a stale
// intersection there shortened round outlines on the right side only.
let seed = 7;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
for (let trial = 0; trial < 40; trial++) {
	const width = 9 + trial, height = 5 + (trial % 7);
	const binary = new Uint8Array(width * height).map(() => (random() < 0.15 ? 1 : 0));
	const field = distanceGeometry.exactEuclideanDistanceTransform(binary, width, height, 1);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		let best = Infinity;
		for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++) {
			if (binary[yy * width + xx]) best = Math.min(best, (x - xx) ** 2 + (y - yy) ** 2);
		}
		assert.strictEqual(field[y * width + x], best, `Distance must match brute force at ${x},${y} (trial ${trial})`);
	}
}
process.stdout.write('PASS exact Euclidean distance transform\n');

let crisp = true;
const coverageGeometry = vm.runInNewContext(`${geometrySource}; ({ createDilatedMaskCanvas, createErodedMaskCanvas, createOutlineCutoutCanvas });`, {
	CONFIG: { rendering: { maskAlphaThreshold: 128 } }, createAppCanvas: createCanvas,
	getOptionValues: () => ['inside', 'center', 'outside'], shouldUseCrispMaskEdges: () => crisp
});
const coverageSource = createCanvas(); coverageSource.width = 8; coverageSource.height = 8; coverageSource.getContext().clearRect();
for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) coverageSource.pixels[y * 8 + x] = x === 2 ? 190 : 255;
const binary = coverageGeometry.createDilatedMaskCanvas(coverageSource, 1);
assert([...binary.pixels].every(alpha => alpha === 0 || alpha === 255), 'Crisp outlines must stay binary');
crisp = false;
const smooth = coverageGeometry.createDilatedMaskCanvas(coverageSource, 1);
assert([...smooth.pixels].some(alpha => alpha > 0 && alpha < 255), 'Antialiased outline must contain fractional coverage');
assert(smooth.pixels[3 * 8 + 1] < 255, 'Dilation must propagate the subpixel source boundary');
process.stdout.write('PASS outline antialiasing and subpixel coverage\n');

// An antialiased outline runs under the soft edge it surrounds: cut along the
// exact silhouette, a 190-alpha edge pixel would sit over a 65-alpha outline
// and show the background through both.
const cutout = coverageGeometry.createOutlineCutoutCanvas(coverageSource);
assert.strictEqual(cutout.pixels[3 * 8 + 2], 0, 'The soft edge pixel must stay under the outline');
assert.strictEqual(cutout.pixels[3 * 8 + 3], 190, 'The cutout must pull in one pixel from the silhouette edge');
assert.strictEqual(cutout.pixels[3 * 8 + 4], 255, 'The cutout must keep the silhouette interior');
assert.strictEqual(coverageGeometry.createOutlineCutoutCanvas(coverageSource, false), coverageSource, 'An outline with no fill inside it must be cut along the exact silhouette');
crisp = true;
assert.strictEqual(coverageGeometry.createOutlineCutoutCanvas(coverageSource), coverageSource, 'Crisp outlines must be cut along the exact silhouette');
// A mask that runs off its canvas has no edge there to run under.
const fullCanvas = createCanvas(); fullCanvas.width = 4; fullCanvas.height = 4; fullCanvas.getContext().clearRect(); fullCanvas.pixels.fill(255);
crisp = false;
assert(coverageGeometry.createOutlineCutoutCanvas(fullCanvas).pixels.every(alpha => alpha === 255), 'A canvas-filling mask must not be cut back at the canvas edge');
process.stdout.write('PASS antialiased outlines run under the soft edge they surround\n');

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SOURCES = {
	text: fs.readFileSync(path.join(ROOT, 'js/classes/TextGlitterManager.js'), 'utf8'),
	shape: fs.readFileSync(path.join(ROOT, 'js/classes/ShapeGlitterManager.js'), 'utf8'),
	exporter: fs.readFileSync(path.join(ROOT, 'js/classes/GifExporter.js'), 'utf8')
};

function methodBody(source, name) {
	const pattern = new RegExp(`\\n\\s*${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\s*\\}`);
	return source.match(pattern)?.[1] || '';
}

[
	['text', 'createMaskDifferenceCanvas', 'createMaskDifferenceCanvas'],
	['text', 'createDilatedMaskCanvas', 'createDilatedMaskCanvas'],
	['text', 'createErodedMaskCanvas', 'createErodedMaskCanvas'],
	['text', 'getMorphOffsets', 'getMorphOffsets'],
	['exporter', '_createMaskDifferenceCanvas', 'createMaskDifferenceCanvas'],
	['exporter', '_createDilatedMaskCanvas', 'createDilatedMaskCanvas'],
	['exporter', '_createErodedMaskCanvas', 'createErodedMaskCanvas'],
	['exporter', '_getMorphOffsets', 'getMorphOffsets']
].forEach(([sourceName, methodName, delegateName]) => {
	const body = methodBody(SOURCES[sourceName], methodName);
	assert(body.includes(`return ${delegateName}(`), `${sourceName}.${methodName} must delegate to mask-geometry.js`);
	assert(body.trim().split(/\r?\n/).length <= 3, `${sourceName}.${methodName} reimplements shared geometry`);
});

['text', 'shape'].forEach((sourceName) => {
	['getBorderPlacement', 'getBorderEdgeStyle', 'getBorderDrawOrder', 'getBorderOutsidePadding'].forEach((methodName) => {
		const body = methodBody(SOURCES[sourceName], methodName);
		assert(body.includes(`return ${methodName}(`), `${sourceName}.${methodName} must delegate to mask-geometry.js`);
		assert(body.trim().split(/\r?\n/).length <= 5, `${sourceName}.${methodName} reimplements shared geometry`);
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
const geometrySource = fs.readFileSync(path.join(ROOT, 'js/effects/mask-geometry.js'), 'utf8');
const geometry = vm.runInNewContext(`${geometrySource}; ({ createDilatedMaskCanvas, createErodedMaskCanvas });`, {
	CONFIG: { rendering: { borderSampling: { minSteps: 16, maxSteps: 64, stepsPerPixel: 4 } } },
	document: { createElement: createCanvas },
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

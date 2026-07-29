'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

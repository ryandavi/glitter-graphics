'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { PathGeometry } = require('../../js/paint/path-geometry');
const context = vm.createContext({ PathGeometry });
vm.runInContext(fs.readFileSync('js/paint/svg-import.js','utf8')+'\nthis.svg = SvgImport;',context);
const element = (localName, attrs) => ({ localName, getAttribute: (key) => attrs[key] ?? null });
for (const [tag, attrs, closed] of [
	['rect',{ x: '1', y: '2', width: '10', height: '12' },true],
	['rect',{ width: '10', height: '12', rx: '2' },true],
	['circle',{ cx: '5', cy: '6', r: '3' },true],
	['ellipse',{ rx: '3', ry: '6' },true],
	['line',{ x1: '1', y1: '2', x2: '3', y2: '4' },false],
	['polyline',{ points: '0,0 10,0 10,10' },false],
	['polygon',{ points: '0,0 10,0 10,10' },true],
	['path',{ d: 'm1 2h3v4q5 6 7 8a3 4 0 0 0 5 6z' },true]
]) {
	const paths=PathGeometry.parseSvgPath(context.svg.primitive(element(tag,attrs)));
	assert.strictEqual(paths[0].closed,closed,tag);
	const reparsed=PathGeometry.parseSvgPath(PathGeometry.toSvgPath(paths));
	assert.strictEqual(paths.length,reparsed.length);
	for (let i=0;i<paths.length;i++) {
		assert.strictEqual(paths[i].points.length,reparsed[i].points.length);
		for (let j=0;j<paths[i].points.length;j++) for (const key of ['x','y']) {
			assert(Math.abs(paths[i].points[j][key]-reparsed[i].points[j][key]) < 0.01);
			for (const handle of ['in','out']) assert(Math.abs((paths[i].points[j][handle]?.[key] || 0)-(reparsed[i].points[j][handle]?.[key] || 0)) < 0.01);
		}
	}
	const a=PathGeometry.getBounds(paths), b=PathGeometry.getBounds(reparsed);
	for (const key of ['minX','minY','maxX','maxY']) assert(Math.abs(a[key]-b[key]) < 0.01,`${tag}: ${key}`);
}
const paths=PathGeometry.parseSvgPath('M1 2C3 4 5 6 7 8');
context.svg.mapSubpaths(paths,context.svg.transform('translate(10 20) scale(2)'));
assert.strictEqual(paths[0].points[0].x,12);
assert.strictEqual(paths[0].points[0].y,24);
assert.strictEqual(paths[0].points[0].out.x,4);
assert.strictEqual(paths[0].points[0].out.y,4);
const rotate=context.svg.transform('rotate(90 10 10)');
const pt=[{ points: [{ x: 20,y: 10 }] }]; context.svg.mapSubpaths(pt,rotate);
assert(Math.abs(pt[0].points[0].x-10)<1e-9); assert(Math.abs(pt[0].points[0].y-20)<1e-9);
console.log('PASS SVG primitives, relative paths, affine transforms and geometry round trips');

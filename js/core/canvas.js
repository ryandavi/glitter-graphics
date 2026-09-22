'use strict';

function createAppCanvas(width = 0, height = 0, owner = 'Canvas') {
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(0, Number(width) || 0);
	canvas.height = Math.max(0, Number(height) || 0);
	return typeof APP_MEMORY_LEDGER === 'undefined' ? canvas : APP_MEMORY_LEDGER.trackCanvas(canvas, owner);
}

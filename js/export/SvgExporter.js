'use strict';

class SvgExporter extends DeferredExporter {
	constructor(editor, resultPresenter) { super('SvgExportEncoder'); this.editor = editor; this.resultPresenter = resultPresenter; }
	setFileName(fileName) { if (fileName) this.fileName = fileName; }
	static count(layers) {
		const visible = layers.filter((layer) => layer.visible && !layer.isPreview && layerHasVisibleContent(layer));
		const vectors = visible.filter((layer) => LAYER_UI_CONFIG[layer.type]?.vectorGeometry);
		return { vectors: vectors.length, omitted: visible.length - vectors.length };
	}
	static escape(value) { return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]); }
	static paint(slot, key) {
		if (!slot || slot.mode === 'none') return `${key}="none"`;
		return `${key}="${SvgExporter.escape(slot.color)}" ${key}-opacity="${slot.opacity / 100}"`;
	}
	static matrix(layer, offset = { x: 0, y: 0 }) {
		const t = getLayerTransform(layer), angle = t.rotation * Math.PI / 180;
		const sx=t.scale.x/100*(t.flipX ? -1 : 1), sy=t.scale.y/100*(t.flipY ? -1 : 1);
		const a=Math.cos(angle)*sx, b=Math.sin(angle)*sx, c=-Math.sin(angle)*sy, d=Math.cos(angle)*sy;
		return [a,b,c,d,t.position.x+a*offset.x+c*offset.y,t.position.y+b*offset.x+d*offset.y];
	}
}

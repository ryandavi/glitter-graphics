'use strict';

class SvgExporter {
	constructor(editor, resultPresenter) { this.editor = editor; this.resultPresenter = resultPresenter; }
	setFileName(name) { this.fileName = name; }
	static escape(value) { return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]); }
	static count(layers) {
		const visible = layers.filter((layer) => layer.visible && !layer.isPreview && layerHasVisibleContent(layer));
		const vectors = visible.filter((layer) => LAYER_UI_CONFIG[layer.type]?.vectorGeometry);
		return { vectors: vectors.length, omitted: visible.length - vectors.length };
	}
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
	async serialize(layers, width, height) {
		const parts=[];
		for (const layer of layers) {
			const hook=LAYER_UI_CONFIG[layer.type]?.vectorGeometry;
			if (!layer.visible || layer.isPreview || !hook) continue;
			const geometry=await hook(this.editor,layer);
			if (!geometry) continue;
			const attrs=`transform="matrix(${SvgExporter.matrix(layer,geometry.offset).join(' ')})" opacity="${layer.opacity / 100}"`;
			const fill=SvgExporter.paint(geometry.fill,'fill');
			let content;
			if (geometry.subpaths) {
				const stroke=geometry.stroke;
				const strokeAttrs=stroke ? `${SvgExporter.paint(stroke,'stroke')} stroke-width="${stroke.widthPx}" stroke-linecap="${STROKE_LINE_CAPS[getStrokeCap(stroke)]}" stroke-linejoin="${getStrokeEdgeStyle(stroke)}"` : 'stroke="none"';
				content=`<path d="${SvgExporter.escape(PathGeometry.toSvgPath(geometry.subpaths))}" ${fill} fill-rule="${geometry.fillRule || 'nonzero'}" ${strokeAttrs}/>`;
			} else {
				const text=geometry.text;
				content=`<text ${fill} font-family="${SvgExporter.escape(text.family)}" font-size="${text.size}" font-weight="${SvgExporter.escape(text.weight)}" font-style="${SvgExporter.escape(text.style)}" letter-spacing="${text.spacing}" text-decoration="${SvgExporter.escape(text.decoration)}" xml:space="preserve">${text.runs.map((run) => `<tspan x="${run.x}" y="${run.baseline}">${SvgExporter.escape(run.text)}</tspan>`).join('')}</text>`;
			}
			parts.push(`<g ${attrs}><title>${SvgExporter.escape(layer.name || '')}</title>${content}</g>`);
		}
		return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
	}
	async process({ visibleLayers, canvasData, target, callbacks }) {
		const source=await this.serialize(visibleLayers,canvasData.width,canvasData.height);
		if (callbacks.isCancelled?.()) throw new Error('Export cancelled');
		const blob=new Blob([source],{ type: target.mimeType });
		deliverExportResult(callbacks,this.resultPresenter,{ blob,fileName: this.fileName,completion: { still: true },target,width: canvasData.width,height: canvasData.height });
		return blob;
	}
}

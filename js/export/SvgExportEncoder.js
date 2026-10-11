'use strict';

class SvgExportEncoder {
	setFileName(name) { this.fileName = name; }
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

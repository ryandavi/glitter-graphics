'use strict';

class GifExporter extends DeferredExporter {
	constructor(compositor, options = {}) {
		super('GifExportEncoder');
		this.compositor = compositor;
		this.fileName = `${CONFIG.export.core.defaultBaseName}.gif`;
		this.resultPresenter = options.resultPresenter || (typeof ExportResultPresenter === 'function' ? new ExportResultPresenter() : null);
		this.gifEncodingPipeline = options.gifEncodingPipeline || new GifEncodingPipeline();
	}

	setFileName(fileName) { if (fileName) this.fileName = fileName; }
}

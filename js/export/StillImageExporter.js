'use strict';

class StillImageExporter extends DeferredExporter {
	constructor(frameComposer, resultPresenter, gifEncodingPipeline = new GifEncodingPipeline()) { super('StillImageExportEncoder'); this.frameComposer = frameComposer; this.resultPresenter = resultPresenter; this.gifEncodingPipeline = gifEncodingPipeline; this.fileName = `${CONFIG.export.core.defaultBaseName}.png`; }
	setFileName(fileName) { if (fileName) this.fileName = fileName; }
}

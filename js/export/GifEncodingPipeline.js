'use strict';

class GifEncodingPipeline extends DeferredExporter {
	constructor(config = {}) {
		super('GifFrameEncoder', 'gif-codec');
		this.config = {
			workers: config.workers ?? CONFIG.export.core.workers,
			workerScript: config.workerScript || CONFIG.export.core.workerScript
		};
	}

}

'use strict';

class Mp4Exporter extends DeferredExporter {
	constructor(frameComposer, resultPresenter = (typeof ExportResultPresenter === 'function' ? new ExportResultPresenter() : null)) {
		super('Mp4ExportEncoder');
		this.frameComposer = frameComposer;
		this.resultPresenter = resultPresenter;
		this.fileName = `${CONFIG.export.core.defaultBaseName}.mp4`;
	}

	setFileName(fileName) { if (fileName) this.fileName = fileName; }
	static async getSupportedConfig(width, height, bitrate) {
		if (!window.VideoEncoder || !window.VideoFrame) return null;

		for (const codec of CONFIG.export.mp4.codecs) {
			const config = {
				codec,
				width,
				height,
				bitrate,
				framerate: CONFIG.export.mp4.supportProbeFrameRate,
				latencyMode: 'quality',
				avc: { format: 'avc' }
			};
			try {
				const support = await VideoEncoder.isConfigSupported(config);
				if (support.supported) return support.config;
			} catch (error) {
				if (CONFIG.debug.enabled) console.warn('[Mp4Exporter] Unsupported codec config:', codec, error);
			}
		}
		return null;
	}

	static async isSupported() {
		return Boolean(await Mp4Exporter.getSupportedConfig(
			CONFIG.export.mp4.supportProbeWidth,
			CONFIG.export.mp4.supportProbeHeight,
			CONFIG.export.mp4.qualityPresets[CONFIG.export.mp4.defaultQuality].bitrate
		));
	}

}

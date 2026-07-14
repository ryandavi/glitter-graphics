// ============================================
// MP4 EXPORT MANAGER CLASS
// ============================================
class Mp4Exporter {
	constructor(frameComposer) {
		this.frameComposer = frameComposer;
		this.fileName = `${CONFIG.export.core.defaultBaseName}.mp4`;
	}

	setFileName(fileName) {
		if (fileName) this.fileName = fileName;
	}

	static async getSupportedConfig(width, height, bitrate) {
		if (!window.VideoEncoder || !window.VideoFrame || !window.Mp4Muxer) return null;

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

	async process(params) {
		const { exportSettings, callbacks } = params;
		const opaqueSettings = { ...exportSettings, transparency: false };
		return this.frameComposer.process({
			...params,
			exportSettings: opaqueSettings,
			frameSink: (plan) => this._encode(plan, opaqueSettings, callbacks)
		});
	}

	_buildOutputSchedule(frameDurations, planDuration, exportSettings) {
		if (exportSettings.mp4LengthMode !== 'duration') {
			return Array.from({ length: exportSettings.mp4LoopCount }, () => frameDurations)
				.flatMap((durations) => durations.map((duration, frameIndex) => ({ frameIndex, duration })));
		}

		const targetDuration = Math.round(exportSettings.mp4TargetDuration * 1000);
		const schedule = [];
		let elapsed = 0;
		while (elapsed < targetDuration) {
			for (let frameIndex = 0; frameIndex < frameDurations.length && elapsed < targetDuration; frameIndex++) {
				const duration = Math.min(frameDurations[frameIndex], targetDuration - elapsed);
				schedule.push({ frameIndex, duration });
				elapsed += duration;
			}
			if (planDuration <= 0) break;
		}
		return schedule;
	}

	async _encode(plan, exportSettings, callbacks) {
		const frameDurations = plan.frameDurations || plan.frames.map(() => plan.frameDelay);
		const planDuration = plan.totalDuration || frameDurations.reduce((sum, duration) => sum + duration, 0);
		const outputSchedule = this._buildOutputSchedule(frameDurations, planDuration, exportSettings);
		const outputDuration = outputSchedule.reduce((sum, entry) => sum + entry.duration, 0);
		const width = plan.width + (plan.width % 2);
		const height = plan.height + (plan.height % 2);
		// mp4-muxer requires integer frame-rate metadata. Frame timing remains exact
		// because every VideoFrame below carries its millisecond-derived timestamp
		// and duration (for example, 110 ms stays 110 ms rather than becoming 1/9 s).
		const averageFrameDuration = outputDuration / outputSchedule.length;
		const muxerFrameRate = Math.max(1, Math.round(1000 / averageFrameDuration));
		const preset = CONFIG.export.mp4.qualityPresets[exportSettings.mp4Quality];
		const encoderConfig = await Mp4Exporter.getSupportedConfig(width, height, preset.bitrate);
		if (!encoderConfig) throw new Error('MP4 export is not supported by this browser.');

		const target = new Mp4Muxer.ArrayBufferTarget();
		const muxer = new Mp4Muxer.Muxer({
			target,
			video: {
				codec: 'avc',
				width,
				height,
				frameRate: muxerFrameRate
			},
			fastStart: 'in-memory'
		});
		let encoderError = null;
		const encoder = new VideoEncoder({
			output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
			error: (error) => { encoderError = error; }
		});
		encoder.configure(encoderConfig);

		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
		const totalFrames = outputSchedule.length;
		let outputIndex = 0;
		let timestampMs = 0;

		for (const outputFrame of outputSchedule) {
			const imageData = plan.frames[outputFrame.frameIndex];
			ctx.fillStyle = exportSettings.matteColor;
			ctx.fillRect(0, 0, width, height);
			ctx.putImageData(imageData, 0, 0);
			const frame = new VideoFrame(canvas, {
				timestamp: timestampMs * 1000,
				duration: outputFrame.duration * 1000
			});
			encoder.encode(frame, { keyFrame: outputIndex % CONFIG.export.mp4.keyFrameInterval === 0 });
			frame.close();
			outputIndex++;
			timestampMs += outputFrame.duration;
			if (encoder.encodeQueueSize > CONFIG.export.mp4.maxEncodeQueueSize) await encoder.flush();
			callbacks.onProgress(
				75 + Math.floor((outputIndex / totalFrames) * 24),
				`Encoding MP4 frame ${outputIndex}/${totalFrames}...`,
				outputIndex,
				totalFrames
			);
		}

		await encoder.flush();
		encoder.close();
		if (encoderError) throw encoderError;
		muxer.finalize();
		const blob = new Blob([target.buffer], { type: 'video/mp4' });
		if (!blob.size) throw new Error('MP4 encoder produced an empty file.');

		callbacks.onProgress(100, 'Export complete!', 0, 0);
		callbacks.onStatus('Export complete!');
		callbacks.onComplete({ smartReduced: plan.reductions.length > 0, timelinePlan: plan });
		const file = new File([blob], this.fileName, { type: 'video/mp4', lastModified: Date.now() });
		this.frameComposer.clearPreviewBlobUrl();
		const url = URL.createObjectURL(blob);
		this.frameComposer.previewBlobUrl = url;
		this.frameComposer._showExportPreviewModal(url, file, totalFrames, blob.size, plan.reductions, {
			format: 'mp4',
			width,
			height,
			duration: timestampMs / 1000,
			timelinePlan: plan
		});
		return blob;
	}
}

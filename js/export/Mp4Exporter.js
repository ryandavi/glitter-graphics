// ============================================
// MP4 EXPORT MANAGER CLASS
// ============================================
class Mp4Exporter {
	constructor(frameComposer, resultPresenter = (typeof ExportResultPresenter === 'function' ? new ExportResultPresenter() : null)) {
		this.frameComposer = frameComposer;
		this.resultPresenter = resultPresenter;
		this.fileName = `${CONFIG.export.core.defaultBaseName}.mp4`;
	}

	setFileName(fileName) {
		if (fileName) this.fileName = fileName;
	}

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

	async process(params) {
		params = { ...params, callbacks: { ...params.callbacks, progressFormat: 'mp4' } };
		const { exportSettings, callbacks } = params;
		const opaqueSettings = { ...exportSettings, transparency: false };
		const { plan, context, renderScheduleEntry } = await this.frameComposer.planAnimation({
			...params,
			exportSettings: opaqueSettings,
			outputFormat: 'mp4',
			schedule: true
		});
		const blob = await this._encode({ schedulePlan: plan, renderScheduleEntry }, opaqueSettings, callbacks);
		logExportTimings('mp4', { plan: { ...plan, frameCount: plan.outputFrameCount }, context, exportSettings: opaqueSettings, blob, details: { mp4Quality: opaqueSettings.mp4Quality } });
		return blob;
	}

	_buildOutputSchedule(frameDurations, planDuration, exportSettings) {
		if (exportSettings.mp4LengthMode !== 'duration') {
			return Array.from({ length: exportSettings.mp4LoopCount }, () => frameDurations)
				.flatMap((durations) => durations.map((duration, scheduleIndex) => ({ scheduleIndex, duration })));
		}

		const targetDuration = Math.round(exportSettings.mp4TargetDuration * 1000);
		const schedule = [];
		let elapsed = 0;
		while (elapsed < targetDuration) {
			for (let scheduleIndex = 0; scheduleIndex < frameDurations.length && elapsed < targetDuration; scheduleIndex++) {
				const duration = Math.min(frameDurations[scheduleIndex], targetDuration - elapsed);
				schedule.push({ scheduleIndex, duration });
				elapsed += duration;
			}
			if (planDuration <= 0) break;
		}
		return schedule;
	}

	async _encode({ schedulePlan: plan, renderScheduleEntry }, exportSettings, callbacks) {
		await loadScriptOnce('js/vendor/mp4-muxer.js?v=e2a7db11');
		const frameDurations = plan.frameDurations;
		const planDuration = plan.totalDuration || frameDurations.reduce((sum, duration) => sum + duration, 0);
		const outputSchedule = this._buildOutputSchedule(frameDurations, planDuration, exportSettings);
		const outputDuration = outputSchedule.reduce((sum, entry) => sum + entry.duration, 0);
		const width = plan.width + (plan.width % 2);
		const height = plan.height + (plan.height % 2);
		// mp4-muxer requires integer frame-rate metadata. Frame timing remains exact
		// because every VideoFrame below carries its millisecond-derived timestamp
		// and duration (for example, 110 ms stays 110 ms rather than becoming 1/9 s).
		// The committed render clock is the only clock: when it fixed an output
		// fps, that exact rate goes to the muxer rather than one re-derived from
		// averaged delays.
		const averageFrameDuration = outputDuration / outputSchedule.length;
		const muxerFrameRate = Math.max(1, Math.round(plan.renderClock?.outputFps || (1000 / averageFrameDuration)));
		const encoderConfig = await Mp4Exporter.getSupportedConfig(width, height, resolveMp4Bitrate(exportSettings));
		if (!encoderConfig) {
			throw new Error(`MP4 export cannot encode a ${width} × ${height} canvas with this browser's available H.264 profiles.`);
		}

		const muxedChunks = [];
		let muxedLength = 0;
		const target = new Mp4Muxer.StreamTarget({
			chunked: true,
			chunkSize: CONFIG.export.mp4.muxChunkSize,
			onData: (data, position) => {
				if (position !== muxedLength) throw new Error(`MP4 mux stream wrote out of order at byte ${position}.`);
				muxedChunks.push(data);
				muxedLength += data.byteLength;
			}
		});
		const muxer = new Mp4Muxer.Muxer({
			target,
			video: {
				codec: 'avc',
				width,
				height,
				frameRate: muxerFrameRate
			},
			fastStart: 'fragmented'
		});
		let encoderError = null;
		const encoder = new VideoEncoder({
			output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
			error: (error) => { encoderError = error; }
		});
		encoder.configure(encoderConfig);

		const canvas = createAppCanvas(0, 0, 'export/Mp4Exporter');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d', { alpha: false });
		const totalFrames = outputSchedule.length;
		let outputIndex = 0;
		let timestampMs = 0;

		try {
			for (const outputFrame of outputSchedule) {
				if (callbacks.isCancelled?.()) throw new Error('Export cancelled');
				if (encoderError) throw encoderError;
				const scheduleEntry = plan.entries[outputFrame.scheduleIndex];
				const compositorCanvas = await renderScheduleEntry(scheduleEntry, outputFrame.scheduleIndex);
				resetCanvasContext(ctx, width, height);
				ctx.fillStyle = exportSettings.matteColor;
				ctx.fillRect(0, 0, width, height);
				ctx.drawImage(compositorCanvas, 0, 0);
				const frame = new VideoFrame(canvas, {
					timestamp: timestampMs * 1000,
					duration: outputFrame.duration * 1000
				});
				try {
					encoder.encode(frame, { keyFrame: outputIndex % CONFIG.export.mp4.keyFrameInterval === 0 });
				} finally {
					frame.close();
				}
				outputIndex++;
				timestampMs += outputFrame.duration;
				if (encoder.encodeQueueSize > CONFIG.export.mp4.maxEncodeQueueSize) await encoder.flush();
				reportExportProgress(callbacks, 'encoding', outputIndex / totalFrames, '', outputIndex, totalFrames);
			}

			reportExportProgress(callbacks, 'finalizing', 0);
			await encoder.flush();
			if (encoderError) throw encoderError;
		} finally {
			if (encoder.state !== 'closed') encoder.close();
		}
		if (callbacks.isCancelled?.()) throw new Error('Export cancelled');
		muxer.finalize();
		const blob = new Blob(muxedChunks, { type: 'video/mp4' });
		if (!blob.size) throw new Error('MP4 encoder produced an empty file.');

		reportExportProgress(callbacks, 'finalizing', 1, '');
		plan.phaseTimings = callbacks.phaseTimer?.finish();
		plan.outputFrameCount = totalFrames;
		deliverExportResult(callbacks, this.resultPresenter, {
			blob,
			fileName: this.fileName,
			completion: { smartReduced: plan.reduction.framesRemoved > 0, timelinePlan: plan },
			target: EXPORT_TARGETS['animation:mp4'],
			width,
			height,
			frameCount: totalFrames,
			duration: timestampMs / 1000,
			timelinePlan: plan
		});
		return blob;
	}
}

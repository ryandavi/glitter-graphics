// ============================================
// MP4 EXPORT MANAGER CLASS
// ============================================
const MP4_EXPORT_PROGRESS_PHASES = Object.freeze({
	loading: { label: 'Loading sources', start: 0, end: 8 },
	masks: { label: 'Preparing masks', start: 8, end: 12 },
	planning: { label: 'Planning timing', start: 12, end: 15 },
	encoding: { label: 'Rendering / encoding', start: 15, end: 99 },
	finalizing: { label: 'Finalizing', start: 99, end: 100 }
});

function reportMp4ExportProgress(callbacks, phaseKey, ratio = 0, detail = '', phaseCurrent = 0, phaseTotal = 0) {
	const phase = MP4_EXPORT_PROGRESS_PHASES[phaseKey];
	const boundedRatio = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
	callbacks.onProgress(phase.start + ((phase.end - phase.start) * boundedRatio), detail, phaseCurrent, phaseTotal, {
		phase: phase.label,
		detail,
		phaseCurrent,
		phaseTotal
	});
}

class Mp4Exporter {
	constructor(frameComposer, resultPresenter = frameComposer?.resultPresenter || (typeof ExportResultPresenter === 'function' ? new ExportResultPresenter() : null)) {
		this.frameComposer = frameComposer;
		this.resultPresenter = resultPresenter;
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
			outputFormat: 'mp4',
			scheduleSink: (renderJob) => this._encode(renderJob, opaqueSettings, callbacks)
		});
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
		const preset = CONFIG.export.mp4.qualityPresets[exportSettings.mp4Quality];
		const encoderConfig = await Mp4Exporter.getSupportedConfig(width, height, preset.bitrate);
		if (!encoderConfig) {
			throw new Error(`MP4 export cannot encode a ${width} × ${height} canvas with this browser's available H.264 profiles.`);
		}

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
		const ctx = canvas.getContext('2d', { alpha: false });
		const totalFrames = outputSchedule.length;
		let outputIndex = 0;
		let timestampMs = 0;

		try {
			for (const outputFrame of outputSchedule) {
				if (callbacks.isCancelled?.()) throw new Error('Export cancelled');
				if (encoderError) throw encoderError;
				const scheduleEntry = plan.entries[outputFrame.scheduleIndex];
				const compositorCanvas = renderScheduleEntry(scheduleEntry, outputFrame.scheduleIndex);
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
				reportMp4ExportProgress(callbacks, 'encoding', outputIndex / totalFrames, `Rendering / encoding MP4 frame ${outputIndex} / ${totalFrames}`, outputIndex, totalFrames);
			}

			reportMp4ExportProgress(callbacks, 'finalizing', 0, 'Finalizing MP4…');
			await encoder.flush();
			if (encoderError) throw encoderError;
		} finally {
			if (encoder.state !== 'closed') encoder.close();
		}
		if (callbacks.isCancelled?.()) throw new Error('Export cancelled');
		muxer.finalize();
		const blob = new Blob([target.buffer], { type: 'video/mp4' });
		if (!blob.size) throw new Error('MP4 encoder produced an empty file.');

		reportMp4ExportProgress(callbacks, 'finalizing', 1, 'Export complete');
		callbacks.onStatus('Export complete!');
		callbacks.onComplete({ smartReduced: plan.reduction.framesRemoved > 0, timelinePlan: plan });
		const file = new File([blob], this.fileName, { type: 'video/mp4', lastModified: Date.now() });
		this.resultPresenter?.show({ blob, file, target: EXPORT_TARGETS['animation:mp4'], width, height, frameCount: totalFrames, duration: timestampMs / 1000, timelinePlan: plan });
		return blob;
	}
}

importScripts('../effects/palette-analysis.js?v=1', '../effects/pixel-effects.js?v=9');

let posterizeSegmentKey = null;
let posterizeSegment = null;
let shimmerSession = null;

self.onmessage = ({ data }) => {
	try {
		if (data.clearAnimation) {
			shimmerSession = null;
			return;
		}
		if (!data.animationKey) shimmerSession = null;
		const session = data.animationKey && !data.pixels && shimmerSession?.key === data.animationKey
			? shimmerSession
			: null;
		if (data.animationKey && !data.pixels && !session) throw new Error('The Shimmer preview expired.');
		const source = session?.source || new Uint8ClampedArray(data.pixels);
		const width = session?.width || data.width;
		const height = session?.height || data.height;
		const settings = session?.settings || data.settings;
		const config = session?.config || data.config;
		let output;
		if (settings.paletteEnabled && settings.paletteMode === 'posterize') {
			const pixelized = GlitterPixelEffects.pixelize(source, width, height, settings.pixelateEnabled ? settings.pixelSize : 1);
			const options = GlitterPixelEffects.getSharedAnalysisOptions(settings, config.autoGlitter, true);
			if (posterizeSegmentKey !== data.segmentKey) {
				posterizeSegment = GlitterPaletteAnalysis.segmentImage(pixelized, width, height, options);
				posterizeSegmentKey = data.segmentKey;
			}
			const result = GlitterPaletteAnalysis.reduceSegment(posterizeSegment, settings.colorCount, options);
			output = GlitterPixelEffects.flatten(pixelized, result.labels, result.palette);
		} else {
			let palette = session?.palette || null;
			if (data.animationKey && !session) {
				const pixelized = GlitterPixelEffects.pixelize(source, width, height, settings.pixelateEnabled ? settings.pixelSize : 1);
				palette = GlitterPixelEffects.getPalette(pixelized, width, height, settings, config);
				shimmerSession = { key: data.animationKey, source, width, height, settings, config, palette };
			}
			output = GlitterPixelEffects.applyPixelEffects(source, width, height, settings, config, data.frameIndex || 0, palette);
		}
		self.postMessage({ requestId: data.requestId, pixels: output.buffer }, [output.buffer]);
	} catch (error) {
		self.postMessage({ requestId: data.requestId, error: error?.message || 'The palette effect could not be updated.' });
	}
};

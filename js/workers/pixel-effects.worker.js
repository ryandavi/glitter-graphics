importScripts('../effects/palette-analysis.js?v=1', '../effects/pixel-effects.js?v=6');

let posterizeSegmentKey = null;
let posterizeSegment = null;

self.onmessage = ({ data }) => {
	try {
		const source = new Uint8ClampedArray(data.pixels);
		let output;
		if (data.settings.paletteMode === 'posterize') {
			const pixelized = GlitterPixelEffects.pixelize(source, data.width, data.height, data.settings.pixelSize);
			const options = GlitterPixelEffects.getSharedAnalysisOptions(data.settings, data.config.autoGlitter, true);
			if (posterizeSegmentKey !== data.segmentKey) {
				posterizeSegment = GlitterPaletteAnalysis.segmentImage(pixelized, data.width, data.height, options);
				posterizeSegmentKey = data.segmentKey;
			}
			const result = GlitterPaletteAnalysis.reduceSegment(posterizeSegment, data.settings.colorCount, options);
			output = GlitterPixelEffects.flatten(pixelized, result.labels, result.palette);
		} else {
			output = GlitterPixelEffects.applyPixelEffects(source, data.width, data.height, data.settings, data.config, data.frameIndex || 0);
		}
		self.postMessage({ requestId: data.requestId, pixels: output.buffer }, [output.buffer]);
	} catch (error) {
		self.postMessage({ requestId: data.requestId, error: error?.message || 'The palette effect could not be updated.' });
	}
};

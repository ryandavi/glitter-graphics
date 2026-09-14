'use strict';

const EXPORT_TARGETS = Object.freeze({
	'still:png': Object.freeze({ mode: 'still', format: 'png', id: 'still:png', label: 'PNG', exportLabel: 'Export PNG', mimeType: 'image/png', extension: 'png', isStill: true, isAnimation: false, isGif: false, isVideo: false, supportsTransparency: true, usesMatte: true, supportsGifLook: false, supportsTemporalGifLook: false, supportsPlaybackSettings: false, supportsAnimationOptimization: false, supportsJpegCompression: false }),
	'still:jpeg': Object.freeze({ mode: 'still', format: 'jpeg', id: 'still:jpeg', label: 'JPG', exportLabel: 'Export JPG', mimeType: 'image/jpeg', extension: 'jpg', isStill: true, isAnimation: false, isGif: false, isVideo: false, supportsTransparency: false, usesMatte: true, supportsGifLook: false, supportsTemporalGifLook: false, supportsPlaybackSettings: false, supportsAnimationOptimization: false, supportsJpegCompression: true }),
	'still:gif': Object.freeze({ mode: 'still', format: 'gif', id: 'still:gif', label: 'Still GIF', exportLabel: 'Export Still GIF', mimeType: 'image/gif', extension: 'gif', isStill: true, isAnimation: false, isGif: true, isVideo: false, supportsTransparency: true, usesMatte: true, supportsGifLook: true, supportsTemporalGifLook: false, supportsPlaybackSettings: false, supportsAnimationOptimization: false, supportsJpegCompression: false }),
	'animation:gif': Object.freeze({ mode: 'animation', format: 'gif', id: 'animation:gif', label: 'GIF', exportLabel: 'Export GIF', mimeType: 'image/gif', extension: 'gif', isStill: false, isAnimation: true, isGif: true, isVideo: false, supportsTransparency: true, usesMatte: true, supportsGifLook: true, supportsTemporalGifLook: true, supportsPlaybackSettings: true, supportsAnimationOptimization: true, supportsJpegCompression: false }),
	'animation:mp4': Object.freeze({ mode: 'animation', format: 'mp4', id: 'animation:mp4', label: 'MP4', exportLabel: 'Export MP4', mimeType: 'video/mp4', extension: 'mp4', isStill: false, isAnimation: true, isGif: false, isVideo: true, supportsTransparency: false, usesMatte: true, supportsGifLook: false, supportsTemporalGifLook: false, supportsPlaybackSettings: true, supportsAnimationOptimization: true, supportsJpegCompression: false })
});

function getActiveExportTarget(settings, { mp4Supported = true } = {}) {
	const mode = settings?.outputMode === 'still' ? 'still' : 'animation';
	let format = mode === 'still' ? settings?.stillFormat : settings?.animationFormat;
	if (mode === 'still' && !['png', 'jpeg', 'gif'].includes(format)) format = 'png';
	if (mode === 'animation' && !['gif', 'mp4'].includes(format)) format = 'gif';
	if (mode === 'animation' && format === 'mp4' && !mp4Supported) format = 'gif';
	return EXPORT_TARGETS[`${mode}:${format}`];
}

function setActiveExportTarget(settings, targetId) {
	const target = EXPORT_TARGETS[targetId];
	if (!target) return null;
	settings.outputMode = target.mode;
	if (target.isStill) settings.stillFormat = target.format;
	else settings.animationFormat = target.format;
	return target;
}

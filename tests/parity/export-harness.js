'use strict';

// Shared by the export parity and fragility suites: run the real GIF exporter
// in the page and hand back the encoded bytes, and compare two exports.

const crypto = require('crypto');

const EXPORT_TIMEOUT_MS = 60000;

function hashBytes(bytes) {
	return crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

function findFirstByteDiff(a, b) {
	const limit = Math.min(a.length, b.length);
	for (let index = 0; index < limit; index += 1) {
		if (a[index] !== b[index]) {
			return index;
		}
	}
	return a.length === b.length ? -1 : limit;
}

function assertByteIdentity(reference, candidate, label) {
	const firstDiff = findFirstByteDiff(reference.bytes, candidate.bytes);
	if (firstDiff !== -1) {
		throw new Error(
			`${label} was not byte-identical (first differing byte ${firstDiff}, ` +
			`reference=${reference.hash}, candidate=${candidate.hash})`
		);
	}
}

// `minLayers`: the composition must have at least this many visible content
// layers, so a silently empty scene can't pass as stable.
async function exportBytes(page, exportOverrides = {}, { minLayers = 4 } = {}) {
	const bytes = await page.evaluate(async ({ exportTimeoutMs, exportOverrides, minLayers }) => {
		const editor = window.editor;
		Object.assign(editor.exportSettings, {
			baseImage: false,
			transparency: false,
			watermarkEnabled: false,
			exportReverse: false,
			smartFrameReduction: false,
			exportFrameSkip: 1,
			maxFrames: 24,
			frameDelay: 100,
			quality: 10,
			ditherEnabled: false,
			matteColor: '#ffffff'
		}, exportOverrides || {});

		const visibleLayers = editor.layerManager.layers.filter((layer) => layer.visible && window.layerHasVisibleContent(layer));
		if (visibleLayers.length < minLayers) {
			throw new Error(`Expected at least ${minLayers} visible content layers, found ${visibleLayers.length}`);
		}

		return await new Promise((resolve, reject) => {
			const exporter = editor.exporter;
			const originalHandleFileSave = exporter._handleFileSave.bind(exporter);
			const timeout = setTimeout(() => {
				exporter._handleFileSave = originalHandleFileSave;
				reject(new Error('Export timed out'));
			}, exportTimeoutMs);

			exporter._handleFileSave = async (blob, _callbacks, plan) => {
				try {
					clearTimeout(timeout);
					const arrayBuffer = await blob.arrayBuffer();
					exporter._handleFileSave = originalHandleFileSave;
					// The committed render clock must be the only clock: stash what the
					// planner intended so the emitted delays can be checked against it.
					window.__exportPlannedDelays = [...(plan?.frameDurations || [])];
					resolve(Array.from(new Uint8Array(arrayBuffer)));
				} catch (error) {
					exporter._handleFileSave = originalHandleFileSave;
					reject(error);
				}
			};

			exporter.process({
				visibleLayers,
				glitterGifs: editor.glitterLibrary.content,
				canvasData: {
					width: editor.originalCanvas.width,
					height: editor.originalCanvas.height,
					originalData: new Uint8ClampedArray(editor.originalImageData.data),
					originalAlpha: editor.originalAlphaChannel,
					alphaThreshold: CONFIG.tools.selection.transparency.alphaThreshold
				},
				exportSettings: editor.exportSettings,
				callbacks: {
					onStatus: () => {},
					onProgress: () => {},
					onComplete: () => {},
					onError: (error) => {
						clearTimeout(timeout);
						exporter._handleFileSave = originalHandleFileSave;
						reject(error);
					},
					createMask: (layer) => editor.maskCompositor.getMaskData(layer),
					renderSlotMasks: (layer) => getLayerManagerForType(editor, layer.type).renderSlotMasks(layer),
					ensureTextFont: (fontId) => FontLibrary.ensureLoaded(fontId)
				}
			}).catch((error) => {
				clearTimeout(timeout);
				exporter._handleFileSave = originalHandleFileSave;
				reject(error);
			});
		});
	}, { exportTimeoutMs: EXPORT_TIMEOUT_MS, exportOverrides, minLayers });
	return bytes;
}

// One export as { bytes, hash }.
async function exportSnapshot(page, exportOverrides = {}, options = {}) {
	const bytes = await exportBytes(page, exportOverrides, options);
	return { bytes, hash: hashBytes(bytes) };
}

module.exports = { EXPORT_TIMEOUT_MS, hashBytes, findFirstByteDiff, assertByteIdentity, exportBytes, exportSnapshot };

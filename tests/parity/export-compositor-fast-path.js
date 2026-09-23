'use strict';

const { chromium } = require('playwright');
const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

(async () => {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(APP_URL, { waitUntil: 'networkidle' });
	await page.waitForFunction(() => window.editor?.settingsStore);

	const result = await page.evaluate(async () => {
		const check = (condition, message) => { if (!condition) throw new Error(message); };
		const rawFrame = (width, height, rgba, options = {}) => {
			const data = new Uint8ClampedArray(width * height * 4);
			for (let offset = 0; offset < data.length; offset += 4) data.set(rgba, offset);
			return { data, width, height, x: options.x || 0, y: options.y || 0, disposal: options.disposal ?? 1 };
		};
		const descriptor = (key, animation, replayPolicy = 'native-layer') => ({
			key,
			label: key,
			replayPolicy,
			sourceIdentity: animation,
			getAnimation: () => animation
		});
		const bytes = (frame) => [...frame.data].join(',');

		const resolver = new AuthoredFrameResolver();
		const nativeAnimation = {
			width: 2,
			height: 1,
			frames: [
				rawFrame(2, 1, [255, 0, 0, 255], { disposal: 1 }),
				rawFrame(1, 1, [0, 0, 255, 255], { x: 1, disposal: 2 }),
				rawFrame(1, 1, [0, 255, 0, 255], { disposal: 3 })
			]
		};
		for (const policy of ['native-layer', 'derived-glitter', 'watermark-current']) {
			const source = descriptor(policy, nativeAnimation, policy);
			const all = resolver.resolveAll(source, resolver.createSession());
			const sequentialSession = resolver.createSession();
			for (const index of [0, 1, 2]) {
				const selected = resolver.resolveFrame(source, index, resolver.createSession());
				check(bytes(all[index]) === bytes(selected), `${policy} selected-frame replay diverged at ${index}`);
				const sequential = resolver.resolveFrame(source, index, sequentialSession);
				check(bytes(all[index]) === bytes(sequential), `${policy} sequential replay diverged at ${index}`);
			}
		}
		const derivedRestartAnimation = {
			width: 2,
			height: 1,
			frames: [
				{ data: new Uint8ClampedArray([255, 0, 0, 0, 255, 0, 0, 255]), width: 2, height: 1, disposal: 1 },
				rawFrame(1, 1, [0, 0, 255, 255])
			]
		};
		const derivedRestartSource = descriptor('derived-restart', derivedRestartAnimation, 'derived-glitter');
		const derivedBaseline = resolver.resolveAll(derivedRestartSource, resolver.createSession());
		const derivedSequentialSession = resolver.createSession();
		resolver.resolveFrame(derivedRestartSource, 0, derivedSequentialSession);
		check(bytes(resolver.resolveFrame(derivedRestartSource, 1, derivedSequentialSession)) === bytes(derivedBaseline[1]),
			'Derived replay did not restart when its deferred disposal analysis changed the frame-zero state');

		const longAnimation = {
			width: 2,
			height: 1,
			frames: Array.from({ length: 29 }, (_, index) => rawFrame(
				index % 3 === 0 ? 2 : 1,
				1,
				[(index * 31) % 256, (index * 67) % 256, (index * 97) % 256, 255],
				{ x: index % 2, disposal: index % 5 === 0 ? 3 : (index % 4 === 0 ? 2 : 1) }
			))
		};
		const longSource = descriptor('checkpointed', longAnimation);
		const baseline = resolver.resolveAll(longSource, resolver.createSession());
		const streamingSession = resolver.createSession();
		for (let index = 0; index < longAnimation.frames.length * 2; index++) {
			check(bytes(resolver.resolveFrame(longSource, index, streamingSession)) === bytes(baseline[index % baseline.length]),
				`Checkpointed modulo replay diverged at ${index}`);
		}
		const replayState = streamingSession.getReplay(longAnimation, 'native-layer', () => null);
		check(replayState.blockFrames.size <= CONFIG.export.authoredFrames.checkpointInterval
			&& replayState.checkpoints.length <= Math.ceil(longAnimation.frames.length / CONFIG.export.authoredFrames.checkpointInterval) + 1,
			`Checkpointed replay retained an unbounded output-frame array (${replayState.blockFrames.size} frames, ${replayState.checkpoints.length} checkpoints)`);
		const reverseSession = resolver.createSession();
		for (let index = longAnimation.frames.length - 1; index >= 0; index--) {
			check(bytes(resolver.resolveFrame(longSource, index, reverseSession)) === bytes(baseline[index]),
				`Checkpointed reverse replay diverged at ${index}`);
		}

		let highestRead = -1;
		const trackedFrames = new Proxy(nativeAnimation.frames, {
			get(target, property) {
				if (/^\d+$/.test(String(property))) highestRead = Math.max(highestRead, Number(property));
				return target[property];
			}
		});
		const trackedAnimation = { ...nativeAnimation, frames: trackedFrames };
		resolver.resolveFrame(descriptor('first', trackedAnimation, 'derived-glitter'), 0, resolver.createSession());
		check(highestRead === 0, 'First-frame resolution read a later authored frame');
		highestRead = -1;
		resolver.resolveFrame(descriptor('middle', trackedAnimation, 'derived-glitter'), 1, resolver.createSession());
		check(highestRead === 1, 'Selected-frame resolution read past its target');

		let replayCalls = 0;
		const originalReplay = resolver._replay.bind(resolver);
		resolver._replay = (...args) => { replayCalls++; return originalReplay(...args); };
		const sharedSession = resolver.createSession();
		const sharedA = resolver.resolveAll(descriptor('logical-a', nativeAnimation), sharedSession);
		const sharedB = resolver.resolveAll(descriptor('logical-b', nativeAnimation), sharedSession);
		check(sharedA === sharedB && replayCalls === 1, 'Logical sources did not share physical full-frame resolution');
		const selectedSession = resolver.createSession();
		const selectedA = resolver.resolveFrame(descriptor('selected-a', nativeAnimation), 1, selectedSession);
		const selectedB = resolver.resolveFrame(descriptor('selected-b', nativeAnimation), 1, selectedSession);
		check(selectedA === selectedB, 'Logical sources did not share physical selected-frame resolution');

		const watermarkAnimation = {
			width: 2,
			height: 1,
			frames: [rawFrame(1, 1, [10, 20, 30, 100], { x: 1, disposal: 1 })]
		};
		const watermarkBefore = [...watermarkAnimation.frames[0].data];
		const watermarkSource = {
			...descriptor('watermark', watermarkAnimation, 'watermark-current'),
			transformResolvedFrame: (frame) => {
				const copy = new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);
				for (let offset = 3; offset < copy.data.length; offset += 4) copy.data[offset] = copy.data[offset] < 128 ? 0 : 255;
				return copy;
			}
		};
		const resolvedWatermark = resolver.resolveFrame(watermarkSource, 0, resolver.createSession());
		check(watermarkBefore.join(',') === [...watermarkAnimation.frames[0].data].join(',')
			&& resolvedWatermark.data[7] === 0, 'Watermark resolution mutated raw patches or skipped alpha thresholding');

		const timing = new AuthoredAnimationSource({ key: 'timing', frameCount: 3, frameDurations: [10, 50, 0], fallbackDuration: 80 });
		check(!('frames' in timing) && timing.frameCount === 3 && timing.frameDurations.join(',') === '20,50,80'
			&& timing.frameIndexAt(69) === 1 && timing.frameIndexAt(70) === 2,
			'Authored timing still owns pixels or changed duration normalization');

		const exporter = window.editor.exporter;
		check(window.editor.authoredFrameResolver === exporter.authoredFrameResolver
			&& window.editor.gifEncodingPipeline === exporter.gifEncodingPipeline
			&& window.editor.gifEncodingPipeline === window.editor.stillImageExporter.gifEncodingPipeline,
			'Application initialization did not share export services');
		const library = [{ id: 'g1', name: 'One' }, { id: 'g2', name: 'Two' }, { id: 'g3', name: 'Three' }];
		const keysFor = (layer) => exporter._buildLayerExportPlan(layer).getAuthoredSources(library).map((source) => source.key);
		const base = { id: 'base', type: LayerType.BASE_IMAGE, background: { mode: 'solid', glitterId: 'g1' } };
		check(keysFor(base).length === 0, 'Stale base glitter leaked from solid mode');
		base.background.mode = 'glitter';
		check(keysFor(base).join(',') === 'base', 'Base glitter descriptor key changed');
		const fill = { id: 'fill', type: LayerType.GLITTER_FILL, fill: { mode: 'gradient', glitterId: 'g1' }, settings: {} };
		check(keysFor(fill).length === 0, 'Stale fill glitter leaked from gradient mode');
		fill.fill.mode = 'glitter';
		check(keysFor(fill).join(',') === 'fill', 'Glitter-fill descriptor key changed');
		const text = {
			id: 'text', type: LayerType.TEXT_GLITTER,
			textData: { fill: { mode: 'glitter', glitterId: 'g1' }, border: { mode: 'glitter', widthPx: 0, glitterId: 'g2' }, shadow: { mode: 'glitter', glitterId: 'g3' } }
		};
		check(keysFor(text).join(',') === 'text:fill,text:shadow', 'Text source activation matrix changed');
		text.textData.border.widthPx = 2;
		check(keysFor(text).join(',') === 'text:fill,text:border,text:shadow', 'Text border source activation changed');
		const shape = {
			id: 'shape', type: LayerType.SHAPE,
			shapeData: { fill: { mode: 'glitter', glitterId: 'g1' }, border: { mode: 'glitter', widthPx: 2, glitterId: 'g2' }, shadow: { mode: 'glitter', glitterId: 'g3' } }
		};
		const shapeSources = exporter._buildLayerExportPlan(shape).getAuthoredSources(library);
		check(shapeSources.map((source) => source.key).join(',') === 'shape:fill,shape:border,shape:shadow', 'Shape source keys changed');
		const sticker = {
			id: 'sticker', type: LayerType.STICKER, settings: {},
			stickerData: { isAnimated: true, name: 'Sticker', shadow: { mode: 'glitter', glitterId: 'g2' } }
		};
		check(keysFor(sticker).join(',') === 'sticker,sticker:shadow', 'Sticker authored source keys changed');
		exporter._validateAuthoredSourceKeys([{ key: 'a' }, { key: 'b' }]);
		let duplicateRejected = false;
		try { exporter._validateAuthoredSourceKeys([{ key: 'a' }, { key: 'a' }]); } catch (error) { duplicateRejected = /Duplicate authored source key/.test(error.message); }
		check(duplicateRejected, 'Duplicate logical source keys were silently accepted');

		const animatedLayer = { id: 'motion', type: LayerType.STICKER, name: 'Motion', animation: { type: 'rotate', periodMs: 1000, phase: 0 }, stickerData: {} };
		const procedural = exporter._collectProceduralSources([animatedLayer], { includeBaseImage: false });
		check(procedural.map((source) => source.key).join(',') === '__anim_motion'
			&& exporter._createProceduralTimelines(procedural)[0].key === procedural[0].key,
			'Procedural animation discovery diverged from timeline normalization');
		const selectedProcedural = exporter._resolveSelectedAuthored({ authoredSources: [], proceduralSources: procedural }, resolver.createSession(), 250, 100);
		check(selectedProcedural.sourceSelectionMap.has('__anim_motion'), 'Still sampling did not use the procedural descriptor collector');

		const baseCanvasData = {
			width: 2,
			height: 1,
			originalData: new Uint8ClampedArray([20, 40, 60, 255, 80, 100, 120, 255])
		};
		const baseLayer = {
			type: LayerType.BASE_IMAGE,
			visible: true,
			background: {
				mode: 'image',
				opacity: 100,
				colorAdjust: { ...COLOR_ADJUST_IDENTITY },
				pixelEffects: { pixelateEnabled: true, pixelSize: 1, paletteEnabled: false }
			}
		};
		const originalApplyPixelEffects = GlitterPixelEffects.applyPixelEffects;
		let baseProcessCount = 0;
		GlitterPixelEffects.applyPixelEffects = (...args) => {
			baseProcessCount++;
			return originalApplyPixelEffects(...args);
		};
		try {
			const basePipelineContext = {
				canvasData: baseCanvasData,
				basePipeline: exporter._prepareBasePipeline([baseLayer], baseCanvasData, { baseImage: true })
			};
			exporter._getBasePipelineImageData(basePipelineContext, 0);
			exporter._getBasePipelineImageData(basePipelineContext, 7);
			check(baseProcessCount === 1, 'Static base pipeline processing was not cached per export context');
			baseLayer.background.pixelEffects = {
				paletteEnabled: true,
				paletteMode: 'dither',
				dither: { algorithm: 'bayer', shimmer: true }
			};
			const shimmerPipelineContext = {
				canvasData: baseCanvasData,
				basePipeline: exporter._prepareBasePipeline([baseLayer], baseCanvasData, { baseImage: true })
			};
			baseProcessCount = 0;
			[0, 1, 8, 9].forEach((index) => exporter._getBasePipelineImageData(shimmerPipelineContext, index));
			check(baseProcessCount === 2, 'Base shimmer processing did not cache by normalized shimmer state');
		} finally {
			GlitterPixelEffects.applyPixelEffects = originalApplyPixelEffects;
		}

		const paintMask = document.createElement('canvas');
		paintMask.width = 8;
		paintMask.height = 8;
		paintMask.getContext('2d').fillRect(0, 0, 8, 8);
		const renderTarget = document.createElement('canvas');
		renderTarget.width = 32;
		renderTarget.height = 32;
		const renderCtx = renderTarget.getContext('2d');
		const textLayer = editor.textGlitterManager.createLayer({ text: 'A' });
		textLayer.textData.width = 8;
		textLayer.textData.height = 8;
		textLayer.textData.fill = { mode: 'solid', color: '#ff0000', opacity: 1 };
		const shapeLayer = editor.shapeGlitterManager.createLayer({ shapeId: 'circle', width: 8, height: 8 });
		shapeLayer.shapeData.fill = { mode: 'solid', color: '#00ff00', opacity: 1 };
		const stickerLayer = editor.stickerManager.createLayer();
		stickerLayer.stickerData.isEmpty = false;
		stickerLayer.stickerData.width = 8;
		stickerLayer.stickerData.height = 8;
		stickerLayer.stickerData.staticImageData = new ImageData(new Uint8ClampedArray(8 * 8 * 4).fill(255), 8, 8);
		stickerLayer.stickerData.shadow = { mode: 'solid', color: '#000000', opacity: 1, offsetX: 2, offsetY: 3 };
		const textPlan = exporter._buildLayerExportPlan(textLayer);
		const shapePlan = exporter._buildLayerExportPlan(shapeLayer);
		const stickerPlan = exporter._buildLayerExportPlan(stickerLayer);
		const watermarkCanvas = document.createElement('canvas');
		const watermark = {
			isAnimated: false,
			width: 2,
			height: 1,
			imageData: new ImageData(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0]), 2, 1),
			alphaProcessed: true
		};
		const originalCreateElement = document.createElement.bind(document);
		let renderCanvasCreations = 0;
		document.createElement = (name, options) => {
			if (String(name).toLowerCase() === 'canvas') renderCanvasCreations++;
			return originalCreateElement(name, options);
		};
		try {
			for (let index = 0; index < 3; index++) {
				textPlan.render({ ctx: renderCtx, frameIndex: index, sourceSelectionMap: new Map(), resolvedFramesBySource: new Map(), slotMaskCanvases: new Map([[textLayer.id, { fill: paintMask, renderWidth: textLayer.textData.width, renderHeight: textLayer.textData.height }]]) });
				shapePlan.render({ ctx: renderCtx, frameIndex: index, sourceSelectionMap: new Map(), resolvedFramesBySource: new Map(), slotMaskCanvases: new Map([[shapeLayer.id, { fill: paintMask, renderWidth: 8, renderHeight: 8 }]]) });
				stickerPlan.render({ ctx: renderCtx, frameIndex: index, sourceSelectionMap: new Map(), resolvedFramesBySource: new Map() });
				exporter._renderPatternSourceInto(exporter.patternSourceCanvas, stickerLayer.stickerData.staticImageData, COLOR_ADJUST_IDENTITY);
				exporter._renderWatermarkToCanvas(watermark, watermarkCanvas, renderCtx, 32, 32, index);
			}
		} finally {
			document.createElement = originalCreateElement;
		}
		check(renderCanvasCreations === 0, 'Text, shape, sticker, pattern, or watermark rendering allocated a canvas per frame');

		check(exporter._resolvePreserveAlpha(true, { transparency: true }) === true
			&& exporter._resolvePreserveAlpha(false, { transparency: true }) === false
			&& exporter._resolvePreserveAlpha(true, { transparency: false }) === false,
			'preserveAlpha no longer reflects target capability AND export setting alone');

		const OriginalGif = window.GIF;
		let gifOptions;
		const encodedFrames = [];
		const transparentOptionSequence = [];
		window.GIF = class {
			constructor(options) { gifOptions = options; this.handlers = {}; }
			setOption(key, value) { if (key === 'transparent') transparentOptionSequence.push(value); }
			addFrame(frame) { encodedFrames.push(frame); }
			on(name, callback) { this.handlers[name] = callback; }
			render() { this.handlers.finished(new Blob(['gif'], { type: 'image/gif' })); }
		};
		try {
			// Frame 0: pixel 0 is opaque magenta (must survive as opaque), pixel 1
			// is alpha 0 (must become the sentinel). Magenta is itself the
			// compositor's old chroma-key color, so this also proves the sentinel
			// is chosen from the built visible palette, not a fixed guess.
			// Frame 1 is fully opaque - a mixed animation (item 10/24 in the plan).
			const transparentFrame = new ImageData(new Uint8ClampedArray([255, 0, 255, 255, 1, 2, 3, 0]), 2, 1);
			const opaqueFrame = new ImageData(new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]), 2, 1);
			const ownedFrames = [transparentFrame, opaqueFrame];
			const encoded = await exporter.gifEncodingPipeline.encode({
				frames: ownedFrames, delays: [100, 100], settings: { colorCount: 'auto', ditherEnabled: false, quality: 1 },
				transparency: { enabled: true }, mode: 'animation'
			});
			check(gifOptions.globalPalette.slice(0, 3).join(',') === '0,255,255', 'Sentinel (cyan, the first unused candidate) was not prepended to the global GIF palette');
			check(gifOptions.globalPalette.slice(3).join(',').split(',').length === 9, 'Visible palette did not learn all three opaque colors across frames');
			check(transparentOptionSequence[0] === 0x00ffff, 'A frame containing transparent pixels was not given the sentinel as its per-frame transparent option');
			check(transparentOptionSequence[1] === null, 'A fully opaque frame in a mixed animation was not given a null per-frame transparent option');
			check(encodedFrames[0].data[0] === 255 && encodedFrames[0].data[1] === 0 && encodedFrames[0].data[2] === 255 && encodedFrames[0].data[3] === 255,
				'Opaque magenta pixel was not prequantized to its exact visible-palette RGB');
			check(encodedFrames[0].data[4] === 0 && encodedFrames[0].data[5] === 255 && encodedFrames[0].data[6] === 255 && encodedFrames[0].data[7] === 255,
				'Transparent pixel was not mapped to the sentinel RGB');
			check(encodedFrames[1].data[3] === 255 && encodedFrames[1].data[7] === 255, 'Opaque frame pixels were not written back fully opaque');
			check(encoded.paletteMode === 'shared' && encoded.transparencyUsed === true, 'Encoding result did not report its actual resolved transparency/palette mode');
			check(ownedFrames[0] === null && ownedFrames[1] === null, 'GIF pipeline retained an application-owned source frame after GIF.js copied it');
			check(exporter.gifEncodingPipeline._analyzeColors([transparentFrame], 128).observedColorCount === 1,
				'Threshold-aware GIF color analysis counted a below-threshold pixel');

			const opaqueOnly = new ImageData(new Uint8ClampedArray([5, 6, 7, 255, 8, 9, 10, 255]), 2, 1);
			const opaqueEncoded = await exporter.gifEncodingPipeline.encode({
				frames: [opaqueOnly], settings: { colorCount: 'auto', ditherEnabled: false, quality: 1 },
				transparency: { enabled: true }, mode: 'still'
			});
			check(opaqueEncoded.transparencyUsed === false && opaqueEncoded.paletteMode === 'native',
				'A fully opaque frame with transparency requested still reserved a sentinel/shared palette');
		} finally { window.GIF = OriginalGif; }

		await window.editor.loadBlankImage(8, 8, '#ffffff');
		while (!window.editor.originalImage) await new Promise((resolve) => setTimeout(resolve, 10));
		const visibleLayers = window.editor.layers.filter((layer) => layer.visible && layerHasVisibleContent(layer));
		const canvasData = {
			width: 8, height: 8,
			originalData: new Uint8ClampedArray(window.editor.originalImageData.data),
			originalAlpha: window.editor.originalAlphaChannel,
			alphaThreshold: CONFIG.tools.selection.transparency.alphaThreshold,
			hasBaseImage: true
		};
		const callbacks = {
			onStatus: () => {}, onProgress: () => {}, onComplete: () => {}, parseGif: (url) => window.editor.glitterManager.parseGifFromUrl(url),
			createMask: (layer) => window.editor.maskCompositor.getMaskData(layer),
			renderSlotMasks: (layer) => getLayerManagerForType(window.editor, layer.type).renderSlotMasks(layer),
			ensureTextFont: (fontId) => window.editor.textGlitterManager.ensureFontLoaded(fontId)
		};
		let planBuilds = 0;
		const originalBuild = exporter._buildLayerExportPlan.bind(exporter);
		exporter._buildLayerExportPlan = (...args) => { planBuilds++; return originalBuild(...args); };
		const originalPlanner = CompositeTimelinePlanner.prototype.plan;
		const originalReducer = CompositeFrameReducer.prototype.reduce;
		exporter.authoredFrameResolver.resolveAll = () => { throw new Error('Still path called resolveAll'); };
		CompositeTimelinePlanner.prototype.plan = () => { throw new Error('Still path invoked timeline planning'); };
		CompositeFrameReducer.prototype.reduce = () => { throw new Error('Still path invoked frame reduction'); };
		try {
			await exporter.composeFrameAt({
				visibleLayers, glitterGifs: window.editor.glitterManager.content, canvasData,
				exportSettings: structuredClone(window.editor.exportSettings), target: EXPORT_TARGETS['still:png'], callbacks, timestamp: 0
			});
			check(planBuilds === visibleLayers.length, 'Still export rebuilt a layer plan after common preparation');
		} finally {
			exporter._buildLayerExportPlan = originalBuild;
			delete exporter.authoredFrameResolver.resolveAll;
			CompositeTimelinePlanner.prototype.plan = originalPlanner;
			CompositeFrameReducer.prototype.reduce = originalReducer;
		}

		planBuilds = 0;
		exporter._buildLayerExportPlan = (...args) => { planBuilds++; return originalBuild(...args); };
		try {
			await exporter.process({
				visibleLayers, glitterGifs: window.editor.glitterManager.content, canvasData,
				exportSettings: structuredClone(window.editor.exportSettings), target: EXPORT_TARGETS['animation:gif'], callbacks,
				outputFormat: 'mp4',
				scheduleSink: ({ schedulePlan, renderScheduleEntry }) => {
					schedulePlan.entries.forEach((entry, index) => renderScheduleEntry(entry, index));
					return schedulePlan;
				}
			});
			check(planBuilds === visibleLayers.length, 'Animation export rebuilt layer plans during rendering');
		} finally { delete exporter._buildLayerExportPlan; }

		const stillSettings = { ...structuredClone(window.editor.exportSettings), transparency: false, ditherEnabled: false, jpegGenerations: 2, jpegQuality: 80 };
		const originalShow = window.editor.exportResultPresenter.show;
		window.editor.exportResultPresenter.show = () => {};
		try {
			const stillBlob = await window.editor.stillImageExporter.process({
				visibleLayers, glitterGifs: window.editor.glitterManager.content, canvasData,
				exportSettings: stillSettings, target: EXPORT_TARGETS['still:gif'], callbacks, timestamp: 0
			});
			check(stillBlob.type === 'image/gif' && stillBlob.size > 0, 'Shared GIF pipeline did not produce a still GIF');
			for (const targetId of ['still:png', 'still:jpeg']) {
				const target = EXPORT_TARGETS[targetId];
				const blob = await window.editor.stillImageExporter.process({
					visibleLayers, glitterGifs: window.editor.glitterManager.content, canvasData,
					exportSettings: stillSettings, target, callbacks, timestamp: 0
				});
				check(blob.type === target.mimeType && blob.size > 0, `${targetId} did not encode through shared still composition`);
			}
		} finally { window.editor.exportResultPresenter.show = originalShow; }
		let cancelled = false;
		try {
			await exporter.gifEncodingPipeline.encode({
				frames: [new ImageData(1, 1)], settings: { colorCount: 'auto', ditherEnabled: false, quality: 1 },
				transparency: { enabled: false }, isCancelled: () => true
			});
		} catch (error) { cancelled = error.message === 'Export cancelled'; }
		check(cancelled, 'GIF pipeline cancellation did not terminate the local encode job');
		let resolverErrored = false;
		try { resolver.resolveFrame(descriptor('invalid', { width: 1, height: 1, frames: [] }), 0, resolver.createSession()); }
		catch (error) { resolverErrored = true; }
		check(resolverErrored, 'Resolver error fixture did not fail');
		check(Object.keys(exporter.authoredFrameResolver).length === 0
			&& !Object.keys(exporter.gifEncodingPipeline).some((key) => /context|frame|session|source/i.test(key)),
			'Shared services retained per-export resolution state');

		return { sourceKeys: true, resolverParity: true, stillFastPath: true };
	});

	assert(result.sourceKeys && result.resolverParity && result.stillFastPath,
		'Fast-path verifier returned incomplete results');
	assert(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
	console.log('PASS compositor descriptors, timing-only sources, resolver parity/caching, selected-frame work shape, transparency, GIF sentinel/palette propagation, and layer-plan reuse');
	await browser.close();
})().catch((error) => {
	console.error('FAIL', error.stack || error.message);
	process.exit(1);
});

'use strict';

class AuthoredFrameResolver {
	createSession({ isCancelled = null } = {}) {
		const cache = new WeakMap();
		const analysisCache = new WeakMap();
		const replayCache = new WeakMap();
		return {
			throwIfCancelled() {
				if (isCancelled?.()) throw new Error('Export cancelled');
			},
			get(animation, policy, request) {
				const policyCache = cache.get(animation)?.get(policy);
				return policyCache?.get(request);
			},
			set(animation, policy, request, value) {
				let animationCache = cache.get(animation);
				if (!animationCache) {
					animationCache = new Map();
					cache.set(animation, animationCache);
				}
				let policyCache = animationCache.get(policy);
				if (!policyCache) {
					policyCache = new Map();
					animationCache.set(policy, policyCache);
				}
				policyCache.set(request, value);
				return value;
			},
			getAnalysis(animation, policy, analyze) {
				let policyCache = analysisCache.get(animation);
				if (!policyCache) {
					policyCache = new Map();
					analysisCache.set(animation, policyCache);
				}
				if (!policyCache.has(policy)) policyCache.set(policy, analyze());
				return policyCache.get(policy);
			},
			getReplay(animation, policy, create) {
				let policyCache = replayCache.get(animation);
				if (!policyCache) {
					policyCache = new Map();
					replayCache.set(animation, policyCache);
				}
				if (!policyCache.has(policy)) policyCache.set(policy, create());
				return policyCache.get(policy);
			}
		};
	}

	resolveAll(descriptor, session) {
		const animation = descriptor.getAnimation();
		const sourceIdentity = descriptor.sourceIdentity || animation;
		const policy = descriptor.replayPolicy;
		const cached = session.get(sourceIdentity, policy, 'all');
		if (cached) return cached;
		const frames = this._replay(descriptor, animation.frames.length - 1, true, session);
		return session.set(sourceIdentity, policy, 'all', frames);
	}

	resolveFrame(descriptor, targetIndex, session) {
		const animation = descriptor.getAnimation();
		if (!animation.frames?.length) throw new Error(`No frames for "${descriptor.label || descriptor.key}"`);
		const sourceIdentity = descriptor.sourceIdentity || animation;
		const policy = descriptor.replayPolicy;
		const boundedIndex = ((Math.trunc(targetIndex) % animation.frames.length) + animation.frames.length) % animation.frames.length;
		const all = session.get(sourceIdentity, policy, 'all');
		if (all) return all[boundedIndex];
		const replay = session.getReplay(sourceIdentity, policy, () => ({
			checkpoints: [{ nextIndex: 0 }],
			blockStart: -1,
			blockFrames: new Map(),
			cursor: null
		}));
		const cached = replay.blockFrames.get(boundedIndex);
		if (cached) return cached;
		return this._replayFromCheckpoint(descriptor, animation, boundedIndex, session, replay);
	}

	_createReplaySurfaces(animation) {
		const canvas = document.createElement('canvas');
		canvas.width = animation.width;
		canvas.height = animation.height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
		ctx.imageSmoothingEnabled = false;
		const tempCanvas = document.createElement('canvas');
		tempCanvas.width = animation.width;
		tempCanvas.height = animation.height;
		const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true, alpha: true });
		tempCtx.imageSmoothingEnabled = false;
		return { canvas, ctx, tempCanvas, tempCtx };
	}

	_restoreCheckpoint(surfaces, checkpoint) {
		const { ctx, tempCtx } = surfaces;
		if (checkpoint.canvasData) ctx.putImageData(checkpoint.canvasData, 0, 0);
		if (checkpoint.tempCanvasData) tempCtx.putImageData(checkpoint.tempCanvasData, 0, 0);
		return {
			nextIndex: checkpoint.nextIndex,
			previousFrameData: checkpoint.previousFrameData || null,
			previousDisposal: checkpoint.previousDisposal ?? null,
			previousFrameRect: checkpoint.previousFrameRect || null,
			watermarkPrevious: checkpoint.watermarkPrevious || null
		};
	}

	_captureCheckpoint(surfaces, state, width, height) {
		return {
			nextIndex: state.nextIndex,
			canvasData: surfaces.ctx.getImageData(0, 0, width, height),
			tempCanvasData: surfaces.tempCtx.getImageData(0, 0, width, height),
			previousFrameData: state.previousFrameData,
			previousDisposal: state.previousDisposal,
			previousFrameRect: state.previousFrameRect,
			watermarkPrevious: state.watermarkPrevious
		};
	}

	_replayFromCheckpoint(descriptor, animation, targetIndex, session, replay) {
		const interval = CONFIG.export.authoredFrames.checkpointInterval;
		const derivedDisposal = descriptor.replayPolicy === 'derived-glitter' && targetIndex > 0
			? session.getAnalysis(descriptor.sourceIdentity || animation, descriptor.replayPolicy, () => this._analyzeDerivedPolicy(animation))
			: 1;
		let checkpoint = replay.checkpoints[0];
		for (const candidate of replay.checkpoints) {
			if (candidate.nextIndex > targetIndex) break;
			checkpoint = candidate;
		}
		const continuesForward = replay.cursor?.nextIndex === targetIndex
			&& replay.cursor.state.derivedDisposal === derivedDisposal;
		const surfaces = continuesForward ? replay.cursor.surfaces : this._createReplaySurfaces(animation);
		const state = continuesForward ? replay.cursor.state : this._restoreCheckpoint(surfaces, checkpoint);
		state.derivedDisposal = derivedDisposal;
		if (!continuesForward) {
			replay.blockStart = checkpoint.nextIndex;
			replay.blockFrames = new Map();
		}
		let displayed = null;
		for (let index = state.nextIndex; index <= targetIndex; index++) {
			displayed = this._applyFrame(descriptor, animation, index, session, surfaces, state);
			replay.blockFrames.set(index, displayed);
			state.nextIndex = index + 1;
			if (state.nextIndex % interval === 0) {
				if (!replay.checkpoints.some((entry) => entry.nextIndex === state.nextIndex)) {
					replay.checkpoints.push(this._captureCheckpoint(surfaces, state, animation.width, animation.height));
					replay.checkpoints.sort((a, b) => a.nextIndex - b.nextIndex);
				}
				replay.blockStart = state.nextIndex;
				replay.blockFrames.clear();
			}
		}
		replay.cursor = { nextIndex: state.nextIndex, surfaces, state };
		if (displayed && !replay.blockFrames.has(targetIndex)) replay.blockFrames.set(targetIndex, displayed);
		return displayed;
	}

	_applyFrame(descriptor, animation, index, session, surfaces, state) {
		session.throwIfCancelled();
		const { width, height } = animation;
		const frame = animation.frames[index];
		const frameImageData = this._getFrameImageData(frame, width, height);
		if (!frameImageData) throw new Error(`Invalid frame ${index} for "${descriptor.label || descriptor.key}"`);
		const { ctx, tempCtx } = surfaces;
		if (descriptor.replayPolicy === 'watermark-current') {
			// Watermark disposal historically keys off the current patch; parity takes precedence here.
			if (state.watermarkPrevious && frame.disposal === 2) ctx.putImageData(state.watermarkPrevious, 0, 0);
			else if (frame.disposal === 3) ctx.clearRect(0, 0, width, height);
			ctx.putImageData(frameImageData, frame.x || 0, frame.y || 0);
			if (frame.disposal === 2) state.watermarkPrevious = ctx.getImageData(0, 0, width, height);
		} else {
			const currentDisposal = descriptor.replayPolicy === 'native-layer'
				? (frame.disposal === 0 || frame.disposal == null ? 1 : frame.disposal)
				: state.derivedDisposal;
			if (index > 0 && state.previousDisposal === 2) {
				const rect = state.previousFrameRect || { x: 0, y: 0, width, height };
				ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
			} else if (index > 0 && state.previousDisposal === 3 && state.previousFrameData) {
				ctx.putImageData(state.previousFrameData, 0, 0);
			}
			if (currentDisposal === 3) state.previousFrameData = ctx.getImageData(0, 0, width, height);
			// Layer replay intentionally retains the staging canvas and its origin-based patch placement.
			tempCtx.putImageData(frameImageData, 0, 0);
			ctx.drawImage(surfaces.tempCanvas, 0, 0);
			state.previousDisposal = currentDisposal;
			state.previousFrameRect = { x: frame.x || 0, y: frame.y || 0, width: frame.width || width, height: frame.height || height };
		}
		let displayed = ctx.getImageData(0, 0, width, height);
		if (descriptor.transformResolvedFrame) displayed = descriptor.transformResolvedFrame(displayed);
		return displayed;
	}

	_getFrameImageData(frame, width, height) {
		if (frame instanceof ImageData) return frame;
		if (frame?.imageData instanceof ImageData) return frame.imageData;
		if (frame?.data instanceof ImageData) return frame.data;
		if (frame?.data instanceof Uint8ClampedArray) {
			const frameWidth = frame.width || width;
			const frameHeight = frame.height || height;
			if (frame.data.length === frameWidth * frameHeight * 4) {
				return new ImageData(new Uint8ClampedArray(frame.data), frameWidth, frameHeight);
			}
		}
		return null;
	}

	_analyzeDerivedPolicy(animation) {
		const rawFrames = animation.frames;
		const width = animation.width;
		const height = animation.height;
		let hasTransparency = false;
		const first = this._getFrameImageData(rawFrames[0], width, height);
		for (let offset = 3; first && offset < first.data.length; offset += 4) {
			if (first.data[offset] < 255) { hasTransparency = true; break; }
		}
		let usesDeltas = false;
		let needsClearing = false;
		let isAnimation = false;
		if (rawFrames.length > 1) {
			const second = this._getFrameImageData(rawFrames[1], width, height);
			if (!first || !second) throw new Error('Invalid derived animation frames');
			let transparentCount = 0;
			let differentPixels = 0;
			for (let offset = 0; offset < second.data.length; offset += 4) {
				if (second.data[offset + 3] === 0) transparentCount++;
				if (Math.abs(first.data[offset] - second.data[offset]) > 10
					|| Math.abs(first.data[offset + 1] - second.data[offset + 1]) > 10
					|| Math.abs(first.data[offset + 2] - second.data[offset + 2]) > 10
					|| Math.abs(first.data[offset + 3] - second.data[offset + 3]) > 10) differentPixels++;
			}
			const totalPixels = second.data.length / 4;
			const transparentPercent = transparentCount / totalPixels * 100;
			const differentPercent = differentPixels / totalPixels * 100;
			usesDeltas = transparentPercent > 60 || transparentPercent < 30;
			isAnimation = transparentPercent >= 30 && transparentPercent <= 60 && differentPercent < 25;
			needsClearing = (differentPixels > 20 && !usesDeltas) || isAnimation;
		}
		return hasTransparency || needsClearing ? 2 : (usesDeltas ? 1 : 1);
	}

	_replay(descriptor, targetIndex, collectAll, session) {
		const animation = descriptor.getAnimation();
		const rawFrames = animation.frames;
		if (!rawFrames?.length) throw new Error(`No frames for "${descriptor.label || descriptor.key}"`);
		const surfaces = this._createReplaySurfaces(animation);
		const policy = descriptor.replayPolicy;
		const derivedDisposal = policy === 'derived-glitter' && targetIndex > 0
			? session.getAnalysis(descriptor.sourceIdentity || animation, policy, () => this._analyzeDerivedPolicy(animation))
			: 1;
		const state = {
			previousFrameData: null,
			previousDisposal: null,
			previousFrameRect: null,
			watermarkPrevious: null,
			derivedDisposal
		};
		const results = [];

		for (let index = 0; index <= targetIndex; index++) {
			const displayed = this._applyFrame(descriptor, animation, index, session, surfaces, state);
			if (collectAll) results.push(displayed);
			else if (index === targetIndex) return displayed;
		}
		return results;
	}
}

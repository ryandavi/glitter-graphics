'use strict';

class AuthoredFrameResolver {
	createSession({ isCancelled = null } = {}) {
		const cache = new WeakMap();
		const analysisCache = new WeakMap();
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
		const sourceIdentity = descriptor.sourceIdentity || animation;
		const policy = descriptor.replayPolicy;
		const boundedIndex = Math.max(0, Math.min(animation.frames.length - 1, targetIndex));
		const all = session.get(sourceIdentity, policy, 'all');
		if (all) return all[boundedIndex];
		const request = `frame:${boundedIndex}`;
		const cached = session.get(sourceIdentity, policy, request);
		if (cached) return cached;
		return session.set(sourceIdentity, policy, request, this._replay(descriptor, boundedIndex, false, session));
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
		const width = animation.width;
		const height = animation.height;
		if (!rawFrames?.length) throw new Error(`No frames for "${descriptor.label || descriptor.key}"`);
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
		ctx.imageSmoothingEnabled = false;
		const tempCanvas = document.createElement('canvas');
		tempCanvas.width = width;
		tempCanvas.height = height;
		const tempCtx = tempCanvas.getContext('2d', { alpha: true });
		tempCtx.imageSmoothingEnabled = false;
		const policy = descriptor.replayPolicy;
		const derivedDisposal = policy === 'derived-glitter' && targetIndex > 0
			? session.getAnalysis(descriptor.sourceIdentity || animation, policy, () => this._analyzeDerivedPolicy(animation))
			: 1;
		let previousFrameData = null;
		let previousDisposal = null;
		let previousFrameRect = null;
		let watermarkPrevious = null;
		const results = [];

		for (let index = 0; index <= targetIndex; index++) {
			session.throwIfCancelled();
			const frame = rawFrames[index];
			const frameImageData = this._getFrameImageData(frame, width, height);
			if (!frameImageData) throw new Error(`Invalid frame ${index} for "${descriptor.label || descriptor.key}"`);
			if (policy === 'watermark-current') {
				// Watermark disposal historically keys off the current patch; parity takes precedence here.
				if (watermarkPrevious && frame.disposal === 2) ctx.putImageData(watermarkPrevious, 0, 0);
				else if (frame.disposal === 3) ctx.clearRect(0, 0, width, height);
				ctx.putImageData(frameImageData, frame.x || 0, frame.y || 0);
				if (frame.disposal === 2) watermarkPrevious = ctx.getImageData(0, 0, width, height);
			} else {
				const currentDisposal = policy === 'native-layer'
					? (frame.disposal === 0 || frame.disposal == null ? 1 : frame.disposal)
					: derivedDisposal;
				if (index > 0 && previousDisposal === 2) {
					const rect = previousFrameRect || { x: 0, y: 0, width, height };
					ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
				} else if (index > 0 && previousDisposal === 3 && previousFrameData) {
					ctx.putImageData(previousFrameData, 0, 0);
				}
				if (currentDisposal === 3) previousFrameData = ctx.getImageData(0, 0, width, height);
				// Layer replay intentionally retains the staging canvas and its origin-based patch placement.
				tempCtx.putImageData(frameImageData, 0, 0);
				ctx.drawImage(tempCanvas, 0, 0);
				previousDisposal = currentDisposal;
				previousFrameRect = { x: frame.x || 0, y: frame.y || 0, width: frame.width || width, height: frame.height || height };
			}
			let displayed = ctx.getImageData(0, 0, width, height);
			if (descriptor.transformResolvedFrame) displayed = descriptor.transformResolvedFrame(displayed);
			if (collectAll) results.push(displayed);
			else if (index === targetIndex) return displayed;
		}
		return results;
	}
}

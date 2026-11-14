'use strict';

// Take Photo, a small photo booth in #cameraModal: a live camera preview, shot
// modes (Photo, Grid, Strip, GIF from CONFIG.tools.camera.modes), a countdown
// with beeps, a flash and shutter sound per shot, and Effects: filter looks
// previewed live over the camera. Use opens the result the way Open Image does
// (openEditorFiles), so canvas size, the base image and history follow the
// image path; a GIF opens as an animated base. A chosen effect becomes a
// Filter layer above the base image, so it stays editable. The stream stops
// whenever the modal closes, the photo is used, or the page hides.
class CameraCapture {
	// False once enumerateDevices reports no camera. Before permission, browsers
	// still list one empty-labelled videoinput when a camera exists, so this
	// needs no prompt. Unknown or unlistable counts as available, since a
	// hidden button is worse than one that fails with a clear message.
	static hasCamera = null;
	static availabilityListeners = [];

	static isSupported() {
		return Boolean(navigator.mediaDevices?.getUserMedia) && CameraCapture.hasCamera !== false;
	}

	// Calls onChange now, whenever a camera is plugged in or removed, and when
	// opening the camera proves the listed one is not there.
	static watchAvailability(onChange) {
		CameraCapture.availabilityListeners.push(onChange);
		const media = navigator.mediaDevices;
		if (!media?.getUserMedia || !media.enumerateDevices) { onChange(); return; }
		const check = () => media.enumerateDevices()
			.then(devices => { CameraCapture.hasCamera = devices.some(device => device.kind === 'videoinput'); })
			.catch(() => { CameraCapture.hasCamera = null; })
			.then(onChange);
		media.addEventListener?.('devicechange', check);
		check();
	}

	// Some systems list a video input that cannot be opened (a virtual camera
	// driver, a disabled device). Once getUserMedia says no camera was found,
	// Take Photo hides until the next device change lists one again.
	static markUnavailable() {
		CameraCapture.hasCamera = false;
		CameraCapture.availabilityListeners.forEach(listener => listener());
	}

	constructor(editor) {
		this.editor = editor;
		this.stream = null;
		this.deviceId = '';
		this.phase = 'live';
		this.sequence = null;
		this.result = null;
		this.effect = null;
		this.audio = null;
		this.frameRequest = null;
		this.renderChain = Promise.resolve();
		this.workCanvases = new WeakMap();
		this.lookData = new Map();
		this.ui = Object.fromEntries(['cameraModal', 'cameraStage', 'cameraVideo', 'cameraView', 'cameraFlash', 'cameraCountdownBadge', 'cameraEffects', 'cameraModes', 'cameraTakeBtn', 'cameraEffectsBtn', 'cameraMirror', 'cameraDevice', 'cameraCountdown', 'cameraBounce', 'cameraSoundBtn', 'cameraRetakeBtn', 'cameraUseBtn']
			.map(id => [id.replace(/^camera/, '').replace(/^./, char => char.toLowerCase()), document.getElementById(id)]));
		const modes = CONFIG.tools.camera.modes;
		this.mode = Object.hasOwn(modes, PREFERENCES.get('cameraMode')) ? PREFERENCES.get('cameraMode') : Object.keys(modes)[0];
		this.countdownSeconds = CONFIG.tools.camera.countdownSeconds[0];
		this.ui.countdown.querySelectorAll('[data-value]').forEach(button => button.addEventListener('click', () => {
			this.countdownSeconds = Number(button.dataset.value);
			this.syncCountdown();
		}));
		this.buildModes();
		this.buildEffects();
		this.ui.mirror.addEventListener('change', () => this.syncMirror());
		this.ui.device.addEventListener('change', () => { this.deviceId = this.ui.device.value; this.start(); });
		this.ui.bounce.addEventListener('change', () => { this.reviewStart = performance.now(); });
		this.ui.takeBtn.addEventListener('click', () => this.take());
		this.ui.effectsBtn.addEventListener('click', () => this.setEffectsOpen(this.ui.effects.hidden));
		this.ui.soundBtn.addEventListener('click', () => { PREFERENCES.set('cameraSound', !PREFERENCES.get('cameraSound')); this.syncSound(); });
		this.ui.retakeBtn.addEventListener('click', () => { this.retake(); if (!this.stream) this.start(); });
		this.ui.useBtn.addEventListener('click', () => this.use());
		document.addEventListener('visibilitychange', () => {
			if (document.hidden) this.stop();
			else if (this.isOpen() && this.phase !== 'review') this.start();
		});
		editor.modalManager.register('cameraModal', {
			closeBtnId: 'closeCameraModal',
			resetScrollOnOpen: true,
			initialFocusSelector: '#cameraTakeBtn',
			onOpen: () => { this.retake(); this.start(); this.startLoop(); },
			onClose: () => { this.stop(); this.stopLoop(); this.setEffectsOpen(false); }
		});
		this.syncCountdown();
		this.syncModes();
		this.syncSound();
	}

	isOpen() { return this.editor.modalManager.stack.some(config => config.id === 'cameraModal'); }

	open() {
		if (!CameraCapture.isSupported()) { this.editor.showError('This browser cannot use a camera.'); return; }
		this.editor.modalManager.open('cameraModal');
	}

	// ── Stream ──

	async start() {
		this.stop();
		const { idealWidth, idealHeight } = CONFIG.tools.camera;
		const video = { width: { ideal: idealWidth }, height: { ideal: idealHeight }, ...(this.deviceId ? { deviceId: { exact: this.deviceId } } : { facingMode: 'user' }) };
		const request = this.request = {};
		let stream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
		} catch (error) {
			if (request !== this.request) return;
			this.fail(error);
			return;
		}
		// Closed, hidden or restarted while permission was pending.
		if (request !== this.request || !this.isOpen() || document.hidden) { stream.getTracks().forEach(track => track.stop()); return; }
		this.stream = stream;
		this.ui.video.srcObject = stream;
		this.ui.video.play?.().catch(() => {});
		const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
		// A front or desktop camera previews like a mirror; a rear camera does not.
		if (!this.deviceId) this.ui.mirror.checked = settings.facingMode !== 'environment';
		this.deviceId = settings.deviceId || this.deviceId;
		this.syncMirror();
		await this.listDevices();
	}

	async listDevices() {
		const devices = (await navigator.mediaDevices.enumerateDevices?.().catch(() => []) || []).filter(device => device.kind === 'videoinput');
		this.ui.device.replaceChildren(...devices.map((device, index) => {
			const option = document.createElement('option');
			option.value = device.deviceId; option.textContent = device.label || `Camera ${index + 1}`;
			option.selected = device.deviceId === this.deviceId;
			return option;
		}));
		this.ui.device.closest('.property-row').hidden = devices.length < 2;
	}

	// Stops the stream and any shot sequence; a review stays on screen.
	stop() {
		this.request = null;
		this.cancelSequence();
		this.stream?.getTracks().forEach(track => track.stop());
		this.stream = null;
		this.ui.video.srcObject = null;
	}

	fail(error) {
		const messages = {
			NotAllowedError: 'Camera access was blocked. Allow the camera in your browser’s site settings to take a photo.',
			SecurityError: 'Camera access was blocked. Allow the camera in your browser’s site settings to take a photo.',
			NotFoundError: 'No camera was found.',
			OverconstrainedError: 'That camera is no longer available.',
			NotReadableError: 'The camera is busy. Close other apps using it and try again.',
			AbortError: 'The camera is busy. Close other apps using it and try again.'
		};
		this.editor.modalManager.close('cameraModal');
		if (error?.name === 'NotFoundError') CameraCapture.markUnavailable();
		this.editor.showError(messages[error?.name] || 'The camera could not start.');
	}

	// ── Settings ──

	syncMirror() { this.ui.stage.classList.toggle('is-mirrored', this.ui.mirror.checked); }

	syncCountdown() {
		this.ui.countdown.querySelectorAll('[data-value]').forEach(button => {
			const active = Number(button.dataset.value) === this.countdownSeconds;
			button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
		});
	}

	buildModes() {
		this.ui.modes.replaceChildren(...Object.entries(CONFIG.tools.camera.modes).map(([id, mode]) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'segmented-option';
			button.dataset.mode = id;
			button.textContent = mode.label;
			button.addEventListener('click', () => {
				this.mode = id;
				PREFERENCES.set('cameraMode', id);
				this.syncModes();
			});
			return button;
		}));
	}

	syncModes() {
		this.ui.modes.querySelectorAll('[data-mode]').forEach(button => {
			const active = button.dataset.mode === this.mode;
			button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
		});
	}

	syncSound() {
		const on = PREFERENCES.get('cameraSound');
		this.ui.soundBtn.setAttribute('aria-pressed', String(on));
		this.ui.soundBtn.title = on ? 'Sound on' : 'Sound off';
		this.ui.soundBtn.querySelector('use').setAttribute('href', on ? '#icon-sound' : '#icon-sound-off');
	}

	// ── Shot sequence ──

	// Countdown before the first shot, then the mode's shots `intervalMs`
	// apart, each with a shutter sound and (except a GIF burst) a flash.
	async take() {
		if (!this.stream || this.sequence || this.phase !== 'live' || !this.ui.video.videoWidth) return;
		const mode = CONFIG.tools.camera.modes[this.mode];
		const sequence = this.sequence = { cancelled: false, timer: null, resolve: null };
		const size = this.shotSize(mode);
		const shots = [];
		this.setEffectsOpen(false);
		this.setPhase('shooting');
		for (let remaining = this.countdownSeconds; remaining > 0; remaining--) {
			this.showBadge(String(remaining));
			this.playSound(remaining === 1 ? 'lastBeep' : 'beep');
			if (!await this.wait(1000, sequence)) return;
		}
		for (let index = 0; index < mode.shots; index++) {
			if (index) {
				if (!mode.animated) this.showBadge(`${index + 1} of ${mode.shots}`, true);
				if (!await this.wait(mode.intervalMs, sequence)) return;
			}
			this.hideBadge();
			shots.push(this.captureFrame(size));
			this.playSound('shutter');
			// A GIF burst flashes once: a flash every frame would strobe.
			if (!mode.animated || !index) this.flash();
		}
		this.sequence = null;
		this.result = mode.layout
			? { image: this.composeLayout(shots, mode.layout, size) }
			: mode.animated ? { frames: shots, delayMs: mode.intervalMs } : { image: shots[0] };
		this.setPhase('review');
		this.ui.useBtn.focus();
	}

	wait(ms, sequence) {
		return new Promise(resolve => {
			sequence.resolve = resolve;
			sequence.timer = setTimeout(() => resolve(!sequence.cancelled), ms);
		});
	}

	cancelSequence() {
		const sequence = this.sequence;
		this.hideBadge();
		if (!sequence) return;
		this.sequence = null;
		sequence.cancelled = true;
		clearTimeout(sequence.timer);
		sequence.resolve?.(false);
		if (this.phase === 'shooting') this.setPhase('live');
	}

	showBadge(text, small = false) {
		this.ui.countdownBadge.hidden = false;
		this.ui.countdownBadge.textContent = text;
		this.ui.countdownBadge.classList.toggle('is-count', small);
	}

	hideBadge() { this.ui.countdownBadge.hidden = true; }

	// The size of one shot. A composed layout shrinks its cells so the whole
	// result fits the canvas limits; nothing the booth makes asks to be resized.
	shotSize(mode) {
		const { videoWidth: width, videoHeight: height } = this.ui.video;
		if (!mode.layout) return { ...this.editor.getConstrainedCanvasSize(width, height), gutter: 0 };
		const gutter = CONFIG.tools.camera.grid.gutter * Math.min(width, height);
		const full = this.layoutSize(mode.layout, { width, height, gutter });
		const fitted = this.editor.getConstrainedCanvasSize(full.width, full.height);
		const scale = Math.min(1, fitted.width / full.width, fitted.height / full.height);
		return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), gutter: Math.floor(gutter * scale) };
	}

	layoutSize({ columns, rows }, cell) {
		return { width: columns * cell.width + (columns + 1) * cell.gutter, height: rows * cell.height + (rows + 1) * cell.gutter };
	}

	composeLayout(shots, layout, cell) {
		const size = this.layoutSize(layout, cell);
		const canvas = createAppCanvas(size.width, size.height, 'camera/layout');
		const ctx = canvas.getContext('2d');
		ctx.fillStyle = CONFIG.tools.camera.grid.background;
		ctx.fillRect(0, 0, size.width, size.height);
		shots.forEach((shot, index) => {
			const column = index % layout.columns, row = Math.floor(index / layout.columns);
			ctx.drawImage(shot, cell.gutter + column * (cell.width + cell.gutter), cell.gutter + row * (cell.height + cell.gutter));
		});
		return canvas;
	}

	// One camera frame as the preview shows it, mirror included.
	captureFrame({ width, height }) {
		const canvas = createAppCanvas(width, height, 'camera/shot');
		this.drawSource(canvas.getContext('2d'), this.ui.video, width, height, this.ui.mirror.checked);
		return canvas;
	}

	drawSource(ctx, source, width, height, mirror) {
		ctx.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? width : 0, 0);
		ctx.drawImage(source, 0, 0, width, height);
		ctx.setTransform(1, 0, 0, 1, 0, 0);
	}

	retake() {
		this.result = null;
		this.setPhase('live');
	}

	setPhase(phase) {
		this.phase = phase;
		const review = phase === 'review';
		this.reviewStart = performance.now();
		this.painted = null;
		this.ui.takeBtn.hidden = review;
		this.ui.takeBtn.disabled = phase === 'shooting';
		this.ui.modes.querySelectorAll('button').forEach(button => { button.disabled = phase !== 'live'; });
		this.ui.effectsBtn.disabled = phase === 'shooting';
		this.ui.retakeBtn.hidden = !review;
		this.ui.useBtn.hidden = !review;
		this.ui.useBtn.disabled = false;
		this.ui.useBtn.querySelector('.name').textContent = this.result?.frames ? 'Use GIF' : 'Use Photo';
		this.ui.mirror.disabled = phase !== 'live';
		this.ui.device.disabled = phase !== 'live';
		this.ui.bounce.closest('.property-row').hidden = !(review && this.result?.frames);
	}

	// Bounce plays the frames forward then back, without repeating the ends.
	reviewFrames() {
		const frames = this.result?.frames || [];
		return this.ui.bounce.checked && frames.length > 2 ? [...frames, ...frames.slice(1, -1).reverse()] : frames;
	}

	reviewSource(now) {
		if (this.result?.image) return this.result.image;
		const frames = this.reviewFrames();
		return frames[Math.floor((now - this.reviewStart) / this.result.delayMs) % frames.length] || null;
	}

	// ── Booth feel ──

	flash() {
		const flash = this.ui.flash;
		flash.classList.add('is-flashing');
		clearTimeout(this.flashTimer);
		this.flashTimer = setTimeout(() => flash.classList.remove('is-flashing'), CONFIG.tools.camera.flashMs);
	}

	// Made by the browser (Web Audio), no sound files. The context starts on
	// the shutter click, a user gesture, so autoplay rules allow it.
	playSound(kind) {
		if (!PREFERENCES.get('cameraSound')) return;
		const AudioContextClass = window.AudioContext || window.webkitAudioContext;
		if (!AudioContextClass) return;
		const audio = this.audio ||= new AudioContextClass();
		audio.resume?.().catch(() => {});
		const { volume, shutterMs, beepMs, beepHz, lastBeepHz } = CONFIG.tools.camera.sound;
		const now = audio.currentTime;
		const gain = audio.createGain();
		gain.connect(audio.destination);
		if (kind === 'shutter') {
			// A short burst of band-passed noise with a fast decay.
			const length = Math.max(1, Math.round(audio.sampleRate * shutterMs / 1000));
			const buffer = audio.createBuffer(1, length, audio.sampleRate);
			const data = buffer.getChannelData(0);
			for (let index = 0; index < length; index++) data[index] = (Math.random() * 2 - 1) * (1 - index / length) ** 3;
			const noise = audio.createBufferSource();
			noise.buffer = buffer;
			const filter = audio.createBiquadFilter();
			filter.type = 'bandpass'; filter.frequency.value = 2400; filter.Q.value = 0.8;
			gain.gain.value = volume;
			noise.connect(filter).connect(gain);
			noise.start(now);
			return;
		}
		const tone = audio.createOscillator();
		tone.type = 'sine';
		tone.frequency.value = kind === 'lastBeep' ? lastBeepHz : beepHz;
		gain.gain.setValueAtTime(volume, now);
		gain.gain.exponentialRampToValueAtTime(0.0001, now + beepMs / 1000);
		tone.connect(gain);
		tone.start(now);
		tone.stop(now + beepMs / 1000);
	}

	// ── Effects ──

	// A 3×3 grid: None in the centre, the CONFIG looks around it.
	buildEffects() {
		const looks = CONFIG.tools.camera.effects.looks.filter(id => GlitterFilters.looksLibrary.get(id));
		const middle = Math.floor(looks.length / 2);
		this.effectCells = [...looks.slice(0, middle), null, ...looks.slice(middle)].map(lookId => {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'camera-effect';
			button.dataset.effect = lookId || '';
			const canvas = document.createElement('canvas');
			const label = document.createElement('span');
			label.textContent = lookId ? GlitterFilters.looksLibrary.get(lookId).label : 'None';
			button.append(canvas, label);
			button.addEventListener('click', () => { this.setEffect(lookId); this.setEffectsOpen(false); });
			return { lookId, canvas, button };
		});
		this.ui.effects.replaceChildren(...this.effectCells.map(cell => cell.button));
		this.setEffect(null);
	}

	setEffect(lookId) {
		this.effect = lookId;
		this.painted = null;
		this.effectCells.forEach(cell => {
			const active = cell.lookId === lookId;
			cell.button.classList.toggle('active', active); cell.button.setAttribute('aria-pressed', String(active));
		});
		const label = lookId ? GlitterFilters.looksLibrary.get(lookId).label : '';
		this.ui.effectsBtn.querySelector('.name').textContent = label ? `Effects: ${label}` : 'Effects';
		this.ui.effectsBtn.classList.toggle('active', Boolean(lookId));
	}

	setEffectsOpen(open) {
		this.ui.effects.hidden = !open;
		this.ui.effectsBtn.setAttribute('aria-pressed', String(open));
		this.lastCellsPaint = 0;
		if (open) this.ui.effects.querySelector('.active')?.focus();
	}

	filterDataFor(lookId) {
		if (!this.lookData.has(lookId)) this.lookData.set(lookId, GlitterFilter.normalizeFilterData(GlitterFilters.looksLibrary.apply(lookId)));
		return this.lookData.get(lookId);
	}

	// ── View loop ──

	// The stage shows the plain video while live with no effect. Otherwise a
	// canvas over it shows the look (on a timer) or the review result.
	startLoop() {
		this.stopLoop();
		const tick = (now) => {
			this.frameRequest = requestAnimationFrame(tick);
			this.paintStage(now);
			this.paintCells(now);
		};
		this.frameRequest = requestAnimationFrame(tick);
	}

	stopLoop() {
		if (this.frameRequest) cancelAnimationFrame(this.frameRequest);
		this.frameRequest = null;
	}

	currentSource(now) {
		if (this.phase === 'review') return this.reviewSource(now);
		return this.ui.video.videoWidth ? this.ui.video : null;
	}

	paintStage(now) {
		const source = this.phase === 'review' || this.effect ? this.currentSource(now) : null;
		this.ui.view.hidden = !source;
		if (!source || this.stageBusy) return;
		const live = source === this.ui.video;
		if (!live && this.painted?.source === source && this.painted.effect === this.effect) return;
		if (live && now - (this.painted?.at || 0) < CONFIG.tools.camera.effects.stageIntervalMs) return;
		this.painted = { source, effect: this.effect, at: now };
		const width = this.effect ? CONFIG.tools.camera.effects.stageWidth : (source.width || source.videoWidth);
		this.stageBusy = true;
		this.paintLook(this.ui.view, source, width, this.effect).finally(() => { this.stageBusy = false; });
	}

	paintCells(now) {
		if (this.ui.effects.hidden || this.cellsBusy || now - (this.lastCellsPaint || 0) < CONFIG.tools.camera.effects.cellIntervalMs) return;
		const source = this.currentSource(now);
		if (!source) return;
		this.lastCellsPaint = now;
		this.cellsBusy = true;
		const width = CONFIG.tools.camera.effects.cellWidth;
		Promise.all(this.effectCells.map(cell => this.paintLook(cell.canvas, source, width, cell.lookId)))
			.finally(() => { this.cellsBusy = false; });
	}

	// Renders `source` through a look into `target`. Booth renders run one at a
	// time in a chain, so a slow async look (Deep Fry) can't pile up renders.
	paintLook(target, source, width, lookId) {
		const run = async () => {
			const sourceWidth = source.videoWidth || source.width, sourceHeight = source.videoHeight || source.height;
			if (!sourceWidth || !sourceHeight) return;
			const w = Math.max(1, Math.min(Math.round(width), sourceWidth));
			const h = Math.max(1, Math.round(w * sourceHeight / sourceWidth));
			let work = this.workCanvases.get(target);
			if (!work) { work = createAppCanvas(w, h, 'camera/effect'); this.workCanvases.set(target, work); }
			if (work.width !== w) work.width = w;
			if (work.height !== h) work.height = h;
			const ctx = work.getContext('2d', { willReadFrequently: true });
			this.drawSource(ctx, source, w, h, source === this.ui.video && this.ui.mirror.checked);
			if (lookId) await GlitterFilter.renderToCanvas(ctx, w, h, this.filterDataFor(lookId), 1, {});
			if (target.width !== w) target.width = w;
			if (target.height !== h) target.height = h;
			target.getContext('2d').drawImage(work, 0, 0);
		};
		this.renderChain = this.renderChain.then(run).catch(error => console.error('Camera effect failed:', error));
		return this.renderChain;
	}

	// ── Use ──

	async use() {
		if (this.phase !== 'review' || this.ui.useBtn.disabled) return;
		this.ui.useBtn.disabled = true;
		const effect = this.effect;
		let file = null;
		try {
			file = await this.resultFile();
		} catch (error) {
			console.error('Camera result failed:', error);
		}
		this.editor.modalManager.close('cameraModal');
		if (!file) { this.editor.showError('Could not save the photo.'); return; }
		if (!await openEditorFiles(this.editor, [file], { asDocument: true }) || !effect) return;
		// The look sits right above the base image, as a Filter layer.
		const layers = this.editor.layerManager;
		const base = layers.getBaseLayer();
		if (base) layers.setActiveLayer(base.id);
		layers.addLayer(LayerType.FILTER, { filterLayer: { filterData: GlitterFilters.looksLibrary.apply(effect) } });
	}

	// A PNG of the image, or a GIF of the frames in review order.
	async resultFile() {
		const { fileNames } = CONFIG.tools.camera;
		if (this.result.image) {
			const blob = await encodeCanvasToBlob(this.result.image, 'image/png');
			return blob && new File([blob], fileNames.image, { type: 'image/png' });
		}
		const frames = this.reviewFrames();
		const done = this.editor.beginActivity('camera-gif', 'Making GIF');
		try {
			const { blob } = await this.editor.gifEncodingPipeline.encode({
				frames: frames.map(frame => frame.getContext('2d').getImageData(0, 0, frame.width, frame.height)),
				delays: frames.map(() => this.result.delayMs),
				settings: { ...CONFIG.export.defaults },
				transparency: { enabled: false },
				mode: 'animation'
			});
			return new File([blob], fileNames.animation, { type: 'image/gif' });
		} finally { done(); }
	}
}

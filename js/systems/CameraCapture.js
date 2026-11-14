'use strict';

// Take Photo, a small photo booth in #cameraModal: a live camera preview, shot
// modes (Photo, Grid, Strip, GIF from CONFIG.tools.camera.modes), a countdown
// with beeps before each shot, a flash and shutter sound per shot, an aspect
// crop guide, and Effects: filter looks previewed live over the camera, with
// an optional Webcam look under them. Every take goes into a roll under the
// stage; the shutter always shoots a new one, and Use opens the selected take
// the way Open Image does (openEditorFiles), so canvas size, the base image
// and history follow the image path; a GIF opens as an animated base. The
// looks become Filter layers above the base image, so they stay editable. The
// stream stops whenever the modal closes, the photo is used, or the page hides.
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
		// Takes, oldest first; `selected` is the one the stage reviews and Use opens.
		this.roll = [];
		this.selected = null;
		this.takeCount = 0;
		this.effect = null;
		this.audio = null;
		this.frameRequest = null;
		this.renderChain = Promise.resolve();
		this.workCanvases = new WeakMap();
		this.lookData = new Map();
		this.paintCount = 0;
		this.ui = Object.fromEntries(['cameraModal', 'cameraStage', 'cameraVideo', 'cameraView', 'cameraCrop', 'cameraFlash', 'cameraCountdownBadge', 'cameraEffects', 'cameraRoll', 'cameraModes', 'cameraTakeBtn', 'cameraEffectsBtn', 'cameraUseBtn', 'cameraMirror', 'cameraDevice', 'cameraCountdown', 'cameraAspect', 'cameraCapture', 'cameraWebcam', 'cameraSound', 'cameraBounce', 'cameraSpeed']
			.map(id => [id.replace(/^camera/, '').replace(/^./, char => char.toLowerCase()), document.getElementById(id)]));
		const { modes, aspects, countdownSeconds } = CONFIG.tools.camera;
		const remembered = (key, table) => (Object.hasOwn(table, PREFERENCES.get(key)) ? PREFERENCES.get(key) : Object.keys(table)[0]);
		this.mode = remembered('cameraMode', modes);
		this.aspect = remembered('cameraAspect', aspects);
		this.gifCapture = remembered('cameraGifCapture', modes.gif.capture);
		this.speed = modes.gif.defaultSpeed;
		this.countdownSeconds = countdownSeconds[0];
		this.bindChoice(this.ui.countdown, String(this.countdownSeconds), value => { this.countdownSeconds = Number(value); });
		this.bindChoice(this.ui.aspect, this.aspect, value => { this.aspect = value; PREFERENCES.set('cameraAspect', value); this.syncCrop(); });
		this.bindChoice(this.ui.capture, this.gifCapture, value => { this.gifCapture = value; PREFERENCES.set('cameraGifCapture', value); });
		this.bindChoice(this.ui.speed, this.speed, value => { this.speed = value; this.reviewStart = performance.now(); });
		this.buildModes();
		this.buildEffects();
		this.ui.mirror.addEventListener('change', () => this.syncMirror());
		this.ui.device.addEventListener('change', () => { this.deviceId = this.ui.device.value; this.start(); });
		this.ui.bounce.addEventListener('change', () => { this.reviewStart = performance.now(); });
		this.ui.webcam.addEventListener('change', () => { this.painted = null; this.lastCellsPaint = 0; });
		this.ui.sound.checked = PREFERENCES.get('cameraSound');
		this.ui.sound.addEventListener('change', () => PREFERENCES.set('cameraSound', this.ui.sound.checked));
		this.ui.video.addEventListener('resize', () => this.syncStageAspect());
		this.ui.video.addEventListener('loadedmetadata', () => this.syncStageAspect());
		this.ui.takeBtn.addEventListener('click', () => this.take());
		this.ui.effectsBtn.addEventListener('click', () => this.setEffectsOpen(this.ui.effects.hidden));
		this.ui.useBtn.addEventListener('click', () => this.use());
		document.addEventListener('visibilitychange', () => {
			if (document.hidden) this.stop();
			else if (this.isOpen()) this.start();
		});
		editor.modalManager.register('cameraModal', {
			closeBtnId: 'closeCameraModal',
			resetScrollOnOpen: true,
			initialFocusSelector: '#cameraTakeBtn',
			onOpen: () => { this.clearRoll(); this.setPhase('live'); this.start(); this.startLoop(); },
			onClose: () => { this.stop(); this.stopLoop(); this.setEffectsOpen(false); this.clearRoll(); }
		});
		this.syncModes();
		this.clearRoll();
		this.setPhase('live');
	}

	// The selected take, as the tests read it.
	get result() { return this.selected; }

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

	// A settings segmented control: pick a value, mark it active.
	bindChoice(control, value, onPick) {
		control.querySelectorAll('[data-value]').forEach(button => button.addEventListener('click', () => {
			onPick(button.dataset.value);
			this.syncChoice(control, button.dataset.value);
		}));
		this.syncChoice(control, value);
	}

	syncChoice(control, value) {
		control.querySelectorAll('[data-value]').forEach(button => {
			const active = button.dataset.value === value;
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
		// Capture (Burst or Stop motion) only applies to a GIF.
		this.ui.capture.closest('.property-row').hidden = !CONFIG.tools.camera.modes[this.mode].animated;
	}

	// The stage takes the camera's shape, so the video fills it and the crop
	// guide can be placed in percentages.
	syncStageAspect() {
		const { videoWidth: width, videoHeight: height } = this.ui.video;
		if (width && height) this.ui.stage.style.setProperty('--camera-aspect', String(width / height));
		this.syncCrop();
	}

	aspectRatio() { return CONFIG.tools.camera.aspects[this.aspect]?.ratio || null; }

	// The centred part of a width × height frame at `ratio` (width over height).
	cropRect(ratio, width = this.ui.video.videoWidth, height = this.ui.video.videoHeight) {
		if (!ratio || !width || !height) return { x: 0, y: 0, width, height };
		if (width / height > ratio) {
			const cropWidth = Math.round(height * ratio);
			return { x: Math.round((width - cropWidth) / 2), y: 0, width: cropWidth, height };
		}
		const cropHeight = Math.round(width / ratio);
		return { x: 0, y: Math.round((height - cropHeight) / 2), width, height: cropHeight };
	}

	// Dims the stage outside the chosen aspect: live, the setting; reviewing a
	// Photo or GIF take, the aspect Use will crop it to.
	syncCrop() {
		const ratio = this.phase === 'review' ? this.selected?.ratio : this.aspectRatio();
		const { videoWidth: width, videoHeight: height } = this.ui.video;
		this.ui.crop.hidden = !ratio || !width || !height;
		if (this.ui.crop.hidden) return;
		const rect = this.cropRect(ratio, width, height);
		Object.assign(this.ui.crop.style, {
			left: `${rect.x / width * 100}%`, top: `${rect.y / height * 100}%`,
			width: `${rect.width / width * 100}%`, height: `${rect.height / height * 100}%`
		});
	}

	// ── Shot sequence ──

	// A countdown before the first shot, and before every Grid or Strip shot;
	// with Countdown off, shots are `intervalMs` apart. A GIF captures its
	// frames in a burst or, for stop motion, one a second with a beep and a
	// flash each. A Grid or Strip take fills in on the roll as it is shot.
	async take() {
		if (!this.stream || this.sequence || this.phase === 'shooting' || !this.ui.video.videoWidth) return;
		const mode = CONFIG.tools.camera.modes[this.mode];
		const capture = mode.animated ? mode.capture[this.gifCapture] : null;
		const sequence = this.sequence = { cancelled: false, timer: null, resolve: null, pending: null };
		const size = this.shotSize(mode);
		const shots = [];
		this.setEffectsOpen(false);
		this.setPhase('shooting');
		if (mode.layout) sequence.pending = this.addTake({ mode: this.mode, layout: mode.layout, size, pending: true });
		for (let index = 0; index < mode.shots; index++) {
			const caption = mode.layout || capture?.cue ? `${index + 1} of ${mode.shots}` : '';
			const countdown = !index || mode.layout ? this.countdownSeconds : 0;
			if (countdown) {
				for (let remaining = countdown; remaining > 0; remaining--) {
					this.showBadge(String(remaining), caption);
					this.playSound(remaining === 1 ? 'lastBeep' : 'beep');
					if (!await this.wait(1000, sequence)) return;
				}
			} else if (index) {
				const gap = capture ? capture.intervalMs : mode.intervalMs;
				if (caption) this.showBadge('', caption);
				const lead = capture?.cue ? Math.min(gap, CONFIG.tools.camera.sound.cueLeadMs) : 0;
				if (!await this.wait(gap - lead, sequence)) return;
				if (lead) {
					this.playSound('lastBeep');
					if (!await this.wait(lead, sequence)) return;
				}
			}
			this.hideBadge();
			shots.push(this.captureFrame(size));
			this.playSound('shutter');
			// A GIF burst flashes once: a flash every frame would strobe. Stop
			// motion is one a second, under the photosensitivity line.
			if (!mode.animated || !index || capture.cue) this.flash();
			if (sequence.pending) this.drawLayoutThumb(sequence.pending, shots);
		}
		this.sequence = null;
		let take = sequence.pending;
		if (take) {
			take.pending = false;
			take.image = this.composeLayout(shots, mode.layout, size);
		} else {
			// Photo and GIF keep the full frame; Use crops to the aspect.
			const ratio = this.aspectRatio();
			take = this.addTake(mode.animated ? { mode: this.mode, frames: shots, ratio } : { mode: this.mode, image: shots[0], ratio });
		}
		this.selected = take;
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
		if (sequence.pending) this.removeTake(sequence.pending);
		if (this.phase === 'shooting') this.setPhase('live');
	}

	// A big count with an optional caption ("2 of 4"), or the caption alone.
	showBadge(count, caption = '') {
		const badge = this.ui.countdownBadge;
		badge.hidden = false;
		badge.querySelector('strong').textContent = count;
		badge.querySelector('small').textContent = caption;
		badge.classList.toggle('is-count', !count);
	}

	hideBadge() { this.ui.countdownBadge.hidden = true; }

	// The size of one shot and the part of the frame it keeps. A composed
	// layout crops each cell to the aspect and shrinks the cells so the whole
	// result fits the canvas limits; nothing the booth makes asks to be resized.
	shotSize(mode) {
		const crop = this.cropRect(mode.layout ? this.aspectRatio() : null);
		if (!mode.layout) return { ...this.editor.getConstrainedCanvasSize(crop.width, crop.height), gutter: 0, crop };
		const gutter = CONFIG.tools.camera.grid.gutter * Math.min(crop.width, crop.height);
		const full = this.layoutSize(mode.layout, { width: crop.width, height: crop.height, gutter });
		const fitted = this.editor.getConstrainedCanvasSize(full.width, full.height);
		const scale = Math.min(1, fitted.width / full.width, fitted.height / full.height);
		return { width: Math.max(1, Math.floor(crop.width * scale)), height: Math.max(1, Math.floor(crop.height * scale)), gutter: Math.floor(gutter * scale), crop };
	}

	layoutSize({ columns, rows }, cell) {
		return { width: columns * cell.width + (columns + 1) * cell.gutter, height: rows * cell.height + (rows + 1) * cell.gutter };
	}

	// Draws the shots so far into a layout at `scale`; empty cells stay background.
	drawLayout(ctx, shots, layout, cell, scale = 1) {
		const size = this.layoutSize(layout, cell);
		ctx.fillStyle = CONFIG.tools.camera.grid.background;
		ctx.fillRect(0, 0, size.width * scale, size.height * scale);
		shots.forEach((shot, index) => {
			const column = index % layout.columns, row = Math.floor(index / layout.columns);
			const x = cell.gutter + column * (cell.width + cell.gutter), y = cell.gutter + row * (cell.height + cell.gutter);
			ctx.drawImage(shot, x * scale, y * scale, cell.width * scale, cell.height * scale);
		});
	}

	composeLayout(shots, layout, cell) {
		const size = this.layoutSize(layout, cell);
		const canvas = createAppCanvas(size.width, size.height, 'camera/layout');
		this.drawLayout(canvas.getContext('2d'), shots, layout, cell);
		return canvas;
	}

	// One camera frame as the preview shows it, mirror and crop included.
	captureFrame({ width, height, crop }) {
		const canvas = createAppCanvas(width, height, 'camera/shot');
		this.drawSource(canvas.getContext('2d'), this.ui.video, width, height, this.ui.mirror.checked, crop);
		return canvas;
	}

	drawSource(ctx, source, width, height, mirror, crop = null) {
		ctx.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? width : 0, 0);
		if (crop) ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
		else ctx.drawImage(source, 0, 0, width, height);
		ctx.setTransform(1, 0, 0, 1, 0, 0);
	}

	// The footer never changes shape: nothing hides, Use is enabled once a
	// take is selected, and shooting disables what would interrupt it.
	setPhase(phase) {
		this.phase = phase;
		const shooting = phase === 'shooting', review = phase === 'review';
		this.reviewStart = performance.now();
		this.painted = null;
		this.ui.stage.classList.toggle('is-review', review);
		this.ui.takeBtn.disabled = shooting;
		this.ui.modes.querySelectorAll('button').forEach(button => { button.disabled = shooting; });
		this.ui.effectsBtn.disabled = shooting;
		[this.ui.mirror, this.ui.device].forEach(control => { control.disabled = shooting; });
		[this.ui.countdown, this.ui.aspect, this.ui.capture].forEach(control => control.querySelectorAll('button').forEach(button => { button.disabled = shooting; }));
		const gifReview = review && Boolean(this.selected?.frames);
		this.ui.bounce.closest('.property-row').hidden = !gifReview;
		this.ui.speed.closest('.property-row').hidden = !gifReview;
		this.syncRoll();
		this.syncCrop();
	}

	// ── Roll ──

	clearRoll() {
		this.roll = [];
		this.selected = null;
		this.ui.roll.querySelectorAll('.camera-take').forEach(button => button.remove());
		this.syncRoll();
	}

	// Adds a take as the newest thumbnail; the oldest drops past the limit.
	addTake(take) {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'camera-take';
		const thumb = document.createElement('canvas');
		button.append(thumb);
		const label = CONFIG.tools.camera.modes[take.mode].label;
		if (take.frames) {
			const badge = document.createElement('span');
			badge.textContent = label;
			button.append(badge);
		}
		button.setAttribute('aria-label', `${label} ${++this.takeCount}`);
		button.addEventListener('click', () => this.selectTake(take));
		Object.assign(take, { button, thumb });
		this.roll.push(take);
		while (this.roll.length > CONFIG.tools.camera.roll.size) this.removeTake(this.roll[0]);
		if (take.layout) this.drawLayoutThumb(take, []);
		else this.drawThumb(take, take.image || take.frames[0]);
		this.ui.roll.append(button);
		button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
		this.syncRoll();
		return take;
	}

	removeTake(take) {
		this.roll = this.roll.filter(entry => entry !== take);
		take.button?.remove();
		if (this.selected === take) this.selected = this.roll.filter(entry => !entry.pending).at(-1) || null;
		this.syncRoll();
	}

	// Picking a take reviews it; picking the reviewed take again goes back to
	// the camera, keeping it selected for Use.
	selectTake(take) {
		if (this.phase === 'shooting' || take.pending) return;
		if (take === this.selected && this.phase === 'review') { this.setPhase('live'); return; }
		this.selected = take;
		this.setPhase('review');
	}

	syncRoll() {
		const shooting = this.phase === 'shooting';
		this.ui.roll.classList.toggle('is-empty', !this.roll.length);
		this.roll.forEach(take => {
			const active = take === this.selected;
			take.button.classList.toggle('active', active);
			take.button.setAttribute('aria-pressed', String(active));
			take.button.classList.toggle('is-pending', Boolean(take.pending));
			take.button.disabled = shooting;
		});
		this.ui.useBtn.disabled = shooting || !this.selected;
	}

	drawThumb(take, source) {
		const height = CONFIG.tools.camera.roll.thumbPx;
		take.thumb.width = Math.max(1, Math.round(height * source.width / source.height));
		take.thumb.height = height;
		take.thumb.getContext('2d').drawImage(source, 0, 0, take.thumb.width, height);
	}

	drawLayoutThumb(take, shots) {
		const height = CONFIG.tools.camera.roll.thumbPx;
		const size = this.layoutSize(take.layout, take.size);
		const scale = height / size.height;
		take.thumb.width = Math.max(1, Math.round(size.width * scale));
		take.thumb.height = height;
		this.drawLayout(take.thumb.getContext('2d'), shots, take.layout, take.size, scale);
	}

	// ── Review ──

	gifDelay() {
		const { speeds, defaultSpeed } = CONFIG.tools.camera.modes.gif;
		return (speeds[this.speed] || speeds[defaultSpeed]).delayMs;
	}

	// Bounce plays the frames forward then back, without repeating the ends.
	reviewFrames(take = this.selected) {
		const frames = take?.frames || [];
		return this.ui.bounce.checked && frames.length > 2 ? [...frames, ...frames.slice(1, -1).reverse()] : frames;
	}

	reviewSource(now) {
		if (this.selected?.image) return this.selected.image;
		const frames = this.reviewFrames();
		return frames[Math.floor((now - this.reviewStart) / this.gifDelay()) % frames.length] || null;
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

	// The looks a cell or the stage renders, in stack order: the Webcam look
	// (when on) under the chosen effect.
	looksFor(lookId) {
		return [this.ui.webcam.checked ? CONFIG.tools.camera.effects.webcamLook : null, lookId].filter(Boolean);
	}

	// ── View loop ──

	// The stage shows the plain video while live with no look. Otherwise a
	// canvas over it shows the looks (on a timer) or the review result. In
	// review the video is hidden but keeps playing, so margins around a Grid
	// or Strip show the stage background, not the live camera.
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
		const looks = this.looksFor(this.effect);
		const key = looks.join('+');
		const source = this.phase === 'review' || looks.length ? this.currentSource(now) : null;
		this.ui.view.hidden = !source;
		if (!source || this.stageBusy) return;
		const live = source === this.ui.video;
		if (!live && this.painted?.source === source && this.painted.key === key) return;
		if (live && now - (this.painted?.at || 0) < CONFIG.tools.camera.effects.stageIntervalMs) return;
		this.painted = { source, key, at: now };
		const width = looks.length ? CONFIG.tools.camera.effects.stageWidth : (source.width || source.videoWidth);
		this.stageBusy = true;
		this.paintLook(this.ui.view, source, width, looks).finally(() => { this.stageBusy = false; });
	}

	paintCells(now) {
		if (this.ui.effects.hidden || this.cellsBusy || now - (this.lastCellsPaint || 0) < CONFIG.tools.camera.effects.cellIntervalMs) return;
		const source = this.currentSource(now);
		if (!source) return;
		this.lastCellsPaint = now;
		this.cellsBusy = true;
		const width = CONFIG.tools.camera.effects.cellWidth;
		Promise.all(this.effectCells.map(cell => this.paintLook(cell.canvas, source, width, this.looksFor(cell.lookId))))
			.finally(() => { this.cellsBusy = false; });
	}

	// Renders `source` through looks into `target`. Booth renders run one at a
	// time in a chain, so a slow async look (Deep Fry) can't pile up renders.
	// Each paint reseeds, so grain moves like a live sensor's.
	paintLook(target, source, width, lookIds) {
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
			const seed = `camera-${++this.paintCount}`;
			for (const lookId of lookIds) await GlitterFilter.renderToCanvas(ctx, w, h, this.filterDataFor(lookId), 1, { seed });
			if (target.width !== w) target.width = w;
			if (target.height !== h) target.height = h;
			target.getContext('2d').drawImage(work, 0, 0);
		};
		this.renderChain = this.renderChain.then(run).catch(error => console.error('Camera effect failed:', error));
		return this.renderChain;
	}

	// ── Use ──

	// Opens the selected take as the document. A Photo or GIF taken at an
	// aspect is cropped by canvas size, one undo step after the open, so
	// Undo brings back the full frame. Each look becomes a Filter layer right
	// above the base image: Webcam first, the effect over it.
	async use() {
		const take = this.selected;
		if (!take || this.phase === 'shooting' || this.ui.useBtn.disabled) return;
		this.ui.useBtn.disabled = true;
		const looks = this.looksFor(this.effect);
		let file = null;
		try {
			file = await this.resultFile(take);
		} catch (error) {
			console.error('Camera result failed:', error);
		}
		this.editor.modalManager.close('cameraModal');
		if (!file) { this.editor.showError('Could not save the photo.'); return; }
		if (!await openEditorFiles(this.editor, [file], { asDocument: true })) return;
		if (take.ratio) {
			const { width, height } = this.editor.originalCanvas;
			const crop = this.cropRect(take.ratio, width, height);
			this.editor.resizeCanvas(crop.width, crop.height, -crop.x, -crop.y, { historyLabel: 'Crop to aspect', updateStatus: false });
		}
		const layers = this.editor.layerManager;
		const base = layers.getBaseLayer();
		if (base) layers.setActiveLayer(base.id);
		looks.forEach(lookId => layers.addLayer(LayerType.FILTER, { filterLayer: { filterData: GlitterFilters.looksLibrary.apply(lookId) } }));
	}

	// A PNG of the image, or a GIF of the frames in review order and speed.
	async resultFile(take) {
		const { fileNames } = CONFIG.tools.camera;
		if (take.image) {
			const blob = await encodeCanvasToBlob(take.image, 'image/png');
			return blob && new File([blob], fileNames.image, { type: 'image/png' });
		}
		const frames = this.reviewFrames(take);
		const delayMs = this.gifDelay();
		const done = this.editor.beginActivity('camera-gif', 'Making GIF');
		try {
			const { blob } = await this.editor.gifEncodingPipeline.encode({
				frames: frames.map(frame => frame.getContext('2d').getImageData(0, 0, frame.width, frame.height)),
				delays: frames.map(() => delayMs),
				settings: { ...CONFIG.export.defaults },
				transparency: { enabled: false },
				mode: 'animation'
			});
			return new File([blob], fileNames.animation, { type: 'image/gif' });
		} finally { done(); }
	}
}

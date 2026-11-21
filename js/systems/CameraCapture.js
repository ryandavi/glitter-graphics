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
		this.streams = new WeakMap();
		this.streamCount = 0;
		this.ui = Object.fromEntries(['cameraModal', 'cameraStage', 'cameraVideo', 'cameraView', 'cameraCrop', 'cameraFlash', 'cameraCountdownBadge', 'cameraRetake', 'cameraEffects', 'cameraRoll', 'cameraModes', 'cameraTakeBtn', 'cameraEffectsBtn', 'cameraUseBtn', 'cameraMirror', 'cameraDevice', 'cameraCountdown', 'cameraAspect', 'cameraCapture', 'cameraWebcam', 'cameraSound', 'cameraBounce', 'cameraSpeed', 'cameraPlaybackSet']
			.map(id => [id.replace(/^camera/, '').replace(/^./, char => char.toLowerCase()), document.getElementById(id)]));
		const { modes, aspects, countdownSeconds } = CONFIG.tools.camera;
		const remembered = (key, table) => (Object.hasOwn(table, PREFERENCES.get(key)) ? PREFERENCES.get(key) : Object.keys(table)[0]);
		this.mode = remembered('cameraMode', modes);
		this.aspect = remembered('cameraAspect', aspects);
		this.gifCapture = remembered('cameraGifCapture', modes.gif.capture);
		this.speed = modes.gif.defaultSpeed;
		// 'off', or a CONFIG.tools.filter.webcam.resolutions key.
		this.webcam = 'off';
		this.countdownSeconds = countdownSeconds[0];
		this.bindChoice(this.ui.countdown, String(this.countdownSeconds), value => { this.countdownSeconds = Number(value); });
		this.bindChoice(this.ui.aspect, this.aspect, value => this.setAspect(value));
		this.bindChoice(this.ui.capture, this.gifCapture, value => { this.gifCapture = value; PREFERENCES.set('cameraGifCapture', value); });
		this.bindChoice(this.ui.speed, this.speed, value => { this.speed = value; this.reviewStart = performance.now(); });
		this.buildModes();
		this.buildEffects();
		this.ui.mirror.addEventListener('change', () => this.syncMirror());
		this.ui.device.addEventListener('change', () => { this.deviceId = this.ui.device.value; this.start(); });
		this.ui.bounce.addEventListener('change', () => { this.reviewStart = performance.now(); });
		this.bindChoice(this.ui.webcam, this.webcam, value => { this.webcam = value; this.painted = null; this.lastCellsPaint = 0; });
		this.ui.sound.checked = PREFERENCES.get('cameraSound');
		this.ui.sound.addEventListener('change', () => PREFERENCES.set('cameraSound', this.ui.sound.checked));
		this.ui.video.addEventListener('resize', () => this.syncStageAspect());
		this.ui.video.addEventListener('loadedmetadata', () => this.syncStageAspect());
		this.ui.takeBtn.addEventListener('click', () => this.take());
		this.ui.effectsBtn.addEventListener('click', () => this.setEffectsOpen(this.ui.effects.hidden));
		this.ui.useBtn.addEventListener('click', () => this.use());
		this.ui.view.addEventListener('click', event => this.offerRetake(event));
		this.ui.retake.addEventListener('click', () => this.retake(this.selected, Number(this.ui.retake.dataset.cell)));
		// A mouse wheel scrolls the roll sideways once it overflows.
		this.ui.roll.addEventListener('wheel', event => {
			const roll = this.ui.roll;
			if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX) || roll.scrollWidth <= roll.clientWidth) return;
			event.preventDefault();
			roll.scrollLeft += event.deltaY;
		}, { passive: false });
		// Delete or Backspace on a roll thumbnail removes that take.
		this.ui.roll.addEventListener('keydown', event => {
			if (event.key !== 'Delete' && event.key !== 'Backspace') return;
			const take = this.roll.find(entry => entry.button === event.target);
			if (!take || this.phase === 'shooting' || take.pending) return;
			event.preventDefault();
			this.deleteTake(take);
		});
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
			button.title = mode.label;
			button.setAttribute('aria-label', mode.label);
			button.append(createIcon(mode.icon));
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
		// The buttons are icons, so the settings name the mode in words.
		const label = document.getElementById('cameraModeLabel');
		if (label) label.textContent = `Mode: ${CONFIG.tools.camera.modes[this.mode].label}`;
		// Capture (Burst or Stop motion) only applies to a GIF.
		this.ui.capture.closest('.property-row').hidden = !CONFIG.tools.camera.modes[this.mode].animated;
		// The Effects grid swaps in the animated looks for a GIF, and keeps the
		// chosen effect if it is still offered.
		if (this.effectCells) {
			const kept = this.effect;
			this.buildEffects();
			if (this.effectCells.some(cell => cell.lookId === kept)) this.setEffect(kept);
		}
	}

	// The stage takes the camera's shape, so the video fills it and the crop
	// guide can be placed in percentages.
	syncStageAspect() {
		const { videoWidth: width, videoHeight: height } = this.ui.video;
		if (width && height) this.ui.stage.style.setProperty('--camera-aspect', String(width / height));
		this.syncCrop();
	}

	aspectRatio(aspect = this.aspect) { return CONFIG.tools.camera.aspects[aspect]?.ratio || null; }

	// The setting for the next shot. Reviewing a take, it also re-crops that
	// take: every take keeps its full frames, so nothing is lost.
	setAspect(value) {
		this.aspect = value;
		PREFERENCES.set('cameraAspect', value);
		const take = this.phase === 'review' ? this.selected : null;
		if (take && take.aspect !== value) {
			take.aspect = value;
			if (take.layout) take.image = this.composeLayout(take);
			this.drawTakeThumb(take);
		}
		this.syncCrop();
	}

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
		const take = this.phase === 'review' ? this.selected : null;
		const ratio = take ? (take.layout ? null : this.aspectRatio(take.aspect)) : this.aspectRatio();
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
		const size = this.shotSize();
		const shots = [];
		this.setEffectsOpen(false);
		this.setPhase('shooting');
		if (mode.layout) sequence.pending = this.addTake({ mode: this.mode, layout: mode.layout, aspect: this.aspect, shots, pending: true });
		for (let index = 0; index < mode.shots; index++) {
			const caption = mode.layout || capture?.cue ? `${index + 1} of ${mode.shots}` : '';
			const countdown = !index || mode.layout ? this.countdownSeconds : 0;
			if (countdown) {
				if (!await this.countDown(countdown, caption, sequence)) return;
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
			if (sequence.pending) this.drawTakeThumb(sequence.pending);
		}
		this.sequence = null;
		let take = sequence.pending;
		if (take) {
			take.pending = false;
			take.image = this.composeLayout(take);
		} else {
			// Photo and GIF keep the full frame; Use crops to the aspect.
			const aspect = this.aspect;
			take = this.addTake(mode.animated ? { mode: this.mode, frames: shots, aspect } : { mode: this.mode, image: shots[0], aspect });
		}
		this.selected = take;
		this.showTakeAspect(take);
		this.setPhase('review');
		this.ui.useBtn.focus();
	}

	// The count before a shot, one beep and badge a second; false if cancelled.
	async countDown(seconds, caption, sequence) {
		for (let remaining = seconds; remaining > 0; remaining--) {
			this.showBadge(String(remaining), caption);
			this.playSound(remaining === 1 ? 'lastBeep' : 'beep');
			if (!await this.wait(1000, sequence)) return false;
		}
		return true;
	}

	// Retakes one cell of a Grid or Strip: the countdown for that cell alone,
	// the other shots kept. Cancelling goes back to reviewing the take.
	async retake(take, index) {
		if (!this.stream || this.sequence || this.phase !== 'review' || !take?.layout || !this.ui.video.videoWidth) return;
		const sequence = this.sequence = { cancelled: false, timer: null, resolve: null, pending: null, retake: take };
		this.setPhase('shooting');
		if (this.countdownSeconds && !await this.countDown(this.countdownSeconds, `${index + 1} of ${take.shots.length}`, sequence)) return;
		this.hideBadge();
		// Same size as the shots kept, so the cells still line up.
		take.shots[index] = this.captureFrame(take.shots[0]);
		this.playSound('shutter');
		this.flash();
		this.sequence = null;
		take.image = this.composeLayout(take);
		this.drawTakeThumb(take);
		this.setPhase('review');
		this.ui.useBtn.focus();
	}

	// The cell of a Grid or Strip take under a tap on the stage, with its box
	// as shares of the stage, or null on a gutter or outside the picture. The
	// picture is drawn contained, so the tap is mapped back through that fit.
	cellAt(take, event) {
		const stage = this.ui.stage.getBoundingClientRect(), image = take.image;
		if (!image || !stage.width || !stage.height) return null;
		const fit = Math.min(stage.width / image.width, stage.height / image.height);
		const left = (stage.width - image.width * fit) / 2, top = (stage.height - image.height * fit) / 2;
		const x = (event.clientX - stage.left - left) / fit, y = (event.clientY - stage.top - top) / fit;
		const cell = this.layoutCell(take);
		for (let index = 0; index < take.shots.length; index++) {
			const origin = this.cellOrigin(take.layout, cell, index);
			if (x < origin.x || y < origin.y || x >= origin.x + cell.width || y >= origin.y + cell.height) continue;
			return {
				index,
				box: { left: (left + origin.x * fit) / stage.width, top: (top + origin.y * fit) / stage.height, width: cell.width * fit / stage.width, height: cell.height * fit / stage.height }
			};
		}
		return null;
	}

	// Tapping a cell while reviewing a Grid or Strip offers Retake over it;
	// tapping the gutter or the same cell again puts the offer away.
	offerRetake(event) {
		const take = this.selected, button = this.ui.retake;
		const hit = this.phase === 'review' && take?.layout ? this.cellAt(take, event) : null;
		if (!hit || (!button.hidden && Number(button.dataset.cell) === hit.index)) { this.hideRetake(); return; }
		button.dataset.cell = String(hit.index);
		button.hidden = false;
		// The button sits at the cell's centre, so its box is the cell's share.
		this.ui.stage.style.setProperty('--retake-x', `${(hit.box.left + hit.box.width / 2) * 100}%`);
		this.ui.stage.style.setProperty('--retake-y', `${(hit.box.top + hit.box.height / 2) * 100}%`);
		button.focus();
	}

	hideRetake() { this.ui.retake.hidden = true; }

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
		if (this.phase === 'shooting') this.setPhase(sequence.retake ? 'review' : 'live');
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

	// Every shot keeps the full camera frame, within the canvas limits, so a
	// take can be re-cropped to any aspect after it is shot.
	shotSize() {
		const { videoWidth: width, videoHeight: height } = this.ui.video;
		return this.editor.getConstrainedCanvasSize(width, height);
	}

	// One cell of a layout take: the part of each shot its aspect keeps, and
	// a cell size shrunk so the whole layout fits the canvas limits; nothing
	// the booth makes asks to be resized.
	layoutCell(take) {
		const shot = take.shots[0];
		const crop = this.cropRect(this.aspectRatio(take.aspect), shot.width, shot.height);
		const gutter = CONFIG.tools.camera.grid.gutter * Math.min(crop.width, crop.height);
		const full = this.layoutSize(take.layout, { width: crop.width, height: crop.height, gutter });
		const fitted = this.editor.getConstrainedCanvasSize(full.width, full.height);
		const scale = Math.min(1, fitted.width / full.width, fitted.height / full.height);
		return { width: Math.max(1, Math.floor(crop.width * scale)), height: Math.max(1, Math.floor(crop.height * scale)), gutter: Math.floor(gutter * scale), crop };
	}

	layoutSize({ columns, rows }, cell) {
		return { width: columns * cell.width + (columns + 1) * cell.gutter, height: rows * cell.height + (rows + 1) * cell.gutter };
	}

	// The top-left corner of shot `index`'s cell, reading across then down.
	cellOrigin({ columns }, cell, index) {
		const column = index % columns, row = Math.floor(index / columns);
		return { x: cell.gutter + column * (cell.width + cell.gutter), y: cell.gutter + row * (cell.height + cell.gutter) };
	}

	// Draws a layout take's shots so far at `scale`, each cropped to the
	// take's aspect; empty cells stay background. `shots: false` draws the
	// background alone, the base Use places each shot's layer on.
	drawLayout(ctx, take, cell, scale = 1, { shots = true } = {}) {
		const { crop } = cell;
		const size = this.layoutSize(take.layout, cell);
		ctx.fillStyle = CONFIG.tools.camera.grid.background;
		ctx.fillRect(0, 0, size.width * scale, size.height * scale);
		if (!shots) return;
		take.shots.forEach((shot, index) => {
			const { x, y } = this.cellOrigin(take.layout, cell, index);
			ctx.drawImage(shot, crop.x, crop.y, crop.width, crop.height, x * scale, y * scale, cell.width * scale, cell.height * scale);
		});
	}

	composeLayout(take, options) {
		const cell = this.layoutCell(take);
		const size = this.layoutSize(take.layout, cell);
		const canvas = createAppCanvas(size.width, size.height, 'camera/layout');
		this.drawLayout(canvas.getContext('2d'), take, cell, 1, options);
		return canvas;
	}

	// One shot of a layout take, cropped and sized to its cell.
	cellImage(take, cell, index) {
		const { crop } = cell;
		const canvas = createAppCanvas(cell.width, cell.height, 'camera/cell');
		canvas.getContext('2d').drawImage(take.shots[index], crop.x, crop.y, crop.width, crop.height, 0, 0, cell.width, cell.height);
		return canvas;
	}

	// One full camera frame as the preview shows it, mirror included.
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

	// The footer never changes shape: nothing hides, Use is enabled once a
	// take is selected, and shooting disables what would interrupt it.
	setPhase(phase) {
		this.phase = phase;
		const shooting = phase === 'shooting', review = phase === 'review';
		this.reviewStart = performance.now();
		this.painted = null;
		this.hideRetake();
		this.ui.stage.classList.toggle('is-review', review);
		this.ui.takeBtn.disabled = shooting;
		this.ui.modes.querySelectorAll('button').forEach(button => { button.disabled = shooting; });
		this.ui.effectsBtn.disabled = shooting;
		[this.ui.mirror, this.ui.device].forEach(control => { control.disabled = shooting; });
		[this.ui.countdown, this.ui.aspect, this.ui.capture].forEach(control => control.querySelectorAll('button').forEach(button => { button.disabled = shooting; }));
		const gifReview = review && Boolean(this.selected?.frames);
		this.ui.playbackSet.hidden = !gifReview;
		this.syncRoll();
		this.syncCrop();
	}

	// ── Roll ──

	clearRoll() {
		this.roll = [];
		this.selected = null;
		this.ui.roll.querySelectorAll('.camera-roll-item').forEach(item => item.remove());
		this.syncRoll();
	}

	// Adds a take as the newest thumbnail; the oldest drops past the limit.
	// The thumbnail and its remove button are siblings, since a button
	// can't hold another.
	addTake(take) {
		const item = document.createElement('div');
		item.className = 'camera-roll-item';
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
		const name = `${label} ${++this.takeCount}`;
		button.setAttribute('aria-label', name);
		button.addEventListener('click', () => this.selectTake(take));
		const remove = document.createElement('button');
		remove.type = 'button';
		remove.className = 'camera-take-remove icon-wrapper';
		remove.title = 'Remove';
		remove.setAttribute('aria-label', `Remove ${name}`);
		remove.append(createIcon('x-mark'));
		remove.addEventListener('click', () => this.deleteTake(take));
		item.append(button, remove);
		Object.assign(take, { item, button, remove, thumb });
		this.roll.push(take);
		while (this.roll.length > CONFIG.tools.camera.roll.size) this.removeTake(this.roll[0]);
		this.drawTakeThumb(take);
		this.ui.roll.append(item);
		item.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
		this.syncRoll();
		return take;
	}

	removeTake(take) {
		this.roll = this.roll.filter(entry => entry !== take);
		take.item?.remove();
		if (this.selected === take) this.selected = this.roll.filter(entry => !entry.pending).at(-1) || null;
		this.syncRoll();
	}

	// The person removes a take. Reviewing it, the stage moves to the newest
	// take left, or back to the camera when the roll is empty; focus stays on
	// the roll so Delete can clear it take by take.
	deleteTake(take) {
		if (this.phase === 'shooting' || take.pending) return;
		const reviewing = this.phase === 'review' && this.selected === take;
		const index = this.roll.indexOf(take);
		this.removeTake(take);
		if (reviewing) {
			if (this.selected) this.showTakeAspect(this.selected);
			this.setPhase(this.selected ? 'review' : 'live');
		}
		const next = this.roll[Math.min(index, this.roll.length - 1)];
		(next?.button || this.ui.takeBtn).focus();
	}

	// Picking a take reviews it; picking the reviewed take again goes back to
	// the camera, keeping it selected for Use.
	selectTake(take) {
		if (this.phase === 'shooting' || take.pending) return;
		if (take === this.selected && this.phase === 'review') { this.setPhase('live'); return; }
		this.selected = take;
		this.showTakeAspect(take);
		this.setPhase('review');
	}

	// Reviewing a take, the Aspect control shows (and edits) that take's
	// aspect, which also becomes the setting for the next shot.
	showTakeAspect(take) {
		if (!take?.aspect || take.aspect === this.aspect) return;
		this.aspect = take.aspect;
		PREFERENCES.set('cameraAspect', take.aspect);
		this.syncChoice(this.ui.aspect, take.aspect);
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
			take.remove.disabled = shooting || Boolean(take.pending);
		});
		this.ui.useBtn.disabled = shooting || !this.selected;
	}

	// The thumbnail shows what Use makes: a Photo or GIF cropped to its
	// aspect, a layout filling in cell by cell. Before a layout's first shot
	// there is nothing to measure, so it waits blank at the camera's shape.
	drawTakeThumb(take) {
		const height = CONFIG.tools.camera.roll.thumbPx;
		let width = height * (this.ui.video.videoWidth || 16) / (this.ui.video.videoHeight || 9);
		let draw = null;
		if (take.layout && take.shots.length) {
			const cell = this.layoutCell(take);
			const size = this.layoutSize(take.layout, cell);
			width = size.width * height / size.height;
			draw = ctx => this.drawLayout(ctx, take, cell, height / size.height);
		} else if (!take.layout) {
			const source = take.image || take.frames[0];
			const crop = this.cropRect(this.aspectRatio(take.aspect), source.width, source.height);
			width = height * crop.width / crop.height;
			draw = ctx => ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, ctx.canvas.width, height);
		}
		take.thumb.width = Math.max(1, Math.round(width));
		take.thumb.height = height;
		draw?.(take.thumb.getContext('2d'));
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
		const { looks: stillLooks, gifLooks } = CONFIG.tools.camera.effects;
		const animated = CONFIG.tools.camera.modes[this.mode].animated;
		const looks = stillLooks.map(id => (animated && gifLooks[id]) || id).filter(id => GlitterFilters.looksLibrary.get(id));
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

	// A look's filter value; the Webcam look takes the chosen resolution.
	lookValue(lookId) {
		const value = GlitterFilters.looksLibrary.apply(lookId);
		if (lookId === CONFIG.tools.camera.effects.webcamLook) value.resolution = this.webcam;
		return value;
	}

	filterDataFor(lookId) {
		const key = lookId === CONFIG.tools.camera.effects.webcamLook ? `${lookId}:${this.webcam}` : lookId;
		if (!this.lookData.has(key)) this.lookData.set(key, GlitterFilter.normalizeFilterData(this.lookValue(lookId)));
		return this.lookData.get(key);
	}

	// The looks a cell or the stage renders, in stack order: the Webcam look
	// (when on) under the chosen effect.
	looksFor(lookId) {
		return [this.webcam !== 'off' ? CONFIG.tools.camera.effects.webcamLook : null, lookId].filter(Boolean);
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
		const { stageWidth, webcamStageWidth } = CONFIG.tools.camera.effects;
		const width = looks.length ? (webcamStageWidth[this.webcam] || stageWidth) : (source.width || source.videoWidth);
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
	// Each paint is the next frame of one seed, so grain moves like a live
	// sensor's while slower noise (the Webcam look's colour blotches) drifts.
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
			// Each target is its own stream (its own seed and frame count), so the
			// effects menu's cells don't break the stage's frame-to-frame state.
			// A Photo or Grid is a still: frame 0, no temporal effects.
			const stream = this.streams.get(target) || { seed: target === this.ui.view ? 'camera' : `camera:${++this.streamCount}`, frame: 0 };
			this.streams.set(target, stream);
			const still = this.phase === 'review' && Boolean(this.selected?.image) && target === this.ui.view;
			const frameIndex = still ? 0 : ++stream.frame;
			for (const lookId of lookIds) await GlitterFilter.renderToCanvas(ctx, w, h, this.filterDataFor(lookId), 1, { seed: stream.seed, frameIndex });
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
	// Undo brings back the full frame. A Grid or Strip opens as its
	// background with each shot as its own sticker layer in its cell, so a
	// shot can be moved, resized or swapped. Each look becomes a Filter layer
	// over the photo: Webcam first, the effect over it.
	async use() {
		const take = this.selected;
		if (!take || this.phase === 'shooting' || this.ui.useBtn.disabled) return;
		this.ui.useBtn.disabled = true;
		const looks = this.looksFor(this.effect);
		let file = null, cells = null;
		try {
			if (take.layout) cells = await this.layoutCellFiles(take);
			file = await this.resultFile(take, { shots: !cells });
		} catch (error) {
			console.error('Camera result failed:', error);
		}
		this.editor.modalManager.close('cameraModal');
		if (!file) { this.editor.showError('Could not save the photo.'); return; }
		if (!await openEditorFiles(this.editor, [file], { asDocument: true })) return;
		const ratio = take.layout ? null : this.aspectRatio(take.aspect);
		if (ratio) {
			const { width, height } = this.editor.originalCanvas;
			const crop = this.cropRect(ratio, width, height);
			this.editor.resizeCanvas(crop.width, crop.height, -crop.x, -crop.y, { historyLabel: 'Crop to aspect', updateStatus: false });
		}
		const layers = this.editor.layerManager;
		const base = layers.getBaseLayer();
		if (base) layers.setActiveLayer(base.id);
		if (cells) await this.placeCells(cells);
		looks.forEach(lookId => layers.addLayer(LayerType.FILTER, { filterLayer: { filterData: this.lookValue(lookId) } }));
	}

	// Each shot of a layout take as a PNG at its cell's size, with the cell's
	// centre in canvas pixels.
	async layoutCellFiles(take) {
		const cell = this.layoutCell(take);
		const label = CONFIG.tools.camera.modes[take.mode].label;
		return Promise.all(take.shots.map(async (shot, index) => {
			const blob = await encodeCanvasToBlob(this.cellImage(take, cell, index), 'image/png');
			if (!blob) throw new Error('Could not encode a shot');
			const { x, y } = this.cellOrigin(take.layout, cell, index);
			return { file: new File([blob], `${label} shot ${index + 1}.png`, { type: 'image/png' }), center: { x: x + cell.width / 2, y: y + cell.height / 2 } };
		}));
	}

	// Places each shot as a sticker layer over the base, in shot order, as
	// one undo step. A full layer stack places as many as fit.
	async placeCells(cells) {
		const { stickerLibrary, stickerManager, layerManager } = this.editor;
		let placed = 0;
		for (const { file, center } of cells) {
			const item = await stickerLibrary.handleUserUpload(file, { navigate: false });
			if (!item || !await stickerLibrary.ensureAssetDetails(item.id)) break;
			const layer = stickerManager.createLayer(item.id);
			if (!layer) break;
			layer.transform.position = { x: center.x, y: center.y };
			layerManager.insertLayer(layer);
			layerManager.setActiveLayer(layer.id);
			stickerManager.renderLayer(layer);
			placed++;
		}
		if (!placed) return;
		layerManager.renderLayersList();
		this.editor.requestPreviewUpdate();
		this.editor.saveState('Place shots');
		this.editor.updateActionButtons();
	}

	// A PNG of the image, or a GIF of the frames in review order and speed.
	// A layout take with `shots: false` is its background alone.
	async resultFile(take, { shots = true } = {}) {
		const { fileNames } = CONFIG.tools.camera;
		if (take.image) {
			const image = take.layout && !shots ? this.composeLayout(take, { shots: false }) : take.image;
			const blob = await encodeCanvasToBlob(image, 'image/png');
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

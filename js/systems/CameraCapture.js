'use strict';

// Take Photo: a live camera preview in #cameraModal that captures one frame
// and opens it the way Open Image does (openEditorFiles), so canvas size,
// replacing the base image and history follow the existing image path. The
// stream stops whenever the modal closes, the photo is used, or the page hides.
class CameraCapture {
	static isSupported() {
		return Boolean(navigator.mediaDevices?.getUserMedia);
	}

	constructor(editor) {
		this.editor = editor;
		this.stream = null;
		this.deviceId = '';
		this.countdownTimer = null;
		this.captured = false;
		this.ui = Object.fromEntries(['cameraModal', 'cameraStage', 'cameraVideo', 'cameraStill', 'cameraCountdownBadge', 'cameraMirror', 'cameraDevice', 'cameraCountdown', 'cameraTakeBtn', 'cameraRetakeBtn', 'cameraUseBtn']
			.map(id => [id.replace(/^camera/, '').replace(/^./, char => char.toLowerCase()), document.getElementById(id)]));
		this.countdownSeconds = CONFIG.tools.camera.countdownSeconds[0];
		this.ui.countdown.querySelectorAll('[data-value]').forEach(button => button.addEventListener('click', () => {
			this.countdownSeconds = Number(button.dataset.value);
			this.syncCountdown();
		}));
		this.ui.mirror.addEventListener('change', () => this.syncMirror());
		this.ui.device.addEventListener('change', () => { this.deviceId = this.ui.device.value; this.start(); });
		this.ui.takeBtn.addEventListener('click', () => this.take());
		this.ui.retakeBtn.addEventListener('click', () => this.retake());
		this.ui.useBtn.addEventListener('click', () => this.use());
		document.addEventListener('visibilitychange', () => {
			if (document.hidden) this.stop();
			else if (this.isOpen() && !this.captured) this.start();
		});
		editor.modalManager.register('cameraModal', {
			closeBtnId: 'closeCameraModal',
			resetScrollOnOpen: true,
			initialFocusSelector: '#cameraTakeBtn',
			onOpen: () => { this.retake(); this.start(); },
			onClose: () => this.stop()
		});
		this.syncCountdown();
	}

	isOpen() { return this.editor.modalManager.stack.some(config => config.id === 'cameraModal'); }

	open() {
		if (!CameraCapture.isSupported()) { this.editor.updateStatus('This browser cannot use a camera.'); return; }
		this.editor.modalManager.open('cameraModal');
	}

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

	stop() {
		this.request = null;
		clearTimeout(this.countdownTimer);
		this.countdownTimer = null;
		this.ui.countdownBadge.hidden = true;
		this.ui.takeBtn.disabled = false;
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
		this.editor.updateStatus(messages[error?.name] || 'The camera could not start.');
	}

	syncMirror() { this.ui.stage.classList.toggle('is-mirrored', this.ui.mirror.checked); }

	syncCountdown() {
		this.ui.countdown.querySelectorAll('[data-value]').forEach(button => {
			const active = Number(button.dataset.value) === this.countdownSeconds;
			button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
		});
	}

	take() {
		if (!this.stream || this.countdownTimer) return;
		let remaining = this.countdownSeconds;
		this.ui.takeBtn.disabled = true;
		const tick = () => {
			if (remaining <= 0) { this.countdownTimer = null; this.ui.countdownBadge.hidden = true; this.capture(); return; }
			this.ui.countdownBadge.hidden = false;
			this.ui.countdownBadge.textContent = String(remaining--);
			this.countdownTimer = setTimeout(tick, 1000);
		};
		tick();
	}

	// The still matches what the preview showed, mirror included, at the size
	// the canvas limits allow, so a photo never asks to be resized.
	capture() {
		const { video, still } = this.ui;
		if (!video.videoWidth) { this.ui.takeBtn.disabled = false; return; }
		const size = this.editor.getConstrainedCanvasSize(video.videoWidth, video.videoHeight);
		still.width = size.width; still.height = size.height;
		const ctx = still.getContext('2d');
		ctx.setTransform(this.ui.mirror.checked ? -1 : 1, 0, 0, 1, this.ui.mirror.checked ? still.width : 0, 0);
		ctx.drawImage(video, 0, 0, still.width, still.height);
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		this.setCaptured(true);
		this.ui.useBtn.focus();
	}

	retake() { this.setCaptured(false); }

	setCaptured(captured) {
		this.captured = captured;
		this.ui.takeBtn.disabled = false;
		this.ui.stage.classList.toggle('is-captured', captured);
		this.ui.still.hidden = !captured;
		this.ui.video.hidden = captured;
		this.ui.takeBtn.hidden = captured;
		this.ui.retakeBtn.hidden = !captured;
		this.ui.useBtn.hidden = !captured;
		this.ui.mirror.disabled = captured;
		this.ui.device.disabled = captured;
	}

	async use() {
		if (!this.captured) return;
		const blob = await new Promise(resolve => this.ui.still.toBlob(resolve, 'image/png'));
		this.editor.modalManager.close('cameraModal');
		if (!blob) { this.editor.showError('Could not save the photo.'); return; }
		await openEditorFiles(this.editor, [new File([blob], CONFIG.tools.camera.fileName, { type: 'image/png' })], { asDocument: true });
	}
}

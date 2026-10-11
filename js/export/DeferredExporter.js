'use strict';

class DeferredExporter {
	constructor(encoder) {
		this._encoder = encoder;
		this._hydration = null;
	}

	async _hydrate() {
		if (!this._hydration) this._hydration = loadScriptGroup('export').then((exports) => {
			this._encoderPrototype = exports[this._encoder].prototype;
			for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(this._encoderPrototype))) {
				if (name !== 'constructor' && !Object.hasOwn(this, name)) Object.defineProperty(this, name, descriptor);
			}
		}).catch((error) => { this._hydration = null; throw error; });
		return this._hydration;
	}

	async process(...args) { await this._hydrate(); return this._encoderPrototype.process.call(this, ...args); }
	async serialize(...args) { await this._hydrate(); return this._encoderPrototype.serialize.call(this, ...args); }
	async _planFrames(...args) { await this._hydrate(); return this._encoderPrototype._planFrames.call(this, ...args); }
	async _encode(...args) { await this._hydrate(); return this._encoderPrototype._encode.call(this, ...args); }
	async _encodeGif(...args) { await this._hydrate(); return this._encoderPrototype._encodeGif.call(this, ...args); }
	async _encodeJpeg(...args) { await this._hydrate(); return this._encoderPrototype._encodeJpeg.call(this, ...args); }
	_handleFileSave(...args) { return this._encoderPrototype._handleFileSave.call(this, ...args); }
}

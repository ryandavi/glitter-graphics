// ============================================
// FONT LIBRARY
// ============================================
// The text fonts: the data/fonts.json manifest (fonts, tag groups, resolved
// credits) and FontFace loading. Text layout, the font picker, and export all
// read fonts from here. Like ShapeLibrary and BrushLibrary it is data and
// loading only; the picker UI stays with the text panel (TextGlitterManager).

const FontLibrary = {
	fonts: [],
	tagGroups: [],
	byId: new Map(),
	manifestPromise: null,
	loadPromises: new Map(),
	// Fonts whose FontFace is registered and loaded. System fonts ship with the
	// OS and never land here.
	faces: new Map(),
	allLoadedPromise: null,

	async loadManifest() {
		if (this.manifestPromise) return this.manifestPromise;

		this.manifestPromise = (async () => {
			const response = await fetch(CONFIG.tools.text.fontsManifest, { cache: 'no-store' });
			if (!response.ok) {
				throw new Error(`Failed to load fonts manifest (${response.status})`);
			}

			const manifest = await response.json();
			this.validateManifest(manifest);
			this.fonts = manifest.fonts;
			this.tagGroups = manifest.tagGroups;
			// Resolve each font's credit once: the manifest default (a foundry /
			// license that covers the bundled set) with per-font overrides on top.
			// System fonts ship with the OS, so they skip the bundled-set default.
			const manifestAttribution = Attribution.sanitize(manifest.attribution, 'fonts manifest');
			this.byId.clear();
			this.fonts.forEach((font) => {
				font.attribution = Attribution.resolve(font.system ? null : manifestAttribution, font.attribution);
				this.byId.set(font.id, font);
			});
			return this.fonts;
		})();

		try {
			return await this.manifestPromise;
		} catch (error) {
			this.manifestPromise = null;
			throw error;
		}
	},

	validateManifest(manifest) {
		if (!Array.isArray(manifest?.tagGroups) || !Array.isArray(manifest?.fonts)) {
			throw new Error('Fonts manifest must contain tagGroups and fonts arrays');
		}
		const tagIds = new Set();
		const groupIds = new Set();
		manifest.tagGroups.forEach((group) => {
			if (!/^[a-z][a-z0-9-]*$/.test(group?.id) || !group?.label || groupIds.has(group.id) || !Array.isArray(group.tags)) {
				throw new Error('Fonts manifest contains an invalid or duplicate tag group');
			}
			groupIds.add(group.id);
			group.tags.forEach((tag) => {
				if (!/^[a-z][a-z0-9-]*$/.test(tag?.id) || !tag?.label || tagIds.has(tag.id)) {
					throw new Error('Fonts manifest contains an invalid or duplicate tag');
				}
				tagIds.add(tag.id);
			});
		});

		const ids = new Set();
		manifest.fonts.forEach((font) => {
			if (!/^[a-z][a-z0-9-]*$/.test(font?.id) || !font?.name || ids.has(font.id)) {
				throw new Error('Fonts manifest contains an invalid or duplicate font');
			}
			if (!Number.isInteger(font.weight) || font.weight < 100 || font.weight > 900) {
				throw new Error(`Font "${font.id}" has an invalid weight`);
			}
			if (!Array.isArray(font.scripts) || !font.scripts.length) {
				throw new Error(`Font "${font.id}" needs at least one script`);
			}
			if (font.system ? !font.family : !font.file) {
				throw new Error(`Font "${font.id}" is missing its source`);
			}
			if (!Array.isArray(font.tags) || font.tags.some((tagId) => !tagIds.has(tagId))) {
				throw new Error(`Font "${font.id}" contains an unknown tag`);
			}
			ids.add(font.id);
		});
		if (!ids.has(CONFIG.tools.text.defaultFontId)) {
			throw new Error('Fonts manifest is missing the default font');
		}
		manifest.fonts.forEach((font) => {
			if (font.fallbackFontId && !ids.has(font.fallbackFontId)) {
				throw new Error(`Font "${font.id}" has an unknown fallback font`);
			}
		});
	},

	has(fontId) {
		return this.byId.has(fontId);
	},

	// Unknown ids resolve to the default font.
	getFont(fontId) {
		return this.byId.get(fontId) || this.byId.get(CONFIG.tools.text.defaultFontId) || null;
	},

	isLoaded(fontId) {
		return this.faces.has(fontId);
	},

	getFamily(font) {
		if (!font) return 'sans-serif';
		// System fonts carry their own full stack (device coverage varies).
		if (font.family) return font.family;
		return `"${font.name}", ${font.fallback || 'sans-serif'}`;
	},

	getDeclaration(font, fontSize, fontWeight = null, fontStyle = 'normal') {
		const weight = fontWeight || font?.weight || 400;
		if (!font?.name) {
			return `${fontStyle} ${weight} ${fontSize}px sans-serif`;
		}
		// System fonts need the whole stack in canvas font strings too, so a
		// device without the face falls back the same way preview DOM does.
		const family = font.family || `"${font.name}"`;
		return `${fontStyle} ${weight} ${fontSize}px ${family}`;
	},

	async ensureLoaded(fontId) {
		await this.loadManifest();

		const font = this.getFont(fontId);
		if (!font) {
			throw new Error(`Unknown text font "${fontId}"`);
		}

		if (this.loadPromises.has(font.id)) {
			return this.loadPromises.get(font.id);
		}

		const fontPromise = (async () => {
			// Installed-on-device face: nothing to fetch — the family stack's
			// fallback covers devices without it (Android ships neither Comic
			// Sans nor Impact). document.fonts.load still warms measurement.
			if (font.system) {
				if (font.fallbackFontId) {
					await this.ensureLoaded(font.fallbackFontId);
				}
				await document.fonts.load(this.getDeclaration(font, FIELDS.textFontSize.value), 'Hg');
				return null;
			}
			try {
				const response = await fetch(font.file);
				if (!response.ok) {
					throw new Error(`Failed to load font "${font.name}" (${response.status})`);
				}

				const data = await response.arrayBuffer();
				const face = new FontFace(font.name, data, {
					weight: String(font.weight || 400)
				});

				await face.load();
				document.fonts.add(face);
				await document.fonts.load(this.getDeclaration(font, FIELDS.textFontSize.value), 'Hg');
				this.faces.set(font.id, face);
				return face;
			} catch (error) {
				throw new Error(`Failed to load font "${font.name}": ${error.message}`);
			}
		})();

		this.loadPromises.set(font.id, fontPromise);

		try {
			return await fontPromise;
		} catch (error) {
			this.loadPromises.delete(font.id);
			throw error;
		}
	},

	// Every font, so the picker's samples render in their own faces. One
	// failure is reported and does not stop the rest.
	async ensureAllLoaded(onError = null) {
		await this.loadManifest();
		this.allLoadedPromise ||= Promise.all(this.fonts.map((font) =>
			this.ensureLoaded(font.id).catch((error) => onError?.(error))
		));
		return this.allLoadedPromise;
	}
};

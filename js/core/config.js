// Release history, newest first.
//
// `id` is the permanent identity of a release: it is written to localStorage as
// `glitterEditor_welcomeLastSeenRelease` and compared against `CONFIG.app.currentRelease`
// to decide whether returning visitors see the welcome modal again. Never edit the `id`
// of a release that has shipped — every visitor would be shown the modal a second time.
// Dates may be edited freely because nothing keys off them.
//
// Each feature is `{ type, text }` where `type` is 'added', 'changed', or 'fixed'.
// `guide` is an optional element id in modals/guide.html; supplying it renders a link
// that opens the guide at that section. `projectFormat` records the ProjectSerializer
// FORMAT_VERSION a release reads and writes, so format changes are traceable from the
// changelog. `unreleased: true` stages an entry without publishing it — it is hidden
// from the version history and skipped when resolving `currentRelease`.
const RELEASES = [
	{
		id: 'v0.3.0',
		version: '0.3.0',
		name: 'Export and Projects Update',
		date: '2026-08-01',
		dateLabel: 'August 1, 2026',
		projectFormat: 1,
		/* image: {
			src: 'images/etc/preview-image.gif',
			alt: 'Animated glitter graphic made in the editor'
		}, */
		summary: 'Added saveable projects, video export, generated glitter, and canvas-wide effects.',
		features: [
			{ type: 'added', text: 'Save and reopen projects as .glitter.json files, keeping every layer, mask, and custom sticker editable.', guide: 'export' },
			{ type: 'added', text: 'Added MP4 export alongside animated GIF.', guide: 'exporting-process' },
			{ type: 'added', text: 'Added Auto Glitter, which reads an image and builds glitter layers from it. The results stay editable, and you can reopen a batch to adjust it.', guide: 'auto-glitter' },
			{ type: 'added', text: 'Added canvas effects that apply to the whole document, including shimmer and pixel effects.', guide: 'canvas-effects' },
			{ type: 'added', text: 'Added a Base Background layer that fills the canvas behind everything with a glitter, gradient, or image.', guide: 'working-with-layers' },
			{ type: 'added', text: 'Added gradient fills for text and shapes, with multi-stop colors and adjustable angle.', guide: 'shape-fill' },
			{ type: 'added', text: 'Added the Shape gallery for browsing and placing preset shapes.', guide: 'create-shape' },
			{ type: 'added', text: 'Added multi-select, so you can move, scale, and align several layers together.', guide: 'selection-alignment' },
			{ type: 'added', text: 'Added alignment and distribution tools for arranging layers on the canvas.', guide: 'selection-alignment' },
			{ type: 'added', text: 'Added interface themes, including a light theme.', guide: 'app-settings' },
			{ type: 'added', text: 'Added document scaling, so you can resize the whole composition and everything on it at once.', guide: 'canvas-view-options' },
			{ type: 'added', text: 'Added color adjustment for stickers, letting you recolor artwork to match a palette.', guide: 'add-stickers' },
			{ type: 'added', text: 'Added antialiased mask edges as an editing setting.', guide: 'editing-settings' },
			{ type: 'added', text: 'Added search and filtering across the sticker, glitter, and shape galleries.', guide: 'add-stickers' },
			{ type: 'added', text: 'Added optimization details to the export preview, showing how frames were reduced and how the loop was closed.', guide: 'export-settings' },
			{ type: 'changed', text: 'Rebuilt the settings sidebar so each layer type shows only its own controls, with a context toolbar above the canvas for the tool in use.', guide: 'basics' },
			{ type: 'changed', text: 'Rebuilt layer transforms with steadier corner scaling and consistent behavior across every layer type.', guide: 'working-with-layers' },
			{ type: 'changed', text: 'Improved mobile gestures, drawers, and layer reordering.', guide: 'mobile' },
			{ type: 'changed', text: 'Sped up gallery browsing by loading asset indexes on demand.' },
			{ type: 'fixed', text: 'Fixed animated stickers flickering in the preview.' }
		]
	},
	{
		id: 'v0.2.0',
		version: '0.2.0',
		name: 'Creative Tools Update',
		date: '2026-07-01',
		dateLabel: 'July 1, 2026',
		summary: 'Expanded the editor beyond color-selected glitter fills with painted masks, text, and shapes.',
		features: [
			{ type: 'added', text: 'Added the Mask Brush for painting and erasing glitter masks by hand, with adjustable size, spacing, and smoothing.', guide: 'mask-brush' },
			{ type: 'added', text: 'Added editable Text layers with typography, layout, fill, border, and shadow controls.', guide: 'text' },
			{ type: 'added', text: 'Added ten self-hosted display fonts for text layers.', guide: 'text-typography' },
			{ type: 'added', text: 'Added point text and area text, so a text layer can either grow with what you type or wrap inside a box you draw.', guide: 'create-text' },
			{ type: 'added', text: 'Added editable Shape layers with glitter, solid, and gradient effects.', guide: 'shapes' },
			{ type: 'added', text: 'Added canvas size controls for changing the document dimensions after you start.', guide: 'canvas-view-options' },
			{ type: 'added', text: 'Added a gallery picker for choosing a glitter, replacing the small swatch list.', guide: 'select-colors' },
			{ type: 'added', text: 'Added confirmation prompts before actions that discard work.' },
			{ type: 'changed', text: 'Unified mouse and touch input, so pointer behavior is the same on desktop and mobile.', guide: 'mobile' },
			{ type: 'changed', text: 'Renamed the Color Picker tool to Color Fill to match what it does.', guide: 'tools' }
		]
	},
	{
		id: 'v0.1.1',
		version: '0.1.1',
		name: 'Touch and Detail Update',
		date: '2026-02-01',
		dateLabel: 'February 1, 2026',
		summary: 'Reworked touch handling and surfaced more information about the archived assets.',
		features: [
			{ type: 'added', text: 'Added a welcome screen introducing the editor to first-time visitors.' },
			{ type: 'added', text: 'Added asset details for stickers and glitters, including original source, dimensions, and frame rate.', guide: 'add-stickers' },
			{ type: 'added', text: 'Added transform handles for scaling and rotating stickers directly on the canvas.', guide: 'working-with-layers' },
			{ type: 'changed', text: 'Rewrote touch handling so tapping, dragging, pinch-zoom, and transforms behave predictably on phones and tablets.', guide: 'mobile' },
			{ type: 'changed', text: 'Replaced numeric inputs with sliders throughout the settings panels.' },
			{ type: 'fixed', text: 'Fixed custom sticker uploads rejecting valid files.', guide: 'add-stickers' }
		]
	},
	{
		id: 'v0.1.0',
		version: '0.1.0',
		name: 'Alpha Release',
		date: '2026-01-01',
		dateLabel: 'January 1, 2026',
		summary: 'The first public release of the layer-based glitter graphics editor.',
		features: [
			{ type: 'added', text: 'Added Glitter Fill layers for applying animated fills to selected image colors.', guide: 'create-glitter' },
			{ type: 'added', text: 'Added Sticker layers and a browser for the archived sticker collection.', guide: 'stickers' },
			{ type: 'added', text: 'Added custom sticker uploads for bringing in your own artwork.', guide: 'add-stickers' },
			{ type: 'added', text: 'Added image loading, preset base images, and blank canvas creation.', guide: 'getting-started' },
			{ type: 'added', text: 'Added layer management with move, scale, rotate, duplicate, reorder, and visibility.', guide: 'working-with-layers' },
			{ type: 'added', text: 'Added animated GIF export with transparency options, size warnings, and automatic frame reduction.', guide: 'export-settings' },
			{ type: 'added', text: 'Added pan and zoom with a transparency checkerboard for seeing through the canvas.', guide: 'canvas-view-options' },
			{ type: 'added', text: 'Added a mobile layout with drawer panels and touch controls.', guide: 'mobile' },
			{ type: 'added', text: 'Added the built-in guide and contextual hints.', guide: 'getting-started' }
		]
	}
];

const PUBLISHED_RELEASES = RELEASES.filter((release) => !release.unreleased);

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.values(value).forEach((entry) => deepFreeze(entry));
	return Object.freeze(value);
}

const CONFIG = deepFreeze({
	project: {
		extension: 'glitter.json',
		fileNameSuffix: '_ryandavi-com'
	},
	app: {
		siteName: 'ryandavi.com glitter editor',
		// Derived from the release list so they can never drift apart.
		version: PUBLISHED_RELEASES[0].version,
		currentRelease: PUBLISHED_RELEASES[0].id,
		releases: PUBLISHED_RELEASES,
		limits: {
			maxLayers: 25,
			historyLimit: 30
		},
		startup: {
			tool: 'select',
			layers: {
				createDefaultGlitterFill: false,
				createBaseImage: true
			}
		},
		behavior: {
			autoSelect: true,
			autoCreateGlitterLayer: true
		},
		assets: {
			manifestVersion: '2026-07-28'
		}
	},

	experimental: {
		htmlScene: {
			localHosts: ['localhost', '127.0.0.1', '::1'],
			defaults: {
				responsive: true,
				stickerSizing: 'scale',
				maxWidth: 1200,
				background: 'canvas',
				customBackground: '#ffffff',
				overflow: 'hidden',
				imageRendering: 'pixelated',
				includeBaseImage: false,
				alignment: 'center',
				minHeight: 0,
				fit: 'contain',
				backgroundRepeat: 'repeat',
				embedAssets: false,
				stickerMetadata: {
					href: '',
					alt: '',
					title: '',
					classes: ''
				}
			},
			limits: {
				minWidth: 100,
				maxWidth: 4096
			}
		}
	},

	canvas: {
		limits: {
			maxWidth: 1024,
			maxHeight: 1024,
			paintHistoryMaxMB: 128,
			maxFileSizeMB: 10
		},
		scalePresets: [50, 100, 200],
		defaults: {
			blankDocument: { width: 400, height: 400, color: '#ffffff' }
		},
		presets: [
			{ id: 'instagram-square', group: 'social', label: 'Instagram Square', detail: '1:1', width: 1024, height: 1024 },
			{ id: 'instagram-portrait', group: 'social', label: 'Instagram Portrait', detail: '4:5', width: 800, height: 1000 },
			{ id: 'instagram-grid', group: 'social', label: 'Instagram Grid', detail: '3:4', width: 768, height: 1024 },
			{ id: 'story-reel', group: 'social', label: 'Story / Reel', detail: '9:16', width: 576, height: 1024 },
			{ id: 'landscape-video', group: 'social', label: 'Landscape', detail: '16:9', width: 1024, height: 576 },
			{ id: 'classic-blingee', group: 'classic', label: 'Classic Blingee', detail: 'Square', width: 400, height: 400 },
			{ id: 'classic-avatar', group: 'classic', label: 'Profile / Avatar', detail: 'Square', width: 300, height: 300 },
			{ id: 'classic-signature', group: 'classic', label: 'Forum Signature', detail: '3:1', width: 600, height: 200 },
			{ id: 'general-square', group: 'general', label: 'Medium Square', detail: '1:1', width: 512, height: 512 },
			{ id: 'general-landscape', group: 'general', label: 'Landscape Photo', detail: '4:3', width: 1024, height: 768 }
		],
		grid: {
			baseSize: 20
		},
		artboard: {
			showBorder: false,
			borderColor: '#00ffff',
			borderWidth: 2,
			borderStyle: 'dashed'
		}
	},

	layers: {
		export: {
			frameRateSource: 'first-layer'
		},
		ui: {
			settingsOpenByDefault: false,
			designPanelAccordion: true
		},
		reorder: {
			autoScroll: {
				zoneSize: 50,
				speed: 10
			}
		}
	},

	tools: {
		autoGlitter: {
			defaults: { colorLayers: 5, paletteStyle: 'vibrant', tuneGlitterHue: true, cleanEdges: true, detail: 4 },
			previewToolAccess: { groups: ['navigation', 'selection'], tools: [] },
			limits: { minColorLayers: 2, maxColorLayers: 20, maxSamples: 24000 },
			timing: { reduceThrottleMs: 80 },
			analysis: { iterations: 12, alphaThreshold: 1, candidateCount: 24, gradientWeight: 18, seedChromaWeight: 12, seedMaxColorBoost: 3.5, hueMinChroma: 0.04, maxHueShift: 20, componentDensityBase: 0.55, componentDensityScale: 0.45, highlightLightness: 0.84, highlightImportanceBoost: 1.2, highlightMergeScale: 0.55, swatchPrimaryWeight: 0.75, swatchMinCoverage: 0.08, swatchCoverageBias: 1.5 },
			cleanup: {
				aliasDissolve: { enabled: true, maxMixtureDistance: 0.12, minBoundaryShare: 0.55, maxShare: 0.25 },
				despeckle: { enabled: true, absMin: 4, shareMin: 0.00004 }
			},
			paletteStyles: {
				vibrant: { mergeDistinctness: 0.045, neutralSimilarityScale: 2.333333, neutralChromaThreshold: 0.075, chromaWeight: 12, maxColorBoost: 3.5, neutralImportance: 0.62, coherenceBase: 0.4, coherenceScale: 0.75, connectedAreaWeight: 4, maxConnectedBoost: 1, connectedNeutralProtection: 0.65, fragmentedSimilarityBoost: 0.6 },
				balanced: { mergeDistinctness: 0.045, neutralSimilarityScale: 1.444444, neutralChromaThreshold: 0.06, chromaWeight: 8, maxColorBoost: 2, neutralImportance: 0.82, coherenceBase: 0.5, coherenceScale: 0.65, connectedAreaWeight: 3, maxConnectedBoost: 0.75, connectedNeutralProtection: 0.75, fragmentedSimilarityBoost: 0.35 },
				natural: { mergeDistinctness: 0.035, neutralSimilarityScale: 1.285714, neutralChromaThreshold: 0.05, chromaWeight: 4, maxColorBoost: 1, neutralImportance: 1, coherenceBase: 0.65, coherenceScale: 0.5, connectedAreaWeight: 2, maxConnectedBoost: 0.5, connectedNeutralProtection: 0.9, fragmentedSimilarityBoost: 0.15 }
			}
		},
		pixelEffects: {
			defaults: {
				pixelateEnabled: false,
				paletteEnabled: false,
				pixelSize: 1,
				paletteMode: 'posterize',
				colorCount: 5,
				paletteStyle: 'balanced',
				mergeDistinctness: 0.045,
				detail: 4,
				cleanEdges: true,
				dither: {
					algorithm: 'bayer', angle: 45, strength: 100, scale: 1, edgeProtection: true, serpentine: true,
					palette: 'auto', duotone: ['#000000', '#ffffff'], shimmer: false
				}
			},
			limits: { minPixelSize: 1, maxPixelSize: 8, minColors: 2, maxColors: 24 },
			analysis: { iterations: 10, maxSamples: 24000 },
			timing: { previewDebounceMs: 80 },
			animation: {
				frameDurationMs: 100,
				algorithms: {
					bayer: { frames: 8, offsetPerFrame: 13 },
					halftone: { frames: 16, offsetPerFrame: 0.5 }
				}
			},
			presets: {
				bw: ['#000000', '#ffffff'],
				gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
				cga: ['#000000', '#55ffff', '#ff55ff', '#ffffff'],
				sepia: ['#2b1b17', '#704f3a', '#b79268', '#f2dfc2']
			}
		},
		selection: {
			defaults: {
				threshold: 50,
				feather: 0
			},
			transparency: {
				alphaThreshold: 254,
				allowTransparentSelection: true
			},
			timing: {
				sliderDebounceMs: 150
			}
		},
		effects: {
			defaults: {
				scale: 100,
				opacity: 100
			}
		},
		maskBrush: {
			limits: {
				minSize: 1,
				maxSize: 300
			},
			defaults: {
				size: 40,
				softness: 0,
				flow: 100,
				// Brush tip shape. One of the ids in MaskEditor.BRUSH_SHAPES
				// (round, square, calligraphy, star, heart). Only affects painting; the
				// stamped result is baked into the mask, so export needs no shape info.
				shape: 'round',
				// Stroke smoothing/stabilization, 0 = off (default). Surfaced as a
				// 0-100% slider; MaskEditor maps it to an EMA follow factor.
				smoothing: 0
			},
			stroke: {
				stampSpacing: 0
			},
			// Per-mode overrides (WP1): Brush and Eraser keep independent setting
			// sets (MaskEditor.toolSettings). Only the keys listed here differ from
			// the shared defaults above; everything else is inherited. Eraser starts
			// a bit larger since erasing is usually a coarser correction pass.
			eraserDefaults: {
				size: 60,
				softness: 0,
				flow: 100
			},
			overlay: {
				color: '#ff2d8a',
				opacity: 0.75,
				stripeOpacityBoost: 0.15,
				// While an erase stroke is in progress the overlay also paints the
				// region removed SO FAR this stroke in this colour, so "what you're
				// taking out" is visible rather than just an edge quietly receding.
				eraseBiteColor: '#ff3b30',
				eraseBiteOpacity: 0.6
			},
			cursor: {
				stroke: '#ffffff'
			},
			livePreview: {
				throttle: 'raf'
			},
			// Sampled bitmap-tip brush packs (imported from Photoshop .abr — see
			// tools/abr-import.js). BrushLibrary loads this at boot alongside the
			// vector tips in ShapeLibrary.
			rasterBrushes: {
				manifest: 'data/brushes.json?v=1'
			},
			brushTips: {
				categories: 'data/brush-categories.json'
			},
			// Per-brush "Scatter & Jitter" panel: slider ranges + the neutral
			// defaults a brush falls back to. Stored overrides live per brush id in
			// MaskEditor's brushDynamics store; Reset drops back to the brush's
			// manifest value (BrushLibrary.defaultDynamics), else these.
			dynamics: {
				defaults: {
					scatter: 0,        // 0..300 (% of brush size), 0 = off
					count: 1,          // 1..16 dabs per stamp
					countJitter: 0,    // 0..100 (%)
					sizeJitter: 0,     // 0..100 (%)
					angleJitter: 0,    // 0..100 (%)
					angle: 0,          // -180..180 (deg) — raster tips only
					roundness: 100,    // 5..100 (%) — raster tips only
					flipX: false,
					flipY: false,
					bothAxes: true     // scatter across the stroke normal AND tangent
				},
				limits: {
					scatterMax: 1000,   // % of brush size — matches Photoshop's Scatter range
					countMax: 16
				}
			}
		},
		glitter: {
			defaults: {
				// Fill/border/shadow each carry their own default glitter id AND solid
				// color. Shared across every layer type that has that slot
				// (glitter-fill, text, shape) so retuning one slot's default doesn't
				// touch the others, and doesn't need to be set separately per layer type.
				fillGlitterId: 111,
				borderGlitterId: 9,
				shadowGlitterId: 109,
				fillColor: '#ff66cc',
				borderColor: '#000000',
				shadowColor: '#000000',
				// Color adjust (WP4) identity defaults, shared by every glitter swatch
				// (fill layers + text/shape effect slots). Also the reset-button targets
				// (updateResetButton reads CONFIG['default'+SliderId]).
				colorAdjust: {
					hue: 0,
					saturation: 100,
					brightness: 100
				}
			},
			ui: {
				settingsOpenByDefault: false
			},
			preview: {
				selectedOutlineOffset: 2,
				selectedOutlineWidth: 2
			}
		},
		stickers: {
			// null preserves an empty new sticker layer.
			defaultStickerId: 1,
			maxCount: 50,
			maxUploadSize: 10 * 1024 * 1024,
			allowedTypes: ['image/png', 'image/jpeg', 'image/gif'],
			// How an upload's image-rendering is decided lives in
			// data/rendering-rules.json, shared verbatim with the admin
			// analyzer. Deliberately not duplicated here.
			renderingRulesPath: 'data/rendering-rules.json',
			defaults: {
				transform: {
					position: { x: 0, y: 0 },
					rotation: 0,
					scale: { x: 100, y: 100 },
					proportionalScale: true,
					opacity: 100,
					flipX: false,
					flipY: false
				}
			},
			rotationSnapTolerance: 5,
			transform: {
				roundValues: true
			},
			shadow: {
				defaultOffsetX: 6,
				defaultOffsetY: 6
			}
		},
		text: {
			defaultTextCase: 'none',
			// Stage Two in-canvas typing is intentionally paused; this is its future gate.
			canvasEditing: false,
			fontsManifest: 'data/fonts.json?v=4',
			defaultFontId: 'luckiest-guy',
			defaultFontWeight: 400,
			defaultFontStyle: 'normal',
			defaultText: 'glitter',
			defaultBoxMode: 'auto',
			defaultVerticalAlign: 'top',
			minBoxSize: 4,
			defaultFontSize: 64,
			minFontSize: 12,
			maxFontSize: 256,
			defaultLetterSpacing: 0,
			minLetterSpacing: -5,
			maxLetterSpacing: 40,
			lineHeight: 1.1,
			maxTextLength: 200,
			border: {
				minWidthPx: 1,
				maxWidthPx: 24,
				defaultWidthPx: 4,
				defaultPlacement: 'outside',
				defaultDrawOrder: 'behind',
				defaultSource: 'glitter',
				defaultEdgeStyle: 'round'
			},
			shadow: {
				defaultOffsetX: 6,
				defaultOffsetY: 6
			}
		},
		shapes: {
			manifest: 'data/shapes.json?v=1',
			defaultShapeId: 'circle',   // one of ShapeLibrary.FILL_SHAPES ids
			defaultSize: 160,           // intrinsic px for a click (no-drag) create
			minSize: 8,
			border: {
				minWidthPx: 1,
				maxWidthPx: 100,
				defaultWidthPx: 6,
				defaultStyle: 'solid',
				minDotSpacingPx: 1,
				maxDotSpacingPx: 60,
				defaultDotSpacingPx: 10,
				defaultPlacement: 'outside',
				defaultDrawOrder: 'behind',
				defaultSource: 'solid',
				defaultEdgeStyle: 'round',
				// Canvas bevels a miter join once its point would exceed this many
				// line-widths -- also doubles as the outside/center canvas padding
				// multiplier (getBorderOutsidePadding), so raising it grows the
				// allocated canvas size too. 8 covers star/sparkle points without
				// ballooning padding at max border width. Only applies to
				// outside/center -- see hardEdgeInsideMiterLimit for inside.
				hardEdgeMiterLimit: 8,
				// 'inside' placement clips a double-width centered stroke to the
				// shape path instead of offsetting it, so above ~2 a reflex/concave
				// vertex (heart notch, star inner corners) self-intersects the clip
				// and the fill splits into disconnected slivers. Keep this low.
				hardEdgeInsideMiterLimit: 2
			},
			shadow: {
				defaultOffsetX: 6,
				defaultOffsetY: 6
			}
		}
	},

	// Shared effect rendering defaults. Text and shape effects both read these,
	// so they live outside either feature-specific block.
	rendering: {
		maskPaddingPx: 8,
		// App Settings exposes the inverse as Antialias Edges. False restores native
		// Canvas edge coverage; brush Softness remains an independent feather.
		crispMaskEdges: true,
		maskAlphaThreshold: 128,
		textureCoordinates: {
			defaultAnchor: 'artwork',
			defaultOffsetX: 0,
			defaultOffsetY: 0,
			scalePrecision: 2
		},
		transformBehavior: {
			scaleEffects: true,
			scaleTextures: true
		},
		gradient: {
			type: 'linear',
			angle: 180,
			// Stop blending: 'linear' (native), 'smooth' (smoothstep-eased), or
			// 'steps' (hard bands). Implemented as stop-list expansion in
			// effects/effect-source.js so CSS preview and canvas export share literal stops.
			interpolation: 'linear',
			smoothSubdivisions: 8,
			stops: [
				{ offset: 0, color: '#ff4fa3', alpha: 1 },
				{ offset: 1, color: '#6554ff', alpha: 1 }
			]
		},
		borderSampling: {
			minSteps: 16,
			maxSteps: 64,
			stepsPerPixel: 4
		}
	},

	snapping: {
			enabled: true,
			threshold: 6,
			snapToCanvas: true,
			snapToLayers: true
	},

	ui: {
		independentCollapsibleSections: ['layersPanel'],
		zoom: {
			levels: [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16]
		},
		gestures: {
			tapMaxMs: 300,
			tapSlopPx: 10,
			wheelZoomSensitivity: 0.002,
			secondFingerGraceMs: 150,
			secondFingerCommitSlopPx: 24,
			doubleTapMs: 300,
			doubleTapSlopPx: 30,
			// A second touch whose measured contact box exceeds this (CSS px on its
			// longer side, or ~3x the first contact's area) is treated as a palm and
			// kept out of the pinch pair. Set well clear of a thumb tip; devices that
			// don't measure contact geometry report 0/1 and are never affected.
			palmRejectionContactPx: 60,
			inertia: {
				enabled: true,
				decay: 0.92
			}
		},
		gallery: {
			defaultTab: 'glitter'
		},
		mobile: {
			breakpoint: 800,
			stickerHitAreaPadding: 20,
			autoCloseDesignDrawer: false,
			openDrawOnLayerAdd: true
		},
		hints: {
			enabledByDefault: true
		},
		// Bottom context bars. Keep eligibility here so adding a bar or extending
		// one to another movable layer does not require another app.js branch.
		contextToolbars: [
			{ id: 'zoomControls', tool: 'zoom', controls: [
				{ kind: 'button', id: 'zoomOut', icon: 'minus', name: 'Zoom Out', title: 'Zoom Out (-)', action: 'zoomOut' },
				{ kind: 'readout', id: 'zoomPercentage', title: 'Click to reset to 100%', value: '100%', action: 'zoomReset' },
				{ kind: 'button', id: 'zoomIn', icon: 'plus', name: 'Zoom In', title: 'Zoom In (+)', action: 'zoomIn' },
				{ kind: 'button', id: 'fitScreen', icon: 'arrows-up-down', name: 'Fit Screen', title: 'Fit Screen (Ctrl+0)', action: 'zoomFit' },
				{ kind: 'button', id: 'fillScreen', icon: 'maximize', name: 'Fill Screen', title: 'Fill Screen', action: 'zoomFill' }
			] },
			{ id: 'panControls', tool: 'hand', controls: [
				{ kind: 'button', id: 'centerCanvasHorizontal', icon: 'arrows-left-right', name: 'Center H', title: 'Center Horizontally', action: 'centerCanvasH' },
				{ kind: 'button', id: 'centerCanvasVertical', icon: 'arrows-up-down', name: 'Center V', title: 'Center Vertically', action: 'centerCanvasV' }
			] },
			{
				id: 'layerCenterControls',
				tool: 'select',
				allowMultiSelection: true,
				controls: [
					{ kind: 'toggle', id: 'contextAutoSelect', label: 'Auto-Select' },
					{ kind: 'button', id: 'centerLayerHorizontal', icon: 'arrows-left-right', name: 'Center H', title: 'Center Horizontally', action: 'centerSelectionH' },
					{ kind: 'button', id: 'centerLayerVertical', icon: 'arrows-up-down', name: 'Center V', title: 'Center Vertically', action: 'centerSelectionV' },
					{ kind: 'button', id: 'duplicateLayerSelection', icon: 'clone', name: 'Duplicate', title: 'Duplicate selected layer(s) (Ctrl+D)', action: 'duplicateSelection' }
				]
			},
			{ id: 'colorPickerControls', tool: 'colorPicker', layerTypes: ['glitter-fill'], controls: [
				{ kind: 'slider', id: 'contextThreshold', valueId: 'contextThresholdValue', slider: 'threshold' },
				{ kind: 'group', controls: [
					{ kind: 'toggle', id: 'contextMultiSelect', label: 'Multi', countId: 'contextSelectionCount' },
					{ kind: 'toggle', id: 'contextContiguous', label: 'Contiguous' }
				] }
			] },
			{ id: 'maskBrushControls', tool: 'brush', controls: [
				{ kind: 'segmented', id: 'maskBrushMode', options: [
					{ label: 'Paint', mode: 'add', action: 'brushSetPaint', title: 'Paint mask (B)' },
					{ label: 'Erase', mode: 'sub', action: 'brushSetErase', title: 'Erase mask (E / X)' }
				] },
				{ kind: 'slider', id: 'maskBrushSizeQuick', valueId: 'maskBrushSizeQuickValue', label: 'Size', min: 1, max: 300, value: 40, unit: 'px' }
			] }
		],
		// Ranges/defaults for renderer-stamped panel sliders (js/ui/panel-renderer.js
		// + PANEL_SCHEMAS). Values are preserved byte-for-byte from the
		// pre-template static markup. Known, deliberate-for-now inconsistencies
		// (reconciling them is a product decision, never a refactor side effect):
		// textureScale max 300 vs the transform panel's 500 scale max;
		// borderWidth/borderDotSpacing maxes are boot defaults that
		// ShapeGlitterManager raises from CONFIG.tools.shapes.border at bind time.
			sliders: {
			autoGlitterColorCount: { label: 'Colors', unit: '', min: 2, max: 12, step: 1, value: 5 },
			autoGlitterMergeDistinctness: { label: 'Combine Similar', unit: '', min: 0.01, max: 0.12, step: 0.005, value: 0.045 },
			autoGlitterDetail: { label: 'Detail', unit: 'px', min: 1, max: 64, step: 1, value: 4 },
			pixelEffectsPixelSize: { label: 'Pixel Size', unit: 'px', min: 1, max: 8, step: 1, value: 1 },
			pixelEffectsColorCount: { label: 'Colors', unit: '', min: 2, max: 12, step: 1, value: 5 },
			pixelEffectsMergeDistinctness: { label: 'Combine Similar', unit: '', min: 0.01, max: 0.12, step: 0.005, value: 0.045 },
			pixelEffectsDetail: { label: 'Detail', unit: 'px', min: 1, max: 64, step: 1, value: 4 },
			pixelEffectsStrength: { label: 'Strength', unit: '%', min: 0, max: 100, step: 1, value: 100 },
			pixelEffectsDitherScale: { label: 'Texture Scale', unit: '×', min: 1, max: 4, step: 1, value: 1 },
			pixelEffectsAngle: { label: 'Angle', unit: 'Â°', min: 0, max: 360, step: 1, value: 45 },
			maskBrushSize: { label: 'Size', unit: 'px', min: 1, max: 300, value: 40 },
			maskBrushSoftness: { label: 'Softness', unit: '%', min: 0, max: 100, value: 0 },
			maskBrushFlow: { label: 'Flow', unit: '%', min: 1, max: 100, value: 100 },
			maskBrushSpacing: { label: 'Spacing', unit: '%', min: 1, max: 200, value: 25 },
			maskBrushSmoothing: { label: 'Smoothing', unit: '%', min: 0, max: 100, value: 0 },
			textureScale: { label: 'Texture Scale', unit: '%', min: 25, max: 300, value: 100 },
			textureOffsetX: { label: 'Offset X', unit: 'px', min: -500, max: 500, step: 1, value: 0 },
			textureOffsetY: { label: 'Offset Y', unit: 'px', min: -500, max: 500, step: 1, value: 0 },
			slotOpacity: { label: 'Opacity', unit: '%', min: 0, max: 100, value: 100 },
			hue: { label: 'Hue', unit: '°', min: -180, max: 180, value: 0 },
			saturation: { label: 'Saturation', unit: '%', min: 0, max: 200, value: 100 },
			brightness: { label: 'Brightness', unit: '%', min: 25, max: 200, value: 100 },
			borderWidth: { label: 'Width', unit: 'px', min: 1, max: 60, value: 6 },
			textBorderWidth: { label: 'Width', unit: 'px', min: 1, max: 24, value: 4 },
			borderDotSpacing: { label: 'Dot Spacing', unit: 'px', min: 1, max: 60, value: 10 },
			shadowOffsetX: { label: 'Offset X', unit: 'px', min: -60, max: 60, value: 6 },
			shadowOffsetY: { label: 'Offset Y', unit: 'px', min: -60, max: 60, value: 6 },
			threshold: { label: 'Threshold', unit: '', min: 0, max: 255, value: 50 },
			feather: { label: 'Feather', unit: '', min: 0, max: 50, value: 0 },
			textFontSize: { label: 'Font Size', unit: 'px', min: 12, max: 256, value: 64 },
			textLetterSpacing: { label: 'Letter Spacing', unit: 'px', min: -20, max: 40, value: 0 },
			textLineHeight: { label: 'Line Height', unit: '%', min: 50, max: 250, value: 110 },
			transformScale: { label: 'Scale', unit: '%', min: 10, max: 500, value: 100 },
			transformRotation: { label: 'Rotation', unit: '°', min: 0, max: 360, step: 1, value: 0 },
			transformOpacity: { label: 'Opacity', unit: '%', min: 0, max: 100, value: 100 }
		},
		// Valid values for the Settings > Theme select; each needs a matching
		// :root[data-theme="…"] token block in css/_themes.scss.
		themes: ['dark', 'llama', 'cyber-chrome', 'light', 'bubblegum', 'bliss', 'dew', 'aqua', 'p2p', 'homepage', 'buddy-list'],
		stickerHandles: {
			enabled: true,
			cornerSize: 8,
			outwardOffset: 4,
			rotationHandleRadius: 5,
			rotationHandleDistance: 30,
			handleFill: '#ffffff',
			handleStroke: 'var(--color-bg-secondary)',
			handleStrokeWidth: 1.5,
			boundingBoxColor: 'var(--color-accent)',
			boundingBoxWidth: 1.5,
			handleHitboxPadding: 8,
			touchMinHandleSpan: 72,
			// Layer scale limits. enabled:false = Figma/Photoshop parity (no max);
			// hardMin/hardMax stay as safety rails so scale can never hit 0 or
			// blow up the DOM. All scale writes clamp via clampLayerScale().
			scaleLimits: {
				enabled: false,
				min: 10,
				max: 500,
				hardMin: 1,
				hardMax: 10000
			},
		},
	},

	export: {
		core: {
			// Base name for user-facing downloads; the project title overrides this.
			defaultBaseName: 'ryandavi-com_glitter',
			workers: 4,
			quality: 1,
			timing: {
				forceDelay: 100,
				maxFrames: 60
			}
		},
		timeline: {
			maxSamplingFps: 30,
			preferredFrameBudget: 60,
			hardFrameLimit: 1000,
			exactDuplicateThreshold: 0,
			balancedVisualError: 0.008,
			smallFileVisualError: 0.02,
			maxLoopDurationMs: 12000,
			defaultPreset: 'balanced',
			presets: {
				highFidelity: { label: 'High Fidelity', visualError: 0, maxSamplingFps: 30 },
				balanced: { label: 'Balanced', visualError: 0.008, maxSamplingFps: 24 },
				smallFile: { label: 'Small File', visualError: 0.02, maxSamplingFps: 15 }
			}
		},
		defaults: {
			format: 'gif',
			baseImage: true,
			glitter: true,
			stickers: true,
			transparency: true,
			matteColor: '#ffffff',
			quality: 10,
			ditherEnabled: false,
			ditherType: 'FloydSteinberg-serpentine',
			colorCount: 'auto',
			ditherAmount: 80,
			ditherScale: 1,
			ditherTemporalMode: 'stable',
			ditherEdgeProtection: true,
			paletteStyle: 'balanced',
			ditherPreset: 'clean',
			frameDelay: 110,
			maxFrames: 60,
			frameSkip: 1,
			reverse: false,
			smartFrameReduction: true,
			optimizationPreset: 'balanced',
			// 'auto' follows the chosen Optimization Goal.
			maxSamplingFps: 'auto',
			watermarkEnabled: false,
			watermark: 'images/watermark/2.png'
		},
		mp4: {
			lengthMode: 'duration',
			targetDurationSeconds: 15,
			minDurationSeconds: 1,
			maxDurationSeconds: 600,
			loopCount: 3,
			minLoopCount: 1,
			maxLoopCount: 100,
			defaultQuality: 'standard',
			qualityPresets: {
				compact: { label: 'Compact', bitrate: 1000000 },
				standard: { label: 'Standard', bitrate: 2000000 },
				high: { label: 'High', bitrate: 4000000 }
			},
			// Ascending H.264 levels let the encoder select the lowest level that
			// can represent the requested canvas, through the 2048px document cap.
			codecs: [
				'avc1.42001f', 'avc1.4d001f', 'avc1.64001f',
				'avc1.420028', 'avc1.4d0028', 'avc1.640028',
				'avc1.42002a', 'avc1.4d002a', 'avc1.64002a',
				'avc1.420032', 'avc1.4d0032', 'avc1.640032',
				'avc1.420033', 'avc1.4d0033', 'avc1.640033'
			],
			supportProbeWidth: 16,
			supportProbeHeight: 16,
			supportProbeFrameRate: 30,
			keyFrameInterval: 30,
			maxEncodeQueueSize: 8
		},
		limits: {
			maxFramesHardLimit: 1000,
			colorAnalysis: {
				paletteSize: 256,
				significantColorCount: 1024,
				maxFrames: 12,
				maxPixelsPerFrame: 65536
			},
			sizeWarnings: [
				{ label: 'Too large for X mobile', detail: '5 MB max', limitMB: 5 },
				{ label: 'Tumblr may compress or flatten it', detail: 'Keep under 5 MB', limitMB: 5 },
				{ label: 'Too large for Discord without Nitro', detail: '10 MB max', limitMB: 10 },
				{ label: 'Too large for X on the web', detail: '15 MB max', limitMB: 15 },
				{ label: 'Too large for Discord Nitro Basic', detail: '50 MB max', limitMB: 50 },
				{ label: 'Too large for Discord Nitro', detail: '500 MB max', limitMB: 500 }
			]
		},
		watermark: {
			alphaThreshold: 128,
			url: 'images/watermark/2.png',
			options: [
				{ label: 'Made with Rybaby', url: 'images/watermark/1.gif' },
				{ label: 'Rybaby Signature', url: 'images/watermark/2.png' }
			],
			position: 'bottom-right',
			paddingX: 5,
			paddingY: 5,
			opacity: 100,
			scale: 100
		}
	},

	debug: {
		forceIOSExportPreview: false,
		enabled: false
	},
});

const LayerType = {
	GLITTER_FILL: 'glitter-fill',
	STICKER: 'sticker',
	TEXT_GLITTER: 'text-glitter',
	SHAPE: 'shape',
	BASE_IMAGE: 'base-image',
};

const ToolType = {
	SELECT: 'select',
	TEXT: 'text',
	SHAPE: 'shape',
	HAND: 'hand',
	COLOR_PICKER: 'colorPicker',
	BRUSH: 'brush',
	ZOOM: 'zoom'
};

// Reusable capability groups for focused editor modes. A preview session can
// permit whole groups and add individual tool exceptions through one policy.
const TOOL_GROUPS = Object.freeze({
	navigation: Object.freeze([ToolType.HAND, ToolType.ZOOM]),
	selection: Object.freeze([ToolType.SELECT]),
	creation: Object.freeze([ToolType.TEXT, ToolType.SHAPE]),
	paint: Object.freeze([ToolType.COLOR_PICKER, ToolType.BRUSH]),
	contentEditing: Object.freeze([
		ToolType.SELECT,
		ToolType.TEXT,
		ToolType.SHAPE,
		ToolType.COLOR_PICKER,
		ToolType.BRUSH
	]),
	all: Object.freeze(Object.values(ToolType))
});

function toolAllowedByAccess(tool, access = {}) {
	const tools = Array.isArray(access.tools) ? access.tools : [];
	const groups = Array.isArray(access.groups) ? access.groups : [];
	return tools.includes(tool) || groups.some((name) => TOOL_GROUPS[name]?.includes(tool));
}

const TOOL_TOUCH_ROUTES = {
	[ToolType.SHAPE]: 'creationDrag',
	[ToolType.TEXT]: 'tapCreate'
};

function hasMaskContent(layer) {
	return Boolean(
		layer &&
		layer.type === LayerType.GLITTER_FILL &&
		(
			(Array.isArray(layer.selections) && layer.selections.length > 0) ||
			layer.maskHasContent
		)
	);
}

function layerHasActiveColorAdjust(layer) {
	const colorAdjusts = [layer?.settings?.colorAdjust];
	if (layer?.type === LayerType.TEXT_GLITTER) {
		colorAdjusts.push(layer.textData?.border?.colorAdjust, layer.textData?.shadow?.colorAdjust);
	} else if (layer?.type === LayerType.SHAPE) {
		colorAdjusts.push(layer.shapeData?.fill?.colorAdjust, layer.shapeData?.border?.colorAdjust, layer.shapeData?.shadow?.colorAdjust);
	}

	return colorAdjusts.some((adjust) => adjust && !isIdentityColorAdjust(adjust));
}

function layerHasBorderEffect(layer) {
	if (layer?.type === LayerType.TEXT_GLITTER) {
		return Boolean(layer.textData?.border);
	}

	if (layer?.type === LayerType.SHAPE) {
		return Boolean(layer.shapeData?.border);
	}

	return false;
}

function layerHasShadowEffect(layer) {
	if (layer?.type === LayerType.TEXT_GLITTER) {
		return Boolean(layer.textData?.shadow);
	}

	if (layer?.type === LayerType.SHAPE) {
		return Boolean(layer.shapeData?.shadow);
	}

	return false;
}

function layerHasVisibleContent(layer) {
	switch (layer?.type) {
		case LayerType.STICKER:
			return !layer.stickerData || !layer.stickerData.isEmpty;
		case LayerType.TEXT_GLITTER:
			return Boolean(layer.textData?.text?.trim());
		case LayerType.SHAPE:
			return Boolean(layer.shapeData);
		case LayerType.GLITTER_FILL:
			return hasMaskContent(layer);
		case LayerType.BASE_IMAGE:
			return true;
		default:
			return false;
	}
}

// Sidebar panel naming convention (keep new panels consistent with this):
//   "<Thing> Properties" — attributes of the SELECTED LAYER/object
//                          (Glitter Properties, Sticker Properties, Text Properties).
//   "<Tool> Settings"     — configuration of a TOOL/action, not a specific layer
//                          (Brush Settings, Color Fill Settings).
// The visible titles live in index.html (.section-header-title-text); the guide
// (modals/guide.html) must mirror them. Section *ids* are historically all
// `*SettingsSection` regardless of title — that's internal only, don't rename.
const LAYER_UI_CONFIG = {
	NO_IMAGE: {
		designPanelSections: [],
		mobileSettingsSections: [],
		panelMode: 'welcome'
	},
	NO_LAYER: {
		designPanelSections: ['noLayerSettingsSection'],
		mobileSettingsSections: [],
		panelMode: 'no-layer'
	},
	AUTO_GLITTER: {
		designPanelSections: ['glitterSearchSection', 'glitterOptions', 'autoGlitterSettingsSection'],
		mobileSettingsSections: ['autoGlitter'],
		panelMode: 'auto-glitter'
	},

	[LayerType.BASE_IMAGE]: {
		displayName: 'Base Image',
		serialization: {
			dataKey: 'background',
			omit: ['name', 'settings'],
			forceLocked: true,
			defaultSelectedGlitterId: () => CONFIG.tools.glitter.defaults.fillGlitterId,
			defaults: { image: null },
			normalize: (editor, layer) => editor.baseBackgroundManager?.normalizeLayer(layer)
		},
		goTo: null,
		designPanelSections: ['glitterSearchSection', 'glitterOptions', 'baseLayerSettingsSection'],
		mobileSettingsSections: ['background'],
		panelMode: 'base-layer',
		onActivate: (editor, layer) => {
			editor.baseBackgroundManager?.loadLayerSettings(layer);
		}
	},

	[LayerType.GLITTER_FILL]: {
		displayName: 'Fill Layer',
		serialization: {
			extraKeys: ['selections', 'fill', 'autoGlitter'],
			includeMaskVersion: true,
			defaults: { maskHasContent: false }
		},
		addedStatusMessage: 'New fill layer added',
		goTo: 'glitter',
		addableViaModal: {
			label: 'Fill Layer',
			icon: 'glitter',
			description: 'Paint an animated or solid fill onto the image'
		},
		designPanelSections: ['brushTipSearchSection', 'brushTipOptions', 'glitterSearchSection', 'glitterOptions', 'glitterSettingsSection'],
		mobileSettingsSections: ['glitter'],
		panelMode: 'glitter',
		elementClass: 'glitter-element',
		managerKey: 'glitterManager',
		autoOpenDesignDrawerOnCreate: true,
		onActivate: (editor, layer) => {
			if (!layer.locked && !hasMaskContent(layer) && layer.selectedGlitterId && editor.currentTool !== ToolType.BRUSH) {
				editor.setTool(ToolType.COLOR_PICKER);
			}
			editor.updateGlitterSelection();
			editor.setSettingsEmptyState('layerSettings', false);
			editor.setSettingsEmptyState('glitterSettings', false);
			editor.loadActiveLayerSettings();
		}
	},

	[LayerType.STICKER]: {
		displayName: 'Sticker',
		serialization: {
			custom: { serialize: 'serializeSticker', deserialize: 'deserializeSticker' }
		},
		addedStatusMessage: 'New sticker layer added',
		goTo: 'sticker',
		addableViaModal: {
			label: 'Sticker',
			icon: 'sticker',
			description: 'Add images and graphics'
		},
		designPanelSections: ['stickersSearchSection', 'stickersOptions', 'glitterSearchSection', 'glitterOptions', 'stickerSettingsSection'],
		mobileSettingsSections: ['sticker'],
		panelMode: 'sticker',
		elementClass: 'sticker-element',
		transformable: true,
		managerKey: 'stickerManager',
		hitTestMethod: 'isPointInSticker',
		transformPrefix: 'sticker',
		transformCapabilities: {
			position: true,
			size: true,
			scaleReadout: true,
			scaleReset: true,
			lockAspect: true,
			rotation: true,
			opacity: true,
			flip: true,
			align: true,
			reset: true
		},
		autoOpenDesignDrawerOnCreate: true,
		onActivate: (editor, layer) => {
			editor.setTool(ToolType.SELECT);

			const stickerContent = document.getElementById('stickerSettingsContent');
			if (layer.stickerSourceId) {
				editor.setSettingsEmptyState('stickerSettings', false);
				editor.loadStickerSettings(layer);
			} else {
				if (stickerContent) stickerContent.classList.remove('visible');
				editor.setSettingsEmptyState('stickerSettings', true);
			}

			editor.updateStickerSelection();
		}
	},

	[LayerType.TEXT_GLITTER]: {
		displayName: 'Text',
		serialization: {
			dataKey: 'textData',
			defaultName: (editor, data) => editor.textGlitterManager?.getLayerName(data?.text || ''),
			normalize: (editor, layer) => editor.textGlitterManager?.normalizeLayer(layer),
			hydrate: async (editor, layer) => {
				if (layer.textData?.fontId) await editor.textGlitterManager?.ensureFontLoaded(layer.textData.fontId);
			}
		},
		addedStatusMessage: 'New text layer added',
		goTo: 'glitter',
		addableViaModal: {
			label: 'Text',
			icon: 'text',
			description: 'Fill editable text with glitter, color, or gradient'
		},
		// No layerSettingsSection / 'tool': Selection Settings only applies to
		// color-picked glitter fills — text layers hide it instead of showing an
		// explanatory empty state.
		designPanelSections: ['glitterSearchSection', 'glitterOptions', 'textSettingsSection'],
		mobileSettingsSections: ['text'],
		panelMode: 'text',
		elementClass: 'text-glitter-element',
		transformable: true,
		managerKey: 'textGlitterManager',
		hitTestMethod: 'isPointInText',
		transformPrefix: 'text',
		transformCapabilities: {
			position: true,
			size: true,
			scaleReadout: true,
			lockAspect: true,
			rotation: true,
			opacity: true,
			flip: true,
			align: true,
			reset: true
		},
		createOptionsKey: 'textLayer',
		autoOpenDesignDrawerOnCreate: true,
		// Reopening the side panel after every tap-created layer is desktop
		// convenience, not a mobile ask - Editor.finishLayerCreation() reads this.
		mobileCreateBehavior: { skipReload: true },
		onActivate: (editor, layer) => {
			const validTools = new Set([ToolType.SELECT, ToolType.HAND, ToolType.ZOOM, ToolType.BRUSH]);
			if (!validTools.has(editor.currentTool)) {
				editor.setTool(ToolType.SELECT);
			}

			editor.updateGlitterSelection();
			editor.textGlitterManager?.loadLayerSettings(layer);
		}
	},

	[LayerType.SHAPE]: {
		displayName: 'Shape',
		serialization: {
			dataKey: 'shapeData',
			defaultName: () => 'Shape',
			normalize: (editor, layer) => editor.shapeGlitterManager?.normalizeLayer(layer)
		},
		addedStatusMessage: 'New shape layer added',
		goTo: 'glitter',
		addableViaModal: {
			label: 'Shape',
			icon: 'square',
			description: 'Fill a shape with glitter, color, or gradient'
		},
		// Like text: the glitter gallery picks the shared swatch, plus a dedicated
		// Shape Properties panel. Selection Settings doesn't apply.
		designPanelSections: ['glitterSearchSection', 'glitterOptions', 'shapesOptions', 'shapeSettingsSection'],
		mobileSettingsSections: ['shape'],
		panelMode: 'shape',
		elementClass: 'shape-glitter-element',
		transformable: true,
		managerKey: 'shapeGlitterManager',
		hitTestMethod: 'isPointInShape',
		transformPrefix: 'shape',
		transformCapabilities: {
			position: true,
			size: true,
			scaleReadout: true,
			lockAspect: true,
			rotation: true,
			opacity: true,
			flip: true,
			align: true,
			reset: true
		},
		createOptionsKey: 'shapeLayer',
		// Unlike text/glitter/sticker, tapping the Shape tool repeatedly to place
		// several shapes shouldn't keep yanking the Design drawer open on mobile.
		autoOpenDesignDrawerOnCreate: false,
		mobileCreateBehavior: { skipReload: true },
		onActivate: (editor, layer) => {
			const validTools = new Set([ToolType.SELECT, ToolType.HAND, ToolType.ZOOM, ToolType.SHAPE]);
			if (!validTools.has(editor.currentTool)) {
				editor.setTool(ToolType.SELECT);
			}

			editor.updateGlitterSelection();
			editor.shapeGlitterManager?.loadLayerSettings(layer);
		}
	}
};

// Declarative sidebar panel structure consumed by js/ui/panel-renderer.js.
// Structure, ordering, and capabilities
// only — markup lives in the index.html tpl-* <template>s, slider ranges in
// CONFIG.ui.sliders. Stamped element ids preserve the legacy names exactly
// (managers keep binding by id); paintSlot ids derive as idPrefix +
// capitalized role. Panels not listed here are still static index.html
// markup awaiting migration.
const PANEL_SCHEMAS = {
	autoGlitterSession: {
		prefix: 'autoGlitter',
		sectionPrefix: 'autoGlitterSettings',
		mobileKey: 'autoGlitter',
		replaceStatic: true,
		section: { id: 'autoGlitterSettingsSection', icon: 'palette', iconName: 'Palette', title: 'Auto Glitter' },
		groups: [
			{ title: 'Preview', classes: 'auto-glitter-preview-group', static: true, bare: true, items: [
				{ kind: 'card', classes: 'auto-glitter-preview-card', bare: true, items: [
					{ kind: 'segmented', id: 'autoGlitterPreviewMode', label: 'Preview mode', options: [
						{ label: 'Original', value: 'original' }, { label: 'Flat', value: 'flat' }, { label: 'Glitter', value: 'glitter', active: true }
					] }
				] },
				{ kind: 'card', id: 'autoGlitterExisting', classes: 'auto-glitter-existing', hidden: true, items: [
					{ kind: 'host', id: 'autoGlitterExistingSummary', tag: 'p' },
					{ kind: 'radioSegmented', id: 'autoGlitterRerunMode', classes: 'auto-glitter-rerun-mode', label: 'How to handle the previous Auto Glitter layers', options: [
						{ id: 'autoGlitterEditCurrent', label: 'Edit', value: 'edit' },
						{ id: 'autoGlitterReplacePrevious', label: 'Replace', value: 'replace' },
						{ id: 'autoGlitterAddAnother', label: 'Add', value: 'add' }
					] }
				] }
			] },
			{ title: 'Palette', region: 'scroll', items: [
				{ kind: 'card', items: [
					{ kind: 'segmented', id: 'autoGlitterPaletteStyle', classes: 'auto-glitter-palette-style', label: 'Palette style', visibleLabel: 'Palette Style', options: [
						{ label: 'Vibrant', value: 'vibrant' }, { label: 'Balanced', value: 'balanced' }, { label: 'Natural', value: 'natural' }
					] },
					{ kind: 'slider', id: 'autoGlitterColorCount', slider: 'autoGlitterColorCount' },
					{ kind: 'slider', id: 'autoGlitterMergeDistinctness', slider: 'autoGlitterMergeDistinctness' },
					{ kind: 'host', id: 'autoGlitterCapacity', classes: 'settings-row-label-desc' }
				] }
			] },
			{ title: 'Color Matches', region: 'scroll', items: [
				{ kind: 'card', classes: 'auto-glitter-review', items: [
					{ kind: 'host', id: 'autoGlitterStatus', classes: 'auto-glitter-status', attrs: { role: 'status', 'aria-live': 'polite' }, text: 'Finding the image\'s distinct colors…' },
					{ kind: 'host', id: 'autoGlitterResults', classes: 'auto-glitter-results', attrs: { 'aria-label': 'Detected color regions and glitter matches' } }
				] }
			] },
			{ title: 'Advanced', region: 'scroll', items: [
				{ kind: 'card', items: [
					{ kind: 'slider', id: 'autoGlitterDetail', slider: 'autoGlitterDetail', title: 'Absorb connected regions smaller than this many pixels' },
					{ kind: 'checkboxList', items: [
						{ id: 'autoGlitterCleanEdges', label: 'Clean Edges', checked: true, title: 'Absorb anti-aliased blend colors into their neighboring regions' },
						{ id: 'autoGlitterTuneHue', label: 'Tune Matched Glitter Hue', checked: true, title: 'Apply a small hue correction to improve the closest glitter match' }
					] }
				] }
			] },
			{ title: 'Finish', classes: 'auto-glitter-footer-group', static: true, bare: true, items: [
				{ kind: 'card', bare: true, items: [
					{ kind: 'actionRow', classes: 'auto-glitter-actions', actions: [
						{ id: 'cancelAutoGlitterBtn', label: 'Cancel', secondary: true },
						{ id: 'autoGlitterCreateBtn', label: 'Create Layers', primary: true }
					] }
				] }
			] }
		]
	},
	[LayerType.BASE_IMAGE]: {
		prefix: 'baseBackground',
		sectionPrefix: 'baseLayerSettings',
		mobileKey: 'background',
		replaceStatic: true,
		section: { id: 'baseLayerSettingsSection', icon: 'paint-bucket', iconName: 'Canvas', title: 'Canvas Properties' },
		groups: [
			{ title: 'Appearance', items: [
				{ kind: 'paintSlot', slot: 'background', idPrefix: 'baseBackground', title: 'Background',
					texturePosition: true,
					modes: ['image', 'none', 'glitter', 'solid'], activeMode: 'image', color: '#ffffff',
					modeLabels: { none: 'Transparent' },
					hidePrimaryModes: ['image'],
					chipTitle: 'Choose background glitter',
					imageAsset: {
						info: 'baseBackgroundImageInfo', thumbnail: 'baseBackgroundImageThumbnail',
						name: 'baseBackgroundImageName', badges: 'baseBackgroundImageBadges',
						change: 'baseBackgroundImageChange', title: 'Replace base image', compact: true
					},
					primaryIds: { scale: 'baseBackgroundScale', opacity: 'baseBackgroundOpacity' }
				}
			] },
			{ title: 'Canvas', items: [
				{ kind: 'host', id: 'baseCanvasSizeHost' }
			] },

			{ title: 'Effects', items: [
				{ kind: 'card', classes: 'pixelate-effect-card', title: 'Pixelate', toggle: { id: 'pixelEffectsPixelateEnabled', label: 'Enabled' }, items: [
					{ kind: 'slider', id: 'pixelEffectsPixelSize', slider: 'pixelEffectsPixelSize', title: '1 is off; larger values create crisp mosaic cells before palette processing' },
				] },
				{ kind: 'card', classes: 'pixel-effects-card', title: 'Palette', toggle: { id: 'pixelEffectsPaletteEnabled', label: 'Enabled' }, items: [
					{ kind: 'segmented', id: 'pixelEffectsPaletteMode', label: 'Palette effect', options: [
							{ label: 'Posterize', value: 'posterize', active: true }, { label: 'Dither', value: 'dither' }
					] },
					{ kind: 'processingStatus', id: 'pixelEffectsStatus', classes: 'pixel-effects-status' },
					{ kind: 'card', id: 'pixelEffectsPaletteControls', title: 'Colors', classes: 'pixel-effects-controls pixel-effects-control-section', hidden: true, items: [
						{ kind: 'segmented', id: 'pixelEffectsPaletteStyle', label: 'Palette style', visibleLabel: 'Palette Style', options: [
							{ label: 'Vibrant', value: 'vibrant' }, { label: 'Balanced', value: 'balanced', active: true }, { label: 'Natural', value: 'natural' }
						] },
						{ kind: 'slider', id: 'pixelEffectsColorCount', slider: 'pixelEffectsColorCount' },
						{ kind: 'slider', id: 'pixelEffectsMergeDistinctness', slider: 'pixelEffectsMergeDistinctness' }
					] },
					{ kind: 'advanced', id: 'pixelEffectsPosterizeControls', label: 'Cleanup', classes: 'pixel-effects-controls', hidden: true, items: [
						{ kind: 'slider', id: 'pixelEffectsDetail', slider: 'pixelEffectsDetail' },
						{ kind: 'checkboxList', items: [{ id: 'pixelEffectsCleanEdges', label: 'Clean Edges', checked: true, title: 'Absorb tiny connected regions into their neighbors' }] }
					] },
					{ kind: 'content', id: 'pixelEffectsDitherControls', classes: 'pixel-effects-controls pixel-effects-dither-controls', hidden: true, items: [
						{ kind: 'select', id: 'pixelEffectsAlgorithm', label: 'Dither algorithm', visibleLabel: 'Algorithm', options: [
							{ label: 'Bayer', value: 'bayer', active: true }, { label: 'Floyd–Steinberg', value: 'floyd' }, { label: 'Atkinson', value: 'atkinson' }, { label: 'Halftone', value: 'halftone' }
						] },
						{ kind: 'select', id: 'pixelEffectsDitherPalette', label: 'Dither palette', visibleLabel: 'Color Palette', options: [
							{ label: 'Auto (Image Colors)', value: 'auto', active: true }, { label: 'Black & White', value: 'bw' }, { label: 'Game Boy', value: 'gameboy' }, { label: 'CGA', value: 'cga' }, { label: 'Sepia', value: 'sepia' }, { label: 'Duotone', value: 'duotone' }
						] },
						{ kind: 'host', id: 'pixelEffectsDuotone', classes: 'text-effect-color-row pixel-effects-duotone' },
						{ kind: 'card', title: 'Pattern', classes: 'pixel-effects-control-section', items: [
							{ kind: 'slider', id: 'pixelEffectsStrength', slider: 'pixelEffectsStrength' },
							{ kind: 'slider', id: 'pixelEffectsDitherScale', slider: 'pixelEffectsDitherScale' },
							{ kind: 'slider', id: 'pixelEffectsAngle', slider: 'pixelEffectsAngle' }
						] },
						{ kind: 'card', title: 'Shimmer', classes: 'pixel-effects-control-section', items: [
							{ kind: 'checkboxList', items: [{ id: 'pixelEffectsShimmer', label: 'Animate Dither', title: 'Animate the Bayer or Halftone pattern in the preview and exported GIF' }] },
							{ kind: 'host', id: 'pixelEffectsShimmerHint', classes: 'settings-row-label-desc', text: 'Bayer and Halftone only. Animates the preview and exported GIF; may increase file size.' }
						] }
					] }
				] },
				{ kind: 'card', title: 'Reset', classes: 'pixel-effects-reset-card', items: [
					{ kind: 'actionRow', classes: 'pixel-effects-actions', actions: [
						{ id: 'resetPixelEffects', label: 'Reset Effects', secondary: true, title: 'Restore all Pixelate and Palette settings to their defaults' }
					] }
				] }
			] },
			{ title: 'Actions', items: [
				{ kind: 'card', items: [
					{ kind: 'actionRow', actions: [
						{ id: 'autoGlitterImageBtn', label: 'Auto Glitter', primary: true, title: 'Turn the image colors into editable glitter fill layers' }
					] }
				] }
			] },


		]
	},
	brush: {
		prefix: 'brush',
		sectionPrefix: 'brushSettings',
		mobileKey: 'brush',
		replaceStatic: true,
		section: {
			id: 'brushSettingsSection', icon: 'brush', iconName: 'Brush', title: 'Mask Settings',
			titleIconId: 'brushSettingsTitleIcon', titleTextId: 'brushSettingsTitleText'
		},
		groups: [
			{ title: 'Brush Tip', items: [
				{ kind: 'card', title: 'Shape', items: [
					{ kind: 'assetInfo', info: 'brushTipInfo', thumbnail: 'brushTipThumbnail',
						name: 'brushTipName', badges: 'brushTipBadges', change: 'brushTipChange',
						title: 'Choose another brush tip', compact: true }
				] }
			] },
			{ title: 'Stroke', items: [
				{ kind: 'card', title: 'Dynamics', items: [
					{ kind: 'twoColumn', items: [
						{ kind: 'slider', id: 'maskBrushSize', slider: 'maskBrushSize' },
						{ kind: 'slider', id: 'maskBrushSoftness', slider: 'maskBrushSoftness' }
					] },
					{ kind: 'twoColumn', items: [
						{ kind: 'slider', id: 'maskBrushFlow', slider: 'maskBrushFlow' },
						{ kind: 'slider', id: 'maskBrushSpacing', slider: 'maskBrushSpacing', title: 'Distance between stamps along a stroke, as a percentage of brush size. Higher values create more space.' }
					] },
					{ kind: 'slider', id: 'maskBrushSmoothing', slider: 'maskBrushSmoothing', title: 'Stabilizes shaky strokes by easing the brush toward the cursor. Higher values are smoother but add lag.' },
					{ kind: 'checkboxList', items: [
						{ id: 'maskBrushPressure', label: 'Pressure Sensitivity', title: 'Vary flow with pen pressure (no effect on mouse/touch)', checked: true }
					] }
				] },
				{ kind: 'card', title: 'Scatter & Jitter', items: [
					{ kind: 'host', id: 'brushDynamicsHost', classes: 'brush-dynamics', wrapInContent: true }
				] }
			] },
			{ title: 'Actions', items: [
				{ kind: 'card', items: [
					{ kind: 'actionRow', actions: [
						{ id: 'maskCopyOppositeSettings', label: 'Copy Eraser Settings', title: 'Copy the other tool\'s settings into this one' },
						{ id: 'maskResetCurrentSettings', label: 'Reset Brush', title: 'Restore this tool\'s settings to their defaults' },
						{ id: 'clearMaskPaint', label: 'Clear Paint', title: 'Remove all painted strokes (color selections stay)' }
					] }
				] }
			] }
		]
	},
	[LayerType.GLITTER_FILL]: {
		prefix: 'glitter',
		sectionPrefix: 'glitterSettings',
		mobileKey: 'glitter',
		section: { id: 'glitterSettingsSection', icon: 'glitter', iconName: 'Glitter', title: 'Fill Properties' },
		controls: { id: 'glitterSettingsControls', emptyId: 'glitterSettingsEmpty', emptyText: 'Select a glitter fill from the gallery to get started.' },
		groups: [
			{ title: 'Appearance', items: [
				{ kind: 'paintSlot', slot: 'fill', idPrefix: 'glitterFill', title: 'Fill',
					texturePosition: true,
					modes: ['glitter', 'solid'], activeMode: 'glitter', color: '#ff4fa3',
					chipTitle: 'Choose fill glitter', assetIdPrefix: 'glitterAsset',
					assetIds: {
						thumbnail: 'glitterAssetThumbnail', name: 'glitterAssetName',
						badges: 'glitterAssetBadges', change: 'glitterAssetChange',
						size: 'glitterAssetSize', frames: 'glitterAssetFrames'
					},
					primaryIds: { scale: 'scale', opacity: 'opacity' },
					advancedIds: { hue: 'glitterHue', saturation: 'glitterSaturation', brightness: 'glitterBrightness' }
				}
			] }
		],
		auxiliarySections: [{
			prefix: 'layer',
			sectionPrefix: 'layerSettings',
			mobileKey: 'tool',
			replaceStatic: true,
			section: { id: 'layerSettingsSection', icon: 'paint-bucket', iconName: 'Sliders', title: 'Color Fill Settings' },
			controls: {
				id: 'layerSettingsControls', emptyId: 'layerSettingsEmpty',
				emptyItems: [
					{ className: 'empty-state-icon', text: '📋' },
					{ className: 'empty-state-text', id: 'layerSettingsEmptyText', text: 'No layer selected' },
					{ className: 'empty-state-subtext', id: 'layerSettingsEmptySubtext' }
				]
			},
			groups: [
				{ title: 'Selection', items: [
					{ kind: 'card', title: 'Selection Options', items: [
						{ kind: 'checkboxList', items: [
							{ id: 'contiguous', label: 'Contiguous', title: 'Select only connected pixels of the same color' },
							{ id: 'invert', label: 'Invert', title: "Invert this layer's mask — glitter covers everything except the selected and painted areas" },
							{ id: 'multiSelect', label: 'Multi-Select', title: 'Select multiple colors on the same layer' }
						] }
					] },
					{ kind: 'card', title: 'Color Selections', classes: 'color-selection', items: [
						{ kind: 'content', items: [
							{ kind: 'host', id: 'selectedColorsEmpty', tag: 'span', classes: 'empty-state visible', text: 'None' },
							{ kind: 'host', id: 'selectedColorsDisplay', classes: 'selected-colors-display' }
						] }
					] },
					{ kind: 'card', title: 'Refine Selection', items: [
						{ kind: 'twoColumn', items: [
							{ kind: 'slider', id: 'threshold', slider: 'threshold' },
							{ kind: 'slider', id: 'feather', slider: 'feather' }
						] }
					] }
				] }
			]
		}]
	},
	[LayerType.STICKER]: {
		prefix: 'sticker',
		sectionPrefix: 'stickerSettings',
		mobileKey: 'sticker',
		section: { id: 'stickerSettingsSection', icon: 'sliders', iconName: 'Sliders', title: 'Sticker Properties' },
		controls: { id: 'stickerSettingsControls', emptyId: 'stickerSettingsEmpty', emptyText: 'Select a sticker to edit its properties.' },
			groups: [
				{ title: 'Content', items: [
					{ kind: 'card', title: 'Asset', items: [
						{ kind: 'assetInfo', info: 'stickerAssetInfo', thumbnail: 'stickerAssetThumbnail',
							name: 'stickerAssetName', badges: 'stickerAssetBadges', change: 'stickerAssetChange',
							size: 'stickerAssetSize', frames: 'stickerAssetFrames', title: 'Choose another sticker' },
						{ kind: 'colorAdjust' }
					] }
				] },
			{ title: 'Appearance', adoptTransformOpacity: true, items: [] },
			{ title: 'Transform', items: [
				{ kind: 'transformHost' }
			] }
		],
		effects: [
			{ kind: 'paintSlot', slot: 'shadow', idPrefix: 'stickerShadow', title: 'Shadow',
				texturePosition: true,
				toggle: true, sourceLabel: 'Source', modes: ['glitter', 'solid'], activeMode: 'glitter',
				color: '#000000', chipTitle: 'Choose glitter',
				pre: [{ kind: 'twoColumn', items: [
					{ kind: 'slider', id: 'stickerShadowOffsetX', slider: 'shadowOffsetX' },
					{ kind: 'slider', id: 'stickerShadowOffsetY', slider: 'shadowOffsetY' }
				] }]
			},
			{ kind: 'actionRow', classes: 'layer-effects-actions', actions: [
				{ id: 'resetStickerEffects', label: 'Reset Effects', secondary: true, title: 'Disable all sticker effects and clear their saved settings' }
			] }
		]
	},
	[LayerType.TEXT_GLITTER]: {
		prefix: 'text',
		sectionPrefix: 'textSettings',
		mobileKey: 'text',
		sourceTemplate: 'tpl-text-content',
		section: { id: 'textSettingsSection', icon: 'text', iconName: 'Text', title: 'Text Properties' },
		groups: [
			{ title: 'Content', items: [
				{ kind: 'templateCard', template: 'tpl-text-content', selector: '#textLayerInput' },
				{ kind: 'templateCard', template: 'tpl-text-content', selector: '#textBoxModeHint' },
				{ kind: 'templateCard', template: 'tpl-text-content', selector: '#textFontPicker' },
				{ kind: 'templateCard', template: 'tpl-text-content', selector: '.text-style-group' },
				{ kind: 'templateCard', template: 'tpl-text-content', selector: '.text-case-group-wrap' },
				{ kind: 'templateCard', template: 'tpl-text-content', selector: '#textFontSize' },
				{ kind: 'templateCard', template: 'tpl-text-content', selector: '.text-align-group' },
				{ kind: 'templateCard', template: 'tpl-text-content', selector: '#textFitBoxToContent' }
			] },
			{ title: 'Appearance', adoptTransformOpacity: true, items: [
				{ kind: 'paintSlot', slot: 'fill', idPrefix: 'textFill', title: 'Fill',
					texturePosition: true,
					modes: ['none', 'glitter', 'solid'], activeMode: 'glitter', color: '#000000',
					chipTitle: 'Choose fill glitter',
					primaryIds: { scale: 'textTextureScale', scaleRow: 'textTextureScaleRow', opacity: 'textTextureOpacity' }
				}
			] },
			{ title: 'Transform', items: [{ kind: 'transformHost' }] }
		],
		effects: [
			{ kind: 'paintSlot', slot: 'border', idPrefix: 'textBorder', title: 'Border',
				texturePosition: true,
				toggle: true, sourceLabel: 'Source', modes: ['glitter', 'solid'], activeMode: 'glitter',
				color: '#000000', chipTitle: 'Choose border source',
				primaryIds: { scale: 'textBorderScale', scaleRow: 'textBorderScaleRow', opacity: 'textBorderOpacity' },
				pre: [{ kind: 'slider', id: 'textBorderWidth', slider: 'textBorderWidth' }],
				post: [{ kind: 'stackRow', groups: [
					{ label: 'Edges', options: [
						{ id: 'textBorderEdgeRounded', label: 'Rounded', active: true, value: 'round' },
						{ id: 'textBorderEdgeHard', label: 'Hard', value: 'hard' }
					] },
					{ label: 'Placement', options: [
						{ id: 'textBorderPositionOutside', label: 'Outside', active: true, value: 'outside' },
						{ id: 'textBorderPositionCenter', label: 'On Edge', value: 'center' },
						{ id: 'textBorderPositionInside', label: 'Inside', value: 'inside' }
					] },
					{ label: 'Layering', options: [
						{ id: 'textBorderOrderBehind', label: 'Behind', active: true, value: 'behind' },
						{ id: 'textBorderOrderFront', label: 'On Top', value: 'front' }
					] }
				] }]
			},
			{ kind: 'paintSlot', slot: 'shadow', idPrefix: 'textShadow', title: 'Shadow',
				texturePosition: true,
				toggle: true, sourceLabel: 'Source', modes: ['glitter', 'solid'], activeMode: 'glitter',
				color: '#000000', chipTitle: 'Choose shadow source',
				primaryIds: { scale: 'textShadowScale', scaleRow: 'textShadowScaleRow', opacity: 'textShadowOpacity' },
				pre: [{ kind: 'twoColumn', items: [
					{ kind: 'slider', id: 'textShadowOffsetX', slider: 'shadowOffsetX' },
					{ kind: 'slider', id: 'textShadowOffsetY', slider: 'shadowOffsetY' }
				] }]
			},
			{ kind: 'actionRow', classes: 'layer-effects-actions', actions: [
				{ id: 'resetTextEffects', label: 'Reset Effects', secondary: true, title: 'Disable all text effects and clear their saved settings' }
			] }
		]
	},
	[LayerType.SHAPE]: {
		prefix: 'shape',
		sectionPrefix: 'shapeSettings',
		mobileKey: 'shape',
		section: { id: 'shapeSettingsSection', icon: 'square', iconName: 'Shape', title: 'Shape Properties' },
		groups: [
			{ title: 'Content', items: [
				{ kind: 'card', title: 'Asset', items: [
					{ kind: 'assetInfo', info: 'shapeAssetInfo', thumbnail: 'shapeAssetThumbnail',
						name: 'shapeAssetName', badges: 'shapeAssetBadges', change: 'shapeAssetChange',
						title: 'Choose another shape', compact: true }
				] }
			] },
			// The shared transform panel emits its own Opacity card into the host;
			// this group adopts it after renderTransformPanels runs
			// (finalizePanelSchemaSections), mirroring the old shape branch of
			// the pre-schema panel order.
			{ title: 'Appearance', adoptTransformOpacity: true, items: [
				{ kind: 'paintSlot', slot: 'fill', idPrefix: 'shapeFill', title: 'Fill',
					texturePosition: true,
					modes: ['none', 'glitter', 'solid'], activeMode: 'solid',
					color: '#ff66cc', chipTitle: 'Choose fill glitter' }
			] },
			{ title: 'Transform', items: [{ kind: 'transformHost' }] }
		],
		effects: [
			{ kind: 'paintSlot', slot: 'border', idPrefix: 'shapeBorder', title: 'Border',
				texturePosition: true,
				toggle: true, sourceLabel: 'Source',
				modes: ['glitter', 'solid'], activeMode: 'glitter',
				color: '#000000', chipTitle: 'Choose glitter',
				pre: [
					{ kind: 'slider', id: 'shapeBorderWidth', slider: 'borderWidth' },
					{ kind: 'optionGroup', label: 'Style', glitterSource: true, options: [
						{ id: 'shapeBorderStyleSolid', label: 'Solid Border', active: true, value: 'solid' },
						{ id: 'shapeBorderStyleDotted', label: 'Dotted Border', value: 'dotted' }
					] },
					{ kind: 'slider', id: 'shapeBorderDotSpacing', slider: 'borderDotSpacing', rowId: 'shapeBorderDotSpacingRow', hidden: true }
				],
				post: [
					{ kind: 'stackRow', groups: [
						{ label: 'Edges', options: [
							{ id: 'shapeBorderEdgeRounded', label: 'Rounded', active: true, value: 'round' },
							{ id: 'shapeBorderEdgeHard', label: 'Hard', value: 'hard' }
						] },
						{ label: 'Placement', options: [
							{ id: 'shapeBorderPositionOutside', label: 'Outside', active: true, value: 'outside' },
							{ id: 'shapeBorderPositionCenter', label: 'On Edge', value: 'center' },
							{ id: 'shapeBorderPositionInside', label: 'Inside', value: 'inside' }
						] },
						{ label: 'Layering', options: [
							{ id: 'shapeBorderOrderBehind', label: 'Behind', active: true, value: 'behind' },
							{ id: 'shapeBorderOrderFront', label: 'On Top', value: 'front' }
						] }
					] }
				]
			},
			{ kind: 'paintSlot', slot: 'shadow', idPrefix: 'shapeShadow', title: 'Shadow',
				texturePosition: true,
				toggle: true, sourceLabel: 'Source',
				modes: ['glitter', 'solid'], activeMode: 'glitter',
				color: '#000000', chipTitle: 'Choose glitter',
				pre: [
					{ kind: 'twoColumn', items: [
						{ kind: 'slider', id: 'shapeShadowOffsetX', slider: 'shadowOffsetX' },
						{ kind: 'slider', id: 'shapeShadowOffsetY', slider: 'shadowOffsetY' }
					] }
				]
			},
			{ kind: 'actionRow', classes: 'layer-effects-actions', actions: [
				{ id: 'resetShapeEffects', label: 'Reset Effects', secondary: true, title: 'Disable all shape effects and clear their saved settings' }
			] }
		]
	}
};

// Derived, single-source-of-truth lookups over LAYER_UI_CONFIG. Adding a new
// LayerType that needs a DOM overlay element, transform handles, or a creation
// factory means filling in the relevant fields above ONCE - these replace what
// would otherwise be hand-maintained, easy-to-forget-one-type selector/dispatch
// lists duplicated across LayerManager/LayerTransform/GestureManager/app.js.
function isTransformableLayerType(type) {
	return Boolean(LAYER_UI_CONFIG[type]?.transformable);
}

// CSS selector matching layer overlay elements. Pass a layerId to scope to one
// layer's element (any type); omit it to match every layer element of the
// matching kind (e.g. rebuilding DOM order). transformableOnly excludes types
// that don't participate in the pointer-transform system (e.g. glitter fill).
function getLayerElementSelector(layerId = null, { transformableOnly = false } = {}) {
	return Object.values(LayerType)
		.map((type) => LAYER_UI_CONFIG[type])
		.filter((cfg) => cfg?.elementClass && (!transformableOnly || cfg.transformable))
		.map((cfg) => `.${cfg.elementClass}${layerId != null ? `[data-layer-id="${layerId}"]` : ''}`)
		.join(', ');
}

function getLayerManagerForType(editor, type) {
	const key = LAYER_UI_CONFIG[type]?.managerKey;
	return key ? editor[key] : null;
}

function getAddableLayerTypes() {
	return Object.values(LayerType).filter((type) => Boolean(LAYER_UI_CONFIG[type]?.addableViaModal));
}

const LAYER_BADGES = [
	{
		id: 'paint',
		icon: 'brush',
		getState(layer) {
			return layer?.type === LayerType.GLITTER_FILL && layer.maskHasContent
				? { title: 'Painted mask strokes' }
				: null;
		}
	},
	{
		id: 'missing-asset',
		icon: 'circle-info',
		getState(layer) {
			const missing = layer?._missingAssets;
			return missing?.length ? { title: `Missing asset: ${missing.join(', ')}` } : null;
		}
	},
	{
		id: 'effects',
		icon: 'filter',
		getState(layer) {
			const active = [];
			if (layerHasBorderEffect(layer)) active.push('border');
			if (layerHasShadowEffect(layer)) active.push('shadow');
			if (layerHasActiveColorAdjust(layer)) active.push('color adjust');
			return active.length ? { title: `Effects: ${active.join(', ')}` } : null;
		}
	}
];

// Precomputed once at load (LAYER_UI_CONFIG is static): the common "every
// layer element" and "every transformable layer element" selectors.
const ALL_LAYER_ELEMENT_SELECTOR = getLayerElementSelector();
const TRANSFORMABLE_LAYER_ELEMENT_SELECTOR = getLayerElementSelector(null, { transformableOnly: true });

const ASSET_TYPE_CONFIG = {
	glitter: {
		prefix: 'glitterAsset',
		managerKey: 'glitterManager',
		renderThumbnail: (thumbnail, asset) => {
			thumbnail.className = 'asset-info-thumbnail glitter-bg';
			thumbnail.style.backgroundImage = `url(${asset.url})`;
			thumbnail.innerHTML = '';
		},
		getExtraBadges: (asset) => {
			return [];
		}
	},
	sticker: {
		prefix: 'stickerAsset',
		managerKey: 'stickerManager',
		renderThumbnail: (thumbnail, asset) => {
			thumbnail.className = asset.isPixelated === false
				? 'asset-info-thumbnail'
				: 'asset-info-thumbnail pixelated';
			thumbnail.style.backgroundImage = '';
			// Sticker names are user-supplied (uploads) - set as properties so a
			// quote or angle bracket in the name can't break out of the markup.
			thumbnail.replaceChildren();
			const img = document.createElement('img');
			img.src = asset.thumbnailUrl || asset.url;
			img.alt = asset.name;
			thumbnail.appendChild(img);
		},
		getExtraBadges: (asset) => {
			const badges = [];

			if (asset.stickerText) {
				badges.push({
					class: 'badge-text',
					text: `Text: "${asset.stickerText}"`
				});
			}

			return badges;
		}
	}
};

const DEBUG_CONFIG = {
	enabled: false,

	canvas: {
		width: 800,
		height: 800,
		color: '#ffffff'
	},

	stickers: [
		{ id: 1, x: 200, y: 200 },
		{ id: 2, x: 400, y: 400 },
		{ id: 3, x: 600, y: 600 }
	]
};

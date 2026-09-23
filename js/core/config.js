// Frozen app tunables (CONFIG), tool ids and groups, text background presets,
// asset-type and debug settings. Release history is js/core/releases.js,
// layer types js/core/layer-types.js, sidebar structure js/ui/panel-schemas.js.
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.values(value).forEach((entry) => deepFreeze(entry));
	return Object.freeze(value);
}

const EXPORT_FIDELITY_STOPS = [
	{ label: 'Exactly as previewed', visualError: 0, maxSamplingFps: 30 },
	{ label: 'High detail', visualError: 0.004, maxSamplingFps: 30 },
	{ label: 'Balanced', visualError: 0.008, maxSamplingFps: 24 },
	{ label: 'Small file', visualError: 0.02, maxSamplingFps: 15 },
	{ label: 'Smallest file', visualError: 0.04, maxSamplingFps: 12 }
];

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
			// Most undo steps kept; CONFIG.memory can trim below this by bytes.
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
			maxFileSizeMB: 10
		},
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
		defaultBlendMode: 'normal',
		// Whole-layer opacity: FIELDS.layerOpacity.
		blendModes: [
			'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
			'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
			'exclusion', 'hue', 'saturation', 'color', 'luminosity'
		],
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
			defaults: { colorLayers: 5, paletteStyle: 'natural', tuneGlitterHue: true, cleanEdges: true, detail: 4 },
			previewToolAccess: { groups: ['navigation', 'selection'], tools: [] },
			limits: { minColorLayers: 2, maxColorLayers: 20, maxSamples: 24000 },
			timing: { reduceThrottleMs: 80 },
			analysis: { iterations: 12, alphaThreshold: 1, candidateCount: 24, gradientWeight: 18, seedChromaWeight: 12, seedMaxColorBoost: 3.5, hueMinChroma: 0.04, maxHueShift: 20, neutralMatchSaturation: 0, componentDensityBase: 0.55, componentDensityScale: 0.45, highlightLightness: 0.84, highlightImportanceBoost: 1.2, highlightMergeScale: 0.55, swatchPrimaryWeight: 0.75, swatchMinCoverage: 0.08, swatchCoverageBias: 1.5 },
			cleanup: {
				aliasDissolve: { enabled: true, maxMixtureDistance: 0.12, minBoundaryShare: 0.55, maxShare: 0.25 },
				despeckle: { enabled: true, absMin: 4, shareMin: 0.00004 }
			},
			paletteStyles: {
				vibrant: { mergeDistinctness: 0.045, matchedSaturation: 125, neutralSimilarityScale: 2.333333, neutralChromaThreshold: 0.075, chromaWeight: 12, maxColorBoost: 3.5, neutralImportance: 0.62, coherenceBase: 0.4, coherenceScale: 0.75, connectedAreaWeight: 4, maxConnectedBoost: 1, connectedNeutralProtection: 0.65, fragmentedSimilarityBoost: 0.6 },
				balanced: { mergeDistinctness: 0.045, matchedSaturation: 110, neutralSimilarityScale: 1.444444, neutralChromaThreshold: 0.06, chromaWeight: 8, maxColorBoost: 2, neutralImportance: 0.82, coherenceBase: 0.5, coherenceScale: 0.65, connectedAreaWeight: 3, maxConnectedBoost: 0.75, connectedNeutralProtection: 0.75, fragmentedSimilarityBoost: 0.35 },
				natural: { mergeDistinctness: 0.035, matchedSaturation: 100, neutralSimilarityScale: 1.285714, neutralChromaThreshold: 0.05, chromaWeight: 4, maxColorBoost: 1, neutralImportance: 1, coherenceBase: 0.65, coherenceScale: 0.5, connectedAreaWeight: 2, maxConnectedBoost: 0.5, connectedNeutralProtection: 0.9, fragmentedSimilarityBoost: 0.15 }
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
		filter: {
			defaultType: 'basic',
			types: {
				instagram: { presetId: 'rio', showName: false, strength: 100 },
				basic: { brightness: 0, contrast: 0, saturation: 0, hue: 0 },
				invert: { amount: 100 },
				grayscale: { amount: 100 },
				sepia: { amount: 100 },
				tint: { presetId: 'warming-85', color: '#ec8a00', mode: 'soft-light', amount: 40 },
				vignette: { amount: 45, midpoint: 55, roundness: 0, feather: 60, color: '#000000' },
				grain: { amount: 25, size: 25, roughness: 50, monochrome: true, mode: 'soft-light' },
				blur: { radius: 1 }
			},
			tintPresets: {
				'warming-85': { label: 'Warming Filter (85)', color: '#ec8a00' },
				'warming-81': { label: 'Warming Filter (81)', color: '#efb45a' },
				'cooling-80': { label: 'Cooling Filter (80)', color: '#006dff' },
				'cooling-82': { label: 'Cooling Filter (82)', color: '#00b5ff' },
				sepia: { label: 'Sepia', color: '#ac7a33' },
				deepBlue: { label: 'Deep Blue', color: '#1c3f95' },
				deepEmerald: { label: 'Deep Emerald', color: '#009e6c' },
				custom: { label: 'Custom', color: null }
			},
			nameCaption: {
				fontPx: 28,
				minFontPx: 16,
				fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
				color: '#ffffff',
				shadow: { color: 'rgba(0,0,0,0.5)', offsetX: 0, offsetY: 1, blur: 2 },
				position: 'center',
				maxWidthFraction: 0.6,
				stampField: 'name'
			},
			grainTilePx: 256
		},
		selection: {
			// Threshold and feather defaults and ranges: FIELDS.threshold / FIELDS.feather.
			transparency: {
				alphaThreshold: 254,
				allowTransparentSelection: true
			},
			timing: {
				sliderDebounceMs: 150
			}
		},
		maskBrush: {
			// Size, softness, flow, spacing and smoothing defaults and ranges live
			// in FIELDS (maskBrush*). Brush tip shape: one of the ids in
			// MaskEditor.BRUSH_SHAPES (round, square, calligraphy, star, heart). Only
			// affects painting; the stamped result is baked into the mask, so export
			// needs no shape info.
			defaultShape: 'round',
			// Per-mode overrides (WP1): Brush and Eraser keep independent setting
			// sets (MaskEditor.toolSettings). Only the keys listed here differ from
			// the shared FIELDS defaults; everything else is inherited. Eraser starts
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
				// region removed SO FAR this stroke in this color, so "what you're
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
				manifest: 'data/brushes.json?v=3'
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
				// Fill/border/shadow default glitter ids are keyed per layer type so a
				// fresh glitter-fill layer, text layer, shape, and canvas background
				// each start on a visibly distinct glitter instead of all matching —
				// retuning one type's default doesn't touch the others. backgroundGlitterId
				// (text's background-effect fill) stays flat since only text has that slot.
				fillGlitterId: {
					glitterLayer: 111,
					text: 17,
					shape: 67,
					canvasBackground: 101
				},
				backgroundGlitterId: 96,
				borderGlitterId: {
					text: 9,
					shape: 68
				},
				shadowGlitterId: {
					text: 109,
					shape: 34,
					sticker: 83
				},
				fillColor: '#ff66cc',
				borderColor: '#000000',
				shadowColor: '#000000'
			},
			ui: {
				settingsOpenByDefault: false
			},
			preview: {
				selectedOutlineOffset: 2,
				selectedOutlineWidth: 2
			}
		},
		animation: {
			defaultType: 'pulse',
			presets: {
				breath: { periodMs: 4000, easing: 'easeInOut', amount: 6, direction: 'alternate', iterations: Infinity, anchor: 'center' },
				float: { periodMs: 3600, easing: 'linear', amount: 14, angle: 270, direction: 'normal', iterations: Infinity },
				sway: { periodMs: 2600, easing: 'linear', amount: 8, direction: 'normal', iterations: Infinity, anchor: 'top-center' },
				dim: { periodMs: 2000, easing: 'easeInOut', opacityFloor: 40, direction: 'alternate', iterations: Infinity },
				drift: { periodMs: 6000, easing: 'linear', distance: 120, angle: 0, direction: 'normal', iterations: Infinity },
				twinkle: { periodMs: 1400, easing: 'linear', duty: 60, opacityFloor: 20, direction: 'normal', iterations: Infinity },
				pulse: { periodMs: 1400, easing: 'easeInOut', amount: 10, direction: 'alternate', iterations: Infinity, anchor: 'center' },
				heartbeat: { periodMs: 1200, easing: 'easeOut', amount: 12, direction: 'normal', iterations: Infinity, anchor: 'center' },
				blink: { periodMs: 900, easing: 'steps', steps: 2, duty: 50, direction: 'normal', iterations: Infinity, fillMode: 'none', anchor: 'center' },
				bounce: { periodMs: 1000, easing: 'bounceOut', amount: 40, angle: 90, direction: 'normal', iterations: Infinity, anchor: 'bottom-center' },
				shake: { periodMs: 600, easing: 'linear', amount: 8, direction: 'normal', iterations: Infinity },
				tremble: { periodMs: 120, easing: 'linear', amount: 2, direction: 'normal', iterations: Infinity },
				wobble: { periodMs: 1000, easing: 'easeInOut', amount: 12, direction: 'normal', iterations: Infinity, anchor: 'center' },
				jello: { periodMs: 1000, easing: 'easeOut', amount: 12, direction: 'normal', iterations: Infinity, anchor: 'center' },
				tada: { periodMs: 1000, easing: 'easeInOut', amount: 10, direction: 'normal', iterations: Infinity, anchor: 'center' },
				swing: { periodMs: 1000, easing: 'easeOut', amount: 15, direction: 'normal', iterations: Infinity, anchor: 'top-center' },
				'rubber-band': { periodMs: 1000, easing: 'easeOut', amount: 25, direction: 'normal', iterations: Infinity, anchor: 'center' },
				move: { periodMs: 2000, easing: 'easeInOut', distance: 60, angle: 0, direction: 'alternate', iterations: Infinity },
				orbit: { periodMs: 3000, easing: 'linear', radius: 40, direction: 'normal', iterations: Infinity },
				rotate: { periodMs: 3000, easing: 'linear', turns: 1, direction: 'normal', iterations: Infinity, anchor: 'center' },
				flip: { periodMs: 2400, easing: 'easeInOut', turns: 1, direction: 'normal', iterations: Infinity, anchor: 'center' },
				zoom: { periodMs: 8000, easing: 'easeOut', amount: 15, direction: 'alternate', iterations: Infinity, anchor: 'center' },
				ping: { periodMs: 1600, easing: 'easeOut', radius: 40, opacityFloor: 0, direction: 'normal', iterations: Infinity, anchor: 'center' },
				marquee: { periodMs: 4000, easing: 'linear', distance: 600, angle: 180, direction: 'normal', iterations: Infinity, anchor: 'center', includeWhenOffCanvas: true },
				rainbow: { periodMs: 3000, easing: 'linear', direction: 'normal', iterations: Infinity }
			},
			jitterQuantMs: 60,
			maxPeriodMs: 20000,
			exportFps: 12
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
					flipX: false,
					flipY: false
				}
			},
			rotationSnapTolerance: 5,
			transform: {
				roundValues: true
			}
		},
		text: {
			defaultTextCase: 'none',
			// Stage Two in-canvas typing is intentionally paused; this is its future gate.
			canvasEditing: false,
			fontsManifest: 'data/fonts.json?v=5',
			defaultFontId: 'luckiest-guy',
			defaultFontWeight: 400,
			defaultFontStyle: 'normal',
			defaultText: 'glitter',
			defaultBoxMode: 'auto',
			defaultVerticalAlign: 'top',
			minBoxSize: 4,
			maxTextLength: 200,
			// Font size, letter spacing, line height and the border width and
			// shadow offset defaults are field specs (js/core/fields.js).
			border: {
				defaultPlacement: 'outside',
				defaultDrawOrder: 'behind',
				defaultSource: 'glitter',
				defaultEdgeStyle: 'round'
			}
		},
		shapes: {
			manifest: 'data/shapes.json?v=2',
			defaultShapeId: 'circle',   // one of ShapeLibrary.FILL_SHAPES ids
			defaultSize: 160,           // intrinsic px for a click (no-drag) create
			minSize: 8,
			imageFill: {
				// Scale and position defaults are field specs (shapeImageScale,
				// shapeImageOffsetX/Y in js/core/fields.js).
				defaultFit: 'cover',
				defaultTile: false,
				defaultRendering: 'smooth',
				maxUploadSize: 10 * 1024 * 1024,
				fitOptions: [
					{ value: 'cover', label: 'Cover' },
					{ value: 'contain', label: 'Contain' },
					{ value: 'fill', label: 'Fill' },
					{ value: 'none', label: 'None' },
					{ value: 'scale-down', label: 'Scale Down' }
				],
				// UI-only: "Tile" is sugar over fit:'none' + tile:true (the only
				// combination where tiling is visually distinct — see
				// docs/ANIMATED-IMAGE-FILL-PLAN.md Part A). Not a real fit value.
				fitUIOptions: [
					{ value: 'cover', label: 'Cover' },
					{ value: 'contain', label: 'Contain' },
					{ value: 'fill', label: 'Fill' },
					{ value: 'none', label: 'None' },
					{ value: 'tile', label: 'Tile' },
					{ value: 'scale-down', label: 'Scale Down' }
				]
			},
			// Width and dot spacing ranges and defaults are field specs
			// (borderWidth, borderDotSpacing in js/core/fields.js).
			border: {
				defaultStyle: 'solid',
				defaultPlacement: 'outside',
				defaultDrawOrder: 'behind',
				defaultSource: 'glitter',
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
			// Default subdivision count for the 'smooth' blend approximation; each
			// gradient carries its own value (editable via the Smoothing slider,
			// FIELDS.gradientSmoothing, shown in the gradient editor's
			// Advanced disclosure only when Blend = Smooth).
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
			levels: [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16],
			pixelGridMinZoom: 6,
			pixelGridEnabled: true,
			pixelGridColor: 'rgba(128, 128, 128, 0.55)'
		},
		gradientEditor: {
			keyboardStep: 0.01,
			snapStep: 0.05,
			magneticOffsets: [0, 0.25, 0.5, 0.75, 1],
			magneticThresholdPx: 5
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
				{ kind: 'button', id: 'fitScreen', icon: 'fit-screen', name: 'Fit Screen', title: 'Fit Screen (Ctrl+0)', action: 'zoomFit' },
				{ kind: 'button', id: 'fillScreen', icon: 'maximize', name: 'Fill Screen', title: 'Fill Screen', action: 'zoomFill' }
			] },
			{ id: 'panControls', tool: 'hand', controls: [
				{ kind: 'button', id: 'centerCanvasHorizontal', icon: 'align-center-x', name: 'Center H', title: 'Center Horizontally', action: 'centerCanvasH' },
				{ kind: 'button', id: 'centerCanvasVertical', icon: 'align-center-y', name: 'Center V', title: 'Center Vertically', action: 'centerCanvasV' }
			] },
			{
				id: 'layerCenterControls',
				tool: 'select',
				allowMultiSelection: true,
				controls: [
					{ kind: 'toggle', id: 'contextAutoSelect', label: 'Auto-Select' },
					{ kind: 'button', id: 'centerLayerHorizontal', icon: 'align-center-x', name: 'Center H', title: 'Center Horizontally', action: 'centerSelectionH' },
					{ kind: 'button', id: 'centerLayerVertical', icon: 'align-center-y', name: 'Center V', title: 'Center Vertically', action: 'centerSelectionV' },
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
				{ kind: 'slider', id: 'maskBrushSizeQuick', valueId: 'maskBrushSizeQuickValue', slider: 'maskBrushSize' }
			] }
		],
		// Valid values for the Settings > Theme select; each needs a matching
		// :root[data-theme="…"] token block in css/_themes.scss.
		themes: ['dark', 'llama', 'cyber-chrome', 'light', 'bubblegum', 'bliss', 'dew', 'aqua', 'p2p', 'homepage', 'buddy-list'],
		stickerHandles: {
			enabled: true,
			// Handle geometry, in screen pixels. Colors and line widths are CSS
			// tokens (--handle-*, --selection-*).
			outwardOffset: 4,
			rotationHandleDistance: 30,
			// Invisible hit squares around each handle (selection-chrome.js).
			// Coarse pointers get at least the 44px touch-target minimum.
			handleHitSize: { corner: 32, edge: 36, rotation: 40 },
			handleHitSizeCoarse: { corner: 44, edge: 44, rotation: 48 },
			// Screen pixels a pointer must travel before a handle drag starts, so a
			// click never nudges, scales or rotates a layer.
			dragThresholdPx: 3,
			// Screen pixels added around a layer's frame when hit-testing clicks,
			// so thin layers (a 1px line, a small text) stay clickable.
			frameHitTolerance: 4,
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
		authoredFrames: {
			checkpointInterval: 12
		},
		core: {
			// Base name for user-facing downloads; the project title overrides this.
			defaultBaseName: 'ryandavi-com_glitter',
			// Capped at 4 on desktop/unknown, but never oversubscribes a low-core
			// phone - more GIF-encoding workers than cores adds context-switch
			// overhead instead of speed.
			workers: Math.max(1, Math.min(4, navigator.hardwareConcurrency || 4)),
			workerScript: 'js/workers/gif.worker.js',
			quality: 1,
			timing: {
				forceDelay: 100,
				maxFrames: 60
			}
		},
		progress: {
			yieldEveryFrames: 2,
			slowPhaseNoticeMs: 2000,
			timerRefreshMs: 500
		},
		timeline: {
			maxSamplingFps: 30,
			proceduralPeriodTolerance: 0.10,
			preRenderBudgetMultiplier: 1.5,
			preferredFrameBudget: 60,
			// Frame-count floor derived from the resolved loop length, so a long
			// loop (e.g. an 8s zoom) doesn't get merged down to the same fixed
			// frame count as a short one and end up choppy.
			minFrameRateFps: 24,
			hardFrameLimit: 1000,
			exactDuplicateThreshold: 0,
			balancedVisualError: 0.008,
			smallFileVisualError: 0.02,
			maxLoopDurationMs: 12000,
			// The composite render clock owns displayed time once any procedural
			// (continuously evaluated) source is present: source boundaries stop
			// being automatic output timestamps, so continuous motion is sampled
			// on a deliberate, format-representable cadence instead of the union
			// of unrelated source events.
			renderClock: {
				// gif.js encodes delays as Math.round(ms / 10) centiseconds, so a
				// planned delay is only honoured unchanged on that grid. Viewers
				// clamp anything under 2 cs, which is the floor here.
				gifDelayQuantumMs: 10,
				gifMinimumDelayMs: 20,
				gifMaximumDelayMs: 200,
				mp4OutputFpsStops: [12, 15, 20, 24, 25, 30, 50, 60],
				// Cadence shortfalls within this relative band count as equal, so
				// delay regularity — not a hair's difference in average rate —
				// decides between otherwise comparable clocks.
				cadenceShortfallTolerance: 0.05,
				loopCandidateShortlist: 4
			},
			fidelityStops: EXPORT_FIDELITY_STOPS,
			defaultPreset: 'balanced',
			presets: {
				highFidelity: EXPORT_FIDELITY_STOPS[1],
				balanced: EXPORT_FIDELITY_STOPS[2],
				smallFile: EXPORT_FIDELITY_STOPS[3]
			}
		},
		defaults: {
			outputMode: 'animation',
			stillFormat: 'png',
			animationFormat: 'gif',
			stillFrame: 'first',
			jpegQuality: 90,
			jpegGenerations: 1,
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
			exportFidelity: 2,
			// 'auto' follows the chosen Export fidelity stop.
			maxSamplingFps: 'auto',
			visualErrorThreshold: 'auto',
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
			maxEncodeQueueSize: 8,
			muxChunkSize: 1024 * 1024
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
				{ label: 'Rybaby Signature', url: 'images/watermark/2.png' },
				{ label: 'Made with Rybaby', url: 'images/watermark/1.gif' }
			],
			position: 'bottom-right',
			paddingX: 5,
			paddingY: 5,
			opacity: 100,
			scale: 100
		}
	},

	// Byte budgets (getMemoryBudget in js/systems/MemoryLedger.js). iOS Safari
	// and low-memory devices kill the tab far below desktop limits, so they get
	// the constrained set.
	memory: {
		budgets: {
			standard: { historyMB: 192, paintHistoryMB: 128, previewCacheMB: 96, exportMB: 2048 },
			constrained: { historyMB: 64, paintHistoryMB: 48, previewCacheMB: 32, exportMB: 512 }
		},
		// Undo keeps at least this many steps whatever their size.
		minHistorySteps: 5,
		// A GIF export holds every composed frame (RGBA) plus its indexed copy.
		gifBytesPerPixel: 5
	},

	debug: {
		forceIOSExportPreview: false,
		enabled: false
	},
});

// Text Background presets (DYNAMIC-TEXT-BACKGROUND-IMPLEMENTATION-PLAN.md,
// "Presets"): the one table both the UI select and
// TextGlitterManager.applyTextBackgroundPreset read from. A preset writes
// plain values into textData.textBackground and is not itself persisted —
// selecting one is indistinguishable from a user manually matching the same
// values. `fill`/`enabled` are deliberately untouched by every preset.
const TEXT_BACKGROUND_PRESETS = {
	// The default look: its geometry is the text background field defaults.
	instagram: {
		mode: 'lines', lineConnection: 'merge-adjacent',
		horizontalPadding: FIELDS.textBackgroundPaddingH.value, verticalPadding: FIELDS.textBackgroundPaddingV.value,
		cornerRadius: FIELDS.textBackgroundRadius.value, mergeDistance: FIELDS.textBackgroundMergeDistance.value,
		lineSpacingSensitivity: FIELDS.textBackgroundSpacing.value
	},
	tight: { mode: 'lines', lineConnection: 'merge-adjacent', horizontalPadding: 8, verticalPadding: 4, cornerRadius: 4, mergeDistance: 6, lineSpacingSensitivity: 20 },
	separateLines: { mode: 'lines', lineConnection: 'separate', horizontalPadding: 12, verticalPadding: 6, cornerRadius: 8 },
	connectedBlock: { mode: 'lines', lineConnection: 'connected', horizontalPadding: 20, verticalPadding: 10, cornerRadius: 20, mergeDistance: 60, lineSpacingSensitivity: 90 },
	textBounds: { mode: 'text-bounds', horizontalPadding: 16, verticalPadding: 8, cornerRadius: 8 },
	textBox: { mode: 'text-box', horizontalPadding: 0, verticalPadding: 0, cornerRadius: 8 },
	labelPill: { mode: 'text-bounds', horizontalPadding: 28, verticalPadding: 6, cornerRadius: 100 }
};
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

const CONFIG = {
	project: {
		extension: 'glitter.json',
		fileNameSuffix: '_ryandavi-com'
	},
	app: {
		siteName: 'ryandavi.com glitter editor',
		currentRelease: '2026-07-01',
		releases: [
			{
				id: '2026-07-01',
				version: '0.2.0',
				name: 'Creative Tools Update',
				date: '2026-07-01',
				dateLabel: 'July 1, 2026',
				summary: 'Expanded the editor beyond color-selected glitter fills with painted masks and editable generated layers.',
				features: [
					'Added the Mask Brush for painting and erasing glitter masks.',
					'Added editable Text layers with typography, layout, fill, border, and shadow controls.',
					'Added editable Shape layers with glitter, solid, and gradient effects.'
				]
			},
			{
				id: '2026-01-01',
				version: '0.1.0',
				name: 'Alpha Release',
				date: '2026-01-01',
				dateLabel: 'January 1, 2026',
				summary: 'The first public release of the layer-based glitter graphics editor.',
				features: [
					'Added Glitter Fill layers for applying animated fills to selected image colors.',
					'Added Sticker layers and the archived sticker browser.',
					'Added image loading, layer transforms, animation preview, and animated GIF export.'
				]
			}
		],
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
				stampSpacing: 0.25
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
				stripeOpacityBoost: 0.15
			},
			cursor: {
				stroke: '#ffffff'
			},
			livePreview: {
				throttle: 'raf'
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
			fontsManifest: 'data/fonts.json?v=3',
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
		crispMaskEdges: true,
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
		independentCollapsibleSections: ['imagePanel', 'layersPanel'],
		zoom: {
			levels: [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16]
		},
		gestures: {
			tapMaxMs: 300,
			tapSlopPx: 10,
			secondFingerGraceMs: 150,
			doubleTapMs: 300,
			doubleTapSlopPx: 30,
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
			{ id: 'colorPickerControls', tool: 'colorPicker', layerTypes: ['glitter-fill'], requiresSelections: true, controls: [
				{ kind: 'slider', id: 'contextThreshold', valueId: 'contextThresholdValue', slider: 'threshold' },
				{ kind: 'group', controls: [
					{ kind: 'toggle', id: 'contextMultiSelect', label: 'Multi', countId: 'contextSelectionCount' },
					{ kind: 'toggle', id: 'contextContiguous', label: 'Contiguous' }
				] }
			] },
			{ id: 'maskBrushControls', tool: 'brush', controls: [
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
			maskBrushSize: { label: 'Size', unit: 'px', min: 1, max: 300, value: 40 },
			maskBrushSoftness: { label: 'Softness', unit: '%', min: 0, max: 100, value: 0 },
			maskBrushFlow: { label: 'Flow', unit: '%', min: 1, max: 100, value: 100 },
			maskBrushSpacing: { label: 'Spacing', unit: '%', min: 1, max: 200, value: 25 },
			maskBrushSmoothing: { label: 'Smoothing', unit: '%', min: 0, max: 100, value: 0 },
			textureScale: { label: 'Texture Scale', unit: '%', min: 25, max: 300, value: 100 },
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
		themes: ['dark', 'llama', 'light', 'bubblegum', 'bliss', 'dew'],
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
		shortcuts: {
			tools: [
				{ key: 'V', action: 'Select Tool' },
				{ key: 'T', action: 'Text Tool' },
				{ key: 'U', action: 'Shape Tool' },
				{ key: 'I', action: 'Color Fill Tool' },
				{ key: 'B', action: 'Mask Brush Tool' },
				{ key: 'E', action: 'Mask Eraser Tool' },
				{ key: 'H', action: 'Hand Tool' },
				{ key: 'Hold Space', action: 'Temporarily Use Hand Tool' },
				{ key: 'Z', action: 'Zoom Tool' },
				{ key: 'Arrow Keys', action: 'Nudge Selected Layer' },
				{ key: 'Shift + Arrow Keys', action: 'Nudge Selected Layer 10px' },
				{ key: 'Shift + Click Canvas', action: 'Add/Remove Movable Layer from Selection' },
				{ key: 'Shift + Click Layer', action: 'Select Layer Range in Layers Panel' },
				{ key: 'Ctrl/Cmd + Click Layer', action: 'Add/Remove One Layer in Layers Panel' },
				{ key: 'Alt + Click', action: 'Cycle Through Overlapping Layers' },
				{ key: 'Alt + Drag', action: 'Duplicate Layer(s) While Dragging' },
				{ key: 'Ctrl + D', action: 'Duplicate Selected Layer(s)' },
				{ key: 'Drag on Empty Canvas', action: 'Select Multiple Layers' },
				{ key: 'Ctrl + A', action: 'Select All Movable Layers' },
				{ key: 'Escape', action: 'Cancel Active Transform / Clear Multi-Selection' },
				{ key: 'Shift + Drag', action: 'Axis-lock Selected Layer Move' },
				{ key: 'Hold Ctrl', action: 'Temporarily Disable Snapping While Dragging' },
				{ key: 'Shift + Rotate', action: 'Snap Rotation to 15deg' },
				{ key: 'Alt + Resize', action: 'Resize Layer(s) from Center' }
			],
			brush: [
				{ key: 'X', action: 'Swap Paint/Erase (Mask Brush)' },
				{ key: '[ / ]', action: 'Decrease/Increase Brush Size' },
				{ key: 'Shift + [ / ]', action: 'Adjust Brush Size Faster' },
				{ key: 'Shift + Drag', action: 'Constrain the stroke to a straight line (0/45/90 deg)' },
			],
			view: [
				{ key: 'Alt + Click', action: 'Zoom Out (Zoom Tool)' },
				{ key: 'Scroll Wheel', action: 'Zoom In/Out (Zoom Tool)' },
				{ key: 'Ctrl + Wheel', action: 'Trackpad Zoom' },
				{ key: 'Ctrl + 0', action: 'Fit Screen' },
				{ key: 'Ctrl + 1', action: 'Reset Zoom (100%)' },
				{ key: 'Double-click Zoom %', action: 'Reset Zoom (100%)' },
				{ key: 'Ctrl + +/-', action: 'Zoom In/Out' }
			],
			history: [
				{ key: 'Ctrl + Z', action: 'Undo' },
				{ key: 'Ctrl + Shift + Z', action: 'Redo' },
				{ key: 'Ctrl + Y', action: 'Redo' },
			],
			file: [
				{ key: 'Ctrl + S', action: 'Save Project' }
			]
		}
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
			ditherEnabled: true,
			ditherType: 'FloydSteinberg',
			frameDelay: 110,
			maxFrames: 60,
			frameSkip: 1,
			reverse: false,
			smartFrameReduction: true,
			optimizationPreset: 'balanced',
			maxSamplingFps: 24,
			watermarkEnabled: false
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
			codecs: ['avc1.42001f', 'avc1.4d001f', 'avc1.64001f'],
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
};

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
		designPanelSections: ['welcomeSection'],
		mobileSettingsSections: [],
		panelMode: 'welcome'
	},
	NO_LAYER: {
		designPanelSections: ['noLayerSettingsSection'],
		mobileSettingsSections: [],
		panelMode: 'no-layer'
	},

	[LayerType.BASE_IMAGE]: {
		displayName: 'Base Image',
		goTo: null,
		designPanelSections: ['glitterSearchSection', 'glitterOptions', 'baseLayerSettingsSection'],
		mobileSettingsSections: ['background'],
		panelMode: 'base-layer',
		onActivate: (editor, layer) => {
			editor.baseBackgroundManager?.loadLayerSettings(layer);
		}
	},

	[LayerType.GLITTER_FILL]: {
		displayName: 'Glitter Fill',
		addedStatusMessage: 'New glitter fill layer added',
		goTo: 'glitter',
		addableViaModal: {
			label: 'Glitter Fill',
			icon: 'glitter',
			description: 'Apply glitter fill to base image'
		},
		designPanelSections: ['glitterSearchSection', 'glitterOptions', 'glitterSettingsSection', 'layerSettingsSection'],
		mobileSettingsSections: ['tool', 'glitter'],
		panelMode: 'glitter',
		elementClass: 'glitter-element',
		managerKey: 'glitterManager',
		autoOpenDesignDrawerOnCreate: true,
		onActivate: (editor, layer) => {
			if (!layer.locked && !hasMaskContent(layer) && layer.selectedGlitterId && editor.currentTool !== ToolType.BRUSH) {
				editor.setTool(ToolType.COLOR_PICKER);
			}
			editor.updateGlitterSelection();
			editor.hideLayerSettingsEmptyState();
			editor.hideGlitterSettingsEmptyState();
			editor.loadActiveLayerSettings();
		}
	},

	[LayerType.STICKER]: {
		displayName: 'Sticker',
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
				editor.hideStickerSettingsEmptyState();
				editor.loadStickerSettings(layer);
			} else {
				if (stickerContent) stickerContent.classList.remove('visible');
				editor.showStickerSettingsEmptyState();
			}

			editor.updateStickerSelection();
		}
	},

	[LayerType.TEXT_GLITTER]: {
		displayName: 'Text',
		addedStatusMessage: 'New text layer added',
		goTo: 'glitter',
		addableViaModal: {
			label: 'Text',
			icon: 'text',
			description: 'Mask glitter inside editable text'
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
		addedStatusMessage: 'New shape layer added',
		goTo: 'glitter',
		addableViaModal: {
			label: 'Shape',
			icon: 'square',
			description: 'Fill a shape with glitter or color'
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

// Declarative sidebar panel structure consumed by js/ui/panel-renderer.js
// (docs/SIDEBAR-TEMPLATE-PLAN.md). Structure, ordering, and capabilities
// only — markup lives in the index.html tpl-* <template>s, slider ranges in
// CONFIG.ui.sliders. Stamped element ids preserve the legacy names exactly
// (managers keep binding by id); paintSlot ids derive as idPrefix +
// capitalized role. Panels not listed here are still static index.html
// markup awaiting migration (see the plan's WP order).
const PANEL_SCHEMAS = {
	[LayerType.BASE_IMAGE]: {
		prefix: 'baseBackground',
		sectionPrefix: 'baseLayerSettings',
		mobileKey: 'background',
		replaceStatic: true,
		section: { id: 'baseLayerSettingsSection', icon: 'paint-bucket', iconName: 'Canvas', title: 'Canvas Properties' },
		groups: [
			{ title: 'Appearance', items: [
				{ kind: 'paintSlot', slot: 'background', idPrefix: 'baseBackground', title: 'Background',
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
			] }
		]
	},
	brush: {
		prefix: 'brush',
		sectionPrefix: 'brushSettings',
		mobileKey: 'brush',
		replaceStatic: true,
		section: {
			id: 'brushSettingsSection', icon: 'brush', iconName: 'Brush', title: 'Brush Settings',
			titleIconId: 'brushSettingsTitleIcon', titleTextId: 'brushSettingsTitleText'
		},
		groups: [
			{ title: 'Brush Tip', items: [
				{ kind: 'card', title: 'Shape', items: [
					{ kind: 'host', id: 'brushShapePicker', classes: 'brush-shape-picker', attrs: { role: 'listbox', 'aria-label': 'Brush shape' }, wrapInContent: true }
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
					{ kind: 'checkboxList', label: 'Pen Input', items: [
						{ id: 'maskBrushPressure', label: 'Pressure Sensitivity', title: 'Vary flow with pen pressure (no effect on mouse/touch)', checked: true }
					] }
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
		section: { id: 'glitterSettingsSection', icon: 'glitter', iconName: 'Glitter', title: 'Glitter Properties' },
		controls: { id: 'glitterSettingsControls', emptyId: 'glitterSettingsEmpty', emptyText: 'Select a glitter fill from the gallery to get started.' },
		groups: [
			{ title: 'Appearance', items: [
				{ kind: 'paintSlot', slot: 'fill', idPrefix: 'glitterFill', title: 'Fill',
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
							size: 'stickerAssetSize', frames: 'stickerAssetFrames', title: 'Choose another sticker' }
					] }
				] },
			{ title: 'Appearance', adoptTransformOpacity: true, items: [] },
			{ title: 'Transform', items: [
				{ kind: 'transformHost' }
			] }
		],
		effects: [
			{ kind: 'paintSlot', slot: 'shadow', idPrefix: 'stickerShadow', title: 'Shadow',
				toggle: true, sourceLabel: 'Source', modes: ['glitter', 'solid'], activeMode: 'solid',
				color: '#000000', chipTitle: 'Choose glitter',
				pre: [{ kind: 'twoColumn', items: [
					{ kind: 'slider', id: 'stickerShadowOffsetX', slider: 'shadowOffsetX' },
					{ kind: 'slider', id: 'stickerShadowOffsetY', slider: 'shadowOffsetY' }
				] }]
			}
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
					modes: ['none', 'glitter', 'solid'], activeMode: 'glitter', color: '#000000',
					chipTitle: 'Choose fill glitter',
					primaryIds: { scale: 'textTextureScale', scaleRow: 'textTextureScaleRow', opacity: 'textTextureOpacity' }
				}
			] },
			{ title: 'Transform', items: [{ kind: 'transformHost' }] }
		],
		effects: [
			{ kind: 'paintSlot', slot: 'border', idPrefix: 'textBorder', title: 'Border',
				toggle: true, sourceLabel: 'Source', modes: ['glitter', 'solid'], activeMode: 'solid',
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
				toggle: true, sourceLabel: 'Source', modes: ['glitter', 'solid'], activeMode: 'solid',
				color: '#000000', chipTitle: 'Choose shadow source',
				primaryIds: { scale: 'textShadowScale', scaleRow: 'textShadowScaleRow', opacity: 'textShadowOpacity' },
				pre: [{ kind: 'twoColumn', items: [
					{ kind: 'slider', id: 'textShadowOffsetX', slider: 'shadowOffsetX' },
					{ kind: 'slider', id: 'textShadowOffsetY', slider: 'shadowOffsetY' }
				] }]
			}
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
					modes: ['none', 'glitter', 'solid'], activeMode: 'solid',
					color: '#ff66cc', chipTitle: 'Choose fill glitter' }
			] },
			{ title: 'Transform', items: [{ kind: 'transformHost' }] }
		],
		effects: [
			{ kind: 'paintSlot', slot: 'border', idPrefix: 'shapeBorder', title: 'Border',
				toggle: true, sourceLabel: 'Source',
				modes: ['glitter', 'solid'], activeMode: 'solid',
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
				toggle: true, sourceLabel: 'Source',
				modes: ['glitter', 'solid'], activeMode: 'solid',
				color: '#000000', chipTitle: 'Choose glitter',
				pre: [
					{ kind: 'twoColumn', items: [
						{ kind: 'slider', id: 'shapeShadowOffsetX', slider: 'shadowOffsetX' },
						{ kind: 'slider', id: 'shapeShadowOffsetY', slider: 'shadowOffsetY' }
					] }
				]
			}
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
			thumbnail.className = 'asset-info-thumbnail';
			thumbnail.style.backgroundImage = '';
			thumbnail.innerHTML = `<img src="${asset.thumbnailUrl || asset.url}" alt="${asset.name}">`;
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

// Release history, newest first.
//
// `id` is the permanent identity of a release: it is written to localStorage as
// `glitterEditor_welcomeLastSeenRelease` and compared against `CONFIG.app.currentRelease`
// to decide whether returning visitors see the welcome modal again. Never edit the `id`
// of a release that has shipped — every visitor would be shown the modal a second time.
// Dates may be edited freely because nothing keys off them.
//
// Features are ordered by user impact, regardless of type. Each feature is
// `{ type, text }` where `type` is 'added', 'changed', or 'fixed'.
// `guide` is an optional element id in modals/guide.html; supplying it renders a link
// that opens the guide at that section. `projectFormat` records the ProjectSerializer
// FORMAT_VERSION a release reads and writes, so format changes are traceable from the
// changelog. `unreleased: true` stages an entry without publishing it — it is hidden
// from the version history and skipped when resolving `currentRelease`.
const RELEASES = [
	{
		id: 'v0.5.0',
		version: '0.5.0',
		name: 'Animation, Filters & Export',
		date: '2026-10-01',
		dateLabel: 'October 1, 2026',
		projectFormat: 3,
		summary: 'Added layer animation, filter layers, text backgrounds, still-image export, shape image fills, and more faithful animation output.',
		features: [
			{ type: 'added', text: 'Added Animation to Glitter Fill, Sticker, Text, and Shape layers, with presets for ambient movement, attention effects, motion, and one-time transitions.', guide: 'layer-animation' },
			{ type: 'added', text: 'Added Filter layers that non-destructively process every layer beneath them, with Instagram presets, basic adjustments, tint, vignette, grain, blur, invert, grayscale, and sepia.', guide: 'filters' },
			{ type: 'added', text: 'Added backgrounds to Text layers, with glitter or solid fills, presets, adjustable padding and corners, and layouts for individual lines, text bounds, or the complete text box.', guide: 'text-effects' },
			{ type: 'added', text: 'Added image fills for Shape layers, with fit, scale, alignment, offset, and pixelated or smooth sampling controls.', guide: 'shape-fill' },
			{ type: 'added', text: 'Added still-image export as PNG, JPG, or GIF, with a choice of the first or current animation frame and optional generational JPG recompression.', guide: 'exporting-process' },
			{ type: 'changed', text: 'Rebuilt animation export planning so generated motion and animated assets share a deliberate render clock, close their loops more cleanly, and preserve authored GIF timing.', guide: 'export-settings' },
			{ type: 'added', text: 'Added layer blend modes including Multiply, Screen, Overlay, Difference, Hue, Color, and Luminosity.', guide: 'working-with-layers' },
			{ type: 'added', text: 'Added a Crop to Artwork canvas sizing mode that trims or extends the canvas to match the artwork, with adjustable padding.', guide: 'canvas-view-options' },
			{ type: 'changed', text: 'Expanded export results and animation analysis with clearer timing, frame reduction, optimization, and output details.', guide: 'export-settings' },
			{ type: 'changed', text: 'Improved GIF color selection for better gradients and overall palette quality.', guide: 'export-settings' },
			{ type: 'fixed', text: 'Fixed transparency edges and color sampling accuracy in GIF exports.', guide: 'export-settings' },
			{ type: 'added', text: 'Added source and license attribution for brushes, fonts, and stickers in their asset details.' },
			{ type: 'added', text: 'Added Twitter\'s 2016  sticker collection.', guide: 'add-stickers' },
			{ type: 'changed', text: 'Improved sticker sharpness by automatically using higher-resolution source art when a sticker is scaled up.', guide: 'add-stickers' },
			{ type: 'changed', text: 'Expanded the site history into a searchable timeline and moved it into its own History section.' },
			{ type: 'added', text: 'Added a Preservation section describing how stickers, glitters, and site history are kept available long-term.' },
			{ type: 'changed', text: 'Gave each layer type its own default glitter, so a new Fill Layer, Text, Shape, and Background no longer all start on the same one.' },
			{ type: 'fixed', text: 'Fixed still-image exports on iOS showing sharing instructions meant for animated exports.', guide: 'exporting-process' }
		]
	},
	{
		id: 'v0.4.0',
		version: '0.4.0',
		name: 'Brushes & Properties',
		date: '2026-09-01',
		dateLabel: 'September 1, 2026',
		projectFormat: 2,
		summary: 'Added imported brush tips with scatter and jitter, rebuilt the settings sidebar, and expanded export dithering and navigation.',
		features: [
			{ type: 'changed', text: 'Redesigned every Properties and tool panel with consistent sections, compact controls, collapsible asset and effect cards, clearer empty states, and inline reverts for changed settings.', guide: 'basics' },
			{ type: 'added', text: 'Added imported tips from archived Photoshop brush packs, with a searchable, categorized gallery for choosing them.', guide: 'mask-brush' },
			{ type: 'added', text: 'Added Scatter & Jitter controls for each brush, including scatter distance, dabs per stamp, size and angle jitter, and roundness and flip for imported tips.', guide: 'mask-brush' },
			{ type: 'changed', text: 'Combined the Brush and Eraser into one Mask Brush with separate Paint and Erase settings. Erase strokes now tint the area removed so far.', guide: 'mask-brush' },
			{ type: 'added', text: 'Added GIF Look presets and detailed dithering controls for palette size, pattern, strength, scale, edge protection, and stable or shimmering motion, with a live preview.', guide: 'export-settings' },
			{ type: 'fixed', text: 'Fixed color shifts in fixed-palette GIF exports by sharing one palette across the animation.', guide: 'export-settings' },
			{ type: 'added', text: 'Added trackpad pinch-zoom and two-finger panning, scrubby zoom with the Zoom tool, Space-drag and middle-button panning, and Zoom to Selection. Commands & Shortcuts now includes a Canvas Gestures reference.', guide: 'canvas-view-options' },
			{ type: 'added', text: 'Expanded the gradient editor with stop snapping, reversing, duplication, keyboard controls, and adjustable smooth blending.', guide: 'shape-fill' },
			{ type: 'added', text: 'Added opacity controls for multi-selected layers, including support for mixed opacity values.', guide: 'selection-alignment' },
			{ type: 'changed', text: 'Made Layer Opacity work consistently across every layer type, fading the complete layer while keeping fill, border, and shadow opacity independent.', guide: 'working-with-layers' },
			{ type: 'changed', text: 'Expanded Mask Brush sizes to 1,000 px and made the size slider easier to control across its full range. Imported tips now remember their own size and spacing, with edge antialiasing available directly in Mask Settings.', guide: 'mask-brush' },
			{ type: 'added', text: 'Added resizable Layers and Design sidebars that snap to useful widths and remember what you set.', guide: 'app-settings' },
			{ type: 'added', text: 'Added an optional watermark on exports, with a choice of marks.', guide: 'export-settings' },
			{ type: 'changed', text: 'Made the context toolbar draggable, so you can move it out of the way and it stays where you put it.', guide: 'basics' },
			{ type: 'changed', text: 'Improved pixel art handling, so pixelated stickers stay crisp on the canvas and in every export instead of being smoothed.', guide: 'add-stickers' },
			{ type: 'changed', text: 'Improved touch handling with palm rejection, so a resting hand no longer joins a pinch gesture.', guide: 'mobile' },
			{ type: 'added', text: 'Added adjustable corner rounding to Square shapes.', guide: 'shape-fill' },
			{ type: 'changed', text: 'Improved gallery and modal search, keeping group headings and pinned rows visible while filtering.', guide: 'add-stickers' },
			{ type: 'changed', text: 'Improved the Layers panel with clearer reorder handles and better keyboard access.', guide: 'working-with-layers' },
			{ type: 'changed', text: 'Renamed Glitter Fill layers to Fill Layers, since they can also use solid and gradient fills.', guide: 'create-glitter' },
			{ type: 'changed', text: 'Renamed the color selection sliders to Color Tolerance and Edge Feather, so their names say what they do.', guide: 'select-colors' },
			{ type: 'changed', text: 'Regrouped export settings into Output, Playback, Quality, and Optimization.', guide: 'export-settings' },
			{ type: 'fixed', text: 'Fixed a new sticker picking up the color adjustments left over from the previously selected one.', guide: 'add-stickers' }
		]
	},
	{
		id: 'v0.3.0',
		version: '0.3.0',
		name: 'Projects, Export & Effects',
		date: '2026-08-01',
		dateLabel: 'August 1, 2026',
		projectFormat: 1,
		/* image: {
			src: 'images/etc/preview-image.gif',
			alt: 'Animated glitter graphic made in the editor'
		}, */
		summary: 'Added saveable projects, video export, generated glitter, and canvas-wide effects.',
		features: [
			{ type: 'added', text: 'Added saveable .glitter.json projects that keep layers, masks, and custom stickers editable when reopened.', guide: 'export' },
			{ type: 'added', text: 'Added MP4 export alongside animated GIF.', guide: 'exporting-process' },
			{ type: 'added', text: 'Added Auto Glitter, which reads an image and builds glitter layers from it. The results stay editable, and you can reopen a batch to adjust it.', guide: 'auto-glitter' },
			{ type: 'added', text: 'Added canvas-wide pixel effects, including pixelation, posterization, dithering, and animated shimmer.', guide: 'canvas-effects' },
			{ type: 'added', text: 'Added a Base Background layer that fills the canvas behind everything with an image, glitter, gradient, solid color, or transparency.', guide: 'working-with-layers' },
			{ type: 'added', text: 'Added gradient sources across fills, borders, shadows, and canvas backgrounds, with multiple stops and adjustable angle.', guide: 'shape-fill' },
			{ type: 'added', text: 'Added editable shadows to Sticker layers, with independent source, offset, scale, opacity, and color adjustments.', guide: 'add-stickers' },
			{ type: 'added', text: 'Added multi-select with shared transforms, alignment, and distribution for arranging several layers together.', guide: 'selection-alignment' },
			{ type: 'changed', text: 'Rebuilt layer transforms with steadier scaling, smart guides, snapping to the canvas and other layers, and consistent behavior across layer types.', guide: 'working-with-layers' },
			{ type: 'added', text: 'Added document scaling, so you can resize the whole composition and everything on it at once.', guide: 'canvas-view-options' },
			{ type: 'added', text: 'Added copy and paste for selected layers, along with support for pasting images from the clipboard.', guide: 'selection-alignment' },
			{ type: 'changed', text: 'Reorganized the settings sidebar around the selected layer, with a context toolbar for the active tool.', guide: 'basics' },
			{ type: 'added', text: 'Added the Shape gallery for browsing and placing preset shapes.', guide: 'create-shape' },
			{ type: 'added', text: 'Added bold and italic styles for Text layers.', guide: 'text-typography' },
			{ type: 'added', text: 'Added a collection of light and dark interface themes.', guide: 'app-settings' },
			{ type: 'added', text: 'Added color adjustment for stickers, letting you recolor artwork to match a palette.', guide: 'add-stickers' },
			{ type: 'added', text: 'Added search and filtering across the sticker, glitter, and shape galleries, with faster on-demand loading.', guide: 'add-stickers' },
			{ type: 'added', text: 'Added an Antialias Edges setting for smoother text, shape, and mask edges.', guide: 'editing-settings' },
			{ type: 'added', text: 'Added optimization details to the export preview, showing frame reduction and loop closure.', guide: 'export-settings' },
			{ type: 'changed', text: 'Improved mobile gestures, drawers, and layer reordering.', guide: 'mobile' },
			{ type: 'fixed', text: 'Fixed animated stickers flickering in the preview.' }
		]
	},
	{
		id: 'v0.2.0',
		version: '0.2.0',
		name: 'Text, Shapes & Masks',
		date: '2026-07-01',
		dateLabel: 'July 1, 2026',
		summary: 'Expanded the editor beyond color-selected glitter fills with painted masks, text, and shapes.',
		features: [
			{ type: 'added', text: 'Added brush and eraser tools for editing Glitter Fill masks by hand, with adjustable size, spacing, and smoothing.', guide: 'mask-brush' },
			{ type: 'added', text: 'Added editable Text layers with typography, layout, fill, border, and shadow controls.', guide: 'text' },
			{ type: 'added', text: 'Added editable Shape layers with fill, border, and shadow controls.', guide: 'shapes' },
			{ type: 'added', text: 'Added point and area text, so a text layer can grow with its content or wrap inside a fixed box.', guide: 'create-text' },
			{ type: 'added', text: 'Added a library of self-hosted display fonts for Text layers.', guide: 'text-typography' },
			{ type: 'added', text: 'Added canvas size controls for changing the document dimensions after you start.', guide: 'canvas-view-options' },
			{ type: 'added', text: 'Added a gallery picker for choosing a glitter, replacing the small swatch list.', guide: 'select-colors' },
			{ type: 'changed', text: 'Unified mouse and touch input, so pointer behavior is the same on desktop and mobile.', guide: 'mobile' },
			{ type: 'added', text: 'Added confirmation prompts before actions that discard work.' },
			{ type: 'changed', text: 'Renamed the Color Picker tool to Color Fill to match what it does.', guide: 'tools' }
		]
	},
	{
		id: 'v0.1.1',
		version: '0.1.1',
		name: 'Touch & Detail',
		date: '2026-02-01',
		dateLabel: 'February 1, 2026',
		summary: 'Added mobile editing, blank canvases, and in-app guidance, then refined touch controls and asset details.',
		features: [
			{ type: 'added', text: 'Added a mobile layout with drawer panels and touch controls.', guide: 'mobile' },
			{ type: 'changed', text: 'Rewrote touch handling so tapping, dragging, pinch-zoom, and transforms behave predictably on phones and tablets.', guide: 'mobile' },
			{ type: 'added', text: 'Added blank canvas creation and preset base images for starting without an upload.', guide: 'getting-started' },
			{ type: 'added', text: 'Added the built-in guide and contextual hints based on the active tool and selected layer.', guide: 'getting-started' },
			{ type: 'added', text: 'Added custom sticker uploads for bringing in your own artwork.', guide: 'add-stickers' },
			{ type: 'added', text: 'Added transform handles for scaling and rotating stickers directly on the canvas.', guide: 'working-with-layers' },
			{ type: 'added', text: 'Added asset details for stickers and glitters, including original source, dimensions, and frame rate.', guide: 'add-stickers' },
			{ type: 'added', text: 'Added a welcome screen introducing the editor to first-time visitors.' },
			{ type: 'changed', text: 'Replaced the main settings inputs with sliders for quicker adjustment.' }
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
			{ type: 'added', text: 'Added layer management with move, scale, rotate, duplicate, reorder, and visibility.', guide: 'working-with-layers' },
			{ type: 'added', text: 'Added animated GIF export with transparency options, size warnings, and automatic frame reduction.', guide: 'export-settings' }
		]
	}
];

const PUBLISHED_RELEASES = RELEASES.filter((release) => !release.unreleased);

// Release history, newest first.
//
// `id` is the permanent identity of a release: it is written to localStorage as
// `PREFERENCES.welcomeLastSeenRelease` and compared against `CONFIG.app.currentRelease`
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
// `lastCommit` is the last commit a release contains, so the next release is
// `git log <lastCommit>..HEAD` whatever branches the work passed through. Dates
// are nominal (the first of a month) and never mark that boundary. Set it when
// a release ships; an unreleased entry has none.
const RELEASES = [
	{
		id: 'v0.6.0',
		version: '0.6.0',
		name: 'Paths, Crop & Library',
		date: '2026-11-01',
		dateLabel: 'November 1, 2026',
		projectFormat: 6,
		summary: 'Added path drawing, area selections, canvas cropping and text editing, expanded animation timing and playback, introduced SVG import and export, and rebuilt the workspace around one Library window.',
		features: [
			{ type: 'added', text: 'Added the Pen and Line tools and Path layers: draw straight or curved paths, lines, and arrows, edit their points, and give each a glitter or color stroke, fill, and outline.', guide: 'paths' },
			{ type: 'added', text: 'Added the Select Area tool: draw rectangles, ellipses, freehand or polygon lassos, pick colors with the Magic Wand, select layer pixels, preview Expand/Contract/Border/Smooth, undo and reselect areas, and turn them into Path layers. Fill, Erase, Crop, Brush and Glitter Fill all use the area.', guide: 'select-area-tool' },
			{ type: 'added', text: 'Added the Crop tool with canvas handles, aspect ratios, extension fill, keyboard and touch controls, and one-step undo. Fit the canvas to artwork, its motion, selected layers, a selected area, trimmed transparent edges, or hidden artwork.', guide: 'crop-tool' },
			{ type: 'added', text: 'Added SVG import as editable Path layers, with supported outlines grouped by paint. Files using unsupported features open as images, with the reason shown in the status line.', guide: 'uploading-images' },

			{ type: 'added', text: 'Added Animation loop controls for an automatic or custom document length, a table of animation sources, Fit animations to loop, Restore previous timing, and Set loop to include content. Saved timing can be restored after reopening a project.', guide: 'animated-filters' },
			{ type: 'added', text: 'Added Scene preview with Play/Pause, a scene-time slider, frame stepping, and a return to the loop start. Pausing holds the current time, and playback controls work with the timeline closed and on phones.', guide: 'layer-animation' },
			{ type: 'changed', text: 'Expanded motion timing with start times, cycle lengths, finite repeat counts, Trim end, and Stretch duration. Changing presets keeps the timing, and travel motions also show their speed in pixels per second.', guide: 'layer-animation' },
			{ type: 'added', text: 'Added Appears and Disappears times to show a layer for only part of the animation, including layers without motion.', guide: 'layer-animation' },
			{ type: 'added', text: 'Added GIF Cycle controls for animated stickers, frame images, and the Base Image, so their animation can play faster, slower, or fit the document loop.', guide: 'layer-animation' },
			{ type: 'added', text: 'Added Start at for animated stickers, frame images, the Base Image, and glitter textures, and Randomize GIF starts for a selection, so copies of one GIF no longer blink in lockstep.', guide: 'layer-animation' },
			{ type: 'added', text: 'Animated GIFs opened as the Base Image now play on the canvas and in exports, with a Play animation switch in Canvas Properties. Auto Glitter is unavailable while they play.', guide: 'getting-started' },
			{ type: 'changed', text: 'Marquee now fits the canvas and loops seamlessly, with a choice of no repeat, an edge wrap, or a tiled row with an adjustable gap. Added looping Ricochet and Wander for layers and Sparkles.', guide: 'layer-animation' },
			{ type: 'added', text: 'Added animated Scanlines crawl and a Hue Cycle filter that rotates the colors of the artwork beneath it, with matching playback and export.', guide: 'animated-filters' },
			{ type: 'added', text: 'Added the Timeline on desktop, with draggable timing bars, snapping, zoom, output-frame markers, and export-frame playback. Open it from the Timeline button in the top bar or the View menu. Select several bars to move, align, stagger, fit, reset, or paste timing together in one undo step.', guide: 'layer-animation' },
			{ type: 'added', text: 'Added Stagger animations for a multi-selection: each layer\'s motion starts one step after the last, in reading order, so split letters wave, bounce, or pop in one by one.', guide: 'layer-animation' },
			{ type: 'added', text: 'Added Custom motion with editable keys and easing, conversion from supported presets, and desktop canvas controls for posing position, rotation, and scale keys.', guide: 'layer-animation' },

			{ type: 'added', text: 'Added canvas text editing and drag-to-create text boxes, with Point, Auto Height, and Fixed sizing, overflow feedback, and Fit box to text.', guide: 'text-typography' },
			{ type: 'added', text: 'Expanded text formatting with color emoji, justified alignment, underline, strikethrough, symbols, alternating caps, plain-text paste, and splitting text into characters, words, or lines.', guide: 'text-typography' },
			{ type: 'added', text: 'Added l33t, ｆｕｌｌｗｉｄｔｈ, and ᴛɪɴʏ ᴄᴀᴘꜱ text styles, a Wrap menu for decorations like xX_name_Xx and ~*~name~*~, and a Kaomoji tab beside the symbols.', guide: 'text-typography' },
			{ type: 'added', text: 'Added stacked text orientation, with stacked looks and paper and stone textures in the WordArt style gallery.', guide: 'text-typography' },
			{ type: 'added', text: 'Added two-color Pattern paints for fills, outlines, shadows, text backgrounds, and the canvas background, with presets, transparent backgrounds, motif shapes, tile layouts, spacing, offsets, and looping scroll.', guide: 'pattern-paint' },
			{ type: 'added', text: 'Added editable Subtitle, Caption Bar, and Date Stamp templates, plus a Demotivational Poster canvas template.', guide: 'pattern-paint' },
			{ type: 'added', text: 'Added clipping to show artwork only inside the layer below, following its opacity and animation.', guide: 'working-with-layers' },
			{ type: 'added', text: 'Filter layers can now be unlocked, moved, and resized to apply a look to a rectangular region instead of the whole canvas.', guide: 'filters' },
			{ type: 'added', text: 'Added stretchable stickers and frames, which protect their corners and edges as they resize, with Smart Stretch and adjustable Border Scale for frame images.', guide: 'stretchable-assets' },
			{ type: 'added', text: 'Added Remove background for uploaded stickers, turning a PNG or JPG into a cutout, and a glitter recolor tool with a side-by-side comparison of the original and recolored glitter.', guide: 'manage-stickers' },

			{ type: 'added', text: 'Added SVG export for paths, shapes, text, painted fills, style frames, and non-image backgrounds, keeping gradients, patterns, strokes, arrowheads, outlines, shadows, and bevels. Text can be outlined or editable; glitter becomes a solid color, and the dialog reports omitted content.', guide: 'exporting-process' },
			{ type: 'added', text: 'Added Export Size and File Size Limit to Export Settings, plus a Fit button in the result to export again under a service\'s upload limit. Presets include Mastodon and emoji, sticker, and icon sizes; fitting leaves the saved Export Settings unchanged.', guide: 'export-settings' },
			{ type: 'changed', text: 'Improved animated export to preserve GIF and glitter frame changes at their authored times and protect distinct source frames when reducing the output.', guide: 'export-settings' },
			{ type: 'changed', text: 'Expanded animation analysis and frame options to explain source timing, loop fitting, and ways to export fewer frames. Export now reports its progress step by step, and long-running work shows an activity indicator on the canvas.', guide: 'export-settings' },

			{ type: 'changed', text: 'Rebuilt the workspace around one Library window for glitters, stickers, shapes, fonts, and brushes, with a right column that shows only the properties of the selected layer or active tool.', guide: 'library' },
			{ type: 'changed', text: 'Reorganized the glitter and sticker libraries by style and set, with adjustable tile sizes, quick picks, broader search, and clearer source and creator details. Added new fonts, glitters, and sparkle sets.', guide: 'library' },
			{ type: 'changed', text: 'Redesigned the phone layout around a chip bar for the selected layer\'s properties.', guide: 'mobile' },
			{ type: 'changed', text: 'Redesigned New Canvas, Settings, Export Settings, and Commands & Shortcuts as titled cards, with resets for a single setting, a group, or everything.', guide: 'app-settings' },
			{ type: 'added', text: 'Added automatic recovery of unsaved work: if the page closes or crashes, the start screen offers to resume your last graphic.', guide: 'getting-started' },
			{ type: 'added', text: 'Added Take Photo to the start screen and the menu: start a graphic from a camera photo, with mirroring, a camera choice, and a countdown.', guide: 'getting-started' },
			{ type: 'added', text: 'Added one-click canvas presets to the start screen, recent custom sizes in New Canvas, and template previews that open at their own size.', guide: 'getting-started' },
			{ type: 'added', text: 'Added Balance Sidebar Widths to keep the Inspector aligned with the toolbar and Layers panel, and smoother value scrubbing for numeric controls.', guide: 'app-settings' },
			{ type: 'added', text: 'Double-click or double tap a layer to open its source, and see dimensions while drawing a Shape, Text box, or Line.', guide: 'tools' },

			{ type: 'added', text: 'Expanded multi-selection with show/hide, lock/unlock, shared blend modes, matching widths or heights, flipping each layer in place, and copying the active layer\'s appearance to unlocked layers of the same type.', guide: 'selection-alignment' },
			{ type: 'added', text: 'Drag across eye icons in the Layers panel to show or hide several layers in one undo step, including on touch screens.', guide: 'working-with-layers' },
			{ type: 'changed', text: 'Layer locks now block canvas transforms and property changes while leaving the layer selectable.', guide: 'working-with-layers' },
			{ type: 'changed', text: 'Improved startup with deferred Library views and settings, a smaller boot bundle, and on-demand loading for export and background removal.' },
			{ type: 'fixed', text: 'Improved Undo and Redo so text typing stays in its editing session, fill clicks make one step, unfinished drags cancel cleanly, and restoring history keeps the active tool.' },
			{ type: 'fixed', text: 'Fixed text anchoring and box resizing, sticker aspect locking, and sticker outline, shadow, and bevel sizing at different scales.' },
			{ type: 'fixed', text: 'Fixed importing and thumbnailing older library GIFs whose frames extend beyond their declared image size.' },
			{ type: 'fixed', text: 'Fixed the context bar not appearing for the active tool when a document starts.' }
		]
	},
	{
		id: 'v0.5.0',
		version: '0.5.0',
		name: 'Animation, Effects & Export',
		date: '2026-10-01',
		dateLabel: 'October 1, 2026',
		projectFormat: 6,
		lastCommit: 'e6bc6510',
		summary: 'Added layer animation, filter, frame, and Sparkles layers, richer layer styling, still-image export, and more faithful animation output.',
		features: [
			{ type: 'added', text: 'Added stackable Animation to Glitter Fill, Sticker, Text, and Shape layers, with presets for ambient movement, attention effects, motion, rainbow color, and one-time transitions.', guide: 'layer-animation' },
			{ type: 'added', text: 'Added Filter layers that non-destructively process every layer beneath them, with adjustment, Instagram, Web & Film, and Pixel & Damage looks including light leaks, scanlines, dreamy glow, JPEG crunch, RGB split, and gradient maps.', guide: 'filters' },
			{ type: 'changed', text: 'Moved the canvas Pixelate and Palette effects into Pixelate, Posterize, and Dither filter layers, which can now process any layers beneath them. Projects that used them open with an equivalent filter layer above the canvas.', guide: 'pixel-filters' },
			{ type: 'added', text: 'Added Frame layers with classic web borders or ornate frame images, glitter, solid, and gradient paint, and the option to follow the canvas or transform freely.', guide: 'frames' },
			{ type: 'added', text: 'Added animated Sparkles to layers and the canvas, with presets for glints, stars, hearts, snow, edge tracing, and Kira Kira highlights. A standalone Sparkles layer can also place weather and particles over the complete scene.', guide: 'sparkles' },
			{ type: 'added', text: 'Added one-click Style presets for Text, Shape, and Sticker layers, along with Bevel & Gloss effects and glitter or solid Sticker outlines.', guide: 'layer-effects' },
			{ type: 'added', text: 'Added backgrounds to Text layers, with glitter or solid fills, presets, adjustable padding and corners, and layouts for individual lines, text bounds, or the complete text box.', guide: 'text-effects' },
			{ type: 'added', text: 'Added Text warp presets for arcs, arches, circles, bulges, waves, and flags, with adjustable bend.', guide: 'text-typography' },
			{ type: 'added', text: 'Added image fills for Shape layers, with fit, scale, alignment, offset, and pixelated or smooth sampling controls.', guide: 'shape-fill' },
			{ type: 'added', text: 'Added still-image export as PNG, JPG, or GIF, with a choice of the first or current animation frame and optional generational JPG recompression.', guide: 'exporting-process' },
			{ type: 'changed', text: 'Rebuilt animation export planning so generated motion and animated assets share a deliberate render clock, close their loops more cleanly, and preserve authored GIF timing.', guide: 'export-settings' },
			{ type: 'added', text: 'Added layer blend modes including Multiply, Screen, Overlay, Difference, Hue, Color, and Luminosity.', guide: 'working-with-layers' },
			{ type: 'added', text: 'Added a movable anchor point for each layer, controlling the point used for rotation, flipping, scaling, and animation.', guide: 'working-with-layers' },
			{ type: 'added', text: 'Added a Crop to Artwork canvas sizing mode that trims or extends the canvas to match the artwork, with adjustable padding.', guide: 'canvas-view-options' },
			{ type: 'added', text: 'Added ready-made gradient presets and an eyedropper for sampling colors directly from the artwork.', guide: 'shape-fill' },
			{ type: 'changed', text: 'Expanded export results and animation analysis with clearer timing, frame reduction, optimization, and output details.', guide: 'export-settings' },
			{ type: 'changed', text: 'Improved GIF color selection for better gradients and overall palette quality.', guide: 'export-settings' },
			{ type: 'fixed', text: 'Fixed transparency edges and color sampling accuracy in GIF exports.', guide: 'export-settings' },
			{ type: 'added', text: 'Added source and license attribution for brushes, fonts, and stickers in their asset details.' },
			{ type: 'added', text: 'Added Twitter\'s 2016 sticker collection.', guide: 'add-stickers' },
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
			{ type: 'added', text: 'Added canvas-wide pixel effects, including pixelation, posterization, dithering, and animated shimmer.', guide: 'pixel-filters' },
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

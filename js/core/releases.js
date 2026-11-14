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
		lastCommit: '8885ffaf',
		summary: 'Added path drawing, area selections, canvas cropping and text editing, expanded animation timing and playback, introduced SVG import and export, and rebuilt the workspace around one Library window.',
		features: [
			{ type: 'added', name: 'Pen and Line tools', text: 'Draw straight or curved paths, lines, and arrows as Path layers, edit their points, and give each a glitter or color stroke, fill, and outline.', guide: 'paths' },
			{ type: 'added', name: 'Select Area tool', text: 'Draw rectangles, ellipses, and freehand or polygon lassos, pick colors with the Magic Wand, or select a layer\'s pixels. Preview Expand, Contract, Border, and Smooth, undo and reselect areas, and turn an area into a Path layer. Fill, Erase, Crop, Brush, and Glitter Fill all work inside the area.', guide: 'select-area-tool' },
			{ type: 'added', name: 'Crop tool', text: 'Crop with canvas handles, aspect ratios, extension fill, and keyboard or touch controls, undone in one step. Fit the canvas to the artwork, its motion, the selected layers, a selected area, trimmed transparent edges, or hidden artwork.', guide: 'crop-tool' },
			{ type: 'added', name: 'SVG import', text: 'SVG files open as editable Path layers, with outlines grouped by paint. Files that use unsupported features open as images, and the status line says why.', guide: 'uploading-images' },

			{ type: 'added', name: 'Animation loop controls', text: 'Let the document length follow the animation or set your own, see every animation source in a table, and use Fit animations to loop, Restore previous timing, or Set loop to include content. Saved timing can still be restored after you reopen a project.', guide: 'animated-filters' },
			{ type: 'added', name: 'Scene preview', text: 'Play and pause, scrub scene time with a slider, step by frame, and jump back to the loop start. Pausing holds the current time, and the controls work with the timeline closed and on phones.', guide: 'layer-animation' },
			{ type: 'changed', name: 'Motion timing', text: 'Motions now have start times, cycle lengths, finite repeat counts, Trim end, and Stretch duration. Switching presets keeps the timing, and travel motions show their speed in pixels per second.', guide: 'layer-animation' },
			{ type: 'added', name: 'Appears and Disappears', text: 'Show a layer for only part of the animation, even a layer with no motion.', guide: 'layer-animation' },
			{ type: 'added', name: 'GIF Cycle', text: 'Make an animated sticker, frame image, or Base Image play faster or slower, or fit it to the document loop.', guide: 'layer-animation' },
			{ type: 'added', name: 'Start at', text: 'Choose where an animated sticker, frame image, Base Image, or glitter texture starts playing. Randomize GIF starts does it for a whole selection, so copies of one GIF stop blinking in lockstep.', guide: 'layer-animation' },
			{ type: 'added', name: 'Animated Base Images', text: 'An animated GIF opened as the Base Image now plays on the canvas and in exports, with a Play animation switch in Canvas Properties. Auto Glitter is unavailable while it plays.', guide: 'getting-started' },
			{ type: 'changed', name: 'Marquee, Ricochet, and Wander', text: 'Marquee now fits the canvas and loops seamlessly, with no repeat, an edge wrap, or a tiled row with an adjustable gap. Ricochet and Wander are new looping motions for layers and Sparkles.', guide: 'layer-animation' },
			{ type: 'added', name: 'Scanlines crawl and Hue Cycle', text: 'Scanlines can now crawl, and the new Hue Cycle filter rotates the colors of the artwork beneath it. Both play on the canvas and in exports.', guide: 'animated-filters' },
			{ type: 'added', name: 'Timeline', text: 'On desktop, open it from the Timeline button in the top bar or the View menu. Drag timing bars with snapping and zoom, see output-frame markers, and play back export frames. Select several bars to move, align, stagger, fit, reset, or paste their timing in one undo step.', guide: 'layer-animation' },
			{ type: 'added', name: 'Stagger animations', text: 'Each selected layer\'s motion starts one step after the last, in reading order, so split letters wave, bounce, or pop in one by one.', guide: 'layer-animation' },
			{ type: 'added', name: 'Custom motion', text: 'Set keys with easing, convert a supported preset to custom keys, and on desktop pose position, rotation, and scale right on the canvas.', guide: 'layer-animation' },

			{ type: 'added', name: 'Text on the canvas', text: 'Type directly on the canvas or drag to create a text box. Boxes can be Point, Auto Height, or Fixed, show when text overflows, and fit to their text in one click.', guide: 'text-typography' },
			{ type: 'added', name: 'Text formatting', text: 'Color emoji, justified alignment, underline, strikethrough, symbols, alternating caps, plain-text paste, and splitting text into characters, words, or lines.', guide: 'text-typography' },
			{ type: 'added', name: 'Text styles, Wrap, and Kaomoji', text: 'Set text in l33t, ｆｕｌｌｗｉｄｔｈ, or ᴛɪɴʏ ᴄᴀᴘꜱ, wrap it in decorations like xX_name_Xx and ~*~name~*~, and pick kaomoji from a tab beside the symbols.', guide: 'text-typography' },
			{ type: 'added', name: 'Stacked text', text: 'Stack letters vertically. The WordArt style gallery adds stacked looks and paper and stone textures.', guide: 'text-typography' },
			{ type: 'added', name: 'Pattern paints', text: 'Two-color patterns for fills, outlines, shadows, text backgrounds, and the canvas background, with presets, transparent backgrounds, motif shapes, tile layouts, spacing, offsets, and looping scroll.', guide: 'pattern-paint' },
			{ type: 'added', name: 'Caption templates', text: 'Editable Subtitle, Caption Bar, and Date Stamp templates, plus a Demotivational Poster canvas template.', guide: 'pattern-paint' },
			{ type: 'added', name: 'Clipping', text: 'Show a layer only inside the layer below it, following that layer\'s opacity and animation.', guide: 'working-with-layers' },
			{ type: 'added', name: 'Filter regions', text: 'Unlock a Filter layer to move and resize it, so its look applies to a rectangle instead of the whole canvas.', guide: 'filters' },
			{ type: 'added', name: 'Stretchable stickers and frames', text: 'Corners and edges keep their shape as a sticker or frame resizes. Frame images add Smart Stretch and an adjustable Border Scale.', guide: 'stretchable-assets' },
			{ type: 'added', name: 'Remove background and glitter recolor', text: 'Turn an uploaded PNG or JPG sticker into a cutout, and recolor a glitter with the original and the result side by side.', guide: 'manage-stickers' },

			{ type: 'added', name: 'SVG export', text: 'Export paths, shapes, text, painted fills, style frames, and non-image backgrounds, keeping gradients, patterns, strokes, arrowheads, outlines, shadows, and bevels. Text can be outlined or stay editable. Glitter becomes a solid color, and the dialog lists anything left out.', guide: 'exporting-process' },
			{ type: 'added', name: 'Export Size and File Size Limit', text: 'Set them in Export Settings, or press Fit in the result to export again under a site\'s upload limit. Presets include Mastodon and emoji, sticker, and icon sizes. Fitting leaves your saved Export Settings alone.', guide: 'export-settings' },
			{ type: 'changed', name: 'Animated export accuracy', text: 'GIF and glitter frame changes now land at their authored times, and distinct source frames survive when the output is reduced.', guide: 'export-settings' },
			{ type: 'changed', name: 'Export analysis and progress', text: 'Animation analysis explains source timing, loop fitting, and ways to export fewer frames. Export reports its progress step by step, and long work shows an activity indicator on the canvas.', guide: 'export-settings' },

			{ type: 'changed', name: 'Library window', text: 'One Library window now holds glitters, stickers, shapes, fonts, and brushes, and the right column shows only the properties of the selected layer or active tool.', guide: 'library' },
			{ type: 'changed', name: 'Library organization', text: 'Glitters and stickers are sorted by style and set, with adjustable tile sizes, quick picks, broader search, and clearer source and creator details. New fonts, glitters, and sparkle sets too.', guide: 'library' },
			{ type: 'changed', name: 'Phone layout', text: 'Rebuilt around a chip bar for the selected layer\'s properties.', guide: 'mobile' },
			{ type: 'changed', name: 'Settings dialogs', text: 'New Canvas, Settings, Export Settings, and Commands & Shortcuts are now titled cards, with resets for one setting, a group, or everything.', guide: 'app-settings' },
			{ type: 'added', name: 'Session recovery', text: 'If the page closes or crashes, the start screen offers to resume your last graphic.', guide: 'getting-started' },
			{ type: 'added', name: 'Take Photo', text: 'Start a graphic from a camera photo, from the start screen or the menu, with mirroring, a camera choice, and a countdown.', guide: 'getting-started' },
			{ type: 'added', name: 'Canvas presets', text: 'One-click presets on the start screen, recent custom sizes in New Canvas, and template previews that open at their own size.', guide: 'getting-started' },
			{ type: 'added', name: 'Balance Sidebar Widths', text: 'Lines the Inspector up with the toolbar and Layers panel. Numeric controls also scrub more smoothly.', guide: 'app-settings' },
			{ type: 'added', name: 'Double-click to open source', text: 'Double-click or double-tap a layer to open its source. Drawing a Shape, Text box, or Line shows its size as you go.', guide: 'tools' },

			{ type: 'added', name: 'Multi-selection', text: 'Show, hide, lock, and unlock several layers, share blend modes, match widths or heights, flip each layer in place, and copy the active layer\'s look to unlocked layers of the same type.', guide: 'selection-alignment' },
			{ type: 'added', name: 'Eye icon drag', text: 'Drag across the eye icons in the Layers panel to show or hide several layers in one undo step, on touch screens too.', guide: 'working-with-layers' },
			{ type: 'changed', name: 'Layer locks', text: 'A locked layer now blocks canvas transforms and property changes but stays selectable.', guide: 'working-with-layers' },
			{ type: 'changed', name: 'Faster startup', text: 'Library views and settings load later, the boot bundle is smaller, and export and background removal load only when needed.' },
			{ type: 'fixed', name: 'Undo and Redo', text: 'Typing stays in one editing session, a fill click is one step, unfinished drags cancel cleanly, and restoring history keeps the active tool.' },
			{ type: 'fixed', name: 'Text and sticker sizing', text: 'Text anchoring and box resizing, sticker aspect locking, and sticker outline, shadow, and bevel sizes at different scales.' },
			{ type: 'fixed', name: 'Older library GIFs', text: 'GIFs whose frames extend past their declared size now import and get thumbnails correctly.' },
			{ type: 'fixed', name: 'Context bar', text: 'The context bar now appears for the active tool when a document starts.' }
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
			{ type: 'added', name: 'Animation', text: 'Stack animations on Glitter Fill, Sticker, Text, and Shape layers, with presets for ambient movement, attention effects, motion, rainbow color, and one-time transitions.', guide: 'layer-animation' },
			{ type: 'added', name: 'Filter layers', text: 'Process every layer beneath without changing it, with adjustment, Instagram, Web & Film, and Pixel & Damage looks, including light leaks, scanlines, dreamy glow, JPEG crunch, RGB split, and gradient maps.', guide: 'filters' },
			{ type: 'changed', name: 'Pixel filters', text: 'The canvas Pixelate and Palette effects became Pixelate, Posterize, and Dither filter layers, so they can process any layers beneath them. Projects that used them open with a matching filter layer above the canvas.', guide: 'pixel-filters' },
			{ type: 'added', name: 'Frame layers', text: 'Classic web borders or ornate frame images in glitter, solid, or gradient paint, following the canvas or transformed freely.', guide: 'frames' },
			{ type: 'added', name: 'Sparkles', text: 'Animated glints, stars, hearts, snow, edge tracing, and Kira Kira highlights on layers and the canvas. A standalone Sparkles layer can put weather and particles over the whole scene.', guide: 'sparkles' },
			{ type: 'added', name: 'Style presets', text: 'One-click styles for Text, Shape, and Sticker layers, plus Bevel & Gloss and glitter or solid Sticker outlines.', guide: 'layer-effects' },
			{ type: 'added', name: 'Text backgrounds', text: 'Glitter or solid fills behind text, with presets, padding, rounded corners, and layouts for each line, the text bounds, or the whole text box.', guide: 'text-effects' },
			{ type: 'added', name: 'Text warp', text: 'Arc, arch, circle, bulge, wave, and flag presets with adjustable bend.', guide: 'text-typography' },
			{ type: 'added', name: 'Shape image fills', text: 'Fill a shape with an image, with fit, scale, alignment, offset, and pixelated or smooth sampling.', guide: 'shape-fill' },
			{ type: 'added', name: 'Still-image export', text: 'Export a PNG, JPG, or still GIF from the first or current frame, with optional generational JPG recompression.', guide: 'exporting-process' },
			{ type: 'changed', name: 'Animation export planning', text: 'Generated motion and animated assets now share one render clock, so loops close more cleanly and GIF timing stays as authored.', guide: 'export-settings' },
			{ type: 'added', name: 'Blend modes', text: 'Multiply, Screen, Overlay, Difference, Hue, Color, Luminosity, and more for every layer.', guide: 'working-with-layers' },
			{ type: 'added', name: 'Anchor point', text: 'Move the point each layer rotates, flips, scales, and animates around.', guide: 'working-with-layers' },
			{ type: 'added', name: 'Crop to Artwork', text: 'A canvas sizing mode that trims or extends the canvas to fit the artwork, with adjustable padding.', guide: 'canvas-view-options' },
			{ type: 'added', name: 'Gradient presets and eyedropper', text: 'Ready-made gradients, and an eyedropper for sampling colors straight from the artwork.', guide: 'shape-fill' },
			{ type: 'changed', name: 'Export results', text: 'Clearer timing, frame reduction, optimization, and output details in the results and animation analysis.', guide: 'export-settings' },
			{ type: 'changed', name: 'GIF colors', text: 'Better palette choices, especially for gradients.', guide: 'export-settings' },
			{ type: 'fixed', name: 'GIF transparency and color', text: 'Transparent edges and color sampling in GIF exports are now accurate.', guide: 'export-settings' },
			{ type: 'added', name: 'Attribution', text: 'Brush, font, and sticker details now show source and license.' },
			{ type: 'added', name: 'Twitter 2016 stickers', text: 'Twitter\'s 2016 sticker collection joins the Library.', guide: 'add-stickers' },
			{ type: 'changed', name: 'Sticker sharpness', text: 'Scaled-up stickers switch to higher-resolution source art automatically.', guide: 'add-stickers' },
			{ type: 'changed', name: 'History timeline', text: 'The site history is now a searchable timeline in its own History section.' },
			{ type: 'added', name: 'Preservation', text: 'A new section on how stickers, glitters, and site history stay available long-term.' },
			{ type: 'changed', name: 'Default glitters', text: 'Each layer type has its own default glitter, so a new Fill Layer, Text, Shape, and Background no longer all start the same.' },
			{ type: 'fixed', name: 'iOS still exports', text: 'Still-image exports on iOS no longer show sharing instructions meant for animations.', guide: 'exporting-process' }
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
			{ type: 'changed', name: 'Properties panels', text: 'Every Properties and tool panel now has consistent sections, compact controls, collapsible asset and effect cards, clearer empty states, and inline reverts for changed settings.', guide: 'basics' },
			{ type: 'added', name: 'Photoshop brush tips', text: 'Tips imported from archived Photoshop brush packs, in a searchable, categorized gallery.', guide: 'mask-brush' },
			{ type: 'added', name: 'Scatter & Jitter', text: 'Per-brush scatter distance, dabs per stamp, size and angle jitter, plus roundness and flip for imported tips.', guide: 'mask-brush' },
			{ type: 'changed', name: 'Mask Brush', text: 'The Brush and Eraser are now one Mask Brush with separate Paint and Erase settings. Erase strokes tint what has been removed so far.', guide: 'mask-brush' },
			{ type: 'added', name: 'GIF Looks', text: 'Presets and detailed dithering controls for palette size, pattern, strength, scale, edge protection, and stable or shimmering motion, with a live preview.', guide: 'export-settings' },
			{ type: 'fixed', name: 'Fixed-palette GIF colors', text: 'Fixed-palette GIFs share one palette across the animation, so colors no longer shift.', guide: 'export-settings' },
			{ type: 'added', name: 'Canvas navigation', text: 'Trackpad pinch-zoom and two-finger panning, scrubby zoom with the Zoom tool, Space-drag and middle-button panning, and Zoom to Selection. Commands & Shortcuts lists the canvas gestures.', guide: 'canvas-view-options' },
			{ type: 'added', name: 'Gradient editor', text: 'Stop snapping, reversing, duplication, keyboard controls, and adjustable smooth blending.', guide: 'shape-fill' },
			{ type: 'added', name: 'Multi-layer opacity', text: 'Set opacity on several layers at once, including mixed values.', guide: 'selection-alignment' },
			{ type: 'changed', name: 'Layer Opacity', text: 'Works the same on every layer type, fading the whole layer while fill, border, and shadow opacity stay independent.', guide: 'working-with-layers' },
			{ type: 'changed', name: 'Mask Brush sizes', text: 'Brushes go up to 1,000 px, and the size slider is easier to control across its range. Imported tips remember their own size and spacing, and edge antialiasing is right in Mask Settings.', guide: 'mask-brush' },
			{ type: 'added', name: 'Resizable sidebars', text: 'The Layers and Design sidebars snap to useful widths and remember yours.', guide: 'app-settings' },
			{ type: 'added', name: 'Watermark', text: 'An optional mark on exports, from a choice of marks.', guide: 'export-settings' },
			{ type: 'changed', name: 'Draggable context toolbar', text: 'Move it out of the way and it stays put.', guide: 'basics' },
			{ type: 'changed', name: 'Pixel art', text: 'Pixelated stickers stay crisp on the canvas and in every export.', guide: 'add-stickers' },
			{ type: 'changed', name: 'Palm rejection', text: 'A resting hand no longer joins a pinch gesture.', guide: 'mobile' },
			{ type: 'added', name: 'Rounded squares', text: 'Square shapes have adjustable corner rounding.', guide: 'shape-fill' },
			{ type: 'changed', name: 'Search', text: 'Gallery and modal search keep group headings and pinned rows visible while filtering.', guide: 'add-stickers' },
			{ type: 'changed', name: 'Layers panel', text: 'Clearer reorder handles and better keyboard access.', guide: 'working-with-layers' },
			{ type: 'changed', name: 'Fill Layers', text: 'Glitter Fill layers are now Fill Layers, since they can also use solid and gradient fills.', guide: 'create-glitter' },
			{ type: 'changed', name: 'Color Tolerance and Edge Feather', text: 'The color selection sliders now have names that say what they do.', guide: 'select-colors' },
			{ type: 'changed', name: 'Export settings groups', text: 'Export settings are now grouped into Output, Playback, Quality, and Optimization.', guide: 'export-settings' },
			{ type: 'fixed', name: 'Sticker color adjustments', text: 'A new sticker no longer inherits the color adjustments of the previously selected one.', guide: 'add-stickers' }
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
			{ type: 'added', name: 'Projects', text: 'Save .glitter.json projects that keep layers, masks, and custom stickers editable when reopened.', guide: 'export' },
			{ type: 'added', name: 'MP4 export', text: 'Export video alongside animated GIF.', guide: 'exporting-process' },
			{ type: 'added', name: 'Auto Glitter', text: 'Reads an image and builds glitter layers from it. The layers stay editable, and you can reopen a batch to adjust it.', guide: 'auto-glitter' },
			{ type: 'added', name: 'Pixel effects', text: 'Canvas-wide pixelation, posterization, dithering, and animated shimmer.', guide: 'pixel-filters' },
			{ type: 'added', name: 'Base Background', text: 'Fills the canvas behind everything with an image, glitter, gradient, solid color, or transparency.', guide: 'working-with-layers' },
			{ type: 'added', name: 'Gradients', text: 'Multi-stop gradients with adjustable angle for fills, borders, shadows, and canvas backgrounds.', guide: 'shape-fill' },
			{ type: 'added', name: 'Sticker shadows', text: 'Editable shadows with their own source, offset, scale, opacity, and color.', guide: 'add-stickers' },
			{ type: 'added', name: 'Multi-select', text: 'Transform, align, and distribute several layers together.', guide: 'selection-alignment' },
			{ type: 'changed', name: 'Transforms', text: 'Steadier scaling, smart guides, snapping to the canvas and other layers, and the same behavior on every layer type.', guide: 'working-with-layers' },
			{ type: 'added', name: 'Document scaling', text: 'Resize the whole composition and everything on it at once.', guide: 'canvas-view-options' },
			{ type: 'added', name: 'Copy and paste', text: 'Copy and paste selected layers, or paste images from the clipboard.', guide: 'selection-alignment' },
			{ type: 'changed', name: 'Settings sidebar', text: 'Organized around the selected layer, with a context toolbar for the active tool.', guide: 'basics' },
			{ type: 'added', name: 'Shape gallery', text: 'Browse and place preset shapes.', guide: 'create-shape' },
			{ type: 'added', name: 'Bold and italic', text: 'Text layers can be bold and italic.', guide: 'text-typography' },
			{ type: 'added', name: 'Themes', text: 'A collection of light and dark interface themes.', guide: 'app-settings' },
			{ type: 'added', name: 'Sticker color adjustment', text: 'Recolor sticker artwork to match a palette.', guide: 'add-stickers' },
			{ type: 'added', name: 'Gallery search', text: 'Search and filter stickers, glitters, and shapes, with faster on-demand loading.', guide: 'add-stickers' },
			{ type: 'added', name: 'Antialias Edges', text: 'Smoother edges on text, shapes, and masks.', guide: 'editing-settings' },
			{ type: 'added', name: 'Export optimization details', text: 'The export preview shows frame reduction and loop closure.', guide: 'export-settings' },
			{ type: 'changed', name: 'Mobile', text: 'Better gestures, drawers, and layer reordering.', guide: 'mobile' },
			{ type: 'fixed', name: 'Animated sticker flicker', text: 'Animated stickers no longer flicker in the preview.' }
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
			{ type: 'added', name: 'Mask brush and eraser', text: 'Paint or erase Glitter Fill masks by hand, with adjustable size, spacing, and smoothing.', guide: 'mask-brush' },
			{ type: 'added', name: 'Text layers', text: 'Editable text with typography, layout, fill, border, and shadow controls.', guide: 'text' },
			{ type: 'added', name: 'Shape layers', text: 'Editable shapes with fill, border, and shadow controls.', guide: 'shapes' },
			{ type: 'added', name: 'Point and area text', text: 'A text layer can grow with its content or wrap inside a fixed box.', guide: 'create-text' },
			{ type: 'added', name: 'Display fonts', text: 'A library of self-hosted display fonts for Text layers.', guide: 'text-typography' },
			{ type: 'added', name: 'Canvas size', text: 'Change the document dimensions after you start.', guide: 'canvas-view-options' },
			{ type: 'added', name: 'Glitter gallery', text: 'Choose a glitter from a gallery instead of the small swatch list.', guide: 'select-colors' },
			{ type: 'changed', name: 'Unified input', text: 'Mouse and touch now behave the same on desktop and mobile.', guide: 'mobile' },
			{ type: 'added', name: 'Confirmations', text: 'The editor asks before actions that discard work.' },
			{ type: 'changed', name: 'Color Fill', text: 'The Color Picker tool is now Color Fill, which says what it does.', guide: 'tools' }
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
			{ type: 'added', name: 'Mobile layout', text: 'Drawer panels and touch controls for phones.', guide: 'mobile' },
			{ type: 'changed', name: 'Touch handling', text: 'Tapping, dragging, pinch-zoom, and transforms behave predictably on phones and tablets.', guide: 'mobile' },
			{ type: 'added', name: 'Blank canvases', text: 'Start from a blank canvas or a preset base image instead of an upload.', guide: 'getting-started' },
			{ type: 'added', name: 'Guide and hints', text: 'A built-in guide, plus hints for the active tool and selected layer.', guide: 'getting-started' },
			{ type: 'added', name: 'Custom stickers', text: 'Upload your own artwork as stickers.', guide: 'add-stickers' },
			{ type: 'added', name: 'Transform handles', text: 'Scale and rotate stickers right on the canvas.', guide: 'working-with-layers' },
			{ type: 'added', name: 'Asset details', text: 'Stickers and glitters show their original source, dimensions, and frame rate.', guide: 'add-stickers' },
			{ type: 'added', name: 'Welcome screen', text: 'An introduction for first-time visitors.' },
			{ type: 'changed', name: 'Sliders', text: 'The main settings use sliders for quicker adjustment.' }
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
			{ type: 'added', name: 'Glitter Fill layers', text: 'Apply animated glitter to selected image colors.', guide: 'create-glitter' },
			{ type: 'added', name: 'Stickers', text: 'Sticker layers and a browser for the archived sticker collection.', guide: 'stickers' },
			{ type: 'added', name: 'Layers', text: 'Move, scale, rotate, duplicate, reorder, and hide layers.', guide: 'working-with-layers' },
			{ type: 'added', name: 'Animated GIF export', text: 'Transparency options, size warnings, and automatic frame reduction.', guide: 'export-settings' }
		]
	}
];

const PUBLISHED_RELEASES = RELEASES.filter((release) => !release.unreleased);

// One feature as { type, name, text, guide }. `name` is the short bold lead
// (what changed), `text` the detail. A plain string is an unnamed addition.
// Every release renderer reads through this.
function normalizeReleaseFeature(feature) {
	const { type = 'added', name = '', text = feature, guide = null } = typeof feature === 'string' ? {} : feature;
	return { type, name, text, guide };
}

// A feature's lead and detail as HTML, shared by the modal and the Updates page.
function releaseFeatureTextHtml({ name, text }, escape) {
	return name ? `<strong>${escape(name)}.</strong> ${escape(text)}` : escape(text);
}

// One version-history entry as HTML: the editor's About and Welcome modals
// (js/editor/modals-wiring.js) and the standalone About and Updates pages
// (tools/build-pages.js) all render through this, so they can't drift. Each
// entry is the shared "Advanced disclosure" primitive (.advanced-disclosure,
// see disclosures.js). A feature's `guide` becomes a real link to that Guide
// section; the editor opens the Guide modal on a plain click instead.
function renderReleaseEntryHtml(release, { open = false, guideHref = 'guide/' } = {}) {
	const escape = (value) => String(value).replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
	const image = release.image?.src
		? `<figure class="version-history-image"><img src="${escape(release.image.src)}" alt="${escape(release.image.alt || '')}" loading="lazy" decoding="async"></figure>`
		: '';
	const features = release.features.map((feature) => {
		const normalized = normalizeReleaseFeature(feature);
		const { type, guide } = normalized;
		const link = guide
			? `<a class="version-history-guide-link" href="${escape(guideHref)}#${escape(guide)}" data-guide-anchor="${escape(guide)}">Show me</a>`
			: '';
		return `<li class="version-history-feature"><span class="badge version-history-badge is-${escape(type)}">${escape(type)}</span> ${releaseFeatureTextHtml(normalized, escape)} ${link}</li>`;
	}).join('');
	const format = release.projectFormat != null
		? `<p class="version-history-format-note">Saves project files in format version ${escape(release.projectFormat)}.</p>`
		: '';
	return `<div class="advanced-disclosure version-history-entry${open ? ' is-open' : ''}" data-advanced="">`
		+ `<button type="button" class="advanced-disclosure-toggle version-history-toggle" data-advanced-toggle="" aria-expanded="${open}">`
		+ `<span class="version-history-header"><span class="version-history-title">v${escape(release.version)} — ${escape(release.name)}</span><time datetime="${escape(release.date)}">${escape(release.dateLabel)}</time></span>`
		+ '<span class="advanced-disclosure-chevron icon-wrapper"><svg class="icon"><use href="#icon-chevron-down"></use></svg></span>'
		+ '</button>'
		+ `<div class="advanced-disclosure-content version-history-content" data-advanced-content="">${image}<p>${escape(release.summary)}</p><ul>${features}</ul>${format}</div>`
		+ '</div>';
}

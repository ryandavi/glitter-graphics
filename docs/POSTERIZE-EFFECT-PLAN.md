# Base Image Posterize Effect Plan

## Goal

Add a non-destructive Base Image effect that reproduces the exact solid-color result shown by Auto Glitter's **Flat** preview. Posterize changes the rendered Base Image only; it does not create color layers or glitter masks.

This is a future feature. The current Auto Glitter work should not implement it implicitly.

## Product decisions

- Posterize belongs in **Base Image Properties**, not in Auto Glitter.
- The first version reuses Auto Glitter's palette analysis and region cleanup so both features produce the same pixels for the same settings.
- The effect is non-destructive. The original uploaded pixels remain the source of truth.
- Transparent source pixels remain transparent.
- Preview, GIF export, project save/load, and history must agree.
- Do not implement the effect with CSS filters or `ctx.filter`; export requires the same pixel-level result and Safari/iOS remains supported.
- Auto Glitter keeps **Flat** for now as a diagnostic preview. A later copy review may rename it **Regions**.

## Initial controls

- Enabled
- Colors
- Palette Style: Vibrant / Balanced / Natural
- Combine Similar
- Detail
- Clean Edges

Do not add dithering in the first version. Dithering changes the visual model from connected flat regions to patterned color approximation and should be evaluated separately.

## Shared analysis architecture

The reusable algorithm currently lives in `js/workers/auto-glitter.worker.js`:

1. `segmentImage()` converts visible pixels into stable candidate regions.
2. `reduceSegment()` reduces those regions to the requested palette.
3. The result supplies `labels`, `palette`, dimensions, and visible-pixel count.

Extract the generic segmentation, palette reduction, cleanup, and color conversion functions into a worker-safe shared module under `js/effects/`. Keep glitter-library matching (`assignSuggestedSwatches()` and hue suggestions) Auto-Glitter-specific.

Both consumers should use the same shared operations:

- **Auto Glitter:** labels become per-layer masks; palette colors remain the Flat preview source.
- **Posterize:** labels and palette are flattened directly into one `ImageData` result.

Add a small shared function that builds posterized pixels:

- Copy the source alpha unchanged.
- For label `255`, preserve transparency.
- For every other label, write the corresponding rounded palette RGB.
- Never mutate `editor.originalImageData` in place.

## Base layer state

Store tunable state on the Base Image layer, for example:

```js
background: {
	// Existing background fields...
	posterize: {
		enabled: false,
		colorCount: 5,
		paletteStyle: 'balanced',
		mergeDistinctness: 0.045,
		detail: 4,
		cleanEdges: true
	}
}
```

Defaults belong in `CONFIG`. `BaseBackgroundManager.normalizeLayer()` must populate and validate the state. Project serialization and history then retain it through the existing Base Image layer snapshot, provided no binary analysis result is stored on the layer.

## Caching and invalidation

Analysis results can be large and must remain derived cache data, not serialized state.

Cache by:

- Base image pixel/source revision
- Canvas dimensions
- Posterize settings that affect segmentation or reduction

Split segmentation and reduction caches as Auto Glitter does so changing Colors, Palette Style, or Combine Similar does not repeat the expensive source scan when unnecessary. Invalidate on Base Image replacement, canvas resize, project load, and relevant setting changes.

## Preview implementation

- Base Image preview rendering requests the cached posterized `ImageData` when the effect is enabled and the background mode is `image`.
- Keep the last completed result visible while a newer request runs to avoid flashing.
- Decode/compute before swapping the visible source.
- Show the standard pending state while analysis is running.
- Ensure background opacity and existing Base Image color adjustment are applied in a documented order. Recommended order: Posterize, then Base Image color adjustment, then opacity.

## Export implementation

Add the same pixel flattening to the Base Image branch of `GifExporter`.

- Export must consume the original Base Image pixels plus normalized Posterize settings, not a screenshot of the DOM preview.
- Reuse the shared posterized-pixel function or a byte-equivalent worker result.
- Preserve alpha and existing Base Image inclusion/opacity behavior.
- Repeated exports without state changes must remain byte-stable.

## Panel and guide work

- Add a **Posterize** card to Base Image Properties through `PANEL_SCHEMAS` primitives.
- Use the shared slider and segmented-control patterns.
- Disable or hide the controls when the Base Image source mode is not `image`, while retaining their values.
- Document Posterize in `modals/guide.html` and explain that Auto Glitter creates editable layers whereas Posterize remains a single Base Image effect.

## Suggested work packages

1. Extract the shared analysis module without changing Auto Glitter output; lock behavior with fixture tests.
2. Add the shared `labels + palette -> ImageData` flattener and pixel-level tests, including transparency.
3. Add normalized Base Image state, config defaults, and panel controls.
4. Add cached DOM/canvas preview processing with stale-request protection.
5. Add GifExporter parity and serialization/history coverage.
6. Update the guide and run manual export stability checks.

## Acceptance criteria

- With matching settings, Base Image Posterize pixels exactly match Auto Glitter Flat pixels.
- Toggling the effect never mutates the uploaded source pixels.
- Transparent pixels retain their original alpha.
- Preview and exported GIF frames match.
- Undo/redo, project save/load, Base Image replacement, and canvas resize behave correctly.
- Rapid slider changes never flash the unprocessed Base Image between completed results.
- Exporting twice without changes is stable.
- Auto Glitter analysis and glitter matching remain unchanged after extraction.

## Required verification

- Add shared analysis and posterized-pixel unit tests.
- Run `node tests/auto-glitter-analysis.js`.
- Run `node tests/export-parity.js`.
- Run `node tests/shape-border-verify.js` if shared exporter plumbing changes effect-source dispatch.
- Manually verify: enable Posterize, export, edit settings, undo, export again, then export twice consecutively.

# Base Image Posterize Effect Plan

## Goal

Add a non-destructive Base Image effect that flattens the image to its reduced palette using Auto Glitter's analysis. The canonical definition of the effect is the shared `flatten(labels, palette)` function this plan introduces — **not** the Auto Glitter Flat preview. (2026-07-17 update: since the session-layer rework, Flat is rendered by swapping each ephemeral session layer's fill slot to solid and compositing the layer stack with binarized masks — `AutoGlitterManager` `previewMode === 'flat'` — so it is no longer a plain labels+palette flatten. The two are expected to *visually agree* because the masks derive from the same labels, but the flatten function is the source of truth and the test target.) Posterize changes the rendered Base Image only; it does not create color layers or glitter masks.

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

Do not add dithering in the first version. Dithering changes the visual model from connected flat regions to patterned color approximation — it is specced separately as **Dither mode (v2)** below and ships after Posterize v1 proves out the shared pipeline.

## Shared analysis architecture

The reusable algorithm currently lives in `js/workers/auto-glitter.worker.js`:

1. `segmentImage()` converts visible pixels into stable candidate regions.
2. `reduceSegment()` reduces those regions to the requested palette.
3. The result supplies `labels`, `palette`, dimensions, and visible-pixel count.

Extract the generic segmentation, palette reduction, cleanup, and color conversion functions into a worker-safe shared module under `js/effects/`. Keep glitter-library matching (`assignSuggestedSwatches()` and hue suggestions) Auto-Glitter-specific.

Both consumers should use the same shared operations:

Three consumers share the pipeline, each taking a different cut of it:

| Consumer | Segmentation (labels) | Palette reduction | Cleanup | Glitter matching |
|---|---|---|---|---|
| Auto Glitter | yes → per-layer masks | yes | yes | yes |
| Posterize (v1) | yes → flattened regions | yes | yes | no |
| Dither (v2) | **no** — per-pixel | yes (palette only) | no | no |
| Pixelize (v2) | no | no | no | no — pure resample stage |

- **Auto Glitter:** labels become per-layer masks; palette colors become each session
  layer's solid fill (which is what the Flat preview mode shows, via fill-slot swap).
- **Posterize:** labels and palette are flattened directly into one `ImageData` result.
- **Dither:** approximates each source pixel from the reduced palette using a dither
  pattern — needs the palette but not labels or region cleanup (see Dither mode (v2)).

Session-model note (2026-07-17): Auto Glitter now runs as a session of ephemeral
`layer.isPreview` layers (excluded from history/export/save; undo disabled while
active; paint via `markPaintTransient`). Posterize creates no layers so none of that
applies to it, but the extraction in WP1 is lifting code out of a worker that session
code messages — behavior-locking already has a harness: `tests/auto-glitter-analysis.js`
exists (don't write a new fixture runner; extend it).

Coordination (2026-07-17): `docs/ADMIN-IMPROVEMENT-PLAN.md` WP-C rewrites
`assignSuggestedSwatches` in this same worker (coverage-weighted matching, swatch
payload gains `weights`). No overlap — matching stays Auto-Glitter-specific under both
plans — but sequence the work: land WP-C first (small, self-contained), then WP1's
extraction moves the untouched generic functions around it.

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
- Ensure background opacity and existing Base Image color adjustment are applied in a documented order: Posterize, then Base Image color adjustment, then opacity. (v2 inserts Pixelize before Posterize; see the fixed-pipeline decision in Pixel effects (v2) — that section's stage order is the canonical one.)

## Export implementation

Add the same pixel flattening to the Base Image branch of `GifExporter`.

- Export must consume the original Base Image pixels plus normalized Posterize settings, not a screenshot of the DOM preview.
- Reuse the shared posterized-pixel function or a byte-equivalent worker result.
- Preserve alpha and existing Base Image inclusion/opacity behavior.
- Repeated exports without state changes must remain byte-stable.

## Panel and guide work

- Add a **Posterize** card to Base Image Properties through `PANEL_SCHEMAS` primitives.
- Use the shared slider and segmented-control patterns.
- Disable or hide the controls when the Base Image source mode is not `image`, while retaining their values. (v2 widens this to `image` + `gradient` — see Source applicability.)
- Document Posterize in `modals/guide.html` and explain that Auto Glitter creates editable layers whereas Posterize remains a single Base Image effect.

## Pixel effects (v2): fixed pipeline, Pixelize, Dither

Ships after Posterize v1. Same Base Image card, same non-destructive model, same
preview/export parity rules. Ryan-said (2026-07-17): artistic dithering with
controllable dither pixel size; a pixelize effect; reuse as much as possible across
Auto Glitter, Posterize, and Dither.

### DECIDED: one fixed pipeline, no effect stacking (2026-07-17, Fable recommendation)

Effects do not stack or reorder. The Base Image renders through one canonical
pipeline with fixed stages:

```
Base Image → [1] Pixelize (Pixel Size) → [2] Palette (Off / Posterize / Dither)
           → [3] Color Adjust → [4] Opacity
```

- **Why no ordering UI:** every visual feature in this app is implemented twice
  (DOM preview + canvas export) and must match. Every *orderable combination* is a
  new parity surface with its own stability tests. One documented order costs one
  implementation; a reorderable stack costs one per permutation for near-zero
  artistic gain.
- **Why this order:** pixelize-first means Posterize sees chunky cells and produces
  chunky regions (the retro look); color-adjust-after-palette shifts a reduced
  palette coherently.
- **Exclusivity rules:** stage 2 modes are mutually exclusive (segmented control).
  Pixel Size is *orthogonal* — it combines with any stage-2 mode. "How do effects
  prioritize?" has a one-line answer: they don't — they occupy fixed stages.
- **Pixelize is not a separate effect.** Pixel Size > 1 with Palette = Off *is* the
  pixelize/mosaic effect. Same mechanism as the dither cell size (compute at 1/N,
  nearest-neighbor upscale) — one control, one implementation, three looks.
- This pipeline is the ceiling. An effect idea that doesn't fit an existing stage is
  a new plan, not a new stack entry.

### Source applicability (Ryan-said 2026-07-17: gradients too)

The pipeline input is the **rasterized background source**, not specifically the
uploaded image. Per background mode:

| Background mode | Pixelize | Posterize | Dither | Notes |
|---|---|---|---|---|
| `image` | yes | yes | yes | v1 scope (posterize) |
| `gradient` | yes | yes (→ hard bands) | yes | the historic use of dithering is de-banding gradients; duotone-dither of a gradient is a headline look |
| `solid` | no-op | no-op | no-op | single color in, single color out — hide the card |
| `glitter` | deferred | deferred | deferred | animated source ⇒ per-frame processing + Shimmer interplay; new decision, not this plan |
| `none` | — | — | — | hidden |

Gradient specifics: the source is parametric (stops), so the analysis/dither input
is its deterministic rasterization at canvas size — preview and export must
rasterize identically (they already must for the gradient itself). Cache keys gain
the gradient parameters; invalidate on stop/angle edits and canvas resize. Auto
palette just feeds the rasterized pixels through the same worker — no special
path — though gradients will often look best with Presets/Duotone rather than Auto
(an N-color palette of a 2-stop gradient is mostly those two colors plus
midpoints, which is exactly what you want for banding art).

The v1 "disable when source mode is not `image`" panel rule becomes "enable for
`image` and `gradient`, hide otherwise" once v2 lands (v1 may ship image-only).

### Why dither is cheap on this architecture

Dither is per-pixel approximation against the reduced palette — it consumes
`reduceSegment`'s palette but skips segmentation, labels, and region cleanup
entirely. That makes it *cheaper* to preview than Posterize (no source scan beyond
palette derivation) and means the shared module from WP1 already contains almost
everything it needs; v2 adds only the resample stage, dither kernels, and palette
presets. Pixelize alone touches no analysis at all (pure resample — see table).

### Controls

- **Pixel Size** (stage 1, always visible; 1 = off, 2–8 = mosaic cells): compute at
  1/N resolution, nearest-neighbor upscale, each cell an N×N block. Applies to all
  stage-2 modes and to Off (pure pixelize). Plays to the app's existing
  `image-rendering: pixelated` treatment — cells stay crisp under zoom.
- **Palette mode** (stage 2): segmented Off / Posterize / Dither. Posterize keeps
  its v1 settings; Dither adds:

  - **Algorithm** (the artistic personality knob):
    - *Ordered (Bayer)* — clean retro screen-door; deterministic; 8×8 matrix,
      scaled by cell size.
    - *Floyd–Steinberg* — organic film grain (serpentine scan internally; not a
      user control).
    - *Atkinson* — the classic old-Mac look; lighter, partial error diffusion,
      charmingly blown highlights.
    - *Halftone* — dots or lines with an **Angle** control (newspaper / comic /
      risograph look). Dot shape round/square can wait for a copy round.
  - **Palette** (source of the colors being dithered between):
    - *Auto* — the reduced N-color palette from the shared analysis (Colors /
      Palette Style / Combine Similar apply exactly as in Posterize).
    - *Presets* — 1-bit black & white, Game Boy green, CGA, sepia. Preset lists
      live in `CONFIG`, not code.
    - *Duotone* — two user-picked colors (reuse the existing color-picker pattern).
      Duotone + Halftone is the headline aesthetic combo.
  - **Strength** (0–100%): scales the diffusion error (or threshold contrast for
    ordered/halftone), blending from flat posterize toward full dither.
  - **Shimmer** (off by default): offsets the dither threshold per exported GIF
    frame so the grain subtly crawls — "living dither." See constraints.

### State

Extends the same `background` block; v1's `posterize` key is superseded by
`pixelEffects` (one normalized shape through `normalizeLayer`, serialization, and
history — if v1 ships before v2, migrate the key in `normalizeLayer`):

```js
pixelEffects: {
	pixelSize: 1,                                  // stage 1; 1 = off, 2–8 = cells
	paletteMode: 'off' | 'posterize' | 'dither',   // stage 2
	// shared analysis settings (colorCount, paletteStyle, mergeDistinctness,
	// detail, cleanEdges) as in v1 — detail/cleanEdges are posterize-only, keep
	// values when switching modes
	dither: {
		algorithm: 'bayer' | 'floyd' | 'atkinson' | 'halftone',
		angle: 45, strength: 100,
		palette: 'auto' | presetId | 'duotone', duotone: ['#000000', '#ffffff'],
		shimmer: false
	}
}
```

### Constraints (same invariants as v1, plus)

- Pure pixel math — no `ctx.filter` (Safari/iOS export). Preview and export call the
  same shared dither function; export is the twin, not a DOM screenshot.
- Alpha copies through unchanged; output colors are fully opaque palette entries, so
  no mask-binarization concern.
- **Determinism:** all thresholds/offsets derive from pixel coordinates (and frame
  index for Shimmer) — never `Math.random()`. Double-export byte-stability must
  hold; with Shimmer ON, frame N must be byte-identical across exports even though
  frames differ from each other.
- Shimmer makes frames non-identical → larger GIFs; surface that in the control's
  hint text. With Shimmer OFF, a static base under animated glitter must not
  re-dither per frame — compute once, reuse the buffer.
- Palette presets bypass the analysis entirely (no worker round-trip); Auto palette
  caches like Posterize's reduction cache.

### v2 work packages

1. Resample stage (Pixel Size) + dither kernels + palette presets in the shared
   module; pixel-level tests (determinism, alpha, cell blocks, each algorithm's
   golden fixture, pixelize-only path).
2. Pixel Size slider + mode segmented control + dither controls in the Base Image
   card (`PANEL_SCHEMAS` primitives); `pixelEffects` state normalization +
   serialization + history (incl. v1 `posterize` key migration if applicable).
3. GifExporter parity incl. Shimmer frame-indexed offsets; extend the manual
   export-stability pass with a Shimmer double-export check.
4. Guide entry (one card covering Posterize + Dither as "Palette Effects").

## Suggested work packages (v1 — Posterize)

1. Extract the shared analysis module without changing Auto Glitter output; lock behavior by extending the existing `tests/auto-glitter-analysis.js` harness (after ADMIN-IMPROVEMENT-PLAN WP-C lands — see coordination note above).
2. Add the shared `labels + palette -> ImageData` flattener and pixel-level tests, including transparency.
3. Add normalized Base Image state, config defaults, and panel controls.
4. Add cached DOM/canvas preview processing with stale-request protection.
5. Add GifExporter parity and serialization/history coverage.
6. Update the guide and run manual export stability checks.

## Acceptance criteria (v1 — Posterize; v2 criteria live in its section)

- Posterize pixels are byte-identical to the shared `flatten(labels, palette)` result for the same analysis inputs (this is the canonical test). Auto Glitter Flat visually agrees with it for matching settings; treat Flat comparison as a tolerance check, not byte equality — Flat renders through the session layer stack.
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

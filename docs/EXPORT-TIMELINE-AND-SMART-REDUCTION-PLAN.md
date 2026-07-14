# Export Timeline and Smart Reduction Plan

## Objective

Replace frame-count arithmetic with a time-based, canvas-aware export planner that stays visually close to the live canvas while producing fewer GIF/MP4 frames and smaller files.

The planner must preserve animation speed and loop quality, use original source-frame timing, and make reduction decisions from the final composed canvas rather than treating every source frame as equally important.

## Current behavior

`GifExporter` currently collects the frame count of every visible animated source, including effect-slot glitter sources, and calculates their least common multiple (LCM).

When Smart Frame Reduction is enabled it:

- rounds some counts to nearby multiples of three when that lowers the LCM;
- caps sources above 24, 36, or 60 frames to fixed smaller counts;
- uniformly maps reduced source positions back to original frame indexes;
- caps the final timeline at `maxFrames`, currently 60 by default.

All composed frames receive the global export delay. Original GIF frame delays are parsed and retained in asset metadata but are not used by the export timeline. Manual Frame Skip omits frames without extending retained-frame durations.

Despite its current settings description, Smart Frame Reduction does not detect duplicate rendered frames.

## Problems to solve

- A capped LCM can stop between loop boundaries and produce a visible jump.
- Uniform frame-count reduction ignores original per-frame delays and changes motion timing.
- Sources covering a few pixels receive the same scheduling priority as full-canvas animation.
- Arithmetic reduction cannot tell whether removed frames are identical, subtle, or visually essential.
- Frame Skip shortens the animation instead of preserving its speed and duration.
- Variable-frame-rate source GIFs become constant-rate animations.
- File-size reduction is inferred from frame count rather than measured from composed output.
- The UI cannot explain the actual optimization or its effect on duration and fidelity.

## Design principles

1. Time is the source of truth; frame indexes are derived from timestamps.
2. Reduction operates on final export-sized canvas frames.
3. Exact duplicates are always safe to merge.
4. Near-duplicate removal is bounded by an explicit visual-error budget.
5. Animation duration and playback speed remain unchanged unless the user chooses otherwise.
6. The first frame and loop-boundary transitions are protected.
7. GIF and MP4 consume the same timeline plan.
8. Export limits are budgets, not reasons to truncate an incomplete cycle.

## Proposed architecture

### `AnimationSourceTimeline`

Normalize every animated source into:

- source key and owning layer;
- flattened frames;
- a duration for each frame;
- cumulative frame boundaries;
- total cycle duration;
- visibility and effect-slot metadata.

Given timestamp `t`, it returns the correct source frame using `t % cycleDuration`. Static sources expose one infinite-duration frame.

### `CompositeTimelinePlanner`

Build a bounded candidate timeline from all visible source timelines:

1. Collect meaningful source-frame boundary timestamps.
2. Select a practical sampling cadence bounded by configured maximum FPS.
3. Choose a loop duration that completes cleanly when feasible.
4. If the exact common duration is excessive, choose a bounded duration and optimize the loop seam rather than truncating an arbitrary LCM index.
5. Render candidates through the existing `_renderFrame` composition path.

The planner returns frame image data, per-frame durations, source-frame selections, total duration, and loop-seam metadata.

### `CompositeFrameReducer`

Reduce already-composed frames in this order:

1. Hash RGBA data and merge exact consecutive duplicates.
2. Calculate a perceptual difference score for remaining adjacent frames.
3. Accumulate the duration of removed frames into retained neighbors.
4. Iteratively remove the lowest-error candidates until the frame or size budget is met.
5. Protect the first frame, material scene changes, and loop-boundary frames.

Difference should be measured at final export dimensions. Transparent pixels and alpha changes must participate in the score. A sampled fast pass may reject clearly different frames before a full comparison.

### Shared `ExportTimelinePlan`

Both encoders should receive:

```js
{
  frames: ImageData[],
  frameDurations: number[],
  totalDuration: number,
  sourceFrameSelections: Map,
  reduction: {
    originalFrameCount: number,
    outputFrameCount: number,
    exactDuplicatesMerged: number,
    nearDuplicatesMerged: number,
    maximumVisualError: number,
    durationPreserved: boolean
  }
}
```

GIF should pass each duration to `gif.addFrame`. MP4 should use cumulative timestamps and each frame's individual duration.

## Frame Skip behavior

Keep Frame Skip as an explicit user override, but preserve time:

- retaining every second frame doubles that frame's duration;
- retaining every third frame triples it;
- the final retained frame absorbs any remainder;
- reverse changes frame order without changing the duration sequence's total.

Rename the setting to clarify that it is a manual sampling override rather than Smart Reduction.

## Smart Reduction behavior

Smart Reduction should mean:

- preserve original timing;
- merge exact composed duplicates;
- remove near-duplicates only within the configured error threshold;
- prefer reductions with the largest estimated byte saving per unit of visual error;
- stop early when further reduction would visibly degrade the animation.

If output still exceeds a hard frame budget, report that the budget requires a quality compromise rather than silently cutting the loop.

## UI changes

- Replace “Automatically detect and remove duplicate frames” only after the implementation truly does so.
- Show original and output frame counts.
- Show whether duration was preserved.
- Show exact and near-duplicate merge counts.
- Show a warning when the loop seam could not be made exact.
- Keep advanced controls optional: frame budget, visual-quality threshold, and maximum sampling FPS.
- Use outcome-oriented presets such as High Fidelity, Balanced, and Small File.

## Configuration

Move thresholds into `CONFIG.export.timeline`, for example:

```js
timeline: {
  maxSamplingFps: 30,
  preferredFrameBudget: 60,
  hardFrameLimit: 1000,
  exactDuplicateThreshold: 0,
  balancedVisualError: 0.008,
  smallFileVisualError: 0.02,
  maxLoopDurationMs: 12000
}
```

Avoid embedding source-count thresholds such as 24, 36, and 60 in exporter logic.

## Implementation sequence

1. Extract current source discovery and frame selection into `AnimationSourceTimeline` without changing output.
2. Add per-source duration normalization and time-based frame lookup.
3. Introduce `ExportTimelinePlan` and make GIF/MP4 consume per-frame durations.
4. Make Frame Skip duration-preserving.
5. Add exact composed-frame hashing and duration merging.
6. Add perceptual difference scoring and budgeted near-duplicate reduction.
7. Replace LCM truncation with bounded loop-seam planning.
8. Update export settings, preview statistics, status messages, and documentation.
9. Remove the legacy `_smartReduceFrames` path after parity and regression coverage pass.

## Verification

Create deterministic fixtures covering:

- one constant-rate animation;
- one variable-rate animation;
- sources with 7 and 11 frames;
- sources with 24 and 25 frames;
- animated sticker plus multiple glitter effect slots;
- a tiny animated layer over a mostly static canvas;
- transparent animation and alpha-only changes;
- exact duplicate source frames;
- near-duplicate glitter frames;
- reverse and every Frame Skip value;
- GIF and MP4 timing parity;
- an animation whose exact common loop exceeds 60 frames.

For each fixture assert total duration, source frame at sampled timestamps, clean loop seam, output frame count, and maximum visual error. Add golden composed-frame hashes for no-reduction mode and tolerance-based image comparisons for reduced modes.

## Acceptance criteria

- Export playback speed matches source timing and the live canvas within browser timing tolerances.
- Smart Reduction never changes total duration unintentionally.
- Exact duplicate composed frames are merged with no pixel change.
- Near-duplicate reduction stays within the selected visual-error threshold.
- No export ends at an arbitrary partial LCM cycle without a reported seam decision.
- Frame Skip preserves duration.
- GIF and MP4 use the same selected frames and timing plan.
- Export preview reports truthful reduction statistics.
- Existing transparency, masks, transforms, gradients, watermarking, reverse, and effect-slot rendering remain pixel-equivalent when reduction is disabled.

## Implementation status

Implemented in July 2026.

- `AnimationSourceTimeline`, `CompositeTimelinePlanner`, and `CompositeFrameReducer` live in `js/classes/ExportTimeline.js`.
- Source GIF delays are normalized and used for timestamp-based frame selection, including variable-frame-rate sources and animated watermark timing.
- GIF and MP4 share one `ExportTimelinePlan`; both consume its individual frame durations.
- Manual Frame Sampling and reverse preserve the plan's total duration.
- Exact and bounded near-duplicate reduction runs on final composed RGBA frames and includes alpha in its error score.
- Long common loops use a bounded, reported best-fit seam instead of an arbitrary partial LCM cycle.
- Export settings provide High Fidelity, Balanced, and Small File outcomes plus preferred frame budget and maximum sampling FPS controls.
- The result modal reports compact file details by default. It shows optimization details only when frames were actually removed, and shows loop, quality-budget, and configured file-size warnings only when relevant.
- iOS result guidance disables long-press GIF saving and documents the Files → Save Image route, with Messages → Save as the built-in fallback.
- Deterministic timeline fixtures are in `tests/export-timeline-unit.js`; export render parity remains covered by `tests/export-parity.js`, and MP4 timing by `tests/mp4-export-verify.js`.

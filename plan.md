# Animation system and timeline audit

Status: proposed. Audit only; nothing here is implemented yet.

Scope: the motion model (`js/effects/animation.js`, `js/effects/easing.js`), the timing registry (`js/core/animation-timing.js`), the editor method bags (`js/editor/animation-edit.js`, `js/editor/animation-loop.js`, `js/editor/timeline.js`), the Animation panel (`js/systems/AnimationPanelController.js`, `createAnimationSectionSpec` in `js/ui/panel-schemas.js`), the preview clock (`js/systems/AnimationTicker.js`, `js/systems/MotionSelection.js`), the timeline (`js/ui/timeline-dock.js`, `js/ui/timeline-view.js`, `js/ui/timeline-key-lane.js`, `css/workspace/_timeline.scss`) and the export sources (`SceneCompositor._createLayerAnimationTimelineSources`, `js/export/ExportTimeline.js`).

How findings are labelled:

- **Confirmed bug**: reproduced with a Node probe against the real modules (the harness from `tests/unit/animation-timing-unit.js`), or certain from reading the code.
- **Likely bug**: the code path is clear, but it needs a look in the browser to confirm what the user sees.
- **UX**: a judgement call about usability, not a defect.
- **Cleanup**: redundancy, dead code or performance, with no visible behaviour change.

---

## 1. Summary

The core model is solid. One evaluator (`GlitterAnimation.progressAt` → `pose` → `composeSamples`) drives preview, export and the timeline curves. Every timing write already goes through one entry point (`editor.writeTiming` → `ANIMATION_TIMING_KINDS[kind].write`). Undo, locks and the dock being unloaded are already covered by tests (`tests/ui/animation-without-timeline-verify.js`).

The problems are in the layers around that core:

1. **The run model contradicts itself.** "Starts at" and "Start offset" interact in ways the UI doesn't show. A motion with a delay and an offset starts playing *before* its start time (B1). Slipping a finite bar changes its length (B2). Repeat counts are rounded to 0.01, so dragged edges drift (B3, B4).
2. **The timeline draws a pass that never plays.** The "Next pass" column shows the motion carrying on past the loop line. The preview actually wraps to t = 0. That hides real seams and ignores start delays (B6). Curves also tile one cycle, which is wrong for alternating directions (B5).
3. **The panel's `TimingStrip` is half a feature.** It is a read-only bar dressed as a button that does nothing, with a broken tooltip (B7, B8). Meanwhile the panel has no playhead, so key editing without the timeline depends on keyboard shortcuts nobody can see (U1, B13).
4. **Values are derived in several places.** Loop length, row geometry, "closes" and the export cycle are each worked out two to four times, with different rules for stale estimates (A1–A3).
5. **Hot paths recompute too much.** `listTimingTargets(editor)` rebuilds authored-GIF export plans for every layer on every slider tick, sometimes several times per tick, and once per target in `resetAnimationLoop` (A4, A5).

---

## 2. Confirmed bugs

### B1. Delay plus start offset plays early, and "Holds its first pose" holds the wrong pose
- **Where:** `GlitterAnimation.progressAt`, `js/effects/animation.js:440-463`.
- **Problem:** the pre-start test is `u < 0`, where `u = (t - delayMs) / period + phase`, so the motion starts at `delayMs - phase·period`, not at `delayMs`. The `!fill && localTime < 0` guard at :443 only applies to `fill = false` callers (key seeking). Preview and export both call with `fill = true`. When backwards fill does kick in, it holds `cycleAt({ start: 0, phase: 0 }, 0)` (:451), which is progress 0, not the pose at the start offset.
- **Probe:** Move, 1 s cycle, `delayMs: 500`, `phase: 0.5`, `fillMode: 'none'`. `runTiming` says the run starts at 500, but `tx` at t = 0/100/250/499 is 0/6/38/100. The timeline bar starts at 0.5 s, `keyProgress` and `paintKeyAdd` say "not inside", and the canvas is already moving.
- **Fix:** start the run at `t < delayMs`. Before it, return `null` (fill none/forwards) or hold `{ cycle: floor(phase), progress: directedProgress(phase − floor(phase), …) }` (fill backwards/both). Keep `u` as it is for t ≥ delay.
- **Benefit:** the bar, key controls, preview and export agree on when a motion starts.
- **Compatibility:** this changes the rendered output of saved projects that combine a delay > 0 with an offset > 0. Call it out in the release notes and refresh any parity baseline that encodes the old frames on purpose.

### B2. Slipping a finite run changes its length
- **Where:** `ANIMATION_TIMING_KINDS.motion.write`, `js/core/animation-timing.js:20`. A phase write leaves `iterations` alone, and `runTiming` ends at `start + (iterations − phase)·period`.
- **Probe:** Pulse with 2 repeats from 0 s → 2.00 s. After a slip to phase 0.5 it runs 0 s → 1.50 s. During the drag the dock draws the old end (`paintDrag`, the `kind === 'slip'` branch), so the bar jumps on release. The panel's "Start offset" slider has the same effect.
- **Fix:** when a write changes `phase` on a finite motion and has no `run` patch, recompute `iterations` so that `runTiming(...).end` stays the same (see B3 for precision).
- **Benefit:** a slip does what its tooltip says: "slip the motion inside it".

### B3. Repeat counts are rounded to 0.01, so ends drift and snaps are lost
- **Where:** `GlitterAnimation.iterationsForRun`, `js/effects/animation.js:338` (`.toFixed(2)`).
- **Probe:** asking for an end at 1333.3 ms stores 1330 ms. The error is up to 0.005 × period: ±5 ms on a 1 s cycle, ±100 ms on the 20 s maximum. An edge snapped to another bar's edge, to the playhead ("End at playhead") or to a cycle moves off it after commit, which can cost an export frame.
- **Fix:** store full precision, or round to 1e-6 to keep JSON tidy. Do the rounding for display only, in `TimelineView.repeatsText` and the panel's Iterations field. Relax the field's `step` to `any`, so 1.33 doesn't show as invalid in a field that steps by 0.25.
- **Compatibility:** stored counts that are already rounded still load.

### B4. Short runs are clamped without telling the user, and the drag shows a different length
- **Where:** `iterationsForRun` clamps to `FIELDS.animIterations.min` (0.25). `TimelineView.runFromRightEdge` allows `cycle·ε`. `paintDrag` draws the requested `value`, not what was stored.
- **Probe:** an end requested at 100 ms (1 s cycle) is stored at 250 ms.
- **Fix:** clamp the run in `runFromRightEdge` (and in `durationFromEdge`) to the same minimum. Better still, have `paintDrag` draw the stored run read back from `listTimingTargets`/`writeTiming`, so what you see always matches what was stored.

### B5. Motion curves are wrong for `alternate` and `alternate-reverse`
- **Where:** `TimelineView.motionCurve`, `js/ui/timeline-view.js:71-85`, drawn by `.timeline-bar-marks::before` with `background-size: var(--cycle-px)` (`_timeline.scss:448-455`).
- **Problem:** it samples one cycle (index `ceil(phase)`) and tiles it. Alternating directions reverse every other cycle, so half the drawn cycles run the wrong way.
- **Fix:** when `isReversedCycle` differs between consecutive cycles, sample two cycles. Return the tile width (`cycles: 2`), have `buildMarks` set `--curve-px = 2 × cyclePx`, and offset from an even cycle. Add `direction` to the curve signature in `resolveCurve` (it is already there) and `run.start`, because the samplers for random-based presets (shake, tremble) depend on absolute time.

### B6. The "Next pass" column shows a pass that never plays
- **Where:** `TimelineDock.layoutRow`, `js/ui/timeline-dock.js:1401-1411`, together with `buildMarks(drawing, loopMs, loopMs·(1+share))`.
- **Problem:** the preview clock wraps (`AnimationTicker._wrap`), so after the loop line the document replays from t = 0. The ghost does three things wrong:
  1. It draws the motion *continuing* at `loopMs`. The phase is computed with `timeToCycle(…, loopMs)`, so a row with a seam looks smooth across the line, which contradicts its own ⚠ marker.
  2. It always starts at the loop line with full width, even for a row that starts at 1 s. In the real next pass that row rests until 1 s.
  3. For finite runs it removes the marks but keeps the shaded box across the whole column. That suggests something plays there, when in the next pass the run starts again at `startMs`.
- **Fix:** draw the ghost as a replay. Intersect the run `[startMs, endMs)` with `[0, share·loopMs)`, shift it by `+loopMs`, and give it the same `--cycle-offset-px` as the main bar (its phase at `startMs`). Skip it when the intersection is empty. This is a small change inside `layoutRow`; add a pure helper `TimelineView.nextPassBox(row, loopMs, share)` so it can be unit-tested.
- **Answer to "should the curve be clipped to its bar or extend into the next-pass column?":** clip it to the bar in both places, and make the next-pass column show the start of the loop again. Then:
  - a seamless row's curve carries on across the loop line;
  - a row with a seam shows the jump exactly at the line, next to its ⚠;
  - delayed and finite rows show their real gap.

  Extending the current bar's curve into the column would show motion that is never rendered. While the ghost stays as it is, the curve must not be drawn there, and `buildMarks` already puts it there today. The 12 px `barMinPx` floor also draws curve past the end of very short runs. Clip the marks to the true run width (`clip-path` on the marks element) instead of the padded bar width.

### B7. The panel's `TimingStrip` bar has a broken tooltip and a click that does nothing
- **Where:** `AnimationPanelController.loadTimingStrip`, `js/systems/AnimationPanelController.js:591-611`.
- **Problem:** the `row` it builds has no `label`, so `TimelineView.barTitle` produces "undefined: 1.00 s…". `barTitle` also adds "Drag to move it. Alt-drag to slip…", but the strip can't be dragged. When Custom motion is enabled the bar is a `<button>` that calls `motionSelection.select(layer.id, <already selected id>)`, which only reloads the panel.
- **Fix:** see the strip redesign in §4.2. At the very least, pass `label` and write a hint-free title.

### B8. The strip's cycle stripes ignore the start offset and direction
- **Where:** `--cycle-share` in `loadTimingStrip` and `.animation-timing-bar` in `css/panels/_effects.scss:308-320`.
- **Problem:** the stripes start at the bar's left edge, so with an offset they don't line up with the real cycle boundaries. `barBox(row, 100000 / loopMs, CONFIG.ui.timeline)` also treats `barMinPx` (pixels) as a percentage, so a run is never drawn narrower than 12 % of the strip.
- **Fix:** add a `background-position` offset of `−phase × cycle-share`, as the dock does with `--cycle-offset-px`. Turn the minimum width into a percentage from the strip's measured width, or drop it in favour of `min-width: 2px` in CSS.

### B9. "Motion: Step" uses a Steps value you can't see
- **Where:** `easedProgress`, `js/effects/animation.js:413`, uses `data.steps` when `snapMode === 'step'`. The panel only shows the Steps row when `easing === 'steps'` (`AnimationPanelController.load`, :574-575).
- **Fix:** also show the Steps row when `snapMode === 'step'`. Move the "Motion" (sampling) select from the **Pivot** group to **Playback**, since it has nothing to do with the pivot.
- **UX note:** `easing: steps` quantises time and `snapMode: step` quantises the eased progress. Users can't tell the two apart. Consider describing the snap mode as "Step after easing", or merging the two in a later pass (see U6).

### B10. `timeline-loop-end` spacing, alignment, and a handle that disappears when "Next pass" is hidden
- **Where:** `buildRuler`, `js/ui/timeline-dock.js:694-697`, and `.timeline-loop-end`, `css/workspace/_timeline.scss:245-261`.
- **Problems:**
  1. There is no `gap`: the bare `svg.icon` (1em) touches the "3.00 s" text. `.timeline-readout`, the other icon-plus-text chip in the same dock, uses `gap: var(--spacing-xs)`.
  2. The label's left inset (`--spacing-sm`) differs from the ruler tick labels' `rulerTextInsetPx` (4 px). The loop line next to the ticks therefore looks shifted.
  3. The 2 px `border-left` grows to the right of `--timeline-loop-x`, while the rows' loop line (`.timeline-track::after`, 1 px) and the playhead (1 px) sit at x. The lines are offset by about half a pixel, which is visible on the dock's hairline grid.
  4. The background is the opaque `--color-bg-secondary`. The rows dim the next pass with a 55 % mix, and the ruler canvas draws ticks up to `loopMs × (1 + share)` (`paintRuler`). The ruler's next-pass ticks are painted and then hidden. This is inconsistent with the rows, and the painting is wasted.
  5. **(Likely; check visually.)** With "Next pass" turned off, `nextLoopShare = 0`, so `trackWidth === loop-x`. The handle's box then starts at the right edge of an `overflow: hidden` track and is clipped entirely, along with its border. The loop length can't be dragged, and only the right-click "Set loop end here" is left, which can only shorten it.
  6. Nothing shows whether the loop is Automatic or Set. The difference is mentioned only in the tooltip ("double-click for Automatic").
- **Fix (SCSS only, plus one line of JS):**
  - Add `gap: var(--spacing-xs)` and `white-space: nowrap`.
  - Change `padding-inline-start` to the ruler text inset (expose `--timeline-ruler-text-inset` from `this.config.rulerTextInsetPx` beside the other dock variables in the constructor).
  - Change the border to 1 px and draw the wider grab target with a transparent `::before` centred on x.
  - Use the same `color-mix(... 55%, transparent)` as `.timeline-track::after`.
  - Always reserve a minimum next-pass gutter: in `measure()`, have `trackWidth` include at least `gripPx` plus the label width when `nextLoopShare === 0`.
  - Prefix the label with "Auto" when `documentLoop.mode === 'auto'`.
- **Note:** this needs a `css/style.css` recompile; Ryan does that.

### B11. The seam tooltip is wrong for finite runs
- **Where:** `TimelineView.seamTitle`, `js/ui/timeline-view.js:136-142`.
- **Problem:** every non-looping row that doesn't close gets "Still holding its last pose when the loop restarts". The default `fillMode: 'none'` *rests* after the run and doesn't hold. A finite run that goes past the loop end is cut off mid-motion: the bar is clipped to `loopMs`, and nothing says the run is truncated.
- **Fix:** branch on `run.end > loopMs` ("Cut off by the loop end at N%") and on the fill mode ("Holds its last pose…" / "Rests…"). Draw a truncation mark (a ragged or faded right edge) on bars whose `run.end > loopMs`.

### B12. Stale estimates are handled differently in different places
- **Where:**
  - `keyPeriod` (`js/editor/animation-edit.js:367-370`) uses `resolvedPeriod` only when `loopEstimate.documentRevision === documentRevision`.
  - `TimelineView.buildModel` (`timeline-view.js:31`) and `loadTimingStrip` (:596-597) always use it.
  - `TimelineDock.applyRowEdit` (:1046) overwrites `exportCycleMs` with the raw period.
- **Problem:** while you drag Cycle in the panel with the timeline open, each tick calls `dock.sync(<previous estimate>)`. The cycle marks, notches and `closes` use the old export period, then snap when the estimate lands.
- **Fix:** one helper (A2) that returns the export period only for a current estimate, and the raw period otherwise.

### B13. Selecting a key in the panel can't move the playhead into a run that hasn't started
- **Where:** `MotionSelection.select` (`js/systems/MotionSelection.js:146-151`) → `GlitterAnimation.timeAtProgress`, which returns `null` when `progressAt(…, false)` is `null` (outside the run).
- **Problem:** with the playhead before a delayed Custom motion, Key ‹ › and the key select don't seek. "Add key" then stays disabled ("Move the playhead inside this animation"), and the panel has no other way to move the playhead.
- **Fix:** when `current` is null for a keyed motion, use the run's first cycle (`floor(phase)`, clamped to the run). That one-line fallback in `timeAtProgress` fixes the panel and the key lane.

---

## 3. Likely bugs and open questions (check before fixing)

| # | Finding | Where | What to check |
|---|---|---|---|
| P1 | Enter or Space on an Animations stack row probably loses keyboard focus. `select()` calls `selectMotion` (which reloads through `motionselectionchange`) and then `load()` again, and `_renderStack` rebuilds every row with `replaceChildren`. The panel also loads twice per selection. | `AnimationPanelController._renderStack`, :341, :332 | Tab to a row, press Enter: does focus stay on it? Fix: drop the extra `this.load(layer)` in `select`, and refocus the row with the same `data-animation-index` after rendering (or reconcile rows instead of rebuilding them). |
| P2 | The paused "rest pose" isn't the rest pose. `_timeAt` returns time 0 when `restPreview`/not holding, but a motion with an offset (or a non-zero pose at p = 0) is mid-motion at t = 0. Transform handles then don't line up with the drawn layer while editing in rest preview. | `AnimationTicker._timeAt`, :124-126; `setRestPreview` on pointerdown, :21 | Pulse with a 25 % offset, pause, click the canvas. Fix: give `_paintEntry` a `rest` flag that paints `IDENTITY` (the CSS-driven path already freezes "at rest"). |
| P3 | Every `animationChanged` re-expands that layer's group in the dock, which undoes the user's collapse while they edit in the panel. | `timeline-dock.js:71` | Expand only on structural changes (add or duplicate), not on value edits. |
| P4 | The preview plays the natural period; export plays the fitted `resolvedPeriod` (within `proceduralPeriodTolerance`). They differ by up to the tolerance, and the preview can show a seam the export doesn't have. The timeline draws the export cycles; the panel sliders show the natural ones. | `ExportTimeline._planRenderClock` :836; `paintLayerAnimationPreview` | Decide which should win (see A3). |
| P5 | Changing the type resets the cycle to the preset's period but leaves `loopOriginalPeriods[key]` alone. "Restore previous timing" then restores a period that belonged to the previous type. | `setAnimationType`, `animation-edit.js:435-445` | Either keep `periodMs` across a type change (as `delayMs`, `iterations` and the rest already are), or clear that key's saved period. Keeping the period is more predictable for loop fitting. |
| P6 | `applyRepeats` commits "Change Repeats" even when `writeTiming` returned `false` (nothing changed). | `AnimationPanelController._bind`, :473-483 | Check that `saveState` skips no-op entries; if not, guard on the return value. |

---

## 4. UI/UX audit

### 4.1 Using animation without the timeline

What the panel already covers, at the API level and with undo, as `tests/ui/animation-without-timeline-verify.js` proves:
- the stack (add, duplicate, delete, reorder, show/hide), type, every motion field, Starts at, Cycle, Repeats, Easing/Steps, Start offset, Direction, Fill, Anchor, sampling;
- keys (select, retime, easing, values, add, delete, pose recording) and Convert to custom;
- per-motion timing actions through the row's ⋮ menu (`animationTimingActions`: Play once, Repeat forever, Start/End at playhead, Fit to loop, Fill the loop, Reset, Copy/Paste timing);
- loop length, fit and frame options in **Animation loop** (`animationLoopSection`).

Gaps and unnecessary dependencies:

| # | Gap | Evidence | Proposal |
|---|---|---|---|
| U1 | **There is no visible transport or playhead in the panel.** Play/pause, step and Home exist only as View-menu "Pause motion" and the `Space` / `,` / `.` / `Home` commands. You can't see the current time unless the timeline is open (the View button's label shows it only while paused). Yet "Start/End at playhead" and paused "Add key" depend on the playhead. | `COMMANDS.playback*` (`js/core/commands.js:2-5`); `syncKeyAdd` title "Move the playhead inside this animation" | Turn the Timing strip into the panel's transport (§4.2): playhead line, click or drag to seek (pauses), a play/pause icon button and a time readout in the row. This reuses `animationTicker.seek/step` and `subscribeTick`; nothing new needed in the model. |
| U2 | **The document loop is out of reach from the Animation panel.** Loop length, Fit to loop and frame options live in **Animation loop**, which is only shown with *nothing selected* (`openAnimationLoop` clears the selection). | `animation-loop.js:89-107` | Put a "Loop 3.00 s · Seamless ▸" link next to the strip that calls `openAnimationLoop()`. Better: show the same status line (value plus Seamless / Visible seam badge from `syncAnimationLoop`) inside the strip row. |
| U3 | **Exact-frame preview is timeline-only** (`frameView.playExact`). | `timeline-dock.js:36` | Offer it from the frame-options menu in Animation loop, which already opens the same `fillFrameOptionsMenu`. |
| U4 | Panel and timeline describe seams differently. The panel's LoopHint judges *one cycle on its own* ("Loops seamlessly" / "Restarts abruptly each loop"; `isSeamlessLoop(selected, ctx)` at its own period). The timeline, the strip and the loop status judge it *against the document loop*. A motion can read "Loops seamlessly" in the panel next to "Visible seam" for the loop. | `_syncSummary` :495-507 vs `sourceSeamError` | Use the row's `closes` (A2) for the hint, with `seamTitle`'s wording ("Ends 0.40 s into a 1.00 s cycle, so it jumps when the loop restarts"). |
| U5 | Adding an animation works differently in each place. The panel's + offers Preset / Custom keys; the timeline's + always adds the default preset. | `AnimationPanelController._bind` :405-412 vs `timeline-dock.js:49` | Share the menu: move the action list into an editor method (`addAnimationActions(layer)`) and use it from both buttons. |

Duplicated controls, which are fine because they all write the same state:
- Pause/resume: View menu, timeline header, `Space`.
- Fit to loop: loop section, timeline ⋮ menu, row menu.
- Frame options: loop section, timeline frame count.

One ownership oddity: `#pauseMotionTool` is bound in `AnimationPanelController`'s constructor (:12-13) but is a View-toolbar control. Move the binding next to `syncPlaybackControls` in `animation-loop.js`.

### 4.2 `stickerAnimTimingStrip` (and its `text`/`shape`/… twins)

**What it is:** `{prefix}AnimTimingStrip` is created by `createAnimationSectionSpec` (`panel-schemas.js:322`) and filled by `loadTimingStrip` (`AnimationPanelController.js:591-611`). It is a miniature, read-only timeline for the *selected* motion. The track is the document loop; the bar is the run `[delay, min(end, loop))`; the stripes are cycles; the bar is outlined in orange when it doesn't close. The only text is in the tooltip ("Loop 3.00 s"). The hint row below it appears only when the run starts after the loop end.

**Is it intuitive?** Not as it stands:
- There are no labels, so the user can't tell the track is the loop or how long it is.
- There is no playhead, so it can't be connected to what the canvas shows.
- It looks like a button (B7), but clicking does nothing.
- The stripes are misaligned when there is an offset (B8).
- It still shows for a motion that is hidden (`enabled: false`), because `listTimingTargets` returns inactive targets and the strip doesn't check `target.active`.
- It disappears in Automatic mode while an estimate is pending (`loopMs` undefined), so the panel jumps on every edit.

**Recommendation: keep it and make it the panel's transport and overview.** It is not redundant: it is the only view of the run inside the loop when the timeline is closed, and it answers U1 and U2.
1. Build its geometry from the shared row helper (A2) instead of its own `row` literal (removes B7, B8 and B12 together).
2. Add a playhead (subscribe to `animationTicker.subscribeTick` only while the panel is visible) and click/drag to seek (`setPlayback(false); ticker.seek(ms)`, reusing the dock's frame snapping through `TimelineView.nearestFrameStart`). Use `role="slider"` with `aria-valuetext`, as the dock's ruler does.
3. Show the text inline: "0.50 s → 2.50 s of 3.00 s loop" on the left, and the ⚠ seam badge with `seamTitle` text on the right. Drop the tooltip-only presentation.
4. Dim it (not hide it) when the motion or the layer's animations are off. Keep it in place while an estimate is pending (use the last loop length) so the layout doesn't jump.
5. Don't make it draggable. Precise run edits belong to the sliders and the ⋮ menu; a 1-row strip at panel width is too small to edit by dragging.

If the transport idea is dropped, the fallback is to remove the strip and show its information as one line of text ("Plays 0.50–2.50 s of a 3.00 s loop · Seamless") in the existing `TimingHint` note. That removes `loadTimingStrip`, the `TimingStrip` schema row and `.animation-timing-strip` in `css/panels/_effects.scss`.

### 4.3 The easing and motion curve
See B5 and B6. Short version: clip curves to their runs, make the next-pass column a replay of the start of the loop, and tile two cycles for alternating directions. Optionally draw a flat, faint line for the segments where a fill mode holds a pose (`fillMode` backwards/forwards). Today those segments look identical to rest.

### 4.4 `timeline-loop-end`
See B10. The quick win is `gap: var(--spacing-xs)` plus the 1 px line; the clipping fix makes the handle reachable when "Next pass" is off.

### 4.5 General usability

- **U6. Terminology drifts between the panel, the timeline and the menus.** Proposed glossary (panel labels win, since they are what most users see), applied to `DRAG_KINDS`, `TimelineView.rowHint` / `barTitle` / `handleTitle`, `barActions` labels and the panel schema:

  | Concept | Panel | Timeline today | Use |
  |---|---|---|---|
  | `periodMs` | Cycle | Cycle / "stretch the cycle" / "cycle length" | **Cycle** |
  | `delayMs` | Starts at | Starts at / "when it starts" | **Starts at** |
  | `phase` | Start offset | Slip / "Drag to slip" / "quarter" | **Start offset** (verb: "offset") |
  | `iterations` | Repeats: Forever / Count | Repeats / "trim repeats" / "forever" | **Repeats** |
  | run length | (none) | Lasts | **Lasts** |
  | play/pause | Pause motion | Pause motion / Resume motion | Pause / Play motion |
  | snapMode | "Motion" (under Pivot) | — | **Sampling** (under Playback) |

  Also fix `setupAnimationLoop` relabelling "Fit to" as "Loop length" at runtime (`animation-loop.js:72-75`). Put `label: 'Loop length'` in the schema (`panel-schemas.js:436`) and delete the runtime override.
- **U7. Hidden gestures.** Alt-drag to offset, Shift-edge for repeats, cycle notches (only on hover) and the right-click menu appear only in tooltips and the focus-only status hint (`syncHint`). Show `rowHint` on bar *hover* as well as focus. Make the cycle notches visible on the selected bar at a low opacity, not only on hover. Alt also means "no snapping" everywhere except a body drag, where it means "offset": say so in `handleTitle` / `rowHint` ("Alt-drag: offset (snaps to quarters)").
- **U8. Selecting in the timeline is heavy.** A bar click sets the active layer, refreshes the inspector, *opens the flyout* and scrolls the panel (`openRowSection`, `timeline-dock.js:1010-1024`). That makes sense on the first click, but clicking between bars of the same layer keeps re-scrolling the panel. Only call `openRowSection` when the active layer or motion actually changes.
- **U9. Timing ranges don't follow the loop.** "Starts at" goes up to `maxTimelineMs` whatever the loop length. Keep the range, but show the existing "Starts after the loop ends" hint as soon as the value passes the loop.
- **U10. The Repeats field steps by 0.25** (`FIELDS.animIterations.step`), while timeline drags write two decimals. After B3 the display should round to 2 dp and the field should accept any value.
- **U11. Feedback on the result of a commit.** "Fit to loop" and frame options report through `updateStatus`, which is hidden on phones (see CONTRIBUTING). A refit that changes many speeds should also use `beginActivity`, or a short toast through the notify policy.

---

## 5. Architecture and performance

### A1. One loop length
`documentLoop.mode === 'set' ? documentLoop.durationMs : loopEstimate?.duration` is repeated in `syncAnimationLoop` (`animation-loop.js:165`), `getLoopCandidate` (:237) and `loadTimingStrip` (:595). The dock uses `estimate.duration` instead (`buildModel`, :21).
- **Proposal:** add `editor.loopDurationMs()` to `EDITOR_ANIMATION_LOOP_METHODS` and use it everywhere, including `TimelineView.buildModel(estimate, layers, editor)` when an editor is passed.
- **Benefit:** the strip, dock, ticker and fit menus can't disagree about the loop for a frame.

### A2. One row-timing builder
Row geometry (`startMs`, `endMs`, `cycleMs`, `exportCycleMs`, `closes`, `phase`, `direction`) is built in three places:
- `TimelineView.buildModel` (`timeline-view.js:27-46`);
- `loadTimingStrip`'s inline literal (`AnimationPanelController.js:597`);
- the patch-up in `TimelineDock.applyRowEdit` (`timeline-dock.js:1044-1050`).

Each follows different rules for stale estimates (B12).
- **Proposal:** `TimelineView.rowTiming(target, { estimate, loopMs, documentRevision })` returns the timing fields. It uses `resolvedPeriod` and `sourceSeamError` only when `estimate.documentRevision === documentRevision`; otherwise it falls back to the raw period and `closes: null` (unknown, drawn neutral). `buildModel`, the strip and `applyRowEdit` all call it, and `keyPeriod` becomes `rowTiming(...).exportCycleMs`.
- **Benefit:** removes about 30 lines and fixes B7, B8 and B12 together.

### A3. Decide the preview period: natural or export
Today the preview plays `periodMs`, export plays the fitted `resolvedPeriod`, and the timeline draws the export cycles (P4). Two consistent options:
- **(a) Preview plays what export plays (recommended).** `syncLayerAnimationPreview`'s `getData` maps each motion's `periodMs` to `rowTiming(...).exportCycleMs` while the estimate is current. The timeline, preview and export then match exactly, and "Export uses X s" notes only ever appear in the export modal.
- **(b) Keep the natural preview** and mark rows where `exportCycleMs ≠ cycleMs` with a visible badge, not only a tooltip (`TimelineView.exportNote`).

Option (a) changes playback speed by at most the tolerance when the estimate arrives. Guard it with a FEATURES gate and run `tests/parity/preview-export-parity.js`.

### A4. Cache `listTimingTargets`
- **Problem:** `listTimingTargets(editor)` walks every layer and, for `gifCycle`, calls `sceneCompositor.describeAuthoredTiming(layer)`, which builds that layer's export plan and authored descriptors. It runs:
  - in `writeTiming`, twice per call (all layers, then a re-`collect`), so on **every slider tick** of Cycle, Starts at and Start offset in the panel and on every dock drag move;
  - in `buildModel` on every `animationChanged` while the dock is open;
  - in `loadTimingStrip`, `syncGifCycleControls`, `hasMotionForPlayback`, `setPlayback`, `copyTiming`, `startAt`, `endAt`, `animationTimingActions` (which also builds a full `TimelineView.buildModel`) and `_createGifCycleControls`;
  - in `resetAnimationLoop`, once per target (each `restoreAnimationPeriod` calls `listTimingTargets` and then `writeTiming`), which is quadratic in the number of sources.
- **Proposal:**
  1. Memoise per `(documentRevision, lockSignature)`, where `lockSignature` is the `layer.id:locked:visible:animationsEnabled` string the dock already builds in `sync()`. Expose `findTimingTarget(key)` backed by a `Map`.
  2. `writeTiming` asks for one target and re-collects only `[layer]`.
  3. `resetAnimationLoop` collects once and passes the targets in.
- **Benefit:** slider drags no longer depend on layer count; there is one list for every consumer.
- **Risk:** something that changes target fields without bumping `documentRevision` would read a stale entry. Check every writer: `writeTiming` and `renderAnimationLayer` bump it; `HistoryManager.restoreState` bumps it; lock and visibility toggles go into the signature.

### A5. Coalesce dock updates during live edits
- **Problem:** each `animationChanged` runs `TimelineDock.sync` synchronously. Because `documentRevision` changes on every tick, the signature check never short-circuits, so the full path runs:
  - `ruler.replaceChildren()` and a fresh ruler canvas;
  - reconciling every group and row;
  - recomputing curves (64 `sampleAt` calls, each normalising the motion again).
- **Proposal:**
  1. Run `sync` at most once per animation frame (`requestResync` already exists, so reuse it from the `animationChanged` listener).
  2. Rebuild the ruler only when `loopMs`, `scale` or `trackWidth` change; otherwise `paintRuler()`.
  3. Keep the curve cache keyed on what the curve depends on (A2's period plus `run.start` and `direction`).
- **Benefit:** smooth panel drags with the dock open.

### A6. Use the prepared form on the export sampling path
- **Problem:** the preview samples through `GlitterAnimation.prepare` (normalised once, `channelKeys` pre-split). Export samples each source with `GlitterAnimation.sampleAt({ ...animation, periodMs: period }, t, ctx)` (`SceneCompositor.js:239`), which runs `normalizeAnimation` (spread, preset merge, `normalizeKeys` sort) and the `keys.filter` per channel *on every frame*. `_sampleLayerAnimation` (:420-425) does the same for each layer.
- **Proposal:** prepare once per source in `_createLayerAnimationTimelineSources`, and cache the prepared entry per `period`, since the period changes only when the planner tries a fit. Sample with `samplePrepared`-style per-entry calls. Output is unchanged; export parity must stay byte-identical.

### A7. Lighter panel loads
- `load()` calls `_syncSummary` twice (:518 and :582). Each call runs `isSeamlessLoop` and `travelSpeed` (48 samples, each of which normalises again). Keep only the call at :582.
- The easing `<option>` SVG previews are rebuilt for both selects on every load (:584-588). Rebuild them only when `data.steps` changes; remember the last value on the control.
- `_renderStack` rebuilds every row on every load (P1). Use `reconcileKeyedChildren`, which the dock already uses, keyed on the motion id.

### A8. Remove dead and legacy code
| Item | Where | Note |
|---|---|---|
| `curveInputs` (a `JSON.stringify` of every motion on every model build; never read) | `timeline-view.js:61`, :87 | Delete. |
| `TimelineView.modelSignature` (used only by a unit test; the dock builds its own string) | `timeline-view.js:86-88`, `tests/unit/timeline-view-unit.js:26` | Delete, and assert on `buildModel` output instead. |
| `TimelineView.keyEntry` (unused) | `timeline-view.js:211` | Delete. |
| `keyToTime`'s `untimed` flag (always `false`) and `.is-untimed` toggling | `timeline-view.js:223-225`, `timeline-key-lane.js:76` | Left over from eased key mapping; delete. |
| `row.originalPeriod` (set in the model; no UI reads it) | `timeline-view.js:38`, unit test :99 | Delete, or use it for the "Before" display if A2 lands. |
| `_createDefault` (unused) | `AnimationPanelController.js:295` | Delete. |
| About 25 pass-through methods on `AnimationPanelController` (`selectMotion`, `addKey`, `deleteKey`, `setPaused`, …) that only forward to `editor.*`; their callers are tests and tools (`tests/ui/*`, `tools/ui-states.js`, `tools/ui-ab.js`, `js/core/sessions.js`) | `AnimationPanelController.js:17-104`, :204-208, :295-305 | Move callers to the `editor.*` methods, then delete. Keep `prefixByType`, `load`, `syncKeyAdd`, `paintKeyAdd`, `conversion` (used by the dock). |
| `restoreAnimationPeriod` called twice for "Reset timing" from the dock | `timeline-dock.js:1089` plus `animation-edit.js:399` | Remove the dock's call. |
| `keyCycle` computed twice in `refresh` | `timeline-key-lane.js:58` and :65 | Delete the first. |

---

## 6. Prioritised implementation plan

Order is by impact per effort. Each step is self-contained and can be reviewed and shipped on its own. Steps that change rendered pixels are marked **[pixels]**.

### P0 — correctness, small
1. **B1: delay and offset start time, and the backwards hold pose [pixels].** Change `progressAt` only. Tests: new unit cases in a GlitterAnimation unit file (delay 500 / offset 0.5 for each fill mode: `tx` before 500 is the rest pose or the pose at progress 0.5; at ≥ 500 it is unchanged). Run `parity/animation-parity.js`, `parity/preview-export-parity.js`, `ui/animation-loop-verify.js` and `ui/preview-motion-verify.js`; update baselines only where a fixture uses delay plus offset, and note that in the commit.
2. **B2 + B3 + B4: run precision and slip that keeps the end.** Files: `animation-timing.js` (phase write keeps the end), `animation.js` (`iterationsForRun` without `toFixed(2)`), `timeline-view.js` (`runFromRightEdge`/`durationFromEdge` clamp to the minimum), `timeline-dock.js` (`paintDrag` draws the stored run). Tests: extend `unit/animation-timing-unit.js` (end preserved across a phase write; 1333.3 ms round-trips within 1e-6; requested < 0.25 cycles clamps the same in the drawing and the store). Extend `ui/timeline-gestures-verify.js` (an offset drag on a finite bar leaves `endMs` unchanged after release; a right edge snapped to another bar's edge stays equal after commit).
3. **B13: key seek outside the run.** A fallback in `timeAtProgress`. Test: in `ui/animation-without-timeline-verify.js`, seek before a delayed Custom motion, call `selectKey(..., { seek: true })`, and assert the playhead is inside the run and `addKey` adds a key.
4. **B10 (1–4, 6): loop-end spacing and alignment.** SCSS plus the CSS variable. Check: `tools/ui-contact-sheet.js` before and after for Ryan, then a `css/style.css` recompile.

### P1 — the timeline shows what plays
5. **B6: next-pass replay** (`TimelineView.nextPassBox` plus `layoutRow`), with curves clipped to the true run width. Tests: `unit/timeline-view-unit.js` geometry (delayed infinite row → ghost starts at `loop + start`; finite row inside the column → its own width; a run starting after the share → no ghost). A contact sheet with "Next pass" on.
6. **B5: two-cycle curve tile for alternating directions.** Test: `unit/timeline-view-unit.js`, where `motionCurve` for `alternate` returns `cycles: 2` and the second half of the polyline mirrors the first.
7. **B10 (5): reserve a next-pass gutter so the loop handle is always reachable.** Test: in `ui/timeline-gestures-verify.js`, with `timelineShow.nextLoop = false`, drag `.timeline-loop-end` and assert the loop length changes.
8. **B11: seam wording and a truncation mark.** Unit test the `seamTitle` branches.

### P1 — the panel stands on its own
9. **A1 + A2: `loopDurationMs()` and `TimelineView.rowTiming`**, replacing the three row builders. This is the prerequisite for step 10. Tests: the existing `unit/timeline-view-unit.js` must pass unchanged, plus a stale-estimate case (`documentRevision` mismatch → raw period, `closes: null`).
10. **§4.2: rebuild the Timing strip** as transport and overview (label, playhead, click/drag to seek, play/pause, seam text, dimmed when off, stable while pending). This fixes B7, B8 and U1, and covers U2 with a loop link. Tests: extend `ui/animation-without-timeline-verify.js` (desktop and phone) — clicking the strip pauses and seeks, the readout matches `getPlayheadTime()`, the loop link opens Animation loop, `!e.timelineDock` still holds. Recapture the `ui/panel-parity.js` baseline for the strip row.
11. **U4: one seam judgement** — the LoopHint uses `rowTiming(...).closes`.
12. **B9: Steps visible for Step sampling; move Sampling to Playback.** Panel schema plus `load()`. Recapture panel parity.

### P2 — performance
13. **A4: memoised `listTimingTargets` and `findTimingTarget`**; quadratic `resetAnimationLoop` → linear. Test: a unit test with a counting `describeAuthoredTiming` stub, asserting one call per layer per revision across `writeTiming` × 10 ticks. All of `unit/animation-timing-unit.js` and `ui/animation-without-timeline-verify.js`.
14. **A5: rAF-coalesced dock sync; rebuild the ruler only on geometry changes.** Run the full `ui/timeline-gestures-verify.js` and `ui/timeline-keys-verify.js`.
15. **A6: prepared sampling in export sources.** Run `parity/export-parity.js` (must stay byte-identical) and the export fragility check from CONTRIBUTING (animated sticker, export, edit, undo, export, export).
16. **A7: lighter panel loads** (single `_syncSummary`, cached easing previews, reconciled stack rows → also fixes P1). Run `ui/layer-reorder-transform-verify.js` (stack reorder) and a keyboard check for P1.

### P2 — UX polish and cleanup
17. **U6 glossary pass** on labels and tooltips, plus the "Loop length" label in the schema. Rebuild the guide if any `PANEL_SCHEMAS` titles change (`node tools/build-modals.js`), then run `ui/panel-parity.js`.
18. **U5: shared add-animation menu**; **U7: hover hints and visible notches on the selected bar**; **U8: open the panel section only when the active row changes**; **P3: don't re-expand on value edits.**
19. **A8: dead-code removal**, including moving tests and tools off the `AnimationPanelController` pass-throughs.
20. **Decide A3** (preview period) and **P5** (type change keeps the cycle) with Ryan. Both change behaviour on purpose.

### Afterwards
- Check P2 (rest pose) in the browser; if confirmed, add an explicit rest paint in `AnimationTicker._paintEntry`.
- Fold what is still true into `docs/ARCHITECTURE.md` (timing ownership: `writeTiming` → kinds; `rowTiming` as the one view of a row's timing; `loopDurationMs`). Move this plan to `docs/!old/` when done, per the plan lifecycle in CONTRIBUTING.

---

## 7. Validation checklist (each step)

- `npm run lint` clean; `node tools/build.js` after JS changes (`--check` in CI); `node tools/build-shell.js` only if `COMMANDS` or `TOOLS` change.
- The smallest covering suites as listed per step, run once after the final change. Export parity only for steps 1, 2 and 15 (the frame/timeline and effect-source rules in CONTRIBUTING).
- **Invisible styling changes** (part of step 4, step 17): `node tools/ui-ab.js` shows zero computed-style differences outside the intended selectors. **Visible ones** (steps 4, 5, 7, 10, 12): a `tools/ui-contact-sheet.js` before/after page for Ryan, and a note that `css/style.css` needs a recompile.
- Manual regression pass, on desktop and at 390 px:
  1. Add Pulse to a sticker. Set Starts at 0.5 s and Start offset 50 %. Nothing moves before 0.5 s on the canvas, in the strip, in the timeline or in an exported GIF.
  2. Set Repeats 2 and offset the bar in the timeline: its end stays put. Drag its right edge onto another bar's edge, release and reopen the project: the edges still coincide.
  3. Choose Alternate: the curve mirrors on every other cycle. Toggle "Next pass": the column replays the start of the loop, and the loop handle stays draggable with it off.
  4. With the timeline closed, use only the panel: scrub the strip, step with `,`/`.`, select a key of a delayed Custom motion (the playhead jumps inside), add a key, Fit to loop through the link, Undo/Redo each step.
  5. Export twice in a row and after edit → undo: byte-identical (the export fragility test).

---

## 8. What stays as it is

- The registry-driven timing writes (`ANIMATION_TIMING_KINDS`), the single evaluator, the feature-gated lazy timeline group, and dock-independent editor operations are the right shape. None of the steps above adds a new abstraction layer beyond two small helpers (`loopDurationMs`, `rowTiming`) and a memo.
- Stored data formats stay as they are (`iterations`, `delayMs`, `phase`, `loopOriginalPeriods`). The only intended changes to saved-project behaviour are B1 (pre-start rendering, a bug fix) and, if Ryan agrees, A3 and P5.

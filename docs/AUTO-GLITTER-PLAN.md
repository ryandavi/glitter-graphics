# Auto Glitter v2 — Live Preview Session + Vectorizer-Grade Color Analysis

Date: 2026-07-17. Status: awaiting dispatch.
Scope: `js/classes/AutoGlitterManager.js`, `js/workers/auto-glitter.worker.js`, `tests/auto-glitter-analysis.js`, `index.html` (modal → panel), `js/core/config.js`, `css/style.scss` partials, `modals/guide.html`.

Decision tags: **[Ryan]** = Ryan asked for it, **[measured]** = observed in the code, **[rec]** = Fable recommendation — push back freely.

---

## 1. Audit findings

### UX
- **[Ryan]** The posterization preview sits below the match rows inside a scrolling modal body — you have to scroll to see it, and every palette tweak means scrolling back down.
- **[Ryan]** The modal (`#autoGlitterModal`) blurs/blocks the canvas, so the user never sees actual glitter until after "Create Layers". The preview canvas shows flat posterized color only.
- **[measured]** `updatePreview()` (app.js:6545) renders whatever is in `editor.layers` through the real managers, and `AutoGlitterManager.createLayers()` already builds fully real glitter layers with painted masks. A live animated preview therefore needs **no new rendering code** — insert the generated batch as ephemeral layers and let the existing DOM pipeline show it.
- **[measured]** Every option change (palette style, hue toggle, rerun mode) re-runs the *entire* analysis — new `Worker`, re-sampling, full k-means, full-image labeling. Nothing is incremental, so a live "colors" slider is currently impossible.
- **[measured]** `AutoGlitterManager.close()` doesn't close anything — it cancels the in-flight analysis. Naming debt to fix during the refactor (rename to `cancelAnalysis()`).

### Algorithm (worker)
Pipeline today: uniform-sampled k-means in OKLab (chroma-boosted k-means++ seeding, 2× over-segmentation) → full-image nearest-centroid labeling → connected-component metrics → greedy threshold merge with neutral/highlight/coherence heuristics → importance-driven reduction down to requested count → swatch matching.

- **[Ryan]** Anti-aliased edges become their own palette color (grey AA ring around black text becomes "grey"). This is the exact Illustrator Image Trace failure Ryan called out as the thing to avoid — Trace promotes edge-blend pixels into "logical" colors. **[measured]** Our pipeline has the same blind spot: nothing recognizes that edge pixels are *mixtures* of two adjacent region colors — the component-density heuristics only indirectly punish fragmented clusters, and a thick AA band along long text edges is coherent enough to survive.
- **[Ryan]** Similar colors sometimes stay separate. **[measured]** Root cause: the threshold-merge loop only merges pairs under `similarityThreshold` (0.045 OKLab for chromatic pairs); the second loop only shrinks the palette *down to* the requested count. So when the image has fewer logical colors than the requested count, near-threshold similar pairs survive to fill the budget. Requested count acts as a filler target, not a maximum.
- **[measured]** No spatial cleanup: dithered/noisy images produce salt-and-pepper masks (scattered single-pixel components keep their cluster label). Vectorizers solve this with a despeckle / minimum-region pass.
- **[measured]** Worker is torn down after each run; over-segmented labels and candidate centroids are discarded even though only the (cheap) reduction stage depends on the user-tunable options.

---

## 2. Target design

### 2.1 UX: non-modal panel session, canvas is the preview **[decided 2026-07-17]**

Ryan approved the panel-session direction ("whatever best practice is for best UX", desktop + mobile both required; his "drawer" mention was about the canvas fitting the remaining space, not about the drawer widget specifically). **[Ryan]** Guiding principle: the happy path must be *open → look at the live result → click Create*; every knob exists for advanced users but none of them stand between the user and the OK button. Concretely: Create Layers is the single prominent primary action, always visible (sticky footer, never below a scroll); style presets are one tap; sliders and cleanup toggles live lower / in the collapsed Advanced card.

Replace the modal with an **Auto Glitter session in the design panel** (same column that hosts all "Settings"/"Properties" sections), built through `PANEL_SCHEMAS` + `js/ui/panel-renderer.js` primitives. The canvas stays fully visible and *is* the preview. On mobile, the section rides the existing `mobileSettingsSections` drawer mechanism for free.

Why not the draggable-floating-modal option Ryan also floated: it would be a new one-off chrome component (drag, viewport clamping, z-order, touch) that nothing else uses, whereas the panel session reuses the design system end to end and matches how Figma surfaces plugin/tool UI. If Ryan prefers the floating window after trying the panel, the session logic below is UI-agnostic — only WP-D would change.

Session flow:
1. "Auto Glitter" button (Base Image properties, unchanged id `autoGlitterImageBtn`) opens the session: design panel swaps to the **Auto Glitter** section, analysis starts immediately (as today).
2. Analysis completes → generated layers are inserted as an **ephemeral batch** and the canvas shows real animated glitter immediately.
3. Every control change updates the batch live (see 2.3 for what's cheap vs. expensive).
4. Footer action row: **Cancel** (remove batch, restore panel) / **Create N Layers** (commit: keep layers, `renderLayersList`, `saveState`, close session). Session also commits nothing if the user navigates away — treat panel exit as Cancel.

Panel layout (top → bottom, composed from existing `tpl-*` primitives):
- **Preview** segmented control, pinned at top: `Original | Flat | Glitter` (default Glitter).
  - *Glitter*: ephemeral layers visible as-is.
  - *Flat*: same layers with their fill slot temporarily set to solid palette color — reuses the existing glitter/solid paint-slot modes, giving the old "posterized" view on the real canvas with zero custom preview code.
  - *Original*: ephemeral layers hidden.
- **Rerun choice** (only when a previous batch exists): existing Replace previous / Keep and add segmented control, unchanged logic.
- **Palette** card: style segmented control (Vibrant/Balanced/Natural), **Colors** slider (live, 2–12), **Combine similar** slider (merge distinctness, see 2.2).
- **Color Matches** list: existing `tpl-auto-glitter-match` rows (swatch, coverage, glitter choice, drag-to-combine). Moves out of the modal. One new affordance **[rec]**: a per-row **Skip** toggle (eye icon, layer-list pattern) that excludes that color from layer creation — its pixels simply get no layer. Today you can merge colors but not drop one, and the Blingee workflow (see 2.5) routinely wants the background color excluded. Skipped rows grey out; the ephemeral preview layer hides live; Create N updates.
- **Advanced** collapsed card: Detail slider (min region size / despeckle), Clean edges toggle (alias dissolve, default on), Tune Matched Glitter Hue toggle (existing).
- Footer: Cancel / Create N Layers.

History rule: **undo/redo is disabled while the session is open** (the modal blocked them anyway, so this is parity, and it keeps ephemeral layers out of history entirely). Ephemeral layers must be excluded from `saveState`, export, and the layers list until commit.

No-flicker rule applies: when palette results change, **reconcile** the ephemeral batch — reuse existing layer objects per palette root (update their mask pixels + fill), only add/remove layers whose root appeared/disappeared. Recreating a layer restarts its GIF.

### 2.2 Algorithm: think like a vectorizer

Three additions, all in the worker, all covered by node tests:

1. **Edge-aware clustering.** Compute a local gradient magnitude (OKLab distance to right/down neighbors) during sampling; weight samples by inverse gradient so cluster centroids are defined by region *interiors*, not blend pixels. AA pixels still get labeled (nearest centroid), they just stop pulling centroids toward mixtures.
2. **Alias dissolve pass** (post-reduction, "Clean edges"). A palette entry is an *alias artifact* if (a) its centroid lies close to the line segment between two other centroids in OKLab (mixture test), and (b) its pixels predominantly sit on the boundary between those two clusters (adjacency test — count 4-neighborhood contacts per neighbor label; thin/low-density components, metrics already exist). Dissolve it: reassign each of its pixels to whichever endpoint cluster dominates its local neighborhood (fall back to nearer centroid). This is the "grey AA on black text" fix — the grey is a black↔background mixture that lives only on their shared edge.
3. **Despeckle** ("Detail"). After labeling, components smaller than N pixels (default from CONFIG, scaled by image area; slider in Advanced) are absorbed into their dominant neighboring label. Kills salt-and-pepper masks from dither/noise, same as Image Trace's Noise setting.

Merging fix **[Ryan]**: make the requested count a **maximum**, not a target. Replace the fixed `similarityThreshold` stop with a distinctness floor: keep merging the closest pair while its OKLab distance is below `mergeDistinctness` (user's "Combine similar" slider, style presets provide defaults), *then* apply the count cap by importance as today. Two reds that read as one color merge even when the budget has room.

### 2.3 Worker: two-phase protocol, keep-alive

Split `analyzeImage` into cached phases so sliders can be live:

- **Phase 1 — segment** (expensive, runs on image/maxSamples change only): opacity scan, gradient map, weighted sampling, over-segmented k-means (fixed candidate count, e.g. 24), full-image raw labeling, component metrics. Cached in the worker.
- **Phase 2 — reduce** (cheap, runs on every option change): palette reduction with current options (distinctness, style, count), alias dissolve, despeckle, swatch assignment. Returns `labels` + `palette` as today. Must be fast enough for slider `input` events on a 24k-sample cache (throttle in the manager if needed).

Protocol: `{ type: 'segment', pixels, width, height, options }` → `{ type: 'segmented' }`; `{ type: 'reduce', options, swatches, colorCount }` → existing result shape. Worker stays alive for the whole session; `cancelAnalysis()` bumps the request id instead of terminating. Phase 2 responses carry the request id so stale results are dropped (pattern already exists via `analysisId`).

Config: new keys live under `CONFIG.tools.autoGlitter` (`analysis.candidateCount`, `analysis.gradientWeight…`, `cleanup: { aliasDissolve…, despeckle… }`, `defaults.mergeDistinctness`, slider limits). No inline `??` fallbacks.

### 2.4 Automatic swatch color-shifting (hue tune): keep, but make it legible **[decided 2026-07-17]**

Ryan asked whether the automatic swatch hue-shifting should be removed from auto mode, and how a user alters an auto-applied shift while running the editor. Answer: **keep it** — with a finite glitter library it's what makes a teal region land on a recolorable blue glitter instead of a bad literal match — because it is *not* a special mechanism:

- **[measured]** The tune is written as plain `layer.settings.colorAdjust` (`createLayers`), which is the same field the normal editor already exposes as the Advanced Hue/Saturation/Brightness sliders in Glitter Properties (`advancedIds` at config.js:976) and which export mirrors pixel-exactly. After commit, an auto-tuned layer is indistinguishable from one the user tinted by hand — select the layer, open Advanced, drag Hue. Nothing new to build.
- In-session legibility: the match row already badges the shift ("Glitter · Hue +12°") and the live canvas preview now *shows* it, which removes the invisible-magic problem the old flat preview had. Manually picking a glitter in the row clears the auto shift (existing behavior, keep).
- The global **Tune Matched Glitter Hue** toggle stays in Advanced for users who want only literal library colors; flipping it re-runs the cheap reduce phase live.
- Deliberately not adding per-row tint sliders in the session **[rec]** — that's what Glitter Properties is for after commit; the session stays a matching/review surface.

### 2.5 Blingee-style sources: what "good results" means here

The target aesthetic is 2000s Blingee/MySpace glitter graphics: flat, saturated art or text, hard edges, chunky animated glitter fills, frequently black outlines, and source images that are old GIFs/JPEGs. That implies concrete requirements for the algorithm WPs:

- **Thin black outlines must survive** cleanup. Outline pixels are boundary-located and thin — the adjacency test alone would flag them — so the *mixture* test is what protects them (black is not an OKLab blend of the regions it separates). WP-B must include a test fixture: flat-color cartoon regions separated by 1–2px black outlines → outline keeps its own layer, no dissolution, no despeckle absorption.
- **Dirty sources are the norm**: GIF dithering and JPEG ringing behave exactly like AA (mixture pixels / scattered speckles). The alias-dissolve + despeckle passes are the fix for both; WP-B's noise fixture should use dither-like patterns, not just clean synthetic dots.
- **Background exclusion**: most Blingee-style pieces glitter the subject, not the backdrop. With the per-row Skip toggle (2.1) the user handles this in one tap; auto-*detecting* the background (dominant border-touching color, default its row to skipped) is deferred **[rec]** — cheap to add later on top of Skip, but wrong guesses would undermine trust in the one-click path.
- **Hard edges already match the aesthetic**: masks are binarized (`crispMaskEdges`), feather forced to 0 — keep.
- Small vivid accents (eyes, hearts, sparkles) are already importance-protected; existing tests keep guarding that.
- Deferred idea **[rec]**: auto-scale glitter texture per layer so tiny regions don't get one giant glitter chunk (`settings.scale` by region area). Revisit after v2 ships.

### 2.6 What stays

Batch metadata / edited-set detection, replace-vs-add capacity logic, drag-to-combine + Separate, swatch matching + hue tuning, `tpl-auto-glitter-match`. The modal markup at index.html:1623 is removed once WP-D lands (guide.html updated in the same WP).

---

## 3. Work packages

**Dispatch (updated 2026-07-17): WP-C is DONE (Fable). WP-A → WP-B → WP-D run as ONE Codex session, in that order** — A and B are worker-only, D consumes both the new reduce protocol and the WP-C session API documented below. Do not modify the session semantics (isPreview exclusions, markPaintTransient vs commitPaintState split, undo gating) — build on them.

Do-not-touch (all WPs): never edit `css/style.css`/`.map` (SCSS only, Ryan compiles); no `ctx.filter`; LF + tabs; bump `?v=` on every JS file edited; `dbg()` not `console.log`; run `node tests/auto-glitter-analysis.js` and `node tests/export-parity.js` before finishing. **Known-broken baseline:** `tests/touch-smoke.js` and `tests/touch-handle-verify.js` currently fail extensively on a clean HEAD checkout (verified 2026-07-17 against an isolated HEAD worktree — `#stickerScale` missing, transform-handle waits time out; unrelated to Auto Glitter). Don't chase those failures and don't treat them as caused by this work; just don't make them worse (no edits to touch/transform code are in scope anyway).

### WP-A (Codex) — worker two-phase split + keep-alive

> In js/workers/auto-glitter.worker.js, split `analyzeImage` into a cached two-phase protocol without changing analysis results: Phase "segment" (message `{type:'segment', requestId, pixels, width, height, options}`) does the opacity scan, sampling, k-means over-segmentation with a fixed candidate count from options, full-image raw labeling, and connected-component metrics, caches `{rawLabels, centroids, counts, rgbTotals, componentMetrics, width, height, visiblePixelCount}` in module state, and replies `{type:'segmented', requestId, visiblePixelCount}`. Phase "reduce" (message `{type:'reduce', requestId, colorCount, options, swatches}`) clones the cached raw labels, runs `reducePalette` + `assignSuggestedSwatches` with the given options, and replies `{type:'result', requestId, labels, palette, visiblePixelCount}` transferring the labels buffer. Errors reply `{type:'error', requestId, error}`. In js/classes/AutoGlitterManager.js, keep one worker alive for the whole modal lifetime: `analyze()` sends "segment" once per image (track a dirty flag on open), then every option change sends only "reduce"; drop responses whose requestId is stale; terminate the worker in `handleModalClose()` (already the modal's onClose hook) instead of per-run — note `cancelAnalysis()` (already renamed from `close()`, don't redo) currently terminates per run and must stop doing so. Update tests/auto-glitter-analysis.js to drive the new message protocol (segment then reduce per case) and assert identical behavioral expectations; add a case asserting that two successive "reduce" calls with different colorCount reuse one "segment" and both return correct label arrays. Bump the worker's `?v=` in AutoGlitterManager and AutoGlitterManager's `?v=` in index.html. CONFIG: move the candidate sizing (`candidateMultiplier`/`candidatePadding`) to a fixed `analysis.candidateCount` (default 24) in js/core/config.js — with a fixed over-segmentation the reduce phase alone can honor any requested count from 2–12.

### WP-B (Codex, after WP-A) — vectorizer-grade cleanup + distinctness merging

> In js/workers/auto-glitter.worker.js, improve the analysis to stop anti-aliasing and noise from becoming palette colors. (1) Edge-aware sampling: during the segment phase compute per-pixel gradient magnitude as the max OKLab distance to the right and down neighbors; weight each k-means sample by `1/(1 + gradient*options.gradientWeight)` (weighted centroid updates), so blend pixels stop pulling centroids. (2) Alias dissolve (reduce phase, after the merge loops, gated by `options.cleanup.aliasDissolve.enabled`): for each palette entry X, find the pair (A,B) minimizing X's OKLab distance to the segment A–B normalized by |A–B|; compute X's boundary fraction = share of X's pixels 4-adjacent to A or B pixels. If mixture distance < `maxMixtureDistance` and boundary fraction > `minBoundaryShare` and X's pixel share < `maxShare`, dissolve X: relabel each X pixel to whichever of A/B dominates its 8-neighborhood, falling back to the nearer centroid; fold X's counts into the receivers and drop it from the palette. Iterate until no entry dissolves. (3) Despeckle (gated by `options.cleanup.despeckle`): relabel connected components smaller than `minRegionPixels` (CONFIG default, scaled: `max(absMin, area*shareMin)`) to their dominant neighboring label. (4) Distinctness merging: in `reducePalette`, replace the fixed `similarityThreshold` stop for chromatic pairs with `options.mergeDistinctness` (the neutral/highlight/coherence modifiers still scale it), and keep the requested-count reduction as a cap afterwards — requested count becomes a maximum, not a filler target. Add all new tunables under CONFIG.tools.autoGlitter (`analysis.gradientWeight`, `cleanup.aliasDissolve.{enabled,maxMixtureDistance,minBoundaryShare,maxShare}`, `cleanup.despeckle.{enabled,absMin,shareMin}`, per-style `mergeDistinctness` in paletteStyles) — no inline fallbacks. Extend tests/auto-glitter-analysis.js: (a) black text glyphs on white with a 1px grey AA ring must yield a 2-color palette with the grey pixels absorbed and every AA pixel labeled black or white; (b) dither-like scattered 1–2px noise (checker/ordered pattern, not just random dots) must not survive as a palette color and must not punch holes in the surrounding mask; (c) two reds within mergeDistinctness must merge even when colorCount leaves room; (d) outline protection — flat cartoon regions separated by 1–2px black outlines must keep the outline as its own palette color: the mixture test must not classify it as an alias (black is not an OKLab blend of its neighbors) and despeckle must not absorb it (it is one large connected component); (e) all existing assertions still pass (retune style preset values if the distinctness change requires it, keeping the Vibrant>Natural neutral-combining relationship). Bump the worker `?v=`.

### WP-C (Fable) — ephemeral batch session — **DONE 2026-07-17**

Shipped and verified (23-check headless probe + export-parity suite green). The session lives in `AutoGlitterManager`; the API WP-D consumes:

- `isSessionActive()` — true from modal open until commit/cancel; gates undo/redo (`HistoryManager.canUndo/canRedo`).
- `reconcileSession()` — syncs the ephemeral batch to `this.result`; runs automatically at the end of `renderReviewResults()`, so any change that re-renders the match rows is already live. Reuses layer objects positionally (no-flicker); only masks whose membership signature changed are rewritten; uses `GlitterManager.markPaintTransient` (version bump, **no** paintHistory snapshot) so slider-speed reconciles don't spam snapshots.
- `setSessionPreviewMode('glitter' | 'flat' | 'original')` — flat = solid palette-color fills, original = batch hidden.
- `setColorSkipped(paletteIndex, skipped)` — excludes a color from creation, preview layer hides live; Create count/status update.
- `createLayers()` — commits: skipped layers removed, kept layers lose `isPreview`, get `commitPaintState` (real paintHistory snapshot) + batch metadata, one `saveState`. `handleModalClose()` (wired to the modal's onClose) cancels: previous-batch visibility restored, resources released, history untouched.
- "Replace previous" now previews for real: the old batch hides while replace is selected, restores on cancel/switch to add.
- `layer.isPreview` exclusions are in: history snapshots + `canUndo/canRedo` (HistoryManager), `renderLayersList`/`updateLayerCount` (LayerManager), `exportAnimatedGif` (app.js), `ProjectSerializer.serialize`, and Auto Glitter's own capacity math. `GlitterManager.createLayer({ skipLimitCheck })` added for the transient overlap with a to-be-replaced batch.
- The old `close()` was renamed `cancelAnalysis()` (WP-A prompt updated — don't redo).

Known WP-D-scope leftovers: the modal still blurs the canvas (the whole point of WP-D); on analysis *error* the previous result's batch stays visible behind the modal; `updatePreview` honors the user's show-all-layers toggle, so a solo-layer view hides the batch (WP-D should force show-all during the session or note it).

### WP-D (Codex, after WP-C) — panel session UI, modal removal

> Convert Auto Glitter from the #autoGlitterModal modal into a design-panel session section following docs/!old/LAYER-TYPE-CONTRACT.md conventions: add a PANEL_SCHEMAS entry (id `autoGlitterSettingsSection`, title "Auto Glitter") composed from tpl-* primitives via js/ui/panel-renderer.js — never copy live sidebar markup — containing: a pinned Preview segmented control (Original | Flat | Glitter, default Glitter) wired to `AutoGlitterManager.setSessionPreviewMode('original'|'flat'|'glitter')`; the existing rerun segmented control (replace/keep) when a previous batch exists; a Palette card with the style segmented control, a live Colors slider (2–12, CONFIG limits) and a Combine Similar slider (mergeDistinctness range from CONFIG) both driving the worker "reduce" phase on input (throttled); the Color Matches list reusing tpl-auto-glitter-match with unchanged drag-to-combine/Separate/glitter-picker behavior plus a per-row Skip visibility toggle (layer-list eye pattern) wired to `AutoGlitterManager.setColorSkipped(paletteIndex, skipped)` (row greys out, ephemeral layer hides, Create N count updates — the session handles all of it); a collapsed Advanced card with Detail slider (despeckle), Clean Edges toggle (alias dissolve) and the existing Tune Matched Glitter Hue toggle; and a footer action row Cancel / Create N Layers (N live-updating). Opening: `autoGlitterImageBtn` starts the session, swaps the design panel to this section, and starts analysis; Cancel, Escape, or navigating to another layer/tool cancels the session via `AutoGlitterManager.handleModalClose()` (rename it `endSessionUI()` or similar once the modal is gone); Create calls `createLayers()` (which commits + saves history) and returns to Base Image properties; force the show-all-layers view during the session so a solo-layer view can't hide the live batch. Register the section in LAYER_UI_CONFIG including mobileSettingsSections so the mobile Edit drawer picks it up. Remove #autoGlitterModal markup and its ModalManager registration; keep tpl-auto-glitter-match. Move/adapt the auto-glitter styles from css/_modals.scss into css/_panels.scss under the section, SCSS only (do not touch css/style.css), reusing existing tokens/mixins. Mirror the new panel title and workflow in modals/guide.html. Bump `?v=` on every JS file touched and `style.css?v=` in index.html after noting SCSS needs recompiling by Ryan. Verify with node tests/touch-smoke.js and node tests/touch-handle-verify.js.

---

## 4. Decisions log (§4 questions answered 2026-07-17)

1. Panel session vs. floating window → **panel session** (Ryan: "whatever best practice is for best UX", desktop + mobile; his drawer mention was about canvas-fits-remaining-space behavior, which the panel gives on desktop and the Edit drawer gives on mobile).
2. Ephemeral layers in the layers list → **hidden until commit** stands **[rec]** — the Color Matches rows *are* the layer list during the session, and undo/redo is disabled anyway. Revisit if Ryan misses it in testing.
3. Advanced surface → confirmed minimal: Combine Similar + Detail + Clean Edges + Tune Hue. No samples/quality knob. **[Ryan]** One-click OK path is the priority; advanced customization must never obstruct it.
4. Swatch hue-shifting in auto mode → **kept**, see 2.4 (it's plain `layer.settings.colorAdjust`, editable post-commit via existing Glitter Properties Advanced sliders).

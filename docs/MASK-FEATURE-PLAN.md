# Glitter Mask Feature — Implementation Plan

**Date:** 2026-07-02 · **Status:** Planned, not started
**Companion docs:** `docs/AUDIT.md` (Phase 0 depends on audit items M1/M2, done) · `docs/TEXT-GLITTER-PLAN.md` (independent feature, queued after this one — see its "Relationship to the mask feature" note)

**If text-glitter lands first:** the type-switch chains this plan touches (`app.js` visibility filters, `HistoryManager.createStateSnapshot`/`restoreState`, `LayerManager` per-type branches) will already have a `TEXT_GLITTER` case alongside the existing ones — add the glitter-mask changes as siblings to it, don't assume a blank switch statement.

## Product model (agreed)

- One glitter swatch per layer; one editable bitmap mask per glitter layer.
- Multicolor artwork = stacked glitter layers, reordered in the existing layer list.
- Mask editing = **Add** and **Subtract** br
ush only. No lasso/polygon/pen/vector, no nested masks, no blend modes.
- Each layer keeps its own swatch, scale, opacity, mask, feather/invert.
- Undo/redo: one history entry per stroke; Clear/Invert also create entries.
- Export uses the exact same mask data as preview.

---

## 1. Core design decision: paint composites over color-pick

Today a glitter layer's mask is **derived** live from `layer.selections` (color picks) by `GlitterManager.createMaskForLayer()` — threshold/feather sliders re-derive it on every change. Painting must not destroy that.

**The final mask is a composite:**

```
finalMask = invert?( clamp( selectionMask ∪ paintAdd − paintSubtract ) )
```

- Color picking keeps working exactly as today (magic-wand-style base), threshold stays live.
- Brush **Add** unions painted coverage in; **Subtract** cuts coverage out of *everything* (paint and color-picked areas alike) — this satisfies "Subtract erases glitter out".
- A layer with zero selections and only paint is now valid ("new glitter layer starts with an empty mask → paint it").
- This is what the spec means by "keep existing glitter layer appearance logic and apply the painted mask on top of it."

**Why not bake color picks into the bitmap?** It would kill live threshold adjustment and break every existing composition in history/undo. The composite model is strictly additive to the current system.

## 2. Storage

Paint data lives in **`GlitterManager.paintMasks: Map<layerId, PaintMask>`** — *not* on the layer object, because `saveState()` deep-clones layers via `JSON.parse(JSON.stringify(...))` and canvases/typed arrays must never enter that path.

```js
PaintMask = {
  add: HTMLCanvasElement,   // alpha = painted-in coverage
  sub: HTMLCanvasElement,   // alpha = painted-out coverage
  version: number,          // increments per committed stroke/op
  bounds: {x,y,w,h} | null  // dirty union, for overlay optimization (Phase 3)
}
```

- Lazily allocated at base-image dimensions on first stroke. `undefined` = never painted → zero cost / zero behavior change for existing layers.
- The **serialized layer state** (history snapshots) stores only `maskVersion: number`. A per-layer ring buffer of copy-on-write snapshots maps versions to pixel state (see §6).
- Lifecycle owned by GlitterManager: `deleteLayer` → drop entry; `cloneLayer` → deep-copy both canvases; `clearImage` → clear map.

## 3. Shared mask pipeline — `MaskCompositor`

New file `js/classes/MaskCompositor.js`, the **single path** for preview, overlay, and export (this also subsumes audit item M2's caching):

```js
class MaskCompositor {
  // Returns an offscreen canvas whose ALPHA is the final mask.
  getMaskCanvas(layer)   // cached by key below
  // Returns Uint8Array (w*h) extracted from that canvas — for export & hit-testing.
  getMaskData(layer)
  invalidate(layerId)    // called on paint commit / settings change
}
```

Composite steps (all GPU canvas ops, no pixel loops except the existing selection derivation):
1. Draw `selectionMaskCanvas` (built from the existing `createMaskForLayer()` Uint8Array — reuse it verbatim, cached on `(selections, threshold, contiguous)`).
2. `globalCompositeOperation = 'source-over'` → `drawImage(paint.add)` (union).
3. `globalCompositeOperation = 'destination-out'` → `drawImage(paint.sub)` (subtract).
4. Feather: redraw through `ctx.filter = 'blur(Npx)'` into the output canvas. *(Replaces the O(r²) manual blur for painted layers; the audit-M1 separable blur remains the fallback for `ctx.filter`-less environments and for pure-selection layers if we want bit-identical legacy output.)*
5. Invert (`layer.settings.invert`): existing semantics — invert alpha within the base image's opaque region only.

Cache key: `(selectionsKey, threshold, contiguous, invert, feather, paintMask.version)`.

**Consumers:**
- **DOM preview** (`GlitterManager.renderLayer`): `getMaskCanvas(layer).toBlob()` → object URL → `mask-image` (replacing today's base64 `toDataURL`; revoke the previous URL).
- **Export** (`app.js exportAnimatedGif` → `callbacks.createMask`): change to `(layer) => maskCompositor.getMaskData(layer)` and delete the separate feather call there. **This single change is what guarantees export parity.**
- **Layer hit-testing** (`isPixelInLayerSelection` in LayerManager, used by the select tool and color-picker layer pick): change to sample `getMaskData(layer)` so clicking painted glitter selects the right layer. (Today it re-runs color math and would miss painted-only regions.)

## 4. Brush engine — `MaskEditor`

New file `js/classes/MaskEditor.js`. One instance owned by the editor; operates on the active glitter layer's PaintMask.

**Tool, not mode (revised 2026-07-03, decision 7 — supersedes the original "mode" design):** painting is `ToolType.BRUSH`, a first-class toolbar tool (`#brushTool`, shortcut **B**), enabled whenever an image is loaded — full color-picker parity: painting while a non-glitter layer is active **auto-creates a glitter layer** (gated on `CONFIG.autoCreateGlitterLayer`, same as the picker) and paints into it. `setTool` drives `MaskEditor.onToolChanged()`, which enters/exits the edit state; the panel's "Edit Mask" button is just a shortcut that toggles the Brush tool. Entering still adds `body.mask-editing`, disables layer picking and sticker `pointer-events`, and shows the overlay. Esc or any tool switch exits (committing any in-flight stroke). The brush persists across **all** layer switches (retargeting glitter layers, going dormant over non-glitter ones) — it only releases via an explicit tool change or a lifecycle exit (undo restore, image clear). A glitter layer's `onActivate` auto-switch to the color picker is suppressed while the brush is active.

**Stamping:**
- A stamp is a radial-gradient circle: `innerRadius = size/2 × (1 − softness)`, fading to transparent at `size/2`; stamp alpha = `flow`.
- Stamps are drawn along the pointer path at spacing `max(1, size × CONFIG.maskBrush.stampSpacing)` to avoid gaps, into `paint.add` (Add mode) or `paint.sub` (Subtract mode) with plain `source-over`. Overlaps within a stroke accumulate → flow behaves as expected.
- Painting Add also erases the same stamp from `sub` (`destination-out`), and vice versa — so painting over previously-erased areas "heals" them without needing a third mode.
- Coordinates via the existing `viewport.screenToCanvas()`; zoom/pan just work.

**Input routing:**
- Desktop: `pointerdown/move/up` on `previewContainer`, active only in mask-edit mode (capture before the existing click plumbing; set `editor.ignoreNextClick` on stroke end, same pattern LayerTransform uses).
- Mobile: reuse the existing `TouchGestureHandler` on the viewport — when mask-edit mode is on, `onSinglePan` routes to `MaskEditor.strokeMove()` instead of panning; pinch/two-finger pan continue to zoom/pan the viewport (a two-finger touch cancels the in-flight stroke without committing). This reuses the tap/pan/pinch state machine instead of fighting it.

**Live feedback during a stroke:**
- **Overlay canvas** (new element in `previewWrapper`, above `previewCanvas`, below stickers): renders the composite mask tinted `CONFIG.maskBrush.overlayColor` at `overlayOpacity`. Updated per stamp — cheap `drawImage` ops only.
- The actual glitter element's `mask-image` refresh is throttled to rAF (blob URL swap); full-quality update (with feather) on stroke end.
- **Brush cursor:** a circle `<div>` tracking the pointer, diameter = `size × viewport.currentZoom`, with a crosshair dot; hidden over UI. Native cursor hidden inside the canvas while editing.

## 5. UI

**Glitter settings panel** (index.html, inside the existing `glitterSettingsSection` so mobile gets it for free via `LAYER_UI_CONFIG[GLITTER_FILL].mobileSettingsSections`):

```
Mask ────────────────────────────────
[ Mask Brush ]                 (btn-simple, full width, .active while the tool is held; shortcut B)
[ Paint | Erase ]              (segmented btn-simple pair — internally still add/sub)
Size:      ○────────  40px   [reset]
Softness:  ○────────  0%     [reset]
Flow:      ○────────  100%   [reset]
[✓] Invert                     (checkbox-group, mirrors Selection Options' Invert)
[ Clear Paint ]                (btn-simple, confirmation dialog)
```

*(Revised 2026-07-03 for design-system consistency: `btn-text-with-icon` is a modal/welcome pattern, not a panel pattern — the toggle is a plain `btn-simple`. "Add/Subtract" renamed "Paint/Erase" in the UI. The mask-overlay toggle is NOT in this panel — it's a view option, so it lives in the preview-controls strip as a `btn-icon` toggle alongside Transparency/Bounds, enabled only while the brush is active. Invert appears here as a `checkbox-group` — the same control style as Selection Options — implemented as a mirror of the `#invert` checkbox (it forwards through #invert's change event so the commit/history path runs exactly once; `MaskEditor.loadLayer` keeps both in sync).)*

- Sliders wire through the existing `setupSlider()` helper (live value + reset button).
- **Invert** (Selection Options checkbox) toggles the existing `layer.settings.invert` (live, non-destructive) and records history — matches spec ("Invert Mask … creates history entries") without inventing a second invert.
- **Clear Paint** clears `add`+`sub` (color-pick selections keep their existing chip UI with per-chip remove). Confirmation dialog, history entry.
- Layer list: small brush badge on layers that have paint (nice-to-have, Phase 3).
- Hints: extend `updateHelpfulMessage()` — empty glitter layer hint becomes "click colors with the picker *or* Edit Mask to paint glitter directly"; while editing: "Paint to add glitter • hold [X]/switch to Subtract to erase".

## 6. History (per-stroke undo/redo)

Integrates with the existing snapshot history rather than replacing it:

- Serialized glitter-layer state gains `maskVersion` (int, default 0).
- `GlitterManager.paintHistory: Map<layerId, MaskSnapshot[]>` — **copy-on-write snapshots**: on stroke/clear/invert commit, `version++` and store a single-channel `Uint8Array` copy of `add` and `sub` (extracted alpha, w×h bytes each — 1.28 MB total at 800×800). Snapshots are immutable and shared by reference across history states that didn't change them; ring buffer capped at `CONFIG.historyLimit`.
- `HistoryManager.restoreState()` (`js/classes/HistoryManager.js` — history logic was extracted out of app.js in audit Goal 4): for each glitter layer, if the restored `maskVersion` differs from the live one, blit the matching snapshot back into the paint canvases and `maskCompositor.invalidate(layerId)`.
- `editor.historyManager.saveState()` is called once on stroke **end** (pointer up), never per stamp → "each stroke = one history action".
- **Phase-3 optimization** (only if profiling demands): replace full snapshots with stroke-bounding-box before/after patches.

> **Invariant change — note for future features:** this is the point where a history state stops being a self-contained JSON document. `maskVersion` is a pointer into `GlitterManager.paintHistory`'s binary snapshots, which live outside the `JSON.parse(JSON.stringify())` path. Undo/redo handles this correctly per this section, but any *future* save/load or share-composition feature can no longer serialize a document by dumping a history state — painted masks would be silently lost. Such a feature must encode the paint canvases separately (e.g. PNG data URLs keyed by layer id). Text glitter layers deliberately do NOT have this problem (all plain JSON).

## 6.5. Shared "does this layer render anything" predicate

`app.js` already has three separate hand-rolled per-type conditionals answering "is this layer visually non-empty" (`updateActionButtons()`'s `hasAnySelection`, the `updatePreview()` layer filter, and `exportAnimatedGif()`'s visible-layer filter — see current code at `app.js:2802-2813` for the pattern). This plan's `hasMaskContent(layer)` (§7) and the text plan's `textData.text.trim() !== ''` check are two more type-specific conditions that would otherwise get pasted into the same three call sites a second and third time.

Instead, add one dispatcher — `layerHasVisibleContent(layer)` — probably in `ContentManager.js` alongside `normalizeAsset()` (the other shared per-type helper), or as a standalone function next to `LAYER_UI_CONFIG` in `config.js` if it needs to stay a plain function keyed off `LayerType`. Each layer type contributes one case:

```js
function layerHasVisibleContent(layer) {
  switch (layer.type) {
    case LayerType.STICKER: return true;
    case LayerType.GLITTER_FILL: return hasMaskContent(layer); // this plan
    case LayerType.TEXT_GLITTER: return layer.textData.text.trim() !== ''; // text plan
    case LayerType.BASE_IMAGE: return true;
    default: return false;
  }
}
```

Replace all three existing `app.js` call sites with this one function. Single source of truth; the text plan should do the same instead of adding its own third copy of the same three-site edit.

## 7. Integration points that must change

These are the places that currently assume "glitter mask ⇔ selections exist" — each must switch to `hasMaskContent(layer)` (= `selections.length > 0 || paintMask has non-empty version`):

| Site | Current check | 
|---|---|
| `app.js updatePreview()` layer filter (~line 4032) | `l.selections.length > 0` |
| `app.js updateActionButtons()` `hasAnySelection` | same |
| `app.js exportAnimatedGif()` visible-layer filter | same |
| `app.js updateHelpfulMessage()` empty-layer branches | `!selections.length` |
| `LAYER_UI_CONFIG[GLITTER_FILL].onActivate` auto-switch-to-picker | `!selections.length` → only auto-switch if no paint either |
| `LayerManager.handleLayerPick` / `isPixelInLayerSelection` | re-runs color math → sample `getMaskData` |
| `GifExporter` `_isTransparencyFilled` | uses `selections.some(isTransparent)` — painted-over-transparent areas count too; compute from mask data ∧ base alpha |

`GlitterManager.renderLayer()` switches from inline mask generation to `maskCompositor.getMaskCanvas(layer)` — which also fixes audit M2 for free.

## 8. CONFIG additions

```js
maskBrush: {
  defaultSize: 40, minSize: 1, maxSize: 300,      // canvas px
  defaultSoftness: 0,                             // 0–100; sharp by default (decision 5)
  defaultFlow: 100,                               // 1–100
  stampSpacing: 0.25,                             // fraction of size
  overlayColor: '#ff2d8a', overlayOpacity: 0.45,
  cursorStroke: '#ffffff',
  livePreviewThrottle: 'raf'
}
```

## 9. Phasing

**Phase 0 — prerequisites (audit Goal 3, items 8–9):** separable feather blur + mask caching + blob-URL masks. Painting is not viable on the current O(r²) blur / full-rebuild pipeline. *Ship first, independently.*

**Phase 1 — core painting (desktop):** PaintMask storage + MaskCompositor + MaskEditor (add/subtract, size/softness/flow), overlay, brush cursor, mask UI section, all §7 integration switches, export parity, COW history. → **Codex Goal M-1 below.**

**Phase 2 — mobile + polish:** touch routing through TouchGestureHandler, clear/invert wiring + confirmations, clone/delete lifecycle, hint text, exit-mode edge cases (layer switch, image clear, undo while editing). → **Codex Goal M-2 below.**

**Phase 3 — hardening (optional):** bbox-patch history, dirty-rect overlay redraw, layer-list paint badge, keyboard shortcuts ( `[`/`]` size, `X` swap add/subtract).

## 10. Acceptance criteria (from spec, mapped)

1. Add a glitter layer, pick a glitter, click **Edit Mask**, paint → glitter appears exactly where painted, live while dragging.
2. Switch to **Subtract**, erase part of the painted (and color-picked) area → glitter disappears there.
3. Stack ≥3 glitter layers with different swatches/masks; reorder → stacking matches the layer list.
4. Size/softness/flow visibly change stroke character; cursor circle matches true brush size at every zoom level.
5. Undo/redo steps stroke-by-stroke, including across Clear Paint and Invert; undo after switching layers still targets the right layer.
6. Overlay toggle shows/hides the tinted mask; painting works with overlay off.
7. Exported GIF matches preview pixel-for-pixel for masked regions (test: paint + color-pick + feather 5 + invert on one layer, export, compare).
8. Layers with paint but zero color-pick selections render, export, and hit-test correctly.
9. Existing compositions (selections-only, no paint) behave byte-identically to today.

## 11. Out of scope (confirmed)

Multiple masks per layer · replace/paint-through modes · lasso/polygon/pen/vector tools · mask blend/combine modes · masks on sticker layers.

## 11.5. Known risks — must fix before Phase 1 ships

1. **Version-number collision across an undo branch (correctness bug, same class as the `isFlattened` bug in `docs/AUDIT.md`'s appendix).** §6's `version++` is a per-layer monotonic counter that lives on `GlitterManager.paintMasks`. But `HistoryManager.saveState()` truncates the redo branch (`history = history.slice(0, historyIndex + 1)`) without telling `GlitterManager` anything. Sequence: paint stroke → `version` goes 0→1, snapshot stored under key 1. Undo → live paint canvases restored to `version` 0's pixels, but the in-memory counter is whatever `restoreState` sets it to (the plan doesn't say — presumably also rolled back to 0). Paint again → `version` goes 0→1 *again*, and the **new** stroke's pixels get stored under the same key `1` that the original (now-orphaned but still-referenced-by-nothing) stroke used. If anything still holds a reference to the old version-1 snapshot object this is silent data corruption; if not, it's merely wasted memory — but the fix is the same either way and is required regardless: **use a single monotonically-increasing counter that is never reused, session-wide** (e.g. a counter on `GlitterManager` itself, incremented once per commit across all layers) instead of restarting from a rolled-back value. This mirrors exactly how the audit appendix recommends removing the `isFlattened` *flag* pattern in favor of state that can't go stale.
2. **Memory ceiling on COW history.** 1.28 MB/version/layer (800×800, add+sub) × `CONFIG.historyLimit` (30) × `CONFIG.maxLayers` (25) is a ~960 MB worst case if every layer is painted and history is full — unrealistic in practice but not impossible, and this app has real mobile users (`MobileManager`, `TouchGestureHandler`) where that's a crash, not just jank. Don't leave the bbox-patch optimization as optional Phase 3 — at minimum, cap total paint-history memory with an eviction policy (e.g. drop the oldest painted-layer snapshots first when a byte budget is exceeded) as part of Phase 1, even if the smarter bbox-patch encoding waits.
3. **Cancelled in-progress stroke needs its own rollback buffer.** Goal M-2 says a second touch mid-stroke should "cancel the uncommitted stroke (restore from last snapshot)" — but the *last committed snapshot* and *the state before this stroke started* are the same thing only if no other change happened in between, which is true here, but the wording invites implementing it as "undo one history step" (wrong — that would also undo the *previous* action, not just this stroke). Be explicit: `MaskEditor` must copy `paint.add`/`paint.sub` into scratch canvases at stroke *start* (not stroke commit) and restore from that scratch copy on cancel — a separate, ephemeral buffer from the COW history ring.
4. **`cloneLayer` must seed `paintHistory` for the new layer id.** §2 says clone deep-copies both paint canvases, which is necessary but not sufficient: the new layer id has no entry in `GlitterManager.paintHistory`, so the first undo that lands on the clone's current `maskVersion` has nothing to restore from. Seed a version-`N` snapshot for the clone equal to the copied canvases at clone time.
5. **Verify `ctx.filter = 'blur()'` perf/support on real target mobile browsers before committing to it as the primary feather path** (§3 step 4, §12 decision 3). No feature-detection is specified anywhere in the plan — "the separable box blur remains the fallback" needs an actual `if` somewhere, and in-app webviews (the app is a personal site, but check what actually renders it — old Android WebView `ctx.filter` support lagged Chrome for years) are worth a quick manual check, not an assumption.

## 12. Decisions (resolved 2026-07-02 — "best practices, I trust you")

1. **Clear Paint clears paint only.** Selections keep their existing per-chip remove UI. One button, one responsibility; a nuclear reset already exists (delete the layer).
2. **Subtract erases color-picked areas — confirmed.** It's the only coherent meaning of "erase glitter out." Later threshold increases can select new area that a prior Subtract stroke still keeps erased — that is correct behavior (the user's erase intent wins).
3. **Feather switches to Gaussian (`ctx.filter: blur()`) inside the shared compositor,** for both preview and export — parity is inherent because both read the same composited pixels. Existing compositions will feather marginally softer; that's an improvement, not a regression, and there are no saved documents to migrate. The separable box blur (audit M1) is still implemented as the fallback for environments without `ctx.filter` support.
4. **Brush size range 1–300px, default 40.** 300 ≈ 37% of the max 800px canvas — enough to fill large regions in a few strokes without making the slider's useful range mushy. Revisit only if user feedback asks for a fill-bucket, which is out of scope.
5. **Sharp brush edge by default (Ryan, 2026-07-02, post-M-1).** `defaultSoftness: 0` — the hard pixel edge matches the aesthetic the app comes from; softness stays available on the slider for those who want it. Implementation note: at softness 0 the stamp must be drawn as a filled `arc()`, not a radial gradient — a gradient whose inner radius equals its outer radius is degenerate and paints nothing per canvas spec. The same crispness principle applies to text glitter layers (no feather/soften controls on text; see TEXT-GLITTER-PLAN).
6. **No-flicker rendering invariants (post-M-1 flash fixes — three of them, all required):** (a) never swap `mask-image` to an undecoded URL — new blob URLs are preloaded via an `Image` and applied `onload`, previous URL revoked only after the swap; (b) never destroy-and-recreate live glitter elements — `GlitterManager.renderContent` overrides ContentManager's clear-and-rebuild with a reconcile (remove stale, update in place), because a recreated element restarts its GIF background and reloads its mask (guaranteed bare frame); (c) never render a glitter element unmasked — when a layer has no decoded mask URL yet (first render), the inner element stays `visibility: hidden` until `applyMaskObjectUrl` reveals it, otherwise the first stroke on an empty layer flashes glitter across the whole canvas.
7. **Brush is a toolbar tool, not an "Edit Mask" mode (Ryan + Fable, 2026-07-03, implemented post-M-1).** Rationale: discoverability (the mode toggle was buried in a collapsed settings subsection), consistency with the app's tools-act-on-active-layer model (color picker precedent), and it deletes hand-rolled mode plumbing (`setTool` already owns exclusivity, cursors, hints, context toolbars). The panel button stays as a shortcut. §4's tool paragraph is the authoritative behavior spec; Goal M-2 below is written against the tool model.

## 13. Execution split

**Codex or Sonnet (implementation):** Goals M-1 and M-2 below, as-is. Both are fully specced including §11.5's risk-fixes — mechanical execution against a detailed spec, same profile as the AUDIT.md goals.

**Fable (this planning track — review only, not implementation):**
- After M-1 lands, a targeted adversarial review of §11.5's four risk items specifically — don't trust "acceptance criteria passed" for these, they're easy to satisfy on paper while still wrong:
  1. Confirm the paint-mask version counter is genuinely never reused after an undo/rollback (trace an undo → repaint → undo sequence by hand against the actual diff).
  2. Confirm a memory eviction policy exists and actually bounds paint-history size, not just that it was mentioned in a comment.
  3. Confirm stroke-cancel restores from a stroke-start scratch buffer, not from the COW history ring (drop a breakpoint / read the actual restore call).
  4. Confirm `cloneLayer` seeds `paintHistory` for the new layer id.
- A live browser pass (Playwright or manual) exercising: paint → undo → repaint → undo (the version-collision scenario), stroke-cancel via a second touch mid-drag, clone a painted layer then undo, export twice in a row after painting.
- Any product-feel judgment call that comes up mid-build (brush default feel, overlay color/opacity) — implementer should ship the spec's stated defaults and flag anything that felt wrong in testing rather than silently deviating.
- Phase 3 (bbox-patch, keyboard shortcuts, paint badge) — small and judgment-heavy enough to just implement directly here later rather than dispatching a `/goal` for it.

---

## Codex Tasks

### Goal M-1 — Painted glitter masks, core (desktop)

```
/goal Implement painted bitmap masks for glitter layers in the editor at c:\xampp\htdocs\glitter (vanilla JS, no build system). Full design: docs/MASK-FEATURE-PLAN.md — follow it precisely; sections 1–8 are the spec.

PREREQUISITE — already satisfied, do not re-implement: audit Goal 3 items 8–9 (separable feather blur, mask caching) are merged and verified in the tree (GlitterManager.applyFeatherToMask prefix-sum blur, layer._maskCache). Build on them.

OBJECTIVE
Each glitter-fill layer gains an editable painted mask (Add/Subtract brush). Final mask = invert(clamp(selectionMask ∪ paintAdd − paintSub)) with feather, produced by ONE shared compositor used by DOM preview, overlay, and GIF export.

NEW FILES
- js/classes/MaskCompositor.js — getMaskCanvas(layer), getMaskData(layer), invalidate(layerId); composite per plan §3 (selection mask canvas → source-over add → destination-out sub → feather → invert-within-opaque). Cache keyed on (selectionsKey, threshold, contiguous, invert, feather, paintVersion).
- js/classes/MaskEditor.js — edit-mode lifecycle, pointer handling on previewContainer, radial-gradient stamping with spacing per plan §4, overlay canvas rendering, brush cursor element, rAF-throttled live mask refresh (blob object URLs, revoke old).

MODIFIED FILES
- js/config.js or js/app.js CONFIG: add maskBrush block per plan §8.
- js/classes/GlitterManager.js: paintMasks Map<layerId,{add,sub,version}> with lifecycle (create lazily, clone on cloneLayer, drop on delete/clearImage); renderLayer uses maskCompositor.getMaskCanvas + toBlob object URL instead of inline mask + toDataURL.
- js/app.js: (a) exportAnimatedGif createMask callback → maskCompositor.getMaskData; remove the separate feather call. (b) Build the shared layerHasVisibleContent(layer) dispatcher per plan §6.5 (one function, in ContentManager.js next to normalizeAsset or in config.js next to LAYER_UI_CONFIG) and route the three per-type visibility conditionals (updatePreview filter, updateActionButtons hasAnySelection, exportAnimatedGif filter) through it — its GLITTER_FILL case is hasMaskContent(layer) (= selections.length > 0 || non-empty paint). Replace the remaining `selections.length > 0` gates listed in plan §7 with hasMaskContent(layer) directly. (c) Mask UI section wiring (Edit Mask toggle, Add/Subtract, size/softness/flow via existing setupSlider helper, overlay toggle, Clear Paint with confirm, Invert wired to settings.invert).
- js/classes/HistoryManager.js (history logic lives here since audit Goal 4, NOT in app.js): createStateSnapshot/restoreState — glitter layer state gains maskVersion; restore blits the matching COW snapshot back into GlitterManager's paint canvases and calls maskCompositor.invalidate(layerId) (plan §6).
- js/classes/LayerManager.js: isPixelInLayerSelection → sample maskCompositor.getMaskData for glitter layers.
- index.html: Mask section markup inside glitterSettingsSection (follow existing collapsible-section / settings-row patterns and icon sprite usage); overlay canvas element inside previewWrapper.
- css/style.css: mask section, overlay canvas (pointer-events none, same transform space as previewCanvas), brush cursor, body.mask-editing states (hide native cursor over canvas, disable sticker pointer-events).

HISTORY (plan §6, risks §11.5 items 1-4 — required, not optional)
Copy-on-write snapshots: on stroke end / clear / invert, version++ and store single-channel Uint8Array copies of add+sub alpha in GlitterManager.paintHistory (ring buffer, CONFIG.historyLimit entries). One editor.historyManager.saveState() per stroke end — never per stamp. The version counter MUST be a single session-wide monotonic counter (never reused after undo/rollback) to avoid the version-collision bug in plan §11.5.1. Cap total paint-history memory with an eviction policy per §11.5.2. cloneLayer must seed paintHistory for the new layer id per §11.5.4.

CONSTRAINTS
- Zero behavior change for layers that are never painted (selections-only path must be pixel-identical, undo included).
- No canvases/typed arrays may enter the JSON.parse(JSON.stringify()) clone in saveState — paint lives only in the GlitterManager maps.
- Keep everything in plain <script> globals; add new scripts to index.html before app.js.
- Desktop pointer events only in this goal (mobile is a follow-up); but do not break existing mobile behavior — MaskEditor must be inert when mobileManager.isMobile.

ACCEPTANCE CRITERIA (plan §10, items 1–9 minus mobile)
- Paint/erase works live at 60fps-ish on an 800x800 canvas with feather 0; feather 5 updates on stroke end without freezing.
- A painted-only layer (zero selections) renders, exports, undo/redoes, and is selectable by clicking it with the select tool.
- Export matches preview: compose paint + color-pick + feather 5 + invert on one layer, export, visually compare masked edges.
- Undo steps stroke-by-stroke across 10+ strokes, interleaved with sticker moves and layer reorders.
- With Edit Mask off, every pre-existing flow (color pick, threshold slider, sticker drag, export) behaves exactly as before.
```

### Goal M-2 — Mask editing on mobile + lifecycle polish

```
/goal Extend the painted glitter mask feature (see docs/MASK-FEATURE-PLAN.md, implemented per Goal M-1 and refactored per §12 decision 7) to mobile, and close the lifecycle edge cases. Repo: c:\xampp\htdocs\glitter.

CONTEXT: painting is ToolType.BRUSH, a toolbar tool (see plan §4's tool paragraph — the authoritative behavior spec). MaskEditor.canActivate() currently returns false on mobile, making the whole feature desktop-only. setTool → MaskEditor.onToolChanged() drives enter/exit; exitEditMode reverts the tool to SELECT unless the exit came from a tool change.

EXACT CHANGES
1. Enable the brush on mobile: remove the isMobile guard from MaskEditor.canActivate(). Desktop pointer painting must stay pointer-events-based and must continue to ignore pointerType 'touch' in _shouldHandleEvent — on mobile, painting routes EXCLUSIVELY through TouchGestureHandler (next item), never through the raw pointer listeners.
2. Touch routing (plan §4): when currentTool === ToolType.BRUSH, the viewport TouchGestureHandler's onSinglePan routes to maskEditor stroke painting (screen→canvas via viewport.screenToCanvas); pinch and two-finger pan continue to zoom/pan the viewport; a second finger landing mid-stroke cancels the uncommitted stroke before the pinch starts. Per plan §11.5.3: cancel MUST restore from the scratch copy of add/sub taken at stroke start (MaskEditor._cancelStroke already does this — reuse it, do NOT touch the COW history ring). onSimpleTap while the brush is active paints a single stamp.
3. Mobile UI: the brush must be reachable from the mobile tool section (LAYER_UI_CONFIG mobileSettingsSections 'tool' mechanism — verify #brushTool appears and works there) and the Mask section must flow into the mobile settings drawer. The tool must revert to SELECT when the settings drawer closes or the tab switches (MobileManager.switchTab). Layer switches do NOT release the brush (it retargets glitter layers, goes dormant over non-glitter ones, and painting on a non-glitter layer auto-creates a glitter layer — CONFIG.autoCreateGlitterLayer parity, already implemented on desktop; make sure the auto-create path works from a touch stroke too).
4. Lifecycle: brush reverts to SELECT (committing or discarding the in-flight stroke cleanly, removing overlay/cursor) on — layer deletion, image clear (clearImage), undo/redo that removes the layer, and desktop↔mobile mode switch (MobileManager resize observer; if canActivate() becomes false while the brush is active, exit).
5. Brush cursor on touch: hide the circle cursor (no hover); instead show a brief stamp-size ring at touch start.
6. Hints: extend updateHelpfulMessage per plan §5 (empty glitter layer mentions painting; active brush shows add/subtract hint; mobile variant wording).
7. Clear Paint / Invert confirmations sized for touch; ensure history entries fire.

CONSTRAINTS
- Do not modify TouchGestureHandler's internal state machine; integrate via its existing callbacks/shouldIgnoreTarget only.
- Do not reintroduce a separate "edit mode" — all enter/exit goes through setTool/onToolChanged.
- No regressions to existing mobile flows: sticker drag/pinch/rotate, viewport pan/zoom, tap-to-select, drawers.

ACCEPTANCE CRITERIA
- On a touch device/emulator: activate the brush, one-finger paint, two-finger zoom mid-session, resume painting — no ghost strokes, no stuck states.
- Rotating between mobile/desktop widths mid-paint exits cleanly to SELECT.
- All Goal M-1 acceptance criteria still pass on desktop, including: B shortcut, brush toolbar button enable/disable, glitter→glitter switch keeps the brush.
```

# Transform Consistency + Gradient Fills Plan — 2026-07-12

Scope: transform QOL bugs Ryan hit (max-size drift, stale reset, rotation not enabling
Reset Transform, text scale semantics), Figma-style gradient fills, text-tool
click-through, undo coverage. Items in "Shipped" are done on `masks-and-text`;
the WP sections are paste-ready Codex prompts.

---

## Shipped by Fable (this branch, 2026-07-12)

1. **Scale limits are now a config toggle, off by default (Figma/Photoshop parity).**
   `CONFIG.ui.stickerHandles.scaleLimits = { enabled: false, min: 10, max: 500, hardMin: 1, hardMax: 10000 }`
   replaced `minScale`/`maxScale`. New single source of truth: `clampLayerScale()` in
   `js/transforms/transform-math.js`. Every scale write funnels through
   `LayerTransform.updateTransform`, which clamps; the drag paths that derive a
   *position* from a scale (corner drag, gesture pinch, group scale) clamp locally
   with the same helper so anchor math and stored scale agree.
   `hardMin`/`hardMax` are safety rails only (scale can't hit 0 or blow up the DOM).
   Flip `enabled: true` to restore the old 10–500% behavior — no UI toggle for now.

2. **Diagonal drift at max size fixed.** Root cause: `handleCornerDrag` computed
   `nextPosition` (opposite-corner anchor) from the *unclamped* scale, then stored the
   clamped scale — so at the limit the layer kept translating while size froze.
   Scale is now clamped before the anchor math. (Mostly moot with limits off, but the
   fix matters whenever `enabled: true` or the hard rails engage.)

3. **Reset Transform button state now tracks rotation and flips.** The rotation
   slider, rotation Reset, and Flip H/V handlers bypassed `loadTransformSettings`, so
   the Reset Transform disabled state went stale (Ryan saw this on text and shapes;
   it affected all three types — the panel is shared). New `syncResetTransformState()`
   helper in app.js, called from those handlers and from `loadTransformSettings`.

4. **Text tool now works over covering layers.** `handleWorkspaceAction` TEXT case
   returned if *any* visible layer sat under the click (a full-canvas glitter fill
   blocked text everywhere). Now: clicking existing text with the text tool selects
   it and focuses the input (Figma behavior); anything else under the click is
   ignored and a new text layer is created on top. Shape tool was never blocked
   (its pointerdown path doesn't hit-test layers).

   Verified: headless probe (scale toggle both ways, reset-button state after
   rotate/flip, text-over-sticker) + touch-smoke, touch-handle-verify,
   export-parity, shape-border-verify all pass. Files touched: config.js,
   transform-math.js, app.js, LayerTransform.js, GroupTransformManager.js
   (+ `?v=` bumps in index.html). **Needs Ryan manual test.**

Round 2 (same day, panel/theme QOL from Ryan's follow-up): toolbar Clear All icon is
now the X (was the broom); the image panel header lost its X button (toolbar Clear
All is the one reset); Image and Layers sections are collapsible — independently,
both can stay open, via `initializeStandaloneCollapsibles()` reusing the design
panel's is-open/.collapsed conventions and a small `.panel-collapsible` SCSS block;
context-bar sliders got their own per-theme track token (`--context-slider-track`,
mid-ramp step on all four light themes — they float on glass, the panel track token
vanished there); new dark era theme **Llama** (classic Winamp: charcoal-steel ramp,
LED-green accent, gold titlebar text, steel gloss buttons with a green glow base).
Files: index.html, app.js, config.js, _tokens.scss, _themes.scss, _panels.scss.
**Needs Ryan SCSS recompile** (compile-checked clean to a temp file only).

---

## Open decisions baked into the WPs below

- **Text scale control goes away** (WP-B). Scale-as-percent is meaningless for text
  because corner drags commit scale into font size on release — the slider showing
  a value that snaps back to 100% is noise. Font size + W/H (fixed box) are the real
  controls; Figma's panel shows no percent scale either.
- **Gradients follow the existing source-mode pattern** (WP-C): a fourth `mode`
  ('none' | 'solid' | 'glitter' | 'gradient') on the same effectData objects, not a
  parallel fill system. v1 gradient editor = Figma-lite: linear/radial toggle, angle,
  2+ color stops with per-stop alpha.

---

## WP-A (Codex) — Stale transform box after Reset Transform / sidebar size edits on stickers

```
In c:\xampp\htdocs\glitter (branch masks-and-text), read CLAUDE.md first — LF endings,
tabs, no build step, bump ?v= on every JS file you edit, dbg() not console.log.

Bug (reported from manual testing, desktop mouse): with a sticker selected, press
"Reset Transform" in the sidebar — the sticker snaps back to 100% but the on-canvas
transform box (bounding box + handles) stays at the previous size. Sidebar Scale
slider and W/H inputs also leave the box stale. Interacting with the box itself
(corner drag) re-syncs it. Rotation from the sidebar may show the same staleness.

Known negative result: this does NOT reproduce with a static dataURL sticker driven
by synthetic events (headless probe showed box, element, and scale all in sync, and
transform.transformHandles === the DOM handles). Suspects, in order:
1. Animated GIF stickers from the real sticker library: StickerManager.renderLayer()
   destroys and recreates the LayerTransform instance and element
   (js/classes/StickerManager.js ~490-546) — if renderLayer runs while handles from
   the OLD instance are in the DOM, the new instance has transformHandles === null,
   so every sidebar path (StickerManager.updateTransform guards on
   transform.transformHandles) silently skips updateHandlePositions() while
   applyTransform still resizes the element. Orphan cleanup only happens inside
   createTransformHandles().
2. Undo/redo or clone flows recreating layerTransforms entries the same way
   (see recent cloning changes in LayerManager/GroupTransformManager, commit 2577562).

Task:
1. Reproduce with a real animated sticker (Playwright headless against
   http://localhost/glitter/ — see CLAUDE.md "Testing gotchas": kill
   .modal-overlay.visible, editor.loadBlankImage(w,h,color), wait for
   editor.originalImage, use editor.stickerManager.addStickerToCanvas(id) with a real
   library id, then drive the sidebar controls with real input/change events). Also
   try the sequence: corner-drag, undo, then sidebar scale.
2. Fix at the ownership level, not per-call-site: handle DOM ownership must follow
   the live layerTransforms map entry. Reasonable shape: when renderLayer replaces a
   LayerTransform that currently owns handles, either carry the handle container over
   to the new instance or re-run editor.syncTransformHandlesForActiveLayer() after the
   swap. Do NOT sprinkle extra updateHandlePositions() calls into app.js handlers.
3. Add a regression check to tests/touch-handle-verify.js (mouse section): sidebar
   scale + Reset Transform must resize the .transform-bounding-box.
4. Run node tests/touch-smoke.js and node tests/touch-handle-verify.js.

Best practices, I trust you.
```

## WP-B (Codex) — Text scale semantics: remove the Scale control for text

```
In c:\xampp\htdocs\glitter (branch masks-and-text), read CLAUDE.md first — LF endings,
tabs, no build step, bump ?v= on JS files you edit, SCSS only (never css/style.css),
guide mirror rule.

Context: text layers bake scale into font size — corner drags call
commitScaleToFontSize on release (LayerTransform.handleHandlePointerUp), and the
sidebar Scale slider for text commits on change too (app.js setupTransformListeners).
So the panel's Scale readout climbs during a drag and snaps back to 100%, which reads
as a bug. Decision: text has no user-facing Scale control; font size and W/H are the
controls.

Task:
1. In app.js buildTransformPanel / getTransformIds / loadTransformSettings, stop
   rendering the Scale control for the text prefix entirely (today it's only hidden
   for fixed-box mode without adjustment — make it unconditional for text). Keep the
   internal transform.scale plumbing untouched: gestures and corner drags still scale
   live and commit on release.
2. Fixed-box text: corner drag already commits; verify edge-drag box resize never
   leaves a lingering non-100 scale. If it can, commit there too.
3. hasResettableTransformAdjustments / Reset Transform for text: with scale always
   committed, the button should enable on rotation/flip only. Make sure Reset
   Transform on text doesn't visually shrink text (it must reset rotation/flip and
   leave the committed font size alone — adjust LayerTransform.resetTransform via a
   per-type hook or manager override, NOT a type branch inside LayerTransform if a
   cleaner delegation exists; see docs/!old/LAYER-TYPE-CONTRACT.md).
4. Mirror any panel change in modals/guide.html if the guide mentions text Scale.
5. Run node tests/touch-smoke.js, node tests/touch-handle-verify.js,
   node tests/export-parity.js.

Best practices, I trust you.
```

## WP-C (Codex) — Figma-style gradient fills (text, shape, and glitter-fill layers)

```
In c:\xampp\htdocs\glitter (branch masks-and-text), read CLAUDE.md FIRST and treat its
architecture invariants as law — especially: preview is DOM, export is canvas, every
visual feature is implemented twice and must match; NEVER use ctx.filter; masks stay
binarized; bump ?v= on every JS file you edit; SCSS only.

Feature: gradient fills, done the way Figma does fills. Today every paintable slot
(text fill/border/shadow, shape fill/border/shadow) resolves through one source model:
effectData.mode ∈ 'none' | 'solid' | 'glitter' (see `js/effects/effect-source.js`
resolveEffectPaintSource, `js/effects/slot-effects.js`, and the segmented source controls in
TextGlitterManager/ShapeGlitterManager). Add a fourth mode: 'gradient'.

Data model (single shape, used everywhere):
  effectData.gradient = {
    type: 'linear' | 'radial',
    angle: 0-360 (linear only),
    stops: [{ offset: 0-1, color: '#rrggbb', alpha: 0-1 }, ...]  // >= 2 stops
  }
Defaults live in `js/core/config.js` under the existing tree (no inline ?? fallbacks).

Where it applies:
1. Text slots (fill/border/shadow) and shape slots (fill/border/shadow): extend the
   existing segmented source controls (None/Glitter/Solid → +Gradient). The 4-way
   mirror MUST stay in lockstep: DOM preview (TextGlitterManager span stack /
   ShapeGlitterManager) and canvas export (GifExporter; getEffectPaintSource ↔
   _getTextEffectSource are deliberate mirrors — extend both).
   - Preview: paint with CSS `linear-gradient()` / `radial-gradient()` as
     background-image on the same masked spans that solid/glitter use today.
     Gradient coordinates are the layer's local frame, not the canvas.
   - Export: ctx.createLinearGradient / createRadialGradient over the same geometry.
     Angle convention must match CSS (`linear-gradient(45deg,…)` = CSS bearing);
     write a tiny shared helper (plain root script, e.g. extend effect-source.js)
     that converts {type, angle, stops} + a rect into both a CSS string and canvas
     gradient endpoints so the two sides cannot drift.
2. Glitter fill layers (GlitterManager): add a source control so a painted fill
   region can be Glitter (today's behavior) / Solid / Gradient. Gradient/solid paint
   composites through the same painted mask; gradient space = full canvas for these.
   Respect the no-flicker rules: don't rebuild glitter DOM in render paths.
3. UI: Figma-lite gradient editor, reused for every slot (build it once, one shared
   renderer like renderGlitterAssetDisplay): linear/radial segmented toggle, angle
   slider (linear), stop list with 2 default stops — each stop = color swatch +
   opacity + position; add/remove stop buttons. Follow existing carded-subsection and
   segmented-control patterns. Register whatever new sections mobile needs in
   LAYER_UI_CONFIG mobileSettingsSections. Styling in css/style.scss only.
4. Serialization: extend ProjectSerializer (.glitter.json) and undo snapshots —
   effectData is plain JSON so deep-clone should just work, but verify save→load and
   undo/redo round-trip gradients.
5. modals/guide.html: mirror the new source option.
6. Tests: extend node tests/export-parity.js with a gradient-fill case (text +
   shape). Run export-parity, shape-border-verify, touch-smoke, touch-handle-verify.
   Also do the export fragility test from CLAUDE.md.

Do not touch: css/style.css directly, GifExporter frame-flattening internals,
mask binarization thresholds.

Best practices, I trust you.
```

## WP-D (Codex) — Undo coverage audit

```
In c:\xampp\htdocs\glitter (branch masks-and-text), read CLAUDE.md first. History
architecture: HistoryManager snapshots deep-clone layer state as JSON, but painted
masks are versioned binaries in GlitterManager.paintHistory referenced by
maskVersion pointers — history is NOT self-contained JSON.

Task: audit undo/redo coverage and fix real gaps.
1. Enumerate every user-visible mutation and check it calls editor.saveState()
   exactly once at gesture end (not per input event): layer add/delete/duplicate/
   reorder/rename/visibility/lock, all transform panel controls (position, W/H,
   scale, rotation, opacity, flips, align, resets), canvas drag/corner/edge/rotation/
   group/alt-duplicate gestures, marquee ops, text content + every text/shape slot
   property (font, size, spacing, fill/border/shadow settings), glitter asset swaps,
   mask paint/erase strokes, color fill, canvas resize, project name.
   Grep-driven: find addEventListener/'input'/'change' handlers that mutate layer or
   effectData state and don't reach saveState.
2. Also check the inverse: nothing double-saves (two history entries for one action),
   and Escape-cancel paths stay history-free (they're deliberate — see
   tests/touch-handle-verify.js "Escape cancels ... without history").
3. Watch the known trap: anything undo restores must re-render through the managers
   (renderLayer), and sticker/text/shape DOM + transform-handle state must resync
   (see WP-A — coordinate if both land).
4. Deliverable: docs/UNDO-AUDIT-2026-07.md listing each mutation → covered/gap →
   fix applied, plus the fixes themselves. For any fix touching export or frame
   handling, run the export fragility test (add animated sticker → export → edit →
   undo → export; export twice; outputs byte-identical).
5. Run all four test suites.

Best practices, I trust you.
```

---

## What to build next (decisions locked with Ryan 2026-07-12)

1. **Snapping + smart guides** — approved, dispatch as WP-E below. **Optional, like
   Photoshop's View → Snap**: on by default, toggleable (config + UI toggle), because
   snap fights you on dense collages and fine nudges.
2. **Sticker effect slots: border + shadow** — text and shapes already have
   fill/border/shadow sources; stickers have none. Reusing slot-effects.js +
   effect-source.js gets glitter-borders/shadows on stickers with the pattern that
   already exists (border ring stamping is already mirrored for export). After WP-C,
   gradients come along free.
3. **Ctrl+D duplicate + context toolbar duplicate button** — alt-drag exists; a
   keyboard/button path is cheap (cloneLayer already does the work).
4. ~~Canvas background fill layer~~ — **decided: no new layer type.** A full-canvas
   glitter fill layer already IS the background layer, and WP-C gives it solid +
   gradient sources. At most a QOL follow-up: a one-click "fill canvas" affordance
   when creating a glitter fill layer.
5. ~~Blend modes~~ — **deferred by decision** (not yet). Groups likewise. Both are
   real multi-session projects (full preview+export mirror per mode / selection +
   history + serialization everywhere).

Simple wins pile (any idle Codex run): arrow-key font-size nudge in the size input,
double-click a layer name to rename, "Fit canvas" button on stickers (scale to cover),
remember last-used tool per session, Escape closes gradient/asset popovers.

## WP-E (Codex) — Snapping + smart guides (optional, Photoshop-style)

```
In c:\xampp\htdocs\glitter (branch masks-and-text), read CLAUDE.md first — LF endings,
tabs, no build step, bump ?v= on JS files you edit, SCSS only, dbg() not console.log.

Feature: drag-time snapping + smart alignment guides, Figma/Photoshop style.
Preview-side only — guides are UI chrome, never exported, so no canvas/export mirror
is needed. This is chrome painted over artwork: guide colors stay literal (like the
transform-handle tokens), and overlay elements need .ui-ignore-gestures.

Scope:
1. While move-dragging a layer (mouse drag, move-handle drag, group drag — the
   position paths in LayerTransform.setupMouseDrag/handleMoveDrag and
   GroupTransformManager), snap the dragged frame's edges + center to:
   canvas edges, canvas center lines, and other visible movable layers' frame
   edges/centers (use getFrameMetrics — it already gives rotated corner bounds).
   Snap threshold in CANVAS px scaled by 1/zoom so it feels constant on screen.
2. Draw 1px guide lines (canvas-overlay divs or a single overlay canvas in
   canvasElementsContainer, z-order above layers, pointer-events none,
   .ui-ignore-gestures) only while a snap is engaged; remove on release/cancel.
3. Optional per Photoshop: CONFIG.snapping = { enabled: true, threshold: 6,
   snapToCanvas: true, snapToLayers: true } in `js/core/config.js` (no inline fallbacks).
   UI toggle: a btn-icon view toggle in the preview-controls cluster (same pattern
   as transparency/bounds toggles), plus holding Ctrl during a drag temporarily
   disables snapping (Figma parity). Add the shortcut to CONFIG.shortcuts and
   mirror in modals/guide.html.
4. Do NOT snap during scale/rotate drags in v1 (move only). Do not add snapping
   math inside updateTransform — it belongs in the drag handlers where the
   candidate position is computed, so arrow-key nudges and panel inputs stay exact.
5. Escape-cancel and alt-duplicate drags must keep working; snapping must not
   introduce extra history entries.
6. Run node tests/touch-smoke.js and node tests/touch-handle-verify.js (touch
   gestures route through different code — verify they still pass untouched; touch
   snapping is optional, fine to leave for a follow-up).

Best practices, I trust you.
```

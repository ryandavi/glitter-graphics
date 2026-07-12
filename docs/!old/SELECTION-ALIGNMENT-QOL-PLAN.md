# Selection, Alignment & QOL Plan

**Date:** 2026-07-11
**Branch:** `masks-and-text`
**Scope:** alignment naming consistency, alt-drag duplicate, multi-select panel parity, marquee select, settings-surface audit, small QOL wins.

> **Dispatch status (2026-07-11):** WP1–WP5 are dispatched to Codex and in flight. **WP6 is NOT dispatched — do not start it in parallel.** It edits `index.html` (settings modal, toolbar, preview controls) and `app.js` listener setup that the in-flight packages also touch; run it only after WP1–WP5 land and Ryan's manual pass clears, then build it on top of that tree.

Prior plans live in `docs/!old/`. This plan follows the same delegation format: paste-ready specs for the interaction-heavy packages.

---

## Background: the current state (verified)

- **Two different things are both titled "Alignment":**
  - Text *content* alignment (how glyphs sit inside the text box): `index.html:1320-1334`, inside Text Properties.
  - Layer *position* alignment (snap the layer to canvas edges/center): rendered by `buildTransformPanel` in `app.js` (~line 1959), one shared template for sticker/text/shape. Buttons already carry "Align left to canvas" tooltips; active-state sync is `getTransformAlignmentState` / `syncTransformAlignmentButtons` (`app.js:2133-2189`).
- **Multi-select sidebar** (`#multiLayerSelectionGroup`, `index.html:778-797`) is the odd one out: a "Quick Actions" subsection with four `btn-simple` buttons (Duplicate, Delete, Center H, Center V). No other panel uses "Quick Actions"; the text panel precedent for buttons is a subsection titled **Actions** (`index.html:1282`). Handlers: `app.js:3300-3327`.
- `GroupTransformManager.alignToCanvas(mode)` only supports `centerX`/`centerY` (`GroupTransformManager.js:282-301`), but `getBounds()` already returns `left/right/top/bottom/width/height`, and `translateByCanvasDelta` does the move — extending to all six modes is trivial.
- **Modifier-click semantics today:** Shift+click toggles selection membership, Alt+click cycles overlapping layers. This lives in three places that must stay in lockstep: `LayerTransform.setupMouseDrag` (`LayerTransform.js:445-511`), `handleWorkspaceAction` SELECT case (`app.js:5230-5240`), `GroupTransformManager.handleMoveSelectionIntent` (`GroupTransformManager.js:130-152`).
- `LayerManager.cloneLayer` hard-codes a +20px position offset per type (`LayerManager.js:860+`); `cloneLayers` at `LayerManager.js:1103`. Ctrl+D duplicates (`app.js:4290`).
- **Settings modal** (`index.html:2746-2993`): Interface (one toggle: Helpful Hints), Export (Base Image row `display:none`, Transparency, Matte Color, Watermark), Encoding (Dither, Dither Type, Quality), Frame Control (Frame Delay, Max Frames, Smart Frame Reduction, Frame Skip, Reverse).
- Touch selection editing deliberately lives in the layer list, not canvas gestures (`docs/!old/GROUP-SELECT-PLAN.md` §4) — nothing in this plan changes that.

---

## Decisions / recommendations

1. **Naming (Figma/Photoshop-inspired):**
   - The layer-position block in the Transform panel: **"Alignment" → "Align"** — Figma's align row aligns objects to frame/selection; Photoshop's is "Align". Keep Horizontal/Vertical group labels and Left/Center/Right, Top/Middle/Bottom buttons.
   - The text-content block: **"Alignment" → "Text Alignment"** — the direct analogue is Photoshop's Paragraph alignment / Figma's text-align icons inside Text properties. Unambiguous next to "Align".
   - Multi-select gets the same **Align** section plus an **"Align to" scope**: `Selection | Canvas` segmented control. Default **Canvas** (preserves current Center H/V behavior; most common intent in a GIF editor). Figma defaults to selection bounds — the segmented control gives us both.
2. **Alt-drag duplicate vs Alt-click cycle:** both are standard (Photoshop/Figma use Alt-drag duplicate; we use Alt-click for depth cycling). They don't have to conflict — **defer the decision to the move threshold** (the drag path already uses a 3px threshold, `LayerTransform.js:525`): Alt+press then release without moving = cycle (existing behavior unchanged); Alt+press then move past threshold = duplicate-and-drag. The clone follows the cursor; the original stays put.
3. **"Quick Actions" goes away.** Multi-select panel becomes: selection summary → **Align** (full six-mode section + scope control) → **Actions** (Duplicate, Delete), using the same `subsection-content-group` / `transform-control-group` / segmented-control markup as the transform panel.
4. **Marquee select is desktop-mouse-only in v1.** Touch keeps the layer-list flow. Selection commits on mouse-up (live-updating the sidebar on every mousemove would re-render panels constantly; revisit later if it feels off).
5. **Settings modal:** it currently mixes one app preference with nine per-project output settings. Recommendation (WP6, Ryan's call): keep the Settings modal for app preferences, move Export/Encoding/Frame Control into an **Export Settings** surface reachable from the export flow (gear next to Export button opening the same modal markup, retitled). Cheap version: retitle the modal "Export Settings" and move Helpful Hints elsewhere. Also: delete the dead hidden "Base Image" row or resurrect it deliberately.

---

## Work packages

### WP1 — Alignment naming + panel language sweep (Fable, low risk)

- `app.js` `buildTransformPanel`: subsection title "Alignment" → "Align".
- `index.html:1321`: "Alignment" → "Text Alignment".
- Sweep tooltips/labels for consistency ("Align left to canvas" style stays).
- Mirror in `modals/guide.html` (it names panel sections).
- Bump `?v=` on `app.js`; no SCSS expected.
- **Do not rename any element ids** (`*AlignLeft`, `text-align-group`, etc.) — display text only.

### WP2 — Multi-select panel parity + full group align (Codex, medium)

Prompt-ready summary:

1. `GroupTransformManager`:
   - Extend `alignToCanvas(mode)` to `left/centerX/right/top/centerY/bottom` using `getBounds()` deltas (e.g. `left: -bounds.left`, `right: canvas.width - bounds.right`).
   - Add `alignToSelection(mode)`: same six modes, but each member layer aligns within the group bounds — per-entry delta computed from that layer's own `transform.getFrameMetrics()` against `getBounds()`. Skip when only the group itself would move (aligning-to-selection with the whole selection is per-member by definition). One `saveState()` per action (reuse `translateByCanvasDelta`'s pattern / `ensureHistoryBaseline`).
2. `index.html` `#multiLayerSelectionGroup`: replace the two "Quick Actions" rows with:
   - **Align** subsection: "Align to" segmented control (`Selection | Canvas`, default Canvas) + Horizontal (Left/Center/Right) and Vertical (Top/Middle/Bottom) segmented controls, markup cloned from the transform-panel align block so SCSS is reused.
   - **Actions** subsection: Duplicate / Delete buttons (existing ids `multiSelectionDuplicateBtn` / `multiSelectionDeleteBtn` keep working).
   - Remove `multiSelectionCenterHorizontalBtn` / `multiSelectionCenterVerticalBtn` and their listeners (`app.js:3300-3327`); wire the new six buttons through the scope setting.
3. Scope is session state (a field on the editor or `GroupTransformManager`), not persisted; don't add to CONFIG defaults unless a default value is needed — if so it goes in `CONFIG` per the config rule.
4. No active-state highlighting on the multi-select align buttons in v1 (single-layer alignment sync uses per-layer metrics; a group equivalent is follow-up).
5. Mobile: `#multiLayerSelectionGroup` lives inside the no-layer section — verify the mobile drawer path still shows it and the new controls fit (MobileManager section tables).
6. `modals/guide.html`: update the multi-select description.
7. Tests: `node tests/touch-smoke.js`, `node tests/touch-handle-verify.js`.

### WP3 — Alt-drag duplicate (Codex, medium-high)

1. `LayerManager.cloneLayer(layerId, options)` / `cloneLayers(layerIds, options)`: add `options.positionOffset` (default `{x:20, y:20}`; pass `{x:0, y:0}` for drag-duplicate) and `options.skipHistory` so the drag can own the single history entry. Existing callers unchanged.
2. `LayerTransform.setupMouseDrag` (`LayerTransform.js:445`): on Alt+mousedown over a layer that is (or becomes) the drag target, do **not** early-return into selection delegation. Track a pending-alt state; if pointer moves past the existing 3px threshold, clone the layer at its current position, retarget the drag to the clone's `LayerTransform`, and continue; on mouseup without movement, run the existing Alt-click cycle path (`delegateSelectionFromCanvasPoint` with `cycleDeep`).
3. Group path: Alt+drag inside the group bounding box duplicates **all** selected movable layers via `cloneLayers` (zero offset), selects the clones, and the group drag continues on them. Hook: `GroupTransformManager.handleMoveSelectionIntent` + wherever the group move drag starts — same threshold-deferral trick.
4. History: exactly one `saveState()` at mouseup (clone + final position together). Aborted drag (no movement) = no clone, no history entry.
5. Clone-before-drag must reuse the normal clone paths so element/mask/frames rules hold (see `cloneStickerElement` note about never sharing frame caches).
6. `CONFIG.shortcuts.tools`: add `{ key: 'Alt + Drag', action: 'Duplicate Layer(s) While Dragging' }`; mirror in `modals/guide.html`. Keep the existing `Alt + Click` row — both now coexist.
7. Desktop mouse only; the touch gesture routes are untouched.
8. Tests: all four suites (`touch-smoke`, `touch-handle-verify`, `export-parity`, `shape-border-verify`) — clone paths touch layer construction.
9. Manual acceptance (Ryan): Alt-click still cycles overlapping layers; Alt-drag duplicates sticker/text/shape and a multi-selection; undo after Alt-drag removes clone and restores selection in one step.

### WP4 — Marquee (drag) select (Codex, medium-high)

1. Desktop mouse, SELECT tool only. Hook alongside the shape-drag path in the `previewContainer` `pointerdown` handler (`app.js:3373-3393`): if tool is SELECT, button 0, target is workspace/canvas but **not** a transformable overlay (`TRANSFORMABLE_LAYER_ELEMENT_SELECTOR`), not inside `.ui-ignore-gestures`, not the group bounding box — start a potential marquee. Follow the `startShapeDrag` pattern (`app.js:3537`) including the `isClick` fallback and click-swallowing so plain click-to-clear still works via `handlePreviewContainerClick`.
2. Visual: absolutely positioned rect div in the preview container, `pointer-events: none`, styled in `style.scss` (new `.selection-marquee`; reuse existing selection-blue tokens). Screen-space rect; convert corners to canvas space for the hit test.
3. On mouseup: select movable layers whose `getFrameMetrics()` AABB intersects the marquee canvas rect (`layerManager.setSelection`). Shift held at mousedown = add to existing selection. Empty result without Shift = clear selection (matches current empty-canvas click).
4. No marquee when no image is loaded or when a drag starts on a selected layer/group box (that's a move).
5. Guide + `CONFIG.shortcuts` ("Drag on empty canvas — Select multiple layers").
6. Tests: `touch-smoke` + `touch-handle-verify` (must prove touch routing is unaffected).

### WP5 — QOL small wins (Codex, low, batchable)

- **Ctrl/Cmd+A**: select all movable layers when not typing (keyboard handler near `app.js:4257`; respect the existing `isTyping` guard at `app.js:4207`).
- **Escape clears multi-selection** — verify what the current Escape branch (`app.js:4220`) already does and extend, don't duplicate.
- **Selection count in status bar** ("3 layers selected") via `updateStatusBar` / selection-change path.
- **Distribute** (Horizontal / Vertical) buttons in the multi-select Align section, enabled at 3+ selected: sort by center on the axis, space centers evenly between the two extremes. Small addition to `GroupTransformManager`.
- **Nudge parity for multi-select** — arrow keys already route through `groupTransformManager.nudge`? Verify; fix if single-layer-only.
- Every new shortcut → `CONFIG.shortcuts` + guide mirror.

### WP6 — Settings-surface reorganization (**deferred — run after WP1–WP5 land**, decisions below need Ryan's sign-off)

**Not dispatched.** This package is written in full so it can go to Codex later without another planning round, but it must wait for the in-flight WP1–WP5 tree (see dispatch status at top).

#### 6.1 What the modal holds today, and where each row should end up

The Settings modal (`index.html:2746-2993`) mixes one app preference with nine per-project output settings. Proposed split:

| Row | Today | Proposed home | Tier |
|---|---|---|---|
| Helpful Hints | Interface group | stays in Settings (app preferences) | top-level |
| Base Image (`display:none`, `index.html:2799`) | Export group | **delete** — dead markup | — |
| Transparency | Export group | Export Settings, top-level | creative |
| Matte Color | Export group | Export Settings, top-level (already shows/hides with Transparency) | creative |
| Watermark | Export group | Export Settings, top-level | creative |
| Frame Delay | Frame Control | Export Settings, top-level, relabeled **"Animation Speed"** (keep the ms/FPS option text) | creative |
| Reverse Animation | Frame Control | Export Settings, top-level | creative |
| Dithering + Dithering Type | Encoding | Export Settings → **Advanced** disclosure | technical |
| Quality | Encoding | Export Settings → **Advanced** disclosure | technical |
| Max Frames | Frame Control | Export Settings → **Advanced** disclosure | technical |
| Smart Frame Reduction | Frame Control | Export Settings → **Advanced** disclosure | technical |
| Frame Skip | Frame Control | Export Settings → **Advanced** disclosure | technical |

#### 6.2 Advanced disclosure — yes, reuse the fills pattern

The technical tier goes inside one collapsed **Advanced** disclosure using the existing component: `.advanced-disclosure` / `data-advanced` / `data-advanced-toggle` / `data-advanced-content` (`index.html:905`, `1469`, `1603`…), initialized by `initializeAdvancedDisclosures`. Notes for the implementer:

- Verify `initializeAdvancedDisclosures` covers markup inside modal overlays — it was built for sidebar panels; if it queries a scoped root, widen the query, don't fork the component.
- One disclosure, not one per group — the group titles (Encoding / Frame Control) become plain `control-group-label`-style headings *inside* the disclosure content.
- Row ids (`exportDitherEnabled`, `exportQuality`, `exportFrameDelay`, …) and their listeners move untouched; this is a markup relocation, not a rewire.
- The per-section Reset buttons collapse to two: one for the creative tier, one inside Advanced (or a single "Reset Export Settings" in the footer — implementer's call, footer is simpler).

#### 6.3 Entry point

The Export Settings modal opens from a gear button next to `#exportGif` in `.preview-controls-right` (`index.html:2258`). `.preview-controls` is already `ui-ignore-gestures` and renders on mobile too, so **one entry point serves both platforms** — no separate mobile affordance needed. The toolbar `#settingsBtn` keeps opening the (now app-prefs-only) Settings modal.

#### 6.4 Mobile toolbar height (Ryan's concern)

The left toolbar is a vertical strip; on desktop the `.toolbar-spacer` pushes Keyboard Shortcuts + Settings + Clear All to the bottom (`style.scss:963`) — good balance, **keep desktop as is**. On mobile it becomes a floating fixed strip (`style.scss:4908`) where `#shortcutsBtn` is already `display:none` — precedent for platform-specific membership. Proposal, mobile only:

- **`#settingsBtn`: hide from the floating toolbar** (same mobile block as `#shortcutsBtn`). Relocation: add a Settings entry to the mobile nav bar (a small `btn-icon` in the existing `.mobile-drawer-btn-group.small` next to `#mobileAddLayerBtn`, `index.html:3200`) opening the same modal. App settings are rare-touch; the nav bar is the right cost.
- **`#clearAllTool` (trash): hide from the floating toolbar.** Relocation: the mobile Layers drawer bottom bar, alongside `#layersBarDeleteSelected` (`index.html:303`) — destructive layer-scale actions already live there, and Clear All keeps its confirm dialog. Alternative if that bar feels crowded: leave it desktop-only and rely on `#imageClearBtn` (Remove Image) which mobile already has; Ryan picks.
- Net effect: the mobile floating strip is tools + undo/redo only — two buttons shorter than today.
- Pure CSS hides plus two small relocated buttons; no listener changes (`setupEventListeners` binds by id, ids are reused or duplicated via a shared handler, **not** duplicated ids — new ids like `#mobileSettingsNavBtn` calling the same open function).

#### 6.5 Explicitly not doing

- Per-layer encoding/quality/dither/max-frames/skip — output-wide or technical; they stay in Export Settings.
- Surfacing Frame Delay in the no-layer Project group (old option 6c) — superseded: with the gear living next to Export and Animation Speed at the top of that modal, a second sidebar copy would just create sync surface.
- **Blend modes** per-layer: the notable real gap, but a preview/export parity project (CSS `mix-blend-mode` has no `ctx.filter`-free canvas twin for all modes) — out of scope, listed for awareness only.

#### 6.6 Ryan decisions needed before dispatch

1. Sign off on the top-level vs Advanced split in 6.1 (anything you tweak per-export often should be top-level).
2. Clear All on mobile: layers-drawer bottom bar, or desktop-only?
3. Reset granularity: per-tier buttons or one footer "Reset Export Settings"?

---

## Sequencing

1. WP1 (display text only).
2. WP2 (unblocks WP5's distribute buttons).
3. WP3 and WP4 are independent of each other; both touch drag entry points, so land + manually verify one before starting the other.
4. WP5 last (batches on top of WP2).
5. **WP6 strictly after WP1–WP5 have landed and passed Ryan's manual test** — it relocates markup in files the other packages edit; answer the 6.6 decisions, then dispatch.

## Do-not-touch list

- Element ids (`*SettingsSection`, `*AlignLeft`, `text-align-group`, `multiSelectionDuplicateBtn`…) — display text changes only, ids are load-bearing.
- Touch gesture routing (`GestureManager`), pointer-capture exclusions (`.ui-ignore-gestures`, `.transform-handle-wrapper`).
- `css/style.css` directly — new marquee styles go in `style.scss`, Ryan compiles.
- Preview/export parity mirrors — nothing here should touch `effect-source.js`, GifExporter, or mask paths. If a package drifts there, stop and re-plan.
- The +20 offset default in `cloneLayer` for existing callers (Ctrl+D, layer-list clone) — only Alt-drag passes zero offset.

## Acceptance checklist (Ryan, manual)

- [ ] "Text Alignment" vs "Align" reads clearly on text layers; sticker/shape unchanged otherwise.
- [ ] Multi-select panel: six align buttons work in both scopes; Duplicate/Delete unchanged; mobile drawer shows it.
- [ ] Alt-click still cycles; Alt-drag duplicates (single + group); one undo step reverts.
- [ ] Marquee: drag on empty canvas selects; Shift adds; plain click still clears; touch unaffected.
- [ ] Ctrl+A, Escape, status-bar count, distribute.
- [ ] Guide modal mirrors every new shortcut/section title.

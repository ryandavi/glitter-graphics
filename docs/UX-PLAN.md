# Editor UX Round — Text Box Model, Fonts, Canvas Size, Panel Behavior

**Date:** 2026-07-03 · **Status:** T-2 (border/shadow) and T-3 (point/box text) landed via Codex; Fable review round 2 applied fixes — see §10. C-1 still queued.
**Companion docs:** `docs/TEXT-GLITTER-PLAN.md` (T-1 shipped, T-2 designed), `docs/MASK-FEATURE-PLAN.md`, `docs/AUDIT.md`

This doc captures Ryan's post-T-1 UX feedback round and the decisions that came out of it. Questions answered, bugs root-caused, and the follow-on work split between Fable (small surgical fixes, applied same day) and Codex (goals below).

---

## 1. Ryan's questions → resolutions (quick index)

| Question | Resolution |
|---|---|
| Default text configurable? | Yes — `CONFIG.textLayers.defaultText` (js/config.js). No change needed. |
| Text clipped / box wrong size / grey top edge on export | One measurement bug, three symptoms — **fixed by Fable**, see §2. |
| Box scaling: proportional-only, alignment pointless without wrap | Adopt Photoshop point-text/area-text model as a per-layer toggle — **Goal T-3**, see §3. |
| Better font selection? Easy to add fonts? | Picker now a scrollable list (**done**); adding a font = woff2 + one manifest line; **licensing warning** for the dafont list, see §4. |
| Change document size after adding art (crop)? | Canvas Size modal with anchor grid — **Goal C-1**, see §5. |
| Design panel sections should collapse each other | Accordion behavior — **done**, see §6. |
| What other features, without over-engineering? | Border/shadow (T-2, already designed) is the big one; small shortlist + explicit rejections in §7. |

## 2. The measurement bug (fixed 2026-07-03, Fable)

**Three reported symptoms, one root cause.** `TextGlitterManager.getMeasurementEntry` sized the text mask from (a) the sample string `'Hg'`'s `actualBoundingBoxAscent/Descent` for vertical bounds and (b) `measureText().width` (advance width) for horizontal bounds. Display faces break both assumptions: Pacifico/Lobster/Shrikhand swashes overhang their advance widths, and tall caps/accents exceed `'Hg'`'s ascent. Ink drew outside the mask canvas, so:

1. **Preview box clipped text** (mask canvas = the box).
2. **Box wasn't "the size of the text"** at default.
3. **Grey top edge on export** — glyphs sheared at the canvas edge leave a hard row of partially-covered antialiased pixels; GIF quantization + matte compositing renders that fringe grey.

**The fix** (all in `TextGlitterManager`):

- `measureLine()` measures each line's real ink extents (`actualBoundingBoxLeft/Right/Ascent/Descent`), including the per-character path when `letterSpacing ≠ 0`.
- The mask canvas is sized to the **union of the layout box and the ink bounds** + `maskPadding`; draw origin shifts so no ink is clipped. `textData.width/height` = canvas dims, so hit-testing, handles, and `_drawTransformedCanvas` stay 1:1 automatically.
- **Preview parity:** the layout box (advance-width grid the CSS preview lays lines out in) can now sit asymmetrically inside the canvas, so the DOM span gets **per-side padding** (`entry.paddingBox`) instead of the old uniform `--text-mask-padding` var. The CSS var remains only as a pre-JS fallback.
- Alignment offsets unified into `getAlignOffset()`; canvas always draws `textAlign: 'left'` at computed x — one layout code path for both the spacing and non-spacing branches.

**Known residual (pre-existing, unchanged):** CSS positions the first baseline via half-leading + font metrics; canvas uses `'Hg'` ink ascent. A few-px vertical preview↔export offset can exist per font. It did not change with this fix and has never been reported as visible; if Ryan's antialiasing side-by-side (TEXT-GLITTER-PLAN §8) surfaces it, that's a separate small calibration task.

## 3. Point text vs. area text (Goal T-3)

Photoshop/Illustrator model, but **one layer type with a toggle**, not two types:

- `textData.boxMode: 'auto'` (**point text, default**) — the box always hugs the measured text (§2 fix gives this exactly). Corner handles scale proportionally as today. No edge handles. Alignment affects only multi-line blocks (keep the buttons; they're meaningful with `\n`).
- `textData.boxMode: 'fixed'` (**area text**) — stores `boxWidth`/`boxHeight` in text-local px. Text **word-wraps** to the box width; overflow beyond `boxHeight` is hidden (Photoshop behavior) with a visual overflow indicator on the box. **Edge handles** (new in `LayerTransform`: t/b/l/r midpoints) resize the box — reflowing text, not scaling it. Corner handles still scale the whole object. Alignment is fully meaningful.
- **Toggle** in `textSettingsSection` (segmented `btn-simple` pair, "Point / Box"). Auto→fixed captures the current auto box as the fixed box (visually a no-op). Fixed→auto discards the box and re-hugs.
- **Wrap must happen in the measurement step** (`getMeasurementEntry`: greedy word wrap against `boxWidth`, fall back to per-character break for unbreakable runs — mirrors the CSS `pre-wrap` + `break-word` the preview span already uses) so preview and export render the same line breaks. The CSS span in fixed mode gets `width: boxWidth` so the browser wraps identically; acceptance must diff both.
- Plain JSON → history/clone free. `boxMode: undefined` in old history states = `'auto'`.

Touches: `TextGlitterManager` (measure/wrap/UI), `LayerTransform` (edge handles — currently corners+rotation only), `GifExporter` text branch (no change if mask canvas stays = `textData.width/height`), `config.js` defaults. Prompt in §9.

## 4. Fonts

**Adding a font is two steps, no code:** drop a latin-subset `.woff2` in `fonts/`, add one line to `data/fonts.json` (`id, name, file, weight, fallback, featured`). Fonts lazy-load via `FontFace`.

**Picker (done 2026-07-03, Fable):** single-column scrollable list (max-height 220px), each option still rendered in its own face; `featured: true` fonts sort first (flag existed in the manifest, previously unused); active option auto-scrolled into view (container-only scroll — `scrollIntoView` would jump ancestor drawers on mobile).

**Ryan's requested dafont list — LICENSING GATE, do not ship without checking each:**

| Font | Note |
|---|---|
| Cheri | dafont — verify license |
| Kosmos | dafont — verify license |
| Chick | dafont — verify license |
| Sergio Trendy | dafont — verify license |
| Porky's | dafont — verify license |
| Kinkie | dafont — verify license |
| Billo | dafont — verify license |

Most dafont listings are **free for personal use / demo only**, and serving a webfont from the site is *distribution* — a stricter bar than desktop use. The current ten faces are all OFL (`fonts/OFL.txt`); that cleanliness is worth keeping. Per font: check the readme inside the dafont zip and the author's page; if personal-use-only, either buy the commercial/webfont license or substitute an OFL lookalike (plenty exist in the chunky-display genre). Conversion pipeline once cleared: TTF → woff2 latin subset (same as the 2026-07-02 batch, sourced via Fontsource/jsDelivr or `pyftsubset`/`woff2_compress`), verify wOF2 magic bytes. If any non-OFL font ships, add a `license` field to the manifest entries and a per-font license file — don't let `OFL.txt` silently misrepresent the set.

## 5. Canvas Size (Goal C-1)

**Decision: anchor-grid Canvas Size modal (Photoshop-style), not an interactive crop tool.** Covers resize-larger, crop-smaller, and re-anchor in one simple UI; an interactive drag-rect crop can be layered on later reusing the same core operation.

- Modal: width/height inputs (clamped to `maxImageWidth/Height`), 9-position anchor grid, current-size display. Entry point near the existing document/new-canvas UI.
- Core op `resizeCanvas(newW, newH, anchor)`: compute `(dx, dy)` from anchor; base image redrawn at offset into a new canvas; sticker/text layers get `transform.position += (dx, dy)`; viewport/artboard refreshed.
- **The hard part is glitter-fill masks** — pixel buffers sized to the canvas, with `paintHistory` binaries behind `maskVersion` (MASK-FEATURE-PLAN §6 invariant). Approach: composite each layer's *current* mask into the new dimensions at the offset and push it as a **new baseline paintHistory snapshot** (new version); selections arrays get coordinates offset and out-of-bounds entries dropped. Old versions stay valid for undo *before* the resize because…
- **History:** the resize is one history entry. Snapshot must capture canvas dims + base image + every layer's offsets/mask version so undo restores the old size exactly. This is the goal's acceptance-critical path.
- **Fragility test applies** (glitter-project-state warning): after implementing, run the export double-run + edit-undo-export cycle, plus resize→export→undo→export.

## 6. Design panel accordion (done 2026-07-03, Fable)

Opening any collapsible section (`layerSettings`, `glitterSettings`, `stickerSettings`, `textSettings`) now collapses the others. The four copy-pasted handler blocks in `app.js initializeCollapsibleSections()` are one data-driven loop; behavior is gated by `CONFIG.designPanelAccordion: true` (set false to restore independent toggling).

Housekeeping note found on the way: `layerSettingsOpenByDefault` and `glitterSettingsOpenByDefault` in `config.js` are **dead config** — referenced nowhere. Remove or wire up in some future cleanup pass.

## 7. Feature shortlist (and the restraint list)

Worth doing, in order:
1. **T-2 border & drop shadow** — designed in TEXT-GLITTER-PLAN §4.5, schema already reserved; the single highest-value text feature (outlines are half the classic glitter-text look). Prompt now in that doc's Codex Task section.
2. **T-3 point/area text** (§3).
3. **C-1 canvas size** (§5).
4. Small wins, any time: arrow-key nudge for the selected transformable layer (Shift = ×10), Duplicate Layer button (cloneLayer exists — UI only), line-height slider (`textData.lineHeight` is stored but has no control).

Explicitly **not** doing (over-engineering for this tool): text on a path, per-character styling, user font uploads, curved/warp text, styles/presets system, multi-select of layers. (First three were already ruled out in TEXT-GLITTER-PLAN v1 scope.)

## 8. Execution split & status

**Fable — done 2026-07-03 (this round):**
- ✅ Measurement/ink-bounds fix (§2) — `TextGlitterManager.js`
- ✅ Panel accordion + handler dedup (§6) — `app.js`, `config.js`
- ✅ Scrollable featured-first font picker (§4) — `TextGlitterManager.js`, `style.css`
- ✅ T-1 review checklist from TEXT-GLITTER-PLAN §8: `innerHTML` grep clean (only the picker-clearing assignment); `ensureFontLoaded` called from create/render/refresh/export paths, not just the picker; `layerHasVisibleContent` has the TEXT_GLITTER case; font-fetch failure rejects into the `showError` toast path (code-verified).
- ⬜ Still Ryan's/manual: the §7-item-7 antialiasing **visual** side-by-side (preview vs exported GIF), and re-check the grey-top-edge report against a real export after this fix.

**Codex — queued (dispatch order): T-2 → T-3 → C-1.** Sequential, not parallel — same reason as always (shared type-switch sites). T-2 prompt lives in `docs/TEXT-GLITTER-PLAN.md`; T-3 and C-1 prompts below.

**Ryan — gates:** font licensing verdicts (§4) before any dafont face ships; pick the `defaultText` string if 'sparkle' isn't it.

---

## 9. Codex Tasks

### Goal T-3 — Point text / area text toggle

```
/goal Add a point-text/area-text mode toggle to text glitter layers in the editor at c:\xampp\htdocs\glitter (vanilla JS, no build system). Design: docs/UX-PLAN.md §3 — follow it precisely. Prerequisites merged: text layers (docs/TEXT-GLITTER-PLAN.md Goal T-1) and the ink-bounds measurement fix (UX-PLAN §2) — getMeasurementEntry already measures per-line ink and emits entry.paddingBox; build on that code, do not regress it.

OBJECTIVE
textData.boxMode: 'auto' (default, current behavior — box hugs measured text) | 'fixed' (area text: stored boxWidth/boxHeight in text-local px, word-wrapped text, edge handles resize the box and reflow rather than scale).

MODIFIED FILES
- js/classes/TextGlitterManager.js: wrap logic inside getMeasurementEntry for fixed mode (greedy word wrap against boxWidth, per-character fallback for unbreakable runs — must mirror the CSS pre-wrap/break-word behavior of .text-glitter-content); mode toggle UI (segmented btn-simple pair per the design-system patterns in TEXT-GLITTER-PLAN §4); auto→fixed captures the current auto box; fixed→auto discards it; cache key gains boxMode/boxWidth/boxHeight.
- js/classes/LayerTransform.js: NEW edge handles (top/bottom/left/right midpoints) shown only when the layer opts in (e.g. a supportsEdgeResize flag or callback the text manager sets for fixed-mode layers); edge drag mutates boxWidth/boxHeight (via a callback into the owning manager) and triggers re-measure — it must NOT touch transform.scale. Corner/rotation handles unchanged for all layer types; stickers see zero behavior change.
- js/classes/GifExporter.js: no text-branch changes expected — the mask canvas must remain textData.width/height so _drawTransformedCanvas stays 1:1; if a change seems needed, re-read UX-PLAN §3 first.
- js/config.js: CONFIG.textLayers boxMode defaults; nothing else.
- index.html / css/style.css: toggle markup, edge-handle styles, overflow indicator on the fixed box.

CONSTRAINTS
- One layer type; boxMode is data, not a new LayerType. Old history states without boxMode mean 'auto'.
- Plain JSON through history/clone with zero special-casing (boxMode/boxWidth/boxHeight live in textData).
- Preview↔export parity: the exported GIF must show the same line breaks as the DOM preview — acceptance requires an actual side-by-side with a wrapping multi-word string in a narrow box, not just a functional check.
- Fixed-mode overflow beyond boxHeight is hidden in BOTH pipelines identically (clip the mask canvas AND overflow:hidden the span), with a visible overflow indicator on the selection box.
- History: box edge-drag = one entry on release (like other transforms); mode toggle = one entry.
- Design-system patterns per TEXT-GLITTER-PLAN §4; alignment buttons stay, they're fully meaningful in fixed mode.
- Zero behavior change for stickers and for auto-mode text layers (default path must be byte-identical masks for the same inputs).

ACCEPTANCE CRITERIA
1. Default text layer behaves exactly as before (auto mode, hugging box, proportional corner scale).
2. Toggle to Box: box visually unchanged at first; dragging an edge reflows/wraps text live; corner handles still scale; rotation unaffected.
3. Wrapped preview matches wrapped export line-for-line (side-by-side check).
4. Overflow past boxHeight hidden identically in preview and export, indicator visible.
5. Undo/redo through mode toggles, edge drags, text edits in both modes.
6. Toggle back to Point: box re-hugs text, wrap disappears.
7. Sticker layers: no observable change, including handles.
```

### Goal C-1 — Canvas Size (resize document with anchor)

```
/goal Add a Canvas Size feature to the editor at c:\xampp\htdocs\glitter (vanilla JS, no build system). Design: docs/UX-PLAN.md §5 — follow it precisely. Read docs/MASK-FEATURE-PLAN.md §6 (paintHistory/maskVersion invariant) before touching any mask code.

OBJECTIVE
Modal that changes the document dimensions after art exists: width/height inputs (clamped to CONFIG.maxImageWidth/Height) + 9-position anchor grid. Existing content repositions per the anchor; growing pads with transparency; shrinking crops.

CORE OPERATION
resizeCanvas(newW, newH, anchor) → (dx, dy):
- Base image: redraw into a new canvas at (dx, dy).
- Sticker/text layers: transform.position += (dx, dy). Nothing else about their data changes.
- Glitter-fill layers: composite each layer's CURRENT mask into the new dimensions at (dx, dy) and push it as a NEW paintHistory baseline snapshot (new maskVersion — never mutate existing version binaries; undo to pre-resize states must still find their bytes). Selections arrays: offset coordinates, drop out-of-bounds entries.
- Viewport/artboard/zoom-fit refreshed; helper canvases in GifExporter must not cache stale dimensions.

CONSTRAINTS
- The resize is ONE history entry; undo restores the previous size, base image, positions, and masks exactly.
- UI follows the existing modal patterns (see ModalManager usage) and design-system controls; anchor grid is a 3×3 of btn-simple toggles.
- No change to export settings semantics; exported GIF dimensions follow the new canvas automatically.
- Zero behavior change when the modal is never opened.

ACCEPTANCE CRITERIA
1. Grow canvas each direction via each anchor: art lands where the anchor predicts; new area transparent.
2. Shrink to crop: content outside is gone in preview and export; glitter masks crop correctly.
3. Undo/redo across a resize restores everything (masks included); repaint after undo doesn't corrupt paintHistory.
4. FRAGILITY GAUNTLET (docs/AUDIT.md history): add animated sticker + glitter fill + text layer → resize → export → undo → export → resize again → export twice in a row. Every export correct.
5. Mobile: modal usable at mobile breakpoint.
```

## 10. Review round 2 — post T-2/T-3 fixes (2026-07-03, Fable)

Codex landed T-2 (border/shadow) and T-3 (point/box text). Ryan's review surfaced four issues; root causes and fixes, all applied and covered by the Playwright suite (`text-ux-smoke2.js`, 28 checks):

1. **Vertical align did nothing.** `getMeasurementEntry` unioned the ink bounds with the full box rect (`contentBottom` initialized to `layoutHeight`), so content height ≥ box height and the offset always clamped to 0. Fixed: in fixed mode the content rect IS the box; the valign offset is computed from the visible lines' actual ink extent.
2. **Preview text never scaled with the transform** (found during review — worse than reported). The wrapper grew with `transform.scale` but glyph font-size stayed fixed; export scaled the whole canvas. Fixed architecturally: `.text-glitter-stack` is now a local-space surface (sized to the mask canvas in text-local px) scaled by a CSS transform, kept live during drags via a `syncElementScale` hook in `LayerTransform.applyTransform`. Everything inside (padding, clip, frame vars) is in local units.
3. **Point mode.** No edge handles (was already true), corners scale (unchanged), but the frame (handles/outline/hit-test) now hugs the visible art — `entry.frameRect` = ink+effects bounds — instead of the padded mask canvas ("weird padding"). Vertical/paragraph alignment controls hidden via `#textSettingsSection[data-box-mode=auto]`.
4. **Box mode (Illustrator model).** Corners now ALWAYS scale (`resizeBoxFromCorner` removed); edge handles resize the box. The frame = the box rect exactly; DOM text is clipped at the box via per-span `clip-path: inset(...)` — applied before the span's translate so shadow/border offsets carry their clip with them, matching the export's offset-copies-of-clipped-mask exactly. Vertical align is baked into `padding-top` (not translate) so the clip stays fixed while text slides inside, again matching the canvas path. Converting Point→Box now captures the text block exactly (+1px anti-rewrap) instead of padding it.
5. **Frame offsets are local units** — `updateHandlePositions`, `getBoxResizeMetrics`, `applyResizedBoxRect`, and `isPointInText` now multiply them by `transform.scale` (they were used raw; handles/hit-tests drifted at ≠100% scale).
6. **Accordion off-screen overflow.** An open settings section now takes the remaining panel height and scrolls its own content (`.is-open:not(.main-section)` flex + `overflow-y: auto`), so long sections (Text Properties) can't push the other headers off screen.
7. **Selection outline** moved from the padded wrapper to `stack::after` at the frame rect (`--tf-*` vars), with outline widths compensated for zoom AND layer scale; the overflow indicator moved to the box corner.

**Still Ryan's:** visual pass on all of the above plus a real GIF export side-by-side (preview vs export) for a box-mode, bottom-aligned, border+shadow composition.

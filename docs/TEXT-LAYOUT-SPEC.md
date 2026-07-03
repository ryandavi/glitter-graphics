# Text Layout Spec — Point/Area Text, Glyph-Trimmed Bounds (Goal T-4)

**Date:** 2026-07-03 · **Status:** Ready for Codex handoff
**Companion docs:** `docs/TEXT-GLITTER-PLAN.md` (T-1/T-2 design), `docs/UX-PLAN.md` (§3 T-3 design, §10 review-round fixes)

Ryan's authoritative spec for how text layout must behave, written after using the T-3 implementation. Two live bugs plus a layout-model correction (Figma-style leading trim). This doc supersedes the bounds/alignment behavior described in UX-PLAN §3 where they conflict.

---

## 0. Current architecture (read before touching anything)

All in `js/classes/TextGlitterManager.js` unless noted:

- `getMeasurementEntry(layer)` is the single source of truth: measures lines (`measureLine` returns advance width + real ink extents via `actualBoundingBox*`, including a per-character path when `letterSpacing ≠ 0`), wraps in fixed mode (`wrapTextLines`), draws the white-on-transparent **mask canvas** (its alpha is the mask), and emits:
  - `paddingBox` — per-side padding applied to the DOM spans so the CSS layout box lands where the canvas drew;
  - `contentOffsetY` — vertical-align shift, baked into the DOM span's `padding-top` (NOT translate) so the clip stays fixed;
  - `frameRect` — the user-facing frame in canvas coords (box rect in fixed mode; ink+effects bounds in auto mode). Drives handles (`LayerTransform.getHandleFrame`), the selection outline (`--tf-*` vars on `.text-glitter-stack`, drawn by `stack::after`), and hit-testing (`LayerManager.isPointInText`).
  - Cache key = all text settings incl. boxMode/boxWidth/boxHeight/border/shadow params.
- **DOM preview** renders in local space: `.text-glitter-stack` is sized to the mask canvas in text-local px and scaled by a CSS `transform: scale()` (synced live during drags via `syncElementScale` called from `LayerTransform.applyTransform`). Fixed mode clips each span with `clip-path: inset(...)` at the box rect — applied *before* the span's translate so border/shadow offset copies carry their clip with them, which matches the export exactly.
- **Export** (`GifExporter`): pattern-fills glitter frames masked by the same canvas (`destination-in`); border/shadow are offset copies of the box-clipped fill mask (`_buildTextMaskEntry`). `_drawTransformedCanvas` draws 1:1 against `textData.width/height` — **the mask canvas dims must always equal `textData.width/height`**.
- **Handles** (`LayerTransform`): corners always SCALE (both modes) against the handle frame; edge handles exist only in fixed mode and resize the box via `resizeBoxFromHandle` → `applyResizedBoxRect`. Frame offsets are text-local units and are multiplied by `transform.scale` everywhere.
- **Invariants that must survive this goal:** preview↔export pixel parity (same measurement, same clip semantics); zero behavior change for stickers; plain-JSON history (`textData` only); `textContent` never `innerHTML`; mask canvas dims == `textData.width/height`.

Verification harness: two Playwright suites exist from previous rounds (session scratchpads, `text-ux-smoke.js` 37 checks / `text-ux-smoke2.js` 28 checks) — pattern: `editor.loadBlankImage(...)` → **wait for `editor.originalImage != null`** → `layerManager.addLayer(LayerType.TEXT_GLITTER)` → drive `textGlitterManager` directly and read the mask canvas pixels.

## 1. Live bugs to fix

### Bug A — Text box size is limited and gets clipped
Dragging the box's resize handles will not grow the box past a certain size; the box/text appears clipped. Reproduce with real mouse drags (programmatic `resizeBoxFromHandle` calls with +50px worked in the harness, so the limit is likely interaction- or rendering-level). Candidate causes to check, in order:
1. The preview/canvas container clipping layers at the artboard edge (`overflow: hidden` somewhere up the `.canvas-elements-container` / viewport chain) — the box may be growing correctly but rendering/handles get clipped once it exceeds the document bounds.
2. `resizeBoxFromHandle`/`applyResizedBoxRect`/`getBoxResizeMetrics` drag math — the drag measures against `dragStartState` (origin frozen at mousedown) while `applyResizedBoxRect` re-centers `transform.position` every mousemove; verify the box edge tracks the cursor 1:1 for large drags, with rotation and with `scale ≠ 100`.
3. `wrapTextLines` cost — it re-measures candidate strings token-by-token on every mousemove; with long text this may hitch enough to feel like a hard stop. If confirmed, throttle re-measure during edge drags (measure on rAF, commit on mouseup).

### Bug C — Magenta fringe around text edges on transparent exports
A few stray pixels the color of the fill glitter — or visibly **magenta** — appear around the text/border edge, but only when exporting with transparency (fine on a solid background). Root cause is confirmed, not a hypothesis: the text mask is drawn with `fillText`, which antialiases, so the mask has **semi-transparent edge pixels**. GIF transparency is 1-bit; during export those partial-alpha pixels composite over the transparency-key background — and the first key candidate is `Magenta 0xFF00FF` (`_findSafeTransparencyKey`, GifExporter.js ~line 657) — so the fringe literally picks up the key color. On a solid matte the same pixels blend into the matte and disappear. The border variant ("glitter-colored pixels outside the border") is the same mechanism: partial-alpha fill/border edges blending where they shouldn't.

**Fix at the source, not in the exporter:** binarize the text mask (Bug C fix == §2.6 crisp-edges feature). With no partial alpha there is nothing to blend with the key. Do NOT try to fix this by scanning/cleaning frames in GifExporter. **Status: the export half is already fixed by Fable (see §2.6) — Codex owes the matching hard-edged preview.**

### Bug D — Effects (Border/Shadow) source UI is broken and confusing
The swatch inside the "source" chip button doesn't render — only its border shows next to the name. Fable checked the markup/CSS: the `.text-effect-source-swatch` span is a correctly sized flex item (20×20, style.css ~4840) and `updateEffectSourceUI` does set inline `backgroundImage`/`backgroundColor` — so the likely cause is that the default solid source is **`#000000` rendered on the dark theme**: the chip paints, but black-on-dark reads as an empty bordered square. Verify in the browser first; regardless of root cause, solid swatches must stay visible on the dark theme (checker underlay behind the color, or equivalent). Beyond the bug, the layout is confusing: a big ugly full-width button, then a separate "Solid/Glitter" badge row under it. Redesign per §2.7.

**Ryan also reported: "choosing a glitter for the drop shadow overlays it on top of the solid color instead of replacing it."** Fable probed this live: the data model and render are provably exclusive — after picking a shadow glitter, `shadow.glitterId` is set, the shadow span has the glitter `background-image` with `background-color: transparent`, the fill is untouched, and the export source resolution (`_getTextEffectSource`) is either/or. What actually happens is **UI-state confusion**: after picking a glitter, the "Solid Color" row stays visible showing the old color and the "Use Solid Color" button sits beside a chip that doesn't clearly flip state — it *reads* as both being active. The §2.7 redesign must make the source state unambiguous: the color input is visible ONLY while the source is solid; when a glitter is active the row shows the glitter swatch + name with a way back to solid. Acceptance must include a visual check that a shadow switched solid→glitter shows pure glitter in preview AND export.

### Bug B — Point text bounds are not glyph-trimmed
In point mode the visible box does not hug the glyphs: `getMeasurementEntry` initializes the content bounds to the **layout box** (`contentTop = 0`, `contentBottom = layoutHeight` where `layoutHeight` comes from the `'Hg'` sample ascent/descent + `lineHeight` grid) and only *unions* ink outward. The frame can therefore never be smaller than the em/line-height box, so text without tall ascenders/descenders shows invisible padding — "the text goes outside / the box isn't perfectly around the text". Fix per §3.

## 2. Product spec (authoritative — from Ryan)

### 2.1 Point Text
Created from a single insertion point; **no container**.
- Bounds automatically hug the **visible glyph bounds** (trimmed, per §3). As text is added the object expands; new lines only via explicit `\n`; never auto-wraps.
- Horizontal alignment is **anchor behavior**, relative to the insertion point:
  - Left: text grows to the right of the anchor.
  - Center: text grows equally left and right.
  - Right: text grows to the left of the anchor.
- The visible bounding box always represents actual rendered glyph bounds, **not** a line-height box.

### 2.2 Area Text (Box)
Explicit rectangular container with user-controlled width and height.
- Text wraps to the container width. **Container dimensions are fully independent of the rendered text dimensions** — no coupling, no limits derived from the text.
- Paragraph alignment positions each line inside the container width: Left / Center / Right (Justify: see §6 — deferred).
- Vertical alignment positions the **trimmed visual text block** inside the container:
  - Top: visible top glyph bound aligns to the container top.
  - Center: visual block vertically centered.
  - Bottom: visible bottom glyph bound aligns to the container bottom.

### 2.3 Glyph-bound / leading-trim (Figma-style)
Do NOT use CSS line boxes, `line-height` boxes, the font em box, ascender/descender font metrics, or the canvas baseline box as the visual bounds.
- Position each line on the configured line advance (`fontSize × lineHeight` baseline grid), then take the **union of every line's actual glyph ink bounds** (`actualBoundingBoxAscent/Descent/Left/Right`). That union is the visual bounds.
- Leading exists **between lines only** — no invisible padding above the first line's ink or below the last line's ink.
- Vertical alignment math uses this trimmed box, never `fontSize × lineHeight` or the em box.

### 2.4 Overflow and box extension
- Area text clips to the container; if the laid-out text exceeds the container height, mark the layer overflowing (indicator exists: `.text-overflowing`).
- Dragging the **bottom edge** taller reveals clipped lines — font size, line height, scale, and wrapping unchanged.
- **Width** resize reflows (re-wraps); **height** resize only changes the visible area/overflow state.
- Edge drags change container dimensions ONLY — never `transform.scale`.

### 2.5 Three distinct bounds (make these explicit in the code)
1. **Container bounds** — the editable box rect (fixed mode only). Used for selection outline, edge/corner handles, hit-testing.
2. **Visual text bounds** — trimmed union of rendered glyph ink (+ border/shadow extents where the frame is user-facing in point mode). Used for all alignment math, and as the frame in point mode.
3. **Overflow bounds** — full laid-out text extent including clipped lines. Used to compute the overflow flag (and nothing else).

The current clipping/alignment defects come from mixing these: text is positioned by line-height/baseline metrics while clipping against the container. Replace with glyph-bound-aware layout: lay lines on the baseline grid, compute the ink union, align the union inside the container.

### 2.6 Crisp pixel edges (default — Ryan's call, matches the aesthetic)
Text must NOT look smooth. Glyph edges are hard pixels, like the rest of the editor (MASK-FEATURE-PLAN §12 decision 5: crisp is the only mode).

- ✅ **DONE (Fable, 2026-07-03) — do not re-implement, build on it:** the mask canvas is binarized at the end of `getMeasurementEntry` (`alpha >= 128 ? 255 : 0`), gated behind `CONFIG.textLayers.crispEdges: true` (default true). Verified via harness: zero partial-alpha pixels, glyph ink intact, edge ring clear. This already fixes Bug C in the **export** — border/shadow masks are offset copies of the binarized fill mask, so they inherit it.
- What remains for Codex is the preview half. **The DOM preview must show the same hard edges.** Today the preview renders live text via `background-clip: text` — browser-antialiased, so it can never match a binarized mask. Switch the preview spans from `background-clip: text` to **`mask-image` fed by the shared mask canvas** (blob URL): span = glitter `background-image` + `mask-image: url(blobUrl)` + `mask-size: <canvas dims>px`, `mask-repeat: no-repeat`. One mask serves fill/border/shadow spans exactly like the export (border/shadow spans keep their translate offsets; the mask travels with the span the same way clip-path did — the fixed-mode `clip-path` can then be dropped since the mask is already box-clipped).
- This makes preview↔export parity **exact by construction** (same pixels, same source) and retires the CSS-line-box-vs-canvas-baseline residual for good. The spans no longer need text content for rendering — but keep setting `textContent` OFF the painted spans (or `aria-label` on the wrapper) is unnecessary; simply note the text is no longer selectable in the preview (it never usefully was).
- **Flicker rule (mandatory):** blob mask URLs must follow the exact pattern GlitterManager uses for painted masks (MASK-FEATURE-PLAN decision 6): preload the new URL via `Image` before swapping the style, revoke the old URL after the swap, never set `mask-image: none` between states. Regenerate on the existing typing debounce (`CONFIG.sliderDebounceMs`) — during fast typing it is acceptable for the glyph update to lag by the debounce, since the mask is the only render path now.

### 2.7 Effects panel redesign (Border / Shadow as their own sub-sections)
Ryan's call: Border and Shadow each become their own `subsection-content-group` inside the Text Properties section (the same visual grammar as "Text" / "Font" / "Layout" / "Fill"), replacing the current chip-button + badge stack:

- Sub-section title row: the group title ("Border" / "Shadow") with its `checkbox-group` enable toggle inline on the title row.
- When enabled, the group body shows:
  - the sliders (width, or offset X/Y) in the existing `setting-column` pattern — unchanged;
  - a single **source row**: a **swatch chip** (~28px square, actually rendering the current source: glitter tile via `background-image`, or flat color over a checker underlay so dark colors stay visible) + the source name ("Silver Chunky" / hex) as plain text + a small `btn-simple` "Change" targeting the glitter browser at that slot (existing selection-target mechanism). Clicking the swatch also opens the picker.
  - **Source exclusivity in the UI (Bug D follow-through):** while a glitter is active, the solid color input is hidden and the row offers "Use Solid Color"; while solid is active, the color input shows and the row offers "Use Glitter". Exactly one source ever reads as active. NO second badge row, NO full-width labeled button.
- Fix the swatch rendering bug (Bug D) as part of this — the chip must visibly show the glitter/color at all times.

### 2.8 Text tool in the toolbar
Add a **Text tool** ("T" icon, keyboard shortcut `T` — currently unused; V/I/B/H/Z are taken) to the left toolbar, matching the existing tool patterns (`ToolType.TEXT`, toolbar button, cursor: text/crosshair, hint copy):

- Clicking the canvas with the Text tool creates a **point-text layer whose insertion point is the click position** — this is what the §2.1 anchor model exists for: the anchor lands where the user clicked (left-aligned by default: text grows right from the click; the anchor/alignment relationship per §2.1).
- After creation: switch to SELECT (the editor's existing add-layer convention), select the new layer, focus the text input with the placeholder pre-selected (same behavior as adding via the layer picker; respect the mobile guard in `focusTextInput`).
- The existing add-text paths (layer picker modal, bottom-bar button) stay and keep their center-of-canvas default position.
- Tool must not steal interactions from other layer types: it only creates on empty-canvas clicks; clicking while the tool is active never drags/scales existing layers.

## 3. Implementation notes (mapping the spec onto the current code)

- **Trim in `getMeasurementEntry`:** in auto mode, stop seeding the content bounds with the layout box — compute the pure ink union over lines (`contentLeft/Right/Top/Bottom` from ink only; guard empty text/empty lines with a zero-size fallback at the anchor). In fixed mode, keep container = box rect for the canvas/clip, but the valign block must use the trimmed ink union of the *visible* lines (it already does — keep).
- **DOM parity mechanism stays as-is:** the trim only changes the numbers flowing into `paddingBox`/`contentOffsetY`. The CSS span still lays out with normal line boxes; `paddingBox` places the layout grid inside the canvas and the canvas draws on the same grid, so trimming the *canvas/frame* bounds requires no CSS leading-trim (`text-box-trim` is NOT required and must not be used — parity comes from our own math).
- **Point-text anchor behavior:** `transform.position` remains the element center in canvas space. On any re-measure caused by a user edit (typing commit, font/size/spacing/align change) in auto mode, compensate `position` so the **anchor stays fixed**: anchor = top-left of the frame for left align, top-center for center, top-right for right. Compute old frame → new frame, shift `position` by the anchor delta rotated by `transform.rotation` and scaled by `transform.scale`. Do this at the edit call sites (or centrally in `refreshLayer` given a `preserveAnchor` flag) — NEVER inside `getMeasurementEntry`, and NEVER during history restore/clone/undo (stored positions are already correct). Changing alignment itself re-anchors: the anchor point stays put and the text flips to the other side (Illustrator behavior).
- **Paragraph alignment visibility:** show the Paragraph control in BOTH modes now (in point mode it drives the anchor + relative multi-line alignment). Vertical align stays hidden in point mode (`#textSettingsSection[data-box-mode=auto] .text-valign-*` CSS — remove the `.text-align-*` selectors from that rule).
- **Container independence (Bug A):** whatever the root cause, the container must grow without limit (clamped only by `minBoxSize`); if the artboard-clipping hypothesis (§1 A-1) is confirmed, layers and their handles must render beyond the document bounds like stickers do (check what `.sticker-element` does differently, if anything — handles live in `canvasElementsContainer`).
- **Frame/outline/hit-test:** `entry.frameRect` keeps the same role; in point mode it becomes the trimmed visual bounds (+effects), in fixed mode the container. `--tf-*` vars, `getHandleFrame`, `isPointInText` need no structural change — only correct numbers.
- **Mask canvas** still = frame-relevant content + `maskPadding` ring + effect margins, and its dims must equal `textData.width/height` (export 1:1 invariant).

## 4. Acceptance criteria

1. **Trim:** point text `"ooo"` (no ascenders/descenders past x-height) has a frame that hugs the round glyphs — measurably shorter than `fontSize × lineHeight`; `"Hg"` hugs the H top and g descender. No gap above the first line or below the last in either mode. Verify by reading mask pixels against `frameRect` (top/bottom ink rows within 1px of the frame edges).
2. **Point anchor:** with left align, typing more text extends the frame right while the left edge stays fixed (canvas position unchanged); center extends both ways symmetrically; right extends left. Adding a `\n` grows downward, top edge fixed. Switching alignment keeps the anchor point stationary and moves the text.
3. **Box independence:** the container can be dragged to at least the full document size and beyond in every direction, at 100% and 200% scale, rotated and not — the edge tracks the cursor 1:1, nothing clips the box or its handles, text never scales.
4. **Overflow reveal:** text taller than the box shows the overflow indicator; dragging the bottom edge down progressively reveals whole lines without any change to wrapping, font size, or scale.
5. **Vertical align:** top/center/bottom position the trimmed block per §2.2 (ink flush at top for Top, flush at bottom for Bottom, centered for Center) — verify via mask ink centroid and edge rows, all three fonts classes (Luckiest Guy, Pacifico script, Shrikhand).
6. **Parity:** exported GIF matches the DOM preview pixel-for-pixel in placement for: point multiline center-aligned; box bottom-aligned overflowing; box with border+shadow at 150% scale, rotated 20°. Actual side-by-side, not a functional check.
7. **No regressions:** both existing smoke suites' assertions still hold (mask ink never clipped at canvas edge in point mode; frame==box in fixed mode; scale parity via the stack transform; accordion; stickers untouched). Undo/redo through typing, mode toggles, edge drags, align changes. Export twice in a row (fragility gauntlet, docs/AUDIT.md).
8. **Crisp edges / no fringe (Bug C + §2.6):** the DOM preview shows the same hard pixel edges as the mask (mask-image path, no `background-clip: text` left in the text render path); a transparent export over the magenta key shows ZERO fringe pixels around fill and border edges (pixel-scan the exported first frame around the glyph boundary); `CONFIG.textLayers.crispEdges: false` restores antialiased masks end to end.
9. **Effects UI (Bug D + §2.7):** Border and Shadow are their own sub-sections with inline toggles; the source swatch visibly renders its glitter tile or solid color at all times (including black on the dark theme); exactly one source reads as active — after switching a solid shadow to a glitter, the color input is hidden and the rendered shadow is pure glitter in preview AND export (no perceived "overlay"); picking a glitter for border/shadow still targets the right slot via the existing selection-target mechanism.
10. **Text tool (§2.8):** pressing `T` (or clicking the toolbar button) then clicking the canvas creates a point-text layer anchored at the click position (left align: text grows right from the click point); focus/select behavior matches the existing add-layer flow; the tool never drags or scales existing layers; existing add paths unchanged.
11. **Zoom crispness:** at 400% zoom the text glyphs render as enlarged hard pixels (bitmap zoom of the binarized mask via the §2.6 mask-image path), matching the already-pixelated canvas and glitter surfaces — not smooth vector edges.

## 5. Out of scope

- **Justify** paragraph alignment — deferred. Our wrap runs in `wrapTextLines`, but the DOM preview is a single span per paint source; per-line word-spacing control would require per-line spans in the DOM to keep parity. Design it later; do not fake it with CSS `text-align: justify` (browser justification will not match the canvas glyph-for-glyph).
- Text on a path, per-character styling, `text-box-trim` CSS (explicitly banned above), font uploads.

## 6. Codex Task

### Goal T-4 — Glyph-trimmed text layout, point anchors, unlimited containers

```
/goal Rework text layer layout in the editor at c:\xampp\htdocs\glitter (vanilla JS, no build system) to glyph-trimmed bounds with correct point/area text semantics. Full spec: docs/TEXT-LAYOUT-SPEC.md — follow it precisely; §0 describes the current architecture and hard invariants, §1 the two live bugs, §2–§3 the required behavior and implementation mapping, §4 the acceptance criteria.

FIX FIRST (diagnose, then fix):
- Bug A (§1): the text box cannot be resized past a limit and gets clipped. Reproduce with real mouse drags on the edge handles; work through the three candidate causes in the listed order before changing any math.
- Bug B (§1): point-text bounds include the line-height box instead of hugging glyph ink — fix via the §3 trim change.
- Bug C (§1/§2.6): the export half is ALREADY FIXED (mask binarization landed, CONFIG.textLayers.crispEdges) — implement the preview half: switch the text preview spans from background-clip:text to mask-image fed by the shared (binarized) mask canvas, following §2.6's flicker rule exactly.
- Bug D (§1/§2.7): effects source UI — fix the invisible swatch, rebuild Border/Shadow as their own sub-sections with an unambiguous exclusive source row per §2.7 (this also resolves the reported "glitter overlays the solid shadow" — verified to be UI-state confusion, not a render bug).

ALSO IN SCOPE
- §2.8 Text tool: toolbar "T" tool (shortcut T, ToolType.TEXT) — click on canvas creates a point-text layer anchored at the click position using the §2.1 anchor model; existing add paths unchanged.
- §2.6's mask-image preview is also what makes text zoom crisp (spec §4 item 11): the preview inherits image-rendering: pixelated from .preview-wrapper (already in place), so once glyphs render from the binarized mask they zoom as hard pixels instead of smooth vectors.

MODIFIED FILES (expected)
- js/classes/TextGlitterManager.js — trimmed ink union in getMeasurementEntry (auto mode drops the layout-box seed; keep the existing binarization step last), anchor-preserving re-measure for point text (refreshLayer-level, never in getMeasurementEntry, never on history restore), frameRect numbers, overflow bounds, mask-image preview path (blob URL lifecycle per §2.6).
- js/classes/LayerTransform.js — only if Bug A's root cause lives in the drag math; corners must keep scaling, edges must keep resizing the container only.
- js/classes/LayerManager.js — isPointInText stays frame-based (numbers change only).
- css/style.css — show Paragraph alignment in point mode (remove .text-align-* from the data-box-mode=auto hide rule; keep .text-valign-* hidden); mask-image span styles; effects source row styles (§2.7); any fix required if layers/handles are being clipped at the artboard (Bug A cause 1).
- index.html — effects source row markup (§2.7); otherwise only if control grouping needs it.
- NO changes to GifExporter's compositing model: the mask canvas dims must remain equal to textData.width/height and border/shadow must remain offset copies of the box-clipped fill mask.

CONSTRAINTS
- Preview↔export parity is the prime invariant: same measurement feeds both pipelines; the paddingBox/contentOffsetY parity mechanism stays (no CSS text-box-trim).
- Plain-JSON history; boxMode/boxWidth/boxHeight stay the only container state; no new layer types.
- Zero behavior change for stickers and glitter-fill layers; textContent only for user strings; design-system UI patterns per TEXT-GLITTER-PLAN §4.
- LF line endings (repo-enforced), tabs in JS, no modules/build step.

ACCEPTANCE
All nine items in spec §4, verified with a Playwright script following the harness pattern in §0 (loadBlankImage → wait originalImage → addLayer → drive textGlitterManager, read mask pixels) PLUS a manual visual pass. Export the §4-item-6 compositions twice in a row.
```

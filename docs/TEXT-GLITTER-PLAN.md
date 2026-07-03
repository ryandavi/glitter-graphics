# Text Glitter Layers — Implementation Plan

**Date:** 2026-07-02 · **Status:** Goal T-1 SHIPPED (commit 5fe928d, 2026-07-03). Fable §8 review checklist done 2026-07-03 (code-level items all pass; the antialiasing *visual* side-by-side remains a manual pass). Post-T-1 UX round + measurement fix: see `docs/UX-PLAN.md`. Goal T-2 prompt added below; T-3 (point/area text) lives in UX-PLAN.
**Companion docs:** `docs/AUDIT.md`, `docs/MASK-FEATURE-PLAN.md`, `docs/UX-PLAN.md`

## Product model

- A **text glitter layer** is a new layer type: the user types text, and the text shape acts as the mask for a chosen glitter swatch.
- One text string + one glitter per layer. Multicolor text = multiple layers (same philosophy as the mask plan).
- Text stays **editable forever** — the layer stores the string + font settings, never a baked bitmap. Change the text, font, or glitter at any time.
- Text layers move/scale/rotate/flip exactly like stickers (drag, transform handles, pinch on mobile).
- The old `js/classes/TextLayerManager.js` prototype has been deleted; this plan starts fresh (it did point the right way: `LayerTransform` already supports `textData`).

**Relationship to the mask feature:** independent — text layers do *not* use the painted-mask system, and neither feature blocks the other. They share existing infrastructure (`LayerTransform`, `LAYER_UI_CONFIG`, the glitter browser) rather than each other's new code. Keep the plans separate; build text after the audit goals land (either before or after the mask feature — mask first is the suggested order simply because it's already specced and queued).

**The mask feature HAS landed first (M-1 + tool refactor, 2026-07-03).** Consequences for this plan: the type-switch chains (`app.js` visibility filters, `HistoryManager.createStateSnapshot`/`restoreState`, `LayerManager` per-type branches) already carry mask-related `GLITTER_FILL` changes — add `TEXT_GLITTER` as a sibling branch, don't re-derive those functions from this doc's snippets. `layerHasVisibleContent()` already exists in `js/config.js` next to `LAYER_UI_CONFIG` — add a `TEXT_GLITTER` case there; the three visibility call sites already route through it. `ToolType.BRUSH` exists; glitter layers' `onActivate` checks `currentTool !== ToolType.BRUSH` before auto-switching tools — the `TEXT_GLITTER` `onActivate` must not steal the tool either (go to SELECT only if the current tool is layer-inappropriate).

Out of scope for v1: per-character styling, text on a path, painted masks on text layers, user font uploads, emoji. Border (outline) and drop shadow are **designed but deferred** — see §4.5; v1 must reserve their schema fields.

**Crisp edges are the default and only mode (matches MASK-FEATURE-PLAN §12 decision 5):** no feather/soften controls on text layers. Glyph edges get whatever antialiasing the font rasterizer produces — identical in preview and export since both use the same engine — and nothing beyond that.

---

## 1. Fonts — the big decision

**Self-hosted curated set, not the live Google Fonts API.** Reasons:

1. **Canvas + parity requirement.** Both the preview and the GIF export rasterize text with the browser's font engine. If a font isn't *actually loaded* when we draw, `fillText` silently falls back to a default font and the export is wrong. Self-hosting + the `FontFace` API gives us an explicit, awaitable load (`await font.load()`) before any render. The Google Fonts stylesheet approach makes load state guessable at best.
2. **Consistency.** We just removed the last CDN dependencies (audit C3). Fonts from `fonts.googleapis.com` would reintroduce a runtime third-party dependency, plus the GDPR/IP-logging concern.
3. **It's free and legal.** Google Fonts are OFL/Apache licensed — self-hosting is explicitly allowed. Download woff2 subsets via *google-webfonts-helper* (gwfh.mranftl.com) or fontsource. ~20–40 KB per face.

**Curated starting set** — glitter needs *thick* strokes; thin fonts show almost no texture, so the list is chunky display faces plus one script and one clean sans, all OFL:

| Font | Vibe |
|---|---|
| Luckiest Guy | fat cartoon caps (good default) |
| Bungee | bold urban display |
| Titan One | rounded heavy |
| Lilita One | friendly chunky |
| Bangers | comic shout |
| Chewy | playful rounded |
| Shrikhand | fat retro serif |
| Pacifico | thick script |
| Lobster | classic script |
| Baloo 2 (Bold 700) | clean rounded sans |

**Data-driven, matching the codebase pattern:** `data/fonts.json` manifest (like `glitter.json`):

```json
[{ "id": "luckiest-guy", "name": "Luckiest Guy", "file": "fonts/luckiest-guy.woff2",
   "weight": 400, "fallback": "cursive", "featured": true }]
```

**Status: the font assets are already in the repo (added 2026-07-02)** — all 10 latin-subset woff2 files in `fonts/`, plus `data/fonts.json` and `fonts/OFL.txt`. Implementation consumes them as-is; no downloading step remains.

Files live in `fonts/`. Fonts load lazily via `FontFace` — the picker loads all faces when first opened (small files, one-time), and `TextGlitterManager.ensureFontLoaded(id)` awaits before any mask render. Adding a font later = drop in a woff2 + one JSON entry, no code.

**Loading must not depend on the picker having been opened.** A text layer can enter the document without the user ever opening the font picker this session — undo/redo landing on a text-layer state, `cloneLayer`, or a saved composition reloaded later. `TextGlitterManager.renderLayer()` (DOM preview) and layer creation/restore must call `ensureFontLoaded(layer.textData.fontId)` themselves, not rely on the picker having pre-warmed it — otherwise the CSS `background-clip: text` preview silently falls back to the browser default font (looks fine, is wrong) until the picker happens to be opened. `ensureFontLoaded` also needs an error path: if the woff2 fetch fails (bad path, offline), reject with a message and surface a toast, mirroring the existing `img.onerror` pattern used for sticker loads — don't let a failed font load hang the awaited promise or silently draw with a fallback in the exported GIF.

## 2. Data model

New `LayerType.TEXT_GLITTER = 'text-glitter'`. Layer shape:

```js
{
  id, type: LayerType.TEXT_GLITTER, name: <text excerpt>, visible: true, locked: false,
  selectedGlitterId: CONFIG.defaultGlitterId,   // same field name as glitter layers
  settings: { scale: 100, opacity: 100 },       // glitter texture scale/opacity (threshold/feather/etc. N/A)
  textData: {
    text: 'sparkle',
    fontId: 'luckiest-guy',
    fontSize: 64,              // base px in canvas space (transform.scale multiplies it)
    letterSpacing: 0,          // px
    lineHeight: 1.1,           // multiline via \n in a textarea
    align: 'center',           // 'left' | 'center' | 'right' (multiline only)
    width: 0, height: 0,       // measured text-block bounds, kept current by the manager
    transform: { position, rotation, scale{x,y}, proportionalScale, opacity, flipX, flipY } // sticker-identical
  }
}
```

Everything is plain JSON → **serializes through the existing history system with zero special-casing** (no sticker-style frames/flags problem, by construction).

## 3. Rendering

### Text mask (shared by preview + export)

`TextGlitterManager.renderTextMask(layer)` → offscreen canvas in **text-local space**:
measure each line (`ctx.measureText` + `actualBoundingBoxAscent/Descent`, manual per-character advance when `letterSpacing ≠ 0`), size the canvas to the text block + small padding, `fillText` each line in white. The canvas **alpha is the mask**. Cached per `(text, fontId, fontSize, letterSpacing, lineHeight, align)`; invalidated on any text setting change. `textData.width/height` updated from the measurement (feeds `LayerTransform.getDimensions()`).

**Amended 2026-07-03 (UX-PLAN §2):** sizing from `'Hg'` metrics + advance widths clipped display-face ink (swash overhangs, tall caps) → cut-off previews and a grey sheared edge in exports. `getMeasurementEntry` now measures **per-line actual ink bounds** and sizes the canvas to the union of the layout box and the ink, and the DOM span gets per-side padding (`entry.paddingBox`) so the CSS layout box stays aligned with the mask. Anything extending the mask (T-2's border/shadow, T-3's wrap) must extend the ink-bounds math, not reintroduce fixed padding.

### DOM preview — CSS does the work

The preview element is a sticker-like positioned `<div>` containing the *actual text*, styled:

```css
background-image: url(<glitter.gif>);
background-size: <glitter frame width × settings.scale/100>px;
-webkit-background-clip: text; background-clip: text;
color: transparent;
opacity: <settings.opacity/100>;
```

This gives **animated glitter inside crisp text for free** — the GIF animates natively as a background image, no canvas compositing, no frame loop. Positioning/rotation/scale via `LayerTransform.applyTransform` (its `textData` branches already exist). Parity with export holds because both paths use the same browser font rasterizer.

*(Note: `applyTransform` writes `element.style.cssText` wholesale — the text-specific styles must be applied to an inner child element, or the manager re-applies them after transform. Use an inner `<span class="text-glitter-content">`.)*

**No-flicker invariant (learned in the mask feature — MASK-FEATURE-PLAN §12 decision 6):** `TextGlitterManager` MUST override `ContentManager.renderContent` with the same reconcile-in-place pattern `GlitterManager.renderContent` now uses (remove stale elements, update live ones, never clear-and-rebuild). The base class destroys and recreates every element on each `updatePreview` — which fires on every keystroke debounce, slider change, and history step — restarting the animated GIF background each time (visible blink) and re-rasterizing the text mid-typing. Text layers have no mask blobs, so this is the one invariant from decision 6 that applies — copy the GlitterManager override, don't inherit the base behavior.

**Security note:** the text string is user input rendered into the DOM. Set it via `span.textContent = layer.textData.text`, never `innerHTML` — the inner span must never be built from a template string containing the raw text.

### GIF export

New branch in `GifExporter._renderFrame`'s layer loop (mirrors the sticker branch):
1. Per layer, once per export: `renderTextMask(layer)` (font ensured loaded during `_loadMissingFrames`, which also lazy-loads the glitter's frames exactly as it does for glitter-fill layers).
2. Per frame: pattern-fill the current glitter frame into a text-local canvas (same `createPattern`/scale logic as the glitter branch), `destination-in` the text mask, then transform-draw onto the main canvas with the same translate/rotate/scale/flip/opacity math as `_renderLayerToCanvas`. Extract that transform-draw into a small shared helper so stickers and text use one implementation.
3. `_calculateTotalFrames` / `_findSafeTransparencyKey`: treat the text layer like a glitter layer (frame count = its glitter's frame count; scan its glitter frames for the transparency key — already covered if it reuses the glitter lookup by `selectedGlitterId`).

## 4. UI

- **Layer type picker modal** gets a third option ("Text"); optional quick-add button in the layers bottom bar next to the existing glitter/sticker buttons.
- **Design panel:** new `textSettingsSection` registered in `LAYER_UI_CONFIG[TEXT_GLITTER]` — `designPanelSections: ['glitterSearchSection', 'glitterOptions', 'textSettingsSection', 'layerSettingsSection']` so the **existing glitter browser is reused** for picking the fill. `mobileSettingsSections: ['tool', 'glitter', 'text']` (text section cached/moved by MobileManager like the others).
- **Text section controls:** textarea (multiline), font picker (each option rendered in its own face), font size slider, letter-spacing slider, alignment segmented control. Scale/opacity of the glitter texture reuse the existing glitter settings sliders.
- **Design-system conformance (learned in the mask UI pass, 2026-07-03):** panel buttons are plain `btn-simple` (`btn-text-with-icon` is a modal/welcome-only pattern); boolean options are `checkbox-group` inside `tool-options-group`; sliders use `setting-column`/`settings-group-two-column` wired through `setupSlider()` (live value + reset); the alignment control follows the `mask-mode-buttons` segmented `btn-simple` pattern (see the Paint/Erase pair). Any view-only toggle belongs in preview-controls, not the panel. Control labels must use the same name everywhere they appear (panel, tooltips, hints).
- New layer starts with placeholder text (`CONFIG.textLayers.defaultText`) pre-selected in the textarea so typing replaces it immediately; the layer renders centered on canvas from the first keystroke (debounced ~150 ms re-measure, reuse `CONFIG.sliderDebounceMs`).
- **History granularity:** one history entry per typing pause (saveState on the debounce boundary), never per keystroke — same principle as one-entry-per-stroke in the mask feature. Font/size/spacing/alignment changes are one entry each.
- Layer list: name = text excerpt (first ~18 chars), type line = `Text / <glitter name>`, swatch = glitter thumbnail with a "T" glyph overlay.

## 4.5. Border & drop shadow (designed 2026-07-03, deferred to Goal T-2)

Ryan's ask: text should optionally get a **border (outline)** and/or a **drop shadow**, each with its own swatch — solid color *or* glitter. Designed now so T-1's schema doesn't paint us into a corner; **not built in T-1**.

**Schema (T-1 must reserve these, shipping as `null`):**

```js
textData: {
  ...,
  border: null | { widthPx: 4, glitterId: null, color: '#000000' },   // glitterId wins if set
  shadow: null | { offsetX: 6, offsetY: 6, glitterId: null, color: '#000000' }
}
```

Plain JSON → flows through history/clone untouched, and `null` means T-1 behavior exactly.

**Rendering technique — offset-copies, one method for both pipelines:**

- **Shadow:** draw the same glyph mask offset by `(offsetX, offsetY)` *behind* the fill, filled with the shadow's swatch. DOM: a duplicated inner span (own `background-image` + `background-clip: text`, translated, `z-index` below the fill span). Export: same pattern-fill as the main branch, mask drawn at the offset, before the fill.
- **Border:** `-webkit-text-stroke` can't take a glitter fill, so build the outline as **N offset copies of the glyph mask arranged in a circle of radius `widthPx`** (8 copies for thin, 16 for thick), unioned, behind the fill — the classic shadow-stroke trick. The fill draws on top, so the visible result is a ring. Works *identically* in DOM (N stacked spans) and export (N offset `drawImage` of the cached text mask into a border-mask canvas, then pattern-fill). If fill opacity < 100 the interior of the border union would show through — in that case `destination-out` the fill mask from the border mask in the export path, and accept the minor DOM discrepancy or clip likewise with an extra canvas.
- **Draw order:** shadow → border → fill.

**UI sketch:** two toggles in `textSettingsSection` (Border / Shadow), each expanding a row: width or offset slider + a swatch chip that opens the existing glitter browser targeted at that slot, plus a solid-color fallback input. The browser reuse needs a "selection target" concept (fill / border / shadow) — small extension to `GlitterManager.selectGlitter`'s text branch.

**Costs to acknowledge:** each glitter-filled border/shadow multiplies export pattern fills per frame (shadow ×1, border ×N drawImages but only 1 pattern fill of the unioned mask), and `_calculateTotalFrames`/transparency-key scanning must consider up to three glitter ids per text layer. All contained in TextGlitterManager + GifExporter's text branch.

## 5. Integration points (the "same concept, one representation" checklist)

Every site below currently switches on sticker/glitter/base — each needs a text branch:

| Site | Change |
|---|---|
| `js/classes/HistoryManager.js createStateSnapshot()` / `restoreState()` (history logic lives here since audit Goal 4, NOT in app.js) | plain JSON copy branch for `TEXT_GLITTER` (textData + selectedGlitterId + settings) |
| `layerHasVisibleContent()` in `js/config.js` | **already exists** (mask feature landed first) — add one `TEXT_GLITTER` case returning `layer.textData.text.trim() !== ''`; the three visibility call sites (updatePreview filter, updateActionButtons, exportAnimatedGif filter) already route through it, do not touch them |
| `GlitterManager.selectGlitter()` | accept TEXT_GLITTER layers (currently errors on non-glitter-fill); on select, update the text element's background-image |
| `LayerManager.handleLayerPick` | hit-test with the same rotated-box math as `isPointInSticker` — generalize it to `isPointInTransformBox(transform, width, height, x, y)` and use for both |
| `LayerManager.createLayerElement` / `updateMobileLayersSwatch` / `cloneLayer` | text branches (clone is a plain deep copy — trivially safe) |
| `LayerManager.addLayer` / layer type picker | new type |
| `LAYER_UI_CONFIG` | new entry with `onActivate` → SELECT tool, load text settings, focus nothing (don't steal focus on mobile) |
| `updateHelpfulMessage` | hints for empty text layer ("type something…"), text selected, etc. |

`LayerTransform` needs **no changes** — `getTransform()`/`getDimensions()` already handle `textData`, and drag/handles/touch come along automatically.

## 6. CONFIG additions

```js
textLayers: {
  fontsManifest: 'data/fonts.json',
  defaultFontId: 'luckiest-guy',
  defaultText: 'sparkle',
  defaultFontSize: 64, minFontSize: 12, maxFontSize: 256,
  defaultLetterSpacing: 0, minLetterSpacing: -5, maxLetterSpacing: 40,
  lineHeight: 1.1,
  maskPadding: 8,          // px around measured bounds (protects antialiased edges)
  maxTextLength: 200
}
```

## 7. Acceptance criteria

1. Add a text layer, type "hello", pick a glitter → animated glitter text appears centered, live while typing.
2. Change font from the picker → text re-renders in the new face in preview **and** in the next export (no fallback-font exports).
3. Drag / handle-scale / rotate / flip the text like a sticker; pinch-scale on mobile.
4. Multiline text (\n) with left/center/right alignment renders correctly in preview and export.
5. Letter spacing and font size sliders update live.
6. Undo/redo steps through text edits, font changes, glitter changes, and transforms.
7. Exported GIF matches preview: glitter animates inside the text, correct position/rotation/scale, correct alongside sticker and glitter-fill layers in the same composition. Check text-edge antialiasing specifically, not just overall placement — the DOM path (`background-clip: text`) and export path (canvas `fillText` + `destination-in`) are different rendering pipelines that happen to share the same font engine; "same rasterizer" is a reasonable bet, not a guarantee, so this needs an actual side-by-side look, not just a functional check.
8. Two text layers with different glitters stack and reorder correctly.
9. Font files load only when the feature is used (no cost to users who never add text).

## 8. Execution split

**Codex or Sonnet (implementation):** Goal T-1 below, as-is — fully specced including the eager-font-loading, textContent, and font-error-handling requirements added to §1/§3/the CONSTRAINTS block. Mechanical execution against a detailed spec, same profile as the AUDIT.md goals.

**Fable (this planning track — review only, not implementation):**
- After T-1 lands, specifically verify the three gaps called out in §1/§3 weren't silently skipped since they're easy to miss if the implementer works straight from the acceptance criteria in §7 without re-reading the prose:
  1. Undo/redo/clone/reload onto a text layer whose font was never opened in the picker this session still renders in the correct font (not a fallback) — test by restoring history onto a text layer state in a fresh page load if possible, or at minimum via a direct `ensureFontLoaded` call bypass in devtools.
  2. Grep the diff for `innerHTML` near the text-layer rendering code — should be zero hits; text content must go through `textContent`.
  3. Break a font path on purpose (rename a woff2 temporarily) and confirm a toast appears instead of a hang or silent fallback.
- The antialiasing side-by-side from §7 item 7 — an actual visual compare, not just "it exported."
- If T-1 lands after the mask feature, confirm it added a `TEXT_GLITTER` case to `layerHasVisibleContent()` (see `docs/MASK-FEATURE-PLAN.md` §6.5) rather than re-adding a third copy of the three-site conditional.

---

## Codex Task

### Goal T-1 — Text glitter layers

```
/goal Implement text glitter layers in the editor at c:\xampp\htdocs\glitter (vanilla JS, no build system). Full design: docs/TEXT-GLITTER-PLAN.md — follow it precisely; treat sections 1–7 as the spec.

PREREQUISITE: docs/AUDIT.md Goal 3 must be merged (this feature extends GifExporter and must build on the cleaned export path).

OBJECTIVE
New layer type 'text-glitter': user types text, chooses a font from a curated self-hosted set and a glitter from the existing browser; the text shape masks the glitter. Text layers transform like stickers and export to GIF with animated glitter inside the letters.

NEW FILES
- js/classes/TextGlitterManager.js — fonts manifest loading, FontFace lazy loading with ensureFontLoaded(id), createLayer(), renderLayer() (DOM element with inner span using background-clip:text per plan §3), renderTextMask(layer) with measurement + caching, text settings UI wiring. MUST override renderContent with the reconcile-in-place pattern from GlitterManager.renderContent (plan §3 no-flicker invariant) — never inherit ContentManager's clear-and-rebuild.

ALREADY IN THE REPO (do not create or download): data/fonts.json (manifest per plan §1), fonts/*.woff2 (all 10 faces, latin subset), fonts/OFL.txt. Consume them exactly as committed — font ids in code must match the manifest ids.

MODIFIED FILES — follow the integration table in plan §5 exactly:
- js/config.js: LayerType.TEXT_GLITTER, CONFIG.textLayers block (plan §6), LAYER_UI_CONFIG entry, TEXT_GLITTER case in the existing layerHasVisibleContent() (the visibility call sites already route through it).
- js/app.js: updateHelpfulMessage hints, text settings listeners.
- js/classes/HistoryManager.js (NOT app.js — history was extracted there in audit Goal 4): createStateSnapshot/restoreState text branch (plain JSON copy of textData + selectedGlitterId + settings).
- js/classes/GlitterManager.js: selectGlitter accepts text layers and refreshes their element's background-image.
- js/classes/LayerManager.js: addLayer/createLayerElement/updateMobileLayersSwatch/cloneLayer text branches; generalize isPointInSticker into isPointInTransformBox and use it for both stickers and text hit-testing.
- js/classes/GifExporter.js: text branch in the _renderFrame layer loop and _loadMissingFrames (ensure font + glitter frames loaded); extract the shared transform-draw helper used by stickers and text; _calculateTotalFrames counts the text layer's glitter frames.
- index.html: layer type picker third option, textSettingsSection markup (follow existing collapsible-section/settings-row patterns), script tag for TextGlitterManager.js before app.js.
- css/style.css: text element styles (background-clip:text, transparent color), font picker, "T" swatch overlay.

CONSTRAINTS
- textData must include `border: null` and `shadow: null` (reserved per plan §4.5 — no UI, no rendering in this goal).
- UI must follow the design-system patterns listed in plan §4 (btn-simple, checkbox-group, setting-column sliders via setupSlider, segmented btn-simple pairs; no btn-text-with-icon in panels).
- History: one saveState per typing pause (debounce boundary), never per keystroke; one per font/size/spacing/alignment change (plan §4).
- TEXT_GLITTER's LAYER_UI_CONFIG onActivate must not steal the active tool if the user holds the Mask Brush or another still-valid tool — switch to SELECT only when the current tool cannot operate on a text layer.
- LayerTransform.js must not need modification (its textData support already exists) — if something seems to require changing it, re-read plan §3's inner-span note first.
- Fonts must be awaited (document.fonts / FontFace.load) before ANY canvas fillText — an export with a fallback font is a failed export. ensureFontLoaded must be called from layer creation/render/restore paths, not only from the font picker UI (plan §1) — undo/redo/clone/reload must not silently fall back to a default font.
- ensureFontLoaded must reject with a clear error on fetch failure, surfaced as a toast (mirror the sticker img.onerror pattern) — never let a failed font load hang or silently draw with a fallback.
- The text string is user input rendered into the DOM: set it via textContent, never innerHTML (plan §3).
- Zero behavior change for existing layer types; existing saved behavior (undo, export, mobile drawers) must be unaffected when no text layer exists.
- Plain script globals, no modules.

ACCEPTANCE CRITERIA
All nine items in plan §7, verified manually. Additionally: run an export containing one glitter-fill layer, one animated sticker, and two text layers with different fonts/glitters — every element must appear correctly in the GIF, twice in a row.
```

### Goal T-2 — Text border & drop shadow

```
/goal Add border (outline) and drop shadow options to text glitter layers in the editor at c:\xampp\htdocs\glitter (vanilla JS, no build system). Design: docs/TEXT-GLITTER-PLAN.md §4.5 — follow it precisely. Goal T-1 is merged (commit 5fe928d) and textData already reserves border: null and shadow: null; also read docs/UX-PLAN.md §2 first — the measurement code now computes per-line ink bounds and per-side paddingBox, and this goal must extend that math, not fight it.

OBJECTIVE
Each text layer optionally gets a border and/or a drop shadow, each with its own swatch: solid color OR a glitter from the existing browser (glitterId wins if set). Schema per plan §4.5:
  border: null | { widthPx, glitterId, color }
  shadow: null | { offsetX, offsetY, glitterId, color }

RENDERING (offset-copies technique, plan §4.5 — one method, both pipelines)
- Shadow: same glyph mask drawn offset by (offsetX, offsetY) BEHIND the fill, filled with the shadow swatch. DOM: duplicated inner span (own background-image + background-clip:text, translated, z-index below the fill span). Export: pattern-fill (or solid fill) masked by the offset text mask, drawn before the fill.
- Border: N offset copies of the glyph mask in a circle of radius widthPx (8 thin / 16 thick), unioned into a border mask, behind the fill. DOM: stacked spans. Export: N drawImage of the cached text mask into a border-mask canvas, one pattern/solid fill. If fill opacity < 100, destination-out the fill mask from the border mask in the export path (accept the minor DOM discrepancy per plan).
- Draw order: shadow → border → fill.
- MEASUREMENT: border widthPx and shadow offsets ENLARGE the ink bounds — getMeasurementEntry's ink union (UX-PLAN §2) must account for them so nothing clips; cache key gains the border/shadow params. textData.width/height stay equal to the mask canvas dims (export transform-draw is 1:1).

MODIFIED FILES
- js/classes/TextGlitterManager.js: schema activation, measurement extension, DOM span stack, settings UI (two toggles, each expanding width-or-offset slider + swatch chip + solid color input, per the design-system patterns in plan §4).
- js/classes/GlitterManager.js: selectGlitter gains a selection-target concept (fill / border / shadow) for text layers — the glitter browser targets whichever slot's chip opened it (plan §4.5 UI sketch).
- js/classes/GifExporter.js: text branch renders shadow/border passes; _loadMissingFrames, _calculateTotalFrames and transparency-key scanning consider up to three glitter ids per text layer (plan §4.5 costs paragraph).
- index.html / css/style.css: toggles, sliders, chips, span-stack styles.

CONSTRAINTS
- null border/shadow = exactly T-1 behavior, byte-identical masks for the same inputs (zero regression when the feature is unused).
- Plain JSON through history/clone with zero special-casing; one history entry per control change (plan §4 granularity).
- textContent only, never innerHTML, for anything containing the user's string.
- Design-system patterns per plan §4 (btn-simple, checkbox-group, setting-column sliders via setupSlider).
- LayerTransform.js unchanged.

ACCEPTANCE CRITERIA
1. Border-only, shadow-only, and both together render in preview and export identically (side-by-side check), with solid and with glitter swatches, including a DIFFERENT glitter per slot.
2. Nothing clips: big border width + far shadow offset on a swashy font (Pacifico) stays fully inside the box in preview and export.
3. Toggling either off returns the layer to exactly its previous look; undo/redo steps through all border/shadow edits.
4. Export with three glitter ids on one text layer animates all three correctly; frame count math still right; export twice in a row.
5. Layers without border/shadow: no observable change anywhere.
```

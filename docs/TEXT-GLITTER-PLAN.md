# Text Glitter Layers — Implementation Plan

**Date:** 2026-07-02 · **Status:** Planned, not started
**Companion docs:** `docs/AUDIT.md`, `docs/MASK-FEATURE-PLAN.md`

## Product model

- A **text glitter layer** is a new layer type: the user types text, and the text shape acts as the mask for a chosen glitter swatch.
- One text string + one glitter per layer. Multicolor text = multiple layers (same philosophy as the mask plan).
- Text stays **editable forever** — the layer stores the string + font settings, never a baked bitmap. Change the text, font, or glitter at any time.
- Text layers move/scale/rotate/flip exactly like stickers (drag, transform handles, pinch on mobile).
- The old `js/classes/TextLayerManager.js` prototype has been deleted; this plan starts fresh (it did point the right way: `LayerTransform` already supports `textData`).

**Relationship to the mask feature:** independent — text layers do *not* use the painted-mask system, and neither feature blocks the other. They share existing infrastructure (`LayerTransform`, `LAYER_UI_CONFIG`, the glitter browser) rather than each other's new code. Keep the plans separate; build text after the audit goals land (either before or after the mask feature — mask first is the suggested order simply because it's already specced and queued).

**If the mask feature lands first:** the type-switch chains this plan touches (`app.js` visibility filters, `HistoryManager.createStateSnapshot`/`restoreState`, `LayerManager` per-type branches) will already have mask-related changes to the `GLITTER_FILL` case — add the `TEXT_GLITTER` case as a sibling branch, don't re-derive those functions from this doc's line numbers/snippets (they'll have shifted).

Out of scope for v1: text outline/stroke, per-character styling, text on a path, painted masks on text layers, user font uploads, emoji.

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
- New layer starts with placeholder text (`CONFIG.textLayers.defaultText`) pre-selected in the textarea so typing replaces it immediately; the layer renders centered on canvas from the first keystroke (debounced ~150 ms re-measure, reuse `CONFIG.sliderDebounceMs`).
- Layer list: name = text excerpt (first ~18 chars), type line = `Text / <glitter name>`, swatch = glitter thumbnail with a "T" glyph overlay.

## 5. Integration points (the "same concept, one representation" checklist)

Every site below currently switches on sticker/glitter/base — each needs a text branch:

| Site | Change |
|---|---|
| `js/classes/HistoryManager.js createStateSnapshot()` / `restoreState()` (history logic lives here since audit Goal 4, NOT in app.js) | plain JSON copy branch for `TEXT_GLITTER` (textData + selectedGlitterId + settings) |
| `app.js updatePreview()` layer filter, `updateActionButtons()` `hasAnySelection`, `exportAnimatedGif()` visible-layer filter | these are three copies of the same per-type conditional (see current `app.js:2802-2813`); `docs/MASK-FEATURE-PLAN.md` §6.5 proposes collapsing all three into one `layerHasVisibleContent(layer)` dispatcher — if that lands first, add the `TEXT_GLITTER` case there instead of re-duplicating the three-site edit; if this plan lands first, build that dispatcher now rather than adding a third copy of the pattern |
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
- js/classes/TextGlitterManager.js — fonts manifest loading, FontFace lazy loading with ensureFontLoaded(id), createLayer(), renderLayer() (DOM element with inner span using background-clip:text per plan §3), renderTextMask(layer) with measurement + caching, text settings UI wiring.
- data/fonts.json — manifest per plan §1.
- fonts/*.woff2 — download the 10 faces listed in plan §1 from google-webfonts-helper (latin subset, woff2 only). All are OFL; include fonts/OFL.txt.

MODIFIED FILES — follow the integration table in plan §5 exactly:
- js/app.js: LayerType.TEXT_GLITTER, CONFIG.textLayers block (plan §6), LAYER_UI_CONFIG entry, updatePreview/updateActionButtons/exportAnimatedGif visibility condition, updateHelpfulMessage hints, text settings listeners.
- js/classes/HistoryManager.js (NOT app.js — history was extracted there in audit Goal 4): createStateSnapshot/restoreState text branch (plain JSON copy of textData + selectedGlitterId + settings).
- js/classes/GlitterManager.js: selectGlitter accepts text layers and refreshes their element's background-image.
- js/classes/LayerManager.js: addLayer/createLayerElement/updateMobileLayersSwatch/cloneLayer text branches; generalize isPointInSticker into isPointInTransformBox and use it for both stickers and text hit-testing.
- js/classes/GifExporter.js: text branch in the _renderFrame layer loop and _loadMissingFrames (ensure font + glitter frames loaded); extract the shared transform-draw helper used by stickers and text; _calculateTotalFrames counts the text layer's glitter frames.
- index.html: layer type picker third option, textSettingsSection markup (follow existing collapsible-section/settings-row patterns), script tag for TextGlitterManager.js before app.js.
- css/style.css: text element styles (background-clip:text, transparent color), font picker, "T" swatch overlay.

CONSTRAINTS
- LayerTransform.js must not need modification (its textData support already exists) — if something seems to require changing it, re-read plan §3's inner-span note first.
- Fonts must be awaited (document.fonts / FontFace.load) before ANY canvas fillText — an export with a fallback font is a failed export. ensureFontLoaded must be called from layer creation/render/restore paths, not only from the font picker UI (plan §1) — undo/redo/clone/reload must not silently fall back to a default font.
- ensureFontLoaded must reject with a clear error on fetch failure, surfaced as a toast (mirror the sticker img.onerror pattern) — never let a failed font load hang or silently draw with a fallback.
- The text string is user input rendered into the DOM: set it via textContent, never innerHTML (plan §3).
- Zero behavior change for existing layer types; existing saved behavior (undo, export, mobile drawers) must be unaffected when no text layer exists.
- Plain script globals, no modules.

ACCEPTANCE CRITERIA
All nine items in plan §7, verified manually. Additionally: run an export containing one glitter-fill layer, one animated sticker, and two text layers with different fonts/glitters — every element must appear correctly in the GIF, twice in a row.
```

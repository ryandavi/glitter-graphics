# Editor UX Round 2 — Color-Picker Latency, Font Fallback, Mask Panel, Design Panel Unification

**Date:** 2026-07-04 · **Status:** Fable fixes applied same day (§2, verified in-browser); Sonnet goals queued: **S-1 → G-1 → M-2 → D-1**
**Companion docs:** `docs/UX-PLAN.md` (round 1), `docs/TEXT-GLITTER-PLAN.md`, `docs/MASK-FEATURE-PLAN.md`

This doc captures Ryan's second UX feedback round: two root-caused bugs (one fixed today, one specced), three panel-clarity items, and the design-panel unification direction. Sonnet task specs are in §9 — they are paste-ready and self-contained.

---

## 1. Ryan's questions → resolutions (quick index)

| Question | Resolution |
|---|---|
| Color picker sometimes takes ~4s, no signifier — on purpose? | **Not on purpose.** Regression from the mask-blob rework; root cause in §3. Fix = **Goal G-1** (instrument → instant feedback → progressive mask). |
| Text tool click uses fallback font for the whole session | **Root-caused and fixed by Fable today** — measurement-cache poisoning, see §4. |
| Hide Selection Settings when not applicable? | Yes — **done** (Fable). Text layers no longer show it (desktop + mobile), see §5. |
| Editing .css instead of .scss? `text-align-group` missing from scss | Yes — confirmed drift (~756 CSS lines vs ~134 SCSS lines over last 15 commits). Reconcile = **Goal S-1**, and it must land **before** any other CSS work, see §7. |
| Only show Paint/Erase when Mask Brush active? What else to hide? | Yes — Paint/Erase **and** Size/Softness/Flow are brush-only. **Goal M-2**, see §6. |
| Invert + Clear Paint feel out of place | Redesign in **M-2**: Clear Paint moves into the Mask title row (the existing "Global" pattern); the duplicated Invert checkbox is removed, see §6. |
| "Paragraph" → "Horizontal" to match "Vertical"? | Yes — **done** (Fable). |
| #designPanel getting clumsy; fills for border/shadow/text; flat color for text fill; scale/opacity per effect | Adopt a Figma-style **fill-slot model** — the paint-source abstraction already exists in code, it just isn't exposed uniformly. **Goal D-1**, see §8. |

## 2. Fable fixes applied today (2026-07-04)

All verified with a Playwright probe against the live app (upload → create text layer → assert panel visibility, cache key, label) plus the full 22-check touch smoke suite.

1. **Font fallback fix** — `js/classes/TextGlitterManager.js` `getCacheKeyForLayer()` now includes `this.fontFaces.has(fontId)`. Root cause in §4.
2. **Selection Settings hidden for text layers** — `js/config.js` `LAYER_UI_CONFIG[TEXT_GLITTER]`: removed `'layerSettingsSection'` from `designPanelSections` and `'tool'` from `mobileSettingsSections`; removed the "Text layers do not use color selections" empty-state calls (config.js `onActivate` + `app.js` `loadActiveLayerSettings`).
3. **"Paragraph" → "Horizontal"** — `index.html` `.text-align-label`.
4. **Dead code removal** — `js/classes/GlitterManager.js` had two `renderContent()` definitions; the first (clear-and-rebuild variant) was shadowed by the later reconcile variant and has been deleted.
5. **Cache-bust bumps** — `index.html`: `config.js?v=2`, `GlitterManager.js?v=2`, `TextGlitterManager.js?v=2`, `app.js?v=5`.

## 3. Color-picker delay — root cause (Goal G-1)

**Not intentional.** The click itself is handled immediately; what the user waits for is the mask pipeline, which became fully asynchronous with **zero feedback** during the mask-blob rework (data URLs in `305f3ac`, then object-URL + decode-before-swap to fix the unmasked flash while painting/picking).

Pipeline per click (`app.js glitterFillSelector` → `updatePreview` → `GlitterManager.renderLayer` → `getMaskObjectUrlForLayer`):

1. **Sync pixel work** — `createSelectionMaskForLayer`: contiguous → `floodFill` (stack-based, visits every matched pixel); non-contiguous → full-image scan per selection. Then feather/invert (`MaskCompositor.getMaskCanvas`). Cost scales with image size and with **how many pixels the picked color matches**.
2. **`canvas.toBlob('image/png')`** — PNG-encodes the full-resolution mask. Encode time scales with mask entropy: a color that selects scattered/anti-aliased regions produces a noisy alpha channel that compresses slowly. **This is the "depends on the color" variability.**
3. **`new Image()` decode** of the blob URL — deliberate anti-flash invariant (see comment at `GlitterManager.js` `getMaskObjectUrlForLayer`): the old mask stays applied until the new one is fully decodable.
4. Only then `applyMaskObjectUrl` swaps the CSS `mask-image`.

Until step 4 lands, the layer shows the **previous** mask (or nothing, on a layer's first selection — the element is kept `visibility: hidden`). Hence: click → seconds of apparent dead air → glitter pops in.

**Constraints for the fix:** keep the anti-flash invariant (never render an unmasked frame; never swap to an undecoded mask). Export parity is untouched — `GifExporter` reads `MaskCompositor.getMaskData()`, not the preview blobs, so G-1 may only change *preview delivery*, never mask content.

**Fix strategy (G-1a–d, spec in §9):** instrument first, then (b) immediate feedback — chips/status update before the heavy work, busy cursor until the mask lands; (c) progressive mask — encode a downscaled draft PNG first (~16× faster), apply it immediately with `mask-size: 100% 100%`, swap in the full-res encode when ready; (d) optional flood-fill scanline optimization if instrumentation says it matters.

## 4. Font fallback — root cause (fixed 2026-07-04, Fable)

**Symptom:** click the Text tool → new layer renders in the fallback font and stays that way for the whole session (for that text/size/font combination).

**Root cause — measurement-cache poisoning.** `createLayer` kicks off `ensureFontLoaded` fire-and-forget, and `renderLayer` correctly defers DOM reconciliation until the font resolves. But `addLayer` → `setActiveLayer` synchronously calls `LayerManager.updateSelectionHighlight` (`LayerManager.js:489`) and `LayerTransform` (`LayerTransform.js:242`), both of which call `getTextFrame(layer)` → `getMeasurementEntry(layer)` **before the FontFace has resolved**. Canvas `measureText`/`fillText` silently fall back, and the fallback-font measurement **and rasterized mask canvas** were cached in `textMaskCache` under a key (`getCacheKeyForLayer`) that didn't change when the font finished loading. Every later lookup — including `renderLayer`'s post-load path — hit the poisoned entry. (`ensureFixedBox` and `applyResizedBoxRect` are the same class of synchronous pre-load callers.)

**Fix:** font-readiness (`this.fontFaces.has(fontId)`) is now part of the cache key. Pre-load entries are quarantined under the `false` key; the first post-load lookup misses and re-measures with the real font.

**Optional polish (P-1, bundled into M-2):** preload the default font once an image loads (`ensureFontLoaded(CONFIG.textLayers.defaultFontId)`), so even the pre-load flash of fallback rarely appears.

## 5. Selection Settings visibility (done)

The mechanism already existed: `LAYER_UI_CONFIG[type].designPanelSections` whitelists sections per layer type and `updateSidePanelUI` hides everything else. Text layers listed `layerSettingsSection` anyway and papered over it with an explanatory empty state ("Text layers do not use color selections"). A section that exists only to explain why it's useless should be hidden — now it is, on desktop and in the mobile settings drawer. Stickers already hid it; glitter layers keep it.

## 6. Mask subsection reorganization (Goal M-2)

Current inventory (`index.html` `.mask-settings-group`), all always visible:

| Control | Scope |
|---|---|
| Mask Brush toggle | entry point — **keep always visible** |
| Paint / Erase mode buttons | brush-only |
| Size / Softness / Flow sliders | brush-only |
| Invert checkbox (`#maskInvertToggle`) | whole-mask state — **duplicate**: mirrors `#invert` in Selection Options ("one state, two views", `MaskEditor.js` §setupUIListeners) |
| Clear Paint button | mask state (painted strokes only) |

**Design:**

1. **Brush-only controls appear only while the Brush tool is active.** `MaskEditor.enterEditMode`/`exitEditMode` toggles a class (e.g. `.brush-active` on `.mask-settings-content`); CSS shows/hides the mode buttons and the three sliders. When inactive, the group is just: title row + Mask Brush button + a one-line hint ("Press B or click Mask Brush to paint or erase glitter by hand.").
2. **Clear Paint moves into the "Mask" subsection title row**, right-aligned — the exact pattern Appearance/Refine already use for their "Global" checkbox. It stays visible regardless of brush state but is **disabled** (not hidden) when `!layer.maskHasContent`. Out-of-place orphan rows at the bottom disappear.
3. **Remove the duplicated Invert.** Two identical "Invert" checkboxes in one panel is the confusion Ryan is sensing. Keep the canonical `#invert` in Selection Options (it's wired to `settings.invert` and history); update its tooltip to say it inverts the layer's whole mask — color selections *and* painted strokes. Delete `#maskInvertToggle` and its mirror listener. *(Alternative if Ryan prefers it near the brush: move the single control into the Mask title row instead — but never both.)*

## 7. SCSS drift (Goal S-1)

Confirmed: recent styling (text alignment groups, effect source rows, mask settings, etc.) was written **directly into `css/style.css`**; `css/style.scss` is missing it (`text-align-group` exists only in the compiled file; last 15 commits touched ~756 CSS lines vs ~134 SCSS lines). There is no build script — sass has been run ad hoc, which is exactly how the drift happened.

**Risk:** the next `sass style.scss style.css` run silently deletes every drifted rule. **No CSS work (M-2, D-1) may land before S-1.** Going forward: `style.css` is build output — never hand-edit it.

## 8. Design panel unification (Goal D-1)

**The good news:** the code already has the right abstraction. `TextGlitterManager.getEffectPaintSource()` returns `{ mode: 'glitter'|'solid', glitterId/color, opacity }` and `applyPaintSource()` renders either mode onto any span. Border and shadow already offer glitter-or-solid with the `text-effect-source-row` chip UI. The problems are that the abstraction stops short of the UI in four places:

1. **Text fill is glitter-only** — no `mode: 'solid'` path exposed, though the renderer supports it.
2. **Per-slot texture scale/opacity don't exist** — `getEffectPaintSource` hardcodes `opacity: 1`, and `applyPaintSource` reuses `layer.settings.scale` for every slot. Border/shadow can't tune their texture independently.
3. **The gallery has global-current-glitter semantics** — `#designGallerySection` mixes "pick the active layer's fill" with "browse stickers", and border/shadow pickers bolt on separately.
4. **Three different UI shapes for the same concept** — glitter layer fill (gallery click), text fill (source row, glitter-only), border/shadow (source row + Use Glitter/Use Solid Color buttons).

**Target model (Figma/Photoshop-style):** every paintable thing is a **fill slot** — glitter-layer fill, text fill, text border, text shadow (later: sticker tint). Every slot has:

- **Source:** glitter texture *or* solid color (swatch chip + Change button — the existing source-row component, everywhere).
- **Scale** (textures only) + **Opacity**, stored per slot: `{ mode, glitterId?, color?, scale: 100, opacity: 100 }`.
- **Picking flow:** hitting Change/the chip puts the gallery into **picker mode** — header shows "Choose fill for: Border", gallery filters to glitters, selection applies to that slot, Done/Esc exits back to browse mode. One gallery, no per-slot modal forks.

**Phasing:** D-1a (data model + solid text fill + per-slot scale/opacity) and D-1b (normalize all four slots onto the shared source-row component) are implementable now — specs in §9. D-1c (gallery picker mode) changes panel information architecture — **write it as a short spec with a mock first and review with Ryan before implementing.** Out of scope, explicitly: gradients, multiple fills per slot, blend modes, effect stacking.

## 9. Sonnet task specs

Order matters: **S-1 → G-1 → M-2 → D-1a/b.** After each goal: `node tests/touch-smoke.js` must stay green (22 checks; needs XAMPP serving `http://localhost/glitter/`), plus the goal's own acceptance checks. Repo is LF-only (`.gitattributes`) and has no build system — keep edits plain ES5/ES6 script files, no modules, no bundler. Bump the relevant `?v=` cache-bust params in `index.html` for any JS/CSS file you touch.

### Goal S-1 — Reconcile style.scss with the drifted style.css

1. Install dart-sass locally (`npm i -D sass`) and add `"build:css": "sass css/style.scss css/style.css"` to package.json scripts.
2. Compile current `style.scss` to a scratch file; diff against the live `style.css`. Every rule present only in `style.css` is drift — port it into `style.scss`, nested in the section where it belongs (search for neighbouring selectors to find the right block). Known drifted areas to spot-check: `.text-align-group`/`.text-valign-group`, `.text-effect-source-*`, `.mask-settings-*`, welcome/about additions.
3. Recompile and verify: (a) the app looks identical (load, create glitter + text + sticker layers, open every panel section, mobile viewport too); (b) `grep -c` a dozen drifted selectors in the new `style.css`; (c) touch smoke green.
4. Bump `style.css?v=` in index.html. Add a one-line note at the top of `style.scss`: "style.css is compiled output — run npm run build:css; never edit it by hand."
- **Acceptance:** recompiling from scss is lossless vs. today's css (allowing formatting/ordering differences); no visual regressions.

### Goal G-1 — Color-picker responsiveness

Files: `js/classes/GlitterManager.js` (`getMaskObjectUrlForLayer`, `applyMaskObjectUrl`, `createSelectionMaskForLayer`, `floodFill`), `js/app.js` (`glitterFillSelector`, `updateStatus`), `js/classes/MaskCompositor.js` (read-only reference). **Do not** change `MaskCompositor.getMaskData()` or anything the exporter reads — G-1 is preview-delivery only. **Preserve the anti-flash invariant**: never show an unmasked glitter frame; never apply a mask URL that hasn't finished decoding.

- **G-1a — Instrument.** `performance.now()` spans around: selection-mask build (flood fill vs. scan), `getMaskCanvas`, `toBlob` (start → callback), image decode (src → onload), total click → `applyMaskObjectUrl`. Emit via the existing `dbg()` logger. Test with a large photo (≥2000px) picking (1) a flat background color and (2) a noisy/anti-aliased color. Record numbers in the PR/commit message — they justify which of c/d you tune.
- **G-1b — Immediate feedback.** In `glitterFillSelector`, run `updateSelectedColorsDisplay`, `updateStatus('Applying glitter…')`, `updateActionButtons`, `updateContextToolbars` **before** `updatePreview()` so the chip/status paint first (wrap `updatePreview` in `requestAnimationFrame` so the browser gets a frame). Add a busy affordance while a mask encode is pending for the active layer: `cursor: progress` on `#previewContainer` + keep the status text until the corresponding `applyMaskObjectUrl` fires (clear via a pending-counter keyed on layer id, so overlapping clicks don't clear early). Status on completion: "Glitter applied".
- **G-1c — Progressive draft mask.** In `getMaskObjectUrlForLayer`, before the full-res `toBlob`, draw the mask canvas into a downscaled canvas (cap longest side at 512px, `drawImage` scaling) and encode/apply *that* first through the same decode-before-swap path, then let the full-res encode replace it when it lands (guard with the existing cacheKey checks so a stale draft never overwrites a newer full-res). Because the draft is smaller than the element, set `mask-size: 100% 100%` / `-webkit-mask-size` in `applyMaskObjectUrl` unconditionally (it's a no-op for full-size masks). Feathered/soft masks make the draft visually indistinguishable; hard-edge masks show a briefly softer edge — acceptable, it's the *draft*.
- **G-1d — (only if G-1a shows flood fill >200ms on the test image)** convert `floodFill` to scanline fill (pop a pixel, walk the whole horizontal run, push runs above/below) — same output, far fewer stack ops.
- **Acceptance:** on a 2000px image, click → *visible* glitter (draft ok) in <300ms; status/chips/cursor react on the same frame as the click; no unmasked flash (test: rapid repeated clicks while previous encodes are in flight, plus mask-brush painting which uses the `draftMask` path); touch smoke green; export output byte-identical for the same document before/after.

### Goal M-2 — Mask subsection cleanup (+P-1 font preload)

Files: `index.html` (`.mask-settings-group`), `js/classes/MaskEditor.js`, `css/style.scss` (**after S-1**), `js/app.js` (font preload).

1. Implement §6 exactly: `.brush-active` class toggled in `enterEditMode`/`exitEditMode` gates Paint/Erase + Size/Softness/Flow (CSS only, no listener changes); inactive-state hint line; Clear Paint into the "Mask" subsection title row (follow the Appearance "Global" markup pattern), disabled when `!layer.maskHasContent` (update disabled state wherever `updateActionButtons`/`loadLayer` refresh mask UI); delete `#maskInvertToggle` + its mirror listener and update `#invert`'s tooltip to "Invert this layer's mask — glitter covers everything except the selected and painted areas".
2. **P-1:** after an image loads, fire-and-forget `textGlitterManager.ensureFontLoaded(CONFIG.textLayers.defaultFontId)` so the first text-tool click almost never races the font.
- **Acceptance:** with brush inactive the Mask group is two rows (title+action, Mask Brush button, hint); activating the brush (button or B) reveals the brush controls in place; Clear Paint confirm-and-clear still works and is greyed out with no paint; exactly one Invert checkbox exists in the DOM; touch smoke green (test 10 exercises the brush).

### Goal D-1a/b — Fill-slot model groundwork

Files: `js/classes/TextGlitterManager.js`, `index.html`, `css/style.scss`, `js/classes/GifExporter.js` (parity), `js/classes/HistoryManager.js` (serialization already deep-copies `textData` — verify new fields survive undo/redo).

1. **Data:** extend `textData.border`/`shadow`/fill source objects to `{ mode, glitterId?, color?, scale, opacity }` with defaults `scale: 100, opacity: 100`; `getEffectPaintSource` returns them; `applyPaintSource` uses per-slot `scale`/`opacity` instead of `layer.settings.scale` / hardcoded `1`. Migrate old saved layers by defaulting missing fields (normalizeLayer).
2. **Text fill solid mode:** give the fill slot the same Use Glitter / Use Solid Color affordance border/shadow have (reuse the existing wiring generic in `setupEffectSourceRow`-style code around `TextGlitterManager.js:1045-1118`).
3. **UI:** each slot's source row gains compact Scale (textures only) + Opacity sliders, same `setting-column` pattern as everything else. Existing layer-level Texture Scale/Opacity become the **fill slot's** controls (relabel; don't duplicate).
4. **Export parity is the hard requirement:** the GIF exporter renders border/shadow/fill through its own path (`_getTextFrameKey` slots in `GifExporter.js`) — per-slot scale/opacity must apply identically in preview spans and exported frames. Add a side-by-side manual check to the verification list.
- **Acceptance:** text fill can be a flat color; border/shadow/fill each tune texture scale + opacity independently; preview ↔ export match visually for a layer using all three slots with different sources/scales/opacities; undo/redo round-trips the new fields; touch smoke green.
- **D-1c (gallery picker mode) is NOT in this goal** — spec + mock first, Ryan reviews (§8).

## 10. Verification notes

- Touch smoke: `node tests/touch-smoke.js` (not `npm run test:touch` — npm's stdin handling breaks it in this environment). Requires XAMPP up.
- A Playwright probe pattern for panel/font assertions (upload via `setInputFiles('#imageUpload', …)`, drive `window.editor.layerManager.addLayer(...)`, assert DOM) was used for today's fixes and is cheap to replicate per goal.

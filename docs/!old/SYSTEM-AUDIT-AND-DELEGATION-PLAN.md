# System Audit & Delegation Plan

**Date:** 2026-07-06 · **Branch:** `masks-and-text` (uncommitted WP4/WP5 work in tree)
**Scope:** frontend architecture, UX/touch flow, extensibility. Security/admin/backend was covered by `docs/AUDIT.md` (2026-07-02); its criticals C2 (frameSkip/reverse mismatch) and C3 (eruda/CDN) are verified fixed in the current tree. Admin-side items (C1, H1–H3) remain open there — this plan does not repeat them.

**Verdict up front:** the architecture is moving in the *right* direction. `LAYER_UI_CONFIG` + derived helpers (`config.js:327-477`) is exactly the right pattern, and `addLayer` (`LayerManager.js:122`) proves it works — it's fully config-driven. The problems below are all the same disease: the config-driven pattern stopped halfway, so per-type knowledge still leaks into 8+ dispatch sites, and the preview/export mirror doubled into a 4-way mirror when shapes shipped. Nothing needs a rewrite; it needs the existing pattern finished.

---

## 0. BUGS AND CHANGES FROM RYAN. APPLY THESE FIXES WHERE THEY ARE MOST PROPER.

When i draw with the draw brush when it makes a new layer, it switches to the design gallery panel. Why? Do you think it should do that, especially if we were looking at the brush panel?

Can we add a button to Brush settings where it will copy the current eraser settings, and for Eraser settings where it will copy the current brush settings. We can add this into an actions section, and move clear paint action there.

In text properties, lets make an actions section and add Fit To Text there. But since thats only available for text box, we need to be aware of that. In the future we might have more actions that arent dependent on the box type so before we implement it we need to be aware of that.

In modals, i should be able to use my keyboard. Using escape works. I would think pressing enter would accept it. Should the primary button be focused on these cases? Whats the best user experience?

When i add a border to a shape, it doesnt change the transform box, but it offsets the shape with the border. The Shape should never move, the border should extend out from it, not shift the position. When i deselect the shape, it looks proper, but when i select it again, it shifts

Would it be possible to add dotted borders and choose the spacing?

**Status (2026-07-08):**
- Completed: brush auto-created glitter layers no longer force-open the design gallery, so the brush panel stays in focus while painting.
- Completed: Brush/Eraser now have an Actions section with cross-copy settings, and Clear Paint moved there.
- Completed: Text Properties now has an Actions section for Fit to Text, with the action disabled outside Box mode.
- Completed: confirmation and new-canvas modals now support keyboard-first flow with focused primary input/action and Enter-to-accept.
- Completed: the stale mobile "Slider Settings" label now reads "Settings."
- Completed: shape selection now expands to include border width instead of hugging only the fill frame, and `tests/shape-border-verify.js` now locks that behavior for plain and rotated/shadowed shapes across select/deselect/reselect.
- Completed: shape borders now support a dotted mode with adjustable spacing, wired through the shared shape mask path so preview/export stay aligned.
- Completed: `tests/shape-touch-verify.js` now treats shape drag-create as required coverage instead of a temporary WP-C skip, and `tests/export-parity.js` now locks byte-identical exports in both matte and transparent modes, including edit -> undo round-trips.

## 1. Highest-risk architectural problems

### R1. The preview↔export mirror became a 4-way mirror
Effect-source resolution (fill/border/shadow slot → `{mode, glitterId|color, scale, opacity, colorAdjust}`) exists **four times**, hand-kept in lockstep:
- `TextGlitterManager.getEffectPaintSource` (TextGlitterManager.js:2450)
- `ShapeGlitterManager.getEffectPaintSource` (ShapeGlitterManager.js:693)
- `GifExporter._getTextEffectSource` (GifExporter.js:306, comment: "must stay in lockstep")
- `GifExporter._getShapeEffectSource` (GifExporter.js:237, comment: "keep in lockstep")

The only real difference: text's fill slot aliases layer-level `settings.scale/opacity/colorAdjust`; shape's fill carries its own. That's a parameter, not a reason for four copies. Every future effect feature (gradient fill, per-slot blend modes) multiplies by four and each divergence is a shipped preview≠export bug — the project's #1 stated invariant. **Fix: WP-B.**

### R2. GifExporter dispatches on layer type in 8 separate places
`GifExporter.js` lines ~557/595–610, 807–819, 956–1001, 1239–1264, 1414–1464, 1590–1613, 1665–1675 each contain an independent `if/else if (layer.type === …)` chain. Adding a layer type means finding all eight; missing one fails silently (layer just doesn't export). **Fix: WP-B stage 2 (consolidate to one per-layer "export plan" builder), not a full delegate-registry rewrite.**

### R3. Two parallel tool-dispatch paths in a 4,964-line app.js
- Mouse: `handlePreviewContainerClick` (app.js:4334) — fragile event-type filtering ("CRITICAL FIX" comments, per-tool click-vs-pointerdown rules) → eventually calls `handleWorkspaceAction`.
- Touch: GestureManager tap → `handleWorkspaceAction` (app.js:4251) directly.

`handleWorkspaceAction` is the good abstraction; the mouse path in front of it is accumulated scar tissue. Also: shape drag-create (`startShapeDrag`, app.js:2773) hangs raw `pointermove/pointerup` listeners on `window` from a *separate* pointerdown handler (app.js:2732) that excludes touch — the direct cause of the mobile shape bug (§6).

### R4. GestureManager hardcodes tool knowledge — every new tool silently degrades to "pan" on touch
`resolveSinglePointerRoute` (GestureManager.js:198-222) knows exactly two tools: BRUSH and SELECT. Any other tool → `{type:'viewport'}`. So the shape tool's touch-drag pans the canvas, and the TEXT tool has the same latent shape: only a sub-300ms tap does anything. There is no registration point for "this tool owns single-finger input." **Fix: WP-C.**

### R5. TextGlitterManager and ShapeGlitterManager are parallel classes
2,864 + 1,221 lines sharing **34 method names** (`createLayer`, `getEffectPaintSource`, `refreshSlotSwatch`, `getDefaultBorder/Fill/Shadow`, `ensureEffectData`, `syncStackGeometry`, `applySpanOffset`, …) with near-identical bodies varying only in slot layout. No shared base (ContentManager only covers asset browsing for Glitter/Sticker managers). Don't force inheritance; extract leaf helper modules (§2). Any Shape≠Text behavior drift in the shared concepts (slot defaults, colorAdjust, span stacking) is a bug by default.

### R6. Residual per-type chains in LayerManager/app.js — drift bugs already shipped
`LAYER_UI_CONFIG` was built to kill these, but they survive in:
- `deleteLayer` (LayerManager.js:191-199), `toggleLayerVisibility` (:222-237), `updateSelectionHighlight` (:259+), `createLayerElement`'s name/type switch (:877-909)
- `layersBarGoToSelected` (app.js:2649-2661)

Two live "forgot a type" bugs prove the risk: **(a)** adding a shape layer announces *"New glitter fill layer added"* (`addLayer` msg chain, LayerManager.js:158-164 misses SHAPE); **(b)** the layers-bar "go to selected" button does nothing for shape layers (app.js:2654-2660). Both fixed directly by Fable (§9); the chains themselves are WP-A.

---

## 2. Code reuse / single-source-of-truth opportunities

Ordered by payoff:

1. **`js/effect-source.js` (new plain script, like `color-adjust.js`):** one `resolveEffectPaintSource(effectData, {aliasSettings})` used by all four R1 sites. No build step needed — script tag + `?v=1`.
2. **Extend `LAYER_UI_CONFIG` per type** (one entry = whole feature works):
   - `displayName` + status strings (kills LayerManager.js:158-164 chain)
   - `goTo: 'glitter'|'sticker'` (kills app.js:2649 + LayerManager swatch-click chains)
   - `addableViaModal: {label, icon, description}` → generate `layerTypePickerModal` options + handler from config (today the modal is hand-listed in index.html:2624-2661 and the handler switch at app.js:2523-2536 hard-errors on unknown types)
   - resource hooks: all four managers already expose `layerElements` Map + `removeLayerElement`/`releaseLayerResources` — call through `managerKey` instead of if/else in `deleteLayer`/`toggleLayerVisibility`/`updateSelectionHighlight`
   - `badges: [...]` rules (§7)
3. **Slot-effects helper module** shared by text/shape managers: `getDefaultFill/Border/Shadow`, `ensureEffectData`, `getEffectData`, `ensureColorAdjust`, `refreshSlotSwatch` (bodies differ only by UI-id prefix and data root — both already parameterizable).
4. **MobileManager de-copy-paste:** `cacheSettingsSections` (MobileManager.js:76-104) and `returnSettingsSections` (:527-578) repeat an identical block per section key — loop over `Object.keys(this.settingsSections)`. Also `collapseAllSections`' `sectionNameByKey` map (:465-471) duplicates knowledge already in `getPreferredDesignSection` (app.js:578) — derive both from one table.
5. **Transform control-id maps by convention:** app.js:1746-1754 hand-lists `shapePosX/shapeRotation/…` per prefix; every map is mechanically `prefix + 'PosX'` etc. Generate from the prefix.
6. **Color constants live in two systems:** brand/UI colors exist both as CSS custom properties and as JS config strings (`CONFIG.maskBrush.overlayColor '#ff2d8a'`, `defaultFillColor '#ff66cc'`, `stickerHandles.handleFill`). Canvas code can't read SCSS, but it *can* read `getComputedStyle(document.documentElement).getPropertyValue()` — or at minimum, group all JS-side colors in one CONFIG block with a comment naming their CSS twins.

---

## 3. Memory & performance issues

1. **`ShapeGlitterManager.measurementCache` grows unbounded during slider drags.** The cache key (ShapeGlitterManager.js:720-728) includes `border.widthPx` and `shadow.offsetX/Y`; each slider tick allocates a new full padded canvas entry, only cleared wholesale by `invalidateMeasurement` (:1185). Dragging a border-width slider across 100 values on a 1024px shape ≈ hundreds of MB transiently. Fix: cap as a tiny LRU (~4 entries) — geometry changes invalidate anyway. (Text's equivalent `_borderMaskCache` is single-entry-per-measurement — already fine; mirror that discipline.)
2. **Viewport pan is unclamped** (`panBy`, ViewportManager.js:354-359) and inertia can fling the canvas fully offscreen with no recovery affordance. Add a soft clamp (keep ≥15% of canvas visible, or rubber-band back on gesture end). This also converts the shape-bug's "drag = canvas vanishes" failure into a recoverable one, and bounds `applyTransform` churn.
3. **Export blob URL lifecycle:** GifExporter.js:1778 creates the result URL; :1916 revokes a *download* URL on a 500ms timer. Verify the preview/result URL from :1778 is revoked when a newer export replaces it (repeat exports on iOS are a supported path; each unrevoked GIF blob pins its full size).
4. **Non-issues (checked, leave alone):** GlitterManager mask-blob swap discipline is correct (decode-before-swap, revoke-after, GlitterManager.js:639-677); paint-history eviction exists (:1097); `renderLayersList` full-rebuilds the list DOM but at `maxLayers: 25` that's irrelevant.

---

## 4. Design system & UI consistency issues

- **Token system is healthy** (`:root` ramps → semantic vars, style.scss:4-44). But ~87 raw hex literals remain in style.scss — most are one-offs; sweep only the *repeated* ones into tokens during other SCSS work, don't do a dedicated pass.
- **All four `.layer-badge-*` modifier selectors apply identical styles** (style.scss:1315-1322) — the modifiers are dead weight today. Superseded by the badge redesign (§7).
- **Mobile settings button says "Slider Settings"** (index.html:3193) — nothing else calls it that; should be "Settings".
- The layer-type picker modal repeats the gallery-card pattern by hand instead of being generated (§2.2) — that's also why Shape never got added to it.
- Convention debt to keep enforcing (not new work): "«Thing» Properties" vs "«Tool» Settings" naming, and `modals/guide.html` must mirror every new panel/tool/shortcut — both already in CLAUDE.md; every WP below includes it in acceptance criteria.

---

## 5. Mobile / touch / canvas interaction model

**Current model (mostly good):** two fingers always navigate (pinch/zoom/rotate viewport, or gesture-transform the active layer when both fingers are on it, GestureManager.js:224-250); single finger is BRUSH→paint, SELECT→drag-layer-under-finger or pan; transform handles and `.ui-ignore-gestures` are excluded at capture. Double-tap = zoom or edit-text. This is a solid foundation — the standard Procreate-style contract.

**The gap:** single-finger behavior for *creation* tools (TEXT, SHAPE, future tools) was never routed, so it falls through to pan (R4), and taps only register inside a 300ms/10px window — a slow deliberate press is a dead zone (`finishPointer`: pending + !isTap → nothing, GestureManager.js:162-168).

**Target model (small delta, no rewrite):**

| Input | SELECT | BRUSH | TEXT/SHAPE (creation) | HAND/ZOOM |
|---|---|---|---|---|
| 1-finger drag | drag layer / pan | paint | **rubber-band create** | pan / (zoom ignores drag) |
| 1-finger tap | select / deselect | dab | create at point (any press duration) | pan-noop / zoom-in |
| 2-finger | transform layer or navigate | navigate | **navigate (cancels pending create)** | navigate |
| long-press, no move | — (context later) | dab | create default at point | — |

Mechanics:
1. Add a `creationDrag` route to `resolveSinglePointerRoute`, driven by config, not hardcoded: give tools a small `TOOL_TOUCH_ROUTES` table (config.js, next to `ToolType`) — `{ [ToolType.SHAPE]: 'creationDrag', [ToolType.TEXT]: 'tapCreate', … }`. GestureManager consults the table; unknown tools still default to viewport so nothing regresses.
2. Extract the rubber-band logic out of `startShapeDrag` (app.js:2773) into a pointer-source-agnostic helper (it already computes both screen and canvas boxes; it only needs `(x, y, shiftKey)` feeds). Desktop keeps calling it from pointerdown; GestureManager feeds it from the `creationDrag` route. Second finger during a pending create cancels the preview box and upgrades to two-finger navigate.
3. Kill the dead zone for creation routes: on pointer-up of a pending creation route, treat *any* release within tap slop as a create regardless of duration (`isTap` keeps its 300ms only for SELECT/viewport semantics like double-tap).
4. Keep everything else untouched: two-finger paths, brush routing, handle exclusions, `suppressClickUntil` click-swallowing.

---

## 6. Shape layer mobile bug — root cause + fix plan

**Symptom:** with the Shape tool on touch, dragging on the canvas creates nothing (the canvas pans, sometimes clear offscreen); a slow press does literally nothing; only a fast (<300ms, <10px) tap creates a shape. And the mobile-native path — Add Layer — cannot create a shape at all.

**Verified root-cause chain (all four contribute):**
1. Desktop drag-create is wired to a `pointerdown` listener that explicitly exits for touch (`e.pointerType === 'touch'` → return, app.js:2732-2735), so `startShapeDrag` is unreachable from a finger.
2. GestureManager owns all touch input at capture (GestureManager.js:35-39, preventDefault + stopPropagation) and its route resolver (:198-222) doesn't know the SHAPE tool → single-finger drag routes to `viewport` pan. With unclamped `panBy` (§3.2) the "nothing happened" often includes the canvas scooting away.
3. A press >300ms or >10px that ends without qualifying as a tap hits the pending→release path (:162-168) and is discarded — the dead zone.
4. The Add Layer modal (`layerTypePickerModal`, index.html:2624-2661) lists Glitter Fill / Sticker / Text only; the handler switch (app.js:2523-2536) `console.error`s on any other `data-layer-type`. Shape was never added when WP5b shipped.

**Fix in three stages:**
- **Stage 1 — done by Fable in this session (§9):** Shape option in the Add Layer modal (creates a centered, aspect-correct default shape — `ShapeGlitterManager.createLayer` already handles the no-position case, ShapeGlitterManager.js:601-604). Mobile has a guaranteed shape path today.
- **Stage 2 — Opus (WP-C):** the `creationDrag` touch route + shared rubber-band + dead-zone removal per §5. This is the real fix: finger-drag draws the shape box exactly like the mouse.
- **Stage 3 — optional polish, bundle into WP-C acceptance:** pan clamp (§3.2) so no tool state can strand the canvas offscreen.

---

## 7. Layer badge / effects UI improvement plan

**Current:** `createLayerElement` appends text chips — `PAINT`, `COLOR`, `BORDER`, `SHADOW` (LayerManager.js:913-953) — 9px uppercase text in the meta row, all four visually identical (style.scss:1315-1322), competing for width with the layer-type label which already ellipsizes. A text+border+shadow+color layer shows 3–4 words of chip text in a ~140px row.

**Proposal — icon chips, one derivation table:**
- **Paint** → `#icon-brush` chip. Keep separate: it flags *mask state* (painted strokes exist), a different mental category from styling.
- **Effects** → single `#icon-filter` chip covering **border + shadow + color-adjust**, with tooltip enumerating what's active ("Effects: border, shadow"). Ryan suggested Border+Shadow under Effects; color-adjust belongs there too — all three are "styling applied on top of the source," and it keeps the row to max two chips.
- Chip spec: 14×14, `border-radius: 3px`, existing accent-light/accent/accent-border colors, SVG at 10px; `title` + `aria-label`; informational only (no click handler — that stays true today).
- **Make it data-driven while touching it:** a `LAYER_BADGES` table (config.js): `[{id:'paint', icon:'icon-brush', title:…, test(layer)}, {id:'effects', icon:'icon-filter', title(layer), test(layer)}]`; `createLayerElement` just iterates. The existing per-type `colorAdjusts`/`hasBorder`/`hasShadow` probing (LayerManager.js:929-953) moves into the `test` functions — one place to extend when a new layer type gains slots.
- SCSS: collapse the four duplicate modifier selectors into base `.layer-badge`; delete the text-styling rules (font-size/letter-spacing/uppercase).

---

## 8. Future tools & the extensibility contract

Cheap wins under the current architecture, in rough order of leverage:
- **Line/arrow/star-burst shapes** — pure `ShapeLibrary` additions, zero architecture.
- **Gradient fill mode** for fill/border/shadow slots — lands almost free *after* WP-B (one resolver + one canvas paint path instead of four).
- **Emoji/symbol stamps** — a ShapeLibrary source variant (glyph → path/raster mask through the same binarize step).
- **Image layer** (photo sticker without the sticker library) — StickerManager generalization.
- **Freehand vector pen** — big; only attempt after WP-B/WP-C, as a new LayerType exercising the contract.

**The contract (write as `docs/LAYER-TYPE-CONTRACT.md` in WP-A):** adding a layer type must require exactly: (1) a manager class exposing the informal interface the four existing managers already share — `createLayer(options)`, `renderContent(layers)`, `removeLayerElement(id)`, `releaseLayerResources(layer)`, `layerElements`/`layerTransforms` Maps, `loadLayerSettings(layer)`, `normalizeLayer(layer)`; (2) one `LAYER_UI_CONFIG` entry (§2.2 fields incl. hit test, transform prefix, badges, modal card, display name); (3) one export delegate (post-WP-B); (4) index.html panel markup + guide.html mirror. Anything else a new type needs is an architecture bug — file it against the dispatch site, not the type.

Same for tools: `ToolType` + toolbar button + `TOOL_TOUCH_ROUTES` entry + hint text + shortcut + guide entry.

---

## 9. Fixed directly by Fable (this session, in tree)

1. **Shape status message** — `addLayer` announces "New shape layer added" (was "New glitter fill layer added"). LayerManager.js.
2. **Layers-bar "go to selected" supports shapes** — SHAPE routes to `goToGlitter` like text. app.js.
3. **Shape option in the Add Layer modal** — new card in `layerTypePickerModal` (index.html) + `case 'shape'` in the handler (app.js). Mobile can now create shapes without the toolbar. Guide untouched (the guide documents tools/panels, not the modal's card list — verify in QA).
4. `?v=` bumps for the touched JS files per repo rule.

Everything larger is deliberately deferred to the prompts below — they're staged so each lands independently and behavior-preserving.

---

## 10. Implementation work packages

Run in order; WP-A and WP-D are independent of each other; WP-C depends on nothing but should land before any new creation tool. Every WP inherits the repo hard rules: **no JS build step (plain scripts + `<script>` tag with `?v=1`, bump `?v=` on every edited file), never edit css/style.css directly (SCSS only), LF endings, tabs, no `ctx.filter`, comments state constraints, `dbg()` not console.log, don't run full Playwright — run `node tests/touch-smoke.js` and `node tests/touch-handle-verify.js`.**

### WP-A — Finish the LAYER_UI_CONFIG consolidation
**Status (2026-07-08): completed in the current tree.** `LAYER_UI_CONFIG` now carries `displayName`, `addedStatusMessage`, `goTo`, and `addableViaModal`; `LayerManager` delete/visibility/selection/goto paths now route through config+manager data instead of per-type chains; the Add Layer modal is generated from config; and `docs/LAYER-TYPE-CONTRACT.md` documents the contract.
> Read docs/SYSTEM-AUDIT-AND-DELEGATION-PLAN.md §1-R6, §2.2, §8, then CLAUDE.md. In js/config.js, extend each LAYER_UI_CONFIG entry with: `displayName`, `addedStatusMessage`, `goTo` ('glitter'|'sticker'|null), and `addableViaModal: {label, icon, description}` (glitter-fill, sticker, text-glitter, shape; base-image excluded). Then, behavior-preserving, replace the per-type chains that this data obsoletes: LayerManager.deleteLayer resource cleanup (route through managerKey's releaseLayerResources/removeLayerElement — StickerManager needs a releaseLayerResources alias for removeSticker), toggleLayerVisibility element lookup, updateSelectionHighlight, addLayer status message, app.js layersBarGoToSelected, and generate the layerTypePickerModal option cards + click handler from `addableViaModal` (delete the hand-written switch at app.js:2523-2536 and the static buttons in index.html — keep the modal's markup/classes identical so SCSS is untouched). Write docs/LAYER-TYPE-CONTRACT.md documenting the manager interface + config fields per §8. Do NOT rename any section ids or change any visible strings except the shape status message. Acceptance: create/delete/hide/clone/goto each of the four layer types on desktop; layer list renders identically; node tests/touch-smoke.js passes; modal shows four cards including Shape.

### WP-B — Collapse the 4-way effect-source mirror (highest value, highest care)
**Status (2026-07-08): completed in the current tree.** Stage 1's shared `js/effect-source.js` helper now feeds the four preview/export effect-source chokepoints without the old dead fallback bodies, and GifExporter stage 2 now routes mask prep, source loading, frame flattening/counting, safe-key collection, and per-frame rendering through one per-layer export-plan builder instead of re-switching on type at each site.
> Read docs/SYSTEM-AUDIT-AND-DELEGATION-PLAN.md §1-R1/R2 and docs/TOOL-EXPANSION-PLAN.md D4/D5 first — preview and export MUST stay pixel-identical. Create js/effect-source.js (plain script, add script tag with ?v=1 before the managers): export a global `resolveEffectPaintSource(effectData, opts)` capturing the shared logic of TextGlitterManager.getEffectPaintSource (TextGlitterManager.js:2450), ShapeGlitterManager.getEffectPaintSource (:693), GifExporter._getTextEffectSource (:306), GifExporter._getShapeEffectSource (:237). Text's fill-slot aliasing of layer.settings (scale/opacity/colorAdjust) and 'none'-mode handling become options/branches, not copies. Replace all four bodies with calls; keep the four method names as thin wrappers so call sites don't churn. Glitter-id validation (getItemById) stays at the call site — pass a resolved boolean or lookup fn. Stage 2 (same PR, separate commit): in GifExporter, consolidate the eight layer-type dispatch chains (lines ~557-610, 807-819, 956-1001, 1239-1264, 1414-1464, 1590-1613, 1665-1675) behind one `buildLayerExportPlan(layer)` that returns the per-type data each site needs; the eight sites read the plan instead of re-switching. No behavior change. Acceptance — run the export fragility test from CLAUDE.md: add animated sticker → export → edit → undo → export again; export twice in a row must be byte-identical; then export one composition containing all four layer types with text+shape each having glitter fill, solid border, glitter shadow, and a non-identity colorAdjust, on both transparent and matte backgrounds, and visually diff preview vs exported frames.

### WP-C — Touch creation route (fixes the shape-on-mobile bug properly)
**Status (2026-07-08): completed in the current tree.** `TOOL_TOUCH_ROUTES` now routes shape touch input to drag-create and text touch input to tap-create; the shape rubber-band flow is shared between desktop and touch; long-press create no longer dies in the old tap timeout gap; viewport panning is softly clamped; and the acceptance coverage now includes `tests/shape-touch-verify.js` plus the existing touch smoke/handle suites.
> Read docs/SYSTEM-AUDIT-AND-DELEGATION-PLAN.md §5-§6 and docs/TOUCH-PLAN.md first. (1) Add `TOOL_TOUCH_ROUTES` to js/config.js next to ToolType: SHAPE→'creationDrag', TEXT→'tapCreate'; GestureManager.resolveSinglePointerRoute consults it after the existing BRUSH/SELECT checks, defaulting to viewport. (2) Extract the rubber-band box logic from Editor.startShapeDrag (app.js:2773-2831) into a pointer-agnostic helper on Editor (feed it x/y/shiftKey; it owns the .shape-drag-preview element and the create-on-release including the isClick fallback and ignoreNextClick swallow). Desktop pointerdown keeps its current entry; GestureManager drives the same helper from the creationDrag route (move beyond tapSlopPx starts the box; second finger cancels the box and upgrades to two-finger navigate; pointerup creates). (3) Dead-zone fix: for creationDrag and tapCreate routes, a pointerup within tapSlopPx creates regardless of press duration — do not touch isTap semantics for SELECT/viewport (double-tap zoom must not regress). (4) Clamp viewport panning softly: ViewportManager.panBy keeps ≥15% of the canvas visible (apply to inertia too). Acceptance: node tests/touch-smoke.js and node tests/touch-handle-verify.js pass; headless touch probe — select shape tool, synthesize touch pointerdown/move/up drawing a 100×80 box → one shape layer of ~that size exists; slow 600ms still press → default shape created; two-finger during shape drag → no shape, viewport zoomed; SELECT-tool double-tap zoom still works; text tool touch tap creates a text layer. Mind the testing gotchas in CLAUDE.md (welcome modal, editor.originalImage wait).

### WP-D — Icon badge system
**Status (2026-07-08): completed in the current tree.** `LAYER_BADGES` now drives icon-chip badges from config, LayerManager renders the brush/filter chips, and the SCSS badge styles were updated and recompiled from `css/style.scss`.
> Read docs/SYSTEM-AUDIT-AND-DELEGATION-PLAN.md §7. Add a LAYER_BADGES table to js/config.js: paint → #icon-brush, title 'Painted mask strokes', test = glitter-fill && maskHasContent; effects → #icon-filter, dynamic title 'Effects: …' enumerating active of border/shadow/color-adjust, test = any of those active (move the colorAdjusts/hasBorder/hasShadow probing from LayerManager.js:929-953 into it, covering text and shape slot layouts). Rewrite the badge block in createLayerElement (LayerManager.js:913-953) to iterate the table and render 14×14 icon chips (svg use href, title + aria-label, no click handler). SCSS (css/style.scss:1301-1323 only): .layer-badge becomes the square icon chip, delete the four identical modifier selectors and the text-chip typography; keep the accent-light/accent/accent-border palette. Compile with npx sass (not npm run). Bump style.css?v= and LayerManager.js?v= and config.js?v= in index.html. Acceptance: a text layer with border+shadow+colorAdjust shows exactly two chips (none for plain layers); tooltips enumerate correctly; layer list row height unchanged; long glitter names still ellipsize without pushing chips out.

### WP-E — Memory guards (small, do after WP-C)
**Status (2026-07-08): completed in the current tree.** Shape measurement entries now use a 4-entry LRU instead of unbounded growth, and export preview blob URLs are revoked when replaced or when the editor clears/loads a new image.
> Read docs/SYSTEM-AUDIT-AND-DELEGATION-PLAN.md §3. (1) Make ShapeGlitterManager.measurementCache an LRU capped at 4 entries (Map insertion order: delete+re-set on hit, evict oldest on overflow); invalidateMeasurement keeps clearing all. (2) Audit GifExporter result-blob URLs: ensure the URL created at GifExporter.js:1778 is revoked when replaced by a newer export or on editor reset; keep the existing 500ms download-revoke. Acceptance: drag shape border-width slider end-to-end and back — cache size stays ≤4 (assert via console probe); export three times in a row — no accumulating blob: URLs (performance.memory sanity check on Chrome); export fragility test from CLAUDE.md still passes.

---

## 11. QA / regression prompts — Codex + Sonnet

### Codex — automated regression suite (paste-ready /goal)
**Status (2026-07-08): completed in the current tree as `tests/shape-touch-verify.js`.** The script now covers tap-create, drag-create, slow-press create, Add Layer modal shape creation, and the two-finger cancel-to-zoom path.
> /goal Add tests/shape-touch-verify.js to the glitter editor (c:\xampp\htdocs\glitter), following the structure and conventions of tests/touch-smoke.js (plain node script, no npm run). It must: load the app headless, dismiss .modal-overlay.visible, load a blank image via editor.loadBlankImage() and wait for editor.originalImage, then verify (1) tapping the canvas with the shape tool active via synthesized touch pointer events creates exactly one SHAPE layer at the tap point; (2) a touch drag with the shape tool creates a shape whose shapeData.width/height match the dragged box within ±2px [skip with a TODO marker until WP-C lands — detect by checking TOOL_TOUCH_ROUTES exists]; (3) the Add Layer modal contains a shape option and clicking it creates a centered default shape; (4) two-finger pinch still zooms the viewport with the shape tool active. Use best practices, keep it runnable via `node tests/shape-touch-verify.js`, exit nonzero on failure. Note the testing gotchas in CLAUDE.md (previewCanvas is the visible canvas; panels auto-open).

### Codex — export parity probe (after WP-B)
**Status (2026-07-08): completed in the current tree as `tests/export-parity.js`.** The harness now builds a mixed real composition and asserts byte-identical output for back-to-back exports and for edit → undo → export.
> /goal In c:\xampp\htdocs\glitter add tests/export-parity.js (node, conventions of tests/touch-smoke.js): build a composition with one glitter-fill (painted mask), one sticker (animated), one text layer (glitter fill + solid border + glitter shadow + hue 90 colorAdjust), one shape layer (same slot spread); export twice in a row and assert byte-identical output; then edit the text, undo, export again and assert byte-identical to the first export. This automates the "export fragility test" in CLAUDE.md. Exit nonzero on any mismatch with a diff summary of first differing frame index.

### Sonnet — manual test checklist + docs mirror (cheap model, verification only)
**Status (2026-07-08): completed by Codex in the current tree.** `docs/QA-MOBILE-CHECKLIST.md` now exists, the mobile settings label is confirmed as “Settings,” and `modals/guide.html` now reflects the four Add Layer options plus the newer Brush/Text/Shape behaviors.
> In c:\xampp\htdocs\glitter, verify without changing app code: (1) modals/guide.html mentions every panel title, tool, and keyboard shortcut present in index.html and CONFIG.shortcuts — list any missing (Shape tool 'U', Shape Properties, and the new Add Layer shape card are the likely gaps); (2) the mobile settings button label (index.html ~3193) reads "Settings" not "Slider Settings" — flag if not; (3) produce docs/QA-MOBILE-CHECKLIST.md: a 15-step manual phone test script covering — add each layer type via Add Layer modal; shape tool tap-create, drag-create, slow-press create; two-finger zoom during each tool; layer drag/pinch transform; settings drawer open/close per layer type; brush paint + two-finger pan mid-stroke; export with transparency on iOS Safari. Keep each step one line with the expected result.

---

## Sequencing summary

| Order | Item | Who | Risk |
|---|---|---|---|
| ✅ | Modal shape card, status msg, goto fix | Fable (done) | none |
| ✅ | WP-A config consolidation + contract doc | Codex | low |
| ✅ | WP-C touch creation route | Codex | medium (touch paths) |
| ✅ | Codex shape-touch-verify | Codex | none |
| ✅ | WP-B effect-source collapse | Codex | high care, staged |
| ✅ | Codex export-parity | Codex | none |
| ✅ | WP-D badges, WP-E memory | Codex | low |
| ✅ | Checklist + guide mirror | Codex | none |

Ryan manually tests after WP-C and WP-B before anything stacks on top.

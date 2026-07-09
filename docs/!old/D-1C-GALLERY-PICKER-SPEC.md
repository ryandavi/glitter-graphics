# D-1c — Gallery picker mode (glitter selection untangling)

**Date:** 2026-07-04 · **Status:** spec for Ryan's review (per UX-PLAN-2 §8: "spec + mock first"). Nothing here is implemented.
**Scope:** how the one shared Design Gallery serves four destinations (glitter-layer fill, text fill, text border, text shadow) without invisible state. Builds on the D-1a/b pass and today's uncommitted source-row/segmented-control work.

## 1. Verified current behavior (the actual tangle)

All confirmed by reading the code, same session:

1. **The armed target is session-global and never resets on layer switch.** `TextGlitterManager.glitterSelectionTarget` is one string (`'fill'|'border'|'shadow'`), defaulting `'fill'`. `LayerManager.setActiveLayer` (LayerManager.js:268) never touches it, and neither does undo/redo (`HistoryManager` restore calls `updateGlitterSelection` only). `getGlitterSelectionTarget` (TextGlitterManager.js:521) only degrades to `'fill'` when the *current* layer lacks that effect — so: arm Border on text layer A, click text layer B (which also has a border), click a swatch → it silently changes **B's border**, with no arming gesture ever made on B. The only signal is an accent border on a chip buried in Text Properties (`.target-active`, style.scss:6254).
2. **Solid-mode fill makes gallery clicks a lie.** With `fill.mode === 'solid'`, `GlitterManager.selectGlitter` (GlitterManager.js:326) still writes `layer.selectedGlitterId`, still highlights the swatch as selected (`updateGlitterSelection` → `resolveSelectedGlitterId` ignores `fill.mode`), still announces "Selected X for the text fill", and still calls `saveState()` — a history entry with zero visual change. Border/shadow do NOT have this problem: their "mode" is `glitterId` truthiness, so a gallery click inherently switches them to glitter. Fill's explicit `mode` field is the odd one out.
3. **Two different mode semantics behind one segmented control.** Fill: explicit `fill.mode`, flips immediately on click. Border/shadow: `glitterId` truthiness — clicking "Glitter" (`bindEffectUseGlitter`) only arms the target and reveals the browser; the segmented control doesn't move until a swatch is picked. Defensible (border stays solid until a real pick) but currently uncommunicated.
4. **`bindFillUseGlitter` saves no history** (TextGlitterManager.js:701) while `bindFillUseColor` does — mode flips to glitter aren't undoable, mode flips to solid are.
5. **Mobile arming is invisible.** `revealGlitterBrowser` (TextGlitterManager.js:540) only handles the desktop accordion. On mobile the gallery lives in the separate `design` drawer; tapping Change from the settings drawer arms the target and… nothing visible happens. (`updateAssetInfo`'s thumbnail handler at app.js:704 shows the correct pattern: `mobileManager.toggleDrawer('design')`.)
6. **Exporter counts invisible glitter.** `GifExporter._getTextEffectGlitterSources` (GifExporter.js:276) always includes the fill slot's `layer.selectedGlitterId`, even when `fill.mode === 'solid'` — a solid-fill text layer still flattens (and frame-counts / transparency-scans) a glitter that never renders. Same check needed in `_calculateTotalFrames`.

## 2. Options considered

**A — Polish the ambient-target model.** Keep the sticky target string; add a persistent banner in the gallery naming the destination, plus a solid-mode notice. Cheapest, but the state stays session-global and lossy — the layer-switch trap (§1.1) remains, just better labeled. Rejected as the endpoint (its banner survives into B anyway).

**B — Explicit picker session (recommended).** Replace the sticky string with a nullable, layer-bound session: `{ layerId, slot }`. Null = **browse mode**: a gallery click applies to the active layer's *own fill* — the only implicit destination anyone expects. Non-null = **picker mode**: entered only by an explicit arming gesture (chip/Change/"Glitter"), visibly announced by a header strip in the gallery, exited by Done/Esc/layer-switch/effect-disable. The layer-switch trap becomes structurally impossible: the session names its layer, and any mismatch with `activeLayerId` means browse mode. This is the UX-PLAN-2 §8 target model ("Choose fill for: Border … Done/Esc exits").

**C — Per-slot popover picker (Figma-literal).** A mini gallery anchored to each source row. Rejected: duplicates AssetBrowser (search, filters, categories, lazy GIF parsing), terrible on mobile, contradicts the one-gallery architecture the whole app is built around.

## 3. Answers to the four open questions

- **"Solid mode" signal in the gallery** → two mechanisms, no dead clicks: (a) a status strip in the gallery (§4) that says the armed slot is using a solid color; (b) **intent capture** — clicking a swatch while the slot is solid switches the slot to glitter *and* applies that glitter. Border/shadow already behave this way by construction; fill gets one line in `selectGlitter` to match (§5 stage 1). A click on a glitter IS the statement "I want glitter"; making it a no-op was the bug.
- **A "Solid" entry inside the gallery?** → **No.** The gallery's default clientele is glitter-fill layers, which have no solid mode — a persistent solid tile would be meaningless most of the time, and it would have to be threaded through AssetBrowser/ContentManager as a pseudo-asset (search, filters, categories all need special cases). Solid stays a property of the slot, chosen in the slot's section; the picker strip links back to it ("using a solid color — pick a glitter to switch, or edit the color in Text Properties"). If this still feels buried after living with picker mode, a color input *inside the picker strip* is the cheap follow-up — deferred, not designed here.
- **Move Scale/Opacity into the gallery?** → **No — the gallery stays a pure picker.** (a) Glitter-fill layers keep their Scale/Opacity in Glitter Properties; moving only text's would trade the current asymmetry for a new one. (b) Scale/opacity are persistent per-slot attributes you tweak long after picking, without wanting the gallery open. (c) The picker strip has ~one row of budget, especially in the mobile drawer. D-1a's colocation of each slot's sliders with the slot was right; keep it.
- **Making "what am I choosing for" hard to lose** → the session model is the answer: browse mode has no hidden target at all, picker mode is loudly labeled and self-clearing (layer switch, effect disable, undo/redo restore, Done, Esc). `.target-active` chip highlight stays as the panel-side echo.

## 4. Picker-mode UI (the mock)

A status strip pinned at the top of `#designGalleryContent` (above search), rendered only in picker mode. `#designGallerySection` gets a `.picker-mode` class; the strip uses existing tokens (accent border like `.target-active`, `btn-simple` for Done).

```
Browse mode (today's look — no strip):        Picker mode, glitter slot armed:
┌─ Design ────────────────────── + ▾ ─┐       ┌─ Design ────────────────────── + ▾ ─┐
│ [Search by name or tag…]  [filter]  │       │ ▌Choosing glitter for: Text Border  │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐         │       │ ▌of "sparkle ✨"          [ Done ]  │
│ │ ✦  │ │ ✦  │ │ ✦  │ │ ✦  │  …      │       ├─────────────────────────────────────┤
│ └────┘ └────┘ └────┘ └────┘         │       │ [Search by name or tag…]  [filter]  │
└─────────────────────────────────────┘       │ ┌────┐ ┌────┐ ┌────┐ ┌────┐         │
                                              │ │ ✦  │ │[✦]│ │ ✦  │ │ ✦  │  …      │
Picker mode, armed slot is solid:             │ └────┘ └────┘ └────┘ └────┘         │
│ ▌Choosing source for: Fill          │       └─────────────────────────────────────┘
│ ▌Fill is a solid color (#FF0066) —  │
│ ▌pick a glitter to switch. [ Done ] │       ▌ = accent-colored left edge / border
```

- **Label text:** "Choosing glitter for: Fill / Border / Shadow of "<layer name>"". Layer name included because the strip is precisely for the moment your attention left Text Properties.
- **Solid variant:** second line states the current solid color and that picking switches to glitter. Grid is NOT dimmed — clicks are meaningful (intent capture).
- **Done** exits to browse mode (session = null, `.target-active` cleared). **Esc** does the same when the gallery has focus/pointer (single `keydown` listener, ignored when a modal or text input is active — check `ModalManager` focus rules).
- Picks do **not** auto-exit picker mode: swatch shopping is comparative, and each pick already lands + saves history (existing `selectGlitter` semantics — unchanged). This matches how Border/Shadow arming works today, minus the ambiguity about when it ends.
- Browse mode with a **solid-fill text layer** active shows a one-line passive variant of the strip (no Done, no accent): "Text fill is a solid color — picking a glitter will switch it." That's the Q1 answer for people who never armed anything.
- **Mobile:** arming from the settings drawer opens the design drawer (the app.js:704 pattern); the strip renders inside the drawer identically. Done just clears the session — no automatic drawer flip back (cheap to add later if it feels wrong).

## 5. Staged plan

Each stage is one /goal-sized, independently landable chunk. Manual verification only (project norm); acceptance lists are the manual script.

### Stage 1 — Correctness fixes (no new UI; shippable today)
Files: `js/classes/GlitterManager.js`, `js/classes/TextGlitterManager.js`, `js/classes/GifExporter.js`, `index.html` (`?v=` bumps).
1. `selectGlitter` fill branch (GlitterManager.js:326): when the layer is TEXT_GLITTER and target is `'fill'`, also set `textGlitterManager.ensureEffectData(layer, 'fill').mode = 'glitter'` — intent capture, kills the no-op-history-entry bug. (Guard: glitter-fill layers have no `textData`; the branch is already inside the TEXT_GLITTER check.)
2. `bindFillUseGlitter`: route through `runLayoutRefreshWithAnchor(..., { saveHistory: true, refreshPreview: false })` like `bindFillUseColor`, so glitter↔solid flips are symmetric in history.
3. `revealGlitterBrowser`: add the mobile branch (`if (mobileManager?.isMobile && activeDrawer !== 'design') toggleDrawer('design')`), mirroring app.js:704.
4. **Exporter (mirror rule):** `_getTextEffectGlitterSources` skips the fill entry when `layer.textData.fill?.mode === 'solid'`; audit `_calculateTotalFrames` + `_findSafeTransparencyKey` for the same assumption. Note: fix #1 changes no resolution logic, so `_getTextEffectSource` itself needs no change — it already reads `fill.mode`.
- **Accept:** solid-fill text layer + gallery click → text visibly switches to that glitter, one history entry, undo returns to solid; export of a solid-fill-only text layer over a static base produces a static (1-frame-source) GIF; mobile Change button lands you in the gallery drawer.

### Stage 2 — Session state model (refactor, minimal visible change)
Files: `js/classes/TextGlitterManager.js`, `js/classes/LayerManager.js`, `js/classes/HistoryManager.js`, `js/classes/GlitterManager.js`.
1. Replace `this.glitterSelectionTarget` (string) with `this.pickerSession = null | { layerId, slot }`. `getGlitterSelectionTarget(layer)` returns `'fill'` unless `pickerSession` exists, matches `layer.id`, and the slot's effect still exists; `setGlitterSelectionTarget(slot, layer)` becomes `openPickerSession(layer, slot)` / `closePickerSession()`. Keep the old method names as thin wrappers if it shrinks the diff — callers: this file, GlitterManager.js:318/348, app.js:950.
2. Clear the session in: `LayerManager.setActiveLayer` (any layer change), `bindEffectToggle` off-branch (replaces the existing target reset at TextGlitterManager.js:579), `HistoryManager.restoreState` (armed slot may not exist in the restored state), and image reset/new-document paths (find via `clearElements` callers).
3. `resolveSelectedGlitterId` / `updateGlitterSelection` / `updateEffectTargetButtons` consume the session; behavior in browse mode = today's `'fill'` default, so the gallery highlight and asset-info panel are unchanged for glitter-fill layers.
4. **Exporter:** untouched — the session is UI state; per-slot resolution (`getEffectPaintSource` ↔ `_getTextEffectSource`) does not change. State a comment on `pickerSession` saying exactly that, so the mirror rule stays discoverable.
- **Accept:** arm Border on layer A → select layer B → gallery click applies to **B's fill** (not border); disable Border while armed → next click is fill; undo across an armed state doesn't resurrect the arm; glitter-fill layer flow byte-identical to today.

### Stage 3 — Picker-mode UI (§4)
Files: `index.html`, `css/style.scss` (never style.css), `js/classes/TextGlitterManager.js`, `js/app.js`, maybe `js/classes/MobileManager.js`.
1. Strip markup in `#designGalleryContent` (hidden by default), `.picker-mode` class toggled by open/close of the session, populated with slot + layer name; Done button wired to `closePickerSession()`; Esc handler.
2. Solid-state second line (armed variant) + passive browse-mode line for solid-fill text layers (driven from `updateFillSourceUI` / `updateSidePanelUI` so it tracks mode flips and layer switches).
3. Status-bar messages align with the strip ("Choosing glitter for the text border — press Esc or Done to finish").
4. SCSS: strip layout, accent edge, drawer-safe positioning (sticky within the section content, not the viewport).
- **Accept:** arming any of the four destinations shows the correct strip on desktop accordion and in the mobile drawer; Done/Esc/layer-switch all remove it and clear `.target-active`; solid-fill browse hint appears/disappears with mode flips; no strip ever shows for glitter-fill/sticker layers.

### Deferred (explicitly out of scope)
- Color input / Glitter-Solid segmented control inside the picker strip (revisit after living with Stage 3).
- Migrating fill's data shape (`layer.selectedGlitterId` + `fill.mode`) to border/shadow's `{glitterId, ...}` shape. **Decision point, default = keep the asymmetry:** it's load-bearing in HistoryManager snapshots, LayerManager swatches, `renderLayer`'s early-out (TextGlitterManager.js:1844), and four GifExporter sites (232, 249, 276-281, 1121-region). Zero user-visible payoff; unify only if a fifth slot (sticker tint) forces a real slot registry.
- Unifying the two "mode" semantics (fill's explicit field vs border/shadow's glitterId-truthiness). Stage 1's intent capture makes them behave identically from the outside; leave the internals alone until the same hypothetical registry.

## 6. Invariants (unchanged, and how each stage respects them)
- Border/Shadow Enabled toggles + `runLayoutRefreshWithAnchor` history semantics: untouched; Stage 2 only relocates the existing target-reset already inside `bindEffectToggle`.
- Opacity always visible / Scale hidden in solid mode: untouched (`textureScaleRow`/`borderScaleRow`/`shadowScaleRow` logic not in scope); Stage 3 accept list includes a spot-check.
- Preview↔export parity: the only resolution-affecting edits are Stage 1 #1 (a data write the exporter already reads correctly) and #4 (exporter-side, makes export *more* correct). `_getTextEffectSource` and `getEffectPaintSource` stay lockstep-identical.
- SCSS only; `?v=` cache-bust bumps for every touched JS/CSS file; LF endings; no Playwright unless asked.

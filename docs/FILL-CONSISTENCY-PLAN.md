# Fill UI Consistency Plan — 2026-07-12

Scope: the text/shape fill systems drifted apart (text slots were built first in
D-1c/D-1d, shape slots came later via the generic `_bindSource`/`_bindSlotAdvanced`
helpers). One dead button, several layout gaps, and three placement inconsistencies.
Nothing in docs/!old records the divergence as intentional — it is drift, not design.
Goal: one canonical paint-slot layout used by every slot on every layer type, so
WP-C (gradients, TRANSFORM-AND-FILLS-PLAN.md) extends one pattern instead of two.

---

## Bugs (root-caused)

1. **Text fill None → Glitter does nothing.**
   `TextGlitterManager.bindFillUseGlitter` (js/classes/TextGlitterManager.js:966)
   guards `if (mode !== 'solid') return;` — written as "coming from solid" when it
   means "already glitter". From `none`, the click early-returns. Fix: guard on
   `mode === 'glitter'`, matching the None/Solid handlers (which guard correctly on
   their own target mode). No other change needed: the default-glitter fallback for
   an empty selection already runs in `updateFillSourceUI` (line 1548).
   Shape never had the bug because `_bindSource` (ShapeGlitterManager.js:260) sets
   the target mode unconditionally.

2. **Text fill Opacity shows in None and Solid modes, half-width.**
   `updateFillSourceUI` hides only `textureScaleRow` when the mode isn't glitter
   (TextGlitterManager.js:1563); the Opacity column (index.html:1476) is never
   touched, so None shows a pointless Opacity and Solid shows Opacity next to an
   empty first column. Note Opacity is NOT glitter-only in the data path —
   `resolveEffectPaintSource` applies it to every mode (js/effect-source.js:12) —
   so the fix is layout (per-mode visibility below), not hiding it everywhere.

---

## Canonical paint-slot layout (the spec)

Every paint slot — text fill/border/shadow, shape fill/border/shadow, and later
glitter-fill-layer source + sticker border/shadow — renders, top to bottom:

1. **Source** segmented control — None / Glitter / Solid (fill only has None;
   border/shadow keep Glitter/Solid; WP-C appends Gradient to all).
2. **Source display** — glitter asset-info card, solid color row, or (WP-C)
   gradient editor. Exactly one visible, per the existing
   `glitter-source-glitter` / `glitter-source-solid` convention.
3. **Texture Scale | Opacity** two-column row — *outside* Advanced.
4. **Advanced** disclosure (glitter mode only) — Hue, then Saturation | Brightness.
   Advanced is color-adjust only; Texture Scale moves out of it everywhere.

Per-mode visibility for row 3:

| Mode     | Texture Scale | Opacity            | Advanced |
|----------|---------------|--------------------|----------|
| None     | hidden        | hidden (row gone)  | hidden   |
| Solid    | hidden        | shown, full width  | hidden   |
| Glitter  | shown         | shown (two-column) | shown    |
| Gradient | hidden        | shown, full width  | hidden (per-stop alpha lives in the editor) |

Implementation note: drive this with one shared mechanism, not per-manager
`hidden` juggling — e.g. extend the `glitter-source-*` class convention with a
mode class on the slot container and let SCSS collapse the columns
(`.setting-column` hidden → sibling spans full width). Whatever the mechanism,
both managers must consume the same one (root-script helper or CSS convention —
never manager inheritance, per CLAUDE.md).

---

## Current state (what differs today)

| Slot | Texture Scale | Opacity | Storage |
|------|---------------|---------|---------|
| Text fill | outside Advanced ✓ | outside Advanced ✓ but never hidden (bug 2) | **layer-level** `layer.settings.scale/.opacity` (deliberate — TextGlitterManager.js:570) |
| Text border/shadow | outside Advanced ✓ (two-column with Opacity) | ✓ | per-slot `effectData.scale/.opacity` |
| Shape fill | **inside Advanced** (index.html:1843) | **no control at all** | per-slot `fillData.scale`; `fillData.opacity` already honored by the resolver, just no UI |
| Shape border/shadow | **inside Advanced** (index.html:2013) | full-width outside Advanced (not two-column) | per-slot |
| Glitter fill layer | Glitter Properties panel, layer-level `settings.scale/.opacity` | same | layer-level (WP-C adds a source control here — reuse the canonical layout) |
| Sticker | no paint slots yet; the planned border/shadow slots inherit this spec | — | — |

Whole-layer opacity (shape Transform panel's Opacity, `transform.opacity`) is a
different knob from slot opacity and stays where it is — text layers likewise have
both layer opacity (shared transform panel) and fill opacity. Don't merge them.

---

## Decisions (answers to the open questions)

1. **Complete parity? Yes.** Same layout, same behavior, same per-mode visibility
   for every slot on both layer types. The divergence is drift; LAYER-TYPE-CONTRACT
   says fix the dispatch site rather than let types accumulate bespoke branches.
2. **Texture Scale placement: outside Advanced, everywhere.** It's a primary
   glitter knob (text already treats it that way); Advanced stays color-adjust
   only. Shape fill/border/shadow move it out.
3. **Opacity belongs to the slot controls, not a separate Appearance section.**
   Shape fill gains an Opacity slider writing `fillData.opacity` — zero new
   plumbing, the resolver and export mirror already read it. Layer opacity stays
   in the Transform panel (different concept, see above).
4. **Opacity for glitter on both? Yes — and for solid too**, since the resolver
   applies it to every mode. Hence Solid keeps a full-width Opacity rather than
   hiding it.
5. **Storage asymmetry (text fill = layer-level, shape fill = per-slot): leave it.**
   The layer-level home for text fill scale/opacity is documented-deliberate
   (gallery/picker + GifExporter + serializer all key off it). Unify the *UI* only.
   Optional follow-up, not in scope: migrate text fill to `fillData.scale/.opacity`
   behind a ProjectSerializer format-version bump with legacy-load mapping.

Coordination: land this **before or with WP-C** — WP-C extends these same
segmented controls with Gradient, and the visibility matrix above already assigns
gradient its row-3 behavior. If Codex runs both, this WP goes first.

---

## WP-F (Codex) — Fill slot parity: bug fix + canonical layout

```
In c:\xampp\htdocs\glitter (branch masks-and-text), read CLAUDE.md first — LF endings,
tabs, no build step, bump ?v= on every JS file you edit, SCSS only (never
css/style.css), dbg() not console.log, guide mirror rule. Then read
docs/FILL-CONSISTENCY-PLAN.md — it has the root causes and the canonical layout
spec; this prompt implements it.

Task:
1. Bug: text fill None → Glitter is dead. bindFillUseGlitter
   (js/classes/TextGlitterManager.js ~966) guards `mode !== 'solid'` — change to
   `mode === 'glitter'` so it's a no-op only when already glitter.
2. Canonical slot layout for all six slots (text fill/border/shadow, shape
   fill/border/shadow), per the spec + per-mode visibility matrix in the plan doc:
   - Move shape Texture Scale sliders out of the Advanced disclosures into a
     [Texture Scale | Opacity] two-column row above Advanced (Advanced keeps
     Hue/Saturation/Brightness only).
   - Add a shape fill Opacity slider writing ensureEffectData(layer,'fill').opacity
     (resolveEffectPaintSource in js/effect-source.js already consumes it — verify
     preview AND export honor it; the export mirror getEffectPaintSource ↔
     _getTextEffectSource must stay in lockstep).
   - Per-mode visibility: None hides the scale/opacity row and Advanced; Solid
     shows Opacity full-width (scale hidden, Advanced hidden); Glitter shows both
     columns + Advanced. Implement ONE shared mechanism (extend the
     glitter-source-* class convention or a small root-script helper) used by both
     TextGlitterManager and ShapeGlitterManager — no copy-pasted hidden-toggling,
     no manager inheritance.
   - Two-column collapse: when one column is hidden the other spans full width
     (SCSS on the existing settings-group-two-column pattern, in css/style.scss).
3. Do NOT move whole-layer opacity (shape Transform panel / transform.opacity) —
   slot opacity and layer opacity are different controls and both stay.
4. Do NOT migrate text fill storage: layer.settings.scale/.opacity stay layer-level
   (documented-deliberate); only the UI unifies.
5. loadLayerSettings / updateFillSourceUI / _refreshSourceUI must restore slider
   values and visibility correctly on layer switch and undo/redo.
6. Mirror any panel wording change in modals/guide.html. Register any new mobile
   rows via LAYER_UI_CONFIG mobileSettingsSections if section contents moved.
7. Tests: node tests/touch-smoke.js, node tests/touch-handle-verify.js,
   node tests/export-parity.js, node tests/shape-border-verify.js. Since export
   paths are touched (shape fill opacity), run the export fragility test from
   CLAUDE.md.

Do not touch: css/style.css directly, mask binarization, GifExporter
frame-flattening internals.

Best practices, I trust you.
```

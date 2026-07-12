# UX Polish & Style Consistency Plan

**Date:** 2026-07-11
**Branch:** `masks-and-text`
**Scope:** alt-drag duplicate feedback, SCSS consolidation audit + file split + themes, export/settings modal content & tiering, new-canvas modal behavior, Figma/Photoshop familiarity wins.

Follows the delegation format of `docs/SELECTION-ALIGNMENT-QOL-PLAN.md` (now landed through WP6). Fable has already shipped the small fixes listed below; the WPs are paste-ready for Codex.

---

## Already done by Fable (this working tree, uncommitted)

1. **New-canvas presets are a shortcut, not a mode** — the preset highlight now tracks whether the current width/height exactly match a preset: editing dimensions or flipping orientation deselects; entering matching values (or flipping 450×800 ↔ 800×450) re-selects. `setupNewCanvasModalListeners` (`app.js`, `syncPresetHighlight`).
2. **Settings modal footer gains "Reset All Settings"** — wired to the pre-existing (previously orphaned) `resetAllSettings()`; footer switched to the export modal's `left-right` layout.
3. **Header toggles cluster next to the chevron** — new bare SCSS rule: any `.checkbox-group` inside a `.subsection-title` gets `margin-left: auto` (+ title `gap`). Fixes Border/Shadow "Enabled", Glitter Appearance "Global", Shape "Proportional" in one place.
4. **Title controls no longer collapse the card** — clicking (or pressing Space on) the Enabled/Global checkbox used to bubble into the subsection collapse toggle. Guarded in `initializeAdvancedDisclosures` (click + keydown).
5. Cache-busts bumped: `app.js?v=55`, `style.css?v=52`. **SCSS needs recompile** (watcher is stopped).

---

## Background: verified findings

### Alt-drag duplicate (why it feels bad)

Mechanically the clone IS created at the 3px move threshold and retargeted live (`LayerTransform.handleMoveDrag` `LayerTransform.js:1210`, `startAltDuplicateHandleDrag` `LayerTransform.js:1066`, group path `GroupTransformManager.handleMoveDrag:676`). Two problems:

1. **No affordance before/during.** Nothing signals "this will duplicate": no cursor change when Alt is held, and since the clone spawns at the source position with identical pixels, the first visible frames of the drag are indistinguishable from a plain move.
2. **Late visuals for some layer types.** `cloneLayer` builds text/shape clones as data and calls `renderClonedLayerPreview` → `textGlitterManager/shapeGlitterManager.renderLayer` (`LayerManager.js:977-979`), which is async (mask raster → blob → `Image` decode per the no-flicker rule). Until that completes, the clone's element is missing/invisible — position updates land on nothing, so the duplicate "appears when the drag is done". Sticker clones (`cloneStickerElement`) and glitter clones (`cloneNode(true)`, `LayerManager.js:965`) are near-instant.

### SCSS duplication (why `.text-effect-subsection` exists at all)

The generic card style is scoped to **direct children**: `.settings-subsection > .subsection-content-group` (`style.scss:7051`). The Border/Shadow effect cards are *nested* inside the Effects `subsection-content-group`, so the scoped rule misses them — `.text-effect-subsection` (`style.scss:6830`) re-declares the same padding/border/radius/background/title block, slightly drifted (hand-rolled font rules vs `@include text-sm`, `gap: lg` vs `md`). Same story for `.transform-panel` extras. Consequences beyond duplication:

- The collapse styles (`&[data-collapsible-subsection].is-collapsed` hide rule, chevron sizing, `style.scss:7072-7090`) also only exist under the direct-child scope, while the JS chevron injector uses a **descendant** query (`app.js` `initializeAdvancedDisclosures`: `.settings-subsection .subsection-content-group > .subsection-title`). Nested cards get toggle behavior + `is-collapsed` class but not (reliably) the matching CSS.
- A bare `.subsection-note` override exists purely to win the cascade against a scoped rule (`style.scss:6875-6883` — the comment admits it).
- `.effects-stack` un-cards itself with three `!important`s (`style.scss:6851`).

### Settings/Export surfaces today

- **Settings modal** (`index.html:2748`): Interface → Helpful Hints. That's it. Footer now has Reset All.
- **Export Settings modal** (`index.html:2755`): flat groups Export (Transparency, Matte, Watermark) / Encoding (Dither, Dither Type, Quality) / Frame Control (Delay, Max Frames, Smart Reduction, Skip, Reverse), per-section Reset buttons + footer "Reset Export Settings". The prior plan's tiering (creative top-level + one Advanced disclosure, §6.1/6.2 of SELECTION-ALIGNMENT-QOL-PLAN) was **not** implemented — the modal split happened, the tiering didn't.

### Shortcut coverage (`CONFIG.shortcuts`, verified)

Already present: V/T/U/I/B/E/H/Z tools, arrows + Shift-arrows nudge, Shift/Alt click, Alt+Drag duplicate, marquee, Ctrl+A, Escape, Shift-drag axis lock, Shift-rotate 15° snap, `[`/`]` brush size, Ctrl+0/1/+/−, Ctrl+Wheel zoom, Ctrl+Z / Ctrl+Shift+Z, Ctrl+S, Delete/Backspace delete layer. Real gaps are listed in WP-F.

---

## Work packages

### WP-A — Alt-drag duplicate: visible, immediate, announced (Codex, medium)

Goal: from the moment Alt is held over a movable layer, the user knows a drag will duplicate; from the first threshold-crossing frame, they can see two layers.

1. **Cursor affordance.** Track Alt via keydown/keyup (+ `blur` reset) and set a class (e.g. `alt-duplicate-armed`) on the preview container when the SELECT tool is active. SCSS: `cursor: copy` on movable layer elements / move-handle wrapper while armed, and `cursor: copy` for the duration of an active duplicate-drag. Do NOT touch GestureManager or touch paths — mouse only, same guard as the existing `pointerType === 'mouse'` checks.
2. **Instant ghost for late-rendering clones.** In the clone-on-threshold paths (`LayerTransform.handleMoveDrag`, `startAltDuplicateHandleDrag`, `GroupTransformManager.handleMoveDrag`): after `cloneLayer`/`cloneLayers`, if the clone's DOM element is not yet present/painted (text/shape), synchronously `cloneNode(true)` the **source** layer's element, strip `data-layer-id` (give it e.g. `data-duplicate-ghost`), append beside it, and let the drag move the ghost until the real element exists — then remove the ghost. Never reparent or rebuild the source element (no-flicker rules); the ghost is a disposable extra node. Glitter GIF `background-image` on the ghost restarting its loop is acceptable for a ghost.
   - Alternative if simpler after investigation: have text/shape `renderLayer` reuse the source's current mask blob synchronously for the clone (they're pixel-identical at clone time) and re-render properly on drop. Either approach is fine; pick one, don't do both.
3. **Status-bar hint.** While a duplicate-drag is live, status bar shows "Duplicating layer" / "Duplicating N layers" (reuse the selection-count plumbing from the last QOL round).
4. No history/threshold changes — the clone-at-3px + single `saveState()` at mouseup contract stays exactly as is.
5. Tests: `node tests/touch-smoke.js`, `node tests/touch-handle-verify.js` (must prove touch untouched). Manual: Alt-drag a text layer — second copy visible from the first moved pixel; Alt-click still cycles; undo = one step.
6. Bump `?v=` on every JS file edited; SCSS changes go in `style.scss` only.

### WP-B — SCSS consolidation: one card, one title, one note (Codex, medium — no visual redesign)

Goal: `.subsection-content-group` is THE card; nested cards and effect cards inherit it instead of re-declaring it. Behavior-preserving refactor — screenshots before/after should be near-identical.

1. **Promote the card style.** Move the card block (flex column, `gap: md`, padding, border, radius, `--color-bg-card`, `>.subsection-title` styling, the whole `[data-collapsible-subsection]` collapse/chevron block, `>.subsection-content`) from the `.settings-subsection >` scope (`style.scss:7051-7100`) to a standalone `.subsection-content-group { … }` rule. Keep a thin `.settings-subsection` rule for layout-only concerns (subsection stacking, `transform-panel-host`).
2. **Gut `.text-effect-subsection`.** After (1) it should contain only real deltas — target: `gap: var(--spacing-lg)` if that difference is intentional, otherwise delete the class's style block entirely (markup keeps the class name; ids/classes are load-bearing).
3. **Kill the cascade hacks now made unnecessary:** the bare `.subsection-note` re-declaration (`style.scss:6875`) merges into a single `.subsection-note` rule; re-check whether `.effects-stack`'s three `!important`s can drop once specificity is sane (an un-card variant class like `.subsection-content-group.effects-stack { padding:0; border:0; background:transparent; }` should win without `!important` if declared after).
4. **Verify nested collapse.** With the collapse CSS now unscoped, confirm Border/Shadow cards collapse/expand correctly and that `.transform-panel` cards didn't double-gain styles. The JS injector query (`app.js`) can stay descendant-based; consider tightening it to `.subsection-content-group > .subsection-title` (dropping the `.settings-subsection` prefix) so modals could opt in later — verify nothing unwanted matches first (`.subsection-title` appears only inside panels today).
5. **Audit pass (report, fix the cheap ones):** grep for repeated `padding + border + radius + bg-card` blocks (`.asset-info`? gallery cards? modal setting rows?) and repeated title patterns (`uppercase + tertiary + 600`) — fold into the shared rule or a mixin (`@mixin card`, `@mixin section-title`) per the existing mixin style. List anything risky in the PR notes instead of changing it.
6. **Don't touch:** the Windows-7 theme mixin block (deliberately literal), `css/style.css` directly, any element ids/class names in markup. Bump `style.css?v=` and note recompile for Ryan.
7. Tests: quick suites + manual eyeball of Text and Shape panels (fill card, border card, shadow card, transform, effects-stack header alignment from Fable's fix still holding).

### WP-C — SCSS file split + light mode + themes (Codex, medium; **after WP-B lands**)

1. **Split `style.scss` into partials** loaded by a slim index (Sass `@use`/`@forward`, or `@import` if that's what the current compile setup handles — match whatever `npx sass` invocation Ryan uses):
   - `_tokens.scss` (the `:root` ramps + semantic vars), `_mixins.scss`, `_base.scss` (reset/typography/buttons/inputs/segmented/checkbox), `_components.scss` (cards, setting rows, sliders, gallery/asset chips, modals' shared chrome), `_panels.scss` (layers/design/preview panels, transform, tools), `_modals.scss`, `_mobile.scss`, `_themes.scss` (Win7 block + future themes).
   - Order of concatenation must reproduce the current cascade — this is a **move-only** refactor; compiled CSS should diff to ~nothing but whitespace/source-map noise. Keep `style.css` as the single compile target; no HTML changes.
2. **Light mode as a token swap.** Because components consume semantic CSS vars, a theme = re-declaring the semantic vars under `:root[data-theme="light"]`. Deliverables: the light ramp (bg/card/border/text/accent — keep the glitter accent), a `data-theme` attribute set from a Settings-modal select (persisted via `saveSettingsToStorage`, default `dark`), and an audit for hard-coded colors that escaped tokenization (the checkbox-group `#ccc`s at `style.scss:7144/7165` are known offenders — tokenize them in WP-B or here).
3. **Windows XP theme (fun tier, optional last):** pattern it exactly on the existing Windows-7 mixin block — self-contained, literal values, applied via the same theme attribute. Do not let it force abstractions on the rest of the sheet.
4. Theme picker UI lands in the Settings modal Interface group (see WP-D list).
5. Tests: quick suites; manual light-mode pass over every panel + modals; GIF preview must stay legible on light bg (check the transparency checkerboard and selection outlines).

### WP-D — Settings & Export Settings: content, tiering, order (Codex, small-medium)

**Export Settings modal** (implements the previously-deferred tiering, `index.html:2780-2969`):

1. Top-level rows in this order: Transparency, Matte Color, Watermark, **Animation Speed** (relabel of Frame Delay — keep the ms/FPS option text and the `exportFrameDelay` id), Reverse Animation.
2. One collapsed **Advanced** disclosure (existing `.advanced-disclosure` / `data-advanced` component — verify `initializeAdvancedDisclosures`'s query reaches modal markup; widen, don't fork) containing: Dithering, Dithering Type, Quality, Max Frames, Smart Frame Reduction, Frame Skip. Former group titles become plain labels inside it.
3. Rows move with their ids and listeners untouched; the dither-type show/hide and matte/transparency coupling keep working.
4. Per-section Reset buttons go away; the footer "Reset Export Settings" is the single reset. (Update `resetSettingsSection` callers accordingly — `interface` stays for the Settings modal.)

**Settings modal** — add only rows with real backing (verify each before building):

5. **Theme** select (Dark / Light / Windows 7? / XP) — only if/when WP-C lands; otherwise skip.
6. **Show welcome screen on startup** — the welcome modal already has suppression state (verify where it's stored); surface it as a toggle so it's recoverable.
7. **Confirm before destructive actions** toggle (drives `confirmAction` for delete-layer/clear-all) — cheap, honest power-user win.
8. Anything not backed by existing behavior (autosave, UI scale) is out — don't invent settings to fill space; a small Settings modal is fine.
9. Guide mirror if any panel/shortcut naming changes; `?v=` bumps.

### WP-F — Figma/Photoshop familiarity, round 2 (Codex, small, batchable)

Verify-then-implement; every addition gets a `CONFIG.shortcuts` row + guide mirror. Desktop/mouse only.

1. **Space-hold = temporary Hand tool** (the single biggest muscle-memory win; H exists but nobody re-taps tools). Hold Space → pan cursor + drag pans viewport; release → restore previous tool. Guard the `isTyping` check; ignore key-repeat.
2. **Escape cancels an in-progress drag/transform** — while a handle drag is live, Escape restores `dragStartState` and skips `saveState()` (both `LayerTransform` and `GroupTransformManager`). Escape's existing clear-selection behavior stays for the idle state.
3. **Alt-resize scales from center; verify Shift-resize aspect behavior** on corner drags matches expectation (proportional default for shapes has a checkbox — don't fight it, just add Alt-from-center).
4. **Double-click a text layer on canvas → text edit** (focus the text input in Text Properties, or inline edit if that exists — verify current double-click behavior first).
5. **Ctrl+Y** as redo alias alongside Ctrl+Shift+Z.
6. **Zoom readout**: verify the status bar shows current zoom %; if yes, make it double-clickable to reset to 100% (matches the slider dblclick-reset convention in `utils.js:101`).
7. Explicitly skipped: Ctrl+`[`/`]` layer reorder (conflicts with brush-size keys), Tab-to-hide-UI, blend modes (parity project — see prior plan §6.5).
8. Tests: quick suites; manual pass that Space-pan doesn't fire while typing in text fields.

---

## Sequencing

1. WP-A (alt-drag) — independent, highest annoyance.
2. WP-B (SCSS consolidation) — before WP-C; keep it behavior-preserving.
3. WP-D (modal tiering/content, minus the theme row) — independent of WP-B/C.
4. WP-C (split + themes) — after WP-B; theme picker row joins Settings when ready.
5. WP-F — last, batches cleanly.
6. WP-A and WP-F both touch drag/keyboard entry points — land + manually verify one before starting the other. WP-B and WP-D both touch `initializeAdvancedDisclosures`'s query — whoever goes second rebases on the first.

## Do-not-touch list

- `css/style.css` / `.map` directly; all styling via `style.scss`, Ryan compiles.
- Element ids and existing class names in markup (SCSS refactor changes rules, not markup).
- Touch/gesture routing, `.ui-ignore-gestures`, pointer-capture exclusions.
- Preview/export parity mirrors (effect-source.js, GifExporter, mask binarization) — nothing in this plan should reach them; if a package drifts there, stop and re-plan.
- The Windows-7 theme mixin block stays literal and self-contained.
- History contract for alt-drag (clone at threshold, one `saveState()` at drop).

## Ryan decisions needed

1. **WP-D:** sign off the top-level vs Advanced split & the "Animation Speed" relabel.
2. **WP-C:** is light mode a real target or is XP-as-a-goof the actual want? (Both are cheap after WP-B; ordering differs.)
3. **WP-F:** confirm Space-hold pan and Escape-cancel-drag are wanted (they change canvas input feel).

## Acceptance checklist (Ryan, manual)

- [ ] Alt held over a layer shows copy cursor; alt-drag shows the duplicate from the first moved pixel (text + shape especially); Alt-click still cycles.
- [ ] Border/Shadow "Enabled" sits beside the chevron; clicking it never collapses the card. Same for Global/Proportional.
- [ ] New Canvas: edit a dimension → preset unhighlights; type 800×800 → preset re-highlights; orientation flip on 450×800 re-highlights the sibling preset.
- [ ] Settings modal: Reset All works; Export Settings: creative rows top, Advanced collapsed, single footer reset.
- [ ] Panels look pixel-same after WP-B (spot-check Text fill/border/shadow cards, transform, glitter appearance).
- [ ] Light mode (if built): every panel + modals legible, no stray dark-hard-coded patches.
- [ ] Guide modal mirrors every new shortcut/label.

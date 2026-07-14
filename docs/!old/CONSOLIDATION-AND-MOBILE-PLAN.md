# Consolidation, Utils, and Mobile Settings Plan — 2026-07-13

Scope: simple wins — measured duplication across the layer managers and app.js,
code sitting outside systems that already exist (PANEL_SCHEMAS, slot-effects,
LAYER_UI_CONFIG), missing utils, and a mobile settings redesign. Every finding
below was verified by extracting and diffing actual method bodies, not by
eyeballing names. WP sections are paste-ready Codex prompts; decisions are
recorded first so the prompts don't re-litigate them.

Every WP inherits the CLAUDE.md rules: LF endings, tabs, no build step, bump
`?v=` on every JS file edited (and `style.css?v=` if SCSS changes — SCSS only,
never style.css), `dbg()` not console.log, run `node tests/touch-smoke.js` +
`node tests/touch-handle-verify.js`, plus `node tests/export-parity.js` +
`node tests/shape-border-verify.js` when effect sources or text/shape managers
are touched. Cross-manager logic goes in responsibility folders with thin
delegating methods kept on the classes — never inheritance between layer
managers.

---

## What was measured (evidence)

Method bodies were extracted from all five layer managers
(TextGlitterManager, ShapeGlitterManager, GlitterManager, StickerManager,
BaseBackgroundManager) and diffed after whitespace/type-name normalization:

- **Byte-identical modulo formatting** across Text/Shape/Sticker:
  `centerHorizontal`, `centerVertical`, `resetTransform` (same
  transform-lookup → call → `loadLayerSettings` refresh shape),
  `alignToCanvas`, `createTransformHandles`, `removeTransformHandles`.
- **Same job, drifted bodies** (the dangerous kind — drift is behavior skew,
  not intent): `closePickerSession` (Text guards + refreshes target buttons;
  Shape doesn't guard), `updatePickerStrip` (62/31/15/18/12 lines across the
  five managers), `armPicker` (Shape/Sticker/Base), `getGlitterSelectionTarget`
  (18/6/3 lines), `ensureEffectData`/`getEffectData` (Text normalizes first,
  Shape doesn't — both wrap the same `slot-effects.js` helpers with different
  signatures' semantics).
- **app.js repeated cluster:** 8 near-identical show/hide/collapse functions
  (`show/hideLayerSettingsEmptyState`, `show/hideGlitterSettingsEmptyState`,
  `show/hideStickerSettingsEmptyState`, `collapseLayer/Glitter/StickerSettings`,
  app.js:1013-1112) all doing the same classList dance over a uniform
  `${prefix}Empty` / `${prefix}Controls` / `${prefix}Content` /
  `${prefix}Toggle` id scheme.
- **Missing util:** `this.editor.layerManager.layers.find((l) => l.id === id)`
  hand-rolled at **34 call sites**; no `getLayerById` exists anywhere.
- **~25 inline `?? <literal>` fallbacks restating CONFIG defaults** in
  Text/ShapeGlitterManager (e.g. `border.scale ?? 100` at
  TextGlitterManager.js:1513-1518, `shadow.scale ?? 100` at 1544-1549;
  CONFIG.tools.effects.defaults.scale is already 100) — violates the
  CLAUDE.md config rule.
- **Mobile:** `MOBILE_SETTINGS_SECTION_CONFIG` (MobileManager.js:4-32) is a
  hand-maintained parallel table of selectors + collapsible names that
  PANEL_SCHEMAS already knows (`sectionPrefix`, `section.id`), and the design
  drawer shows sections **by default** unless they're explicitly relocated —
  which is exactly why every new panel type pops up in the Design tab.

**Checked and already healthy (do not touch):** slider binding is genuinely
unified on `bindSlider()` (app.js `setupSlider` and the quick-slider sync are
thin wrappers with app-specific callbacks — that's the intended thin-delegate
pattern); `dbg()` discipline holds (the only `console.log` in non-vendor JS is
inside debug.js); `renderGlitterAssetDisplay` asset-chip sharing is real;
`ContentManager` picker-base inheritance predates the no-inheritance rule and
is fine; slot-effects extraction and `effect-source.js` mirrors are doing
their job. GestureManager/ViewportManager/GifExporter internals stay on the
do-not-touch list from AUDIT-2026-07-09.

---

## Decisions

1. **Extraction pattern = D1–D5 pattern, always.** Shared function in a
   responsibility folder taking the manager (or a small context object) as
   first argument; one-line delegating methods stay on the classes so call
   sites don't churn. No new base classes, no mixins.
2. **Where drift exists, the *richest* behavior wins unless it's provably
   layer-specific.** E.g. `closePickerSession` keeps Text's guard + button
   refresh for everyone (a no-op refresh is harmless; a missing guard is a
   bug); `ensureEffectData` keeps Text's normalize-first via a hook flag
   (Shape passes its existing normalize behavior). Any case where unifying
   would *change* visible behavior gets a line in the WP report instead of a
   silent choice.
3. **`getLayerById(id)` lives on LayerManager**, not utils.js — it needs
   `this.layers` and LayerManager is already the layer-list owner. A bare
   null-safe lookup, no side effects. The 34 call sites migrate mechanically.
4. **Inline CONFIG-default fallbacks are replaced by reading the slot's
   defaults object**, not by repeating `CONFIG.…` at every site — each manager
   already builds `getDefaultBorder()`/`getDefaultShadow()`/`getDefaultFill()`;
   the UI-sync code should pull missing keys from those, one lookup per slot.
5. **Mobile becomes opt-in, schema-derived, in two stages.** Stage 1 (WP-6,
   correctness): kill the leak-by-default and the parallel table — on mobile
   the Design drawer shows **only the gallery**; settings sections are hidden
   in `.design-panel` unless relocated into the settings drawer; the section
   registry is derived from PANEL_SCHEMAS at boot. Adding a new panel type
   then requires zero MobileManager edits — its `LAYER_UI_CONFIG` +
   `PANEL_SCHEMAS` entries are the whole registration, same as desktop.
   Stage 2 (WP-7, flow): redesign the drawer flow itself. Stage 1 ships
   without Stage 2 and fixes the reported bug.
   Ryan decided (2026-07-13): **three-button bottom nav (Add / Layers / Edit)**
   and **the Image/Editor top tabs go away** — selecting the base layer now
   covers image replacement, so the tabs' reason to exist is gone. The
   no-image state becomes automatic (dropzone view until an image loads)
   instead of a user-navigated tab.
6. **Canvas touch controls are untouched.** Ryan: mobile controls on the
   canvas work great. GestureManager, handles, double-tap flows are all
   out of scope for every WP here.
7. **Dispatch order:** WP-1 → WP-2 → WP-3 are independent and parallel-safe
   (different files/clusters). WP-4 before WP-5 (both touch the effect-slot UI
   sync paths; 4 is mechanical, 5 is behavioral). WP-6 after WP-1..3 land
   (MobileManager calls two of the app.js empty-state functions being
   deduped). WP-7a after WP-6 is merged and Ryan has briefly used it; WP-7b
   (bottom sheet) only after WP-7a settles — never dispatch 7a and 7b
   together.

---

## WP-1 — Movable-layer transform delegates (S, parallel-safe)

**Paste-ready prompt:**

> In c:\xampp\htdocs\glitter on branch `masks-and-text`, read CLAUDE.md first
> and follow its rules exactly (tabs, LF, cache-bust bumps, thin delegates not
> inheritance).
>
> `TextGlitterManager`, `ShapeGlitterManager`, and `StickerManager` each carry
> near-identical bodies for `centerHorizontal(layerId)`,
> `centerVertical(layerId)`, `resetTransform(layerId)`, `alignToCanvas(...)`,
> `createTransformHandles(...)`, `removeTransformHandles(...)` — same shape:
> look up `this.layerTransforms.get(layerId)`, call the LayerTransform method,
> find the layer in `this.editor.layerManager.layers`, refresh via
> `this.loadLayerSettings(layer)`. Diff them yourself first to confirm the
> deltas are formatting-only; where a body genuinely differs (e.g. Sticker's
> handle creation), keep the difference in the manager and extract only the
> common core.
>
> Create `js/transforms/movable-layer.js` (load it in index.html next to
> transform-math.js with `?v=1`) exporting plain functions like
> `movableCenterHorizontal(manager, layerId)` etc. Replace the three managers'
> method bodies with one-line delegates. Do NOT touch GlitterManager or
> BaseBackgroundManager (they don't share this trio), and do NOT unify
> `loadLayerSettings` (measured divergent, deliberately per-type).
>
> Bump `?v=` on all edited JS files. Run `node tests/touch-smoke.js`,
> `node tests/touch-handle-verify.js`, `node tests/shape-border-verify.js`,
> `node tests/layer-reorder-transform-verify.js`. Report any body diff that
> was NOT formatting-only.

**Acceptance:** all four suites green; the trio exists once; managers keep
one-line delegates; no behavior change.

---

## WP-2 — app.js empty-state/collapse dedup (S, parallel-safe)

**Paste-ready prompt:**

> In c:\xampp\htdocs\glitter on branch `masks-and-text`, read CLAUDE.md first.
>
> app.js:1013-1112 has 8 functions that are one function wearing three prefixes:
> `showLayerSettingsEmptyState` / `hideLayerSettingsEmptyState` /
> `showGlitterSettingsEmptyState` / `hideGlitterSettingsEmptyState` /
> `showStickerSettingsEmptyState` / `hideStickerSettingsEmptyState` /
> `collapseLayerSettings` / `collapseGlitterSettings` / `collapseStickerSettings`.
> They all toggle `visible`/`collapsed` classes over the uniform id scheme
> `${prefix}Empty`, `${prefix}Controls`, `${prefix}Content`, `${prefix}Toggle`
> (prefixes: `layerSettings`, `glitterSettings`, `stickerSettings`).
>
> Add two generic methods —
> `setSettingsEmptyState(prefix, visible, { title, subtext } = {})` and
> `collapseSettingsSection(prefix)` — and turn the existing 9 into one-line
> wrappers (do NOT delete them or change their signatures: they're called from
> LAYER_UI_CONFIG onActivate handlers in config.js and from
> MobileManager.cleanup). Only `showLayerSettingsEmptyState` takes
> title/subtext today (ids `layerSettingsEmptyText`/`layerSettingsEmptySubtext`)
> — support those ids generically when present. Note the historical bug shape
> here (the `← FIXED` comment at app.js:1041 marks a copy-paste class-flip) —
> that's exactly what this dedup prevents recurring.
>
> Bump app.js `?v=`. Run `node tests/touch-smoke.js` and
> `node tests/panel-parity.js`.

**Acceptance:** suites green; 9 wrappers, 2 implementations; empty-state
behavior identical (spot-check: deselect all layers on desktop, switch layer
types, mobile→desktop resize restore path in MobileManager.cleanup).

---

## WP-3 — `getLayerById` util (S, parallel-safe)

**Paste-ready prompt:**

> In c:\xampp\htdocs\glitter on branch `masks-and-text`, read CLAUDE.md first.
>
> The expression `…layers.find((entry) => entry.id === layerId)` (variable
> names vary) is hand-rolled at ~34 call sites across app.js and
> js/classes/*.js. Add `getLayerById(layerId)` to LayerManager — null-safe,
> returns the layer or null, no side effects — and migrate every call site
> that searches `layerManager.layers` (or `editor.layers`, same array) by id.
> Do it mechanically: grep `layers.find(`, confirm each match is an id lookup
> (skip any that filter by other predicates), replace. Managers reach it as
> `this.editor.layerManager.getLayerById(id)`.
>
> Bump `?v=` on every JS file edited. Run `node tests/touch-smoke.js`,
> `node tests/touch-handle-verify.js`, `node tests/export-parity.js`.
> Report the final count of migrated sites and any `.find` left behind
> deliberately (non-id predicates).

**Acceptance:** suites green; one definition; remaining `layers.find(` matches
are non-id predicates only.

---

## WP-4 — Slot-effects wrapper unification + CONFIG-fallback sweep (M)

**Paste-ready prompt:**

> In c:\xampp\htdocs\glitter on branch `masks-and-text`, read CLAUDE.md first —
> especially the preview/export parity invariant and the config rule ("inline
> `??` fallbacks that restate CONFIG defaults are forbidden").
>
> Part A — wrapper drift. `TextGlitterManager.ensureEffectData/getEffectData`
> normalize the layer first (`this.normalizeLayer(layer)`) then call the shared
> `ensureSlotEffectData`/`getSlotEffectData` (js/effects/slot-effects.js);
> `ShapeGlitterManager`'s versions skip normalization and pass a different
> boolean tail argument. Unify the calling convention: both managers'
> wrappers normalize first (Shape's normalizeLayer is cheap/idempotent — verify
> that before assuming), and the slot-effects helpers take one options shape.
> Any *visible* behavior change must be listed in your report, not silently
> shipped.
>
> Part B — fallback sweep. In TextGlitterManager.js (~1513-1564) and its
> ShapeGlitterManager mirrors, UI-sync code reads `border.scale ?? 100`,
> `border.opacity ?? 100`, `shadow.scale ?? 100`, `shadow.opacity ?? 100`, etc.
> (~25 sites). Replace each literal with a lookup into the manager's own
> `getDefaultBorder()`/`getDefaultShadow()`/`getDefaultFill()` result (one
> `const defaults = …` per slot-sync block — the unset-branch nearby already
> does exactly this, e.g. TextGlitterManager.js:1524-1532; extend that pattern
> to the set-branch). Do NOT change what the defaults are. CAUTION: some `??`
> sites may be guarding genuinely-optional keys in projects saved before those
> keys existed — a fallback must keep *working*, it just must not restate the
> number. Load-test with an older .glitter.json if one exists.
>
> Text and Shape must change in the same commit (deliberate mirrors). Bump
> both `?v=`. Run ALL of: `node tests/touch-smoke.js`,
> `node tests/touch-handle-verify.js`, `node tests/export-parity.js`,
> `node tests/shape-border-verify.js`, `node tests/panel-parity.js`.

**Acceptance:** all five suites green; zero literal-default `??` left in the
two managers' slot-sync paths; export bytes unchanged (export-parity is the
proof).

---

## WP-5 — Picker-session helper (M, after WP-4)

**Paste-ready prompt:**

> In c:\xampp\htdocs\glitter on branch `masks-and-text`, read CLAUDE.md and
> docs/!old/D-1C-GALLERY-PICKER-SPEC.md (the session model's design doc) first.
>
> The pickerSession lifecycle is quintuplicated with drift across
> TextGlitterManager, ShapeGlitterManager, GlitterManager, StickerManager,
> BaseBackgroundManager: `armPicker`/`openPickerSession`, `closePickerSession`,
> `getGlitterSelectionTarget`, `updatePickerStrip` (62/31/15/18/12 lines
> respectively — same job, five renderings). Known drift with teeth:
> Text's `closePickerSession` guards on an existing session and refreshes
> `updateEffectTargetButtons` + `editor.updateGlitterSelection`; Shape's
> doesn't guard and only repaints the strip.
>
> Extract `js/ui/picker-session.js` (script tag next to panel-renderer.js,
> `?v=1`): the session state transitions (open/arm/close/is-armed-for) and the
> `#galleryPickerStrip` rendering core become shared functions taking the
> manager plus a small descriptor (slot label text, target-name formatter —
> `formatPickerStripText`/`formatAssetPickerStripText` in utils.js already
> exist for this). Per-manager hooks: what "refresh my UI after close" means.
> Managers keep thin delegates; every manager gets the guard + full refresh
> (Decision 2: richest behavior wins). The auto-clear call sites
> (LayerManager.setActiveLayer, HistoryManager.restoreState, bindEffectToggle
> off-branch, clearElements) must keep working — grep for every
> `pickerSession` read/write before starting and list them in the report.
>
> Do NOT touch GifExporter — the session is pure UI state and the exporter
> must stay unaware of it (documented invariant).
>
> Bump `?v=` on all edited files. Run `node tests/touch-smoke.js` and
> `node tests/panel-parity.js`. Manual checks for Ryan afterward (list in
> report): arm fill picker → pick → Done returns to properties; arm border →
> switch layer → session cleared; solid-fill browse hint strip; undo while
> armed clears the session; mobile drawer flip on `revealGlitterBrowser`.

**Acceptance:** suites green; one strip renderer; `closePickerSession`
behavior identical across managers; Ryan's manual pass on the five flows.

---

## WP-6 — Mobile Stage 1: schema-derived registry + opt-in drawer (M)

Root cause of "every new panel pops up when I open the Design tab": on mobile
the Design drawer IS the desktop `.design-panel`, shown wholesale. Sections
only leave it when `prepareSettings` physically relocates them into the
settings drawer, and relocation is driven by the hand-maintained
`MOBILE_SETTINGS_SECTION_CONFIG` table (MobileManager.js:4-32). Anything not
in that table — i.e. every newly added panel — stays visible in the drawer.
The brush section's special-case comment (MobileManager.js:562-570) describes
this exact leak and patches it for one section; WP-6 fixes the default.

**Paste-ready prompt:**

> In c:\xampp\htdocs\glitter on branch `masks-and-text`, read CLAUDE.md, then
> read js/classes/MobileManager.js in full, plus PANEL_SCHEMAS in
> js/core/config.js (~line 847) and `mobileSettingsSections` in
> LAYER_UI_CONFIG (config.js:651-810).
>
> Two changes, one goal: adding a new panel type must require ZERO
> MobileManager edits and must never appear in the mobile Design drawer.
>
> 1. **Derive the section registry.** Delete the hand table
> `MOBILE_SETTINGS_SECTION_CONFIG`. Build the same {key → {element,
> collapsibleName}} map at init time from PANEL_SCHEMAS: each schema entry
> already has `sectionPrefix` (= the collapsible name, e.g. `textSettings`)
> and `section.id` (e.g. `textSettingsSection`) — resolve elements by section
> id, not by the `.text-settings-section` class selectors. The registry keys
> must remain the ones `mobileSettingsSections` uses today (`tool`, `glitter`,
> `sticker`, `text`, `shape`, `background`, `brush`) — add a `mobileKey`
> field to each PANEL_SCHEMAS entry mapping schema → key (brush's schema
> exists at config.js:873; `tool` maps to the layer-settings section). If a
> schema has no `mobileKey`, it simply never participates in mobile — that is
> the desired default for future panels until someone opts them in.
> `cacheSettingsSections`, `collapseAllSections`, `prepareSettings`,
> `returnSettingsSections` all read the derived registry; their logic is
> otherwise unchanged (the relocation model stays — do NOT rewrite it).
>
> 2. **Make the Design drawer opt-in.** On mobile, the Design drawer shows
> ONLY the gallery (`#designGalleryContent`'s section) — never settings
> sections, moved or not. Implement as CSS in style.scss (mobile breakpoint
> block / _mobile.scss): inside `.design-panel`, hide every settings section
> except the gallery section. Relocated sections are unaffected (they live in
> `.mobile-settings-content` while shown). This replaces the per-section
> leak-patching; the brush placement logic (`syncBrushSettingsPlacement`)
> stays as the mechanism that moves brush settings into the settings drawer,
> but the CSS now guarantees a visible-but-unmoved section can't leak. Check
> the desktop→mobile resize path (setupResizeObserver) and MobileManager.cleanup
> still restore desktop correctly.
>
> Bump MobileManager.js and config.js `?v=`, and `style.css?v=` after Ryan
> recompiles (edit style.scss only — NEVER css/style.css). Run
> `node tests/touch-smoke.js` (twice, fresh) and `node tests/panel-parity.js`.
> Report: the derived registry printed at boot via `dbg()` must list the same
> seven keys as the old table.

**Acceptance:** the seven existing keys resolve identically; Design drawer
shows only the gallery on mobile; a scratch dummy PANEL_SCHEMAS entry without
`mobileKey` renders on desktop and never appears anywhere on mobile;
touch-smoke green twice.

---

## WP-7a — Mobile Stage 2: three-button flow, tabs removed (L, after WP-6)

The flow was designed when Design was the only panel and grew patches (brush
relocation, `has-layer-settings` body classes, drawer/settings independence
rules, collapse-on-tab-switch). Stage 1 makes it correct; this makes it
designed. Decisions locked with Ryan 2026-07-13: three-button bottom nav;
Image/Editor tabs removed (base-layer selection covers image replacement);
one drawer at a time; auto drawer-switching allowed where it serves the flow.

**Target model:**

- **Bottom nav = three intents:** `Add` (the Design drawer: gallery only —
  after WP-6 that's all it contains), `Layers`, `Edit` (settings drawer for
  the active layer, or the active tool's section while brushing). Gallery =
  insertable content, panels = properties — the same line the TOOLBARS plan
  (decision 8) drew for desktop.
- **No top tabs.** The no-image state is *derived*, not navigated: until
  `editor.originalImage` exists, mobile shows the dropzone view (what the
  Image tab shows today); `imageLoaded` switches to the editor view. There is
  no way (and no need) to navigate back — replacing the image is a base-layer
  property (Canvas Properties panel), and New/Open live in the header menu.
- **One drawer open at a time.** Opening any of the three closes the others.
  Adding content from the gallery may auto-open Edit for the new layer only
  when `CONFIG.ui.mobile.openDrawOnLayerAdd` is true — the existing config
  knobs stay the single source of truth for auto-behavior.
- **Sections inside the Edit drawer stay the desktop accordion** (shared
  `setCollapsibleSectionOpen` state — already unified, keep it). The
  relocation mechanism from WP-6 may be kept OR replaced if the implementation
  genuinely gets simpler without it — it is not sacred; what is sacred is the
  registry staying schema-derived and desktop markup staying the single
  source of the sections.

**Paste-ready prompt:**

> In c:\xampp\htdocs\glitter on branch `masks-and-text`, read CLAUDE.md, then
> js/classes/MobileManager.js in full, and skim css/_mobile.scss. WP-6 (schema-
> derived section registry + gallery-only Design drawer) must already be
> merged — verify `MOBILE_SETTINGS_SECTION_CONFIG` no longer exists before
> starting.
>
> Restructure the mobile shell to the target model above. Concrete anchors:
>
> - **Markup:** top nav + tabs at index.html:48-51 (`.mobile-top-nav`,
>   `.mobile-tab-btn` data-tab image/preview) — remove. Bottom nav at
>   index.html:2021-2042 currently Layers / #mobileAddLayerBtn / Design, plus
>   a separate `.mobile-settings-drawer` with `#mobileSettingsBtn`
>   (index.html:2045-2058). Rework to three `.mobile-drawer-btn`s: Add
>   (design drawer), Layers, Edit (settings drawer). The quick
>   `#mobileAddLayerBtn` behavior folds into Add; keep the layers-count
>   swatch on the Layers button.
> - **State classes:** `body.mobile-image-tab` / `body.mobile-preview-tab`
>   (css/_mobile.scss:449, 501, 579-580) become a derived
>   `body.mobile-no-image` / default split driven by `imageLoaded` and image
>   clearing — MobileManager.switchTab/activeTab and the tab listeners go
>   away; `setupImageEvents` (MobileManager.js:237-261) becomes the single
>   place that flips the state. `designOpen`/`layersOpen`/`mobileSettingsOpen`
>   (css/_mobile.scss:528, 551, 572) unify under one open-drawer model:
>   `toggleDrawer` handles all three, `closeAllDrawers` clears all three, and
>   the settings drawer stops being a special sibling (`toggleSettings`/
>   `settingsOpen` fold into the drawer model; `has-layer-settings` remains
>   only as the Edit-button-enabled signal).
> - **Preserved behaviors** (these have tests or config contracts):
>   double-tap-text opens Edit + focuses the text input (touch-smoke check
>   21); mobile layer reorder (check 22); `openDrawer(drawer)` stays
>   idempotent-open (comment at MobileManager.js:356-358 explains why);
>   brush-tool section placement (`syncBrushSettingsPlacement`) now targets
>   the Edit drawer; `CONFIG.ui.mobile.autoCloseDesignDrawer` /
>   `openDrawOnLayerAdd` keep their meanings; desktop↔mobile resize
>   (setupResizeObserver, cleanup) must still fully restore desktop.
> - **SCSS only** (style.scss/_mobile.scss; never css/style.css); tell Ryan
>   to recompile and bump `style.css?v=`. Bump `?v=` on MobileManager.js,
>   app.js, and any other JS edited. Update modals/guide.html if any
>   user-facing naming changes (the guide mirrors panel/tool names).
>
> Run `node tests/touch-smoke.js` twice from fresh and
> `node tests/touch-handle-verify.js`. Checks 21-22 must pass unmodified;
> if a check hardcodes the old tab flow (some drive `switchTab` or assert
> tab buttons), update the harness minimally and list every harness change
> in the report — harness edits are allowed, behavior-assertion changes are
> not. Finish with a manual-test list for Ryan (fresh load → dropzone →
> upload → editor; the three buttons; rotate; resize across the 800px
> breakpoint both ways; brush tool; undo after drawer churn).

**Acceptance:** three-button nav; no top tabs; no-image state automatic;
one-drawer invariant holds; touch-smoke (×2) + handle-verify green; Ryan's
manual pass.

---

## WP-7b — Edit drawer as bottom sheet (M, optional, after WP-7a settles)

Recommended (my call, per "do what's best"): the Edit drawer becomes a
half-height bottom sheet — canvas stays visible while sliders change it,
which is the single biggest mobile UX gap vs Canva, and this app is
slider-heavy. Deliberately split from WP-7a so the flow restructure isn't
held hostage by presentation polish, and so Ryan can feel 7a first and skip
7b if the overlay turns out fine.

Sketch for the eventual prompt (do not dispatch until 7a is in Ryan's hands):
sheet = the Edit drawer at ~45% height with the canvas viewport resized above
it (not overlaid — the viewport must reflow so transform handles stay
reachable; `viewport.performResizeUpdate()` already handles reflow), drag
handle to expand to full height, swipe-down to dismiss. Gesture must not
fight GestureManager: the sheet's drag region is its header only, marked
`.ui-ignore-gestures` like other canvas-overlay UI.

---

## Explicitly not doing (so Codex doesn't "helpfully" expand)

Attribution matters — each line says whose call it is:

- **No inheritance between layer managers; no shared base class for them.**
  *Fable recommendation, backed by the repo's recorded decision (AUDIT-2026-07-09
  decision 1, CLAUDE.md), not a Ryan instruction from this round — Ryan asked
  about inheritance opportunities and this is the considered answer.* The
  duplication is method-level across managers with different constructors and
  lifecycles; shared functions + one-line delegates give the same reuse
  without coupling five classes to a common base, and a base class inserted
  mid-hierarchy is the hardest thing to back out of later. Where classes DO
  share a real lifecycle, inheritance is fine — `ContentManager` for the two
  pickers already proves it. Overridable if a future case shows a genuine
  shared lifecycle.
- **No rewrite of the mobile relocation mechanism *in WP-6*.** *Fable
  judgment: Stage 1 is the smallest correct fix.* In WP-7a the mechanism is
  fair game (see its target-model note) — it is not sacred, only the
  schema-derived registry and desktop-markup-as-single-source are.
- **No changes to canvas touch handling, GestureManager, LayerTransform
  handles, ViewportManager, GifExporter frame logic.** *Ryan: canvas mobile
  controls work great; plus the standing do-not-touch list.*
- **No unification of `loadLayerSettings`, `renderLayer`, `setupUI`,
  `setupEventListeners`, `getMeasurementEntry`.** *Fable measurement — bodies
  diffed, genuinely divergent per-type work, not copy-paste.*
- **No slider work.** *Fable measurement — already unified on `bindSlider`.*

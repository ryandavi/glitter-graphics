# Context Toolbars, Text QOL, Project Open/Save UX — 2026-07-12

Scope: (1) finish the context-toolbar system (schema-driven controls + renderer +
command registry, not just eligibility), (2) text case transformation, (3) editing
text on canvas, (4) Photoshop-style missing-asset / version preflight on project
open, (5) configurable project filename suffix, (6) panel-structure decision
(groups vs. separate panels), (7) default sticker on layer add, (8) Design gallery
scope. WP sections are paste-ready Codex prompts. Decisions and recommendations
are recorded first so the prompts don't re-litigate them.

Every WP inherits the CLAUDE.md rules: LF endings, tabs, no build step, bump `?v=`
on every JS file edited (and `style.css?v=` if SCSS changes — SCSS only, never
style.css), `dbg()` not console.log, mirror new UI/shortcuts in `modals/guide.html`,
run `node tests/touch-smoke.js` + `node tests/touch-handle-verify.js`, plus
`node tests/export-parity.js` when text/effect rendering is touched.

---

## Decisions (recommendations baked into the WPs)

1. **Context toolbars become fully schema-driven** (WP-1). Today
   `CONFIG.ui.contextToolbars` only holds eligibility (`js/core/config.js:304-316`);
   markup is hand-written in index.html (`#zoomControls` etc., lines ~1116-1233) and
   each toolbar has its own listener-setup function in app.js (`setupZoomListeners`,
   `setupPanListeners`, `setupLayerCenterListeners`, the color-picker sync, the
   mask-brush quick slider). The complete system: each toolbar entry declares its
   `controls` (button / slider / toggle / readout / group) with icon, label,
   tooltip, range; each actionable control names an **action id** resolved through a
   shared command registry; a dedicated renderer (`js/ui/context-toolbar-renderer.js`)
   stamps the DOM once at boot, exactly like `js/ui/panel-renderer.js` does for
   sidebar panels — render once, bind once, update values in place. Existing element
   ids are preserved so nothing else breaks.
2. **Text case is a non-destructive display transform** (WP-2), Figma-style:
   `textData.textCase: 'none' | 'upper' | 'lower' | 'title'`. It never mutates the
   stored string — it applies at the single point where render text is derived, so
   preview and export can't diverge, and switching back to "As typed" restores the
   original.
3. **On-canvas text editing ships in two stages** (WP-3). Stage 1 (cheap, do first):
   the existing double-click handler (app.js:133-142 already focuses + selects the
   sidebar textarea) additionally opens the Text Properties section/drawer when
   collapsed. Stage 2 (real in-canvas typing): an edit mode that swaps the layer's
   glitter span-stack preview for a plain editable element with identical metrics.
   This is feasible *because* preview is DOM, but it has sharp edges (transform,
   IME, mobile keyboards) — it's speced below as its own WP so it can be dropped or
   deferred without holding Stage 1.
4. **Project open gets a preflight report before any state is touched** (WP-4).
   Today a missing sticker source makes `deserializeSticker` return `null`
   (js/classes/StickerManager.js:972-975) and the layer is **silently dropped**
   (ProjectSerializer.load skips null layers). Preflight scans the parsed JSON for
   every resolvable reference and shows one modal (Photoshop missing-links style):
   what's missing, what will happen, Open Anyway / Cancel. Loading then degrades
   gracefully (placeholder layers) instead of dropping. Version checks fold into the
   same dialog. This WP also investigates the bug Ryan actually hit: the custom
   sticker WAS re-registered in user uploads but the layer didn't bind to it —
   prime suspect is ordering (`registerCustomStickers` runs before `loadBaseImage`,
   and the base-image load path resets editor state; check whether that reset clears
   or re-keys `stickerManager.userContent` / blob URLs).
5. **Project filename suffix is a config key** (WP-5). Yes — append to the end.
   `CONFIG.project.fileNameSuffix` (e.g. `'_ryandavi-com'`) is appended to the
   sanitized project name before the `.glitter.json` extension. When the project is
   unnamed the existing fallback `CONFIG.export.core.defaultBaseName`
   ('ryandavi-com_glitter') already contains the site name, so the suffix is skipped
   in that case to avoid `ryandavi-com_glitter_ryandavi-com.glitter.json`. GIF/MP4
   export names are left unchanged.
6. **Keep one Properties section per layer type; make the groups collapsible.**
   Recommendation against splitting Appearance/Transform/Effects into separate
   accordion panels: Figma and Photoshop both keep a single properties column with
   grouped cards; separate sections would multiply header chrome, fight the
   existing accordion (`syncCollapsibleSections`), and complicate mobile (drawers
   already map `mobileSettingsSections` onto groups). Instead: schema groups
   (already stamped `data-panel-group` by `buildPanelGroup`) get a collapsible
   header with persisted open/closed state (WP-6). If that still feels crowded
   after use, revisit — the schema makes a later split cheap.
7. **Default sticker on add, config-gated** (WP-7).
   `CONFIG.tools.stickers.defaultStickerId: '<id>' | null` — null preserves today's
   empty state. Set to a library sticker id so a new sticker layer is never a
   confusing empty box; the gallery still opens for immediate swapping. Ryan picks
   the actual id.
8. **Design gallery = insertable content; attributes stay in panels** (WP-8).
   Shapes are insertable content → add a Shapes tab to the gallery (click = add
   shape layer), reusing the existing gallery card/tab patterns and the
   `ShapeLibrary` renderer already used by the shape picker. Fonts are an
   *attribute* of a text layer, not insertable content → they stay in Text
   Properties (adding a Fonts tab would need a "which layer?" answer the gallery
   can't give). The gallery's picker-mode (armed destination strip) is untouched.
   This keeps the panel's identity crisp: "everything you can add to the canvas."

---

## WP-1 (Codex) — Schema-driven context toolbars: controls, commands, renderer

```
In c:\xampp\htdocs\glitter (branch masks-and-text), read CLAUDE.md first — LF endings,
tabs, no build step, bump ?v= on every JS file you edit, dbg() not console.log.

Context: CONFIG.ui.contextToolbars (js/core/config.js ~304) currently holds only
eligibility (tool, layerTypes, allowMultiSelection, requiresStickerSource,
requiresSelections); app.js updateContextToolbars (~4234) picks the visible bar.
The toolbar markup is hand-written in index.html (#zoomControls, #colorPickerControls,
#maskBrushControls, #panControls, #layerCenterControls, ~lines 1116-1233) and each
bar binds its own listeners in app.js (setupZoomListeners, setupPanListeners,
setupLayerCenterListeners ~1886-1937, color-picker control sync, and the
mask-brush quick slider inside setupMaskEditorListeners).

Task — make the toolbars fully configuration-driven, mirroring how sidebar panels
work (js/ui/panel-renderer.js renders PANEL_SCHEMAS from tpl-* templates once at
boot; managers keep updating values in place; nothing re-renders after boot):

1. Extend each CONFIG.ui.contextToolbars entry with a `controls` array. Control
   kinds needed by the five existing bars: `button` (icon, name, title, action,
   optional primary), `readout` (id, title, action for click-to-reset, e.g. zoom
   percentage), `slider` (label, min/max/value or a CONFIG.ui.sliders ref, value
   readout with unit), `toggle` (checkbox + label + optional count readout, e.g.
   Multi + #contextSelectionCount), and `group` (visual grouping wrapper, as the
   color-picker bar groups its two checkboxes). Keep eligibility fields as they are.
   Preserve EVERY existing element id (zoomIn, zoomPercentage, contextThreshold,
   contextThresholdValue, contextMultiSelect, contextSelectionCount,
   maskBrushSizeQuick, centerLayerHorizontal, duplicateLayerSelection, ...) —
   other code and tests bind them by id.
2. New file js/ui/context-toolbar-renderer.js (plain script + <script> tag with
   ?v=1 in index.html, loaded after panel-renderer.js and before app.js). It builds
   each toolbar's children from the schema at boot into the existing container
   divs (keep the container divs + their classes/ids in index.html so layout and
   updateContextToolbars stay stable; delete only the hand-written inner markup).
   Add tpl-* <template> primitives for the control kinds next to the existing panel
   templates rather than string-building HTML; reuse tpl-slider-row-like structure
   where the context bars' markup allows (context bars use .context-slider-group,
   not .setting-* — keep the context classes so _panels.scss styling holds).
3. Shared command registry: a `COMMANDS` map (suggest js/core/commands.js, or fold
   into an existing core file if it stays tiny) from action id → { run(editor, ...),
   optional isEnabled(editor) }. Wire the schema controls' `action` ids through one
   generic binding pass in the renderer (or a single app.js helper called at boot) —
   this REPLACES setupZoomListeners, setupPanListeners, and setupLayerCenterListeners;
   delete them. Actions to register: zoomIn, zoomOut, zoomReset, zoomFit, zoomFill,
   centerCanvasH, centerCanvasV, centerSelectionH, centerSelectionV,
   duplicateSelection (reuse editor.cloneSelectedLayers — note Ctrl+D shortcut and
   this button must share the same command). Sliders/toggles keep their existing
   owner bindings (MaskEditor's syncQuickSlider, color-picker sync) — do not move
   manager-owned two-way sync into the command map; commands are for fire-and-forget
   actions.
4. Runtime state: give the renderer a tiny api (window-scoped like the other
   modules) to set a control's enabled/active/hidden state and displayed value by
   action id or control id, and route the existing ad-hoc updates
   (updateColorPickerControls, zoom percentage text) through it where that's a
   simplification, not a rewrite.
5. Icons: reuse the existing #icon-* sprite refs from the current markup verbatim.
6. Verify: all five bars render identically to before (visually and by id), the
   right bar shows per tool/selection, duplicate/center/zoom/pan all work, slider
   sync still mirrors the sidebar brush size. Run node tests/touch-smoke.js and
   node tests/touch-handle-verify.js.

Do not add a sixth toolbar or new controls in this WP — parity refactor only.
Best practices, I trust you.
```

## WP-2 (Codex) — Text case transformation (non-destructive)

```
In c:\xampp\htdocs\glitter (branch masks-and-text), read CLAUDE.md first — LF endings,
tabs, no build step, bump ?v= on every JS file you edit, dbg() not console.log.
Critical invariant: preview is DOM, export is canvas — text rendering must stay
identical on both sides, and masks stay binarized.

Feature: Figma-style letter-case control for text layers.
textData.textCase: 'none' | 'upper' | 'lower' | 'title' (default 'none'), a
DISPLAY transform — layer.textData.text is never mutated, so switching back to
'none' restores what the user typed.

1. Model: default in CONFIG.tools.text (defaultTextCase: 'none');
   TextGlitterManager.normalizeLayer backfills it (see how fontWeight is
   backfilled ~line 624). Serialization: it rides along inside textData — adding
   an optional key with a default does NOT bump the project format version
   (ProjectSerializer format rules, js/classes/ProjectSerializer.js:5-11).
2. Single application point: add a small pure helper (e.g. applyTextCase(text,
   mode) in TextGlitterManager, or js/core/utils.js if anything else needs it) and
   use it where render lines are derived — getMeasurementEntry currently does
   String(layer.textData.text || '').split('\n') at js/classes/TextGlitterManager.js:1974.
   Audit for any other place raw textData.text feeds rendering/measurement (mask
   draw ~2085 uses the measurement entry's lines — confirm). Layer NAMES and the
   sidebar textarea keep the raw text. 'title' = first letter of each
   whitespace-separated word uppercased, rest untouched. Use locale-safe
   toLocaleUpperCase/toLocaleLowerCase.
3. Cache: getCacheKeyForLayer (~1930-1958) must include textCase, or stale masks
   will serve the wrong case.
4. UI: in the Text Properties Content group, next to the existing Style
   (Bold/Italic) segmented control (index.html tpl-text-content ~965-971, bound via
   bindFontStyleToggle ~231), add a Case segmented control: As Typed / UPPER /
   lower / Title (ids textCaseNone/textCaseUpper/textCaseLower/textCaseTitle).
   Follow the existing segmented-control pattern and the schema route the other
   text controls use (templateCard entries in PANEL_SCHEMAS text Content group,
   js/core/config.js ~872-880) — add it to the template + a templateCard entry, and
   confirm it appears in the mobile text drawer (LAYER_UI_CONFIG
   mobileSettingsSections). Sync active state in loadLayerSettings like the
   Bold/Italic buttons (~1404). Undo must capture it (it lives in textData, so
   saveState on change like the style toggles).
5. Mirror the new control in modals/guide.html (Text Properties).
6. Tests: node tests/export-parity.js (text rendering touched), plus touch-smoke
   and touch-handle-verify.

Best practices, I trust you.
```

## WP-3 (Codex) — Text editing on canvas

```
In c:\xampp\htdocs\glitter (branch masks-and-text), read CLAUDE.md first — LF endings,
tabs, no build step, bump ?v= on every JS file you edit, dbg() not console.log.
Invariants that bite here: preview is DOM (TextGlitterManager renders a per-slot
masked span stack); no-flicker rules (never clear-and-rebuild glitter DOM in render
paths; decode new masks before swapping); canvas-overlay UI needs .ui-ignore-gestures;
touch routes through GestureManager and capture-phase handlers must exclude
.transform-handle-wrapper/.transform-handles.

Stage 1 — double-click polish (do this first, it ships even if Stage 2 stalls):
app.js:133-142 already handles dblclick on a text layer: loadLayerSettings + focus +
select-all on the sidebar textarea (#textLayerInput). Extend it to ensure the input
is actually visible first: open the Text Properties section when collapsed
(editor.setCollapsibleSectionOpen('textSettings', true, ...) — see how utils.js:8 and
LayerManager.js:262 do it for designGallery), and on mobile open the text settings
drawer via MobileManager. Also make GestureManager's double-tap (CONFIG.ui.gestures
doubleTap*) trigger the same path on touch. Keep select-all behavior.

Stage 2 — in-place editing (Figma-style). Design:
1. Edit mode on TextGlitterManager: entered by double-click/double-tap on an
   already-selected text layer (Stage 1 keeps working as fallback via a CONFIG
   flag: CONFIG.tools.text.canvasEditing = true|false, false = Stage 1 behavior
   only). While editing, hide the layer's glitter span stack (visibility, do NOT
   destroy it — recreating restarts GIFs) and overlay a plain-text editing element
   inside the layer's overlay element with identical metrics: same font
   declaration (getFontDeclaration), font-size, letter-spacing, line-height,
   text-align, and the same CSS transform the layer element carries (rotation/
   scale/flip must WYSIWYG). Use a contenteditable div with white-space:pre-wrap
   (plain-text paste only: intercept paste, insertText) — plain readable fill
   (theme ink color) so the caret and selection are visible; glitter resumes on
   commit. Respect box mode: fixed box wraps at boxWidth; point text grows.
2. Live sync: on input, write the element's textContent into
   layer.textData.text and run the SAME update path the sidebar textarea uses
   (find #textLayerInput's input handler in TextGlitterManager and reuse it —
   do not fork a second update pipeline). Sidebar textarea mirrors live. Respect
   maxTextLength (CONFIG.tools.text.maxTextLength).
3. Commit/cancel: commit on blur, click-away, Enter is a NEWLINE (multi-line
   text), Escape cancels (restore the pre-edit string). One undo entry per edit
   session (snapshot on enter, saveState on commit — not per keystroke).
4. Input routing: the editing element needs .ui-ignore-gestures and must win over
   GestureManager/LayerTransform pointer handling while active; entering edit mode
   must not start a drag; transform handles stay visible but inert or hidden while
   editing (pick whichever Figma-like behavior is simpler — state it in the
   summary). Keyboard shortcuts (Ctrl+D, tool keys, Delete) must be suppressed
   while editing — check how the sidebar textarea already guards shortcut
   handling in app.js and reuse that guard (likely an isTypingTarget check).
5. Empty commit: committing empty text keeps the layer (matches deleting all text
   via the sidebar today) — verify parity with the sidebar-path behavior either way.
6. If metrics parity between the editable element and the span stack cannot be
   made pixel-stable for rotated/scaled layers, ship Stage 1 + the flag default
   OFF and document the blocker in the summary instead of forcing it.

Mirror any new shortcut/behavior in modals/guide.html. Tests: node
tests/touch-smoke.js, node tests/touch-handle-verify.js, node
tests/export-parity.js. Headless probe gotchas are in CLAUDE.md.

Best practices, I trust you.
```

## WP-4 (Codex) — Project-open preflight: missing assets, versions, graceful degrade

```
In c:\xampp\htdocs\glitter (branch masks-and-text), read CLAUDE.md first — LF endings,
tabs, no build step, bump ?v= on every JS file you edit, dbg() not console.log.

Context: js/classes/ProjectSerializer.js. Today load() validates shape/version,
then mutates editor state as it goes. Missing references fail late and silently:
deserializeSticker returns null when stickerSourceId doesn't resolve
(js/classes/StickerManager.js:963-988) and ProjectSerializer.load just skips the
layer. A newer-version file throws a bare error (validateProjectData:117). Nothing
checks glitter ids, font ids, or shape ids.

Part A — root-cause the reported bug first: Ryan opened a project whose embedded
custom sticker DID appear under user uploads, but the sticker layer came back
empty/unbound and he had to re-pick it. Suspects: load() calls
registerCustomStickers BEFORE loadBaseImage (ProjectSerializer.js:72-73), and the
base-image path (editor.loadImageFromBlob / loadBlankImage) runs an editor reset —
check whether that reset clears or re-creates stickerManager userContent, revokes
blob URLs, or re-keys ids, leaving the layer's stickerSourceId dangling while a
fresh registration shows in the gallery. Fix the ordering/ownership properly
(e.g. register embedded stickers after the base-image reset), don't patch around it.

Part B — preflight report, before any editor state is touched:
1. New ProjectSerializer.preflight(data) run after validate+migrate but before the
   unsaved-changes confirm. It scans the parsed JSON only (no side effects) and
   returns a structured report of issues:
   - sticker layers whose stickerSourceId resolves to neither a library sticker
     nor an embedded customStickers entry (built-in removed from the site, or
     embed missing);
   - text layers whose fontId is not in the fonts manifest
     (textGlitterManager.getFontById);
   - shape layers whose shapeData shape id is not in ShapeLibrary;
   - any layer/effect slot referencing a glitter asset id not in the glitter
     catalog (glitterManager.getItemById) — check selectedGlitterId AND the
     per-slot effect sources (textData fill/border/shadow, shapeData fill/border/
     shadow, stickerData shadow — grep how slot-effects/effect-source resolve
     glitterId and cover the same fields);
   - unknown layer types (forward-tolerance: report + skip, don't crash);
   - version: newer-than-editor stays a hard block but gets the dialog treatment
     with a clear message; older-with-migrations loads silently (that's the
     designed path).
2. Dialog: reuse the existing confirm modal pattern (editor.confirmAction) if it
   can render a body list; otherwise extend it minimally. Content: project name,
   grouped issue list that is SPECIFIC ("Sticker 'party-hat.png' is missing — the
   layer will load empty", "Font 'Bubblegum' unavailable — text will use Luckiest
   Guy", "Glitter 'holo-pink' unavailable — default glitter substituted"), then
   Open Anyway / Cancel. Cancel aborts with zero state change. No issues → no
   dialog, load as today.
3. Graceful degrade on Open Anyway (this is the part that makes the promise true):
   - missing sticker source → keep the layer as an empty sticker layer
     (stickerData.isEmpty pattern from StickerManager.createLayer:636) preserving
     its transform, instead of deserializeSticker returning null;
   - missing font → substitute CONFIG.tools.text.defaultFontId;
   - missing glitter → substitute the manager's default asset the same way a
     fresh layer gets one;
   - each substitution flagged so the layer list can show it (reuse the
     LAYER_BADGES mechanism in js/core/config.js:1019 — add a 'missing asset'
     badge with a tooltip naming what was missing).
4. Keep validateProjectData's hard failures (not JSON, wrong format, bad canvas
   dims) as errors — preflight is for degradable issues only.
5. Tests: extend or add a small node/Playwright probe that saves a project,
   deletes/renames an asset reference in the JSON, reopens, and asserts (a) the
   dialog reports it and (b) Open Anyway yields a placeholder layer, not a dropped
   one. Run the standard suites (touch-smoke, touch-handle-verify) plus
   export-parity if any manager render path changed.

Best practices, I trust you.
```

## WP-5 (Codex) — Project filename suffix config

```
In c:\xampp\htdocs\glitter (branch masks-and-text), read CLAUDE.md first — LF endings,
tabs, no build step, bump ?v= on every JS file you edit.

Small, self-contained. Today saveProjectFile (js/app.js:5373) downloads
getProjectFileName('glitter.json') → `${sanitizeFileName(projectName) ||
CONFIG.export.core.defaultBaseName}.glitter.json` (app.js:292-295).

1. New CONFIG.project block in js/core/config.js:
   project: {
     extension: 'glitter.json',
     // Appended to the project name before the extension so downloads are
     // recognizable, e.g. 'birthday_ryandavi-com.glitter.json'. Skipped when the
     // name falls back to export.core.defaultBaseName (it already carries the
     // site name).
     fileNameSuffix: '_ryandavi-com'
   }
2. Add a getProjectDownloadName() (or extend getProjectFileName with a
   project-aware call site — keep GIF/MP4 export naming EXACTLY as it is, they
   also call getProjectFileName): sanitized name + suffix + '.' + extension;
   unnamed → defaultBaseName + '.' + extension with no suffix. Run the suffix
   through sanitizeFileName too so a config typo can't produce an invalid name.
3. Project OPEN must keep accepting both old and new names — confirm the file
   input/drop path filters by extension or content, not an exact suffix match,
   and that deriving a project name from a dropped file (if any code does that)
   strips the suffix + extension.
4. Quick verify: save unnamed and named projects, check both filenames; export a
   GIF and confirm its name is unchanged.

Best practices, I trust you.
```

## WP-6 (Codex) — Collapsible property groups (instead of separate panels)

```
In c:\xampp\htdocs\glitter (branch masks-and-text), read CLAUDE.md first — LF endings,
tabs, no build step, bump ?v= on every JS file you edit; SCSS changes go in
css/style.scss partials only (Ryan compiles), bump style.css?v= in index.html.

Decision already made: layer Properties stay ONE section per layer type; the
schema groups inside (Content / Appearance / Transform / Effects) become
individually collapsible, Figma-style. Do NOT create new accordion sections or
rename any *SettingsSection ids.

1. js/ui/panel-renderer.js buildPanelGroup (~343) already stamps
   data-panel-group={title} and a .subsection-title header; the Effects stack in
   renderPanelSection (~371) gets the same treatment. Make the group header a
   toggle: chevron affordance, click collapses the group's content. Groups whose
   title row carries a control (the Apply-to-All toggle in the glitter schema)
   must keep that control functional — clicks on it don't toggle collapse (see
   data-no-accordion-toggle precedent in index.html:354).
2. Persist collapsed state per group across sessions and layer types in
   localStorage under one key (e.g. glitter.panelGroups), keyed by
   `${schema.prefix}:${group.title}`. Default: all open. Loading a layer's panel
   applies the persisted state — but if a group contains the control the user just
   invoked (e.g. auto-opened settings after adding a layer), leave the section
   auto-open behavior alone; only group-level state is managed here.
3. Interaction with managers: collapse via a class + CSS (max-height/display),
   never by removing DOM — every manager holds element references bound at boot
   (panel-renderer renders once; rebuilding orphans listeners).
4. SCSS: reuse the existing collapsible conventions (.collapsed / .is-open used by
   initializeStandaloneCollapsibles and the section accordion) and existing tokens;
   no new hardcoded colors/z-indexes.
5. Mobile: mobileSettingsSections drawers already slice panels by group — verify
   the drawer rendering ignores/overrides desktop collapse state rather than
   inheriting a collapsed group into a drawer.
6. Mirror in modals/guide.html if it describes panel layout. Tests: touch-smoke,
   touch-handle-verify.

Best practices, I trust you.
```

## WP-7 (Codex) — Default sticker on add

```
In c:\xampp\htdocs\glitter (branch masks-and-text), read CLAUDE.md first — LF endings,
tabs, no build step, bump ?v= on every JS file you edit.

Small. New sticker layers start empty (StickerManager.createLayer(null) →
stickerData.isEmpty, js/classes/StickerManager.js:636) which reads as broken to
new users.

1. CONFIG.tools.stickers gets defaultStickerId: <library-id> | null (null = keep
   today's empty start; leave a comment saying exactly that). Pick a placeholder
   value and flag it in your summary — Ryan will choose the real sticker id.
2. Wherever "add sticker layer" is invoked without an explicit source (add-layer
   modal / layers-panel add — find the call sites of addStickerToCanvas/createLayer
   with null), resolve CONFIG.tools.stickers.defaultStickerId through
   getItemById first; if the id is set but stale (asset removed), fall back to
   empty rather than throwing.
3. Keep the current follow-up behavior: the Design gallery still opens/focuses for
   an immediate swap (LayerManager.js:261 area) — the default sticker is a
   starting value, not a workflow change. Undo of the add removes the layer as
   today.
4. Verify: add sticker via every entry point (desktop modal, mobile), with the id
   set, null, and stale. Tests: touch-smoke, touch-handle-verify.

Best practices, I trust you.
```

## WP-8 (Codex) — Design gallery: add Shapes tab

```
In c:\xampp\htdocs\glitter (branch masks-and-text), read CLAUDE.md first — LF endings,
tabs, no build step, bump ?v= on every JS file you edit; SCSS in css/style.scss
partials only; guide.html mirrors new UI.

Decision already made: the Design gallery is the "insertable content" surface —
glitter fills, stickers, and now SHAPES. Fonts stay in Text Properties (they're a
layer attribute, not content). Picker-mode (gallery-picker-strip armed-destination
flow) is untouched.

1. Add a Shapes tab alongside the existing gallery tabs (#designGalleryContent,
   index.html ~383; tab default in CONFIG.ui.gallery.defaultTab). Follow the
   existing tab + gallery-card patterns exactly — same card component treatment as
   the sticker/font/brush-shape pickers (CLAUDE.md: reuse gallery cards, don't
   invent a new grid).
2. Content source: ShapeLibrary (js/classes/ShapeLibrary.js) — the same renderer
   that draws the shape picker chips in Shape Properties
   (PANEL_SCHEMAS shape Content group, host shapeShapePicker) should be reused or
   extracted so both surfaces share one card/thumbnail builder; do not duplicate
   the SVG/thumb generation.
3. Behavior: clicking a shape card adds a new shape layer of that shape (same code
   path as the shape tool / add-layer modal shape creation — find and reuse it,
   including default fill and auto-opening Shape Properties). On mobile the
   gallery lives in its own drawer/tab — verify add + drawer handoff matches how
   sticker cards behave there (CONFIG.ui.mobile.openDrawOnLayerAdd etc.).
4. Search/filter: if wiring shapes into the existing gallery search is cheap
   (names/tags), do it; if ShapeLibrary has no tag metadata, skip search for the
   shapes tab rather than bolting on a parallel search system, and say so in the
   summary.
5. Mirror the new tab in modals/guide.html (Design gallery description). Tests:
   touch-smoke, touch-handle-verify, and node tests/shape-border-verify.js since
   shape creation paths are touched.

Best practices, I trust you.
```

---

## Dispatch notes

- **Order:** WP-4 Part A (the sticker-rebind bug) is the only correctness fix —
  dispatch it first or alone if bandwidth is tight. WP-1 is the biggest and
  touches app.js broadly; don't run it concurrently with WP-3 Stage 2 (both touch
  gesture/input routing) or anything else editing app.js. WP-2, WP-5, WP-7 are
  small and parallel-safe. WP-6 and WP-8 are independent of each other.
- **Ryan decides:** the default sticker id (WP-7), the exact suffix string (WP-5,
  placeholder `_ryandavi-com`), and whether WP-3 Stage 2 ships enabled or behind
  the flag after trying it.
- Everything lands uncommitted on `masks-and-text` for Ryan's manual pass, per
  the usual flow.

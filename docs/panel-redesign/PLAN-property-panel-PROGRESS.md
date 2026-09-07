# Property panel refactor — progress & resume notes

Companion to `PLAN-property-panel-system.md` (the spec).
Visual spec: <https://claude.ai/code/artifact/e4197bd2-0548-4d62-9867-daaad78c97f8>

## How to verify anything

```bash
node tools/panel-audit.js            # behaviour: ids, slider specs, visibility
node tools/gutter-check.js           # layout: gutter applied exactly once
node tools/panel-audit.js --capture  # re-baseline (ONLY when adds are intended)
npx sass css/style.scss css/style.css --no-source-map
```

**Never run a bare `pkill -f "http.server"`** - it kills the user's own dev server.
Both tools serve on their own port (8977) and stop only the process they started.

`tools/gutter-check.js` checks three things in the live DOM: THE GUTTER RULE: horizontal inset is
applied exactly once on any path from a panel body to a control. It catches both
directions - a container that insets when an ancestor already did (double padding), and
content sitting flush against the panel wall (a shared rule zeroed by accident) - plus
anything overflowing the panel's right edge (`width:100%` + a horizontal margin, which is
invisible until a field is already clipped). Controls' own padding is excluded; only
structural containers and labels are in scope.

### Two cascade traps that cost real time here
1. **Specificity.** The L2 "no box" rule carries two `:not()`s (0,4,0) and silently beat
   the module surface rule (0,3,0), removing the border that visually contains an effect's
   Advanced section. Module rules now carry the same `:not()`s.
2. **Duplicate definitions.** `.property-pair-group` had two stale definitions left in
   `_settings.scss` - one a `display:grid` contradicting the flex layout in the owner file.
   When a property rule "doesn't apply", grep the other sheets before editing it.

### Nesting: a card is a new box
A bordered module (`[data-effect-card]`, `.text-effect-subsection`, `.transform-panel`)
insets from the panel wall by `--property-card-inset`, then **redefines `--property-gutter`
to a smaller value for its own contents**, so rows inside a card are not indented twice.
`tools/gutter-check.js` stops its walk at a card boundary for the same reason.

Card-in-card is banned: `.pixel-effects-control-section` was rendering a bordered card
inside the Palette card, which is the nesting this refactor exists to remove. It is a set
now.

### The typographic hierarchy, settled
Three levels, and the relationship between them is deliberate:

| Level | Class | Spec |
|---|---|---|
| Block title | `.subsection-title` | 12 / 600 / sentence / secondary |
| Set label | `.property-set-label` | 10.5 / 600 / UPPERCASE / tertiary |
| Property label | `.property-label` | 12 / 400 / sentence / secondary |

A set label is *smaller* than the property labels beneath it on purpose: it is a category
marker, distinguished by case and weight rather than size. What was broken was that canvas
size used the MODAL vocabulary (`settings-row-label-main`), which sits outside this scale
entirely - so "Width" outweighed "Dimensions" and the hierarchy read inverted.

### Every boolean is a switch
One rule, applied everywhere: **a boolean in a body is a toggle row (R4); a boolean in a
header is a compact switch.** Converted this round: canvas-size Relative, Scale Textures,
Scale Effects, transform Flip H/V, the brush dynamics toggles, the gallery search-by-name
filters, and Lock Aspect (the last bordered chip). 23 toggle rows + the header switches;
no boolean renders as a full-width pill any more.

### Legacy MODAL vocabulary is gone from the sidebar
`settings-row` / `settings-row-header` / `settings-row-label-main` / `settings-row-control`
belonged to the settings modal and only reached the sidebar because the canvas-size panel
is authored there and moved in at boot. Converted to `.property-row` + `.property-label`.
`.settings-row` in JS is modal-filter-only (`editor-disclosures.js:469,481`), so the
sidebar conversion is safe.

### Restyling a component must honour its visibility contract
`.empty-state` is `display:none` until JS adds `.visible`. Restyling it with a bare
`display: inline-flex` overrode that and left "None" showing beside a real colour
selection. **When restyling an existing component, check whether `display` is load-bearing
before setting it** - scope to the state class instead.

### Two rules that outlived the state they were written for
Making every block a card invalidated two earlier rules that had been correct at the time:
- the Advanced disclosure's `margin-inline` (written when only *some* blocks were carded)
  now made the Asset card differ from every effect card. Removed - a disclosure is
  full-bleed inside a card, everywhere.
- an UNTITLED card had no top padding (the title used to supply it) but did have bottom
  padding, so its single row sat tight against the top border and loose against the bottom.

Both are the same lesson: a conditional rule keyed to "which blocks are special" is dead
weight once nothing is special. Grep for rules naming feature classes after any change to
what a block *is*.

### Which blocks get a surface: structural, not a class list
The card treatment used to be granted by a hardcoded list of feature classes
(`[data-effect-card]`, `.text-effect-subsection`, `.transform-panel`), so Transform and
Effects were carded while Font, Asset and Selection were not. That distinction could not be
read off the UI, and a newly added block would never inherit it.

It is structural now: **a block that is a DIRECT child of a group is a card.** A block
nested inside another block is not - which prevents card-in-card without naming offenders.
Every panel is uniform; the only un-carded block in the app is the one nested inside the
Palette card, by design.

### Specificity: make the DEFAULT weightless
This trap bit three times - a chained-`:not()` default (0,4,0) silently outranking the rule
meant to override it (0,3,0), first removing the module border, then un-carding every block.
The default is now written with `:where()`, which contributes **zero** specificity, so any
rule granting a surface wins without an escalation war. **Write panel defaults with
`:where()`; save real specificity for the exceptions.**

### The structure, and the one exception to "no trailing padding"

```
block            header is a SIBLING of the content, not inside it
|- title         (the block's own gap separates them)
`- body          holds the options; its gap separates one from the next
   |- option     label + control (a .property-row)
   `- option
```

Spacing between siblings is **always** the parent's `gap`, or an explicit
`element + element { margin-top }`. Never a bare margin on a child.

**The one exception:** a BORDERED card needs interior clearance at the bottom, because its
border is a hard edge the last row would otherwise sit on. A borderless block uses the
`+ *` rule instead - it has no boundary to clear. Getting this wrong is what left Align and
Flip with their content on the card's bottom line.

`tools/gutter-check.js` now verifies vertical clearance too, descending to the deepest last
visible element (a wrapper's box includes its own padding, so measuring the wrapper reports
a false zero). It immediately caught the Advanced disclosure sitting 2px off the border.

### A label plus one control is a ROW, not a container
`buildOptionGroup` used to emit its own container with its own label, so "Anchor" rendered
identically to "Texture Position" - its parent. It now emits a `.property-row`: inline for
two options, stacked for three or more. One less level, and the hierarchy reads.

### Reset affordance: decisions, and the reasoning
- **Set-scoped resets use the same undo icon** as property reverts. Rule D says one icon
  for every scope; a lone text "Reset" contradicted it and drew more attention than the
  setting it resets.
- **Reverts stay hidden at default, faint on row hover, solid when the value differs.**
  The 18px column is always reserved. The alternative - reflowing a row the moment a value
  leaves its default - is worse than an empty column, and Figma likewise reveals its reset
  affordance only for overridden properties rather than parking a dead control on every row.
- **Pairs stack below a 360px container.** A pair cell needs mark + track + value + revert;
  under ~180px per cell the track becomes unusable. Stacked, each cell is still one line,
  and widening the sidebar restores the compact form.

### `.empty-state` is not an inline placeholder
`<span class="empty-state">None</span>` borrowed a large centred block component for an
inline job. Inline placeholders now use a quiet italic tertiary treatment at row height.

### The gutter exclusion list is defined ONCE
It had grown into sixteen chained `:not()`s, repeated across two rules - unreadable and
already drifting between the two copies. It is now a single Sass list (`$gutter-owners`)
interpolated into one `:not(a, b, c)` and one `:not(:has(a, b, c))`. Add a new
gutter-owning primitive to that list and both rules follow. No line in
`css/panels/_properties.scss` exceeds 200 characters.

### Trailing padding is a `+` rule
A card body used to trail `padding-bottom`, which is dead space when nothing follows.
Space is added ABOVE the thing that follows (`+ * { margin-top }`), never trailed off the
last element.

### Actions are one button per line
An `auto-fit` grid squeezed buttons until their labels were unreadable. One column by
default; a second is opt-in at `@container (min-width: 380px)`, where two full labels
genuinely fit - which the resizable sidebar makes reachable.

### Group boundaries: a divider, and bottom padding. Nothing else.
Three mechanisms were stacked on the same boundary - a `gap` on `.settings-subsection`, a
`padding-top` on the following group, and (earlier) a `margin-top`. A group is now
separated by its `border-top` alone; the header's own padding lifts it off the line, and an
**open** group carries `padding-bottom` so its last row never runs into the next divider.
Collapsed groups skip that padding.

### A nested SCSS `X &` reverses the selector
`.subsection-content-group … & ` inside `.design-panel .advanced-disclosure` compiled to
`.subsection-content-group … .design-panel .advanced-disclosure` - `.design-panel` ended up
*inside* the block, so the rule matched nothing. Selectors that need an ancestor on the
LEFT must be written flat, not nested with `&`. Worth checking the compiled `style.css`
whenever a rule "does nothing".

### Separation is the parent's gap, never the sibling's margin
Adjacent-sibling `margin-top` was doing the vertical spacing between groups, between
blocks, and between sets. That is the wrong mechanism in a flex column for two reasons: it
duplicates a job `gap` already does, and **a margin survives when its neighbour is hidden**,
so conditional content left phantom space behind. All of it is now `gap` on the parent;
the sibling rule only draws the divider.

The vertical scale is anchored to the horizontal one, so the rhythm reads as one system:

```
--property-row-gap:   2px                              row -> row (tight)
--property-field-gap: 5px                              label -> its own control
--property-block-gap: var(--property-gutter)           block -> block   (= 10px)
--property-group-gap: calc(var(--property-gutter)*1.4) group -> group   (= 14px)
```

Horizontal margin on a box (`.asset-info`, `.selected-colors-display`) is *inset*, which is
legitimate; vertical margin on the same element was separation, and moved to the parent.

### One chevron
Three collapse affordances existed at three sizes and colours - group (16px), module (a
24px glyph clipped into a 13.6px box) and Advanced (14px). They all mean the same thing, so
they are now one treatment: 11px, tertiary, same transition, same collapsed rotation. What
distinguishes them is position, not weight.

### The gutter rule, stated so it is self-maintaining
Inset a child unless it is a gutter owner **or it contains one** - expressed as a `:has()`
guard on the catch-all, so a new container of rows inherits the right behaviour instead of
needing its own exclusion. Also `width: auto; max-width: calc(100% - gutter*2)` on anything
the catch-all insets, because `width:100%` plus a margin always overflows.

`tools/panel-audit.js` boots the app under Playwright, adds a text layer, expands
everything, and captures: every `[id]` in the 9 sidebar sections with its tag/type/slider
range, a visibility sweep across 5 paint-source modes + effects-on, and structural metrics.
It serves the repo itself on :8899 — no separate server needed.

**Contract: zero lost ids, zero spec changes, zero visibility regressions, zero runtime
errors.** 701 ids at baseline. New ids are reported as notes, not failures.

Chromium path is hardcoded for this machine (`chromium-1228`); override with `CHROME_PATH`.

## Known pre-existing issues (NOT caused by this work — both verified)

1. `tests/ux-polish-verify.js` → "Two-axis wheel pan was not preserved". Fails identically
   at `HEAD` in a clean worktree. Canvas gesture code, unrelated to the sidebar.
2. `tests/fixtures/panel-parity-baseline.json` is **stale** (dated Aug 8). It reports
   `MISSING brushShapePicker`, an id removed by commit `4cae316`, two commits before HEAD.
   It also now reports ~196 `CHANGED …classes` entries, which are this refactor's
   intentional renames (`setting-value`→`property-value`, `btn-text`→`property-revert`,
   `setting-column`→`property-row`). **Re-capture it once the refactor lands** — but only
   after confirming `tools/panel-audit.js` is clean, since that one guards behaviour
   rather than class names.

## Key facts discovered (don't re-derive)

- **The design panel is 350px wide**, not 450. `--glitter-panel-width` computes to
  `calc(300px + 50px)`. Usable row width is **~292px**. Container-query breakpoint is set
  at 260px accordingly.
- `MobileManager` **physically moves** these sections into the mobile drawer, so the same
  DOM renders at two widths → container queries, never media queries.
- `initializeAdvancedDisclosures()` was the root cause of the nesting problem: it stamped
  a chevron on *every* titled `.subsection-content-group`.
- `CONFIG.ui.sliders` already declares a `value` default for all 30 sliders;
  `getResetValueForSlider` had only 7 hardcoded.
- The text panel's Content group is 8 legacy cards cloned from `tpl-text-content` via the
  `templateCard` schema kind — they bypass every schema rule.

## Done

| WP | Status | Where |
|---|---|---|
| WP1 collapsibility opt-in | **done** | `js/ui/editor-disclosures.js`, `panel-renderer.js` (`item.collapsible` → `data-collapsible`) |
| WP2 row primitives R1/R3 | **done** | `css/panels/_properties.scss` (new), `tpl-slider-row`, `tpl-two-column` |
| WP4 default-aware reverts | **done** | `PANEL_SLIDER_DEFAULTS` + `initializePropertyReverts()` in `panel-renderer.js`; `slider.js` marks `data-revertBound`; `app.js` falls back |
| WP3 partial | typography + de-boxing done | `css/_settings.scss` |
| WP5 partial | `:has()` shell collapse live | `css/panels/_properties.scss` bottom |
| R4 toggle rows | **done** | `tpl-toggle-row`, `checkboxList` case in `panel-renderer.js` |
| WP3 rule A (title dedupe) | **done** | `dedupeBlockTitle()` in `panel-renderer.js`, called from `editor-disclosures.js` |
| Rule C enforced | **done** | uppercase now only on L1 group labels; segmented options, set labels, chips all sentence case |
| R5 module switch | **partial** | effect Enabled is a leading switch (`.effect-switch`); the collapsed one-line summary (swatch + name + value) is NOT done |
| WP9 gallery filters | **partial** | `.filter-section` de-carded, `.filter-label` → group-label level, nested 200px scroll trap removed, chips share control height |
| **Sidebar resizing** | **done** | `js/ui/panel-resize.js` (new) — drag handles on both sidebars, snap points, min/max, canvas floor, persistence, dbl-click reset, keyboard |
| WP6 module rows (R5) | **done** | `buildModuleSummary`/`syncModuleSummary`/`initializeModuleSummaries` in `panel-renderer.js`; collapsed effects read `Border … Off ›` |
| WP7 text panel | **done** | new `templateBlock` schema kind; text Content went 8 legacy cards → **4 blocks** (Text / Font / Spacing / Alignment) |
| Asset summary compact | **done** | one row: 30px thumb + name + Change; empty `Size`/`Frames` cells collapse (rule F) |

### Metrics vs baseline (fully expanded)

| Section | Height | Boxes | Collapsible cards |
|---|---|---|---|
| Brush | 1074 → 848 | 16 → 12 | 3 → 0 |
| Canvas | 1882 → 1812 | 45 → 41 | 8 → 2 |
| No-selection | 700 → 642 | 10 → 8 | 4 → 2 |
| Text | 5573 → **4132** | 155 → **132** | 16 → **2** |
| Shape | 4259 → **3422** | 93 → **81** | 9 → **2** |

Text and Shape are still above their targets (≤2400 / ≤2000). The remaining bulk is the
font picker's large cards, the transform panel's number pairs, and the gradient editor —
none of which is wasted chrome any more, so the next reduction is a product call about what
to show at rest, not a structural one.

Deepest collapsible chain is 4 where effects exist (section → group → effect module →
advanced). Dropping to 3 means making the Effects *group* non-collapsible, since the module
toggle already owns expansion — needs a `collapsible: false` group option, because
`static: true` removes the title and `BaseBackgroundManager.js:92` binds to it.

### Baseline was re-captured once, deliberately
After the asset-summary work, 60 VISIBILITY diffs appeared — all 10 `*GlitterSize` /
`*GlitterFrames` ids across 6 states. These are empty metadata cells that now collapse
instead of rendering a label with nothing after it (rule F). Confirmed the cells still
render when populated. Baseline re-captured at 701 ids after verifying no other diff class
was present. **Any future VISIBILITY diff should be assumed a regression until proven
otherwise the same way.**

### Verified passing
`pixel-effects-ui-verify`, `modal-settings-verify`, `shortcut-coverage`,
`hint-rules-verify`, `keyboard-shortcuts-verify`, `notification-policy`, plus
`tools/panel-audit.js` clean after every step.

Note: `tools/panel-audit.js` spawns its own server on :8899. If a stale server is bound
there it will silently connect to that instead and fail with
`Cannot read properties of undefined (reading 'loadBlankImage')` — `pkill -f http.server`
and re-run.

## Remaining, in priority order

### WP8 — delete legacy vocabulary. **Start here.**
`settings-row-*` (in `noLayerSettingsSection` + canvas size), `effect-option-*`,
`functional-control-group-*`, `advanced-control-group-*`, `control-group-label`,
`setting-label`, `text-effect-*`. Rename `css/panels/_sections.scss` → `_preview.scss`
(it contains no section rules).

### WP9 — gallery, search, filters
- `.filter-section` is a card → label + chips with dividers (rule B)
- `.filter-label` is a 4th uppercase level → `.property-group-label` (rule C)
- `.filters-container-inner` has `max-height:200px; overflow-y:auto` — a scroll trap
  inside an already-scrolling panel. Remove.
- Unify `.filter-chip` / `.active-filter-summary-chip` / asset+category cards to shared
  control heights, radii, focus ring.
- **Empty states are inconsistent**: 3 use `icon-wrapper xl` SVG, 3 use a literal `🔍`
  emoji (`#glitterBrowserEmpty`, `#stickerBrowserEmpty`, `#brushTipBrowserEmpty`).
  Consolidate to one `.property-empty`.

### WP10 — theme + mobile + lint
A token sweep across all 11 themes passes (every theme resolves distinct label/module
colours from tokens; dark themes get dark module cards, light themes light). **This was a
token check, not a visual review** — the design still needs eyes on each theme.
Mobile drawer and the depth-budget lint are untouched.

### Also worth doing
- `tpl-text-content` still exists and still holds the source markup the `templateBlock`
  clones from. It can only be deleted once the text controls are authored natively.
- The `templateCard` kind now has one remaining consumer path; check before removing.
- `#brushSettingsSection`'s `Actions` and the transform `Actions` cards should fold into
  section footers (Δ8) — not done.
- Align/Flip still exist as separate transform cards (Δ7) — not done.

## Files changed so far

```
new:  css/panels/_properties.scss, js/ui/panel-resize.js, tools/panel-audit.js,
      tests/fixtures/property-panel-baseline.json,
      PLAN-property-panel-system.md, PLAN-property-panel-PROGRESS.md
mod:  index.html, css/style.scss, css/_settings.scss, css/_components.scss,
      css/panels/_effects.scss, js/app.js, js/ui/panel-renderer.js,
      js/ui/editor-disclosures.js, js/ui/slider.js, js/core/config.js,
      js/classes/MaskEditor.js, js/classes/BaseBackgroundManager.js,
      css/_controls.scss, css/panels/_gallery.scss
```

Nothing is committed. The repo already had unrelated uncommitted changes before this work
started (`admin/css/swatch_admin.css`, `tests/ux-polish-verify.js`, and others) — do not
assume every modified file is part of this refactor.


## Round 3: matching the spec, and the causes behind "spacing feels bad"

The panels did not look like the published spec, and the reason was structural rather than
cosmetic. Five root causes, all now fixed:

1. **Pairs were the wrong shape.** The spec shows `Offset [X --- 6px] [Y --- 6px]` as ONE
   row of two compact cells, and every other property as a single inline line. They had
   been built as two stacked two-line rows - twice the height and a different silhouette.
   There is now a real `kind: 'pair'` (`buildPairRow`) for genuine X/Y pairs; everything
   else is a plain single-line row.
2. **The slider was a 32px box for a 16px thumb**, parking ~8px of invisible space above
   and below every track and swamping the 2-6px gaps the rhythm is built on. Now 20px, or
   28px under `@media (pointer: coarse)`.
3. **`panels/properties` was imported before `settings`, `assets`, `effects` and
   `transform`**, so the "single owner" file was losing the cascade to four later sheets.
   It now loads last. This alone was silently defeating a chunk of the work.
4. **`--radius-full` is `50%`, not a pill.** On a 28x16 track that renders an ellipse - the
   "oblong" switch. The settings modal's `.switch` was restored verbatim from HEAD (it was
   the correct reference all along) and the mixin rebuilt to its geometry: pill track via
   `--radius-pill`, circular knob via `--radius-full`.
5. **Double gutters.** `.property-pair-group` had two stale definitions in `_settings.scss`
   - one of them a grid layout contradicting the flex one - and several containers insetting
   on top of rows that already did. `tools/gutter-check.js` now guards this.

Also: "Off" removed from module summaries (it contradicted itself by vanishing on expand
while the module was still off), set labels restyled to read as labels rather than tiny
headings, and section-content no longer stacks 10px on top of the row gutter.

## Consolidation pass (the "still doesn't feel like the artifact" round)

The refactor had started layering new rules on top of old ones — `_properties.scss` had
grown to 745 lines of appended patches. That is the exact duplication this work exists to
remove, so the file was rewritten as one coherent document and the duplicates it superseded
were deleted from `_settings.scss` and `_components.scss`.

**One switch.** There were three: `.property-switch` (toggle rows),
`.checkbox-group.effect-switch` (effect modules) and `.switch > .slider.round` (settings
modal). Now one `@mixin switch-track` / `@mixin switch-track-on` in `_mixins.scss`, used by
all three; they differ only by `--switch-w` / `--switch-h`. **Any other switch is a bug.**

**One gutter rule**, stated at the top of `_properties.scss`: horizontal inset is owned by
rows and headers only; bodies, groups, blocks and modules never add horizontal padding.
This was the cause of titles sitting further left than the controls under them — module
bodies were adding 6px on top of the row's 10px. There is also a catch-all so any control
dropped into a body that is *not* one of the primitives still lines up, which is what the
textarea, Point/Box and Fit to Text needed.

**One vertical rhythm**: four tokens (`--property-row-gap`, `--property-field-gap`,
`--property-block-gap`, `--property-group-gap`) and nothing ad hoc.

**Rule C in one place** — a single selector list covers every legacy label name, so a stray
uppercase cannot reappear feature by feature.

**Fixed**: the `is-stacked` grid had no explicit placement, so wide sliders (hue) dropped
their value below the track — same class of bug as the pair rows. Both now place
label/value/revert explicitly, because the control sits between label and value in the DOM.

**Revert is quieter**: tertiary at rest, accent on hover. It was accent-filled whenever a
value differed from default, which meant a panel with several edits looked alarmed.

**Rule D tier 2 applied**: `Reset Texture Position` was a full-width button; it is now a
`btn-text` at the right edge of its set label, like every other set-scoped reset.

**Font picker scroll fixed**: `updateFontSelection()` called `scrollActiveFontIntoView()`
on every panel sync, so pressing Bold or Italic threw the font list back to the selected
font and lost your scroll position. It now only reveals the active card when the font id
actually changed (`lastRevealedFontId`).

**Also styled to the system**: `.selected-color-chip` (now matches the filter chips'
height/radius), the colour-selection empty state, `.text-box-hint`, and
`.settings-row-label-desc`.

## Sidebar resizing (new)

`js/ui/panel-resize.js`. Both desktop sidebars get a drag handle on their inner edge.

- Writes `--layer-panel-width` / `--glitter-panel-width` on `:root`, persisted to
  `localStorage['glitter.panelWidths']`.
- **Only a user-chosen width is ever written**, so an untouched panel still falls through
  to the responsive defaults in `css/_assets.scss` (which narrow both columns under 1700px
  and 1200px — this is why the design panel measured 350px, not 450px).
- Min/max per panel, plus a live cap that always leaves the canvas ≥360px. Stored widths
  are re-clamped on load and on window resize, so a width chosen on a wide monitor cannot
  strand the canvas on a laptop.
- Snap points with a 10px tolerance; hold **Alt** to bypass snapping.
- **Double-click or Escape** resets to the stylesheet default. Arrow keys nudge (8px, or
  40px with Shift).
- Disabled on mobile, where `MobileManager` turns the columns into drawers.

Verified end to end: drag 350→470, persisted, survived reload, double-click restored 350,
and an over-drag clamped at 720 leaving the canvas 522px.

# Property Panel System — Audit & Refactor Plan

Scope: `#designPanel`, `#designGallerySection`, and every property/settings panel that
renders inside the design sidebar (`baseLayerSettingsSection`, `glitterSettingsSection`,
`brushSettingsSection`, `stickerSettingsSection`, `textSettingsSection`,
`shapeSettingsSection`, `layerSettingsSection`, `autoGlitterSettingsSection`,
`noLayerSettingsSection`).

This is a refactor, not a redesign. Every id, listener, default, and behaviour is
preserved; the structure and the rules that generate it change.

---

## 1. Method

The audit was done against the running app, not just the source:

- Read `js/ui/panel-renderer.js` (831 lines), `PANEL_SCHEMAS` in `js/core/config.js`
  (lines 1165–1560), the `tpl-*` templates in `index.html` (lines 2736–2880), and the
  property SCSS spread across `_settings.scss`, `_components.scss`, `_controls.scss`,
  `panels/_effects.scss`, `panels/_layout.scss`, `panels/_transform.scss`.
- Booted the app under Playwright at 1400×1000 with a blank 500×400 document and a text
  layer, force-expanded every accordion / group / card / disclosure, and measured the
  real DOM: nesting chains, box counts, control counts, rendered heights.

Numbers quoted below are measured, not estimated.

### What is already good (keep it)

The app is **not** in a "hand-written markup everywhere" state. There is already a
declarative panel system worth building on:

- `PANEL_SCHEMAS` → `renderPanelSections()` renders 7 of the 9 sections from data.
- `tpl-*` templates are the single structural source for slider rows, cards, groups,
  segmented controls, asset info, advanced disclosures.
- `buildAssetInfo` is already **one** asset-summary component with a `compact` variant —
  sticker, shape, brush tip, glitter, and base image all share it. No consolidation
  needed there; only styling/placement rules.
- `bindSlider` already supports default-aware reset disabling.
- `tests/panel-parity.js` captures a structural baseline of every `[id]` in these
  sections. That is the safety net this whole plan leans on.

The problems are in the **rules** the system applies, not in the absence of a system.

---

## 2. Findings

### F1 — Everything is collapsible, automatically (root cause of the nesting complaint)

`initializeAdvancedDisclosures()` in `js/ui/editor-disclosures.js:127-150` walks **every**
`.subsection-content-group` in the document and, if it has a `.subsection-title`,
unconditionally stamps `data-collapsible-subsection`, `role="button"`, `tabindex="0"`,
and injects a chevron.

Nothing opts in. Nothing opts out. Measured result:

| Section | L1 groups | L2 cards | cards made collapsible | advanced disclosures |
|---|---|---|---|---|
| `textSettingsSection` | 4 | 16 | **16** | 3 |
| `shapeSettingsSection` | 4 | 9 | **9** | 3 |
| `baseLayerSettingsSection` | 4 | 11 | 8 | 2 |
| `stickerSettingsSection` | 4 | 7 | **7** | 2 |
| `brushSettingsSection` | 3 | 4 | 3 | 0 |
| `layerSettingsSection` | 1 | 3 | **3** | 0 |

Deepest measured collapsible chains are 4 levels, e.g. in every layer panel:

```
section.collapsible-section        (accordion, one open at a time)
└ .subsection-section-group        (collapsible, persisted to localStorage)
  └ .subsection-content-group      (auto-collapsible, chevron injected)
    └ .advanced-disclosure         (collapsible)
```

and in Canvas Properties, a card nested inside a card:

```
baseLayerSettingsSection > Effects group > Palette card > #pixelEffectsPaletteControls card
```

**This is the single highest-leverage fix in the plan.** Collapsibility must become
opt-in per schema item.

### F2 — Title/label redundancy is structural, not incidental

Measured cases where a card title duplicates the label of a control inside it:

- **Opacity** (text, shape, sticker — via `data-transform-opacity`): card titled
  "Opacity" → body containing a row labelled "Opacity 100%" → "Reset" beneath.
  Measured **120px tall for one slider** (36px title + 82px body). This is the exact
  case called out in the brief.
- **`#pixelEffectsPaletteControls`**: card titled "Colors" containing a slider labelled
  "Colors".
- Single-control cards that exist only to carry a title: `Text`, `Case`, `Project`,
  `Shimmer`, plus the three `Opacity` cards.

### F3 — Reset has five unrelated idioms and almost no default-awareness

Every slider gets a full-width-row `<button class="btn-text">Reset</button>` beneath it
(`tpl-slider-row`). Measured: **34 sliders / 34 Reset links** in the text panel, 32/32 in
shape, 17/17 in sticker. Each costs a third row in the property.

Alongside that: `Reset Transform`, `Reset Texture Position`, `Reset Effects` (per layer
type), `Reset Effects` (pixel effects), `Reset Brush` — five placements, three visual
weights, no rule.

And the default-aware disabling that `bindSlider`/`syncResetButton` already supports is
wired for **7 sliders only** — `getResetValueForSlider` (`js/app.js:820`) hardcodes
`threshold, feather, scale, opacity, glitterHue, glitterSaturation, glitterBrightness`.
Meanwhile `CONFIG.ui.sliders` already declares a `value` default for **all 30** sliders.
The data to make every reset self-disabling exists and is unused.

### F4 — Eight competing label vocabularies inside `#designPanel`

Measured class occurrences in the live panel:

| class | count | role |
|---|---|---|
| `setting-label` | 211 | property label |
| `subsection-title` | 75 | L1 group title **and** L2 card title (same class, two levels) |
| `effect-option-label` | 54 | group label |
| `panel-group-label` | 24 | L1 group title text |
| `advanced-control-group-title` | 19 | group label |
| `functional-control-group-title` | 19 | group label |
| `control-group-label` | 16 | group label |
| `settings-row-label-main` / `-desc` | 13 | modal vocabulary, leaked into the sidebar |

`effect-option-label`, `advanced-control-group-title`, `functional-control-group-title`
and `control-group-label` are four names for one thing. `.effect-option-group`,
`.functional-control-group`, and `.advanced-control-group` are three near-identical
containers (`_components.scss:212-227`, `_settings.scss:274-279`).

The `settings-row-*` set is the **modal** settings vocabulary — it is in the sidebar
because the Canvas Size panel (`index.html:717-800`) is authored in modal markup and
physically moved into Canvas Properties at boot. Two label systems render side by side in
one card.

`.subsection-title` doing double duty for L1 and L2 is why the hierarchy is hard to scan:
group and card titles are typographically identical (12px/600/uppercase/tertiary).

### F5 — No responsive layout primitive

`.settings-group-two-column` is `grid-template-columns: repeat(2, 1fr)` with **no**
media query, container query, or `minmax()` anywhere in the codebase
(`css/_settings.scss:391`). It is 2-up at every width.

This matters more than usual here because `MobileManager` (`js/classes/MobileManager.js:34-90`)
**physically moves the same section elements** into the mobile drawer. The identical DOM
renders at ~450px (desktop sidebar, `--glitter-panel-width`) and at drawer width. Media
queries are the wrong tool; the panel needs container queries.

Conversely on desktop the ~394px of usable content width is spent almost entirely on
single-column stacked cards.

### F6 — Density

Fully expanded, measured scroll heights and count of elements painting a border or
background:

| Section | scroll height | bordered/filled boxes |
|---|---|---|
| `textSettingsSection` | **5573px** | 155 |
| `shapeSettingsSection` | 4259px | 93 |
| `baseLayerSettingsSection` | 1882px | 45 |
| `brushSettingsSection` | 1074px | 16 |

Every L2 card carries `@include inset-surface` (1px border + card background + 10px
padding) and then a `.subsection-card-body` adds another 10px. Groups, cards, bodies and
control groups each contribute their own box.

### F7 — Conditional content leaves shells

`syncPaintSlotSourceUI` (`js/effects/effect-source.js:191-219`) hides *inner* elements
(`.glitter-source-glitter`, `.glitter-source-solid`, `.paint-slot-scale`,
`.advanced-disclosure`, `.effect-gradient-editor`) by setting `hidden` on each one
individually. Wrappers — `.effect-option-group` and its label, `.subsection-card-body`
padding, the card border — are never consulted. Whether a shell appears depends on which
particular combination of children happens to be hidden; it is not prevented structurally.

Related: disabled effect cards currently stay in the flow at `--disabled-opacity` with
their whole body rendered (`_settings.scss:341-347`), rather than collapsing to a header.

### F8 — The text panel bypasses the schema

`PANEL_SCHEMAS[TEXT_GLITTER].groups[0]` is eight `templateCard` items that clone
hand-written markup out of `tpl-text-content` (`index.html:1027-1124`). Those eight cards
are why the text panel has 16 cards. Because they are legacy markup, none of the schema's
rules apply to them — and the `Type` card nests `Typography` and `Spacing`
`functional-control-group`s inside it, giving three heading levels for "Font Size".

### F9 — File organisation

`css/panels/_sections.scss` contains the preview panel, context toolbars, status bar and
helpful-message — no property-panel rules at all. The property system is instead split
across `_settings.scss`, `_components.scss`, `panels/_effects.scss`,
`panels/_layout.scss`, `panels/_transform.scss`. There is no file you can open to see the
property design system.

---

## 3. The target system — approved

Visual spec: <https://claude.ai/code/artifact/e4197bd2-0548-4d62-9867-daaad78c97f8>

Mandate: **refactor plus a scoped redesign of the right sidebar.** The container model is
replaced, not tidied. Out of scope and untouched: app chrome, toolbar, canvas, layers
panel, modals, export.

### 3.1 The unit is a row, not a card

Seven row types. There is no eighth. Every setting — today's and tomorrow's — is one of
them, which is what makes the system self-enforcing: a developer picks a row, they do not
invent a layout.

| # | Row | Structure | Used by |
|---|---|---|---|
| R1 | `.property-row` | `label · control · value · revert`, one 28px line | slider, select, colour, number, ≤2-option segmented |
| R2 | `.property-row.is-stacked` | label+value line, control full-width beneath | 3+ option segmented, textarea, font picker, `wide: true` |
| R3 | `.property-row.is-pair` | two properties reading as one value | X/Y, W/H, Offset X/Y |
| R4 | `.property-row.is-toggle` | label · switch right-aligned | every boolean |
| R5 | `.property-module` | `enable · swatch · name · summary · expand`, editor inline beneath | effects, fills, asset sources |
| R6 | `.property-actions` | buttons, at the end of the block they act on | Change, Fit to Text, Reset Effects |
| R7 | `.property-note` | 11px tertiary text, no box | helper text, status, empty state |

R2 is **auto-selected** by the renderer from the control type — it is not an authoring
decision. R3 pairs are **declared, never inferred**.

### 3.2 Grouping — three levels, dividers only

- **Section (L0)** — the panel window. Accordion, one open at a time. Keeps its border and
  radius: this is where the app's Y2K chrome lives.
- **Group (L1)** — `CONTENT` / `APPEARANCE` / `TRANSFORM` / `EFFECTS`. Collapsible, state
  persisted. Uppercase label, hairline divider above. **The only uppercase in the panel.**
- **Block (L2)** — an optional sentence-case title over a run of rows. Never collapsible,
  never boxed.

### 3.3 The rules that stop it drifting

**A — Naming.** The label lives at the level closest to the control. One control in a
block → the block has no title. A block title that would equal its only row's label is
dropped automatically. A group whose only child is a titled module drops its own label.
Value always renders in the row, right-aligned. Units are a muted suffix on the value.

**B — Boxes.** The only borders in a panel body are full-bleed hairline dividers between
groups. A box is earned only by: an expanded module editor, an asset summary, or a nested
editor (gradient stops, colour matches).

**C — Uppercase.** Exactly one level: the group label. Everything else sentence case.

**D — Revert.** One icon (`#icon-undo`), four scopes, one placement rule: **the right edge
of the thing it reverts, never its own row.** Property → row end. Block → title end.
Module → module row end. Panel → footer. The 20px slot is always reserved so rows never
reflow. *Visible whenever the value is non-default; hover reveals it only on at-default
rows.* Affordances appear when actionable, not on hover.

**E — Depth budget.** Two clicks maximum: 0 for every primary property, 1 to expand a
module or open a group, 2 for Advanced inside a module. Lintable against the schema.

**F — Conditionality.** You never hide a control; you hide the row, block or module that
owns it. `when:` on the schema item → renderer stamps the outermost node → one
`syncConditionalContent()` → CSS `:has()` collapses anything left empty. Empty shells
become structurally impossible.

**G — Sameness.** Enforced by the schema, not discipline. Same groups, same order, same
labels, same row types across layer types. A shared concept is one component instance:
Shadow on a sticker is the same code as Shadow on text.

| Group | Sticker | Text | Shape | Glitter fill | Canvas |
|---|---|---|---|---|---|
| Content | Asset | Text · Font · Layout | Asset | Selection | Image |
| Appearance | Fill · Opacity | Fill · Opacity | Fill · Opacity | Fill | Background |
| Transform | shared | shared | shared | — | Canvas size |
| Effects | Shadow | Border · Shadow | Border · Shadow | — | Pixelate · Palette |
| Footer | Reset Effects | Reset Effects | Reset Effects | — | Reset Effects |

### 3.4 Approachability guardrails (explicit anti-Figma rules)

1. **Sliders stay.** No scrub-fields. Precision cases declare `wide: true`.
2. **Labels stay words.** Only X/Y/W/H pair micro-labels are glyphs, and they carry tooltips.
3. **Values always visible.** Never hover-to-reveal.
4. **The accordion stays.** Never five panels of controls at once.
5. **Hover only adds.** Nothing is discoverable by hover alone.

### 3.5 Responsiveness — container queries, never media queries

`MobileManager` physically moves these sections into the drawer, so the same DOM renders
at ~450px and ~330px. `.settings-subsection` gets `container-type: inline-size`; R3 pairs
and R1 rows restack from container width alone. No feature-specific media queries.

### 3.6 Tokens

```scss
--property-row-h:        28px;   --property-row-h-compact: 24px;
--property-label-col:    78px;   --property-value-col:      46px;
--property-revert-col:   20px;   --property-gutter:         11px;
--property-row-gap:       2px;   --property-block-gap:      10px;
--property-group-gap:    14px;   --property-divider:  1px solid var(--color-border);
```

### 3.7 Typography — six levels

| Level | Class | Spec |
|---|---|---|
| Panel title | `.section-header-title-text` | 13 / 600 / sentence |
| Group label (L1) | `.property-group-label` | 10.5 / 600 / **uppercase** / .09em / tertiary |
| Block title (L2) | `.property-block-title` | 12 / 600 / sentence / secondary |
| Property label | `.property-label` | 12 / 400 / secondary |
| Property value | `.property-value` | 12 / 500 / tabular / primary |
| Meta / note | `.property-note` | 11 / 400 / tertiary |

All of `setting-label`, `effect-option-label`, `control-group-label`,
`functional-control-group-title`, `advanced-control-group-title`, `filter-label`,
`settings-row-label-main` collapse into `.property-label` / `.property-group-label`.

### 3.8 Gallery, search and filters

In scope for **visual consistency**, not restructuring. The gallery grid, browser and
picker behaviour are unchanged. Three real problems to fix:

- **`.filter-section` is a card** (`background: var(--color-bg-card)`, radius, padding,
  margin) — six stacked cards inside the filter drawer. Under rule B these become label +
  chips separated by dividers.
- **`.filter-label` is a fourth uppercase level.** Under rule C it *is* a group label and
  adopts `.property-group-label`.
- **`.filters-container-inner` has `max-height: 200px; overflow-y: auto`** — a nested
  scroll region inside an already-scrolling panel (a scroll trap). Remove the inner
  scroller and let the panel scroll.

Plus token alignment: `.filter-chip`, `.active-filter-summary-chip`, `.search-toggle-row`
and the asset/category cards adopt the shared control heights, radii, focus ring and
divider treatment. `.asset-browser-section-title` and `.asset-collection-credit-heading`
adopt the block-title / group-label levels.

---

## 4. Per-panel target hierarchy

### Text (`textSettingsSection`) — 16 blocks → 6
Content: **Text** (textarea, Point/Box, Fit to Text). Type: **Font** (picker, style, case,
size), **Spacing** (letter ∥ line as R3). Layout: **Alignment** (H ∥ V). Appearance: Fill
module + untitled Opacity row. Transform: one module with Align/Flip as sets.
Effects: Border module, Shadow module, footer reset. Requires WP7.

### Shape — 9 → 5 · Sticker — 7 → 4
Identical structure to Text minus the type controls. Asset becomes an untitled R5 module
row. Align/Flip fold into Transform.

### Canvas Properties — 11 → 6
Background module; **Canvas** block with canvas-size re-authored in property vocabulary;
Effects = Pixelate module + Palette module (`#pixelEffectsPaletteControls` becomes a set,
not a nested card; dither controls become `when:`-gated sets); footer reset.

### Panel states (`noLayerSettingsSection`, empty states, picker strip)

In scope — these are what the sidebar shows most often, and they currently drift furthest.

**`noLayerSettingsSection`** is not just an empty state; it carries real controls:
- `#quickAddOptions` — the Quick Add layer-type grid
- `#projectMetaGroup` — project Name + Open/Save, authored in **modal** `settings-row-*`
  vocabulary
- `#documentSizeGroup` — Image Size / Canvas Size, moved into Canvas Properties at boot
  by `BaseBackgroundManager` (`js/classes/BaseBackgroundManager.js:119`)

Target: three blocks under the property vocabulary — **Start** (Quick Add grid),
**Project** (R1 text row + R6 actions), **Size** (segmented + the re-authored canvas-size
controls). The `settings-row-*` markup goes away here, not just in Canvas Properties.

**Empty states are inconsistent across five surfaces.** Three use an `icon-wrapper xl` SVG
(`#icon-lock`, `#icon-layers`, `#icon-glitter`); three use a literal `🔍` emoji
(`#glitterBrowserEmpty`, `#stickerBrowserEmpty`, `#brushTipBrowserEmpty`). Target: one
`.property-empty` component — SVG icon, title, subtext, optional action — used by every
panel and browser empty state. `setSettingsEmptyState()` keeps its signature.

Also covered: `welcomeSection`, `baseLayerSettingsSection`'s protected-canvas notice, and
`.gallery-picker-strip`, which all adopt the same component and tokens.

### Brush — 4 → 3 · Colour Fill — 3 → 2 · Auto Glitter — reference implementation
Auto Glitter already has 0 auto-collapsible cards, a real scroll region and a real footer.
It only needs token/typography alignment.

---

## 5. Work packages

Each is independently shippable and must pass `node tools/panel-audit.js` with zero lost
ids, zero spec changes, zero visibility regressions and zero runtime errors.

| WP | Scope |
|---|---|
| **WP1** | Collapsibility becomes opt-in (`editor-disclosures.js`); effect cards and `collapsible: true` only |
| **WP2** | `css/panels/_properties.scss`: tokens, R1–R7, typography, container queries |
| **WP3** | Naming rule A in the renderer (`resolveBlockTitle`, set-label promotion) |
| **WP4** | Revert system D; `getResetValueForSlider` falls back to `CONFIG.ui.sliders[id].value` |
| **WP5** | Conditionality contract F + `:has()` collapse rules |
| **WP6** | R5 module rows; one `buildPropertyModule()` for every effect/fill/asset |
| **WP7** | Text panel off `templateCard`; new schema kinds |
| **WP8** | Canvas-size vocabulary; delete legacy label/layout classes |
| **WP9** | Gallery, search, filters (§3.8) |
| **WP10** | Theme sweep across all 11 themes; mobile drawer pass; depth-budget lint |

---

## 6. Preservation contract

Non-negotiable. Before/after every WP:

1. `node tests/panel-parity.js` — the set of `[id]` elements in the nine sections must be
   **identical**. Ancestor-path changes are expected (wrappers are removed); id
   additions/removals are defects.
   - Extend `panel-parity.js` to fail hard on id set changes and report ancestor-path
     changes as a separate reviewable list, so a baseline refresh cannot silently
     swallow a lost id.
2. `node tests/run.js --tag panels` clean.
3. `node tests/run.js --tag export` clean — effect settings feed the render/export path.
4. No manager file (`TextGlitterManager`, `ShapeGlitterManager`, `StickerManager`,
   `BaseBackgroundManager`, `MaskEditor`, `GlitterManager`, `AutoGlitterManager`) may
   need editing to accommodate a layout change. If one does, the layout change is wrong.

Known JS→DOM couplings that must survive (verified by grep, all outside `panel-renderer.js`):

| File:line | Depends on |
|---|---|
| `editor-disclosures.js:129-132` | `.subsection-content-group`, `:scope > .subsection-title` |
| `editor-disclosures.js:167` | `.subsection-title input[data-effect-toggle]` |
| `ShapeGlitterManager.js:112` | `.text-effect-subsection` → `.advanced-disclosure` |
| `ShapeGlitterManager.js:624` | `.text-effect-controls` visibility contract |
| `BaseBackgroundManager.js:92` | `[data-panel-group="Effects"] > .subsection-title` |
| `BaseBackgroundManager.js:100-102` | constructs `.effect-option-group` / `.effect-option-label` |
| `BaseBackgroundManager.js:595-596` | `closest('.setting-column')` for angle/scale rows |
| `MaskEditor.js:498,513` | constructs `.setting-column right`, `.settings-group-two-column` |
| `effect-source.js:192-211` | `.text-effect-subsection`, `.glitter-source-*`, `.paint-slot-*`, `.advanced-disclosure` |
| `panel-parity.js` (test) | `.text-effect-subsection[data-slot]`, `.asset-info`, `.text-effect-source-change` |

Strategy: **rename by aliasing, not by replacing.** New `.property-*` classes are added
alongside the existing ones in WP2; the old names stay on the elements until WP8, by
which point each coupling has been migrated deliberately. No selector disappears in the
same commit that introduces its replacement.

---

## 7. The acceptance test for the whole plan

> *Add a new property tomorrow.*

After this work, adding "Blur" to the sticker Shadow effect is:

```js
{ kind: 'slider', id: 'stickerShadowBlur', slider: 'shadowBlur' }
```

added to the Shadow module's `pre`. It automatically gets: the property label/value row,
tabular value with unit, a default-aware revert affordance in the header row, correct
placement inside a module block, correct spacing, correct behaviour when Shadow is
disabled or the source mode changes, correct stacking in the mobile drawer, and no new
CSS. Making it share a row with an existing property is `kind: 'pair'`. Making it
advanced is moving it into the module's one `advanced` list.

That is the bar. If a new property still requires a design decision, this plan has not
landed.

---

## 8. Decisions (settled)

1. **Property reset** — small revert **icon** in the label row, right of the value.
2. **L2 block borders** — removed for non-module blocks; spacing + a hairline carry the
   hierarchy. Outlined surfaces are reserved for modules (effects, asset summaries,
   transform, gradient editor).
3. **Group collapse state** — keep persisting per `prefix:title`.
4. **Transform Align/Flip** — folded into the Transform module as sets.
5. **WP7/WP8 are in scope.** No legacy vocabulary is retained: `settings-row-*`,
   `effect-option-*`, `functional-control-group-*`, `advanced-control-group-*`,
   `control-group-label`, `setting-column`, `settings-group-two-column` and
   `text-effect-*` are migrated to the property vocabulary and deleted, not aliased
   permanently. Aliases exist only inside a work package, never across one.

### Overriding principle

**One concept, one implementation.** If two layer types do the same thing, they use the
same component, the same class, the same label text, the same control order and the same
interaction. Divergence between sticker/text/shape/fill/base is treated as a defect, not
a variation. `tools/panel-audit.js` guards the behavioural contract while this is done.

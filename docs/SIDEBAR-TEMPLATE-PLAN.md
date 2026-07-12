# Sidebar Template System Plan — 2026-07-12

**STATUS (2026-07-12): WP-F and WP-S0 through WP-S5 IMPLEMENTED** on
`masks-and-text`, uncommitted. Shipped: `tests/panel-parity.js` +
`tests/fixtures/panel-parity-baseline.json` (498 structure entries, 4
layer-type states, 9 slot-group mode sweeps; baseline captured pre-migration,
diff EMPTY post-migration across repeated runs); tpl-* templates in
index.html; `js/ui/panel-renderer.js` (builders + `renderPanelSections` +
hoisted `normalizeTransformPanelHost` + `finalizePanelSchemaSections`);
`CONFIG.ui.sliders` + `PANEL_SCHEMAS` entries for all layer types in config.js;
Shape, Text, Sticker, Glitter, transform, and Color Fill Settings now render
from schemas/templates; section shells and the nested layerSettingsSection quirk
are preserved. `PANEL_ROLES` and `PANEL_ID_OVERRIDES` encode the default
grammar plus Text's legacy `Use*` ids. Shared source controls use `data-mode`,
and the gradient editor shell now clones `tpl-gradient-editor`. Suites:
panel-parity and export-parity are fully green. The final harness additionally
asserts that every glitter paint slot has asset-info + Change controls and that
Glitter Fill and Sticker Asset Change buttons open the gallery. Image/Layers
also use the canonical collapsible-section state contract. touch-smoke (8, 13, 14, 21), touch-handle
(3 checks), shape-border (check 3 "element is not visible") fail **identically
on HEAD af181ac** — pre-existing, not from this migration.

Scope: replace the hand-stamped sidebar markup in index.html with shared
`<template>` primitives, declarative per-layer panel schemas, and one renderer —
so every layer type gets the same structure from one place and a layout change
is made once, not nine times. This is a sidebar architecture refactor, not a
gradient-only cleanup. WP sections at the bottom are paste-ready Codex prompts;
they must run in order.

**Zero-behavior-change contract:** every WP in this plan is a pure structural
refactor. After the baseline is captured, any parity-harness diff, any visual
diff, and any behavior diff is a defect — there are no "intentional diffs" to
reason about. That only works if behavior changes land *before* the baseline:

Sequencing with open plans: FILL-CONSISTENCY-PLAN.md WP-F defines the canonical
paint-slot layout — that spec **is** the paint-slot template here. WP-F lands
**first, standalone, before WP-S0's baseline capture** (it is a behavior/layout
change Ryan already approved; mixing it into a migration WP would make parity
diffs ambiguous). The templates then reproduce the post-WP-F DOM exactly.
TRANSFORM-AND-FILLS-PLAN.md WP-C gradient work extends the same slot template.

## Who does what

- **Fable, in order:** (1) FILL-CONSISTENCY WP-F fixes directly; (2) WP-S0 —
  the roles table, boot-order pin, and parity harness are the judgment-heavy
  decisions that every later WP inherits; (3) WP-S1 Shape as the **reference
  migration**, producing the worked-example diff the Codex prompts point at.
- **Codex:** WP-S2, WP-S3, WP-S4 — each prompt tells it to read the WP-S1 diff
  first and replicate the pattern; depth comes from the worked example, not
  from longer prompts. Fable reviews each against the parity harness.
- **Fable:** WP-S5 cleanup + final review.

## Consistency decisions (locked now, encoded by the templates)

These are the "one way of doing things" rules the refactor establishes. None
changes behavior; they govern how the new code is written.

1. **Role grammar for stamped elements:** `{prefix}{Slot?}{Role}` for controls
   (`shapeFillScale`, `textBorderHue`), `{id}Value` for value readouts,
   `reset{Id}` (capitalized) for reset buttons — already the dominant pattern;
   the roles table makes it the rule, with legacy irregulars as explicit
   override entries, never new inventions.
2. **`data-mode` on every segmented option** (`data-mode="none|glitter|solid|
   gradient"`, and `data-value` for non-paint segmenteds like border placement).
   The renderer stamps it; nothing new may branch on ID suffixes. Existing
   suffix-sniffing code migrates in WP-S4.
3. **`bindSlider` (utils.js:27) is the only slider idiom.** Templates + roles
   guarantee its inputs exist. Managers' bespoke wrappers (`_attachSlider`
   etc.) may stay as thin delegates, but no new hand-rolled input+value+reset
   wiring.
4. **Manager binding style converges on ShapeGlitterManager's prefix-
   parameterized pattern** (`_bindSource`/`_bindSlotAdvanced` over a `this.ui`
   map) — but **not during the panel migrations**. S1–S3 must not touch
   binding logic (that's how "exactly the same" stays provable). Converging
   TextGlitterManager's ~87 bespoke lookups onto the shape pattern is an
   optional follow-up after WP-S5, reviewed separately.
5. **`CONFIG.ui.sliders` preserves today's values byte-for-byte**, including
   the known inconsistencies (paint-slot texture scale max=300 vs transform
   scale max=500; border width max=60). The block gets a comment listing them
   as *documented, deliberate-for-now* — reconciling ranges is a product
   decision for Ryan later, never a silent side effect of this refactor.
6. **Templates are copied markup, not redesigned markup.** Class names, DOM
   nesting, and attribute sets come verbatim from the post-WP-F shape panel.
   If a template "improves" anything, it has diverged — the parity harness and
   the no-SCSS-changes rule are the enforcement.

---

## Why (root-caused, not aesthetic)

1. **The paint slot is hand-stamped ~9 times.** Source segmented control +
   asset-info + solid color row + texture-scale/opacity row + Advanced HSB
   disclosure exists as near-identical static HTML for `shapeFill`,
   `shapeBorder`, `shapeShadow` (index.html:1899-2232), `textFill`,
   `textBorder`, `textShadow`, `stickerBorder`, `stickerShadow`, and the
   glitter-fill source. They have already drifted (FILL-CONSISTENCY-PLAN
   documents the divergence; slider ranges and ID grammar disagree — see #4).

2. **JS already re-arranges the static HTML at boot.** `renderTransformPanels()`
   deletes "legacy" static cards and injects a JS-built transform panel
   (app.js:2215), then `organizeLayerPropertyGroups()` (app.js:2236) walks the
   static DOM with `closest('.subsection-content-group')` and physically
   re-parents cards into Content/Appearance/Transform/Effects groups. The
   static markup no longer even represents the shipped layout — it's raw
   material for a boot-time shuffle. Ordering should come from a schema, not
   from move-the-nodes surgery that breaks silently when a card's wrapper
   changes.

3. **Two ad-hoc rendering styles already exist.** `renderTransformPanel`
   (app.js:2400) builds markup from a template literal with a per-prefix ID map
   (`getTransformIds`); `installEffectGradientEditor` (effect-source.js:218)
   injects innerHTML strings per slot. Both prove the approach works; neither
   is reusable. This plan generalizes the `getTransformIds` pattern (roles →
   prefixed IDs) to the whole sidebar and moves markup into `<template>`s.

4. **ID grammar is inconsistent and load-bearing.** `syncPaintSlotSourceUI`
   (effect-source.js:185) infers paint mode by *sniffing ID suffixes*
   (`UseNone`/`None`, `UseColor`/`Solid`) because text and shape named their
   buttons differently. `installEffectGradientEditor` does the same
   (`UseColor || Solid`). A renderer that stamps `data-role` kills this class
   of coupling.

5. **Slider ranges/defaults are structural attributes.** `shapeFillScale`
   max=300 vs transform scale max=500, `shapeBorderWidth` max=60, etc. live as
   HTML attributes, invisible to CONFIG and duplicated per copy. They belong in
   `js/core/config.js` (per the existing "any twice-used value" rule).

---

## Target architecture

**index.html** — `<template>` elements for the repeated primitives (markup only,
no IDs baked in). Section *shells* stay as empty divs so panel ordering, section
IDs, and the accordion keep working:
`<div class="shape-settings-section section collapsible-section" id="shapeSettingsSection"></div>`.

**config.js** — declarative schemas: which groups each layer type exposes
(Content / Appearance / Transform / Effects), in what order, built from which
primitives, with which capabilities. Extends the existing `LAYER_UI_CONFIG`
philosophy (`transformCapabilities` is already exactly this). Plus a new
`CONFIG.ui.sliders` block holding min/max/step/default per slider role.
**Hard constraint: no HTML strings in config.js.** Schema describes structure
and capabilities; templates hold markup; the renderer connects them.

**js/ui/panel-renderer.js** (shared UI renderer, per the cross-manager-logic
convention) — clones templates per schema, stamps IDs (`prefix + Role`) and
`data-role` attributes, fills labels/units/ranges from CONFIG, appends into the
section shells. Runs **once at boot**, before any manager's `setupUIListeners`
and before MobileManager caches `settingsSections`. It never re-renders after
boot — managers keep updating values in place, exactly as today.

**Managers** — unchanged responsibilities: supply values, bind behavior via the
same element IDs they use now. They stop owning structure: no innerHTML panel
builders, no DOM re-parenting, no per-manager opinions about grouping/order.

### Primitive template inventory

| Template | Replaces | Instances today |
|---|---|---|
| `tpl-section` | collapsible section shell (header, icon, title, chevron, `section-content`) | 8 sections |
| `tpl-card` | `subsection-content-group` + `subsection-title` (optional title-side control slot, e.g. Enabled checkbox) | ~40 |
| `tpl-slider-row` | `setting-column right` (label + value + range + Reset) | ~45 |
| `tpl-two-column` | `settings-group-two-column` wrapper | ~20 |
| `tpl-segmented` | `segmented-control` + n options | ~15 |
| `tpl-paint-slot` | the full canonical slot stack (source segmented, asset-info, solid color row, gradient editor host, texture-scale/opacity row, Advanced HSB) | **9** |
| `tpl-asset-info` | asset-info chip block (thumbnail, name, badges, Change, Size/Frames meta) | 9 (inside slots) + sticker content |
| `tpl-number-pair` | X/Y and W/H `input-group horizontal` pairs | 6 |
| `tpl-action-row` | `settings-action-row` (Fit/Fill canvas etc.) | 3 |
| `tpl-checkbox` | `checkbox-group` chip | ~10 |
| `tpl-advanced` | `advanced-disclosure` shell | 9 (inside slots) |

`tpl-paint-slot` composes the smaller primitives; its layout is the WP-F
canonical spec verbatim. The gradient editor panel (currently an innerHTML
string in `installEffectGradientEditor`) becomes `tpl-gradient-editor`, cloned
by the same install function — behavior code there is untouched.

### Schema format (sketch — data, not markup)

```js
// config.js — structure only; every range/default is a CONFIG.ui.sliders key
const PANEL_SCHEMAS = {
	[LayerType.SHAPE]: {
		section: { id: 'shapeSettingsSection', title: 'Shape Properties', icon: 'square' },
		prefix: 'shape',
		groups: [
			{ title: 'Shape', items: [ { kind: 'shapePicker', id: 'shapeShapePicker' } ] },
			{ title: 'Fill', items: [ { kind: 'paintSlot', slot: 'fill', modes: ['none', 'glitter', 'solid'] } ] },
			{ kind: 'transformHost' },                 // renderer output of transform panel
			{ title: 'Effects', kind: 'effectsStack', items: [
				{ kind: 'paintSlot', slot: 'border', modes: ['glitter', 'solid'], toggle: true,
					extras: ['borderWidth', 'borderStyle', 'borderEdges', 'borderPlacement', 'borderLayering'] },
				{ kind: 'paintSlot', slot: 'shadow', modes: ['glitter', 'solid'], toggle: true,
					extras: ['shadowOffsets'] }
			] }
		]
	},
	// STICKER, TEXT_GLITTER, GLITTER_FILL …
};
```

`transformCapabilities` stays where it is in `LAYER_UI_CONFIG` and keeps
driving the transform panel. Whether `PANEL_SCHEMAS` lives as a sibling const
or as a `panelSchema` key inside each `LAYER_UI_CONFIG` entry is the
implementer's call — sibling const is recommended (keeps `LAYER_UI_CONFIG`
scannable; the derived-lookup helpers at config.js:730 don't need schemas).

### ID and binding strategy (the migration linchpin)

- **Every existing element ID is preserved exactly**, including the irregular
  ones (`textLayerOpacity`, `textFillUseColor` vs `shapeFillSolid`,
  `resetShapeFillScale`). The renderer stamps IDs from per-prefix role maps —
  a generalization of `getTransformIds(prefix)` — with explicit override
  entries for the irregular legacy names. Managers, history, headless probes,
  and guide.html shortcuts all keep working untouched.
- The renderer *additionally* stamps `data-role` (e.g.
  `data-role="source-none"`, `data-role="texture-scale"`) and `data-slot` on
  everything it creates. `syncPaintSlotSourceUI` and
  `installEffectGradientEditor` migrate from ID-suffix sniffing to `data-role`
  in WP-S4. ID grammar *normalization* (renaming the irregular IDs) is
  deliberately **not** part of this plan — it's a cheap follow-up once nothing
  reads IDs structurally, and doing it mid-migration doubles the blast radius.
- **Render once, bind once.** The renderer must complete before:
  1. every manager's `setupUIListeners` / UI-map caching (`this.ui = …`),
  2. `MobileManager` caching `settingsSections` via querySelector
     (MobileManager.js:91),
  3. `initializeCollapsibleSections` and `initPixelScaler`/tooltip init.
  Audit the app.js init order in WP-S0 and pin it with a comment. Managers
  binding with `?.` means a missing element fails *silently* — the parity
  harness (below) exists to catch exactly that.
- Mobile drawers keep working for free: `MobileManager.prepareSettings` moves
  the *same single-instance nodes* between panel and drawer, and bindings
  survive re-parenting. The invariant to preserve is single-instance DOM,
  rendered once — never rebuild a section's innerHTML after boot.

### Parity harness (built first, used by every WP)

`tests/panel-parity.js` (node + Playwright, same harness style as
touch-smoke): boots the app headless, then
1. dumps the **sorted list of every `[id]` inside `.design-panel`** plus each
   element's tagName and, for inputs, min/max/step/value;
2. for each layer type: adds a layer, activates it, dumps per-section
   visibility (`hidden`, `display`) and `dataset.paintMode` of every slot;
3. diffs against a committed baseline captured from the **pre-migration,
   post-WP-F** DOM (after `organizeLayerPropertyGroups` ran, since that's the
   real shipped structure).
Because WP-F lands before the baseline, the baseline never regenerates during
this plan — a WP that "needs" a baseline change has a bug, with exactly one
exception: WP-S1 may add *new* IDs (template-stamped elements that had none),
never remove or alter existing entries. This converts "did the template render
everything the managers bind to" from manual QA into a one-command check.

---

## Migration stages

Order: WP-F (behavior, pre-baseline) → foundations → Shape (representative:
picker + 3 slots + transform host + segmented extras) → Text (biggest) →
Sticker + Glitter Fill → shared-code convergence → cleanup. One WP per
branch-worthy chunk; app must be fully working after each. Executors per "Who
does what" above — S0/S1 are written as prompts for completeness but are
Fable's to do.

### WP-S0 — Foundations (templates, renderer, harness) — **Fable**

```
In c:\xampp\htdocs\glitter (branch masks-and-text). Read CLAUDE.md first;
LF endings, tabs, no build step, bump ?v= on every JS file you touch and add a
<script> tag for new files.

Build the sidebar template foundations. No panel migrates yet; zero visual or
behavioral change.

1. tests/panel-parity.js — headless probe per docs/SIDEBAR-TEMPLATE-PLAN.md
   "Parity harness". Capture the baseline JSON into tests/fixtures/ and commit
   it. Testing gotchas in CLAUDE.md apply (welcome modal, originalImage wait).
2. index.html: add a <template> block near the design panel with the primitives
   from the plan's inventory table (tpl-section, tpl-card, tpl-slider-row,
   tpl-two-column, tpl-segmented, tpl-paint-slot, tpl-asset-info,
   tpl-number-pair, tpl-action-row, tpl-checkbox, tpl-advanced,
   tpl-gradient-editor). Markup copied verbatim from the existing shape panel
   (the cleanest instance) — class names must not change; no hardcoded IDs
   inside templates.
3. `js/ui/panel-renderer.js`: clone-and-stamp engine.
   API: renderPanelSection(schema) plus buildPaintSlot / buildSliderRow /
   buildSegmented helpers usable standalone. Stamps id = prefix+Role from a
   roles table with per-prefix legacy overrides, plus data-role / data-slot /
   data-mode per the plan's "Consistency decisions". Roles table shape:
     PANEL_ROLES = { paintSlot: { sourceNone: 'None', … }, … }   // role → id suffix
     PANEL_ID_OVERRIDES = { text: { fill: { sourceNone: 'textFillUseNone', … } } }
   i.e. default = prefix + capitalized slot + suffix; overrides carry the full
   legacy id verbatim. Labels, units, and min/max/step/default come from a
   new CONFIG.ui.sliders block in `js/core/config.js` (add it, populated with the
   values currently hardcoded in index.html attributes, preserved exactly —
   one key per slider role, per-layer overrides only where today's values
   genuinely differ, with the known-inconsistency comment from the plan).
4. config.js: add PANEL_SCHEMAS with the SHAPE entry only (see plan sketch) —
   data only, no HTML strings. Wire nothing to it yet.
5. Audit and pin the app.js boot order: renderer init hook must sit before all
   manager setupUIListeners, MobileManager section caching, and
   initializeCollapsibleSections. Add the call site (rendering nothing yet)
   plus a constraint comment.

Verify: node tests/panel-parity.js (baseline self-diff passes),
node tests/touch-smoke.js, node tests/touch-handle-verify.js.
```

### WP-S1 — Migrate Shape panel — **Fable** (reference migration)

```
In c:\xampp\htdocs\glitter (branch masks-and-text). Read CLAUDE.md and
docs/SIDEBAR-TEMPLATE-PLAN.md; foundations from WP-S0 exist; FILL-CONSISTENCY
WP-F has already landed, so the current shape DOM is the canonical slot layout.

Migrate the Shape panel to the renderer. Zero behavior/visual change: the
rendered DOM must match the parity baseline (new template-stamped IDs are the
only permitted additions). This WP's diff becomes the worked example WP-S2/S3
replicate — keep it clean and self-explanatory.

1. index.html: delete the static contents of #shapeSettingsSection
   (lines ~1878-2236), leaving the empty section shell div.
2. panel-renderer.js renders it at boot from PANEL_SCHEMAS[LayerType.SHAPE]:
   header, Shape picker card, Fill paint-slot, transform host (reuse
   renderTransformPanel output for now — do not rewrite it in this WP),
   Effects stack with Border and Shadow slots including the shape-only extras
   (width, style Solid/Dotted + dot spacing, edges, placement, layering).
3. Every current shape-panel element ID must exist post-render — run
   tests/panel-parity.js and reconcile until the diff is empty (modulo
   permitted new IDs).
4. ShapeGlitterManager: no binding changes expected (it binds by ID). Remove
   any now-dead assumptions about static DOM. organizeLayerPropertyGroups: the
   shape branch (app.js:2315) becomes a no-op guard — the schema now owns
   grouping/order for shape; sticker/text branches stay.
5. installEffectGradientEditor: no behavior change, but it now finds the
   segmented control inside rendered DOM — confirm the Gradient button and
   panel still install for all three shape slots.

Verify: node tests/panel-parity.js, node tests/touch-smoke.js,
node tests/touch-handle-verify.js, node tests/export-parity.js,
node tests/shape-border-verify.js. Headless probe: add shape → all slot modes
(None/Glitter/Solid/Gradient where present) → border/shadow toggles → undo/redo
→ export. Check the mobile drawer path: shape layer active → mobile viewport →
settings drawer shows the rendered section.
```

### WP-S2 — Migrate Text panel — **Codex**

```
Same repo/branch/rules. FIRST read the WP-S1 shape-panel migration diff
(git log/show — it's the reference for this exact task) and
docs/SIDEBAR-TEMPLATE-PLAN.md; replicate that pattern, do not invent a new
one. Zero behavior/visual change; tests/panel-parity.js diff must be empty
(modulo template-stamped new IDs). Do not modify TextGlitterManager binding
logic — plan "Consistency decisions" item 4.

The text panel (index.html ~1354-1877) is the largest
and has the irregular ID grammar (textFillUseNone/UseGlitter/UseColor,
textLayerOpacity). Migrate it to PANEL_SCHEMAS[LayerType.TEXT_GLITTER]:

- Content group: text input card, font picker gallery host, font size,
  text-align segmented, box-mode hint, Fit Box to Content — these are
  text-specific one-off cards; give them kind entries that clone tpl-card and
  accept an existing-markup fragment template (tpl-text-content etc.) rather
  than inventing per-card schemas. One-off ≠ exempt: the markup still lives in
  a <template>, not in JS strings.
- Fill/Border/Shadow via tpl-paint-slot with legacy ID overrides in the roles
  table (Use* grammar preserved exactly).
- Text fill slot has no texture scale/opacity of its own (defers to layer
  settings — see slot-effects.js header comment); the schema expresses that as
  slot options, the template hides those rows.
- TextGlitterManager (~87 getElementById): bindings unchanged; delete only
  code that assumed static-DOM structure or reordered nodes.
- organizeLayerPropertyGroups: text branch becomes no-op.

Verify: same suite as WP-S1 plus export-parity (text is an effect-source
mirror — do not touch _getTextEffectSource or any export code). Probe: type
text, switch fonts, all slot modes, undo/redo, project save→load→panel state.
```

### WP-S3 — Migrate Sticker + Glitter Fill panels — **Codex**

```
Same repo/branch/rules. Read the WP-S1 and WP-S2 migration diffs first and
replicate the pattern; zero behavior/visual change, empty parity diff, no
manager binding-logic changes. Two smaller migrations:

1. Sticker (index.html ~1085-1353): Content (asset-info via tpl-asset-info,
   Replace/actions), transform host, Effects (border + shadow slots — sticker
   uses stickerBorder*/stickerShadow* prefixes, StickerManager.js:69 builds
   its ui map by suffix loop, so preserved IDs mean zero manager changes).
2. Glitter Fill (glitterSettingsSection + layerSettingsSection): the glitter
   source card (glitterFill prefix, GlitterManager.js:126) becomes a
   tpl-paint-slot; selection-settings sliders become tpl-slider-rows.
   brushSettingsSection is TOOL settings, not layer properties — leave it
   static (it also gets re-parented by MobileManager's brush placement logic;
   out of scope).
3. Delete organizeLayerPropertyGroups entirely plus the legacyIds removal pass
   in renderTransformPanels (app.js:2225-2229) — no static cards remain to
   shuffle. renderTransformPanel itself still emits its template literal;
   converting it to tpl-* primitives happens in WP-S4.

Verify: full suite + probe: sticker add/replace/border/shadow, glitter fill
color-pick + paint + selection settings, mobile drawers for every layer type,
welcome/no-layer/base-image panel modes unchanged.
```

### WP-S4 — Shared-code convergence — **Codex, Fable reviews closely**

```
Same repo/branch/rules. Zero behavior change — this WP moves markup sources
and lookup mechanisms only. Now that all rendered DOM carries
data-role/data-slot/data-mode:

1. syncPaintSlotSourceUI (effect-source.js:185): resolve mode from
   data-mode instead of ID-suffix sniffing (keep the suffix path as fallback
   only if any non-rendered caller remains — grep first; goal is deletion).
2. installEffectGradientEditor: clone tpl-gradient-editor instead of the
   innerHTML string; find the segmented control via data-role. Behavior,
   listeners, and pointer-capture logic move verbatim — this is a markup-source
   change only (export math untouched).
3. renderTransformPanel (app.js:2400): rebuild from tpl-* primitives, driven by
   transformCapabilities exactly as now; getTransformIds becomes entries in the
   renderer's roles table (keep the function as a thin wrapper — 8 call sites).
4. Sweep app.js for remaining sidebar innerHTML/template-literal markup and
   move anything repeated into templates. app.js has ~330 getElementById calls;
   do NOT refactor lookups wholesale — only structural markup moves.

Verify: full suite + parity + the export fragility test from CLAUDE.md
(animated sticker → export → edit → undo → export; export twice, byte-stable).
```

### WP-S5 — Cleanup + docs — **Fable**

```
Same repo/branch/rules. Final pass:

1. Remove dead static markup, dead CSS hooks are left alone (no SCSS edits —
   class names never changed; confirm with a grep that no template class was
   invented rather than copied).
2. modals/guide.html: confirm no panel titles changed (none should have);
   update only if a WP intentionally renamed one.
3. CLAUDE.md: add an "adding a sidebar panel/control" bullet pointing at
   PANEL_SCHEMAS + templates + panel-renderer.js, replacing the implicit
   "copy the markup" workflow. Note it in docs/!old/LAYER-TYPE-CONTRACT.md's
   panel-markup step as superseded.
4. tests/panel-parity.js baseline: regenerate final, commit.
```

---

## Verification matrix (Ryan manual, after WP-S5)

Desktop: every layer type's panel — add, edit every control, switch layers
rapidly (values must track the active layer, no listener doubling: drag one
slider, watch for double-step), collapse/expand sections. Mobile: settings
drawer per layer type, brush drawer, rotate viewport. History: undo/redo
through panel-driven edits including slot mode switches and gradient stop
edits. Projects: save → reload → panels reflect loaded state. Export: parity
suites + the fragility sequence. Themes: spot-check two themes (Win7 + Llama)
— rendered markup uses identical classes so styling must be pixel-identical.

## Risks & do-not-touch

- **Duplicated listeners** are the classic failure of this refactor. The
  design prevents them structurally (render once at boot, bind once, never
  rebuild) — any WP that finds itself wanting to re-render a section on layer
  activation is off the rails; managers update values in place.
- **Silent missing controls**: `?.` binding hides holes; the parity harness is
  the guard. No WP merges with an unreviewed baseline diff.
- **Init order**: renderer before manager UI caching, MobileManager section
  caching, collapsible init, tooltip/pixel-scaler init. Pinned in WP-S0.
- **Do not touch**: GifExporter, effect paint-source mirrors
  (`getEffectPaintSource` ↔ `_getTextEffectSource`), mask pipeline,
  GestureManager/LayerTransform, ProjectSerializer formats. This plan changes
  where markup comes from — never what any control does.
- **No SCSS changes** expected; if a WP thinks it needs one, the template
  diverged from the copied markup — fix the template.

## Completion audit

Implementation is complete. `PANEL_SCHEMAS` and `panel-renderer.js` now own the
generated sidebar structure, and the parity baseline covers 498 structural
entries. The only remaining existing-markup fragment is `tpl-text-content`
(six cards): its textarea, dynamic font-picker host, box-mode guidance, and
specialized typography controls are intentionally bespoke. The redundant
sticker Actions fragment was removed; stickers now use the shared transform
action template directly.

Transform interactions also converge in `LayerTransform`: corner scaling uses
cursor projection for proportional layers, edge handles resize from the
opposite edge, Alt/Option resizes from the center, and Reset Transform tracks
both axes plus rotation, flips, and the aspect-lock state. Shared action rows
use a two-column grid, so additional actions wrap instead of creating a third
button column.

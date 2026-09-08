# Property panel refactor — handoff

> The original goal statement. Current scope, decisions and per-artboard deltas
> live in `PLAN-property-panel-system.md`, `PANEL-REDESIGN-SPEC.md` and
> `PANEL-REDESIGN-ARTBOARD-DIFF.md` (same folder) — where they differ, those win.
>
> **Handing this to Codex / another implementer?** Start at
> [`CODEX-BRIEF.md`](CODEX-BRIEF.md) — it has the reading order, the revised
> preservation contract, the per-surface table, and a fill-in prompt. The
> design source of truth is the `.dc.html` files in
> [`../../design/`](../../design/) (plain HTML + inline CSS, in the repo), **not**
> the Claude Design artifact URL below, which is a reference render only and
> cannot be opened by most implementers.

## The goal

One coherent property-panel design system for the **right sidebar** (`#designPanel`) of this
glitter-graphics editor. The test: *adding a new setting tomorrow should be obvious* — which
row type, where its label/value/reset go, how it behaves responsively — **without inventing
a new design.**

Consistency is the point. If two things do the same job they use the same class, the same
component and the same words. **Generic classes over feature-specific ones**, so a value can
be changed in one place.

Scope: every property panel in the right sidebar, plus the gallery / search / filters, the
Layers panel and the Add-a-layer modal — the last two for **visual parity only** (same Y2K
bar, tokens, tile grid), no behaviour change. Not the toolbar, canvas, other modals or
export.

Design source: [`../../design/*.dc.html`](../../design/) (the visual target, as
inspectable markup). Reference render (do not hand this URL to an implementer —
it is not the source): <https://claude.ai/code/artifact/5780b5f2-6f7f-450c-8ee5-3452b602b3ee>

## Verify before and after every change

```bash
node tools/panel-audit.js     # behaviour: 701 ids, slider specs, visibility sweep
node tools/gutter-check.js    # layout: gutter once per path, no overflow, card clearance
npx sass css/style.scss css/style.css --no-source-map
```

Both serve on their own port and stop only their own process.
**Never run a bare `pkill -f "http.server"` — it kills the user's dev server.**

`node tools/panel-audit.js --capture` re-baselines. Only do that for an *intended* change,
after confirming every diff is the same intended class.

## The rules (already implemented — don't re-litigate)

- **Seven row types, no eighth.** R1 property row (`label · control · value · revert`),
  R2 stacked, R3 pair, R4 toggle, R5 module, R6 actions, R7 note.
- **The gutter rule.** Horizontal inset is owned by rows and headers only. Bodies, groups and
  blocks never add it. Encoded as `$gutter-owners` in `css/panels/_properties.scss` — add new
  primitives to that list, not to a `:not()` chain.
- **Spacing is the parent's `gap`**, or explicit `element + element { margin-top }`. Never a
  bare margin on a child (it survives when its neighbour hides → phantom space). One
  exception: a bordered card needs bottom padding to clear its own border.
- **Uppercase is one level only** — the group label.
- **Every boolean is a switch**: toggle row in a body, compact switch in a header.
- **A block that is a direct child of a group is a card.** Nested blocks are not (prevents
  card-in-card). Structural, not a class list.
- **Revert**: one undo icon, four scopes, always at the right edge of what it resets, never
  its own row. Hidden at default, faint on hover, solid when changed.
- **Write panel defaults with `:where()`** (zero specificity); save real specificity for
  exceptions.

## State

Landed: opt-in collapsibility, row primitives, default-aware reverts (all 30 sliders),
module rows, text panel 8 legacy cards → 4 blocks, resizable sidebars with snap/persist,
uniform cards, label classes 6 → 1, modal vocabulary removed from the sidebar, every boolean
a switch.

Measured: text panel **5573 → ~3300px**, shape **4259 → ~2500px**, collapsible cards
**16 → 2**, zero empty shells.

**Legacy conversion completed:**
1. The gradient editor uses standard R1/R2 property rows and shared set/spacing rules.
2. Header booleans use `.property-header-switch`; the sidebar `.checkbox-group` is gone.
3. Text content is schema-native; `tpl-text-content` and `templateBlock` are gone.
4. Brush has one authoritative schema source; its replaced static implementation is gone.
5. Shared paint slots use generic `.paint-slot-card` / `.property-module-content` names.

The gutter audit now runs at 280, 320, 360, 400 and 450px, with open and mixed
collapse states under both dark and light theme tokens. Empty semantic containers are a
hard failure in the panel audit.

## How to work on this (learned the hard way)

1. **Delete legacy vocabulary, don't alias it.** Every real improvement this session came
   from removing a class, not from adding a rule beside it.
2. **When a rule "does nothing", grep the compiled `css/style.css` and the other sheets**
   before editing it. Two traps hit repeatedly: SCSS `X &` reverses the selector, and stale
   duplicate definitions in `_settings.scss` silently won.
3. **After changing what a component *is*, grep for rules that assumed the old answer.**
   Making all blocks cards invalidated two rules that had been correct.
4. **Check whether `display` is load-bearing before restyling a component** — `.empty-state`
   is `display:none` until JS adds `.visible`.
5. **Encode a rule in `tools/gutter-check.js` rather than trusting your eye.** It has caught
   more real defects than visual review, including several introduced minutes earlier.
6. **Screenshot the panel you changed**, not a neighbouring one.

## Suggested opener for a new conversation

> Read `docs/panel-redesign/CODEX-BRIEF.md`, then `PANEL-REDESIGN-SPEC.md` and
> `PANEL-REDESIGN-ARTBOARD-DIFF.md` in the same folder, then the
> `design/<Surface>.dc.html` for the surface I name. I'm continuing a
> property-panel redesign of the right sidebar; the structural refactor has
> landed and this is the **visual parity** pass — make each panel look like its
> `design/*.dc.html` artboard using the SPEC's §2 tokens and §3 classes.
> Run `node tools/panel-audit.js`, `node tools/gutter-check.js` and
> `node tests/panel-parity.js` before and after every change — all must stay
> clean. Prefer deleting legacy classes over adding rules beside them. Start
> with [surface].

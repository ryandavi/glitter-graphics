# Property panel refactor — handoff

## The goal

One coherent property-panel design system for the **right sidebar** (`#designPanel`) of this
glitter-graphics editor. The test: *adding a new setting tomorrow should be obvious* — which
row type, where its label/value/reset go, how it behaves responsively — **without inventing
a new design.**

Consistency is the point. If two things do the same job they use the same class, the same
component and the same words. **Generic classes over feature-specific ones**, so a value can
be changed in one place.

Scope: every property panel in the right sidebar, plus the gallery/search/filters for visual
consistency. Not the toolbar, canvas, layers panel, modals or export.

Visual spec (approved): <https://claude.ai/code/artifact/e4197bd2-0548-4d62-9867-daaad78c97f8>

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

**Still legacy — convert, don't style around:**
1. The **gradient editor** (`tpl-gradient-editor`) — hand-authored, own spacing/headings.
2. The **`.checkbox-group`** wrapper that header switches still ride on.
3. `tpl-text-content` still exists as the source `templateBlock` clones from.

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

> Read `HANDOFF.md` and `PLAN-property-panel-system.md` in this repo. I'm continuing a
> property-panel design-system refactor of the right sidebar. Goal is consistency: generic
> reusable classes, one component per concept, so I can change a value in one place.
> Run `node tools/panel-audit.js` and `node tools/gutter-check.js` before and after every
> change — both must stay clean. Start with [the gradient editor / whatever you want].
> Prefer deleting legacy classes over adding rules beside them.

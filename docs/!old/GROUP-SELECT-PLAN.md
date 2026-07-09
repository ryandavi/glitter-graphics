# GROUP-SELECT-PLAN - overlap selection, multi-select, and group transform

**Written:** 2026-07-09. **Status:** planned, not implemented.
**Scope:** (1) fix overlap hit-testing so selection follows the topmost layer under the pointer,
(2) add multi-select for movable layers, and (3) add v1 group move/scale with one shared box.

Read first: `CLAUDE.md`, `docs/PROJECT-SAVE-PLAN.md` sections `0.1-0.3`, `docs/TOUCH-PLAN.md`,
and the current `GestureManager` / `LayerTransform` flow. This work is deliberately split out of
project save/load; it does not change the project file format.

---

## 1. Overlap selection defect

Root issue: once a layer is selected, its transform surface and the active-layer drag path can
claim pointerdown before the app re-hit-tests the stack. That means clicking an overlapping
neighbor inside the selected layer's box can start dragging the wrong layer instead of selecting
the topmost one.

Target behavior:
- Selection follows the topmost hit, not the current selection.
- Bounding-box handles still win for resize / rotate.
- Bounding-box interior re-hit-tests the stack and can switch the active layer before drag begins.
- `Alt+click` cycles deeper through the hit stack.
- Touch taps follow the same topmost-hit rule; no deep-cycle gesture on touch in v1.

Implementation notes:
- Add `LayerManager.getLayersAtPoint(x, y)` returning the full top-down hit stack.
- Update the select / drag entry path so transform-box interior clicks re-hit-test before dragging.
- Keep handle hit areas authoritative; only the box interior should delegate back to stack hit-test.
- Add a guide / shortcut entry for `Alt+click`.

---

## 2. Multi-select model

Model:
- Add `editor.selectedLayerIds: Set`.
- Keep `activeLayerId` as the "last focused" member; settings panels remain single-layer and read
  from `activeLayerId` when exactly one layer is selected.
- Plain click replaces the selection.
- `Shift+click` on canvas or layer list adds/removes a movable layer.
- Empty click clears selection.
- Only movable types participate in v1: sticker, text, shape.
- Glitter-fill and base-image stay single-select in v1.

UI:
- Layer list reflects multi-selection.
- No-layer / per-type panels collapse to a minimal "N layers selected" state when the set size > 1.
- Group-capable actions surface there first: move, delete, duplicate, center.

History:
- Group gestures save one history entry per completed gesture, matching the existing single-layer
  transform pattern.

---

## 3. Group transform v1

Box:
- Render one union AABB around the selected movable layers.
- Reuse the existing transform-handle DOM classes so gesture exclusions and touch routing still
  work.

Move:
- Apply the same dx/dy to every selected member's position.

Scale:
- Corner handles only in v1.
- Uniform scaling only.
- Scale member positions about the group-box center.
- Also scale each member's own transform scale.
- On commit, call each type's existing bake/commit path:
  - sticker: existing transform commit path
  - text: current transform handling, later text-specific bake if needed
  - shape: `commitScale`

Deferred:
- No group rotation in v1.
- No side-handle non-uniform group resize in v1.

---

## 4. Touch impact

- One-finger drag inside the union box = group move.
- Two-finger gesture inside the union box = group scale/translate.
- Two-finger gesture outside the union box stays viewport zoom.
- Touch selection editing for add/remove happens in the layer list UI, not via a long-press canvas
  gesture in v1.

Tests to extend:
- `tests/touch-smoke.js`
- `tests/touch-handle-verify.js`

Needed coverage:
- overlap tap-through
- group pinch vs viewport pinch disambiguation
- handle exclusions on the group box

---

## 5. Suggested phases

1. Overlap hit-test fix (`1`)
2. Selection model + layer-list multi-select (`2`)
3. Shared group box + group move (`3`)
4. Group scale (`3`)
5. Touch routing + test updates (`4`)

---

## 6. Current repo status

As of 2026-07-09:
- Project save/load work is implemented separately.
- This feature set has **not** landed yet.
- Existing "multi-select" references in the repo are for glitter color-pick selections, not
  layer multi-select.

# QOL-FEATURES — catalogue of quality-of-life behaviors

Status: 2026-07-08. Single inventory of the "small delight" behaviors — shipped and
planned — so guide.html and `CONFIG.shortcuts` can be reconciled against one list.
Planned items come from SIZE-AND-SCALE-PLAN.md §5 (in Codex now).

Legend: ✅ shipped · 🔜 planned (current Codex batch) · 🗑 removed on purpose

## Selection & movement (movable layers: sticker / text / shape)

| Behavior | Status | Notes |
|---|---|---|
| Arrow-key nudge — 1px, Shift = 10px | ✅ | app.js:3713 `tryArrowNudge`; runs before the typing guard, blurs the text input on first nudge; burst collapses to one history entry. **Not listed in `CONFIG.shortcuts` or guide — add.** |
| Center H / Center V buttons | ✅ | `.layer-center-controls` context bar, all three types via `getMovableLayerContext` |
| Align to canvas edges (left/right/top/bottom) | 🔜 | joins the existing center buttons in the Transform card |
| Axis-lock layer drag (Shift constrains to X/Y) | 🔜 | same modifier language as rotation snap |
| X/Y (+ W/H) numeric entry, ↑/↓ = 1, Shift = 10 | 🔜 | first exact placement; same step language as nudge |
| Master "Reset transform" button | 🔜 | per-row resets (rotation/opacity/scale X/Y) already exist ✅ |
| Alt-drag to duplicate | 🔜 | may defer on touch (GestureManager routing) |
| "Fit canvas" / "Fill canvas" for stickers | 🔜 | nice-to-have, after the ones above |

## Transform handles & rotation

| Behavior | Status | Notes |
|---|---|---|
| Shift-snap rotation to 15° — handle **and** slider | ✅ | shared `LayerTransform.handleRotationDrag` + `shiftHeld` tracking in app.js |
| Proportional-scale lock checkbox | ✅ | scale X edits mirror to Y and vice versa |
| Shape scale bakes to crisp pixels on release | ✅ | `commitScale` re-rasterizes 1:1 — feels like magic, worth a guide line |
| Shape edge handles = one-axis resize; text edge handles = box resize | ✅ | `supportsEdgeResize` |

## Brush & mask

| Behavior | Status | Notes |
|---|---|---|
| Shift-drag = straight line locked to 0/45/90° | ✅ | in shortcuts + guide |
| X swaps Paint/Erase · `[` `]` brush size (Shift = bigger steps) | ✅ | `[`/`]` = ±5, Shift = ±10 — Shift variant not in guide |
| Wacom pen eraser-end auto-erases for that stroke | ✅ | toolbar highlight deliberately unchanged; worth a guide line |
| Separate remembered settings for Brush vs Eraser (persist across sessions) | ✅ | localStorage `glitter.toolSettings.v1` |
| Shift-click connect-line from previous stroke | 🗑 | removed 2026-07-06 — surprised users; don't re-add |

## Creation

| Behavior | Status | Notes |
|---|---|---|
| Drag-to-create shapes; Shift = square/circle; tiny drag = default size | ✅ | rubber-band preview + crosshair |
| Text tool click = point text anchored at click | ✅ | |
| Drag & drop image onto the dropzone | ✅ | |

## View & navigation

| Behavior | Status | Notes |
|---|---|---|
| Tool keys V T U I B E H Z · Ctrl+0 fit · Ctrl+1 100% · Ctrl+± · wheel zoom · Alt+click zoom out | ✅ | all in `CONFIG.shortcuts` |
| Ctrl+wheel trackpad zoom | ✅ | not in shortcuts list — add |
| Touch: pinch on selected layer transforms it, else zooms viewport (Canva rule); double-tap zoom; double-tap text to edit; inertia pan | ✅ | guide's touch coverage should mention these |
| Panel auto-opens the active layer's settings section | ✅ | |
| Esc / Done ends the gallery picker session and returns to the layer's panel | ✅ | Esc guarded (ignores typing/modals) |

## Guide/shortcuts reconciliation (do with the Codex batch)

Add to `CONFIG.shortcuts` + guide.html: arrow nudge (+Shift), Shift with `[`/`]`,
Ctrl+wheel zoom, Shift-square on shape drag, pen-eraser note, and each 🔜 item as it
lands (axis-lock drag, Alt-drag duplicate, numeric-field ↑/↓ steps). Keep the modifier
language consistent everywhere: **Shift = bigger step / constrain / snap, Alt =
alternate action (zoom out, duplicate).**

## What should surface to users

Keep this file as the full internal inventory. The user guide should stay curated.

- Put in the tool and guide: arrow-key nudge, Shift axis-lock drag, Shift rotation snap,
  X/Y/W/H exact entry with ↑/↓ stepping, reset transform, align-to-canvas controls,
  Ctrl+wheel zoom, Shift with `[`/`]`, Shift-square/circle shape creation, and pen
  eraser-end behavior.
- Put in the guide only: touch gestures, shape crisp re-rendering on resize, separate
  remembered Brush/Eraser settings, and the "Done / Esc returns you from picker mode"
  behavior.
- Keep out of the guide table: implementation details like history batching, toolbar
  highlight caveats, or removed behaviors.

Recommendation: do **not** mirror the full table in `guide.html`. Use this doc as the
source-of-truth inventory, and keep the guide focused on the highest-value actions and
discoverability gaps.

# Undo/Redo Coverage Audit — 2026-07

History snapshots deep-clone layer JSON. Glitter-fill paint buffers remain versioned
in `GlitterManager.paintHistory` and snapshots reference them through `maskVersion`.

| Mutation | Coverage | Notes / fix |
| --- | --- | --- |
| Add, delete, duplicate, reorder | Covered | One checkpoint per command; Alt-drag creates without history and commits once on release. |
| Rename, visibility, lock | Covered | Layer-list change handlers checkpoint once. |
| Sidebar position, W/H, scale, rotation, opacity | Covered | `input` previews; `change` checkpoints. Text scale UI was removed. |
| Flips, align, transform/rotation/opacity resets | Covered | Button/change command checkpoints once. Text transform reset preserves committed font size. |
| Canvas move, corner, edge, rotate | Covered | One checkpoint on pointer/mouse release. Escape restores the start state without history. |
| Group move/scale/rotate and marquee selection | Covered | Group gesture release owns the checkpoint; selection-only marquee changes are UI state. |
| Text content, font, size, spacing, alignment and box settings | Covered | Debounced content commit or discrete command; live slider input remains history-free. |
| Text/shape fill, border and shadow properties | Covered | Inputs render live and checkpoint on change. Gradient stop/type/add/remove commands follow the same rule. |
| Glitter asset swaps | Covered | Picker application owns one checkpoint. |
| Paint/erase strokes and color fill | Covered | Mask version captured and checkpointed at stroke/fill completion. |
| Canvas resize | Covered | Reanchors paint history and checkpoints after the new buffers are captured. |
| Project name | Covered | Change commits through the project metadata handler. |
| Undo/redo restore rendering | Covered | Manager render paths reconcile elements; sticker rendering now retains the live `LayerTransform` owner so handles remain synchronized. |

Audit method: mutation listeners and manager write sites were traced to `saveState`,
with special attention to `input`/`change` pairs and gesture cancellation. No export
or mask-threshold behavior was changed by the audit.

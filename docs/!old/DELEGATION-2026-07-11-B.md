# Delegation round — 2026-07-11 (theme polish follow-ups + MP4 export)

Context: Fable shipped the theme/token fixes directly (bar-button tokens, count
badge, empty swatch, bounds outline, per-theme button rims, dew glass, transform
handle restyle, system-font support with Comic Sans MS + Impact). The items
below are the remaining work, sized and written as paste-ready prompts.

Do-not-touch while these run:
- `css/style.css` / `css/style.css.map` (Ryan compiles from SCSS)
- `GifExporter` frame composition internals, except where D-4 explicitly says to reuse them
- The Windows-7 theme mixin block in `_mixins.scss` (deliberately literal)

---

## D-1 — Guide reorg: misfiled content (small, any model)

The guide's Export section (`modals/guide.html`, `h3#export`) contains four
paragraphs under the "Export Settings:" heading (~lines 1213–1216) that have
nothing to do with exporting: **Selection**, **Editing shortcuts**, **Mobile**,
and **Multi-layer Align**.

> In `modals/guide.html`, the Export section's "Export Settings:" block starts
> with four misfiled paragraphs: Selection (marquee/Ctrl+A/Alt+drag), Editing
> shortcuts (double-click text, Space pan, Alt resize-from-center, redo),
> Mobile (App Settings / Clear All locations), and Multi-layer Align. Move
> them out of Export: Selection + Editing shortcuts + Multi-layer Align belong
> in the Basics section under "Working with Layers" (create a "Selection &
> Alignment" h4 subsection if that reads better); the Mobile paragraph belongs
> in Etcetera (or a Mobile note in Basics — your call, but not Export). While
> there, sweep every other section for content that doesn't match its heading
> and move it too. Keep the existing markup conventions (guide-item /
> guide-item-icon / icon sprite refs), update the Contents list at the top and
> any `id` anchors you move (grep js/ for `#` anchor references into the guide
> before renaming any id). No SCSS changes. Don't add new features to the text
> — reorganize only.

## D-2 — `_mobile.scss` split (medium, mechanical — Codex)

Decision (Fable + Ryan): media queries live next to the desktop styles for the
same component; `_mobile.scss` keeps only mobile-only chrome (bottom/top nav,
settings drawer, mobile toolbar overrides). Today `_mobile.scss` is ~2400 lines
and most of it is un-media-queried component CSS (transform handles, font/brush
pickers, segmented controls, canvas-size controls, asset browser, gallery
picker strip, switches…) that landed there historically.

> In `css/`, refactor `_mobile.scss` so it contains only (a) mobile-only
> chrome (`.mobile-bottom-nav`, `.mobile-top-nav`, `.mobile-settings-drawer`,
> mobile drawer/toolbar rules) and (b) `@media (max-width: 800px)` /
> `(pointer: coarse)` blocks. Every bare component rule currently in
> `_mobile.scss` (transform handles, `.switch`, `.text-font-*`,
> `.brush-shape-*`, `.segmented-control`, `.canvas-size-*`, `.input-unit`,
> `.anchor-grid`, `.asset-browser`, `.asset-info*`, `.gallery-picker-strip`,
> `.advanced-disclosure`, `.helpful-message`, etc.) moves into the file that
> owns that component's desktop styles (`_components.scss` for shared atoms,
> `_panels.scss` for panel/canvas UI), placed next to related rules, with its
> own `@media` overrides nested directly under it. HARD CONSTRAINTS: (1) this
> is a move-only refactor — do not reword selectors, values, or comments;
> comments travel with their rules; (2) CSS cascade order can change behavior —
> after moving, compile with `npx sass css/style.scss <scratch>.css` and diff
> the *set* of rules against a pre-move compile; where two rules share
> specificity and relied on file order (there is at least one known deliberate
> cascade override: the bare `.subsection-note` redeclaration commented around
> the `.text-effect-source-row` area), preserve the winning order and keep the
> explanatory comment; (3) do not touch `css/style.css` itself — Ryan
> compiles; (4) LF endings, tabs. Verify with `node tests/touch-smoke.js` and
> `node tests/touch-handle-verify.js`.

## D-3 — Distinct icon for Clear All / Reset (small)

`layersBarDeleteSelected` (delete selected layer), `layersBarClearAll` (reset
everything, mobile-only via `.mobile-only-action` — desktop duplication is
already handled), and the toolbar `clearAllTool` (Reset) all use `#icon-trash`.
Delete-selected should keep the trash; the two "reset everything" buttons
should share a different glyph.

> In `index.html`, add a new sprite symbol `icon-broom` (Font Awesome 6 Free
> "broom" solid path, viewBox 0 0 576 512 — match the existing FA-style
> symbols in the sprite block at the bottom of the file) and switch BOTH
> `#clearAllTool` (toolbar Reset) and `#layersBarClearAll` (mobile layers-bar
> Clear All) from `#icon-trash` to it. `#layersBarDeleteSelected` and all
> per-layer delete buttons keep `#icon-trash`. If the guide
> (`modals/guide.html`) shows the trash icon next to Reset/Clear All copy,
> update those `<use>` refs to match. No JS or SCSS changes.

## D-4 — MP4 export, fully in-browser (large — Opus/Codex)

**Feasibility: yes, no server needed.** WebCodecs `VideoEncoder` (H.264) +
the vendored pure-JS muxer produce a real .mp4 Blob client-side. Support:
Chrome/Edge 94+, Safari 16.4+ (iOS included), Firefox 130+. `ffmpeg.wasm` was
rejected (~30 MB payload, slow). Fallback on unsupported browsers: the MP4
format option is disabled with a tooltip, GIF unaffected.

**Setup already done by Fable:** `js/vendor/mp4-muxer.js` (mp4-muxer 5.2.2,
IIFE build, global `Mp4Muxer`, MIT — license at
`js/vendor/mp4-muxer-LICENSE.txt`). Not yet referenced by index.html.

Key design points for the implementer:

- **Reuse the GIF frame plan — do not build a second compositor.** GifExporter
  already flattens GIF frames to ImageData and composites every layer per
  frame (this is the export half of the preview/export mirror). Extract or
  call into that per-frame composition so MP4 frames are pixel-identical to
  GIF frames. Any drift between the two formats is a bug class we already
  fight; don't create a third source.
- **Looping:** MP4 has no loop flag — encode the frame sequence N times.
  `CONFIG.export.mp4.loopCount` (default 3, range 1–10, UI control). Show the
  resulting duration in the UI (loops × frames × frameDelay); Instagram
  stories want ≥3 s.
- **Timing:** fps = 1000 / frameDelay (110 ms ≈ 9 fps is fine for H.264).
  VideoFrame timestamps in microseconds: `frameIndex * frameDelay * 1000`,
  constant `duration` per frame.
- **Encoder config:** codec `avc1.42001f`-ish baseline; verify with
  `VideoEncoder.isConfigSupported` and fall back through a small codec-string
  ladder before declaring unsupported. Bitrate from a quality preset in
  `CONFIG.export.mp4` (default ~2 Mbps — a 3 s 500 px clip lands well under
  1 MB, fine for Discord/IG/WhatsApp). `latencyMode: 'quality'`.
- **Muxer:** `new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(),
  video: { codec: 'avc', width, height, frameRate }, fastStart: 'in-memory' })`
  — fastStart matters for chat-app inline preview. Feed encoder output chunks
  to `muxer.addVideoChunk`.
- **Dimensions:** H.264 requires even width/height — if the canvas is odd,
  letterbox by 1 px using the matte color (do NOT rescale artwork).
- **Transparency:** MP4 has no alpha. When format = MP4, disable the
  transparency toggle and always composite on the matte color.
- **UI:** Export Settings modal gains a "Format" segmented control (GIF | MP4)
  using the existing `.segmented-control` pattern; MP4-only controls (loops,
  quality preset) show/hide with the format, GIF-only controls (quality,
  dithering, transparency) likewise. Export button and project-name flow
  unchanged; file extension follows format. All new values live in
  `js/config.js` under `CONFIG.export.mp4` — no inline `??` fallbacks.
- **Files:** new plain script `js/classes/Mp4Exporter.js` (class, global, no
  modules) + `<script>` tags for it and `js/vendor/mp4-muxer.js` in
  index.html with `?v=1`; bump `?v=` on every file touched. Progress UI: reuse
  the GIF export progress affordance.
- **Guide:** mirror the new Format/Loops/Quality controls in
  `modals/guide.html` Export section.
- **Verify:** `node tests/export-parity.js` must still pass byte-identical for
  GIF. Do NOT require byte-identical MP4 across runs (encoders are not
  deterministic); assert instead that the Blob is nonempty, `video/mp4`, and
  playable (decode a frame back via `VideoDecoder` or a `<video>` element in
  the Playwright probe).

## D-5 — Optional / later

- **Transform-handle outward offset:** considered while restyling handles;
  skipped because handle placement is JS geometry (GestureManager/transform
  code), and the white-fill + accent-ring restyle already fixes the
  muddy-on-selection-border problem. Revisit only if Ryan still wants the
  Figma-style outset after seeing the restyle.
- **Self-hosted Comic Neue (OFL)** as a guaranteed comic face on Android/iOS:
  drop `comic-neue.woff2` into `fonts/`, add a manifest entry, and it already
  slots into the Comic Sans MS fallback stack (the stack lists "Comic Neue").

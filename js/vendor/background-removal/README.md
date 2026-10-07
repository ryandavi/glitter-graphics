# Background removal runtime

ONNX Runtime Web 1.21.0 (MIT), extracted without modification from the npm
`onnxruntime-web@1.21.0` tarball:

- `dist/ort.webgpu.min.js`
- `dist/ort-wasm-simd-threaded.jsep.wasm`
- `dist/ort-wasm-simd-threaded.jsep.mjs`, renamed to `.js` so static hosts,
  including local XAMPP, serve the module with a JavaScript MIME type.

No application build step is required. These files load only from the background
removal worker after the action is clicked. WASM uses one thread without COOP/COEP
headers. WebGPU is tried first, with WASM fallback.

Model: chenjindu/isnet-web, Apache-2.0 (weights and code), pinned revision
`cda7d26ab33047a109639812bee5fe6a3c2f8a0d`. Three parts are downloaded from
Hugging Face on demand and cached with Cache Storage when available.
Model documentation: https://huggingface.co/chenjindu/isnet-web
Exporter/demo source: https://github.com/chenjindu/browser-remove-background
Normalization: 1024 × 1024 RGB, CHW float32, channel / 255 − 0.5.
Output: min/max normalized mask, interpolated to the original image dimensions
and multiplied by its existing alpha. The app owns its preprocessing and UI;
it does not use the IMG.LY wrapper or assets.

Licenses are included in `LICENSE` and `MODEL-LICENSE`.

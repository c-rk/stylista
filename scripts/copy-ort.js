// Copies the ONNX Runtime WebAssembly build into public/ for the web preview.
// Native builds use onnxruntime-react-native and do not need these files.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'onnxruntime-web', 'dist');
const dst = path.join(__dirname, '..', 'public', 'ort');
if (fs.existsSync(src)) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of ['ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) fs.copyFileSync(path.join(src, f), path.join(dst, f));
}

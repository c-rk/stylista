/** Bundled network inference in the browser preview through ONNX Runtime WebAssembly. */
import { Asset } from 'expo-asset';

import { MODELS, ModelName } from './models';

interface Session {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
}
interface Ort {
  env: { wasm: { wasmPaths: string; numThreads: number } };
  InferenceSession: { create(uri: string): Promise<Session> };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
}

let runtime: Promise<Ort> | undefined;
const sessions = new Map<ModelName, Promise<Session>>();

// The runtime is served from /ort (see scripts/copy-ort.js) and loaded as a classic script,
// which keeps its WebAssembly loader out of the Metro bundle.
function loadRuntime(): Promise<Ort> {
  runtime ??= new Promise((resolve, reject) => {
    const g = globalThis as unknown as { ort?: Ort; document: Document };
    if (g.ort) return resolve(g.ort);
    const el = g.document.createElement('script');
    const base = process.env.EXPO_BASE_URL ?? '';
    el.src = `${base}/ort/ort.wasm.min.js`;
    el.onload = () => {
      g.ort!.env.wasm.wasmPaths = `${base}/ort/`;
      g.ort!.env.wasm.numThreads = 1;
      resolve(g.ort!);
    };
    el.onerror = () => reject(new Error('ONNX Runtime failed to load'));
    g.document.head.appendChild(el);
  });
  return runtime;
}

export async function runModel(name: ModelName, input: Float32Array, dims: number[]): Promise<Float32Array[]> {
  const ort = await loadRuntime();
  let s = sessions.get(name);
  if (!s) {
    s = (async () => {
      const asset = Asset.fromModule(MODELS[name]);
      await asset.downloadAsync();
      return ort.InferenceSession.create(asset.localUri ?? asset.uri);
    })();
    sessions.set(name, s);
  }
  const session = await s;
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, dims) });
  return session.outputNames.map((n) => out[n].data);
}

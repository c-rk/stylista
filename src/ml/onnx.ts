/** Bundled network inference on device (iOS / Android) through ONNX Runtime. */
import type { InferenceSession as Session } from 'onnxruntime-react-native';

import { assetUri } from '@/lib/assets';
import { MODELS, ModelName } from './models';

type Ort = typeof import('onnxruntime-react-native');

let ort: Ort | undefined;
const sessions = new Map<ModelName, Promise<Session>>();

/**
 * The runtime is required on first use, never at app start: its module installs a native JSI
 * binding and reads it eagerly, so loading it at import time turns any native problem into a
 * crash on launch. Loaded here, a failure only disables the features that need inference.
 */
function runtime(): Ort {
  if (!ort) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ort = require('onnxruntime-react-native') as Ort;
    } catch (e) {
      throw new Error(`On-device ML unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return ort;
}

function load(name: ModelName): Promise<Session> {
  let s = sessions.get(name);
  if (!s) {
    s = (async () => runtime().InferenceSession.create((await assetUri(MODELS[name])).replace(/^file:\/\//, '')))();
    // A failed load is not cached, so a later attempt can retry.
    s.catch(() => sessions.delete(name));
    sessions.set(name, s);
  }
  return s;
}

/** Runs a bundled model on one float tensor and returns its outputs in declared order. */
export async function runModel(name: ModelName, input: Float32Array, dims: number[]): Promise<Float32Array[]> {
  const s = await load(name);
  const out = await s.run({ [s.inputNames[0]]: new (runtime().Tensor)('float32', input, dims) });
  return s.outputNames.map((n) => out[n].data as Float32Array);
}

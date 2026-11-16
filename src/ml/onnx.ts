/** Bundled network inference on device (iOS / Android) through ONNX Runtime. */
import { InferenceSession, Tensor } from 'onnxruntime-react-native';

import { assetUri } from '@/lib/assets';
import { MODELS, ModelName } from './models';

const sessions = new Map<ModelName, Promise<InferenceSession>>();

function load(name: ModelName): Promise<InferenceSession> {
  let s = sessions.get(name);
  if (!s) {
    s = (async () => {
      return InferenceSession.create((await assetUri(MODELS[name])).replace(/^file:\/\//, ''));
    })();
    sessions.set(name, s);
  }
  return s;
}

/** Runs a bundled model on one float tensor and returns its outputs in declared order. */
export async function runModel(name: ModelName, input: Float32Array, dims: number[]): Promise<Float32Array[]> {
  const s = await load(name);
  const out = await s.run({ [s.inputNames[0]]: new Tensor('float32', input, dims) });
  return s.outputNames.map((n) => out[n].data as Float32Array);
}

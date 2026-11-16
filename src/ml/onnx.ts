/** Bundled network inference on device (iOS / Android) through ONNX Runtime. */
import { Asset } from 'expo-asset';
import { InferenceSession, Tensor } from 'onnxruntime-react-native';

import { MODELS, ModelName } from './models';

const sessions = new Map<ModelName, Promise<InferenceSession>>();

function load(name: ModelName): Promise<InferenceSession> {
  let s = sessions.get(name);
  if (!s) {
    s = (async () => {
      const asset = Asset.fromModule(MODELS[name]);
      await asset.downloadAsync();
      return InferenceSession.create((asset.localUri ?? asset.uri).replace(/^file:\/\//, ''));
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

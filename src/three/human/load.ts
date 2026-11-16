import { Asset } from 'expo-asset';
import { useEffect, useState } from 'react';

import meta from './meta.json';
import { HumanMeta, HumanModel } from './model';

let pending: Promise<HumanModel> | undefined;
let loaded: HumanModel | undefined;

/** Loads the bundled body data once; later calls reuse the same model. */
export function loadHuman(): Promise<HumanModel> {
  pending ??= (async () => {
    const asset = Asset.fromModule(require('../../../assets/body/body.bin'));
    await asset.downloadAsync();
    const res = await fetch(asset.localUri ?? asset.uri);
    loaded = new HumanModel(meta as unknown as HumanMeta, await res.arrayBuffer());
    return loaded;
  })();
  return pending;
}

export function useHuman(): HumanModel | undefined {
  const [model, setModel] = useState(loaded);
  useEffect(() => {
    let alive = true;
    if (!model) loadHuman().then((m) => alive && setModel(m), () => {});
    return () => {
      alive = false;
    };
  }, [model]);
  return model;
}

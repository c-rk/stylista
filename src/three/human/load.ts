/* eslint-disable @typescript-eslint/no-require-imports -- Metro resolves bundled binary assets through require(). */
import { useEffect, useState } from 'react';

import { assetBytes } from '@/lib/assets';
import meta from './meta.json';
import { HumanMeta, HumanModel } from './model';

let pending: Promise<HumanModel> | undefined;
let loaded: HumanModel | undefined;

/** Loads the bundled body data once; later calls reuse the same model. */
export function loadHuman(): Promise<HumanModel> {
  pending ??= (async () => {
    loaded = new HumanModel(meta as unknown as HumanMeta, await assetBytes(require('../../../assets/body/body.bin')));
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

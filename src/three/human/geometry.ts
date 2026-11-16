import * as THREE from 'three';

import { FittedBody, HumanModel, MeshSet } from './model';

/** Builds a renderable geometry for one mesh set of a fitted body. */
export function setGeometry(model: HumanModel, fit: FittedBody, set: MeshSet, keep?: (baseVertex: number) => boolean): THREE.BufferGeometry {
  const vmap = model.array(`${set}.vmap`) as Uint16Array;
  const uv = model.array(`${set}.uv`) as Float32Array;
  const idx = model.array(`${set}.idx`);
  const nrm = model.normals(fit.positions, set);
  const pos = new Float32Array(vmap.length * 3);
  const nor = new Float32Array(vmap.length * 3);
  for (let i = 0; i < vmap.length; i++) {
    const b = vmap[i] * 3;
    pos.set(fit.positions.subarray(b, b + 3), i * 3);
    nor.set(nrm.subarray(b, b + 3), i * 3);
  }
  let index: ArrayLike<number> = idx;
  if (keep) {
    const out: number[] = [];
    for (let t = 0; t < idx.length; t += 3) if (keep(vmap[idx[t]]) && keep(vmap[idx[t + 1]]) && keep(vmap[idx[t + 2]])) out.push(idx[t], idx[t + 1], idx[t + 2]);
    index = out;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(Array.from(index));
  return g;
}

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

/**
 * Per-vertex skin shading detail, as colour multipliers for the `body` set:
 * cavity darkening from local concavity (defines nose, ears, fingers, navel), plus lip and
 * eyebrow tints when no face photo supplies them.
 */
export function skinColors(model: HumanModel, fit: FittedBody, face: { eyeY: number; eyeDx: number; chinY: number; frontZ: number } | null, brow: [number, number, number]): Float32Array {
  const vmap = model.array('body.vmap') as Uint16Array;
  const idx = model.array('body.idx');
  const pos = fit.positions;
  const nrm = model.normals(pos, 'body');
  const n = model.n;
  const sum = new Float32Array(n * 3);
  const count = new Float32Array(n);
  const edge = new Float32Array(n);
  for (let t = 0; t < idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = vmap[idx[t + k]], b = vmap[idx[t + ((k + 1) % 3)]];
      for (const [p, q] of [[a, b], [b, a]]) {
        sum[p * 3] += pos[q * 3];
        sum[p * 3 + 1] += pos[q * 3 + 1];
        sum[p * 3 + 2] += pos[q * 3 + 2];
        count[p]++;
        edge[p] += Math.hypot(pos[q * 3] - pos[p * 3], pos[q * 3 + 1] - pos[p * 3 + 1], pos[q * 3 + 2] - pos[p * 3 + 2]);
      }
    }
  }
  const out = new Float32Array(vmap.length * 3);
  const g = (d: number, r: number) => Math.exp(-(d * d) / (r * r));
  for (let i = 0; i < vmap.length; i++) {
    const v = vmap[i];
    let shade = 1;
    if (count[v]) {
      const c = count[v];
      const dx = sum[v * 3] / c - pos[v * 3], dy = sum[v * 3 + 1] / c - pos[v * 3 + 1], dz = sum[v * 3 + 2] / c - pos[v * 3 + 2];
      // Positive where neighbours sit above the tangent plane, i.e. in a crease.
      const concave = (dx * nrm[v * 3] + dy * nrm[v * 3 + 1] + dz * nrm[v * 3 + 2]) / (edge[v] / c);
      shade = 1 - Math.min(0.42, Math.max(-0.06, concave * 1.5));
    }
    let r = shade, gr = shade, b = shade;
    if (face) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      if (z > face.frontZ) {
        const drop = face.eyeY - face.chinY;
        // Lips sit about 60% of the way from the eye line to the chin.
        const lip = g(y - (face.eyeY - drop * 0.62), drop * 0.085) * g(x, face.eyeDx * 0.95);
        r *= 1 - lip * 0.18;
        gr *= 1 - lip * 0.5;
        b *= 1 - lip * 0.46;
        const br = g(y - (face.eyeY + drop * 0.2), drop * 0.045) * g(Math.abs(x) - face.eyeDx * 1.05, face.eyeDx * 0.62) * 0.8;
        r = r * (1 - br) + brow[0] * br;
        gr = gr * (1 - br) + brow[1] * br;
        b = b * (1 - br) + brow[2] * br;
      }
    }
    out[i * 3] = r;
    out[i * 3 + 1] = gr;
    out[i * 3 + 2] = b;
  }
  return out;
}

/**
 * Morphable human body (MakeHuman CC0 base mesh). Pure TypeScript: no three.js or platform
 * imports, so the solver also runs in Node tests.
 *
 * Shape = base + sum(weight_i * target_i), then a uniform scale to the requested height.
 * Target weights are solved so tape-measure loops on the mesh hit the requested measurements.
 */
import type { BodyParams } from '@/types';

export interface HumanMeta {
  vertexCount: number;
  quant: number;
  leftSign: number;
  arrays: Record<string, { dtype: string; offset: number; length: number }>;
  joints: Record<string, number[]>;
  loops: Record<string, number[]>;
  measures: string[];
}

type Typed = Float32Array | Uint16Array | Uint32Array | Int16Array | Uint8Array;
const CTOR: Record<string, new (b: ArrayBuffer, o: number, l: number) => Typed> = {
  float32: Float32Array,
  uint16: Uint16Array,
  uint32: Uint32Array,
  int16: Int16Array,
  uint8: Uint8Array,
};

export type MeshSet = 'body' | 'tights' | 'skirt' | 'hair' | 'eyes';
export const PART = { torso: 0, head: 1, armL: 2, armR: 3, legL: 4, legR: 5 } as const;

export interface FittedBody {
  /** Vertex positions in metres, feet on y = 0, facing +z. Indexed by base vertex id. */
  positions: Float32Array;
  weights: Record<string, number>;
  scale: number;
  /** Measurements actually achieved, centimetres. */
  achieved: { height: number; chest: number; waist: number; hips: number; shoulders: number; inseam: number };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class HumanModel {
  readonly n: number;
  private targets = new Map<string, { i: Uint16Array; d: Int16Array }>();
  private crotchCandidates: number[] = [];

  constructor(
    readonly meta: HumanMeta,
    private buffer: ArrayBuffer,
  ) {
    this.n = meta.vertexCount;
    for (const key of Object.keys(meta.arrays)) {
      const m = /^t\.(.+)\.i$/.exec(key);
      if (m) this.targets.set(m[1], { i: this.array(key) as Uint16Array, d: this.array(`t.${m[1]}.d`) as Int16Array });
    }
    // Torso vertices on the sagittal plane, lower body: the crotch is the lowest of them.
    const base = this.array('base') as Float32Array;
    const parts = this.array('parts') as Uint8Array;
    const bodyVerts = new Set<number>(this.array('body.vmap') as Uint16Array);
    for (const v of bodyVerts) if (parts[v * 6] > 128 && Math.abs(base[v * 3]) < 0.004 && base[v * 3 + 1] < 0.2) this.crotchCandidates.push(v);
  }

  array(name: string): Typed {
    const a = this.meta.arrays[name];
    if (!a) throw new Error(`missing array ${name}`);
    return new CTOR[a.dtype](this.buffer, a.offset, a.length);
  }

  /** Unscaled morphed positions. */
  morph(weights: Record<string, number>): Float32Array {
    const out = new Float32Array(this.array('base') as Float32Array);
    const q = this.meta.quant;
    for (const [name, w] of Object.entries(weights)) {
      if (Math.abs(w) < 1e-4) continue;
      const t = this.targets.get(name);
      if (!t) throw new Error(`unknown target ${name}`);
      const k = w * q;
      for (let j = 0; j < t.i.length; j++) {
        const v = t.i[j] * 3;
        out[v] += t.d[j * 3] * k;
        out[v + 1] += t.d[j * 3 + 1] * k;
        out[v + 2] += t.d[j * 3 + 2] * k;
      }
    }
    return out;
  }

  /** Length of a vertex chain (closed loops list their first vertex again at the end). */
  chain(pos: Float32Array, loop: number[]): number {
    let sum = 0;
    for (let k = 1; k < loop.length; k++) {
      const a = loop[k - 1] * 3;
      const b = loop[k] * 3;
      sum += Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]);
    }
    return sum;
  }

  joint(pos: Float32Array, name: string): [number, number, number] {
    const ids = this.meta.joints[name];
    let x = 0, y = 0, z = 0;
    for (const v of ids) {
      x += pos[v * 3];
      y += pos[v * 3 + 1];
      z += pos[v * 3 + 2];
    }
    return [x / ids.length, y / ids.length, z / ids.length];
  }

  private raw(pos: Float32Array) {
    const body = this.array('body.vmap') as Uint16Array;
    let top = -Infinity;
    for (let k = 0; k < body.length; k++) top = Math.max(top, pos[body[k] * 3 + 1]);
    const ground = this.joint(pos, 'ground')[1];
    let crotch = Infinity;
    for (const v of this.crotchCandidates) crotch = Math.min(crotch, pos[v * 3 + 1]);
    const L = this.meta.loops;
    return {
      height: top - ground,
      ground,
      chest: this.chain(pos, L['bust-circ']),
      waist: this.chain(pos, L['waist-circ']),
      hips: this.chain(pos, L['hips-circ']),
      // Shoulder point to shoulder point across the back of the neck.
      shoulders: 2 * Math.abs(pos[L['shoulder-dist'][1] * 3]),
      inseam: crotch - ground,
    };
  }

  private macro(gender: number, weight: number): Record<string, number> {
    const w: Record<string, number> = {};
    for (const [g, k] of [['f', 1 - gender], ['m', gender]] as const) {
      w[`macro-${g}-min`] = k * Math.max(0, -weight);
      w[`macro-${g}-avg`] = k * (1 - Math.abs(weight));
      w[`macro-${g}-max`] = k * Math.max(0, weight);
    }
    return w;
  }

  private expand(x: Record<string, number>): Record<string, number> {
    const w: Record<string, number> = {};
    for (const [m, v] of Object.entries(x)) {
      w[`${m}-incr`] = Math.max(0, v);
      w[`${m}-decr`] = Math.max(0, -v);
    }
    return w;
  }

  /**
   * Solves morph weights for the requested measurements.
   * Body mass is set first from the waist-to-height ratio, then each tape measure is driven by
   * its own modifier with Gauss-Seidel sweeps of a secant step (the response is near linear).
   */
  fit(p: BodyParams): FittedBody {
    const gender = p.gender ?? 0.5;
    const target = { chest: p.chest / 100, waist: p.waist / 100, hips: p.hips / 100, shoulders: p.shoulders / 100, inseam: p.inseam / 100 };
    const H = p.height / 100;
    const mass = clamp((p.waist / p.height - (0.44 + 0.03 * gender)) / 0.17, -1, 1);
    const macro = this.macro(gender, mass);
    const x: Record<string, number> = { 'shoulder-dist': 0, 'bust-circ': 0, 'underbust-circ': 0, 'waist-circ': 0, 'hips-circ': 0, 'thigh-circ': 0, 'upperleg-height': 0, 'lowerleg-height': 0 };
    const drive: [keyof typeof target, string[]][] = [
      ['inseam', ['upperleg-height', 'lowerleg-height']],
      ['shoulders', ['shoulder-dist']],
      ['chest', ['bust-circ', 'underbust-circ']],
      ['waist', ['waist-circ']],
      ['hips', ['hips-circ', 'thigh-circ']],
    ];
    const evaluate = () => {
      const pos = this.morph({ ...macro, ...this.expand(x) });
      const r = this.raw(pos);
      const s = H / r.height;
      return { pos, r, s, v: { chest: r.chest * s, waist: r.waist * s, hips: r.hips * s, shoulders: r.shoulders * s, inseam: r.inseam * s } };
    };
    const LIMIT = 1.6;
    for (let sweep = 0; sweep < 3; sweep++) {
      for (const [key, mods] of drive) {
        const v0 = evaluate().v[key];
        const x0 = x[mods[0]];
        const step = x0 > 0.8 ? -0.4 : 0.4;
        for (const m of mods) x[m] = x0 + step;
        const v1 = evaluate().v[key];
        const slope = (v1 - v0) / step;
        const next = Math.abs(slope) < 1e-6 ? x0 : clamp(x0 + (target[key] - v0) / slope, -LIMIT, LIMIT);
        // Secondary modifiers (underbust, thigh) follow at reduced strength to keep the shape natural.
        mods.forEach((m, k) => (x[m] = k === 0 ? next : next * 0.6));
      }
    }
    const { pos, r, s, v } = evaluate();
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] *= s;
      pos[i + 1] = (pos[i + 1] - r.ground) * s;
      pos[i + 2] *= s;
    }
    const cm = (m: number) => Math.round(m * 1000) / 10;
    return {
      positions: pos,
      weights: { ...macro, ...this.expand(x) },
      scale: s,
      achieved: { height: p.height, chest: cm(v.chest), waist: cm(v.waist), hips: cm(v.hips), shoulders: cm(v.shoulders), inseam: cm(v.inseam) },
    };
  }

  /** Smooth per-base-vertex normals for one mesh set (shared across UV seams). */
  normals(pos: Float32Array, set: MeshSet): Float32Array {
    const vmap = this.array(`${set}.vmap`) as Uint16Array;
    const idx = this.array(`${set}.idx`);
    const acc = new Float32Array(this.n * 3);
    for (let t = 0; t < idx.length; t += 3) {
      const a = vmap[idx[t]] * 3, b = vmap[idx[t + 1]] * 3, c = vmap[idx[t + 2]] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) {
        acc[k] += nx;
        acc[k + 1] += ny;
        acc[k + 2] += nz;
      }
    }
    for (let i = 0; i < acc.length; i += 3) {
      const l = Math.hypot(acc[i], acc[i + 1], acc[i + 2]) || 1;
      acc[i] /= l;
      acc[i + 1] /= l;
      acc[i + 2] /= l;
    }
    return acc;
  }
}

/**
 * Drapes a scanned garment on a fitted body.
 *
 * The body mesh is sliced into polar cross-sections (trunk by height, each leg by height, each
 * arm along its axis). Cloth is lofted over those sections: every ring is the body's section
 * widened so its frontal half-width equals the photographed silhouette's at that height, and
 * relaxed toward an ellipse where the garment stands off the body. Texture coordinates point
 * into the matted photo, whose alpha trims neckline, hem and straps; the front view therefore
 * reproduces the photographed piece. The back uses the neck-filled half of the atlas.
 */
import * as THREE from 'three';

import type { GarmentScan, Limb } from '@/vision/garment';
import { SAMPLES } from '@/vision/garment';
import { FittedBody, HumanModel, PART } from './model';

export const NT = 72;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const COS = Array.from({ length: NT }, (_, j) => Math.cos((j / NT) * Math.PI * 2));
const SIN = Array.from({ length: NT }, (_, j) => Math.sin((j / NT) * Math.PI * 2));

/** Stack of polar cross-sections along one axis coordinate. */
export class Polar {
  readonly rings: number;
  /** Section centre (a, b) per ring. */
  readonly ca: Float32Array;
  readonly cb: Float32Array;
  readonly r: Float32Array;
  /** Half extents along a (frontal) and b (depth) per ring. */
  readonly ha: Float32Array;
  readonly hb: Float32Array;

  constructor(
    readonly t0: number,
    readonly t1: number,
    readonly step: number,
  ) {
    this.rings = Math.max(2, Math.round((t1 - t0) / step) + 1);
    this.ca = new Float32Array(this.rings);
    this.cb = new Float32Array(this.rings);
    this.r = new Float32Array(this.rings * NT);
    this.ha = new Float32Array(this.rings);
    this.hb = new Float32Array(this.rings);
  }

  /**
   * Fills the sections from triangles given in (t, a, b) coordinates.
   * Each ring: intersect triangles with the plane t = const, then cast NT rays from the
   * section centre and keep the farthest hit (outer hull).
   */
  build(coords: Float32Array, tris: ArrayLike<number>, convex = false): this {
    const segs: number[][] = Array.from({ length: this.rings }, () => []);
    for (let k = 0; k < tris.length; k += 3) {
      const i0 = tris[k] * 3, i1 = tris[k + 1] * 3, i2 = tris[k + 2] * 3;
      const lo = Math.min(coords[i0], coords[i1], coords[i2]);
      const hi = Math.max(coords[i0], coords[i1], coords[i2]);
      const r0 = Math.max(0, Math.ceil((lo - this.t0) / this.step));
      const r1 = Math.min(this.rings - 1, Math.floor((hi - this.t0) / this.step));
      for (let ring = r0; ring <= r1; ring++) {
        const t = this.t0 + ring * this.step;
        const pts: number[] = [];
        for (const [p, q] of [[i0, i1], [i1, i2], [i2, i0]]) {
          const tp = coords[p], tq = coords[q];
          if ((tp - t) * (tq - t) > 0 || tp === tq) continue;
          const u = (t - tp) / (tq - tp);
          pts.push(coords[p + 1] + (coords[q + 1] - coords[p + 1]) * u, coords[p + 2] + (coords[q + 2] - coords[p + 2]) * u);
        }
        if (pts.length >= 4) segs[ring].push(pts[0], pts[1], pts[2], pts[3]);
      }
    }
    const valid = new Uint8Array(this.rings);
    for (let ring = 0; ring < this.rings; ring++) {
      const s = segs[ring];
      if (s.length < 12) continue;
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (let i = 0; i < s.length; i += 2) {
        amin = Math.min(amin, s[i]);
        amax = Math.max(amax, s[i]);
        bmin = Math.min(bmin, s[i + 1]);
        bmax = Math.max(bmax, s[i + 1]);
      }
      const c = [(amin + amax) / 2, (bmin + bmax) / 2];
      this.ca[ring] = c[0];
      this.cb[ring] = c[1];
      const row = ring * NT;
      let hits = 0, sum = 0;
      for (let j = 0; j < NT; j++) {
        const dx = COS[j], dy = SIN[j];
        let best = 0;
        for (let i = 0; i < s.length; i += 4) {
          // Ray c + r*(dx,dy) against segment p + u*(q - p).
          const px = s[i] - c[0], py = s[i + 1] - c[1];
          const ex = s[i + 2] - s[i], ey = s[i + 3] - s[i + 1];
          const den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-12) continue;
          const r = (px * ey - py * ex) / den;
          const u = (px * dy - py * dx) / den;
          if (r > best && u >= -1e-4 && u <= 1.0001) best = r;
        }
        this.r[row + j] = best;
        if (best > 0) (hits++, (sum += best));
      }
      if (hits < NT * 0.5) continue;
      // Open sections (half a pelvis, a shoulder stub): close the gap with neighbouring radii.
      const mean = sum / hits;
      for (let j = 0; j < NT; j++) {
        if (this.r[row + j] > 0) continue;
        let a = 1, b = 1;
        while (a < NT && !this.r[row + ((j - a + NT) % NT)]) a++;
        while (b < NT && !this.r[row + ((j + b) % NT)]) b++;
        const ra = this.r[row + ((j - a + NT) % NT)] || mean, rb = this.r[row + ((j + b) % NT)] || mean;
        this.r[row + j] = -((ra * b + rb * a) / (a + b));
      }
      for (let j = 0; j < NT; j++) this.r[row + j] = Math.abs(this.r[row + j]);
      if (convex) this.hull(row);
      valid[ring] = 1;
    }
    // Rings without a usable section copy the nearest valid one.
    for (let ring = 0; ring < this.rings; ring++) {
      if (valid[ring]) continue;
      let d = 1;
      while (d < this.rings && !valid[ring - d] && !valid[ring + d]) d++;
      const src = valid[ring - d] ? ring - d : valid[ring + d] ? ring + d : -1;
      if (src < 0) continue;
      this.r.copyWithin(ring * NT, src * NT, src * NT + NT);
      this.ca[ring] = this.ca[src];
      this.cb[ring] = this.cb[src];
    }
    // Smoothing along the axis and around the ring.
    for (let pass = 0; pass < (convex ? 3 : 1); pass++) {
    const copy = this.r.slice();
    for (let ring = 0; ring < this.rings; ring++) {
      const up = Math.min(this.rings - 1, ring + 1), dn = Math.max(0, ring - 1);
      for (let j = 0; j < NT; j++) {
        const l = (j + NT - 1) % NT, rj = (j + 1) % NT;
        this.r[ring * NT + j] = (copy[ring * NT + j] * 4 + copy[up * NT + j] + copy[dn * NT + j] + copy[ring * NT + l] + copy[ring * NT + rj]) / 8;
      }
    }
    }
    for (let ring = 0; ring < this.rings; ring++) {
      let ha = 0, hb = 0;
      for (let j = 0; j < NT; j++) {
        ha = Math.max(ha, Math.abs(this.r[ring * NT + j] * COS[j]));
        hb = Math.max(hb, Math.abs(this.r[ring * NT + j] * SIN[j]));
      }
      this.ha[ring] = ha;
      this.hb[ring] = hb;
    }
    return this;
  }

  /**
   * Replaces one section by its convex hull. Hanging cloth spans concavities (between the
   * thighs, across the small of the back) instead of following them.
   */
  private hull(row: number) {
    const pts: [number, number][] = [];
    for (let j = 0; j < NT; j++) pts.push([this.r[row + j] * COS[j], this.r[row + j] * SIN[j]]);
    // Points are already in angular order; a single pass with back-tracking gives the hull.
    const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    let start = 0;
    for (let j = 1; j < NT; j++) if (pts[j][0] > pts[start][0]) start = j;
    const h: [number, number][] = [];
    for (let k = 0; k <= NT; k++) {
      const p = pts[(start + k) % NT];
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    for (let j = 0; j < NT; j++) {
      const dx = COS[j], dy = SIN[j];
      let best = this.r[row + j];
      for (let i = 0; i + 1 < h.length; i++) {
        const ex = h[i + 1][0] - h[i][0], ey = h[i + 1][1] - h[i][1];
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const r = (h[i][0] * ey - h[i][1] * ex) / den;
        const u = (h[i][0] * dy - h[i][1] * dx) / den;
        if (u >= -1e-6 && u <= 1.000001 && r > best) best = r;
      }
      this.r[row + j] = best;
    }
  }

  /** Blends another stack with identical layout into this one; `w(t)` is the other's share. */
  mix(other: Polar, w: (t: number) => number): this {
    for (let ring = 0; ring < this.rings; ring++) {
      const k = w(this.t0 + ring * this.step);
      if (k <= 0) continue;
      let ha = 0, hb = 0;
      for (let j = 0; j < NT; j++) {
        // Both stacks are expressed about this stack's centre.
        const ox = other.ca[ring] + other.r[ring * NT + j] * COS[j] - this.ca[ring], oz = other.cb[ring] + other.r[ring * NT + j] * SIN[j] - this.cb[ring];
        const r = this.r[ring * NT + j] * (1 - k) + Math.hypot(ox, oz) * k;
        this.r[ring * NT + j] = r;
        ha = Math.max(ha, Math.abs(r * COS[j]));
        hb = Math.max(hb, Math.abs(r * SIN[j]));
      }
      this.ha[ring] = ha;
      this.hb[ring] = hb;
    }
    return this;
  }

  private pos(t: number): [number, number, number] {
    const f = clamp((t - this.t0) / this.step, 0, this.rings - 1);
    const i = Math.min(this.rings - 2, Math.floor(f));
    return [i, i + 1, f - i];
  }
  private lerp(arr: Float32Array, t: number) {
    const [i, j, w] = this.pos(t);
    return arr[i] + (arr[j] - arr[i]) * w;
  }
  radius(t: number, j: number) {
    const [i, k, w] = this.pos(t);
    return this.r[i * NT + j] + (this.r[k * NT + j] - this.r[i * NT + j]) * w;
  }
  /** Frontal half-width. */
  half(t: number) {
    return Math.max(0.01, this.lerp(this.ha, t));
  }
  depthHalf(t: number) {
    return Math.max(0.01, this.lerp(this.hb, t));
  }
  centreA(t: number) {
    return this.lerp(this.ca, t);
  }
  centreB(t: number) {
    return this.lerp(this.cb, t);
  }
}

interface ArmFrame {
  origin: THREE.Vector3;
  /** Along the arm, across it in the frontal plane, and front-to-back. */
  d: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  length: number;
  polar: Polar;
}

export interface BodyFrame {
  H: number;
  waistY: number;
  hipY: number;
  bustY: number;
  crotchY: number;
  shoulderY: number;
  armpitY: number;
  neckY: number;
  /** Trunk hull by height: torso above the crotch, both thighs together below it. */
  trunk: Polar;
  legs: Record<-1 | 1, Polar>;
  arms: Record<-1 | 1, ArmFrame>;
  /** Each foot sliced along its length: axis coordinate is z, section plane is (x, y). */
  feet: Record<-1 | 1, Polar>;
}

const sideName = (model: HumanModel, sgn: number) => (sgn * model.meta.leftSign > 0 ? 'l' : 'r');

export function bodyFrame(model: HumanModel, fit: FittedBody): BodyFrame {
  const pos = fit.positions;
  const parts = model.array('parts') as Uint8Array;
  const vmap = model.array('body.vmap') as Uint16Array;
  const idx = model.array('body.idx');
  const L = model.meta.loops;
  const meanY = (loop: number[]) => loop.reduce((s, v) => s + pos[v * 3 + 1], 0) / loop.length;
  const H = fit.achieved.height / 100;
  const crotchY = fit.achieved.inseam / 100;
  const shoulderY = pos[L['shoulder-dist'][1] * 3 + 1];
  const neckY = model.joint(pos, 'neck')[1];
  const STEP = 0.012;
  const capX = Math.abs(model.joint(pos, 'l-shoulder')[0]) + 0.05;

  // Triangles on base-vertex ids, classified by body part.
  const arm = (v: number) => parts[v * 6 + PART.armL] + parts[v * 6 + PART.armR];
  const trunkTris: number[] = [];
  const capTris: number[] = [];
  const legTris: Record<number, number[]> = { [-1]: [], 1: [] };
  const armTris: Record<number, number[]> = { [-1]: [], 1: [] };
  const armPart = (sgn: number) => (sgn * model.meta.leftSign > 0 ? PART.armL : PART.armR);
  for (let k = 0; k < idx.length; k += 3) {
    const a = vmap[idx[k]], b = vmap[idx[k + 1]], c = vmap[idx[k + 2]];
    const armW = Math.max(arm(a), arm(b), arm(c));
    // Shoulder caps: arm triangles inboard of the shoulder points, above the armpits.
    const cap = Math.max(Math.abs(pos[a * 3]), Math.abs(pos[b * 3]), Math.abs(pos[c * 3])) < capX && Math.min(pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1]) > shoulderY - 0.1 * H;
    if (armW < 110 || cap) capTris.push(a, b, c);
    if (armW < 110) {
      trunkTris.push(a, b, c);
      const xs = pos[a * 3] + pos[b * 3] + pos[c * 3];
      if (Math.max(pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1]) < crotchY + 0.1) legTris[xs >= 0 ? 1 : -1].push(a, b, c);
    }
    for (const sgn of [-1, 1]) {
      const p = armPart(sgn);
      if (Math.max(parts[a * 6 + p], parts[b * 6 + p], parts[c * 6 + p]) > 70) armTris[sgn].push(a, b, c);
    }
  }
  // (t, a, b) = (y, x, z) for vertical parts.
  const yxz = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) (yxz[i] = pos[i + 1]), (yxz[i + 1] = pos[i]), (yxz[i + 2] = pos[i + 2]);

  // Trunk without arms, faded into the trunk-with-shoulder-caps hull between armpit and shoulder
  // so the section changes gradually (a sudden change would crease the cloth).
  const armpit = shoulderY - 0.072 * H;
  const trunk = new Polar(0.03, neckY + 0.05, STEP)
    .build(yxz, trunkTris, true)
    .mix(new Polar(0.03, neckY + 0.05, STEP).build(yxz, capTris, true), (y) => smoothstep(armpit - 0.01, shoulderY - 0.025, y));
  const legs = {} as BodyFrame['legs'];
  const arms = {} as BodyFrame['arms'];
  const feet = {} as BodyFrame['feet'];
  const zxy = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) (zxy[i] = pos[i + 2]), (zxy[i + 1] = pos[i]), (zxy[i + 2] = pos[i + 1]);
  for (const sgn of [-1, 1] as const) {
    legs[sgn] = new Polar(0.03, crotchY + 0.06, STEP).build(yxz, legTris[sgn]);
    {
      const tris: number[] = [];
      let z0 = Infinity, z1 = -Infinity;
      const lt = legTris[sgn];
      for (let k = 0; k < lt.length; k += 3) {
        if (Math.max(pos[lt[k] * 3 + 1], pos[lt[k + 1] * 3 + 1], pos[lt[k + 2] * 3 + 1]) > 0.07 * H) continue;
        tris.push(lt[k], lt[k + 1], lt[k + 2]);
        for (let c = 0; c < 3; c++) (z0 = Math.min(z0, pos[lt[k + c] * 3 + 2])), (z1 = Math.max(z1, pos[lt[k + c] * 3 + 2]));
      }
      feet[sgn] = new Polar(z0 + 0.004, z1 - 0.004, 0.008).build(zxy, tris, true);
    }
    const s = sideName(model, sgn);
    const origin = new THREE.Vector3(...model.joint(pos, `${s}-shoulder`));
    const wrist = new THREE.Vector3(...model.joint(pos, `${s}-hand`));
    const d = wrist.clone().sub(origin);
    const length = d.length();
    d.normalize();
    // Across-arm direction in the frontal plane; matches the image-space convention of Limb.
    const u = new THREE.Vector3(d.y, -d.x, 0).normalize();
    const v = new THREE.Vector3().crossVectors(d, u).normalize();
    const local = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i] - origin.x, y = pos[i + 1] - origin.y, z = pos[i + 2] - origin.z;
      local[i] = x * d.x + y * d.y + z * d.z;
      local[i + 1] = x * u.x + y * u.y + z * u.z;
      local[i + 2] = x * v.x + y * v.y + z * v.z;
    }
    arms[sgn] = { origin, d, u, v, length, polar: new Polar(-0.075, length, STEP).build(local, armTris[sgn]) };
  }
  const bustY = meanY(L['bust-circ']);
  return { H, waistY: meanY(L['waist-circ']), hipY: meanY(L['hips-circ']), bustY, crotchY, shoulderY, armpitY: shoulderY - 0.072 * H, neckY, trunk, legs, arms, feet };
}

/**
 * Space claimed by garments already on the body: per body part, height and direction, the
 * radius of the outermost cloth so far. Outer layers are pushed beyond it.
 */
export class Occupancy {
  private maps = new Map<string, Float32Array>();
  private static bin(y: number) {
    return clamp(Math.round(y * 80), 0, 191);
  }
  note(part: string, y: number, j: number, r: number) {
    let m = this.maps.get(part);
    if (!m) this.maps.set(part, (m = new Float32Array(192 * NT)));
    const i = Occupancy.bin(y) * NT + j;
    if (r > m[i]) m[i] = r;
  }
  radius(part: string, y: number, j: number): number {
    return this.maps.get(part)?.[Occupancy.bin(y) * NT + j] ?? 0;
  }
  absorb(o: Occupancy) {
    for (const [part, m] of o.maps) {
      let mine = this.maps.get(part);
      if (!mine) this.maps.set(part, (mine = new Float32Array(192 * NT)));
      for (let i = 0; i < m.length; i++) if (m[i] > mine[i]) mine[i] = m[i];
    }
  }
}

export interface ClothOptions {
  /** Garments already worn underneath; this one is kept outside them. */
  under?: Occupancy;
  /** Clearance from the skin, metres. Larger for outer layers. */
  layer: number;
  /** User size adjustment; 1 = scaled to fit the wearer's chest or waist. */
  size: number;
  /** Skin-tight base layer: follows the body exactly and claims no space. */
  tight?: boolean;
}

const row = (arr: number[], py: number) => {
  const f = clamp(py, 0, arr.length - 1);
  const i = Math.floor(f);
  const j = Math.min(arr.length - 1, i + 1);
  return arr[i] + (arr[j] - arr[i]) * (f - i);
};
const station = (arr: number[], t: number) => row(arr, clamp(t, 0, 1) * SAMPLES - 0.5);

/** Frontal width of a body is narrower than half its girth; flat-laid garments show the latter. */
const FLAT_RATIO = 0.7;
/** Upper bound on how far cloth may stand off the body, as a multiple of the body's half-width. */
const MAX_WIDEN = 2.6;

export interface Cloth {
  front: THREE.BufferGeometry;
  back: THREE.BufferGeometry;
  occupied: Occupancy;
}

export function buildCloth(frame: BodyFrame, scan: GarmentScan, { layer, size, under, tight }: ClothOptions): Cloth {
  const occupied = new Occupancy();
  const ease = 0.004 + layer;
  const lower = scan.kind === 'trousers' || scan.kind === 'skirt';
  const lastRow = scan.height - 1;
  const { trunk } = frame;

  // ---- scale: pixels to metres ----------------------------------------------------------
  let anchorBody: number, k: number;
  const anchorRow = scan.anchorY;
  if (lower) {
    // Place the waistband so the crotch (trousers) lines up, then scale by waistband width.
    let top = frame.waistY;
    k = 1;
    for (let it = 0; it < 3; it++) {
      k = ((trunk.half(top) + ease) / scan.fitHalf) * size;
      if (scan.kind === 'trousers') top = clamp(frame.crotchY + 0.012 + (scan.crotchY - scan.anchorY) * k * (scan.flat ? 1 / FLAT_RATIO : 1), frame.hipY, frame.waistY + 0.08);
    }
    anchorBody = top;
  } else {
    k = ((trunk.half(frame.bustY) + ease) / scan.fitHalf) * size;
    anchorBody = frame.shoulderY + 0.012;
  }
  const kLen = scan.flat ? k / FLAT_RATIO : k;
  const hasArmpit = !lower && scan.armpitY > anchorRow + 4;
  const armpitBody = frame.armpitY;
  /** Photo row for a body height. */
  const rowOf = (y: number): number => {
    if (scan.kind === 'trousers') return scan.crotchY + (frame.crotchY + 0.012 - y) / kLen;
    if (hasArmpit) {
      if (y >= armpitBody) return scan.armpitY - ((y - armpitBody) / (anchorBody - armpitBody)) * (scan.armpitY - anchorRow);
      return scan.armpitY + (armpitBody - y) / kLen;
    }
    return anchorRow + (anchorBody - y) / kLen;
  };
  const heightOf = (py: number): number => {
    if (scan.kind === 'trousers') return frame.crotchY + 0.012 - (py - scan.crotchY) * kLen;
    if (hasArmpit) return py <= scan.armpitY ? armpitBody + ((scan.armpitY - py) / (scan.armpitY - anchorRow)) * (anchorBody - armpitBody) : armpitBody - (py - scan.armpitY) * kLen;
    return anchorBody - (py - anchorRow) * kLen;
  };
  const hemY = Math.max(0.035, heightOf(lastRow));
  const topY = Math.min(heightOf(0) + 0.006, frame.neckY + 0.04);

  // ---- mesh accumulation ----------------------------------------------------------------
  const P: number[] = [];
  const UV: number[] = [];
  const tris: number[] = [];
  const seams: [number, number][] = [];
  /** Adds a grid of `rings` x (NT + 1) vertices produced by `at(ring, j)`. */
  const grid = (rings: number, at: (i: number, j: number) => [number, number, number, number, number]) => {
    const base = P.length / 3;
    for (let i = 0; i < rings; i++)
      for (let j = 0; j <= NT; j++) {
        const [x, y, z, px, py] = at(i, j % NT);
        P.push(x, y, z);
        UV.push(px / scan.width, 1 - py / scan.height);
        if (j === NT) seams.push([base + i * (NT + 1), base + i * (NT + 1) + NT]);
      }
    for (let i = 0; i < rings - 1; i++)
      for (let j = 0; j < NT; j++) {
        const a = base + i * (NT + 1) + j, b = a + NT + 1;
        tris.push(a, b, a + 1, a + 1, b, b + 1);
      }
  };
  const levels = (lo: number, hi: number, step = 0.009) => {
    const n = Math.max(2, Math.ceil((hi - lo) / step) + 1);
    return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
  };

  /**
   * One cloth ring around a vertical body part: the body section, widened to the garment's
   * half-width `gh * k`, relaxed toward an ellipse as it stands further off the body.
   */
  const capFrom = frame.armpitY - 0.01;
  const ring = (key: string, polar: Polar, y: number, py: number, lo: number, hi: number, shrink = 1, claim = true) => {
    const gh = Math.max(1, (hi - lo) / 2);
    const gc = (hi + lo) / 2;
    const bh = polar.half(y);
    const ch = tight ? bh + ease : clamp(gh * k, bh + ease, bh * MAX_WIDEN);
    const inside = py >= 0 && py <= lastRow;
    const f = ch / bh;
    const fz = 1 + (f - 1) * 0.8;
    const dh = polar.depthHalf(y) * fz + ease * 0.5;
    const relax = smoothstep(1.06, 1.45, f) * 0.9;
    const ca = polar.centreA(y), cb = polar.centreB(y);
    return (j: number): [number, number, number, number, number] => {
      const r = polar.radius(y, j) + ease * 0.6;
      const ex = COS[j] / ch, ez = SIN[j] / dh;
      const re = 1 / Math.sqrt(ex * ex + ez * ez);
      let ax = r * COS[j] * f * (1 - relax) + re * COS[j] * relax;
      let az = r * SIN[j] * fz * (1 - relax) + re * SIN[j] * relax;
      // Never inside the body, nor inside a garment already worn here.
      const want = Math.max(r, under && inside ? under.radius(key, y, j) + 0.0025 : 0);
      const have = Math.hypot(ax, az);
      if (have < want) (ax *= want / have), (az *= want / have);
      const out = Math.max(have, want);
      if (inside && claim && !tight) {
        occupied.note(key, y, j, out * shrink);
        // Leg tubes also claim space in the trunk hull's frame, for skirts and coats over them.
        if (key !== 'trunk') {
          const tx = ca + ax - trunk.centreA(y), tz = cb + az - trunk.centreB(y);
          const tj = Math.round((Math.atan2(tz, tx) / (Math.PI * 2)) * NT + NT) % NT;
          const tr = Math.hypot(tx, tz);
          for (const d of [-1, 0, 1]) occupied.note('trunk', y, (tj + d + NT) % NT, tr);
        }
      }
      // Below the armpits the lookup is held inside the band so side seams stay closed. Above
      // them it runs free: shoulder caps beyond the band read the photo's own shoulder line.
      const u = (ax / ch) * 0.985;
      // Over the tops of the shoulders the surface is nearly horizontal, so the garment's top
      // edge would cut it raggedly between rings. Outside the neckline the piece covers up to
      // its top ring; only the neckline is trimmed by the photo's outline.
      const pyc = !lower && Math.abs(u) > 0.45 ? Math.max(py, anchorRow + 2) : py;
      return [ca + ax * shrink, y, cb + az * shrink, gc + (lower || y < capFrom ? clamp(u, -0.95, 0.95) : u) * gh, pyc];
    };
  };

  if (scan.kind === 'trousers') {
    // Seat: trunk hull from the waistband down, closing in a dome under the crotch.
    const bottom = frame.crotchY - 0.03;
    const ys = levels(bottom, anchorBody + 0.012);
    const rings = ys.map((y) => {
      const py = rowOf(y);
      const dome = Math.sqrt(clamp((y - bottom) / 0.05, 0.0004, 1));
      return ring('trunk', trunk, y, Math.min(py, scan.crotchY + 2), row(scan.left, py), row(scan.right, py), dome);
    });
    grid(ys.length, (i, j) => rings[i](j));
    for (const sgn of [-1, 1] as const) {
      const leg = scan.legs[sgn < 0 ? 0 : 1];
      const ly = levels(hemY, frame.crotchY + 0.045);
      const lr = ly.map((y) => {
        const py = rowOf(y);
        return ring(`leg${sgn}`, frame.legs[sgn], y, py, row(leg.left, py), row(leg.right, py));
      });
      grid(ly.length, (i, j) => lr[i](j));
    }
  } else {
    const ys = levels(hemY, lower ? anchorBody + 0.012 : topY);
    const rings = ys.map((y) => {
      const py = rowOf(y);
      return ring('trunk', trunk, y, py, row(scan.left, py), row(scan.right, py));
    });
    grid(ys.length, (i, j) => rings[i](j));

    // Sleeves: tubes along each arm, from inside the shoulder to the cuff.
    for (const sgn of [-1, 1] as const) {
      const sl: Limb | undefined = scan.sleeves.find((s) => (s.origin[0] - scan.cx) * sgn > 0);
      if (!sl) continue;
      const arm = frame.arms[sgn];
      const lenP = Math.hypot(sl.tip[0] - sl.origin[0], sl.tip[1] - sl.origin[1]);
      const cuff = Math.min(lenP * kLen, arm.length * 0.99);
      const dx = (sl.tip[0] - sl.origin[0]) / lenP, dy = (sl.tip[1] - sl.origin[1]) / lenP;
      const ts = levels(-0.025, cuff);
      grid(ts.length, (i, j) => {
        const t = ts[i];
        const tp = t / (lenP * kLen);
        // Sections this close to the joint cut through the chest; the sleeve head reuses the
        // first clean arm section instead.
        const ts2 = Math.max(t, 0.055);
        const bh = arm.polar.half(ts2);
        const gh = station(sl.half, tp);
        const ch = clamp(gh * k, bh + ease, bh * MAX_WIDEN);
        const f = ch / bh;
        const r = (arm.polar.radius(ts2, j) + ease * 0.6) * f;
        const a = arm.polar.centreA(ts2) + r * COS[j], b = arm.polar.centreB(ts2) + r * SIN[j];
        // Lookups stay well inside the photographed sleeve so its alpha never cuts holes; the
        // cuff edge comes from the geometry.
        const across = station(sl.centre, tp) + clamp((r * COS[j]) / ch, -0.72, 0.72) * gh;
        const tt = clamp(tp, 0.1, 0.96) * lenP;
        return [
          arm.origin.x + arm.d.x * t + arm.u.x * a + arm.v.x * b,
          arm.origin.y + arm.d.y * t + arm.u.y * a + arm.v.y * b,
          arm.origin.z + arm.d.z * t + arm.u.z * a + arm.v.z * b,
          sl.origin[0] + dx * tt - dy * across,
          sl.origin[1] + dy * tt + dx * across,
        ];
      });
    }
  }

  // ---- normals, then split into front and back halves of the atlas -----------------------
  const position = new Float32Array(P);
  const whole = new THREE.BufferGeometry();
  whole.setAttribute('position', new THREE.BufferAttribute(position, 3));
  whole.setIndex(tris);
  whole.computeVertexNormals();
  const normal = whole.attributes.normal.array as Float32Array;
  whole.dispose();
  for (const [a, b] of seams)
    for (let c = 0; c < 3; c++) {
      const n = normal[a * 3 + c] + normal[b * 3 + c];
      normal[a * 3 + c] = normal[b * 3 + c] = n;
    }
  for (let i = 0; i < normal.length; i += 3) {
    const l = Math.hypot(normal[i], normal[i + 1], normal[i + 2]) || 1;
    normal[i] /= l;
    normal[i + 1] /= l;
    normal[i + 2] /= l;
  }
  // Second UV set at thread scale (about 5 mm per tile) for the weave normal map.
  const thread = new Float32Array(UV.length);
  for (let i = 0; i < UV.length / 2; i++) {
    thread[i * 2] = (position[i * 3] + position[i * 3 + 2]) * 190;
    thread[i * 2 + 1] = position[i * 3 + 1] * 190;
  }
  const make = (isBack: boolean) => {
    const index: number[] = [];
    for (let t = 0; t < tris.length; t += 3) {
      const nz = normal[tris[t] * 3 + 2] + normal[tris[t + 1] * 3 + 2] + normal[tris[t + 2] * 3 + 2];
      if (nz < 0 === isBack) index.push(tris[t], tris[t + 1], tris[t + 2]);
    }
    const uv = new Float32Array(UV.length);
    for (let i = 0; i < UV.length; i += 2) {
      uv[i] = clamp(UV[i], 0.002, 0.998) * 0.5 + (isBack ? 0.5 : 0);
      uv[i + 1] = UV[i + 1];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('uv1', new THREE.BufferAttribute(thread, 2));
    g.setIndex(index);
    return g;
  };
  return { front: make(false), back: make(true), occupied };
}

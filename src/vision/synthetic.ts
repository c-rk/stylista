/**
 * Procedural garment silhouettes for pieces without a photo (starter wardrobe, colour-only
 * pieces, base layer). They are rasterised to a matte and pushed through the same scanner as
 * photos, so photo and non-photo garments share one draping path.
 */
import type { GarmentShape } from '@/types';
import { GarmentScan, ScanKind, scanGarment } from './garment';
import { resizeFloat } from './image';

type Pt = [number, number];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Anti-aliased even-odd fill of closed polygons into a float matte: four sub-scanlines per row,
 * each span adding its exact horizontal pixel coverage, so outline edges are smooth gradients.
 */
function fill(w: number, h: number, polys: Pt[][]): Float32Array {
  const a = new Float32Array(w * h);
  const SUB = 4;
  for (let y = 0; y < h; y++)
    for (let s = 0; s < SUB; s++) {
      const sy = y + (s + 0.5) / SUB;
      const xs: number[] = [];
      for (const poly of polys)
        for (let i = 0; i < poly.length; i++) {
          const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
          if (y0 <= sy !== y1 <= sy) xs.push(x0 + ((sy - y0) / (y1 - y0)) * (x1 - x0));
        }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const l = Math.max(0, xs[k]), r = Math.min(w, xs[k + 1]);
        if (r <= l) continue;
        const il = Math.floor(l), ir = Math.floor(r);
        if (il === ir) {
          a[y * w + il] += (r - l) / SUB;
          continue;
        }
        a[y * w + il] += (il + 1 - l) / SUB;
        for (let x = il + 1; x < ir && x < w; x++) a[y * w + x] += 1 / SUB;
        if (ir < w) a[y * w + ir] += (r - ir) / SUB;
      }
    }
  for (let i = 0; i < a.length; i++) a[i] = Math.min(1, a[i]);
  return a;
}

const mirror = (pts: Pt[], cx: number): Pt[] => [...pts, ...[...pts].reverse().map(([x, y]): Pt => [2 * cx - x, y])];

export type SyntheticKind = 'top' | 'outerwear' | 'dress' | 'trousers' | 'skirt' | 'briefs' | 'bra';

/**
 * Builds the matte in "worn, frontal" proportions: 1 unit is about 2.6 mm on a 170 cm body, with
 * a chest half-width of 60 px.
 */
function draw(kind: SyntheticKind, s: GarmentShape): { w: number; h: number; alpha: Float32Array; scanKind: ScanKind; crotchY?: number; sleeveless?: boolean } {
  const W = 520, cx = W / 2, M = 6;
  const hw = 60;
  if (kind === 'trousers' || kind === 'briefs') {
    const rise = 95;
    const leg = kind === 'briefs' ? 34 : lerp(46, 292, s.length);
    const hem = kind === 'briefs' ? 27 : lerp(13, 36, s.fit) + (1 - s.length) * 14;
    const footX = kind === 'briefs' ? 36 : lerp(40, 27, s.length);
    const h = Math.round(rise + leg) + M * 2;
    const left: Pt[] = [[cx - 50, M], [cx - 64, M + 68], [cx - footX - hem, M + rise + leg], [cx - footX + hem, M + rise + leg], [cx - 1.5, M + rise - (kind === 'briefs' ? 0 : 4)]];
    return { w: W, h, alpha: fill(W, h, [mirror(left, cx)]), scanKind: 'trousers', crotchY: M + rise };
  }
  if (kind === 'skirt') {
    const len = lerp(105, 370, s.length);
    const h = Math.round(len) + M * 2;
    const left: Pt[] = [[cx - 48, M], [cx - 64, M + 72], [cx - 66 - s.flare * len * 0.32, M + len]];
    return { w: W, h, alpha: fill(W, h, [mirror(left, cx)]), scanKind: 'skirt' };
  }
  if (kind === 'bra') {
    // Fitted sleeveless top with a shallow neckline, long enough to meet the shorts.
    const h = 150 + M * 2;
    // Level shoulder line: the armhole is then a clean vertical cut at the shoulder point.
    const left: Pt[] = [[cx - 22, M + 2], [cx - hw - 4, M + 2], [cx - hw - 1, M + 64], [cx - 54, M + 146]];
    const scoop: Pt[] = Array.from({ length: 9 }, (_, i): Pt => [cx - 22 + (44 * i) / 8, M + 2 + Math.sin((i / 8) * Math.PI) * 13]).reverse();
    return { w: W, h, alpha: fill(W, h, [[...mirror(left, cx), ...scoop]]), scanKind: 'top', sleeveless: true };
  }
  // Tops, jackets, dresses.
  const coat = kind === 'outerwear';
  const dress = kind === 'dress';
  const loose = hw * (1 + s.fit * 0.3) + (coat ? 6 : 0);
  const len = dress ? lerp(250, 525, s.length) : coat ? lerp(150, 395, s.length) : lerp(118, 262, s.length);
  const hemHalf = loose + (dress ? s.flare * Math.max(0, len - 150) * 0.36 : s.fit * 8);
  const h = Math.round(len) + M * 2;
  const armpit = 64;
  let sleeveBottom = 0;
  const body: Pt[] = [[cx - 23, M + 2], [cx - hw - 10, M + 15]];
  if (s.sleeve > 0.03) {
    const L = lerp(34, 214, s.sleeve), wide = 23 + s.fit * 9 + (coat ? 4 : 0), cuff = lerp(wide, 15 + s.fit * 8, s.sleeve);
    // Sleeve held 48 degrees off vertical, clear of the side seam, so the scanner separates it.
    const dx = -Math.sin(0.84), dy = Math.cos(0.84);
    sleeveBottom = M + 34 + dy * L + cuff + 4;
    const sx = cx - hw - 12, sy = M + 34;
    // Upper (outer) cuff corner first, then the lower one, to keep the outline simple.
    body.push([sx + dx * L - dy * cuff, sy + dy * L + dx * cuff], [sx + dx * L + dy * cuff, sy + dy * L - dx * cuff]);
  }
  body.push([cx - loose, M + armpit], [cx - lerp(loose, loose * 0.92, dress ? 1 - s.fit : 0), M + 150], [cx - hemHalf, M + len]);
  const outer = mirror(body, cx);
  const dip = coat ? 30 : 17;
  const scoop: Pt[] = Array.from({ length: 9 }, (_, i): Pt => [cx - 23 + (46 * i) / 8, M + 2 + Math.sin((i / 8) * Math.PI) * dip]).reverse();
  const H2 = Math.round(Math.max(h, sleeveBottom + M));
  return { w: W, h: H2, alpha: fill(W, H2, [[...outer, ...scoop]]), scanKind: dress ? 'dress' : 'top', sleeveless: s.sleeve <= 0.03 };
}

export interface SyntheticGarment {
  scan: GarmentScan;
  /** White RGBA atlas (front | back); tint it with the fabric colour. */
  atlas: Uint8Array;
  width: number;
  height: number;
}

const cache = new Map<string, SyntheticGarment>();

export function syntheticGarment(kind: SyntheticKind, shape: GarmentShape): SyntheticGarment {
  const q = (v: number) => Math.round(v * 40) / 40;
  const key = `${kind}|${q(shape.sleeve)}|${q(shape.length)}|${q(shape.fit)}|${q(shape.flare)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const d = draw(kind, shape);
  // Upsample the matte so outline edges are smooth curves rather than pixel steps.
  const UP = 2;
  const w = d.w * UP, h = d.h * UP;
  const alpha = resizeFloat(d.alpha, d.w, d.h, w, h);
  const { scanKind, sleeveless } = d;
  const crotchY = d.crotchY === undefined ? undefined : d.crotchY * UP;
  const white = new Uint8Array(w * h * 3).fill(255);
  // (Transparent texels are white too, so edge filtering never darkens the outline.)
  const res = scanGarment({ width: w, height: h, channels: 3, data: white }, alpha, scanKind, { crotchY, sleeveless, uniform: true });
  if (!res) throw new Error(`synthetic ${kind} produced no silhouette`);
  const out = { scan: res.scan, atlas: res.atlas, width: res.scan.width * 2, height: res.scan.height };
  if (cache.size > 60) cache.clear();
  cache.set(key, out);
  return out;
}

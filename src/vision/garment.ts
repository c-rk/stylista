/**
 * Garment photo analysis. Input: image + alpha matte. Output: a cropped RGBA atlas and the
 * silhouette structure needed to drape the piece on the body (type, torso band, sleeves, legs).
 * Classical geometry only; runs in a few milliseconds.
 */
import { Pixels } from './image';

export type ScanKind = 'top' | 'dress' | 'skirt' | 'trousers';

export interface Limb {
  /** Attachment point (shoulder for sleeves), atlas pixels. */
  origin: [number, number];
  /** Far end (cuff). */
  tip: [number, number];
  /** Half width across the limb at `SAMPLES` stations from origin to tip, pixels. */
  half: number[];
  /** Offset of the limb centre from the origin-tip line at each station, pixels. */
  centre: number[];
}

export interface GarmentScan {
  kind: ScanKind;
  /** Atlas size. The atlas holds the front image in [0,w) and the back variant in [w,2w). */
  width: number;
  height: number;
  /** Symmetry axis x. */
  cx: number;
  /** Per-row extents of the body-covering part (sleeves and legs excluded), length = height. */
  left: number[];
  right: number[];
  /** Row of the shoulder line (tops, dresses) or waistband (skirts, trousers). */
  anchorY: number;
  /** Row where the under-arm meets the side seam; -1 when sleeveless. */
  armpitY: number;
  /** Half width used to scale the piece to the wearer: at the armpit, or at the waistband. */
  fitHalf: number;
  /** True when the piece was photographed lying flat (widths are half circumferences, not frontal widths). */
  flat: boolean;
  sleeves: Limb[];
  /** Trousers only: row where the legs separate, and per-row extents of each leg ([x<cx, x>cx]). */
  crotchY: number;
  legs: { left: number[]; right: number[] }[];
  color: string;
}

export const SAMPLES = 12;
const hex = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
}

function smooth(v: number[], r: number): number[] {
  return v.map((_, i) => {
    let sum = 0, n = 0;
    for (let k = Math.max(0, i - r); k <= Math.min(v.length - 1, i + r); k++) (sum += v[k]), n++;
    return sum / n;
  });
}

/** Opaque runs of one row as [start, end] pairs (inclusive). */
function runs(a: Float32Array, w: number, y: number, minLen: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let x = 0; x <= w; x++) {
    const on = x < w && a[y * w + x] > 0.5;
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      if (x - start >= minLen) out.push([start, x - 1]);
      start = -1;
    }
  }
  return out;
}

function limb(points: [number, number][], origin: [number, number]): Limb | null {
  if (points.length < 30) return null;
  // Tip: centroid of the 6% of pixels farthest from the origin.
  const far = points.map((p) => Math.hypot(p[0] - origin[0], p[1] - origin[1]));
  const cut = [...far].sort((a, b) => b - a)[Math.floor(points.length * 0.06)];
  let tx = 0, ty = 0, n = 0;
  points.forEach((p, i) => {
    if (far[i] >= cut) (tx += p[0]), (ty += p[1]), n++;
  });
  const tip: [number, number] = [tx / n, ty / n];
  const len = Math.hypot(tip[0] - origin[0], tip[1] - origin[1]);
  if (len < 8) return null;
  const dx = (tip[0] - origin[0]) / len, dy = (tip[1] - origin[1]) / len;
  const lo = new Array(SAMPLES).fill(Infinity), hi = new Array(SAMPLES).fill(-Infinity);
  for (const p of points) {
    const t = ((p[0] - origin[0]) * dx + (p[1] - origin[1]) * dy) / len;
    const s = -(p[0] - origin[0]) * dy + (p[1] - origin[1]) * dx;
    const k = Math.min(SAMPLES - 1, Math.max(0, Math.floor(t * SAMPLES)));
    lo[k] = Math.min(lo[k], s);
    hi[k] = Math.max(hi[k], s);
  }
  const half: number[] = [], centre: number[] = [];
  for (let k = 0; k < SAMPLES; k++) {
    const ok = hi[k] > lo[k];
    half.push(ok ? (hi[k] - lo[k]) / 2 : NaN);
    centre.push(ok ? (hi[k] + lo[k]) / 2 : NaN);
  }
  // Fill empty stations from neighbours.
  for (const arr of [half, centre]) {
    for (let k = 0; k < SAMPLES; k++) if (Number.isNaN(arr[k])) arr[k] = arr[k - 1] ?? arr.find((v) => !Number.isNaN(v)) ?? 4;
  }
  return { origin, tip, half: smooth(half, 1), centre: smooth(centre, 1) };
}

export interface ScanResult {
  scan: GarmentScan;
  /** RGBA atlas, 2*width by height: front | back. */
  atlas: Uint8Array;
}

export function scanGarment(img: Pixels, alphaFull: Float32Array, forced?: ScanKind, hints: { crotchY?: number; sleeveless?: boolean } = {}): ScanResult | null {
  // ---- crop to the matte's bounding box ------------------------------------------------
  const W0 = img.width, H0 = img.height;
  let x0 = W0, x1 = -1, y0 = H0, y1 = -1;
  for (let y = 0; y < H0; y++)
    for (let x = 0; x < W0; x++)
      if (alphaFull[y * W0 + x] > 0.5) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 - x0 < 16 || y1 - y0 < 16) return null;
  const pad = 2;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(W0 - 1, x1 + pad);
  y1 = Math.min(H0 - 1, y1 + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = alphaFull[(y + y0) * W0 + x + x0];

  const minRun = Math.max(2, Math.round(w * 0.015));
  const rows = Array.from({ length: h }, (_, y) => runs(a, w, y, minRun));
  const first = rows.findIndex((r) => r.length), last = h - 1 - [...rows].reverse().findIndex((r) => r.length);
  const full = rows.map((r) => (r.length ? [r[0][0], r[r.length - 1][1]] : null));
  const cx = median(full.filter((f): f is number[] => !!f).map((f) => (f[0] + f[1]) / 2));

  // ---- trousers: a persistent central gap in the lower part ----------------------------
  const gap = rows.map((r) => r.length >= 2 && r.some((s, i) => i > 0 && r[i - 1][1] < cx + w * 0.08 && s[0] > cx - w * 0.08 && s[0] - r[i - 1][1] > 1));
  let crotchY = -1;
  {
    const lower = gap.slice(Math.floor(first + (last - first) * 0.45), last + 1);
    const frac = lower.filter(Boolean).length / Math.max(1, lower.length);
    const upper = gap.slice(first, Math.floor(first + (last - first) * 0.18));
    if (frac > 0.7 && upper.filter(Boolean).length / Math.max(1, upper.length) < 0.3) {
      // First row from which the gap persists.
      for (let y = last; y >= first; y--) {
        if (!gap[y] && !gap[Math.max(first, y - 2)]) {
          crotchY = y + 1;
          break;
        }
      }
    }
  }

  // A caller that knows the crotch row (procedural silhouettes) passes it in image rows.
  if (hints.crotchY !== undefined) crotchY = Math.round(hints.crotchY - y0);

  const left = new Array(h).fill(cx), right = new Array(h).fill(cx);
  const sleeves: Limb[] = [];
  const legs: GarmentScan['legs'] = [];
  let kind: ScanKind;
  let anchorY = first, armpitY = -1, fitHalf = w / 4;
  let flat = false;

  const central = (y: number): [number, number] | null => {
    const r = rows[y];
    if (!r.length) return null;
    return r.find((s) => s[0] <= cx && s[1] >= cx) ?? r.reduce((b, s) => (Math.abs((s[0] + s[1]) / 2 - cx) < Math.abs((b[0] + b[1]) / 2 - cx) ? s : b));
  };

  if (forced ? forced === 'trousers' : crotchY > 0) {
    kind = 'trousers';
    if (crotchY < 0) crotchY = Math.round(first + (last - first) * 0.3);
    const L = new Array(h).fill(null), R = new Array(h).fill(null);
    for (let y = first; y <= last; y++) {
      const f = full[y];
      if (!f) continue;
      left[y] = f[0];
      right[y] = f[1];
      if (y >= crotchY) {
        const ls = rows[y].filter((s) => (s[0] + s[1]) / 2 < cx), rs = rows[y].filter((s) => (s[0] + s[1]) / 2 >= cx);
        if (ls.length) L[y] = [ls[0][0], ls[ls.length - 1][1]];
        if (rs.length) R[y] = [rs[0][0], rs[rs.length - 1][1]];
      }
    }
    for (const side of [L, R]) {
      let prev = [cx, cx];
      const lo: number[] = [], hi: number[] = [];
      for (let y = 0; y < h; y++) {
        if (side[y]) prev = side[y];
        lo.push(prev[0]);
        hi.push(prev[1]);
      }
      legs.push({ left: lo, right: hi });
    }
    anchorY = first;
    fitHalf = median(Array.from({ length: Math.max(1, Math.round((crotchY - first) * 0.25)) }, (_, i) => (right[first + i + 2] - left[first + i + 2]) / 2));
    // Worn full-length trousers are about 3.6 waist-widths long, flat-laid about 2.5.
    const legRows = last - crotchY, rise = crotchY - first;
    flat = legRows > rise * 2 && (last - first) / (fitHalf * 2) < 2.9;
  } else {
    // ---- upper garment / dress / skirt -------------------------------------------------
    const hw = new Array(h).fill(0);
    const threeRun = new Array(h).fill(false);
    for (let y = first; y <= last; y++) {
      const c = central(y);
      if (!c) continue;
      hw[y] = Math.min(cx - c[0], c[1] - cx);
      threeRun[y] = rows[y].length >= 3 || (rows[y].length === 2 && c !== undefined && rows[y].some((s) => s !== c && (s[1] < c[0] || s[0] > c[1])));
    }
    const sm = smooth(hw, Math.max(1, Math.round(h * 0.01)));
    const span = last - first;
    // Armpit: strongest narrowing of the central run in the upper part, or the first row where
    // hanging sleeves detach from the torso.
    const d = Math.max(2, Math.round(span * 0.035));
    let best = 1.1, bestY = -1;
    for (let y = first + d; y < first + span * 0.62; y++) {
      const ratio = sm[y - d] / Math.max(1, sm[y + d]);
      if (ratio > best) (best = ratio), (bestY = y + d);
    }
    const detach = threeRun.findIndex((t, y) => t && y > first + span * 0.08 && y < first + span * 0.7 && threeRun[Math.min(h - 1, y + 3)]);
    if (detach > 0 && (bestY < 0 || detach < bestY + d)) bestY = detach;
    if (hints.sleeveless) bestY = -1;
    if (bestY > 0) {
      armpitY = bestY;
      const torsoHalf = median(sm.slice(armpitY, Math.min(last, armpitY + Math.max(3, Math.round(span * 0.06)))));
      fitHalf = torsoHalf;
      for (let y = first; y <= last; y++) {
        const c = central(y);
        if (!c) continue;
        // Above the armpit the torso band is clamped to the armpit width; below, sleeves that
        // hang beside the body are separate runs and the central run is the torso.
        // The clamp extends a little below the detected armpit row, where the under-arm seam
        // still joins sleeve and torso in one run.
        const lim = y < armpitY + span * 0.035 ? torsoHalf * 1.04 : Infinity;
        left[y] = Math.max(c[0], cx - lim);
        right[y] = Math.min(c[1], cx + lim);
      }
      // Sleeve pixels: everything opaque outside the torso band.
      for (const sgn of [-1, 1]) {
        const pts: [number, number][] = [];
        let topY = -1;
        for (let y = first; y <= last; y++)
          for (const s of rows[y]) {
            const from = sgn < 0 ? s[0] : Math.max(s[0], Math.ceil(right[y]) + 1);
            const to = sgn < 0 ? Math.min(s[1], Math.floor(left[y]) - 1) : s[1];
            if (to < from) continue;
            if (topY < 0) topY = y;
            for (let x = from; x <= to; x += 2) pts.push([x, y]);
          }
        if (topY < 0) continue;
        const l = limb(pts, [cx + sgn * torsoHalf, topY + (armpitY - topY) * 0.35]);
        if (l && Math.hypot(l.tip[0] - l.origin[0], l.tip[1] - l.origin[1]) > torsoHalf * 0.25) sleeves.push(l);
      }
    } else {
      for (let y = first; y <= last; y++) {
        const f = full[y];
        if (f) (left[y] = f[0]), (right[y] = f[1]);
      }
    }
    // Shoulder line: first row where the torso band reaches 78% of its fit width.
    const chestY = armpitY > 0 ? armpitY : Math.round(first + span * 0.25);
    if (armpitY < 0) fitHalf = median(sm.slice(chestY, chestY + Math.max(3, Math.round(span * 0.05))));
    anchorY = first;
    for (let y = first; y <= chestY; y++)
      if (right[y] - left[y] >= fitHalf * 2 * 0.78) {
        anchorY = y;
        break;
      }
    // Skirt: no sleeves, flat top edge, widest below the top.
    const cols = Array.from({ length: Math.round(fitHalf) }, (_, i) => Math.round(cx - fitHalf / 2 + i)).filter((x) => x >= 0 && x < w);
    const topEdge = cols.map((x) => {
      for (let y = first; y <= last; y++) if (a[y * w + x] > 0.5) return y;
      return last;
    });
    const dip = (Math.max(...topEdge) - Math.min(...topEdge)) / span;
    const topWidth = median(Array.from({ length: Math.max(2, Math.round(span * 0.05)) }, (_, i) => right[first + i + 1] - left[first + i + 1]));
    const maxWidth = Math.max(...right.map((r, y) => r - left[y]));
    // Flat-laid pieces have sleeves spread sideways; worn ones (mannequin, hanger) hang down.
    flat = sleeves.length > 0 && sleeves.every((s) => Math.abs(s.tip[0] - s.origin[0]) > Math.abs(s.tip[1] - s.origin[1]) * 1.1);
    const aspect = (last - anchorY) / (fitHalf * 2);
    if (!sleeves.length && dip < 0.045 && topWidth < maxWidth * 0.82) {
      kind = 'skirt';
      fitHalf = topWidth / 2;
      anchorY = first;
    } else kind = aspect > (flat ? 1.9 : 2.7) ? 'dress' : 'top';
    if (forced && forced !== kind) {
      kind = forced;
      if (forced === 'skirt') (fitHalf = topWidth / 2), (anchorY = first);
    }
  }
  // Median over a few rows removes single-row spikes (stray matte pixels, seam joins) before
  // the light smoothing; a spike would become a ridge around the body.
  const despike = (v: number[]) => {
    const r = Math.max(2, Math.round(h * 0.008));
    return v.map((_, i) => median(v.slice(Math.max(0, i - r), i + r + 1)));
  };
  const sl = smooth(despike(left), 2), sr = smooth(despike(right), 2);

  // ---- atlas: front | back, with colour bled into transparent texels ---------------------
  const atlas = new Uint8Array(w * 2 * h * 4);
  const C = img.channels;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((y + y0) * W0 + x + x0) * C;
      const o = (y * w * 2 + x) * 4;
      atlas[o] = img.data[i];
      atlas[o + 1] = img.data[i + 1];
      atlas[o + 2] = img.data[i + 2];
      atlas[o + 3] = Math.round(a[y * w + x] * 255);
      if (a[y * w + x] > 0.9) (r += img.data[i]), (g += img.data[i + 1]), (b += img.data[i + 2]), n++;
    }
  // Back variant: copy, then close the neckline by extending fabric upward to the shoulder line.
  for (let y = 0; y < h; y++) atlas.copyWithin((y * w * 2 + w) * 4, y * w * 2 * 4, (y * w * 2 + w) * 4);
  if (kind === 'top' || kind === 'dress') {
    const lim = armpitY > 0 ? armpitY : Math.round(first + (last - first) * 0.3);
    const tops: number[] = [];
    for (let x = 0; x < w; x++) {
      let t = -1;
      for (let y = first; y <= lim; y++)
        if (a[y * w + x] > 0.5) {
          t = y;
          break;
        }
      tops.push(t);
    }
    // Shoulder peaks left and right of the axis define the back neckline (slightly dipped).
    let pl = -1, pr = -1;
    for (let x = 0; x < w; x++) {
      if (tops[x] < 0) continue;
      if (x < cx && (pl < 0 || tops[x] < tops[pl])) pl = x;
      if (x >= cx && (pr < 0 || tops[x] <= tops[pr])) pr = x;
    }
    if (pl >= 0 && pr > pl + 4) {
      for (let x = pl; x <= pr; x++) {
        if (tops[x] < 0) continue;
        const u = (x - pl) / (pr - pl);
        const line = Math.round(tops[pl] * (1 - u) + tops[pr] * u + Math.sin(u * Math.PI) * (pr - pl) * 0.06);
        const src = (Math.min(h - 1, tops[x] + 3) * w * 2 + w + x) * 4;
        for (let y = line; y < tops[x] + 3 && y < h; y++) {
          const o = (y * w * 2 + w + x) * 4;
          atlas[o] = atlas[src];
          atlas[o + 1] = atlas[src + 1];
          atlas[o + 2] = atlas[src + 2];
          atlas[o + 3] = 255;
        }
      }
    }
  }
  // Transparent frame so clamped lookups outside the piece never smear its edge texels.
  for (let half = 0; half < 2; half++) {
    for (let x = 0; x < w; x++) (atlas[(half * w + x) * 4 + 3] = 0), (atlas[((h - 1) * w * 2 + half * w + x) * 4 + 3] = 0);
    for (let y = 0; y < h; y++) (atlas[(y * w * 2 + half * w) * 4 + 3] = 0), (atlas[(y * w * 2 + half * w + w - 1) * 4 + 3] = 0);
  }
  // Colour bleed: push fabric colour a few texels into transparent neighbours so bilinear
  // sampling at the alpha edge never pulls in backdrop colour.
  const AW = w * 2;
  for (let pass = 0; pass < 6; pass++) {
    const snap = atlas.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < AW; x++) {
        const o = (y * AW + x) * 4;
        if (snap[o + 3] > 127) continue;
        let cr = 0, cg = 0, cb = 0, cn = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= AW || yy >= h) continue;
          const q = (yy * AW + xx) * 4;
          if (snap[q + 3] > 127 || (pass > 0 && snap[q + 3] === 1)) (cr += snap[q]), (cg += snap[q + 1]), (cb += snap[q + 2]), cn++;
        }
        if (cn) {
          atlas[o] = cr / cn;
          atlas[o + 1] = cg / cn;
          atlas[o + 2] = cb / cn;
          // Alpha 1 marks "colour valid, still transparent" for the next pass.
          if (atlas[o + 3] === 0) atlas[o + 3] = 1;
        }
      }
  }

  return {
    scan: { kind, width: w, height: h, cx, left: sl, right: sr, anchorY, armpitY, fitHalf, flat, sleeves, crotchY, legs, color: n ? `#${hex(r / n)}${hex(g / n)}${hex(b / n)}`.toUpperCase() : '#888888' },
    atlas,
  };
}

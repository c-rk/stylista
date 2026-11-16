/**
 * Body measurements from self-capture silhouettes. Widths come from the front view, depths
 * from the side view, both converted to centimetres with the stated height; each girth is the
 * perimeter of the ellipse they span. Classical geometry on the matte, no learned regressor.
 */
import { Pixels } from './image';

export interface Matte {
  width: number;
  height: number;
  alpha: Float32Array;
}

export interface BodyEstimate {
  chest: number;
  waist: number;
  hips: number;
  shoulders: number;
  inseam: number;
  /** Face rectangle in the front image (pixels), for the face texture. */
  face: { cx: number; top: number; bottom: number; halfWidth: number };
  /** Share of the frame height the person fills; low values mean they stood too far away. */
  coverage: number;
}

type Run = [number, number];

function rowRuns(m: Matte, y: number): Run[] {
  const out: Run[] = [];
  const min = Math.max(2, Math.round(m.width * 0.008));
  let start = -1;
  for (let x = 0; x <= m.width; x++) {
    const on = x < m.width && m.alpha[y * m.width + x] > 0.5;
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      if (x - start >= min) out.push([start, x - 1]);
      start = -1;
    }
  }
  return out;
}

function extent(m: Matte): { top: number; bottom: number; rows: Run[][] } | null {
  const rows = Array.from({ length: m.height }, (_, y) => rowRuns(m, y));
  const top = rows.findIndex((r) => r.length);
  if (top < 0) return null;
  let bottom = m.height - 1;
  while (bottom > top && !rows[bottom].length) bottom--;
  // Cut off at the frame edge means the person is not fully in view: no reliable scale.
  if (top <= 1 || bottom >= m.height - 2) return null;
  return bottom - top < m.height * 0.2 ? null : { top, bottom, rows };
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

/** Ramanujan perimeter of an ellipse with half-axes a and b. */
const perimeter = (a: number, b: number) => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));

export function estimateBody(front: Matte, side: Matte | null, heightCm: number): BodyEstimate | null {
  const f = extent(front);
  if (!f) return null;
  const span = f.bottom - f.top;
  const cmPerPx = heightCm / span;
  const rowAt = (frac: number) => Math.round(f.bottom - frac * span);
  // Symmetry axis from the trunk rows.
  const cx = median(
    Array.from({ length: rowAt(0.55) - rowAt(0.8) }, (_, i) => f.rows[rowAt(0.8) + i]).flatMap((r) => (r.length ? [(r[0][0] + r[r.length - 1][1]) / 2] : [])),
  );
  /** Width of the run that contains the body axis (arms held away fall in other runs). */
  const central = (y: number): number => {
    const r = f.rows[y].find((s) => s[0] <= cx && s[1] >= cx);
    return r ? r[1] - r[0] + 1 : 0;
  };
  const band = (lo: number, hi: number) => Array.from({ length: Math.max(1, rowAt(lo) - rowAt(hi)) }, (_, i) => central(rowAt(hi) + i)).filter((w) => w > 0);

  // Crotch: scanning up from the knees, the first row whose axis is covered again.
  let crotch = rowAt(0.45);
  for (let y = rowAt(0.3); y > rowAt(0.58); y--) {
    if (f.rows[y].some((s) => s[0] <= cx && s[1] >= cx)) {
      crotch = y;
      break;
    }
  }
  const crotchFrac = (f.bottom - crotch) / span;
  const waistW = Math.min(...band(0.58, 0.68)) || central(rowAt(0.62));
  const shoulderW = Math.max(...band(0.79, 0.83));
  // Arms hanging close can merge with the trunk; cap chest and hips against neighbours.
  const chestW = Math.min(median(band(0.7, 0.745)), shoulderW * 0.86);
  const hipsW = Math.min(Math.max(...band(crotchFrac + 0.015, crotchFrac + 0.1)), waistW * 1.75);

  let chestD = chestW * 0.74, waistD = waistW * 0.78, hipsD = hipsW * 0.72;
  if (side) {
    const s = extent(side);
    if (s) {
      const k = span / (s.bottom - s.top);
      const depth = (lo: number, hi: number, pick: (v: number[]) => number) => {
        const v: number[] = [];
        for (let y = Math.round(s.bottom - hi * (s.bottom - s.top)); y < Math.round(s.bottom - lo * (s.bottom - s.top)); y++) {
          const r = s.rows[y];
          if (r.length) v.push((r[r.length - 1][1] - r[0][0] + 1) * k);
        }
        return v.length ? pick(v) : 0;
      };
      // Side depths include the arm lying over the trunk; blend with the frontal prior.
      const mix = (measured: number, prior: number) => (measured > prior * 0.6 && measured < prior * 1.7 ? measured * 0.7 + prior * 0.3 : prior);
      chestD = mix(depth(0.7, 0.745, median), chestD);
      waistD = mix(depth(0.58, 0.68, (v) => Math.min(...v)), waistD);
      hipsD = mix(depth(crotchFrac + 0.015, crotchFrac + 0.1, (v) => Math.max(...v)), hipsD);
    }
  }
  const girth = (w: number, d: number) => perimeter((w * cmPerPx) / 2, (d * cmPerPx) / 2);

  // Face box: from the crown down to the chin, about 13% of stature, centred on the head run.
  const headRows = Array.from({ length: Math.round(span * 0.1) }, (_, i) => f.rows[f.top + Math.round(span * 0.02) + i]).filter((r) => r.length);
  const headHalf = median(headRows.map((r) => (r[r.length - 1][1] - r[0][0]) / 2));
  const headCx = median(headRows.map((r) => (r[r.length - 1][1] + r[0][0]) / 2));

  return {
    chest: girth(chestW, chestD),
    waist: girth(waistW, waistD),
    hips: girth(hipsW, hipsD),
    shoulders: shoulderW * cmPerPx * 0.9,
    inseam: crotchFrac * heightCm,
    face: { cx: headCx, top: f.top, bottom: f.top + span * 0.135, halfWidth: headHalf },
    coverage: span / front.height,
  };
}

/** Median colour of opaque pixels inside a rectangle, as #RRGGBB. */
export function sampleColor(img: Pixels, alpha: Float32Array, x0: number, y0: number, x1: number, y1: number): string | null {
  const ch: number[][] = [[], [], []];
  for (let y = Math.max(0, Math.round(y0)); y < Math.min(img.height, Math.round(y1)); y++)
    for (let x = Math.max(0, Math.round(x0)); x < Math.min(img.width, Math.round(x1)); x++) {
      if (alpha[y * img.width + x] < 0.9) continue;
      const i = (y * img.width + x) * img.channels;
      for (let c = 0; c < 3; c++) ch[c].push(img.data[i + c]);
    }
  if (ch[0].length < 12) return null;
  return '#' + ch.map((v) => Math.round(median(v)).toString(16).padStart(2, '0')).join('').toUpperCase();
}

import { boxBlur, channel, components, Pixels, resizeFloat } from './image';

export const MODEL_SIZE = 320;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** Converts an image to the saliency network's NCHW float input (U²-Net preprocessing). */
export function toModelInput(p: Pixels, size = MODEL_SIZE): Float32Array {
  const out = new Float32Array(3 * size * size);
  let max = 1;
  for (let i = 0; i < p.data.length; i += p.channels) max = Math.max(max, p.data[i], p.data[i + 1], p.data[i + 2]);
  for (let c = 0; c < 3; c++) {
    const plane = resizeFloat(channel(p, c), p.width, p.height, size, size);
    const scale = 255 / max;
    for (let i = 0; i < size * size; i++) out[c * size * size + i] = (plane[i] * scale - MEAN[c]) / STD[c];
  }
  return out;
}

export interface MatteOptions {
  /** Keep every component at least this fraction of the largest one (pairs of shoes, two-piece sets). */
  keepRatio?: number;
}

/**
 * Turns the network's low-resolution saliency map into a clean alpha matte at image resolution.
 *
 * 1. Min-max normalise and upsample.
 * 2. Guided filter against the image luma: snaps the soft, blocky network edge onto real
 *    image edges (He et al. 2010), which recovers straps, hems and hair-thin detail.
 * 3. Contrast curve, then drop stray components and fill interior pinholes.
 */
export function refineMatte(raw: Float32Array, img: Pixels, { keepRatio = 0.12 }: MatteOptions = {}, size = MODEL_SIZE): Float32Array {
  const { width: w, height: h } = img;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < raw.length; i++) {
    lo = Math.min(lo, raw[i]);
    hi = Math.max(hi, raw[i]);
  }
  const norm = new Float32Array(raw.length);
  const span = hi - lo || 1;
  for (let i = 0; i < raw.length; i++) norm[i] = (raw[i] - lo) / span;
  const p = resizeFloat(norm, size, size, w, h);

  const I = channel(img, -1);
  const r = Math.max(2, Math.round(Math.max(w, h) / 90));
  const eps = 4e-4;
  const n = w * h;
  const mI = boxBlur(I, w, h, r);
  const mP = boxBlur(p, w, h, r);
  const II = new Float32Array(n);
  const IP = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    II[i] = I[i] * I[i];
    IP[i] = I[i] * p[i];
  }
  const mII = boxBlur(II, w, h, r);
  const mIP = boxBlur(IP, w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    a[i] = (mIP[i] - mI[i] * mP[i]) / (mII[i] - mI[i] * mI[i] + eps);
    b[i] = mP[i] - a[i] * mI[i];
  }
  const mA = boxBlur(a, w, h, r);
  const mB = boxBlur(b, w, h, r);

  const alpha = new Float32Array(n);
  const hard = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    // Blend: trust the network in flat regions, the guided result near edges.
    const q = mA[i] * I[i] + mB[i];
    const t = Math.min(1, Math.max(0, (q - 0.5) * 2.2 + 0.5));
    alpha[i] = t;
    hard[i] = p[i] > 0.5 || t > 0.6 ? 1 : 0;
  }

  const { labels, areas } = components(hard, w, h);
  const largest = Math.max(0, ...areas);
  // Interior holes: background components that do not touch the border and are tiny.
  const inv = new Uint8Array(n);
  for (let i = 0; i < n; i++) inv[i] = hard[i] ? 0 : 1;
  const bg = components(inv, w, h);
  const touches = new Uint8Array(bg.areas.length);
  for (let x = 0; x < w; x++) (touches[bg.labels[x]] = 1), (touches[bg.labels[(h - 1) * w + x]] = 1);
  for (let y = 0; y < h; y++) (touches[bg.labels[y * w]] = 1), (touches[bg.labels[y * w + w - 1]] = 1);
  const pinhole = n * 0.0004;
  for (let i = 0; i < n; i++) {
    const l = labels[i];
    if (l) {
      if (areas[l] < largest * keepRatio) alpha[i] = 0;
      else if (p[i] > 0.9) alpha[i] = Math.max(alpha[i], p[i]);
    } else {
      const g = bg.labels[i];
      if (!touches[g] && bg.areas[g] < pinhole) alpha[i] = 1;
      else alpha[i] = Math.min(alpha[i], 0.5 * p[i] + 0.5 * alpha[i]);
    }
  }
  return alpha;
}

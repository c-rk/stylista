/** Pure pixel utilities. No platform imports: runs on device, on web and in Node tests. */

export interface Pixels {
  width: number;
  height: number;
  channels: number;
  data: Uint8Array | Uint8ClampedArray | Uint16Array;
}

/** Bilinear resize of a single-channel float image. */
export function resizeFloat(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh);
  const fx = sw / dw;
  const fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * fy - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * fx - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = sx - x0;
      out[y * dw + x] = (src[y0 * sw + x0] * (1 - wx) + src[y0 * sw + x1] * wx) * (1 - wy) + (src[y1 * sw + x0] * (1 - wx) + src[y1 * sw + x1] * wx) * wy;
    }
  }
  return out;
}

/** Extracts one channel (or luma when c < 0) as floats in 0..1. */
export function channel(p: Pixels, c: number): Float32Array {
  const n = p.width * p.height;
  const out = new Float32Array(n);
  const k = p.channels;
  const d = p.data;
  for (let i = 0; i < n; i++) out[i] = c < 0 ? (0.299 * d[i * k] + 0.587 * d[i * k + 1] + 0.114 * d[i * k + 2]) / 255 : d[i * k + c] / 255;
  return out;
}

/** Box filter with radius r, O(n) via running sums; edges use the available window. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    let count = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) {
      sum += src[y * w + x];
      count++;
    }
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / count;
      const add = x + r + 1;
      const rem = x - r;
      if (add < w) {
        sum += src[y * w + add];
        count++;
      }
      if (rem >= 0) {
        sum -= src[y * w + rem];
        count--;
      }
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    let count = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) {
      sum += tmp[y * w + x];
      count++;
    }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / count;
      const add = y + r + 1;
      const rem = y - r;
      if (add < h) {
        sum += tmp[add * w + x];
        count++;
      }
      if (rem >= 0) {
        sum -= tmp[rem * w + x];
        count--;
      }
    }
  }
  return out;
}

/** 4-connected component labelling. Returns labels (0 = background) and per-label areas. */
export function components(mask: Uint8Array, w: number, h: number): { labels: Int32Array; areas: number[] } {
  const labels = new Int32Array(w * h);
  const areas = [0];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i]) continue;
    const id = areas.length;
    let area = 0;
    stack.push(i);
    labels[i] = id;
    while (stack.length) {
      const p = stack.pop()!;
      area++;
      const x = p % w;
      if (x > 0 && mask[p - 1] && !labels[p - 1]) (labels[p - 1] = id), stack.push(p - 1);
      if (x < w - 1 && mask[p + 1] && !labels[p + 1]) (labels[p + 1] = id), stack.push(p + 1);
      if (p >= w && mask[p - w] && !labels[p - w]) (labels[p - w] = id), stack.push(p - w);
      if (p < w * (h - 1) && mask[p + w] && !labels[p + w]) (labels[p + w] = id), stack.push(p + w);
    }
    areas.push(area);
  }
  return { labels, areas };
}

import { decode, encode } from 'fast-png';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

function b64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/**
 * Normalises an imported picture (camera, gallery, clipboard) to a bounded JPEG and stores
 * it in the app's private document directory. Returns a URI that survives restarts.
 * On web (preview only) the result is a data URI.
 */
export async function persistImage(uri: string, folder: 'garments' | 'captures', maxSide = 1024): Promise<string> {
  const ref = await ImageManipulator.manipulate(uri).renderAsync();
  const scale = Math.min(1, maxSide / Math.max(ref.width, ref.height));
  const sized = scale < 1 ? await ImageManipulator.manipulate(uri).resize({ width: Math.round(ref.width * scale) }).renderAsync() : ref;
  const saved = await sized.saveAsync({ format: SaveFormat.JPEG, compress: 0.82, base64: Platform.OS === 'web' });
  if (Platform.OS === 'web') return saved.base64 ? `data:image/jpeg;base64,${saved.base64}` : saved.uri;
  const dir = new Directory(Paths.document, folder);
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`);
  new File(saved.uri).move(dest);
  return dest.uri;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return globalThis.btoa(bin);
}

function writePng(bytes: Uint8Array, folder: string): string {
  if (Platform.OS === 'web') return `data:image/png;base64,${bytesToB64(bytes)}`;
  const dir = new Directory(Paths.document, folder);
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `${Date.now()}-${Math.round(Math.random() * 1e6)}.png`);
  dest.create();
  dest.write(bytes);
  return dest.uri;
}

export interface GarmentTexture {
  /** Silhouette-normalised texture, or undefined when the backdrop could not be keyed out. */
  uri?: string;
  color: string;
}

/**
 * On-device garment extraction for product-style photos (piece on a fairly uniform backdrop).
 *
 * 1. Estimate the backdrop colour from the image border.
 * 2. Key out pixels close to it to obtain the garment silhouette.
 * 3. Stretch every row of the silhouette to the full texture width, producing a rectangular
 *    texture that contains fabric only and wraps cleanly around the 3D template.
 *
 * Cluttered backdrops (border colour variance too high, or implausible coverage) return
 * no texture; the caller then falls back to the raw photo.
 */
export async function extractGarmentTexture(uri: string): Promise<GarmentTexture> {
  const ref = await ImageManipulator.manipulate(uri).resize({ width: 320 }).renderAsync();
  const png = await ref.saveAsync({ format: SaveFormat.PNG, base64: true });
  if (!png.base64) return { color: '#8A8A92' };
  const { width: W, height: Ht, channels: C, data } = decode(b64ToBytes(png.base64));
  const px = (x: number, y: number) => (y * W + x) * C;

  // Backdrop estimate: per-channel median of the outer frame.
  const border: number[][] = [[], [], []];
  for (let x = 0; x < W; x += 2) for (const y of [0, 1, Ht - 2, Ht - 1]) for (let c = 0; c < 3; c++) border[c].push(data[px(x, y) + c]);
  for (let y = 0; y < Ht; y += 2) for (const x of [0, 1, W - 2, W - 1]) for (let c = 0; c < 3; c++) border[c].push(data[px(x, y) + c]);
  const bg = border.map((v) => v.sort((a, b) => a - b)[v.length >> 1]);
  const n = border[0].length;
  // After sorting, channels are decorrelated, so this is a conservative clutter measure.
  const spread = (border[0][Math.floor(n * 0.9)] - border[0][Math.floor(n * 0.1)]) + (border[1][Math.floor(n * 0.9)] - border[1][Math.floor(n * 0.1)]) + (border[2][Math.floor(n * 0.9)] - border[2][Math.floor(n * 0.1)]);

  const mask = new Uint8Array(W * Ht);
  let covered = 0, r = 0, g = 0, b = 0;
  for (let y = 0; y < Ht; y++)
    for (let x = 0; x < W; x++) {
      const i = px(x, y);
      if (Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]) > 42 && (C < 4 || data[i + 3] > 128)) {
        mask[y * W + x] = 1;
        covered++;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
      }
    }
  const coverage = covered / (W * Ht);
  if (!covered) return { color: `#${hex(bg[0])}${hex(bg[1])}${hex(bg[2])}`.toUpperCase() };
  const color = `#${hex(r / covered)}${hex(g / covered)}${hex(b / covered)}`.toUpperCase();
  if (spread > 150 || coverage < 0.06 || coverage > 0.9) return { color: coverage > 0.9 || spread > 150 ? await dominantColor(uri) : color };

  // Per-row silhouette extents.
  const x0 = new Int16Array(Ht).fill(-1);
  const x1 = new Int16Array(Ht).fill(-1);
  for (let y = 0; y < Ht; y++) {
    let count = 0, lo = -1, hi = -1;
    for (let x = 0; x < W; x++)
      if (mask[y * W + x]) {
        count++;
        if (lo < 0) lo = x;
        hi = x;
      }
    if (count > W * 0.04) {
      x0[y] = lo;
      x1[y] = hi;
    }
  }
  let top = 0, bottom = Ht - 1;
  while (top < Ht && x0[top] < 0) top++;
  while (bottom > top && x0[bottom] < 0) bottom--;
  if (bottom - top < 16) return { color };

  const OW = 256;
  const OH = Math.max(32, Math.min(512, Math.round(((bottom - top + 1) * OW) / W / 0.75)));
  const out = new Uint8Array(OW * OH * 3);
  let last = top;
  for (let oy = 0; oy < OH; oy++) {
    let sy = top + Math.round((oy / (OH - 1)) * (bottom - top));
    if (x0[sy] < 0) sy = last;
    last = sy;
    // Inset slightly so anti-aliased edge pixels do not bleed backdrop into the fabric.
    const inset = Math.min(3, (x1[sy] - x0[sy]) * 0.05);
    const lo = x0[sy] + inset, hi = x1[sy] - inset;
    for (let ox = 0; ox < OW; ox++) {
      let sx = Math.round(lo + (ox / (OW - 1)) * (hi - lo));
      // Interior holes (e.g. neck opening seen through to the backdrop) reuse the nearest fabric pixel.
      if (!mask[sy * W + sx]) {
        for (let d = 1; d < W; d++) {
          if (sx - d >= lo && mask[sy * W + sx - d]) { sx -= d; break; }
          if (sx + d <= hi && mask[sy * W + sx + d]) { sx += d; break; }
        }
      }
      const i = px(sx, sy);
      // PNG rows run top-down; texture v runs bottom-up, handled by the loader's flipY.
      out.set([data[i], data[i + 1], data[i + 2]], (oy * OW + ox) * 3);
    }
  }
  return { uri: writePng(encode({ width: OW, height: OH, data: out, channels: 3, depth: 8 }), 'garments'), color };
}

export function deleteImage(uri?: string) {
  if (!uri || Platform.OS === 'web' || !uri.startsWith('file:')) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone.
  }
}

/** Removes every stored capture and garment photo. */
export function wipeImages() {
  if (Platform.OS === 'web') return;
  for (const folder of ['garments', 'captures']) {
    try {
      const dir = new Directory(Paths.document, folder);
      if (dir.exists) dir.delete();
    } catch {
      // Nothing stored.
    }
  }
}

/**
 * Dominant fabric colour: samples the central region of the photo (where the garment
 * normally sits), weighting saturated pixels over neutral backdrop pixels.
 */
export async function dominantColor(uri: string): Promise<string> {
  const ref = await ImageManipulator.manipulate(uri).resize({ width: 24 }).renderAsync();
  const png = await ref.saveAsync({ format: SaveFormat.PNG, base64: true });
  if (!png.base64) return '#8A8A92';
  const img = decode(b64ToBytes(png.base64));
  const { width, height, channels, data } = img;
  let r = 0, g = 0, b = 0, wsum = 0;
  for (let y = Math.floor(height * 0.25); y < height * 0.75; y++) {
    for (let x = Math.floor(width * 0.3); x < width * 0.7; x++) {
      const i = (y * width + x) * channels;
      const pr = data[i], pg = data[i + 1], pb = data[i + 2];
      const sat = (Math.max(pr, pg, pb) - Math.min(pr, pg, pb)) / 255;
      const w = 0.35 + sat;
      r += pr * w;
      g += pg * w;
      b += pb * w;
      wsum += w;
    }
  }
  if (!wsum) return '#8A8A92';
  return `#${hex(r / wsum)}${hex(g / wsum)}${hex(b / wsum)}`.toUpperCase();
}

import { decode, encode } from 'fast-png';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

import type { Pixels } from '@/vision/image';

function b64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}


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

/** Decodes an image to RGBA pixels, downscaled so its longer side is at most `maxSide`. */
export async function loadPixels(uri: string, maxSide: number): Promise<Pixels> {
  const ref = await ImageManipulator.manipulate(uri).renderAsync();
  const scale = Math.min(1, maxSide / Math.max(ref.width, ref.height));
  const sized = scale < 1 ? await ImageManipulator.manipulate(uri).resize({ width: Math.round(ref.width * scale) }).renderAsync() : ref;
  const png = await sized.saveAsync({ format: SaveFormat.PNG, base64: true });
  if (!png.base64) throw new Error('Could not read image pixels');
  const { width, height, channels, data } = decode(b64ToBytes(png.base64));
  return { width, height, channels, data };
}

/** Stores an RGBA buffer as a PNG in the app's private storage and returns its URI. */
export function saveRgba(rgba: Uint8Array, width: number, height: number, folder: 'garments' | 'captures'): string {
  return writePng(encode({ width, height, data: rgba, channels: 4, depth: 8 }), folder);
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

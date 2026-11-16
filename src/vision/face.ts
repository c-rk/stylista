/**
 * Face alignment on the front capture. The landmark network (MediaPipe FaceMesh, 478 points)
 * expects a tight face crop; starting from the head box of the body silhouette, the crop is
 * re-centred on the predicted landmarks a few times until it locks on.
 */
import { Pixels } from './image';

export const FACE_SIZE = 256;
/** FaceMesh indices: eye corners (subject's right, then left), chin, nose tip. */
const EYE_A = [33, 133], EYE_B = [362, 263], CHIN = 152;

export interface FaceLandmarks {
  /** Eye centres and chin in image pixels. */
  eyes: [[number, number], [number, number]];
  chin: [number, number];
  score: number;
}

/** Bilinear crop of a square region to the network's NHWC float input in 0..1. */
function cropInput(img: Pixels, cx: number, cy: number, half: number): Float32Array {
  const N = FACE_SIZE;
  const out = new Float32Array(N * N * 3);
  const { width: w, height: h, channels: c, data } = img;
  for (let y = 0; y < N; y++) {
    const sy = Math.min(h - 1, Math.max(0, cy - half + ((y + 0.5) / N) * 2 * half - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), wy = sy - y0;
    for (let x = 0; x < N; x++) {
      const sx = Math.min(w - 1, Math.max(0, cx - half + ((x + 0.5) / N) * 2 * half - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), wx = sx - x0;
      for (let k = 0; k < 3; k++) {
        const v = (data[(y0 * w + x0) * c + k] * (1 - wx) + data[(y0 * w + x1) * c + k] * wx) * (1 - wy) + (data[(y1 * w + x0) * c + k] * (1 - wx) + data[(y1 * w + x1) * c + k] * wx) * wy;
        out[(y * N + x) * 3 + k] = v / 255;
      }
    }
  }
  return out;
}

export type FaceNet = (input: Float32Array) => Promise<{ landmarks: Float32Array; score: number }>;

export async function locateFace(img: Pixels, start: { cx: number; cy: number; half: number }, net: FaceNet): Promise<FaceLandmarks | null> {
  let c = { ...start };
  let best: FaceLandmarks | null = null;
  for (let it = 0; it < 4; it++) {
    const { landmarks: lm, score } = await net(cropInput(img, c.cx, c.cy, c.half));
    const k = (2 * c.half) / FACE_SIZE;
    const pt = (i: number): [number, number] => [c.cx - c.half + lm[i * 3] * k, c.cy - c.half + lm[i * 3 + 1] * k];
    const mid = (a: number[]): [number, number] => [(pt(a[0])[0] + pt(a[1])[0]) / 2, (pt(a[0])[1] + pt(a[1])[1]) / 2];
    if (!best || score > best.score) best = { eyes: [mid(EYE_A), mid(EYE_B)], chin: pt(CHIN), score };
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 468; i++) {
      const [x, y] = pt(i);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    c = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, half: Math.max(x1 - x0, y1 - y0) * 0.75 };
    if (c.half < 12) break;
  }
  // The presence output is a logit; below this the crop never locked onto a face.
  return best && best.score > 4 ? best : null;
}

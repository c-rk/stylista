/**
 * On-device inference pipeline. Nothing here touches the network: the segmentation network is
 * a bundled 4.5 MB ONNX file, everything after it is classical geometry in src/vision.
 */
import { bodyFromHeight, BODY_LIMITS } from '@/lib/catalog';
import { loadPixels, saveRgba } from '@/lib/images';
import type { BodyParams , FaceTexture } from '@/types';
import { estimateBody, sampleColor } from '@/vision/bodyfit';
import { GarmentScan, scanGarment, ScanKind } from '@/vision/garment';
import type { Pixels } from '@/vision/image';
import { FACE_SIZE, locateFace } from '@/vision/face';
import { MODEL_SIZE, refineMatte, toModelInput } from '@/vision/matte';
import { runModel } from './onnx';

/** Foreground matte of an image: saliency network, then edge-aware refinement. */
export async function matteOf(img: Pixels, keepRatio?: number): Promise<Float32Array> {
  const [raw] = await runModel('saliency', toModelInput(img), [1, 3, MODEL_SIZE, MODEL_SIZE]);
  return refineMatte(raw, img, { keepRatio });
}

export interface GarmentAnalysis {
  color: string;
  /** Present when a wearable silhouette was found. */
  scan?: GarmentScan;
  atlasUri?: string;
}

/** Working state kept between analyses so changing the garment type does not re-run the network. */
export interface GarmentSource {
  img: Pixels;
  alpha: Float32Array;
}

export async function prepareGarment(imageUri: string): Promise<GarmentSource> {
  const img = await loadPixels(imageUri, 768);
  return { img, alpha: await matteOf(img) };
}

export function analyzeGarment(src: GarmentSource, forced?: ScanKind): GarmentAnalysis {
  const res = scanGarment(src.img, src.alpha, forced);
  if (!res) return { color: '#8A8A92' };
  return { color: res.scan.color, scan: res.scan, atlasUri: saveRgba(res.atlas, res.scan.width * 2, res.scan.height, 'garments') };
}

export interface BodyAnalysis {
  body: BodyParams;
  /** False when the frames could not be measured and average proportions were used instead. */
  measured: boolean;
  /** Face alignment in the front frame, when a face was found. */
  face?: FaceTexture;
}

const within = (key: keyof typeof BODY_LIMITS, v: number) => Math.round(Math.min(BODY_LIMITS[key][1], Math.max(BODY_LIMITS[key][0], v)));

/**
 * Estimates the body from self-capture frames (front, left, back, right). Falls back to
 * height-scaled average proportions when the person is not fully visible in the front frame.
 */
export async function analyzeBody(captures: string[], heightCm: number, current: BodyParams): Promise<BodyAnalysis> {
  const keep = { skin: current.skin, hair: current.hair, hairColor: current.hairColor, gender: current.gender };
  const fallback: BodyAnalysis = { body: bodyFromHeight(heightCm, keep), measured: false };
  if (!captures[0]) return fallback;
  try {
    const frontImg = await loadPixels(captures[0], 640);
    const front = { width: frontImg.width, height: frontImg.height, alpha: await matteOf(frontImg, 0.3) };
    let side = null;
    if (captures[1]) {
      const sideImg = await loadPixels(captures[1], 640);
      side = { width: sideImg.width, height: sideImg.height, alpha: await matteOf(sideImg, 0.3) };
    }
    const e = estimateBody(front, side, heightCm);
    if (!e) return fallback;
    const fh = e.face.bottom - e.face.top;
    const skin = sampleColor(frontImg, front.alpha, e.face.cx - e.face.halfWidth * 0.45, e.face.top + fh * 0.5, e.face.cx + e.face.halfWidth * 0.45, e.face.top + fh * 0.8);
    const hairColor = sampleColor(frontImg, front.alpha, e.face.cx - e.face.halfWidth * 0.5, e.face.top + fh * 0.03, e.face.cx + e.face.halfWidth * 0.5, e.face.top + fh * 0.14);
    // Face alignment on a sharper copy of the front frame, seeded by the silhouette's head box.
    let face: FaceTexture | undefined;
    try {
      const sharp = await loadPixels(captures[0], 1600);
      const k = sharp.width / frontImg.width;
      const lm = await locateFace(sharp, { cx: e.face.cx * k, cy: ((e.face.top + e.face.bottom) / 2) * k, half: (fh / 2) * k * 1.25 }, async (input) => {
        const [landmarks, score] = await runModel('face', input, [1, FACE_SIZE, FACE_SIZE, 3]);
        return { landmarks, score: score[0] };
      });
      const n = (p: [number, number]): [number, number] => [p[0] / sharp.width, p[1] / sharp.height];
      if (lm) face = { uri: captures[0], eyes: [n(lm.eyes[0]), n(lm.eyes[1])], chin: n(lm.chin) };
    } catch {
      // No face texture; the model keeps the sampled skin tone.
    }
    return {
      measured: true,
      body: {
        ...keep,
        height: heightCm,
        chest: within('chest', e.chest),
        waist: within('waist', e.waist),
        hips: within('hips', e.hips),
        shoulders: within('shoulders', e.shoulders),
        inseam: within('inseam', e.inseam),
        skin: skin ?? current.skin,
        hairColor: hairColor ?? current.hairColor,
      },
      face,
    };
  } catch {
    return fallback;
  }
}

/** Opt-in cloud reconstruction. No endpoint is configured in this build; it is never invoked. */
export const hdReconstructor = {
  available: false,
};

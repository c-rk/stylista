/**
 * Inference stages. Every stage is an interface with an on-device implementation, so a
 * learned model (Core ML / LiteRT) or the opt-in cloud reconstructor can replace it
 * without touching UI code.
 */
import { bodyFromHeight } from '@/lib/catalog';
import { extractGarmentTexture } from '@/lib/images';
import type { BodyParams, Garment } from '@/types';

export interface BodyEstimator {
  /** Estimates measurements from self-capture frames (front, left, back, right). */
  estimate(input: { captures: string[]; heightCm: number; current: BodyParams }): Promise<BodyParams>;
}

/**
 * Milestone-1 estimator: scales population-average proportions to the stated height.
 * It does not analyse the captured frames yet; they are stored on device so a silhouette-
 * based shape regressor can be dropped in behind this interface.
 */
export const bodyEstimator: BodyEstimator = {
  async estimate({ heightCm, current }) {
    return bodyFromHeight(heightCm, { skin: current.skin, hair: current.hair, hairColor: current.hairColor });
  },
};

export interface GarmentAnalysis {
  color: string;
  /** Fabric-only texture ready for projection; absent when extraction was not reliable. */
  textureUri?: string;
}

export interface GarmentAnalyzer {
  analyze(imageUri: string): Promise<GarmentAnalysis>;
}

/**
 * On-device analysis: backdrop keying + silhouette-normalised texture + fabric colour.
 * Classical image processing, no learned model; garment type is chosen by the user.
 * A segmentation network can replace this behind the same interface.
 */
export const garmentAnalyzer: GarmentAnalyzer = {
  async analyze(imageUri) {
    try {
      const { uri, color } = await extractGarmentTexture(imageUri);
      return { color, textureUri: uri };
    } catch {
      return { color: '#8A8A92' };
    }
  },
};

export interface HdReconstructor {
  readonly available: boolean;
  /** Sends the garment photo to a stateless server and returns a mesh asset URI. */
  reconstruct(garment: Garment): Promise<string>;
}

/** Opt-in cloud path. No endpoint is configured in this build, so it is never invoked. */
export const hdReconstructor: HdReconstructor = {
  available: false,
  async reconstruct() {
    throw new Error('HD reconstruction endpoint is not configured');
  },
};

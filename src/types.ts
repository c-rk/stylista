import type { GarmentScan } from '@/vision/garment';

export type HairStyle = 'none' | 'short' | 'long';

/** Body measurements in centimetres. */
export interface BodyParams {
  height: number;
  chest: number;
  waist: number;
  hips: number;
  /** Shoulder breadth (acromion to acromion). */
  shoulders: number;
  inseam: number;
  /** Body build blend: 0 = female, 1 = male. */
  gender?: number;
  skin: string;
  hair: HairStyle;
  hairColor: string;
}

export type GarmentKind =
  | 'top'
  | 'outerwear'
  | 'dress'
  | 'trousers'
  | 'skirt'
  | 'sneaker'
  | 'boot'
  | 'hat'
  | 'glasses'
  | 'necklace'
  | 'bag';

export type Category = 'tops' | 'dresses' | 'bottoms' | 'shoes' | 'accessories';

/** One garment per slot can be worn at a time. */
export type Slot = 'top' | 'outer' | 'bottom' | 'dress' | 'shoes' | 'hat' | 'glasses' | 'necklace' | 'bag';

export type TextureMode = 'solid' | 'fabric' | 'print';

/** Normalised 0..1 shape controls. Meaning depends on kind. */
export interface GarmentShape {
  sleeve: number;
  length: number;
  fit: number;
  flare: number;
}

export interface Garment {
  id: string;
  name: string;
  kind: GarmentKind;
  color: string;
  /** Original photo, used for thumbnails. */
  imageUri?: string;
  /** Background-keyed, silhouette-normalised texture derived from the photo. */
  textureUri?: string;
  /** Silhouette structure extracted from the photo; drives the 3D drape. */
  scan?: GarmentScan;
  /** RGBA atlas (front | back) the scan refers to. */
  atlasUri?: string;
  /** Size adjustment relative to an exact fit; 1 = fitted to the wearer. */
  size?: number;
  textureMode: TextureMode;
  shape: GarmentShape;
  createdAt: number;
  starter?: boolean;
}

export interface Outfit {
  id: string;
  name: string;
  garmentIds: string[];
  createdAt: number;
}

export type Worn = Partial<Record<Slot, string>>;

export interface Settings {
  units: 'cm' | 'in';
  voiceGuidance: boolean;
  hdCloud: boolean;
}

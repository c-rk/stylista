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

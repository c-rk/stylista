import type { BodyParams, Category, Garment, GarmentKind, GarmentShape, Slot } from '@/types';

export interface KindInfo {
  label: string;
  category: Category;
  slot: Slot;
  icon: string;
  /** Shape controls exposed in the editor, with labels. */
  controls: Partial<Record<keyof GarmentShape, string>>;
  defaults: GarmentShape;
  /** Camera focus used while editing. */
  focus: 'full' | 'upper' | 'lower' | 'feet' | 'head';
}

const s = (sleeve: number, length: number, fit: number, flare: number): GarmentShape => ({ sleeve, length, fit, flare });

export const KINDS: Record<GarmentKind, KindInfo> = {
  top: { label: 'Top', category: 'tops', slot: 'top', icon: 'shirt-outline', controls: { sleeve: 'Sleeve', length: 'Length', fit: 'Looseness' }, defaults: s(0.3, 0.55, 0.25, 0), focus: 'upper' },
  outerwear: { label: 'Jacket / Coat', category: 'tops', slot: 'outer', icon: 'layers-outline', controls: { sleeve: 'Sleeve', length: 'Length', fit: 'Looseness' }, defaults: s(1, 0.7, 0.5, 0), focus: 'upper' },
  dress: { label: 'Dress', category: 'dresses', slot: 'dress', icon: 'woman-outline', controls: { sleeve: 'Sleeve', length: 'Length', fit: 'Looseness', flare: 'Flare' }, defaults: s(0.15, 0.5, 0.15, 0.45), focus: 'full' },
  trousers: { label: 'Trousers / Shorts', category: 'bottoms', slot: 'bottom', icon: 'reorder-two-outline', controls: { length: 'Length', fit: 'Leg width' }, defaults: s(0, 1, 0.3, 0), focus: 'lower' },
  skirt: { label: 'Skirt', category: 'bottoms', slot: 'bottom', icon: 'triangle-outline', controls: { length: 'Length', flare: 'Flare' }, defaults: s(0, 0.4, 0.2, 0.5), focus: 'lower' },
  sneaker: { label: 'Shoes', category: 'shoes', slot: 'shoes', icon: 'footsteps-outline', controls: {}, defaults: s(0, 0, 0, 0), focus: 'feet' },
  boot: { label: 'Boots', category: 'shoes', slot: 'shoes', icon: 'footsteps-outline', controls: { length: 'Shaft height' }, defaults: s(0, 0.4, 0, 0), focus: 'feet' },
  hat: { label: 'Hat', category: 'accessories', slot: 'hat', icon: 'sunny-outline', controls: { flare: 'Brim' }, defaults: s(0, 0, 0, 0.6), focus: 'head' },
  glasses: { label: 'Glasses', category: 'accessories', slot: 'glasses', icon: 'glasses-outline', controls: { fit: 'Lens size' }, defaults: s(0, 0, 0.5, 0), focus: 'head' },
  necklace: { label: 'Necklace', category: 'accessories', slot: 'necklace', icon: 'ellipse-outline', controls: { length: 'Drop' }, defaults: s(0, 0.4, 0, 0), focus: 'upper' },
  bag: { label: 'Bag', category: 'accessories', slot: 'bag', icon: 'bag-handle-outline', controls: { fit: 'Size' }, defaults: s(0, 0, 0.5, 0), focus: 'full' },
};

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'tops', label: 'Tops' },
  { id: 'dresses', label: 'Dresses' },
  { id: 'bottoms', label: 'Bottoms' },
  { id: 'shoes', label: 'Shoes' },
  { id: 'accessories', label: 'Accessories' },
];

export const KIND_ORDER: GarmentKind[] = ['top', 'outerwear', 'dress', 'trousers', 'skirt', 'sneaker', 'boot', 'hat', 'glasses', 'necklace', 'bag'];

export const SKIN_TONES = ['#F3D9C4', '#E6BE9C', '#CF9E76', '#A8754F', '#7A4F33', '#4E3222', '#C9C6CF'];
export const HAIR_COLORS = ['#1B1714', '#4A3324', '#8A5A33', '#C9A26B', '#B5482E', '#D9D6D2'];
export const FABRIC_COLORS = ['#F4F1EC', '#17171B', '#2E3A59', '#7C8C6E', '#B5482E', '#E3B7A0', '#C9A26B', '#6E5A8A', '#3F6E7A', '#D94F70'];

/** Population-average proportions used as defaults and by the height-based estimator. */
export function bodyFromHeight(height: number, base?: Partial<BodyParams>): BodyParams {
  return {
    height,
    chest: Math.round(height * 0.545),
    waist: Math.round(height * 0.46),
    hips: Math.round(height * 0.565),
    shoulders: Math.round(height * 0.235),
    inseam: Math.round(height * 0.455),
    gender: 0,
    skin: SKIN_TONES[1],
    hair: 'short',
    hairColor: HAIR_COLORS[0],
    ...base,
  };
}

export const BODY_LIMITS: Record<'height' | 'chest' | 'waist' | 'hips' | 'shoulders' | 'inseam', [number, number]> = {
  height: [140, 210],
  chest: [70, 140],
  waist: [55, 135],
  hips: [75, 145],
  shoulders: [32, 54],
  inseam: [60, 100],
};

const starter = (id: string, name: string, kind: GarmentKind, color: string, shape?: Partial<GarmentShape>): Garment => ({
  id,
  name,
  kind,
  color,
  shape: { ...KINDS[kind].defaults, ...shape },
  createdAt: 0,
  starter: true,
});

export const STARTER_GARMENTS: Garment[] = [
  starter('st-tee', 'Ivory tee', 'top', '#F1ECE2'),
  starter('st-knit', 'Moss knit', 'top', '#6F7F63', { sleeve: 1, fit: 0.45, length: 0.6 }),
  starter('st-coat', 'Camel coat', 'outerwear', '#B88A56', { length: 1 }),
  starter('st-dress', 'Noir slip dress', 'dress', '#1C1B20', { sleeve: 0, length: 0.62, flare: 0.35 }),
  starter('st-denim', 'Indigo denim', 'trousers', '#2F3E5E'),
  starter('st-skirt', 'Rust midi skirt', 'skirt', '#A6492F', { length: 0.6 }),
  starter('st-sneaker', 'White sneakers', 'sneaker', '#F2F0EB'),
  starter('st-boot', 'Black boots', 'boot', '#19181B'),
  starter('st-hat', 'Sand hat', 'hat', '#D8C3A0'),
  starter('st-glasses', 'Black frames', 'glasses', '#111114'),
  starter('st-necklace', 'Gold chain', 'necklace', '#D9B25F'),
  starter('st-bag', 'Cognac tote', 'bag', '#8A4B2A'),
];

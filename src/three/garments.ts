import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { Garment, TextureMode } from '@/types';
import { BodyShape, footGeometry } from './body';
import { lerp, loft, Ring, smoothstep, span } from './loft';

export type PartMaterial = 'main' | 'trim' | 'sole' | 'lens' | 'metal';
export interface Part {
  geometry: THREE.BufferGeometry;
  material: PartMaterial;
}

/** Clearance between skin and cloth per layer, metres. */
const LAYER = { trousers: 0.006, skirt: 0.008, top: 0.011, dress: 0.011, outerwear: 0.024 } as const;

/**
 * Cross-section of a garment hanging from the torso. Above the hips it follows the body
 * (relaxed toward a straight box as `fit` grows); below the hips it becomes a skirt cone
 * that always encloses both legs.
 */
function shellRing(s: BodyShape, y: number, off: number, fit: number, flare: number): Ring {
  const { hip, chest, armpit } = s.y;
  const yy = Math.max(y, hip);
  const t = s.torso(yy);
  const c = s.torso(chest);
  const looseA = Math.max(s.hipA, c.a);
  const looseB = Math.max(s.hipB, c.b);
  const w = fit * 0.85 * (1 - smoothstep(chest, armpit, yy));
  let a = lerp(t.a, Math.max(t.a, looseA), w) + off;
  let b = lerp(t.b, Math.max(t.b, looseB), w) + off;
  if (y < hip) {
    const d = hip - y;
    const l = s.leg(1, Math.max(y, 0.02 * s.H));
    a = Math.max(a + flare * d * 0.5, l.cx + l.a + off);
    b = Math.max(b + flare * d * 0.42, l.b + off);
  }
  return { y, cx: 0, cz: t.cz, a, b };
}

function sleeves(s: BodyShape, amount: number, off: number): THREE.BufferGeometry[] {
  if (amount < 0.03) return [];
  const { armJoint, armTop, wrist } = s.y;
  const end = lerp(armJoint - 0.05 * s.H, wrist + 0.012 * s.H, amount);
  return [1, -1].map((side) =>
    loft(
      span(end, armTop + off * 0.8, 0.012 * s.H).map((y) => {
        const r = s.arm(side, Math.min(y, armTop));
        const cap = y > armJoint ? Math.sqrt(Math.max(0, 1 - ((y - armJoint) / (armTop + off - armJoint)) ** 2)) : 1;
        const base = s.arm(side, Math.min(y, armJoint));
        return { ...r, y, a: (base.a + off) * cap, b: (base.b + off) * cap };
      }),
      { segments: 20 },
    ),
  );
}

function upper(s: BodyShape, g: Garment, base: number, hem: number, flare: number): Part[] {
  const off = base + g.shape.fit * 0.022;
  const rings = span(hem, s.y.neckOpen, 0.011 * s.H).map((y) => shellRing(s, y, off, g.shape.fit, flare));
  const body = loft(rings, { segments: 44, power: 2.25 });
  return [body, ...sleeves(s, g.shape.sleeve, off + g.shape.fit * 0.012)].map((geometry) => ({ geometry, material: 'main' }));
}

function trousers(s: BodyShape, g: Garment): Part[] {
  const { H, y } = s;
  const off = LAYER.trousers;
  const parts: THREE.BufferGeometry[] = [
    loft(
      span(y.torsoBottom - off, y.waist + 0.012 * H, 0.011 * H).map((v) => {
        const t = s.torso(Math.max(v, y.torsoBottom));
        return { ...t, y: v, a: t.a + off, b: t.b + off };
      }),
      { segments: 44, power: 2.25 },
    ),
  ];
  const hem = lerp(y.crotch - 0.07 * H, y.ankle + 0.012 * H, g.shape.length);
  const wide = s.hipA * 0.5 * 0.78;
  for (const side of [1, -1]) {
    parts.push(
      loft(
        span(hem, y.legTop, 0.012 * H).map((v) => {
          const l = s.leg(side, v);
          const k = g.shape.fit * (1 - smoothstep(y.crotch - 0.12 * H, y.crotch, v));
          return { ...l, a: Math.max(l.a, lerp(l.a, wide, k)) + off, b: Math.max(l.b, lerp(l.b, wide * 1.1, k)) + off };
        }),
        { segments: 26 },
      ),
    );
  }
  return parts.map((geometry) => ({ geometry, material: 'main' }));
}

function skirt(s: BodyShape, g: Garment): Part[] {
  const { H, y } = s;
  const hem = lerp(y.crotch - 0.05 * H, 0.1 * H, g.shape.length);
  const rings = span(hem, y.waist + 0.014 * H, 0.011 * H).map((v) => shellRing(s, v, LAYER.skirt, 0, g.shape.flare));
  return [{ geometry: loft(rings, { segments: 48, power: 2.2 }), material: 'main' }];
}

function shoes(s: BodyShape, g: Garment): Part[] {
  const parts: Part[] = [];
  for (const side of [1, -1]) {
    const f = s.foot(side);
    parts.push({ geometry: footGeometry(f, 1.22), material: 'main' });
    const sole = new THREE.SphereGeometry(1, 20, 10);
    sole.scale(f.w * 1.22, 0.008 * s.H, f.len * 1.2);
    sole.translate(f.x, 0.006 * s.H, f.z);
    parts.push({ geometry: sole, material: 'sole' });
    const top = g.kind === 'boot' ? lerp(0.1 * s.H, s.y.knee - 0.03 * s.H, g.shape.length) : 0.062 * s.H;
    parts.push({
      geometry: loft(
        span(0.02 * s.H, top, 0.01 * s.H).map((v) => {
          const l = s.leg(side, v);
          return { ...l, a: l.a + 0.007, b: l.b + 0.007 };
        }),
        { segments: 22 },
      ),
      material: 'main',
    });
  }
  return parts;
}

function hat(s: BodyShape, g: Garment): Part[] {
  const { cy, cz, a, b, h } = s.head;
  const y0 = cy + h * 0.3;
  const top = cy + h + 0.012 * s.H;
  const brim = lerp(0.004, 0.095, g.shape.flare);
  const ca = a * 1.1;
  const cb = b * 1.08;
  const rings: Ring[] = [
    { y: y0 - brim * 0.12, cx: 0, cz, a: ca + brim, b: cb + brim },
    { y: y0, cx: 0, cz, a: ca + brim * 0.25, b: cb + brim * 0.25 },
    { y: y0 + 0.004, cx: 0, cz, a: ca, b: cb },
  ];
  for (let k = 1; k <= 8; k++) {
    const t = k / 8;
    const r = Math.cos(t * t * Math.PI * 0.5);
    rings.push({ y: lerp(y0 + 0.004, top, Math.sin((t * Math.PI) / 2)), cx: 0, cz, a: ca * lerp(0.9, 1, r) * (t === 1 ? 0.001 : Math.max(r, 0.35) ** 0.4), b: cb * lerp(0.9, 1, r) * (t === 1 ? 0.001 : Math.max(r, 0.35) ** 0.4) });
  }
  return [{ geometry: loft(rings, { segments: 40 }), material: 'main' }];
}

function glasses(s: BodyShape, g: Garment): Part[] {
  const { cy, cz, a, b } = s.head;
  const H = s.H;
  const r = lerp(0.0115, 0.018, g.shape.fit) * H;
  const ex = r + 0.0035 * H;
  const z = cz + b * Math.sqrt(1 - (ex / a) ** 2) + 0.004 * H;
  const ey = cy + 0.004 * H;
  const tube = 0.0014 * H;
  const parts: Part[] = [];
  for (const side of [1, -1]) {
    const frame = new THREE.TorusGeometry(r, tube, 8, 32);
    frame.translate(side * ex, ey, z);
    parts.push({ geometry: frame, material: 'main' });
    const lens = new THREE.CircleGeometry(r, 28);
    lens.translate(side * ex, ey, z);
    parts.push({ geometry: lens, material: 'lens' });
    const len = b * 1.05;
    const temple = new THREE.BoxGeometry(tube * 1.6, tube * 1.6, len);
    temple.translate(0, 0, -len / 2);
    temple.rotateY(side * -0.06);
    temple.translate(side * (ex + r), ey, z);
    parts.push({ geometry: temple, material: 'main' });
  }
  const bridge = new THREE.BoxGeometry(2 * (ex - r) + tube, tube * 1.6, tube * 1.6);
  bridge.translate(0, ey + r * 0.2, z);
  parts.push({ geometry: bridge, material: 'main' });
  return parts;
}

function necklace(s: BodyShape, g: Garment): Part[] {
  const H = s.H;
  const R = s.neckR * 1.3 + g.shape.length * 0.05 * H;
  const tilt = 0.5 + g.shape.length * 0.35;
  const ring = new THREE.TorusGeometry(R, 0.0022 * H, 8, 64);
  ring.rotateX(Math.PI / 2);
  ring.scale(1, 1, 1.12);
  ring.rotateX(tilt);
  const napeY = s.y.neckBase + 0.016 * H;
  ring.translate(0, napeY - R * Math.sin(tilt) * 1.12, -s.neckR * 1.05 + R * Math.cos(tilt) * 1.12 + 0.012 * H);
  const pendant = new THREE.SphereGeometry(0.006 * H, 14, 10);
  pendant.translate(0, napeY - 2 * R * Math.sin(tilt) * 1.12, -s.neckR * 1.05 + 2 * R * Math.cos(tilt) * 1.12 + 0.014 * H);
  return [
    { geometry: ring, material: 'metal' },
    { geometry: pendant, material: 'metal' },
  ];
}

function bag(s: BodyShape, g: Garment): Part[] {
  const hand = s.arm(-1, s.y.wrist - 0.06 * s.H);
  const W = lerp(0.2, 0.36, g.shape.fit);
  const Ht = W * 0.82;
  const D = W * 0.3;
  const drop = 0.12;
  const x = hand.cx - D * 0.5 - 0.012;
  const box = new RoundedBoxGeometry(D, Ht, W, 4, D * 0.3);
  box.translate(x, hand.y - drop - Ht / 2, hand.cz + 0.01);
  const handle = new THREE.TorusGeometry(1, 0.045, 8, 28, Math.PI);
  handle.rotateY(Math.PI / 2);
  handle.scale(1, drop, W * 0.3);
  handle.translate(x, hand.y - drop, hand.cz + 0.01);
  return [
    { geometry: box, material: 'main' },
    { geometry: handle, material: 'trim' },
  ];
}

/**
 * Planar front projection: maps the garment photo onto the cloth as seen from the front
 * (mirrored on the back). 'fabric' repeats a swatch at a fixed physical scale instead.
 */
function project(parts: Part[], mode: TextureMode) {
  const main = parts.filter((p) => p.material === 'main');
  if (!main.length) return;
  main[0].geometry.computeBoundingBox();
  const box = main[0].geometry.boundingBox!.clone();
  if (mode === 'fabric') for (const p of main.slice(1)) box.union(p.geometry.computeBoundingBox() ?? p.geometry.boundingBox!);
  const w = box.max.x - box.min.x || 1;
  const h = box.max.y - box.min.y || 1;
  const tile = 0.32;
  for (const { geometry } of main) {
    const pos = geometry.attributes.position;
    const nor = geometry.attributes.normal;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const sign = nor && nor.getZ(i) < -0.2 ? -1 : 1;
      if (mode === 'fabric') {
        uv[i * 2] = pos.getX(i) / tile;
        uv[i * 2 + 1] = pos.getY(i) / tile;
      } else {
        const u = (pos.getX(i) - box.min.x) / w;
        uv[i * 2] = sign < 0 ? 1 - u : u;
        uv[i * 2 + 1] = (pos.getY(i) - box.min.y) / h;
      }
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
}

export function buildGarment(s: BodyShape, g: Garment): Part[] {
  const { H, y } = s;
  let parts: Part[];
  switch (g.kind) {
    case 'top':
      parts = upper(s, g, LAYER.top, lerp(y.waist + 0.05 * H, y.crotch + 0.005 * H, g.shape.length), 0.1);
      break;
    case 'outerwear':
      parts = upper(s, g, LAYER.outerwear, lerp(y.waist, y.knee - 0.04 * H, g.shape.length), 0.12);
      break;
    case 'dress':
      parts = upper(s, g, LAYER.dress, lerp(y.crotch - 0.05 * H, 0.08 * H, g.shape.length), g.shape.flare);
      break;
    case 'trousers':
      parts = trousers(s, g);
      break;
    case 'skirt':
      parts = skirt(s, g);
      break;
    case 'sneaker':
    case 'boot':
      parts = shoes(s, g);
      break;
    case 'hat':
      parts = hat(s, g);
      break;
    case 'glasses':
      parts = glasses(s, g);
      break;
    case 'necklace':
      parts = necklace(s, g);
      break;
    case 'bag':
      parts = bag(s, g);
      break;
  }
  if (g.imageUri && g.textureMode !== 'solid') project(parts, g.textureMode);
  return parts;
}

/** Rigid accessories and shoes, built parametrically and attached to body anchors. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { Garment } from '@/types';
import type { Anchors } from './human/anchors';
import { lerp, loft, Ring, span } from './loft';

export type PartMaterial = 'main' | 'trim' | 'sole' | 'lens' | 'metal';
export interface Part {
  geometry: THREE.BufferGeometry;
  material: PartMaterial;
}

/** Ellipsoid with a flattened underside. */
function shoeShell(f: Anchors['foot'][1], scale: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 22, 14);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    const rise = y > 0 ? 1 - 0.4 * Math.max(0, z) : 0.999;
    p.setXYZ(i, p.getX(i) * f.w * scale, y * f.h * scale * rise, z * f.len * (scale + 0.06));
  }
  g.computeVertexNormals();
  g.translate(f.x, f.h * scale, f.z);
  return g;
}

function shoes(a: Anchors, g: Garment): Part[] {
  const parts: Part[] = [];
  for (const side of [1, -1] as const) {
    const f = a.foot[side];
    parts.push({ geometry: shoeShell(f, g.kind === 'boot' ? 1.24 : 1.2), material: 'main' });
    const sole = new THREE.SphereGeometry(1, 20, 10);
    sole.scale(f.w * 1.24, 0.0075 * a.H, f.len * 1.28);
    sole.translate(f.x, 0.005 * a.H, f.z);
    parts.push({ geometry: sole, material: 'sole' });
    if (g.kind === 'boot') {
      // Shaft: starts above the ankle bone, where the leg section no longer includes the foot.
      const top = lerp(0.12 * a.H, a.kneeY - 0.03 * a.H, g.shape.length);
      parts.push({
        geometry: loft(
          span(0.062 * a.H, top, 0.01 * a.H).map((y): Ring => {
            const l = a.leg(side, y);
            return { y, cx: l.cx, cz: l.cz, a: l.a + 0.008, b: l.b + 0.008 };
          }),
          { segments: 24 },
        ),
        material: 'main',
      });
    }
  }
  return parts;
}

function hat(an: Anchors, g: Garment): Part[] {
  const { cy, cz, a, b, h } = an.head;
  const y0 = cy + h * 0.42;
  const top = cy + h + 0.014 * an.H;
  const brim = lerp(0.004, 0.095, g.shape.flare);
  const ca = a * 1.08, cb = b * 1.06;
  const rings: Ring[] = [
    { y: y0 - brim * 0.12, cx: 0, cz, a: ca + brim, b: cb + brim },
    { y: y0, cx: 0, cz, a: ca + brim * 0.25, b: cb + brim * 0.25 },
    { y: y0 + 0.004, cx: 0, cz, a: ca, b: cb },
  ];
  for (let k = 1; k <= 8; k++) {
    const t = k / 8;
    const r = t === 1 ? 0.001 : Math.pow(Math.cos((t * t * Math.PI) / 2), 0.4);
    rings.push({ y: lerp(y0 + 0.004, top, Math.sin((t * Math.PI) / 2)), cx: 0, cz, a: ca * r, b: cb * r });
  }
  return [{ geometry: loft(rings, { segments: 40 }), material: 'main' }];
}

function glasses(an: Anchors, g: Garment): Part[] {
  const H = an.H;
  const r = lerp(0.0115, 0.018, g.shape.fit) * H;
  const ex = Math.max(an.eyes.dx, r + 0.003 * H);
  const z = an.eyes.z + 0.012 * H;
  const ey = an.eyes.y;
  const tube = 0.0013 * H;
  const parts: Part[] = [];
  for (const side of [1, -1]) {
    const frame = new THREE.TorusGeometry(r, tube, 8, 32);
    frame.translate(side * ex, ey, z);
    parts.push({ geometry: frame, material: 'main' });
    const lens = new THREE.CircleGeometry(r, 28);
    lens.translate(side * ex, ey, z);
    parts.push({ geometry: lens, material: 'lens' });
    const len = an.head.b * 1.15;
    const temple = new THREE.BoxGeometry(tube * 1.6, tube * 1.6, len);
    temple.translate(0, 0, -len / 2);
    temple.rotateY(side * 0.1);
    temple.translate(side * (ex + r), ey, z);
    parts.push({ geometry: temple, material: 'main' });
  }
  const bridge = new THREE.BoxGeometry(Math.max(0.004, 2 * (ex - r)) + tube, tube * 1.6, tube * 1.6);
  bridge.translate(0, ey + r * 0.2, z);
  parts.push({ geometry: bridge, material: 'main' });
  return parts;
}

function necklace(an: Anchors, g: Garment): Part[] {
  const H = an.H;
  const R = an.neck.r * 1.05 + g.shape.length * 0.05 * H;
  const tilt = 0.55 + g.shape.length * 0.35;
  const ring = new THREE.TorusGeometry(R, 0.002 * H, 8, 64);
  ring.rotateX(Math.PI / 2);
  ring.scale(1, 1, 1.1);
  ring.rotateX(tilt);
  const napeY = an.neck.y + 0.03 * H;
  const napeZ = an.neck.z - an.neck.r * 0.75;
  ring.translate(0, napeY - R * Math.sin(tilt) * 1.1, napeZ + R * Math.cos(tilt) * 1.1);
  const pendant = new THREE.SphereGeometry(0.0055 * H, 14, 10);
  pendant.translate(0, napeY - 2 * R * Math.sin(tilt) * 1.1, napeZ + 2 * R * Math.cos(tilt) * 1.1 + 0.004);
  return [
    { geometry: ring, material: 'metal' },
    { geometry: pendant, material: 'metal' },
  ];
}

function bag(an: Anchors, g: Garment): Part[] {
  const [hx, hy, hz] = an.hand[-1];
  const W = lerp(0.2, 0.36, g.shape.fit);
  const Ht = W * 0.82, D = W * 0.3, drop = 0.11;
  const box = new RoundedBoxGeometry(D, Ht, W, 4, D * 0.3);
  box.translate(hx, hy - drop - Ht / 2, hz);
  const handle = new THREE.TorusGeometry(1, 0.045, 8, 28, Math.PI);
  handle.rotateY(Math.PI / 2);
  handle.scale(1, drop, W * 0.3);
  handle.translate(hx, hy - drop, hz);
  return [
    { geometry: box, material: 'main' },
    { geometry: handle, material: 'trim' },
  ];
}

export function buildAccessory(a: Anchors, g: Garment): Part[] {
  switch (g.kind) {
    case 'sneaker':
    case 'boot':
      return shoes(a, g);
    case 'hat':
      return hat(a, g);
    case 'glasses':
      return glasses(a, g);
    case 'necklace':
      return necklace(a, g);
    case 'bag':
      return bag(a, g);
    default:
      return [];
  }
}

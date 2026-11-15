import * as THREE from 'three';

import type { BodyParams } from '@/types';
import { clamp, curve, loft, Ring, span } from './loft';

/** Half-axes of an ellipse with circumference C and depth/width ratio r (Ramanujan). */
function ellipse(C: number, r: number): [number, number] {
  const a = C / (Math.PI * (3 * (1 + r) - Math.sqrt((3 + r) * (1 + 3 * r))));
  return [a, a * r];
}

export interface BodyShape {
  H: number;
  y: {
    torsoBottom: number;
    crotch: number;
    hip: number;
    waist: number;
    chest: number;
    armpit: number;
    shoulder: number;
    neckOpen: number;
    neckBase: number;
    neckTop: number;
    knee: number;
    ankle: number;
    legTop: number;
    armTop: number;
    armJoint: number;
    wrist: number;
    handTip: number;
  };
  hipA: number;
  hipB: number;
  neckR: number;
  torso: (y: number) => Ring;
  /** side: +1 or -1 along x. */
  arm: (side: number, y: number) => Ring;
  leg: (side: number, y: number) => Ring;
  head: { cy: number; cz: number; a: number; b: number; h: number };
  foot: (side: number) => { x: number; y: number; z: number; w: number; h: number; len: number };
}

/** Derives the analytic body surface (metres, y up, feet on y=0, facing +z) from measurements. */
export function computeBody(p: BodyParams): BodyShape {
  const H = p.height / 100;
  const [chestA, chestB] = ellipse(p.chest / 100, 0.74);
  const [waistA, waistB] = ellipse(p.waist / 100, 0.78);
  const [hipA, hipB] = ellipse(p.hips / 100, 0.72);
  const shoulderHalf = p.shoulders / 200;
  const limb = clamp(Math.pow((p.chest + p.waist + p.hips) / (p.height * 1.57), 0.8), 0.78, 1.4);
  const neckR = 0.031 * H * Math.sqrt(limb);

  const crotch = clamp(p.inseam / 100, 0.38 * H, 0.52 * H);
  const hip = crotch + 0.05 * H;
  const chest = 0.72 * H;
  const waist = Math.min(crotch + 0.155 * H, chest - 0.06 * H);
  const armpit = 0.765 * H;
  const shoulder = 0.815 * H;
  const neckBase = 0.852 * H;
  const neckTop = 0.885 * H;
  const torsoBottom = crotch - 0.03 * H;

  const tc: [number, number, number, number][] = [
    [torsoBottom, 0.001, 0.001, 0],
    [crotch - 0.02 * H, hipA * 0.5, hipB * 0.55, -0.004 * H],
    [crotch + 0.014 * H, hipA * 0.975, hipB * 0.9, -0.006 * H],
    [hip, hipA, hipB, -0.008 * H],
    [waist, waistA, waistB, 0],
    [chest, chestA, chestB, 0.006 * H],
    [armpit, Math.max(chestA * 0.98, shoulderHalf * 0.8), chestB * 0.92, 0.004 * H],
    [shoulder, Math.max(shoulderHalf * 0.9, chestA * 0.9), chestB * 0.72, 0],
    [0.836 * H, shoulderHalf * 0.5, chestB * 0.52, 0],
    [neckBase, neckR * 1.25, neckR * 1.2, 0],
    [neckTop, neckR, neckR, 0.004 * H],
    [0.91 * H, neckR * 0.95, neckR * 0.95, 0.006 * H],
  ];
  const tA = curve(tc.map((c) => [c[0], c[1]]));
  const tB = curve(tc.map((c) => [c[0], c[2]]));
  const tZ = curve(tc.map((c) => [c[0], c[3]]));
  const torso = (y: number): Ring => ({ y, cx: 0, cz: tZ(y), a: tA(y), b: tB(y) });

  // Arms hang in a relaxed A-pose.
  const rU = 0.028 * H * limb;
  const jointX = Math.max(shoulderHalf * 0.9, chestA * 0.9) - rU * 0.5;
  const armJoint = shoulder - rU * 0.6;
  const armTop = armJoint + rU;
  const elbow = armJoint - 0.17 * H;
  const wrist = armJoint - 0.325 * H;
  const handTip = wrist - 0.105 * H;
  const slope = Math.tan((13 * Math.PI) / 180);
  const aA = curve([
    [handTip, 0.002 * H],
    [handTip + 0.012 * H, 0.008 * H],
    [wrist - 0.07 * H, 0.011 * H],
    [wrist - 0.035 * H, 0.012 * H],
    [wrist, 0.0155 * H * Math.sqrt(limb)],
    [elbow - 0.04 * H, 0.0235 * H * limb],
    [elbow, 0.0225 * H * limb],
    [armJoint - 0.08 * H, rU * 0.97],
    [armJoint, rU],
  ]);
  const aB = curve([
    [handTip, 0.004 * H],
    [handTip + 0.012 * H, 0.017 * H],
    [wrist - 0.07 * H, 0.024 * H],
    [wrist - 0.035 * H, 0.026 * H],
    [wrist, 0.0165 * H * Math.sqrt(limb)],
    [elbow - 0.04 * H, 0.0245 * H * limb],
    [elbow, 0.0235 * H * limb],
    [armJoint - 0.08 * H, rU * 1.05],
    [armJoint, rU * 1.08],
  ]);
  const arm = (side: number, y: number): Ring => {
    const cap = y > armJoint ? Math.sqrt(Math.max(0, 1 - ((y - armJoint) / rU) ** 2)) : 1;
    return {
      y,
      cx: side * (jointX + Math.max(0, armJoint - y) * slope),
      cz: -0.004 * H + Math.max(0, armJoint - y) * 0.04,
      a: aA(y) * cap,
      b: aB(y) * cap,
    };
  };

  const knee = 0.285 * H;
  const ankle = 0.055 * H;
  const legTop = crotch + 0.045 * H;
  const legBottom = 0.02 * H;
  const thigh = hipA * 0.5;
  const footX = 0.05 * H;
  const lA = curve([
    [legBottom, 0.019 * H],
    [ankle, 0.0195 * H * Math.sqrt(limb)],
    [0.215 * H, 0.031 * H * limb],
    [knee, 0.03 * H * limb],
    [crotch - 0.1 * H, thigh * 0.82],
    [crotch, thigh * 0.97],
    [legTop, thigh * 0.9],
  ]);
  const lB = curve([
    [legBottom, 0.024 * H],
    [ankle, 0.022 * H * Math.sqrt(limb)],
    [0.215 * H, 0.034 * H * limb],
    [knee, 0.032 * H * limb],
    [crotch - 0.1 * H, thigh * 0.9],
    [crotch, hipB * 0.87],
    [legTop, hipB * 0.84],
  ]);
  const lX = curve([
    [legBottom, footX],
    [knee, (footX + thigh) / 2],
    [crotch, thigh + 0.002],
    [legTop, thigh],
  ]);
  const lZ = curve([
    [legBottom, 0],
    [0.215 * H, -0.006 * H],
    [knee, 0.002 * H],
    [legTop, -0.006 * H],
  ]);
  const leg = (side: number, y: number): Ring => ({ y, cx: side * lX(y), cz: lZ(y), a: lA(y), b: lB(y) });

  const hh = 0.071 * H;
  return {
    H,
    y: { torsoBottom, crotch, hip, waist, chest, armpit, shoulder, neckOpen: shoulder + 0.024 * H, neckBase, neckTop, knee, ankle, legTop, armTop, armJoint, wrist, handTip },
    hipA,
    hipB,
    neckR,
    torso,
    arm,
    leg,
    head: { cy: H - hh, cz: 0.008 * H, a: 0.047 * H, b: 0.057 * H, h: hh },
    foot: (side) => ({ x: side * footX, y: 0.024 * H, z: 0.036 * H, w: 0.028 * H, h: 0.024 * H, len: 0.072 * H }),
  };
}

function headRings(s: BodyShape, scale = 1, n = 22): Ring[] {
  const { cy, cz, a, b, h } = s.head;
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = -Math.cos((Math.PI * k) / n);
    const r = Math.sqrt(Math.max(0, 1 - t * t));
    const jaw = t < 0 ? t * t : 0;
    return { y: cy + t * h * scale, cx: 0, cz, a: a * r * (1 - 0.24 * jaw) * scale, b: b * r * (1 - 0.12 * jaw) * scale };
  });
}

/** Ellipsoid with a flattened underside, used for feet and shoes. */
export function footGeometry(f: { x: number; y: number; z: number; w: number; h: number; len: number }, scale = 1): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 20, 14);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const z = p.getZ(i);
    // Taller at the ankle than at the toe.
    const rise = y > 0 ? 1 - 0.45 * Math.max(0, z) : 0.999;
    p.setXYZ(i, p.getX(i) * f.w * scale * (1 - 0.15 * Math.max(0, -z)), y * f.h * scale * rise, z * f.len * scale);
  }
  g.computeVertexNormals();
  g.translate(f.x, f.y * scale, f.z);
  return g;
}

export interface BodyMeshes {
  skin: THREE.BufferGeometry[];
  hair: THREE.BufferGeometry[];
  /** Clipping plane for the first hair mesh (scalp cap). */
  hairline?: THREE.Plane;
}

export function buildBody(s: BodyShape, p: BodyParams): BodyMeshes {
  const { y, H } = s;
  const step = 0.011 * H;
  const skin: THREE.BufferGeometry[] = [];
  skin.push(loft(span(y.torsoBottom, 0.91 * H, step * 0.8).map(s.torso), { segments: 44, power: 2.12 }));
  skin.push(loft(headRings(s), { segments: 36 }));
  for (const side of [1, -1]) {
    skin.push(loft(span(y.handTip, y.armTop, step).map((v) => s.arm(side, v)), { segments: 22 }));
    skin.push(loft(span(0.02 * H, y.legTop, step).map((v) => s.leg(side, v)), { segments: 28 }));
    skin.push(footGeometry(s.foot(side)));
  }

  const hair: THREE.BufferGeometry[] = [];
  let hairline: THREE.Plane | undefined;
  if (p.hair !== 'none') {
    const { cy, cz, h, b } = s.head;
    const long = p.hair === 'long';
    hair.push(loft(headRings(s, 1.07, 26), { segments: 40 }));
    // Hairline plane: forehead at the front, nape at the back. Applied as a per-fragment clip.
    const front = new THREE.Vector3(0, cy + h * 0.5, cz + b * 0.86);
    const back = new THREE.Vector3(0, cy - h * (long ? 0.75 : 0.5), cz - b * 0.9);
    const n = new THREE.Vector3(0, front.z - back.z, -(front.y - back.y)).normalize();
    hairline = new THREE.Plane().setFromNormalAndCoplanarPoint(n, front);
    if (long) {
      const bottom = y.shoulder - 0.035 * H;
      const rings = span(bottom, cy, step).map((v): Ring => {
        const k = clamp((v - bottom) / (cy - bottom), 0, 1);
        const t = s.torso(Math.min(v, y.neckTop));
        const tip = Math.pow(Math.min(1, k * 5), 0.5);
        return {
          y: v,
          cx: 0,
          cz: cz * k + (t.cz - 0.004) * (1 - k),
          a: (s.head.a * (1.35 - 0.28 * k)) * tip,
          b: (Math.max(t.b, s.neckR * 1.5) + 0.03 * H) * (1 - k) + b * 1.07 * k,
        };
      });
      hair.push(loft(rings, { segments: 24, arc: [Math.PI * 0.94, Math.PI * 2.06] }));
    }
  }
  return { skin, hair, hairline };
}

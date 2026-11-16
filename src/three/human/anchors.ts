import { BodyFrame } from './cloth';
import { FittedBody, HumanModel, PART } from './model';

/** Attachment points for rigid accessories and shoes. */
export interface Anchors {
  H: number;
  /** Head ellipsoid: centre height/depth and half extents (a: width, b: depth, h: height). */
  head: { cy: number; cz: number; a: number; b: number; h: number };
  eyes: { y: number; z: number; dx: number };
  /** Lowest point of the face front. */
  chinY: number;
  neck: { y: number; z: number; r: number };
  hand: Record<-1 | 1, [number, number, number]>;
  foot: Record<-1 | 1, { x: number; y: number; z: number; w: number; h: number; len: number }>;
  /** Leg cross-section at a height: centre and half extents. */
  leg: (side: -1 | 1, y: number) => { cx: number; cz: number; a: number; b: number };
  kneeY: number;
}

export function anchors(model: HumanModel, fit: FittedBody, frame: BodyFrame): Anchors {
  const pos = fit.positions;
  const parts = model.array('parts') as Uint8Array;
  const body = model.array('body.vmap') as Uint16Array;
  const side = (sgn: number) => (sgn * model.meta.leftSign > 0 ? 'l' : 'r');
  const headBase = model.joint(pos, 'head')[1];

  const box = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
  const grow = (b: ReturnType<typeof box>, v: number) => {
    for (let c = 0; c < 3; c++) {
      b.min[c] = Math.min(b.min[c], pos[v * 3 + c]);
      b.max[c] = Math.max(b.max[c], pos[v * 3 + c]);
    }
  };
  const head = box();
  const feet = { [-1]: box(), 1: box() } as Record<-1 | 1, ReturnType<typeof box>>;
  const seen = new Set<number>();
  for (let k = 0; k < body.length; k++) {
    const v = body[k];
    if (seen.has(v)) continue;
    seen.add(v);
    const y = pos[v * 3 + 1];
    if (parts[v * 6 + PART.head] > 128 && y > headBase) grow(head, v);
    if (y < 0.075 * frame.H && parts[v * 6 + PART.legL] + parts[v * 6 + PART.legR] > 128) grow(feet[pos[v * 3] >= 0 ? 1 : -1], v);
  }
  const eyeV = Array.from(new Set(model.array('eyes.vmap') as Uint16Array));
  let ey = 0, ez = -Infinity, ex = 0;
  for (const v of eyeV) {
    ey += pos[v * 3 + 1] / eyeV.length;
    ez = Math.max(ez, pos[v * 3 + 2]);
    ex += Math.abs(pos[v * 3]) / eyeV.length;
  }
  const neck = model.joint(pos, 'neck');
  const neckY = neck[1];
  let chinY = Infinity;
  const frontZ = (head.min[2] + head.max[2]) / 2 + (head.max[2] - head.min[2]) * 0.2;
  for (const v of seen) if (parts[v * 6 + PART.head] > 128 && pos[v * 3 + 1] > neckY && pos[v * 3 + 2] > frontZ && Math.abs(pos[v * 3]) < 0.02) chinY = Math.min(chinY, pos[v * 3 + 1]);
  const hand = {} as Anchors['hand'];
  const foot = {} as Anchors['foot'];
  for (const sgn of [-1, 1] as const) {
    const arm = frame.arms[sgn];
    const w = model.joint(pos, `${side(sgn)}-hand`);
    hand[sgn] = [w[0] + arm.d.x * 0.07, w[1] + arm.d.y * 0.07, w[2] + arm.d.z * 0.07];
    const f = feet[sgn];
    foot[sgn] = { x: (f.min[0] + f.max[0]) / 2, y: (f.max[1] - f.min[1]) / 2, z: (f.min[2] + f.max[2]) / 2, w: (f.max[0] - f.min[0]) / 2, h: (f.max[1] - f.min[1]) / 2, len: (f.max[2] - f.min[2]) / 2 };
  }
  return {
    H: frame.H,
    head: { cy: (head.min[1] + head.max[1]) / 2, cz: (head.min[2] + head.max[2]) / 2, a: (head.max[0] - head.min[0]) / 2, b: (head.max[2] - head.min[2]) / 2, h: (head.max[1] - head.min[1]) / 2 },
    eyes: { y: ey, z: ez, dx: ex },
    chinY,
    neck: { y: neck[1], z: neck[2], r: frame.trunk.half(neck[1] + 0.02) },
    hand,
    foot,
    leg: (sgn, y) => {
      const p = frame.legs[sgn];
      return { cx: p.centreA(y), cz: p.centreB(y), a: p.half(y), b: p.depthHalf(y) };
    },
    kneeY: model.joint(pos, 'l-knee')[1],
  };
}

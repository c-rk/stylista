import * as THREE from 'three';

/** Horizontal elliptical cross-section at height y. */
export interface Ring {
  y: number;
  cx: number;
  cz: number;
  a: number;
  b: number;
}

export interface LoftOptions {
  segments?: number;
  /** Angular range in radians; 0 = +x, PI/2 = +z (front). Defaults to the full circle. */
  arc?: [number, number];
  /** Superellipse exponent; 2 = ellipse, higher = boxier. */
  power?: number;
}

/**
 * Skins a stack of rings into an indexed surface with analytic smooth normals.
 * Cost is O(rings * segments), cheap enough to rebuild on every slider tick.
 */
export function loft(rings: Ring[], { segments = 36, arc, power = 2 }: LoftOptions = {}): THREE.BufferGeometry {
  const closed = !arc;
  const [t0, t1] = arc ?? [0, Math.PI * 2];
  const cols = segments + 1;
  const rows = rings.length;
  const pos = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const e = 2 / power;

  for (let i = 0; i < rows; i++) {
    const r = rings[i];
    for (let j = 0; j < cols; j++) {
      const th = t0 + ((t1 - t0) * j) / segments;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const k = (i * cols + j) * 3;
      pos[k] = r.cx + r.a * Math.sign(c) * Math.pow(Math.abs(c), e);
      pos[k + 1] = r.y;
      pos[k + 2] = r.cz + r.b * Math.sign(s) * Math.pow(Math.abs(s), e);
      uv[(i * cols + j) * 2] = j / segments;
      uv[(i * cols + j) * 2 + 1] = i / (rows - 1);
    }
  }

  const nor = new Float32Array(rows * cols * 3);
  const P = (i: number, j: number, o: number) => pos[(i * cols + j) * 3 + o];
  for (let i = 0; i < rows; i++) {
    const iu = Math.min(i + 1, rows - 1);
    const id = Math.max(i - 1, 0);
    for (let j = 0; j < cols; j++) {
      let jn = j + 1;
      let jp = j - 1;
      if (closed) {
        if (jn > segments) jn = 1;
        if (jp < 0) jp = segments - 1;
      } else {
        jn = Math.min(jn, segments);
        jp = Math.max(jp, 0);
      }
      const ux = P(iu, j, 0) - P(id, j, 0);
      const uy = P(iu, j, 1) - P(id, j, 1);
      const uz = P(iu, j, 2) - P(id, j, 2);
      const vx = P(i, jn, 0) - P(i, jp, 0);
      const vy = P(i, jn, 1) - P(i, jp, 1);
      const vz = P(i, jn, 2) - P(i, jp, 2);
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const r = rings[i];
      const rx = P(i, j, 0) - r.cx;
      const rz = P(i, j, 2) - r.cz;
      let len = Math.hypot(nx, ny, nz);
      if (len < 1e-9 || Math.hypot(rx, rz) < 1e-5) {
        nx = 0;
        nz = 0;
        ny = i < rows / 2 ? -1 : 1;
        len = 1;
      } else if (nx * rx + nz * rz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const k = (i * cols + j) * 3;
      nor[k] = nx / len;
      nor[k + 1] = ny / len;
      nor[k + 2] = nz / len;
    }
  }

  const ascending = rings[rows - 1].y >= rings[0].y;
  const idx: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * cols + j;
      const b = a + cols;
      const c = a + 1;
      const d = b + 1;
      if (ascending) idx.push(a, b, c, c, b, d);
      else idx.push(a, c, b, c, d, b);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Monotone cubic (Fritsch–Carlson) interpolant through control points; no overshoot. */
export function curve(points: [number, number][]): (x: number) => number {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]));
  m.push(d[n - 2]);
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Evenly spaced samples from lo to hi inclusive. */
export function span(lo: number, hi: number, step: number): number[] {
  const n = Math.max(2, Math.ceil((hi - lo) / step) + 1);
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}

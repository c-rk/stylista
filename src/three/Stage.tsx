/*
 * Imperative render-loop and gesture code: camera state lives in a mutable rig object that is
 * written from touch handlers and read every frame, outside React's render cycle.
 */
/* eslint-disable react-hooks/immutability, react-hooks/refs */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import type { BodyParams, Garment, GarmentKind } from '@/types';
import { SyntheticGarment, syntheticGarment, SyntheticKind } from '@/vision/synthetic';
import { buildAccessory } from './garments';
import { Anchors, anchors as bodyAnchors } from './human/anchors';
import { bodyFrame, BodyFrame, buildCloth, Cloth, Occupancy } from './human/cloth';
import { setGeometry, skinColors } from './human/geometry';
import { loft, Ring } from './loft';
import { useHuman } from './human/load';
import type { FittedBody, HumanModel } from './human/model';

export type Focus = 'full' | 'upper' | 'lower' | 'feet' | 'head';

/** [target height, camera distance] as multiples of body height. */
const FOCUS: Record<Focus, [number, number]> = {
  full: [0.5, 2.75],
  upper: [0.7, 2.1],
  lower: [0.3, 2.5],
  feet: [0.07, 1.35],
  head: [0.92, 1.05],
};

interface Rig {
  az: number;
  el: number;
  zoom: number;
  vAz: number;
  vEl: number;
  dragging: boolean;
  idle: number;
}


function useDisposable<T extends { dispose(): void }>(items: T[]) {
  useEffect(() => () => items.forEach((i) => i.dispose()), [items]);
}

function useImageTexture(uri?: string, mipmaps = true): THREE.Texture | null {
  const [loaded, setLoaded] = useState<{ uri: string; tex: THREE.Texture } | null>(null);
  useEffect(() => {
    if (!uri) return;
    let alive = true;
    let tex: THREE.Texture | undefined;
    new THREE.TextureLoader().load(uri, (t) => {
      tex = t;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      if (!mipmaps) {
        // Mip levels would average fabric with the transparent surround at alpha edges.
        t.generateMipmaps = false;
        t.minFilter = THREE.LinearFilter;
      }
      if (alive) setLoaded({ uri, tex: t });
      else t.dispose();
    });
    return () => {
      alive = false;
      tex?.dispose();
    };
  }, [uri, mipmaps]);
  return uri && loaded?.uri === uri ? loaded.tex : null;
}

function shade(hex: string, kind: 'trim' | 'sole'): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  if (kind === 'sole') return hsl.l < 0.62 ? '#ECE8E1' : '#BFAE94';
  return '#' + c.setHSL(hsl.h, hsl.s * 0.85, hsl.l < 0.12 ? 0.22 : hsl.l * 0.62).getHexString();
}

// ---- cloth -----------------------------------------------------------------------------

/** Clearance from the skin per garment class, metres. Also the inside-out build order. */
const LAYER: Record<string, number> = { base: 0.002, trousers: 0.004, skirt: 0.005, top: 0.007, dress: 0.007, outerwear: 0.013 };
const BASE_COLOR = '#3A3A44';
const CLOTH_KINDS: GarmentKind[] = ['top', 'outerwear', 'dress', 'trousers', 'skirt'];

interface ClothItem {
  id: string;
  layer: number;
  color: string;
  size: number;
  /** Photo garments reference a stored atlas; procedural ones carry their own. */
  garment?: Garment;
  synthetic?: SyntheticGarment;
}

function dataTexture(s: SyntheticGarment): THREE.DataTexture {
  // Flip rows: data textures have their first row at v = 0, image textures at v = 1.
  const flipped = new Uint8Array(s.atlas.length);
  const stride = s.width * 4;
  for (let y = 0; y < s.height; y++) flipped.set(s.atlas.subarray(y * stride, (y + 1) * stride), (s.height - 1 - y) * stride);
  const t = new THREE.DataTexture(flipped, s.width, s.height, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const WEAVE_SCALE = new THREE.Vector2(0.35, 0.35);
let weaveTexture: THREE.DataTexture | undefined;
/** Tiling normal map of a plain weave; read through the cloth's second UV set at thread scale. */
function weaveNormals(): THREE.DataTexture {
  if (weaveTexture) return weaveTexture;
  const n = 32;
  const height = (x: number, y: number) => Math.max(Math.sin((x / n) * Math.PI * 4) * 0.5 + 0.5, Math.sin((y / n) * Math.PI * 4 + Math.PI * Math.round(x / 8)) * 0.5 + 0.5);
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = height(x + 1, y) - height(x - 1, y), dy = height(x, y + 1) - height(x, y - 1);
      const l = Math.hypot(dx, dy, 1);
      data.set([Math.round((-dx / l) * 127 + 128), Math.round((-dy / l) * 127 + 128), Math.round((1 / l) * 127 + 128), 255], (y * n + x) * 4);
    }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.channel = 1;
  t.needsUpdate = true;
  return (weaveTexture = t);
}

function ClothSurface({ cloth, map, color }: { cloth: Cloth; map: THREE.Texture; color: string }) {
  const weave = weaveNormals();
  return (
    <group>
      {[cloth.front, cloth.back].map((g, i) => (
        <mesh key={i} geometry={g} castShadow receiveShadow>
          <meshPhysicalMaterial map={map} color={color} alphaTest={0.5} roughness={0.92} sheen={0.18} sheenRoughness={0.7} sheenColor="#ffffff" normalMap={weave} normalScale={WEAVE_SCALE} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

function PhotoCloth({ item, cloth }: { item: ClothItem; cloth: Cloth }) {
  const map = useImageTexture(item.garment!.atlasUri, false);
  return map ? <ClothSurface cloth={cloth} map={map} color="#ffffff" /> : null;
}

function SyntheticCloth({ item, cloth }: { item: ClothItem; cloth: Cloth }) {
  const map = useMemo(() => dataTexture(item.synthetic!), [item.synthetic]);
  useDisposable(useMemo(() => [map], [map]));
  return <ClothSurface cloth={cloth} map={map} color={item.color} />;
}

/** All cloth layers, built inside-out so each one clears those beneath it. */
function Cloths({ garments, frame }: { garments: Garment[]; frame: BodyFrame }) {
  const items = useMemo(() => {
    const base = { sleeve: 0, length: 0, fit: 0, flare: 0 };
    // The model is never shown unclothed: fitted shorts and a tank are always on underneath.
    const list: ClothItem[] = [
      { id: '_shorts', layer: LAYER.base, color: BASE_COLOR, size: 1, synthetic: syntheticGarment('briefs', base) },
      { id: '_tank', layer: LAYER.base, color: BASE_COLOR, size: 1, synthetic: syntheticGarment('bra', base) },
    ];
    for (const g of garments) {
      if (!CLOTH_KINDS.includes(g.kind)) continue;
      const layer = LAYER[g.kind];
      if (g.scan && g.atlasUri) list.push({ id: g.id, layer, color: g.color, size: g.size ?? 1, garment: g });
      else list.push({ id: g.id, layer, color: g.color, size: g.size ?? 1, synthetic: syntheticGarment(g.kind as SyntheticKind, g.shape) });
    }
    return list.sort((a, b) => a.layer - b.layer);
  }, [garments]);

  const built = useMemo(() => {
    const under = new Occupancy();
    return items.map((item) => {
      const cloth = buildCloth(frame, item.garment?.scan ?? item.synthetic!.scan, { layer: item.layer, size: item.size, under, tight: item.layer === LAYER.base });
      under.absorb(cloth.occupied);
      return { item, cloth };
    });
  }, [items, frame]);
  useDisposable(useMemo(() => built.flatMap((b) => [b.cloth.front, b.cloth.back]), [built]));

  return (
    <group>
      {built.map(({ item, cloth }) => (item.garment ? <PhotoCloth key={item.id} item={item} cloth={cloth} /> : <SyntheticCloth key={item.id} item={item} cloth={cloth} />))}
    </group>
  );
}

function Accessory({ garment, anchors }: { garment: Garment; anchors: Anchors }) {
  const parts = useMemo(() => buildAccessory(anchors, garment), [anchors, garment]);
  useDisposable(useMemo(() => parts.map((p) => p.geometry), [parts]));
  const trim = shade(garment.color, 'trim');
  const sole = shade(garment.color, 'sole');
  return (
    <group>
      {parts.map((p, i) => (
        <mesh key={i} geometry={p.geometry} castShadow receiveShadow>
          {p.material === 'main' && <meshStandardMaterial color={garment.color} roughness={0.8} side={THREE.DoubleSide} />}
          {p.material === 'trim' && <meshStandardMaterial color={trim} roughness={0.7} />}
          {p.material === 'sole' && <meshStandardMaterial color={sole} roughness={0.8} />}
          {p.material === 'metal' && <meshStandardMaterial color={garment.color} roughness={0.28} metalness={0.45} />}
          {p.material === 'lens' && <meshStandardMaterial color="#0c0c10" roughness={0.1} transparent opacity={0.42} side={THREE.DoubleSide} />}
        </mesh>
      ))}
    </group>
  );
}

// ---- body ------------------------------------------------------------------------------

let strandTexture: THREE.DataTexture | undefined;
/**
 * Tiling normal map of fine parallel strands (variation across u, constant along v). It breaks
 * up highlights the way real hair does without cutting holes in the surface.
 */
function strandNormals(): THREE.DataTexture {
  if (strandTexture) return strandTexture;
  const w = 256, h = 8;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const raw = Array.from({ length: w }, rnd);
  // Smooth the noise a little so strands are a few texels wide.
  const height = raw.map((_, i) => (raw[i] * 2 + raw[(i + 1) % w] + raw[(i + w - 1) % w]) / 4);
  const data = new Uint8Array(w * h * 4);
  for (let x = 0; x < w; x++) {
    const dx = (height[(x + 1) % w] - height[(x + w - 1) % w]) * 2.2;
    const l = Math.hypot(dx, 1);
    for (let y = 0; y < h; y++) data.set([Math.round((-dx / l) * 127 + 128), 128, Math.round((1 / l) * 127 + 128), 255], (y * w + x) * 4);
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return (strandTexture = t);
}

/** Splits every triangle into four; positions, normals and uvs are interpolated at edge midpoints. */
function subdivide(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.attributes.position.array as Float32Array, nor = g.attributes.normal.array as Float32Array;
  const idx = g.index!.array;
  const P = Array.from(pos), N = Array.from(nor);
  const mids = new Map<number, number>();
  const n0 = pos.length / 3;
  const mid = (a: number, b: number) => {
    const key = a < b ? a * n0 * 4 + b : b * n0 * 4 + a;
    let m = mids.get(key);
    if (m === undefined) {
      m = P.length / 3;
      for (let c = 0; c < 3; c++) {
        P.push((P[a * 3 + c] + P[b * 3 + c]) / 2);
        N.push((N[a * 3 + c] + N[b * 3 + c]) / 2);
      }
      mids.set(key, m);
    }
    return m;
  };
  const out: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  for (let i = n0; i < N.length / 3; i++) {
    const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1;
    N[i * 3] /= l;
    N[i * 3 + 1] /= l;
    N[i * 3 + 2] /= l;
  }
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  r.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
  r.setIndex(out);
  g.dispose();
  return r;
}

const smooth01 = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Sculpted hair: the scalp region of the head mesh, cut along a natural hairline (forehead,
 * temples, around the ears, nape) and lifted off the head, thin at the hairline and fuller at
 * the crown. Long hair adds a curtain from ear level to below the shoulders. Shading comes from
 * a strand normal map, root-to-tip tone and sheen, so the surface stays solid (no cut-out shells).
 */
function Hair({ body, model, fit, anchors, frame }: { body: BodyParams; model: HumanModel; fit: FittedBody; anchors: Anchors; frame: BodyFrame }) {
  const { cy, cz, a, b, h } = anchors.head;
  const long = body.hair === 'long';
  const pieces = useMemo(() => {
    const k = anchors.H / 1.7;
    const pos = fit.positions;
    const parts = model.array('parts') as Uint8Array;
    /** Hairline height for an azimuth around the head (0 = straight ahead). */
    const hairline = (phi: number) => {
      const p = Math.abs(phi);
      const front = cy + h * 0.4, temple = cy + h * 0.1, nape = cy - h * (long ? 1.5 : 1.3);
      return front + (temple - front) * smooth01(0.2, 1.1, p) + (nape - temple) * smooth01(1.7, 2.6, p);
    };
    const az = (x: number, z: number) => Math.atan2(x, z - cz);
    // Ears stay uncovered: the band at the side of the head around ear height.
    // The ear itself (outboard of the skull), not the skin around it.
    const ear = (x: number, y: number, z: number) => Math.abs(x) > a * 1.0 && y < cy + h * 0.02 && y > cy - h * 0.62 && z < cz + b * 0.35 && z > cz - b * 0.45;
    const keep = (v: number) => {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      // Generous region: the hair surface continues past the hairline but sinks under the
      // skin there, so the visible edge is the smooth intersection of two surfaces.
      // Head and upper neck (the head/neck weight boundary would leave a straight cut at the back).
      return (parts[v * 6 + 1] > 40 || (Math.abs(x) < a * 1.1 && z < cz + b * 0.2)) && y > cy - h * 1.9 && y > hairline(az(x, z)) - h * 0.3 && !ear(x, y, z);
    };
    // Two midpoint subdivisions: the hairline is where the hair surface crosses the skin, and a
    // finer mesh makes that crossing a smooth curve instead of following coarse triangles.
    const cap = subdivide(subdivide(setGeometry(model, fit, 'body', keep)));
    const p = cap.attributes.position, n = cap.attributes.normal;
    const uv = new Float32Array(p.count * 2);
    const col = new Float32Array(p.count * 3);
    const base = (long ? 0.02 : 0.016) * k;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const phi = az(x, z);
      // 0 at the hairline, 1 a little way above it: thin edges that meet the skin.
      const edge = y - hairline(phi);
      const inside = smooth01(0, h * 0.3, edge);
      const crown = smooth01(cy, cy + h, y);
      // Positive lift above the hairline, a slight sink (hidden under the skin) below it.
      const d = edge < 0 ? -0.003 * k * smooth01(0, h * 0.05, -edge) : base * (0.1 + 0.9 * inside) * (0.8 + 0.45 * crown);
      p.setXYZ(i, x + n.getX(i) * d, y + n.getY(i) * d, z + n.getZ(i) * d);
      // Strands run from the crown outward: u around the head, v down from the top.
      uv[i * 2] = (phi / (Math.PI * 2)) * 14;
      uv[i * 2 + 1] = (cy + h - y) * 4;
      const tone = 0.72 + 0.28 * inside;
      col.set([tone, tone, tone], i * 3);
    }
    cap.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    cap.setAttribute('color', new THREE.BufferAttribute(col, 3));
    cap.computeVertexNormals();
    const list = [cap];
    if (long) {
      // Curtain from ear level down past the shoulders, wrapping sides and back.
      const top = cy - h * 0.6, bottom = frame.shoulderY - 0.12 * anchors.H;
      const rings: Ring[] = [];
      const n2 = 26;
      for (let i = 0; i <= n2; i++) {
        const y = bottom + ((top - bottom) * i) / n2;
        const t = Math.min(1, Math.max(0, (y - (anchors.neck.y - 0.03)) / (top - anchors.neck.y + 0.03)));
        const tz = frame.trunk.centreB(y), td = frame.trunk.depthHalf(y), th = frame.trunk.half(y);
        const off = 0.014 * k;
        const backZ = (cz - b * 1.02) * t + (tz - td) * (1 - t) - off;
        const half = (a * 0.95 + base) * t + Math.min(th * 0.62, a * 1.25) * (1 - t) + off * 0.5;
        const centre = cz * t + (tz - td * 0.2) * (1 - t);
        // Ends taper and round off over the last few rings.
        const end = smooth01(0, 4, i);
        rings.push({ y, cx: 0, cz: centre, a: half * (0.86 + 0.14 * end), b: Math.max(0.03, centre - backZ) * (0.9 + 0.1 * end) });
      }
      const g = loft(rings, { segments: 40, arc: [Math.PI * 1.16, Math.PI * 1.84] });
      const gp = g.attributes.position;
      const guv = new Float32Array(gp.count * 2);
      const gcol = new Float32Array(gp.count * 3);
      for (let i = 0; i < gp.count; i++) {
        guv[i * 2] = (Math.atan2(gp.getX(i), gp.getZ(i) - cz) / (Math.PI * 2)) * 14;
        guv[i * 2 + 1] = (cy + h - gp.getY(i)) * 4;
        const tip = 0.82 + 0.18 * smooth01(bottom, bottom + 0.08, gp.getY(i));
        gcol.set([tip, tip, tip], i * 3);
      }
      g.setAttribute('uv', new THREE.BufferAttribute(guv, 2));
      g.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
      list.push(g);
    }
    return list;
  }, [model, fit, anchors, frame, cy, cz, a, b, h, long]);
  useDisposable(pieces);
  const normalMap = strandNormals();
  return (
    <group>
      {pieces.map((g, i) => (
        <mesh key={i} geometry={g} castShadow>
          <meshPhysicalMaterial
            color={body.hairColor}
            vertexColors
            normalMap={normalMap}
            normalScale={HAIR_NORMAL}
            roughness={0.5}
            sheen={0.45}
            sheenRoughness={0.4}
            sheenColor="#ffffff"
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

const HAIR_NORMAL = new THREE.Vector2(0.9, 0.9);

/** Photo coordinates for a point on the head, from the eye and chin landmarks. */
function faceMapping(face: NonNullable<BodyParams['face']>, anchors: Anchors) {
  const { eyes, chinY } = anchors;
  // The eye line gives scale and roll across the face, eye-to-chin the vertical scale. The eye
  // further right in the image is the model's +x.
  const [ea, eb] = face.eyes[0][0] <= face.eyes[1][0] ? face.eyes : [face.eyes[1], face.eyes[0]];
  const mid = [(ea[0] + eb[0]) / 2, (ea[1] + eb[1]) / 2];
  const ex = [(eb[0] - ea[0]) / (2 * eyes.dx), (eb[1] - ea[1]) / (2 * eyes.dx)];
  const drop = eyes.y - chinY;
  const ey = [(face.chin[0] - mid[0]) / drop, (face.chin[1] - mid[1]) / drop];
  return { drop, uv: (x: number, y: number): [number, number] => [mid[0] + ex[0] * x + ey[0] * (eyes.y - y), 1 - (mid[1] + ex[1] * x + ey[1] * (eyes.y - y))] };
}

function FaceDecal({ face, model, fit, anchors }: { face: NonNullable<BodyParams['face']>; model: HumanModel; fit: FittedBody; anchors: Anchors }) {
  const map = useImageTexture(face.uri);
  const geometry = useMemo(() => {
    const { eyes, chinY } = anchors;
    const { drop, uv: lookup } = faceMapping(face, anchors);
    const g = setGeometry(model, fit, 'body', (v) => fit.positions[v * 3 + 1] > chinY - 0.03);
    const p = g.attributes.position, n = g.attributes.normal;
    const uv = new Float32Array(p.count * 2);
    const col = new Float32Array(p.count * 4);
    const ss = (lo: number, hi: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
      return t * t * (3 - 2 * t);
    };
    for (let i = 0; i < p.count; i++) {
      const down = eyes.y - p.getY(i);
      uv.set(lookup(p.getX(i), p.getY(i)), i * 2);
      // t: -1 around the hairline, 0 at the eyes, 1 at the chin.
      const t = down / drop;
      const alpha = ss(0.2, 0.62, n.getZ(i)) * ss(-0.78, -0.5, t) * (1 - ss(0.94, 1.12, t));
      col.set([1, 1, 1, alpha], i * 4);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    return g;
  }, [face, model, fit, anchors]);
  useDisposable(useMemo(() => [geometry], [geometry]));
  if (!map) return null;
  return (
    <mesh geometry={geometry} renderOrder={1}>
      <meshStandardMaterial map={map} vertexColors transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} roughness={0.6} />
    </mesh>
  );
}

let irisTexture: THREE.DataTexture | undefined;
/** Eyeball texture for a sphere whose +v pole faces forward: pupil, streaked iris, limbal ring, sclera. */
function iris(): THREE.DataTexture {
  if (irisTexture) return irisTexture;
  const w = 128, h = 256;
  const data = new Uint8Array(w * h * 4);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const streak = Array.from({ length: w }, rnd);
  for (let y = 0; y < h; y++) {
    // Angle from the forward pole in 0..1 (1 = back of the eye).
    const a = 1 - y / (h - 1);
    for (let x = 0; x < w; x++) {
      let c: [number, number, number];
      if (a < 0.055) c = [8, 6, 6];
      else if (a < 0.17) {
        const t = (a - 0.055) / 0.115;
        const s = 0.75 + 0.5 * streak[x];
        c = [(70 + 55 * t) * s, (44 + 34 * t) * s, (24 + 14 * t) * s];
        if (t > 0.86) c = [c[0] * 0.45, c[1] * 0.45, c[2] * 0.45];
      } else c = [236 - a * 40, 230 - a * 46, 226 - a * 46];
      data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return (irisTexture = t);
}

function Body({ body, model, fit, anchors, frame }: { body: BodyParams; model: HumanModel; fit: FittedBody; anchors: Anchors; frame: BodyFrame }) {
  const face = body.face;
  const geo = useMemo(() => {
    // Eyeballs: spheres at the mesh's eye sockets, pole turned to face forward.
    const balls = anchors.eyeballs.map((e) => {
      const g = new THREE.SphereGeometry(e.radius, 28, 20);
      g.rotateX(Math.PI / 2);
      g.translate(e.centre[0], e.centre[1], e.centre[2]);
      if (face) {
        // With a face photo the eyeballs show the user's own eyes from the same projection.
        const { uv } = faceMapping(face, anchors);
        const p = g.attributes.position;
        const arr = new Float32Array(p.count * 2);
        for (let i = 0; i < p.count; i++) arr.set(uv(p.getX(i), p.getY(i)), i * 2);
        g.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
      }
      return g;
    });
    const skin = setGeometry(model, fit, 'body');
    const brow = new THREE.Color(body.hairColor).multiplyScalar(0.9);
    const skinTone = new THREE.Color(body.skin);
    // Eyebrow tint is expressed relative to the skin colour it multiplies.
    const rel: [number, number, number] = [brow.r / Math.max(0.05, skinTone.r), brow.g / Math.max(0.05, skinTone.g), brow.b / Math.max(0.05, skinTone.b)];
    const features = face ? null : { eyeY: anchors.eyes.y, eyeDx: anchors.eyes.dx, chinY: anchors.chinY, frontZ: anchors.head.cz };
    skin.setAttribute('color', new THREE.BufferAttribute(skinColors(model, fit, features, rel), 3));
    return { skin, eyeL: balls[0], eyeR: balls[1], lashes: setGeometry(model, fit, 'lashes') };
  }, [model, fit, face, anchors, body.hairColor, body.skin]);
  useDisposable(useMemo(() => Object.values(geo), [geo]));
  const photo = useImageTexture(face?.uri);
  const eye = face ? photo : iris();
  return (
    <group>
      <mesh geometry={geo.skin} castShadow receiveShadow>
        <meshPhysicalMaterial color={body.skin} vertexColors roughness={0.56} sheen={0.22} sheenRoughness={0.5} sheenColor="#e8765f" />
      </mesh>
      {[geo.eyeL, geo.eyeR].map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial key={eye ? 't' : 'c'} color="#e6e6e6" map={eye} roughness={0.1} envMapIntensity={0.7} />
        </mesh>
      ))}
      {!face && (
        <mesh geometry={geo.lashes}>
          <meshStandardMaterial color="#17120f" roughness={0.6} transparent opacity={0.5} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {face && <FaceDecal face={face} model={model} fit={fit} anchors={anchors} />}
      {body.hair !== 'none' && <Hair body={body} model={model} fit={fit} anchors={anchors} frame={frame} />}
    </group>
  );
}

function Figure({ body, model, garments }: { body: BodyParams; model: HumanModel; garments: Garment[] }) {
  const fit = useMemo(() => model.fit(body), [model, body]);
  const frame = useMemo(() => bodyFrame(model, fit), [model, fit]);
  const anch = useMemo(() => bodyAnchors(model, fit, frame), [model, fit, frame]);
  return (
    <group>
      <Body body={body} model={model} fit={fit} anchors={anch} frame={frame} />
      <Cloths garments={garments} frame={frame} />
      {garments
        .filter((g) => !CLOTH_KINDS.includes(g.kind))
        .map((g) => (
          <Accessory key={g.id} garment={g} anchors={anch} />
        ))}
    </group>
  );
}

function Ground({ radius }: { radius: number }) {
  const shadow = useMemo(() => {
    const n = 64;
    const data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const d = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
        const a = Math.max(0, 1 - d);
        data.set([0, 0, 0, Math.round(255 * 0.55 * a * a)], (y * n + x) * 4);
      }
    const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }, []);
  useDisposable(useMemo(() => [shadow], [shadow]));
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={0.001} scale={[radius * 1.1, radius * 0.8, 1]}>
        <circleGeometry args={[1, 40]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.0008} receiveShadow>
        <circleGeometry args={[radius * 4, 48]} />
        <shadowMaterial transparent opacity={0.2} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.0005}>
        <ringGeometry args={[radius * 1.28, radius * 1.295, 96]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.14} depthWrite={false} />
      </mesh>
    </group>
  );
}

function CameraRig({ rig, focus, height, autoRotate }: { rig: React.RefObject<Rig>; focus: Focus; height: number; autoRotate: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const cur = useRef({ y: FOCUS[focus][0] * height, d: FOCUS[focus][1] * height * 1.25 });
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const r = rig.current;
    if (!r.dragging) {
      r.az += r.vAz * dt;
      r.el += r.vEl * dt;
      const damp = Math.exp(-4.5 * dt);
      r.vAz *= damp;
      r.vEl *= damp;
      r.idle += dt;
      if (autoRotate && r.idle > 2.5) r.az += 0.22 * dt * Math.min(1, (r.idle - 2.5) / 1.5);
    }
    r.el = THREE.MathUtils.clamp(r.el, -0.25, 1.1);
    const [ty, td] = FOCUS[focus];
    // Keep the subject framed on narrow (portrait) canvases.
    const aspectFit = Math.max(1, 0.62 / (size.width / size.height));
    const k = 1 - Math.exp(-5 * dt);
    cur.current.y += (ty * height - cur.current.y) * k;
    cur.current.d += ((td * height * aspectFit) / r.zoom - cur.current.d) * k;
    const { y, d } = cur.current;
    camera.position.set(Math.sin(r.az) * Math.cos(r.el) * d, y + Math.sin(r.el) * d, Math.cos(r.az) * Math.cos(r.el) * d);
    camera.lookAt(0, y, 0);
  });
  return null;
}

export interface StageProps {
  /** Starting azimuth in radians; 0 faces the front. */
  azimuth?: number;
  body: BodyParams;
  garments: Garment[];
  focus?: Focus;
  autoRotate?: boolean;
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Interactive 3D viewer: drag to orbit, pinch to zoom, inertial release. */
export function Stage({ body, garments, focus = 'full', autoRotate = true, interactive = true, azimuth = 0.35, style }: StageProps) {
  const rig = useRef<Rig>({ az: azimuth, el: 0.08, zoom: 1, vAz: 0, vEl: 0, dragging: false, idle: 0 });
  const pinch = useRef(0);

  const [responder] = useState(() => {
    const dist = (t: readonly { pageX: number; pageY: number }[]) => Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
    let last = { x: 0, y: 0, t: 0 };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
      onPanResponderGrant: (e) => {
        const r = rig.current;
        r.dragging = true;
        r.vAz = r.vEl = 0;
        last = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, t: Date.now() };
        pinch.current = 0;
      },
      onPanResponderMove: (e) => {
        const r = rig.current;
        const touches = e.nativeEvent.touches;
        if (touches && touches.length >= 2) {
          const d = dist(touches);
          if (pinch.current) r.zoom = THREE.MathUtils.clamp((r.zoom * d) / pinch.current, 0.7, 3);
          pinch.current = d;
          return;
        }
        if (pinch.current) {
          // Second finger lifted: restart the drag from the remaining finger.
          pinch.current = 0;
          last = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, t: Date.now() };
          return;
        }
        const now = Date.now();
        const dx = e.nativeEvent.pageX - last.x;
        const dy = e.nativeEvent.pageY - last.y;
        const dt = Math.max(1, now - last.t) / 1000;
        const dAz = -dx * 0.009;
        const dEl = dy * 0.005;
        r.az += dAz;
        r.el += dEl;
        r.vAz = THREE.MathUtils.clamp(dAz / dt, -9, 9);
        r.vEl = THREE.MathUtils.clamp(dEl / dt, -4, 4) * 0.4;
        last = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, t: now };
      },
      onPanResponderRelease: () => {
        rig.current.dragging = false;
        rig.current.idle = 0;
      },
      onPanResponderTerminate: () => {
        rig.current.dragging = false;
      },
    });
  });

  const H = body.height / 100;
  const model = useHuman();
  return (
    <View style={[styles.fill, style]}>
      <Canvas
        shadows
        camera={{ fov: 27, near: 0.05, far: 60, position: [0, 1, 6] }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        onCreated={({ gl, scene }) => {
          gl.localClippingEnabled = true;
          // Image-based lighting from a procedural studio room; skipped where the GPU cannot
          // render the required float targets, leaving the direct lights below.
          try {
            // Prefiltering needs float colour targets; some mobile GL stacks do not expose them.
            if (!gl.extensions.has('EXT_color_buffer_float') && !gl.extensions.has('EXT_color_buffer_half_float')) throw new Error('no float targets');
            const pmrem = new THREE.PMREMGenerator(gl);
            scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
            scene.environmentIntensity = 0.32;
            pmrem.dispose();
          } catch {
            scene.environment = null;
          }
        }}>
        <CameraRig rig={rig} focus={focus} height={H} autoRotate={autoRotate} />
        <hemisphereLight args={['#ffffff', '#3a3646', 0.25]} />
        <directionalLight
          position={[2.2, 4.2, 3.4]}
          intensity={1.75}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.012}
          shadow-camera-left={-2.2}
          shadow-camera-right={2.2}
          shadow-camera-top={2.3}
          shadow-camera-bottom={-0.3}
          shadow-camera-near={0.5}
          shadow-camera-far={12}
        />
        <directionalLight position={[-3.5, 2, 2]} intensity={0.5} color="#cfd6ff" />
        <directionalLight position={[0.5, 3, -4]} intensity={1.0} color="#ffe6c9" />
        {model && <Figure body={body} model={model} garments={garments} />}
        <Ground radius={H * 0.3} />
      </Canvas>
      {interactive && <View style={StyleSheet.absoluteFill} {...responder.panHandlers} />}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });

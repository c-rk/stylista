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
/** Vertical strand pattern: alpha thins the outer shells into wisps, rgb varies strand tone. */
function strands(): THREE.DataTexture {
  if (strandTexture) return strandTexture;
  const w = 512, h = 4;
  const data = new Uint8Array(w * h * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cover = Array.from({ length: w }, rnd), tone = Array.from({ length: w }, rnd);
  for (let x = 0; x < w; x++) {
    const a = (cover[x] + cover[(x + 1) % w]) / 2;
    const t = 0.62 + 0.38 * ((tone[x] + tone[(x + 1) % w] + tone[(x + 2) % w]) / 3);
    for (let y = 0; y < h; y++) data.set([t * 255, t * 255, t * 255, a * 255], (y * w + x) * 4);
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return (strandTexture = t);
}

/** Shell lifts off the scalp (metres at 1.7 m stature) and the strand coverage cut for each. */
const HAIR_SHELLS: [number, number][] = [[0.003, 0.02], [0.006, 0.3], [0.009, 0.5], [0.012, 0.68]];

/**
 * Hair as stacked shells: the innermost is solid, outer ones keep progressively fewer strands,
 * which gives volume and a soft outline. Long hair adds sheets falling behind the shoulders.
 */
function Hair({ body, model, fit, anchors, frame }: { body: BodyParams; model: HumanModel; fit: FittedBody; anchors: Anchors; frame: BodyFrame }) {
  const { cy, cz, a, b, h } = anchors.head;
  const long = body.hair === 'long';
  const { shells, plane } = useMemo(() => {
    const k = anchors.H / 1.7;
    const base = setGeometry(model, fit, 'body', (v) => fit.positions[v * 3 + 1] > cy - h * 1.3);
    const bp = base.attributes.position, bn = base.attributes.normal;
    const list = HAIR_SHELLS.map(([lift]) => {
      const g = base.clone();
      const p = g.attributes.position;
      const uv = new Float32Array(p.count * 2);
      const d = (lift + (long ? 0.006 : 0)) * k;
      for (let i = 0; i < p.count; i++) {
        p.setXYZ(i, bp.getX(i) + bn.getX(i) * d, bp.getY(i) + bn.getY(i) * d, bp.getZ(i) + bn.getZ(i) * d);
        // Strands run from the crown downward: u wraps around the head.
        uv[i * 2] = (Math.atan2(bp.getX(i), bp.getZ(i) - cz) / (Math.PI * 2)) * 5;
        uv[i * 2 + 1] = (bp.getY(i) - cy) / h;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      return g;
    });
    base.dispose();
    if (long) {
      // Sheets from ear level to below the shoulders, wrapping the back and sides.
      const top = cy - h * 0.1, bottom = frame.shoulderY - 0.13 * anchors.H;
      HAIR_SHELLS.forEach(([lift], si) => {
        const rings: Ring[] = [];
        const n = 22;
        for (let i = 0; i <= n; i++) {
          const y = bottom + ((top - bottom) * i) / n;
          const t = Math.min(1, Math.max(0, (y - (anchors.neck.y - 0.02)) / (top - anchors.neck.y + 0.02)));
          const tz = frame.trunk.centreB(y), td = frame.trunk.depthHalf(y), th = frame.trunk.half(y);
          const off = (lift + 0.012) * k;
          // Head ellipse above the neck, the upper back's section below it.
          const back = (cz - b * 1.02) * t + (tz - td) * (1 - t) - off;
          const half = a * 0.98 * t + Math.min(th * 0.8, a * 1.5) * (1 - t) + off;
          const centre = cz * t + (tz - td * 0.35) * (1 - t);
          const taper = i < 3 ? 0.82 + 0.06 * i : 1;
          rings.push({ y, cx: 0, cz: centre, a: half * taper, b: Math.max(0.03, centre - back) });
        }
        const g = loft(rings, { segments: 26, arc: [Math.PI * 1.08, Math.PI * 1.92] });
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3 + si * 0.37, uv.getY(i));
        list.push(g);
      });
    }
    const front = new THREE.Vector3(0, cy + h * 0.56, cz + b * 0.86);
    const back = new THREE.Vector3(0, cy - h * (long ? 0.2 : 0.5), cz - b * 0.8);
    const normal = new THREE.Vector3(0, front.z - back.z, -(front.y - back.y)).normalize();
    return { shells: list, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, front) };
  }, [model, fit, anchors, frame, cy, cz, a, b, h, long]);
  useDisposable(shells);
  const map = strands();
  return (
    <group>
      {shells.map((g, i) => {
        const scalp = i < HAIR_SHELLS.length;
        return (
          <mesh key={i} geometry={g} castShadow={i % HAIR_SHELLS.length === 0}>
            <meshStandardMaterial color={body.hairColor} map={map} alphaTest={HAIR_SHELLS[i % HAIR_SHELLS.length][1]} roughness={0.45} clippingPlanes={scalp ? [plane] : null} side={THREE.DoubleSide} />
          </mesh>
        );
      })}
    </group>
  );
}

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

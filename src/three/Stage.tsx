/*
 * Imperative render-loop and gesture code: camera state lives in a mutable rig object that is
 * written from touch handlers and read every frame, outside React's render cycle.
 */
/* eslint-disable react-hooks/immutability, react-hooks/refs */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Asset } from 'expo-asset';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import * as THREE from 'three';

import type { BodyParams, Garment } from '@/types';
import { computeBody } from './body';
import { setGeometry } from './human/geometry';
import { useHuman } from './human/load';
import type { FittedBody, HumanModel } from './human/model';
import { bodyFrame, BodyFrame, buildCloth, Occupancy } from './human/cloth';
import { buildGarment, Part } from './garments';

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

function useGarmentTexture(g: Garment): THREE.Texture | null {
  const [loaded, setLoaded] = useState<{ key: string; tex: THREE.Texture } | null>(null);
  const uri = g.textureMode === 'solid' ? undefined : (g.textureUri ?? g.imageUri);
  const mode = g.textureMode;
  const key = `${mode}|${uri}`;
  useEffect(() => {
    if (!uri) return;
    let alive = true;
    let tex: THREE.Texture | undefined;
    new THREE.TextureLoader().load(uri, (t) => {
      tex = t;
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = mode === 'fabric' ? THREE.MirroredRepeatWrapping : THREE.ClampToEdgeWrapping;
      t.anisotropy = 4;
      if (alive) setLoaded({ key, tex: t });
      else t.dispose();
    });
    return () => {
      alive = false;
      tex?.dispose();
    };
  }, [uri, mode, key]);
  return uri && loaded?.key === key ? loaded.tex : null;
}

function shade(hex: string, kind: 'trim' | 'sole'): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  if (kind === 'sole') return hsl.l < 0.62 ? '#ECE8E1' : '#BFAE94';
  return '#' + c.setHSL(hsl.h, hsl.s * 0.85, hsl.l < 0.12 ? 0.22 : hsl.l * 0.62).getHexString();
}

const LAYER: Partial<Record<Garment['kind'], number>> = { trousers: 0.002, skirt: 0.003, top: 0.005, dress: 0.005, outerwear: 0.011 };

function ClothMesh({ garment, geo }: { garment: Garment; geo: { front: THREE.BufferGeometry; back: THREE.BufferGeometry } }) {
  const tex = useAtlas(garment.atlasUri);
  if (!tex) return null;
  return (
    <group>
      {[geo.front, geo.back].map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial map={tex} color={garment.textureMode === 'solid' ? garment.color : '#ffffff'} alphaTest={0.5} roughness={0.86} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

/** Scanned garments, built inside-out so each layer clears the ones beneath it. */
function Cloths({ garments, frame }: { garments: Garment[]; frame: BodyFrame }) {
  const built = useMemo(() => {
    const under = new Occupancy();
    return [...garments]
      .sort((a, b) => (LAYER[a.kind] ?? 0) - (LAYER[b.kind] ?? 0))
      .map((garment) => {
        const geo = buildCloth(frame, garment.scan!, { layer: LAYER[garment.kind] ?? 0.005, size: garment.size ?? 1, under });
        under.absorb(geo.occupied);
        return { garment, geo };
      });
  }, [garments, frame]);
  useDisposable(useMemo(() => built.flatMap((b) => [b.geo.front, b.geo.back]), [built]));
  return (
    <group>
      {built.map((b) => (
        <ClothMesh key={b.garment.id} garment={b.garment} geo={b.geo} />
      ))}
    </group>
  );
}

function useAtlas(uri?: string): THREE.Texture | null {
  const [loaded, setLoaded] = useState<{ uri: string; tex: THREE.Texture } | null>(null);
  useEffect(() => {
    if (!uri) return;
    let alive = true;
    let tex: THREE.Texture | undefined;
    new THREE.TextureLoader().load(uri, (t) => {
      tex = t;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      if (alive) setLoaded({ uri, tex: t });
      else t.dispose();
    });
    return () => {
      alive = false;
      tex?.dispose();
    };
  }, [uri]);
  return uri && loaded?.uri === uri ? loaded.tex : null;
}

function GarmentMesh({ garment, body }: { garment: Garment; body: BodyParams }) {
  const parts: Part[] = useMemo(() => buildGarment(computeBody(body), garment), [body, garment]);
  useDisposable(useMemo(() => parts.map((p) => p.geometry), [parts]));
  const tex = useGarmentTexture(garment);
  const trim = shade(garment.color, 'trim');
  const sole = shade(garment.color, 'sole');
  return (
    <group>
      {parts.map((p, i) => (
        <mesh key={i} geometry={p.geometry}>
          {p.material === 'main' && (
            <meshStandardMaterial key={tex ? 't' : 'c'} color={tex ? '#ffffff' : garment.color} map={tex} roughness={0.84} side={THREE.DoubleSide} />
          )}
          {p.material === 'trim' && <meshStandardMaterial color={trim} roughness={0.7} />}
          {p.material === 'sole' && <meshStandardMaterial color={sole} roughness={0.8} />}
          {p.material === 'metal' && <meshStandardMaterial color={garment.color} roughness={0.28} metalness={0.45} />}
          {p.material === 'lens' && <meshStandardMaterial color="#0c0c10" roughness={0.1} transparent opacity={0.42} side={THREE.DoubleSide} />}
        </mesh>
      ))}
    </group>
  );
}

function Body({ body, model, fit }: { body: BodyParams; model: HumanModel; fit: FittedBody }) {
  const geo = useMemo(
    () => ({ skin: setGeometry(model, fit, 'body'), eyes: setGeometry(model, fit, 'eyes'), hair: setGeometry(model, fit, 'hair') }),
    [model, fit],
  );
  useDisposable(useMemo(() => Object.values(geo), [geo]));
  const eye = useAssetTexture(require('../../assets/body/eye.png'));
  return (
    <group>
      <mesh geometry={geo.skin}>
        <meshStandardMaterial color={body.skin} roughness={0.58} />
      </mesh>
      <mesh geometry={geo.eyes}>
        <meshStandardMaterial key={eye ? 't' : 'c'} color="#ffffff" map={eye} roughness={0.15} />
      </mesh>
      {body.hair !== 'none' && (
        <mesh geometry={geo.hair}>
          <meshStandardMaterial color={body.hairColor} roughness={0.75} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

function useAssetTexture(module: number): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let alive = true;
    let t: THREE.Texture | undefined;
    const asset = Asset.fromModule(module);
    asset.downloadAsync().then(() => {
      new THREE.TextureLoader().load(asset.localUri ?? asset.uri, (loaded) => {
        t = loaded;
        loaded.colorSpace = THREE.SRGBColorSpace;
        if (alive) setTex(loaded);
        else loaded.dispose();
      });
    }, () => {});
    return () => {
      alive = false;
      t?.dispose();
    };
  }, [module]);
  return tex;
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

function Figure({ body, model, garments }: { body: BodyParams; model: HumanModel; garments: Garment[] }) {
  const fit = useMemo(() => model.fit(body), [model, body]);
  const frame = useMemo(() => bodyFrame(model, fit), [model, fit]);
  const scanned = useMemo(() => garments.filter((g) => g.scan && g.atlasUri), [garments]);
  return (
    <group>
      <Body body={body} model={model} fit={fit} />
      <Cloths garments={scanned} frame={frame} />
      {garments.filter((g) => !g.scan).map((g) => (
        <GarmentMesh key={g.id} garment={g} body={body} />
      ))}
    </group>
  );
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
      <Canvas camera={{ fov: 27, near: 0.05, far: 60, position: [0, 1, 6] }} dpr={[1, 2]} gl={{ antialias: true }} onCreated={({ gl }) => { gl.localClippingEnabled = true; }}>
        <CameraRig rig={rig} focus={focus} height={H} autoRotate={autoRotate} />
        <hemisphereLight args={['#ffffff', '#3a3646', 1.0]} />
        <directionalLight position={[2.5, 4, 3.5]} intensity={2.4} />
        <directionalLight position={[-3.5, 2, 2]} intensity={0.8} color="#cfd6ff" />
        <directionalLight position={[0.5, 3, -4]} intensity={1.6} color="#ffe6c9" />
        {model && <Figure body={body} model={model} garments={garments} />}
        <Ground radius={H * 0.3} />
      </Canvas>
      {interactive && <View style={StyleSheet.absoluteFill} {...responder.panHandlers} />}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });

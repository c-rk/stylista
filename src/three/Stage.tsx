/*
 * Imperative render-loop and gesture code: camera state lives in a mutable rig object that is
 * written from touch handlers and read every frame, outside React's render cycle.
 */
/* eslint-disable react-hooks/immutability, react-hooks/refs */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import * as THREE from 'three';

import type { BodyParams, Garment } from '@/types';
import { buildBody, computeBody } from './body';
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

function Body({ body }: { body: BodyParams }) {
  const meshes = useMemo(() => buildBody(computeBody(body), body), [body]);
  useDisposable(useMemo(() => [...meshes.skin, ...meshes.hair], [meshes]));
  return (
    <group>
      {meshes.skin.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial color={body.skin} roughness={0.62} />
        </mesh>
      ))}
      {meshes.hair.map((g, i) => (
        <mesh key={`h${i}`} geometry={g}>
          <meshStandardMaterial
            color={body.hairColor}
            roughness={0.78}
            side={THREE.DoubleSide}
            clippingPlanes={i === 0 && meshes.hairline ? [meshes.hairline] : null}
          />
        </mesh>
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
  return (
    <View style={[styles.fill, style]}>
      <Canvas camera={{ fov: 27, near: 0.05, far: 60, position: [0, 1, 6] }} dpr={[1, 2]} gl={{ antialias: true }} onCreated={({ gl }) => { gl.localClippingEnabled = true; }}>
        <CameraRig rig={rig} focus={focus} height={H} autoRotate={autoRotate} />
        <hemisphereLight args={['#ffffff', '#3a3646', 1.0]} />
        <directionalLight position={[2.5, 4, 3.5]} intensity={2.4} />
        <directionalLight position={[-3.5, 2, 2]} intensity={0.8} color="#cfd6ff" />
        <directionalLight position={[0.5, 3, -4]} intensity={1.6} color="#ffe6c9" />
        <Body body={body} />
        {garments.map((g) => (
          <GarmentMesh key={g.id} garment={g} body={body} />
        ))}
        <Ground radius={H * 0.3} />
      </Canvas>
      {interactive && <View style={StyleSheet.absoluteFill} {...responder.panHandlers} />}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });

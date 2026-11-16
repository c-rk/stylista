import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { bodyFromHeight, STARTER_GARMENTS } from '@/lib/catalog';
import { Stage } from '@/three/Stage';
import type { Garment } from '@/types';

/** Development harness: /dev?az=0.4&f=upper&g=st-tee&gender=1 */
export default function Dev() {
  const q = new URLSearchParams((globalThis as { location?: { search: string } }).location?.search ?? '');
  const ids = q.get('g')?.split(',') ?? [];
  const n = (k: string, d: number) => +(q.get(k) ?? d);
  const body = bodyFromHeight(n('h', 170), { gender: n('gender', 0), hair: (q.get('hair') ?? 'short') as 'short' });
  // ?face=ax,ay,bx,by,cx,cy: eye centres and chin as image fractions, photo at /lab/face.png
  const face = q.get('face')?.split(',').map(Number);
  if (face) body.face = { uri: '/lab/face.png', eyes: [[face[0], face[1]], [face[2], face[3]]], chin: [face[4], face[5]] };
  if (q.get('waist')) Object.assign(body, { waist: n('waist', 78), hips: n('hips', 96), chest: n('chest', 93) });
  const [scanned, setScanned] = useState<Garment[]>([]);
  const names = q.get('scan');
  useEffect(() => {
    if (!names) return;
    Promise.all(
      names.split(',').map(async (name): Promise<Garment> => {
        const scan = await (await fetch(`/lab/${name}.scan.json`)).json();
        const kind = scan.kind === 'trousers' ? 'trousers' : scan.kind;
        return { id: name, name, kind, color: scan.color, shape: { sleeve: 0, length: 0, fit: 0, flare: 0 }, createdAt: 0, scan, atlasUri: `/lab/${name}.atlas.png`, size: n('size', 1) };
      }),
    ).then(setScanned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names]);
  return (
    <View style={{ flex: 1, backgroundColor: '#15151b' }}>
      <Stage body={body} garments={[...STARTER_GARMENTS.filter((g) => ids.includes(g.id)), ...scanned]} autoRotate={false} azimuth={n('az', 0.35)} focus={(q.get('f') ?? 'full') as 'full'} />
    </View>
  );
}

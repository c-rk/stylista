import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { Button, IconButton, Press, tap } from '@/components/ui';
import { colors, fonts, radius, space, type } from '@/theme';

/** Guide frame as fractions of the preview: the piece should fill it without touching it. */
const FRAME = { x: 0.08, y: 0.17, w: 0.84, h: 0.6 };

/**
 * Camera for photographing a garment. A framing outline shows where the piece should sit; the
 * shot is cropped to that frame, which removes most of the surroundings before segmentation.
 */
export function GarmentCamera({ onShot, onClose }: { onShot: (uri: string) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const [permission, request] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const camera = useRef<CameraView>(null);

  const shoot = async () => {
    if (busy) return;
    setBusy(true);
    tap(true);
    try {
      const shot = await camera.current?.takePictureAsync({ quality: 0.92 });
      if (!shot) return;
      // The preview shows the photo scaled to cover the screen; map the frame back to photo pixels.
      const scale = Math.max(W / shot.width, H / shot.height);
      const offX = (shot.width - W / scale) / 2, offY = (shot.height - H / scale) / 2;
      const margin = 0.03;
      const crop = {
        originX: Math.max(0, Math.round(offX + ((FRAME.x - margin) * W) / scale)),
        originY: Math.max(0, Math.round(offY + ((FRAME.y - margin) * H) / scale)),
        width: Math.round(((FRAME.w + margin * 2) * W) / scale),
        height: Math.round(((FRAME.h + margin * 2) * H) / scale),
      };
      crop.width = Math.min(crop.width, shot.width - crop.originX);
      crop.height = Math.min(crop.height, shot.height - crop.originY);
      const ref = await ImageManipulator.manipulate(shot.uri).crop(crop).renderAsync();
      onShot((await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 })).uri);
    } catch {
      setBusy(false);
    }
  };

  if (!permission?.granted) {
    return (
      <View style={[styles.root, styles.center]}>
        <Ionicons name="camera-outline" size={34} color={colors.accent} />
        <Text style={[type.heading, { marginTop: space.md }]}>Camera access</Text>
        <Text style={[type.body, { textAlign: 'center', marginTop: 6, marginBottom: space.xl }]}>Needed to photograph a piece. Photos stay on this device.</Text>
        <Button label="Allow camera" onPress={() => request()} />
        <Press onPress={onClose} style={{ padding: 14 }}>
          <Text style={styles.link}>Not now</Text>
        </Press>
      </View>
    );
  }

  const fx = FRAME.x * W, fy = FRAME.y * H, fw = FRAME.w * W, fh = FRAME.h * H;
  const c = 30;
  return (
    <View style={styles.root}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />
      <Svg width={W} height={H} style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* Dim everything outside the frame. */}
        <Path fillRule="evenodd" fill="rgba(6,6,9,0.62)" d={`M0 0H${W}V${H}H0Z M${fx + 22} ${fy}H${fx + fw - 22}Q${fx + fw} ${fy} ${fx + fw} ${fy + 22}V${fy + fh - 22}Q${fx + fw} ${fy + fh} ${fx + fw - 22} ${fy + fh}H${fx + 22}Q${fx} ${fy + fh} ${fx} ${fy + fh - 22}V${fy + 22}Q${fx} ${fy} ${fx + 22} ${fy}Z`} />
        <Rect x={fx} y={fy} width={fw} height={fh} rx={22} stroke="rgba(255,255,255,0.5)" strokeWidth={1.5} strokeDasharray="7 8" fill="none" />
        {/* Corner brackets. */}
        {[
          `M${fx} ${fy + c}V${fy + 22}Q${fx} ${fy} ${fx + 22} ${fy}H${fx + c}`,
          `M${fx + fw - c} ${fy}H${fx + fw - 22}Q${fx + fw} ${fy} ${fx + fw} ${fy + 22}V${fy + c}`,
          `M${fx + fw} ${fy + fh - c}V${fy + fh - 22}Q${fx + fw} ${fy + fh} ${fx + fw - 22} ${fy + fh}H${fx + fw - c}`,
          `M${fx + c} ${fy + fh}H${fx + 22}Q${fx} ${fy + fh} ${fx} ${fy + fh - 22}V${fy + fh - c}`,
        ].map((d) => (
          <Path key={d} d={d} stroke={colors.accent} strokeWidth={3.5} strokeLinecap="round" fill="none" />
        ))}
        {/* Centre line helps keep the piece straight. */}
        <Path d={`M${W / 2} ${fy + 14}V${fy + fh - 14}`} stroke="rgba(255,255,255,0.22)" strokeWidth={1} strokeDasharray="3 9" />
      </Svg>
      <View style={[styles.top, { top: insets.top + 10 }]}>
        <IconButton icon="close" label="Close camera" onPress={onClose} />
        <View style={styles.pill}>
          <Text style={styles.pillText}>Fit the whole piece inside the frame</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>
      <View style={[styles.tips, { top: fy + fh + 14 }]} pointerEvents="none">
        <Text style={styles.tip}>Front view · straight on · nothing covering it</Text>
        <Text style={[styles.tip, { color: colors.textFaint }]}>A hanger or a flat surface both work</Text>
      </View>
      <View style={[styles.bottom, { bottom: insets.bottom + 26 }]}>
        <Press onPress={shoot} accessibilityRole="button" accessibilityLabel="Take photo" style={[styles.shutter, busy && { opacity: 0.5 }]} scaleTo={0.9}>
          <View style={styles.shutterCore} />
        </Press>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: colors.bg },
  link: { fontFamily: fonts.medium, fontSize: 14, color: colors.textDim },
  top: { position: 'absolute', left: space.lg, right: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pill: { backgroundColor: 'rgba(10,10,13,0.72)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill },
  pillText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  tips: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 3 },
  tip: { fontFamily: fonts.medium, fontSize: 13, color: colors.textDim },
  bottom: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterCore: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
});

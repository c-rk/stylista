import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { KINDS } from '@/lib/catalog';
import type { Garment } from '@/types';
import { IconName } from './ui';

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/** Photo of the garment when available, otherwise a fabric-colour tile with its type icon. */
export function GarmentThumb({ garment, style, iconSize = 26 }: { garment: Garment; style?: StyleProp<ViewStyle>; iconSize?: number }) {
  const dark = luminance(garment.color) < 0.55;
  return (
    <View style={[styles.box, { backgroundColor: garment.color }, style]}>
      {garment.imageUri ? (
        <Image source={{ uri: garment.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} />
      ) : (
        <>
          <LinearGradient colors={['rgba(255,255,255,0.22)', 'rgba(0,0,0,0.18)']} style={StyleSheet.absoluteFill} />
          <Ionicons name={KINDS[garment.kind].icon as IconName} size={iconSize} color={dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.6)'} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({ box: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } });

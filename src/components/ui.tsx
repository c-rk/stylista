import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { PanResponder, Platform, Pressable, PressableProps, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { colors, fonts, gradients, radius, type } from '@/theme';

export type IconName = keyof typeof Ionicons.glyphMap;

export function tap(strong = false) {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(strong ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Pressable with spring scale feedback and a light haptic. */
export function Press({ style, onPress, children, scaleTo = 0.96, ...rest }: PressableProps & { style?: StyleProp<ViewStyle>; children?: ReactNode; scaleTo?: number }) {
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={() => {
        s.set(withSpring(scaleTo, { damping: 18, stiffness: 420 }));
      }}
      onPressOut={() => {
        s.set(withSpring(1, { damping: 14, stiffness: 320 }));
      }}
      onPress={(e) => {
        tap();
        onPress?.(e);
      }}
      style={[style, anim]}>
      {children}
    </AnimatedPressable>
  );
}

export function Button({ label, onPress, variant = 'primary', icon, disabled, style }: { label: string; onPress?: () => void; variant?: 'primary' | 'ghost' | 'danger'; icon?: IconName; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const ink = variant === 'primary' ? colors.accentInk : variant === 'danger' ? colors.danger : colors.text;
  return (
    <Press onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} style={[styles.btn, variant !== 'primary' && styles.btnGhost, disabled && { opacity: 0.4 }, style]}>
      {variant === 'primary' && <LinearGradient colors={gradients.accent} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
      {icon && <Ionicons name={icon} size={18} color={ink} />}
      <Text style={[styles.btnLabel, { color: ink }]}>{label}</Text>
    </Press>
  );
}

export function IconButton({ icon, onPress, label, size = 44, active }: { icon: IconName; onPress?: () => void; label: string; size?: number; active?: boolean }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={[styles.iconBtn, { width: size, height: size, borderRadius: size / 2 }, active && { backgroundColor: colors.accent }]}>
      <Ionicons name={icon} size={size * 0.46} color={active ? colors.accentInk : colors.text} />
    </Press>
  );
}

export function Chip({ label, active, onPress, icon }: { label: string; active?: boolean; onPress?: () => void; icon?: IconName }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!active }} style={[styles.chip, active && styles.chipActive]}>
      {icon && <Ionicons name={icon} size={14} color={active ? colors.accentInk : colors.textDim} />}
      <Text style={[styles.chipLabel, active && { color: colors.accentInk }]}>{label}</Text>
    </Press>
  );
}

/** JS-driven slider; value in [min, max]. */
export function Slider({ label, value, min = 0, max = 1, step, onChange, format }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const [w, setW] = useState(1);
  const box = useRef({ w: 1, x: 0 });
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });
  const lastStep = useRef(value);
  // The responder only touches refs inside event handlers, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() => {
    const set = (pageX: number) => {
      const t = Math.min(1, Math.max(0, (pageX - box.current.x) / box.current.w));
      let v = min + t * (max - min);
      if (step) v = Math.round(v / step) * step;
      if (step && v !== lastStep.current) {
        lastStep.current = v;
        if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
      }
      cb.current(v);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        box.current.x = e.nativeEvent.pageX - e.nativeEvent.locationX;
        set(e.nativeEvent.pageX);
      },
      onPanResponderMove: (e) => set(e.nativeEvent.pageX),
    });
  });
  const t = (value - min) / (max - min);
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.sliderHead}>
        <Text style={type.label}>{label}</Text>
        <Text style={[type.label, { color: colors.textDim }]}>{format ? format(value) : Math.round(t * 100) + '%'}</Text>
      </View>
      <View
        style={styles.sliderHit}
        onLayout={(e) => {
          box.current.w = e.nativeEvent.layout.width;
          setW(e.nativeEvent.layout.width);
        }}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        {...responder.panHandlers}>
        <View pointerEvents="none" style={styles.sliderTrack}>
          <LinearGradient colors={gradients.accent} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.sliderFill, { width: Math.max(0, t * w) }]} />
        </View>
        <View pointerEvents="none" style={[styles.sliderThumb, { left: t * (w - 22) }]} />
      </View>
    </View>
  );
}

export function Swatches({ colorsList, value, onChange, size = 34 }: { colorsList: string[]; value: string; onChange: (c: string) => void; size?: number }) {
  return (
    <View style={styles.swatches}>
      {colorsList.map((c) => (
        <Press key={c} onPress={() => onChange(c)} accessibilityLabel={`Colour ${c}`} style={[styles.swatchRing, { width: size + 8, height: size + 8, borderRadius: size }, value.toLowerCase() === c.toLowerCase() && { borderColor: colors.accent }]}>
          <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.lineStrong }} />
        </Press>
      ))}
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <Press key={o.id} onPress={() => onChange(o.id)} scaleTo={0.98} style={[styles.segment, value === o.id && styles.segmentActive]}>
          <Text style={[styles.chipLabel, value === o.id && { color: colors.text }]}>{o.label}</Text>
        </Press>
      ))}
    </View>
  );
}

export function StageBackdrop() {
  return <LinearGradient colors={gradients.stage} locations={[0, 0.55, 1]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />;
}

const styles = StyleSheet.create({
  btn: { height: 54, borderRadius: radius.pill, paddingHorizontal: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, overflow: 'hidden' },
  btnGhost: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.lineStrong },
  btnLabel: { fontFamily: fonts.semibold, fontSize: 16 },
  iconBtn: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  chip: { height: 36, paddingHorizontal: 15, borderRadius: radius.pill, flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.textDim },
  sliderHead: { flexDirection: 'row', justifyContent: 'space-between' },
  sliderHit: { height: 30, justifyContent: 'center' },
  sliderTrack: { height: 5, borderRadius: 3, backgroundColor: colors.surfaceHi, overflow: 'hidden' },
  sliderFill: { height: 5 },
  sliderThumb: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: colors.text, top: 4, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  swatchRing: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  segmented: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, padding: 4 },
  segment: { flex: 1, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: colors.surfaceHi },
});

import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { colors, fonts, radius } from '@/theme';

const useToast = create<{ message: string; n: number }>(() => ({ message: '', n: 0 }));

export function toast(message: string) {
  useToast.setState((s) => ({ message, n: s.n + 1 }));
}

export function Toast() {
  const { message, n } = useToast();
  const insets = useSafeAreaInsets();
  const v = useSharedValue(0);
  useEffect(() => {
    if (n) v.value = withSequence(withTiming(1, { duration: 220 }), withDelay(1700, withTiming(0, { duration: 300 })));
  }, [n, v]);
  const style = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ translateY: (1 - v.value) * -12 }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { top: insets.top + 12 }, style]}>
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', alignSelf: 'center', backgroundColor: colors.text, paddingHorizontal: 18, paddingVertical: 11, borderRadius: radius.pill, maxWidth: '86%' },
  text: { fontFamily: fonts.medium, fontSize: 13, color: colors.accentInk },
});

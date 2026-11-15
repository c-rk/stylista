import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconName, Press } from '@/components/ui';
import { Profile } from '@/screens/Profile';
import { Studio } from '@/screens/Studio';
import { Wardrobe } from '@/screens/Wardrobe';
import { Tab, useUi } from '@/store/ui';
import { colors, fonts, radius } from '@/theme';

const TABS: { id: Tab; label: string; icon: IconName; iconOn: IconName }[] = [
  { id: 'studio', label: 'Studio', icon: 'body-outline', iconOn: 'body' },
  { id: 'wardrobe', label: 'Wardrobe', icon: 'grid-outline', iconOn: 'grid' },
  { id: 'profile', label: 'You', icon: 'person-outline', iconOn: 'person' },
];

export const TAB_BAR_SPACE = 84;

export default function Home() {
  const insets = useSafeAreaInsets();
  const { tab, setTab } = useUi();
  return (
    <View style={styles.root}>
      {/* The studio stays mounted so the 3D context and camera pose survive tab switches. */}
      <Studio active={tab === 'studio'} />
      {tab !== 'studio' && (
        <Animated.View key={tab} entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
          {tab === 'wardrobe' ? <Wardrobe /> : <Profile />}
        </Animated.View>
      )}
      <View style={[styles.barWrap, { bottom: Math.max(insets.bottom, 12) }]} pointerEvents="box-none">
        <BlurView intensity={40} tint="dark" style={styles.bar}>
          {TABS.map((t) => {
            const on = t.id === tab;
            return (
              <Press key={t.id} onPress={() => setTab(t.id)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[styles.tab, on && styles.tabOn]}>
                <Ionicons name={on ? t.iconOn : t.icon} size={19} color={on ? colors.accentInk : colors.textDim} />
                {on && <Text style={styles.tabLabel}>{t.label}</Text>}
              </Press>
            );
          })}
        </BlurView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  barWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  bar: { flexDirection: 'row', gap: 4, padding: 6, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: 'rgba(30,30,38,0.72)', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.lineStrong },
  tab: { height: 46, minWidth: 54, paddingHorizontal: 17, borderRadius: radius.pill, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.accent },
  tabLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.accentInk },
});

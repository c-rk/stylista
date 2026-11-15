import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Press, StageBackdrop } from '@/components/ui';
import { bodyFromHeight, STARTER_GARMENTS } from '@/lib/catalog';
import { colors, fonts, space, type } from '@/theme';
import { Stage } from '@/three/Stage';

const pick = (...ids: string[]) => STARTER_GARMENTS.filter((g) => ids.includes(g.id));
const PAGES = [
  { title: 'You,\nin three dimensions.', body: 'Build a 3D model of your body in about a minute. Prop up your phone, follow the voice guide. No helper needed.', look: pick('st-tee', 'st-denim', 'st-sneaker') },
  { title: 'See it on\nbefore you buy.', body: 'Snap a piece in a shop, pick a photo, or paste one from the web. Turn it, zoom it, check every angle.', look: pick('st-dress', 'st-boot', 'st-hat', 'st-bag') },
  { title: 'Private\nby design.', body: 'Your model, photos and wardrobe are stored on this device only. No account. Nothing is uploaded.', look: pick('st-knit', 'st-skirt', 'st-sneaker', 'st-glasses', 'st-necklace') },
];
const BODY = bodyFromHeight(172, { hair: 'long' });

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const p = Math.round(e.nativeEvent.contentOffset.x / width);
    if (p !== page && p >= 0 && p < PAGES.length) setPage(p);
  };
  const next = () => {
    if (page < PAGES.length - 1) scroller.current?.scrollTo({ x: (page + 1) * width, animated: true });
    else router.push('/capture');
  };

  return (
    <View style={styles.root}>
      <StageBackdrop />
      <Animated.View entering={FadeIn.duration(900)} style={styles.stage}>
        <Stage body={BODY} garments={PAGES[page].look} interactive={false} />
      </Animated.View>
      <Text style={[styles.brand, { top: insets.top + 14 }]}>Stylista</Text>
      <View style={{ paddingBottom: insets.bottom + space.xl }}>
        <ScrollView ref={scroller} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={16}>
          {PAGES.map((p) => (
            <View key={p.title} style={[styles.page, { width }]}>
              <Text style={type.hero}>{p.title}</Text>
              <Text style={[type.body, { marginTop: space.md }]}>{p.body}</Text>
            </View>
          ))}
        </ScrollView>
        <View style={styles.dots}>
          {PAGES.map((p, i) => (
            <View key={p.title} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>
        <View style={styles.actions}>
          <Button label={page < PAGES.length - 1 ? 'Continue' : 'Create my model'} onPress={next} />
          <Press onPress={() => router.push({ pathname: '/body', params: { onboarding: '1' } })} style={styles.link}>
            <Text style={styles.linkText}>Enter measurements instead</Text>
          </Press>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  stage: { flex: 1 },
  brand: { position: 'absolute', alignSelf: 'center', fontFamily: fonts.displayItalic, fontSize: 24, color: colors.text, letterSpacing: 0.2 },
  page: { paddingHorizontal: space.xl },
  dots: { flexDirection: 'row', gap: 6, paddingHorizontal: space.xl, marginTop: space.xl },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.lineStrong },
  dotActive: { width: 22, backgroundColor: colors.accent },
  actions: { paddingHorizontal: space.xl, marginTop: space.xl, gap: space.sm },
  link: { alignSelf: 'center', paddingVertical: 10 },
  linkText: { fontFamily: fonts.medium, fontSize: 14, color: colors.textDim },
});

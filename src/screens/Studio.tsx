import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GarmentThumb } from '@/components/GarmentThumb';
import { toast } from '@/components/Toast';
import { Chip, IconButton, Press, StageBackdrop } from '@/components/ui';
import { CATEGORIES, KINDS } from '@/lib/catalog';
import { useStore, useWornGarments } from '@/store';
import { colors, fonts, radius, space, type } from '@/theme';
import { Focus, Stage } from '@/three/Stage';
import type { Category } from '@/types';

const FOCUS: Record<Category, Focus> = { tops: 'upper', dresses: 'full', bottoms: 'lower', shoes: 'feet', accessories: 'upper' };

export function Studio({ active }: { active: boolean }) {
  const insets = useSafeAreaInsets();
  const body = useStore((s) => s.body);
  const garments = useStore((s) => s.garments);
  const worn = useStore((s) => s.worn);
  const outfits = useStore((s) => s.outfits);
  const wornGarments = useWornGarments();
  const [category, setCategory] = useState<Category | null>(null);
  const wornIds = Object.values(worn);
  const list = garments.filter((g) => !category || KINDS[g.kind].category === category);

  const saveLook = () => {
    if (!wornIds.length) return toast('Put something on first');
    useStore.getState().saveOutfit(`Look ${outfits.length + 1}`);
    toast('Look saved to your wardrobe');
  };

  return (
    <View style={styles.root} pointerEvents={active ? 'auto' : 'none'}>
      <StageBackdrop />
      <Stage body={body} garments={wornGarments} focus={category ? FOCUS[category] : 'full'} style={{ marginBottom: 150 }} />
      <View style={[styles.top, { top: insets.top + 8 }]} pointerEvents="box-none">
        <View pointerEvents="none">
          <Text style={type.caption}>Studio</Text>
          <Text style={styles.title}>{wornGarments.length ? `${wornGarments.length} piece${wornGarments.length > 1 ? 's' : ''} on` : 'Nothing on yet'}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <IconButton icon="refresh" label="Take everything off" onPress={() => useStore.getState().clearWorn()} />
          <IconButton icon="bookmark-outline" label="Save look" onPress={saveLook} />
        </View>
      </View>
      <Text style={[styles.hint, { top: insets.top + 74 }]} pointerEvents="none">
        Drag to turn · pinch to zoom
      </Text>
      <View style={[styles.tray, { paddingBottom: Math.max(insets.bottom, 12) + 66 }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="All" active={!category} onPress={() => setCategory(null)} />
          {CATEGORIES.map((c) => (
            <Chip key={c.id} label={c.label} active={category === c.id} onPress={() => setCategory(category === c.id ? null : c.id)} />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
          <Press onPress={() => router.push('/garment/new')} accessibilityLabel="Add a piece" style={[styles.tile, styles.add]}>
            <Ionicons name="add" size={26} color={colors.accent} />
            <Text style={styles.addLabel}>Add</Text>
          </Press>
          {list.map((g) => {
            const on = wornIds.includes(g.id);
            return (
              <Press key={g.id} onPress={() => useStore.getState().toggleWear(g.id)} onLongPress={() => router.push({ pathname: '/garment/[id]', params: { id: g.id } })} accessibilityLabel={`${g.name}${on ? ', on' : ''}`} style={[styles.tile, on && styles.tileOn]}>
                <GarmentThumb garment={g} style={styles.thumb} iconSize={24} />
                {on && (
                  <View style={styles.check}>
                    <Ionicons name="checkmark" size={11} color={colors.accentInk} />
                  </View>
                )}
              </Press>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: colors.bg },
  top: { position: 'absolute', left: space.xl, right: space.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.text, marginTop: 2 },
  hint: { position: 'absolute', left: space.xl, fontFamily: fonts.body, fontSize: 12, color: colors.textFaint },
  tray: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: space.md },
  chips: { paddingHorizontal: space.lg, gap: 8 },
  rail: { paddingHorizontal: space.lg, gap: 10 },
  tile: { width: 68, height: 68, borderRadius: radius.md + 3, padding: 3, borderWidth: 2, borderColor: 'transparent' },
  tileOn: { borderColor: colors.accent },
  thumb: { flex: 1, borderRadius: radius.md - 2 },
  add: { backgroundColor: 'rgba(233,217,191,0.08)', borderColor: 'rgba(233,217,191,0.28)', borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  addLabel: { fontFamily: fonts.medium, fontSize: 10, color: colors.accent, marginTop: -2 },
  check: { position: 'absolute', right: -3, top: -3, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});

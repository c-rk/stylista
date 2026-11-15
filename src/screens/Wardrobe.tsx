import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GarmentThumb } from '@/components/GarmentThumb';
import { Chip, IconButton, Press } from '@/components/ui';
import { CATEGORIES, KINDS } from '@/lib/catalog';
import { useStore } from '@/store';
import { useUi } from '@/store/ui';
import { colors, fonts, radius, space, type } from '@/theme';
import type { Category } from '@/types';

export function Wardrobe() {
  const insets = useSafeAreaInsets();
  const garments = useStore((s) => s.garments);
  const outfits = useStore((s) => s.outfits);
  const worn = Object.values(useStore((s) => s.worn));
  const [category, setCategory] = useState<Category | null>(null);
  const list = garments.filter((g) => !category || KINDS[g.kind].category === category);

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 110 }} showsVerticalScrollIndicator={false}>
      <View style={styles.head}>
        <View>
          <Text style={type.caption}>{garments.length} pieces</Text>
          <Text style={type.title}>Wardrobe</Text>
        </View>
        <IconButton icon="add" label="Add a piece" active onPress={() => router.push('/garment/new')} />
      </View>

      {outfits.length > 0 && (
        <View style={{ marginTop: space.lg }}>
          <Text style={[type.heading, styles.section]}>Saved looks</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.xl, gap: 10 }}>
            {outfits.map((o) => {
              const items = o.garmentIds.map((id) => garments.find((g) => g.id === id)).filter((g) => !!g);
              return (
                <Press
                  key={o.id}
                  onPress={() => {
                    useStore.getState().applyOutfit(o.id);
                    useUi.getState().setTab('studio');
                  }}
                  style={styles.look}>
                  <View style={styles.lookGrid}>
                    {items.slice(0, 4).map((g) => (
                      <GarmentThumb key={g.id} garment={g} style={styles.lookCell} iconSize={16} />
                    ))}
                  </View>
                  <View style={styles.lookFoot}>
                    <Text style={type.label} numberOfLines={1}>
                      {o.name}
                    </Text>
                    <Press onPress={() => useStore.getState().removeOutfit(o.id)} hitSlop={10} accessibilityLabel={`Delete ${o.name}`}>
                      <Ionicons name="close" size={16} color={colors.textFaint} />
                    </Press>
                  </View>
                </Press>
              );
            })}
          </ScrollView>
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label="All" active={!category} onPress={() => setCategory(null)} />
        {CATEGORIES.map((c) => (
          <Chip key={c.id} label={c.label} active={category === c.id} onPress={() => setCategory(c.id)} />
        ))}
      </ScrollView>

      <View style={styles.grid}>
        {list.map((g) => (
          <Press key={g.id} onPress={() => router.push({ pathname: '/garment/[id]', params: { id: g.id } })} style={styles.card} scaleTo={0.97}>
            <GarmentThumb garment={g} style={styles.cardThumb} iconSize={40} />
            {worn.includes(g.id) && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>On</Text>
              </View>
            )}
            <Text style={[type.label, { marginTop: 10 }]} numberOfLines={1}>
              {g.name}
            </Text>
            <Text style={styles.kind}>{KINDS[g.kind].label}</Text>
          </Press>
        ))}
      </View>
      {list.length === 0 && <Text style={[type.body, { textAlign: 'center', marginTop: 40 }]}>Nothing here yet. Add your first piece.</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { paddingHorizontal: space.xl, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  section: { paddingHorizontal: space.xl, marginBottom: space.md },
  chips: { paddingHorizontal: space.xl, gap: 8, marginTop: space.xl, marginBottom: space.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: space.xl - 6 },
  card: { width: '50%', padding: 6, marginBottom: space.md },
  cardThumb: { aspectRatio: 0.82, borderRadius: radius.lg },
  kind: { fontFamily: fonts.body, fontSize: 12, color: colors.textFaint, marginTop: 1 },
  badge: { position: 'absolute', top: 16, left: 16, backgroundColor: colors.accent, paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill },
  badgeText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.accentInk },
  look: { width: 132, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  lookGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, height: 112, overflow: 'hidden' },
  lookCell: { width: 54, height: 54, borderRadius: radius.sm },
  lookFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingHorizontal: 2 },
});

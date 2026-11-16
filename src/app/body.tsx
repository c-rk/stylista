import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton, Segmented, Slider, StageBackdrop, Swatches } from '@/components/ui';
import { BODY_LIMITS, HAIR_COLORS, SKIN_TONES } from '@/lib/catalog';
import { formatLength } from '@/lib/units';
import { useStore, useWornGarments } from '@/store';
import { colors, radius, space, type } from '@/theme';
import { Stage } from '@/three/Stage';
import type { BodyParams, HairStyle } from '@/types';

const FIELDS: { key: keyof typeof BODY_LIMITS; label: string }[] = [
  { key: 'height', label: 'Height' },
  { key: 'shoulders', label: 'Shoulder width' },
  { key: 'chest', label: 'Chest' },
  { key: 'waist', label: 'Waist' },
  { key: 'hips', label: 'Hips' },
  { key: 'inseam', label: 'Inside leg' },
];

export default function BodyEditor() {
  const insets = useSafeAreaInsets();
  const { onboarding, scanned } = useLocalSearchParams<{ onboarding?: string; scanned?: string }>();
  const saved = useStore((s) => s.body);
  const units = useStore((s) => s.settings.units);
  const worn = useWornGarments();
  const [draft, setDraft] = useState<BodyParams>(saved);
  const [fitted, setFitted] = useState(true);
  const patch = (p: Partial<BodyParams>) => setDraft((d) => ({ ...d, ...p }));
  // Refitting the mesh and every garment is too heavy for each slider tick on a phone; the 3D
  // view follows the sliders at a short delay instead.
  const [shown, setShown] = useState<BodyParams>(saved);
  useEffect(() => {
    const id = setTimeout(() => setShown(draft), 140);
    return () => clearTimeout(id);
  }, [draft]);

  const save = () => {
    const store = useStore.getState();
    store.setBody(draft);
    if (onboarding) {
      store.completeOnboarding();
      router.dismissTo('/home');
    } else router.back();
  };

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        <StageBackdrop />
        <Stage body={shown} garments={fitted ? [] : worn} />
        <View style={[styles.top, { top: insets.top + 10 }]}>
          <IconButton icon="chevron-back" label="Back" onPress={() => router.back()} />
          <IconButton icon="shirt-outline" label="Toggle outfit" active={!fitted} onPress={() => setFitted((f) => !f)} />
        </View>
      </View>
      <View style={styles.sheet}>
        <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: space.xl, gap: space.lg }} showsVerticalScrollIndicator={false}>
          <View>
            <Text style={type.caption}>{scanned === '1' ? 'Measured from your capture' : scanned === '0' ? 'Capture incomplete' : 'Your model'}</Text>
            <Text style={[type.title, { marginTop: 4 }]}>{scanned ? 'Fine-tune your shape' : 'Measurements'}</Text>
            <Text style={[type.body, { marginTop: 6, fontSize: 13, lineHeight: 19 }]}>
              {scanned === '1'
                ? 'These come from your silhouette. Check them against a tape measure and adjust where needed.'
                : scanned === '0'
                  ? 'Your whole body was not inside the outline, so average proportions for your height are shown. Adjust below or capture again.'
                  : 'The model updates as you drag. A tape measure gives the best fit.'}
            </Text>
          </View>
          <Slider label="Build" value={draft.gender ?? 0} onChange={(gender) => patch({ gender })} format={(v) => (v < 0.34 ? 'Feminine' : v > 0.66 ? 'Masculine' : 'Neutral')} />
          {FIELDS.map((f) => (
            <Slider
              key={f.key}
              label={f.label}
              value={draft[f.key]}
              min={BODY_LIMITS[f.key][0]}
              max={BODY_LIMITS[f.key][1]}
              step={1}
              onChange={(v) => patch({ [f.key]: v })}
              format={(v) => formatLength(v, units, f.key === 'height')}
            />
          ))}
          <View style={{ gap: space.sm }}>
            <Text style={type.label}>Skin tone</Text>
            <Swatches colorsList={SKIN_TONES} value={draft.skin} onChange={(skin) => patch({ skin })} />
          </View>
          <View style={{ gap: space.sm }}>
            <Text style={type.label}>Hair</Text>
            <Segmented<HairStyle>
              options={[
                { id: 'none', label: 'None' },
                { id: 'short', label: 'Short' },
                { id: 'long', label: 'Long' },
              ]}
              value={draft.hair}
              onChange={(hair) => patch({ hair })}
            />
            {draft.hair !== 'none' && <Swatches colorsList={HAIR_COLORS} value={draft.hairColor} onChange={(hairColor) => patch({ hairColor })} />}
          </View>
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
          <Button label={onboarding ? 'Looks like me' : 'Save'} onPress={save} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  stage: { height: '42%' },
  top: { position: 'absolute', left: space.lg, right: space.lg, flexDirection: 'row', justifyContent: 'space-between' },
  sheet: { flex: 1, backgroundColor: colors.bgElevated, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, marginTop: -radius.xl, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.lineStrong },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
});

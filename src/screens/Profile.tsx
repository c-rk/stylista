import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Alert, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toast } from '@/components/Toast';
import { Button, IconName, Press, Segmented } from '@/components/ui';
import { wipeImages } from '@/lib/images';
import { formatLength } from '@/lib/units';
import { hdReconstructor } from '@/ml';
import { useStore } from '@/store';
import { useUi } from '@/store/ui';
import { colors, fonts, radius, space, type } from '@/theme';

function Row({ icon, title, note, right, onPress }: { icon: IconName; title: string; note?: string; right?: React.ReactNode; onPress?: () => void }) {
  const inner = (
    <View style={styles.row}>
      <Ionicons name={icon} size={20} color={colors.accent} />
      <View style={{ flex: 1 }}>
        <Text style={type.label}>{title}</Text>
        {note && <Text style={styles.note}>{note}</Text>}
      </View>
      {right ?? (onPress && <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />)}
    </View>
  );
  return onPress ? (
    <Press onPress={onPress} scaleTo={0.985}>
      {inner}
    </Press>
  ) : (
    inner
  );
}

export function Profile() {
  const insets = useSafeAreaInsets();
  const body = useStore((s) => s.body);
  const settings = useStore((s) => s.settings);
  const captures = useStore((s) => s.captures);
  const set = useStore((s) => s.setSettings);
  const u = settings.units;

  const erase = () => {
    const run = () => {
      wipeImages();
      useStore.getState().reset();
      useUi.getState().setTab('studio');
      router.replace('/onboarding');
    };
    if (Platform.OS === 'web') {
      if (globalThis.confirm?.('Delete your model, photos and wardrobe from this device?')) run();
      return;
    }
    Alert.alert('Delete everything?', 'Your model, capture photos, wardrobe and saved looks are removed from this device. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: run },
    ]);
  };

  const stats: [string, string][] = [
    ['Height', formatLength(body.height, u, true)],
    ['Chest', formatLength(body.chest, u)],
    ['Waist', formatLength(body.waist, u)],
    ['Hips', formatLength(body.hips, u)],
    ['Shoulders', formatLength(body.shoulders, u)],
    ['Inside leg', formatLength(body.inseam, u)],
  ];

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: space.xl, paddingBottom: insets.bottom + 110, gap: space.lg }} showsVerticalScrollIndicator={false}>
      <View>
        <Text style={type.caption}>Your model</Text>
        <Text style={type.title}>You</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.stats}>
          {stats.map(([k, v]) => (
            <View key={k} style={styles.stat}>
              <Text style={styles.statValue}>{v}</Text>
              <Text style={styles.note}>{k}</Text>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: space.lg }}>
          <Button label="Edit model" variant="ghost" icon="options-outline" style={{ flex: 1, height: 48, paddingHorizontal: 10 }} onPress={() => router.push('/body')} />
          <Button label={captures.length ? 'Re-capture' : 'Capture'} variant="ghost" icon="scan-outline" style={{ flex: 1, height: 48, paddingHorizontal: 10 }} onPress={() => router.push('/capture')} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={[type.label, { marginBottom: 10 }]}>Units</Text>
        <Segmented
          options={[
            { id: 'cm', label: 'Centimetres' },
            { id: 'in', label: 'Inches' },
          ]}
          value={u}
          onChange={(units) => set({ units })}
        />
        <View style={styles.sep} />
        <Row icon="volume-medium-outline" title="Voice guidance" note="Spoken prompts during body capture" right={<Switch value={settings.voiceGuidance} onValueChange={(voiceGuidance) => set({ voiceGuidance })} trackColor={{ true: colors.accent, false: colors.surfaceHi }} thumbColor="#fff" />} />
        <View style={styles.sep} />
        <Row
          icon="sparkles-outline"
          title="HD reconstruction"
          note={hdReconstructor.available ? 'Optional. Sends a garment photo to a server for a detailed 3D mesh. The photo is deleted after processing.' : 'Optional cloud processing. Off: background removal, body measurement and draping all run on this device.'}
          right={
            <Switch
              value={settings.hdCloud && hdReconstructor.available}
              disabled={!hdReconstructor.available}
              onValueChange={(hdCloud) => {
                set({ hdCloud });
                if (hdCloud) toast('Garment photos will be sent for HD processing');
              }}
              trackColor={{ true: colors.accent, false: colors.surfaceHi }}
              thumbColor="#fff"
            />
          }
        />
      </View>

      <View style={styles.card}>
        <Row icon="lock-closed-outline" title="Stored on this device only" note={`Model, ${captures.length} capture photo${captures.length === 1 ? '' : 's'}, wardrobe and looks live in this app's private storage. No account, no upload.`} />
      </View>

      <Button label="Delete all my data" variant="danger" icon="trash-outline" onPress={erase} />
      <Text style={[styles.note, { textAlign: 'center' }]}>Stylista 1.0 · milestone 1</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  stats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.lg },
  stat: { width: '33.33%' },
  statValue: { fontFamily: fonts.display, fontSize: 24, color: colors.text },
  note: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.textFaint, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: space.lg },
});

import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GarmentThumb } from '@/components/GarmentThumb';
import { toast } from '@/components/Toast';
import { Button, Chip, IconButton, IconName, Press, Segmented, Slider, StageBackdrop, Swatches } from '@/components/ui';
import { FABRIC_COLORS, KIND_ORDER, KINDS } from '@/lib/catalog';
import { deleteImage, persistImage } from '@/lib/images';
import { garmentAnalyzer } from '@/ml';
import { useStore } from '@/store';
import { useUi } from '@/store/ui';
import { colors, fonts, radius, space, type } from '@/theme';
import { Stage } from '@/three/Stage';
import type { Garment, GarmentKind, GarmentShape, TextureMode } from '@/types';

const SOURCES: { id: 'camera' | 'library' | 'paste'; icon: IconName; title: string; body: string }[] = [
  { id: 'camera', icon: 'camera-outline', title: 'Take a photo', body: 'In a shop: shoot the piece flat-on, filling the frame.' },
  { id: 'library', icon: 'images-outline', title: 'Choose from photos', body: 'A screenshot or saved product picture.' },
  { id: 'paste', icon: 'clipboard-outline', title: 'Paste', body: 'An image, or an image link, copied from a website.' },
];

async function acquire(source: 'camera' | 'library' | 'paste'): Promise<string | null> {
  if (source === 'paste') {
    if (await Clipboard.hasImageAsync().catch(() => false)) {
      const img = await Clipboard.getImageAsync({ format: 'jpeg', jpegQuality: 0.9 });
      if (img?.data) return img.data;
    }
    const text = (await Clipboard.getStringAsync().catch(() => '')).trim();
    if (/^https?:\/\/\S+$/i.test(text)) return text;
    throw new Error('No image on the clipboard');
  }
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera access is off');
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
    return r.canceled ? null : r.assets[0].uri;
  }
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
  return r.canceled ? null : r.assets[0].uri;
}

function blank(): Garment {
  return { id: `g-${Date.now()}`, name: '', kind: 'top', color: FABRIC_COLORS[0], textureMode: 'solid', shape: { ...KINDS.top.defaults }, createdAt: Date.now() };
}

export function GarmentEditor({ existing }: { existing?: Garment }) {
  const insets = useSafeAreaInsets();
  const body = useStore((s) => s.body);
  const garments = useStore((s) => s.garments);
  const worn = useStore((s) => s.worn);
  const [draft, setDraft] = useState<Garment>(existing ?? blank);
  const [step, setStep] = useState<'source' | 'edit'>(existing ? 'edit' : 'source');
  const [busy, setBusy] = useState(false);
  const info = KINDS[draft.kind];
  const patch = (p: Partial<Garment>) => setDraft((d) => ({ ...d, ...p }));
  const shape = (p: Partial<GarmentShape>) => setDraft((d) => ({ ...d, shape: { ...d.shape, ...p } }));

  // Preview the draft over the current outfit, replacing whatever conflicts with it.
  const slot = info.slot;
  const others = garments.filter((g) => {
    if (g.id === draft.id || !Object.values(worn).includes(g.id)) return false;
    const s = KINDS[g.kind].slot;
    if (s === slot) return false;
    if (slot === 'dress' && (s === 'top' || s === 'bottom')) return false;
    if ((slot === 'top' || slot === 'bottom') && s === 'dress') return false;
    return true;
  });

  const pickSource = async (source: 'camera' | 'library' | 'paste') => {
    try {
      setBusy(true);
      const raw = await acquire(source);
      if (!raw) return;
      const imageUri = await persistImage(raw, 'garments');
      const { color, textureUri } = await garmentAnalyzer.analyze(imageUri);
      if (draft.imageUri && draft.imageUri !== existing?.imageUri) {
        deleteImage(draft.imageUri);
        deleteImage(draft.textureUri);
      }
      patch({ imageUri, textureUri, color, textureMode: 'print' });
      setStep('edit');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load that image');
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (draft.imageUri !== existing?.imageUri) {
      deleteImage(draft.imageUri);
      deleteImage(draft.textureUri);
    }
    router.back();
  };

  const save = () => {
    const store = useStore.getState();
    const final = { ...draft, name: draft.name.trim() || info.label };
    if (existing) {
      if (existing.imageUri && existing.imageUri !== final.imageUri) {
        deleteImage(existing.imageUri);
        deleteImage(existing.textureUri);
      }
      store.updateGarment(existing.id, final);
      router.back();
    } else {
      store.addGarment(final);
      store.toggleWear(final.id);
      useUi.getState().setTab('studio');
      toast('Added. Now wearing it');
      router.back();
    }
  };

  const remove = () => {
    const run = () => {
      deleteImage(existing?.imageUri);
      deleteImage(existing?.textureUri);
      useStore.getState().removeGarment(draft.id);
      router.back();
    };
    if (Platform.OS === 'web') return run();
    Alert.alert('Delete this piece?', draft.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: run },
    ]);
  };

  if (step === 'source') {
    return (
      <View style={styles.root}>
        <StageBackdrop />
        <View style={[styles.sourceHead, { paddingTop: insets.top + 10 }]}>
          <IconButton icon="close" label="Close" onPress={close} />
        </View>
        <View style={styles.sourceBody}>
          <Text style={type.caption}>New piece</Text>
          <Text style={[type.title, { marginTop: space.sm }]}>Where is it?</Text>
          <View style={{ gap: space.md, marginTop: space.xl }}>
            {SOURCES.map((s, i) => (
              <Animated.View key={s.id} entering={FadeInDown.delay(60 * i).duration(320)}>
                <Press onPress={() => pickSource(s.id)} disabled={busy} style={styles.source} scaleTo={0.98}>
                  <View style={styles.sourceIcon}>
                    <Ionicons name={s.icon} size={22} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={type.heading}>{s.title}</Text>
                    <Text style={[type.body, { fontSize: 13, lineHeight: 18 }]}>{s.body}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
                </Press>
              </Animated.View>
            ))}
          </View>
          <Press onPress={() => setStep('edit')} style={styles.link}>
            <Text style={styles.linkText}>No photo, start from a colour</Text>
          </Press>
        </View>
        {busy && (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.accent} />
            <Text style={[type.body, { marginTop: 10 }]}>Analysing on device…</Text>
          </View>
        )}
      </View>
    );
  }

  const controls = Object.entries(info.controls) as [keyof GarmentShape, string][];
  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.stage}>
        <StageBackdrop />
        <Stage body={body} garments={[...others, draft]} focus={info.focus} />
        <View style={[styles.top, { top: insets.top + 10 }]} pointerEvents="box-none">
          <IconButton icon={existing ? 'chevron-back' : 'close'} label="Close" onPress={close} />
          {existing && !existing.starter && <IconButton icon="trash-outline" label="Delete piece" onPress={remove} />}
        </View>
      </View>
      <Animated.View entering={FadeIn} style={styles.sheet}>
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.nameRow}>
            <Press onPress={() => pickSource('library')} accessibilityLabel="Change photo">
              <GarmentThumb garment={draft} style={styles.thumb} iconSize={22} />
            </Press>
            <TextInput value={draft.name} onChangeText={(name) => patch({ name })} placeholder={`Name this ${info.label.toLowerCase().split(' ')[0]}`} placeholderTextColor={colors.textFaint} style={styles.input} returnKeyType="done" maxLength={40} />
          </View>

          <View style={{ gap: space.sm }}>
            <Text style={type.label}>Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: space.xl }} style={{ marginHorizontal: -space.xl }}>
              {KIND_ORDER.map((k: GarmentKind) => (
                <Chip key={k} label={KINDS[k].label} icon={KINDS[k].icon as IconName} active={draft.kind === k} onPress={() => patch({ kind: k, shape: { ...KINDS[k].defaults } })} />
              ))}
            </ScrollView>
          </View>

          {draft.imageUri && info.category !== 'accessories' && info.category !== 'shoes' && (
            <View style={{ gap: space.sm }}>
              <Text style={type.label}>Surface</Text>
              <Segmented<TextureMode>
                options={[
                  { id: 'print', label: 'Photo' },
                  { id: 'fabric', label: 'Pattern' },
                  { id: 'solid', label: 'Colour' },
                ]}
                value={draft.textureMode}
                onChange={(textureMode) => patch({ textureMode })}
              />
            </View>
          )}

          {(draft.textureMode === 'solid' || !draft.imageUri || info.category === 'accessories' || info.category === 'shoes') && (
            <View style={{ gap: space.sm }}>
              <Text style={type.label}>Colour</Text>
              <Swatches colorsList={FABRIC_COLORS.includes(draft.color) ? FABRIC_COLORS : [draft.color, ...FABRIC_COLORS.slice(0, 9)]} value={draft.color} onChange={(color) => patch({ color })} />
            </View>
          )}

          {controls.map(([key, label]) => (
            <Slider key={key} label={label} value={draft.shape[key]} onChange={(v) => shape({ [key]: v })} />
          ))}
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
          <Button label={existing ? 'Save changes' : 'Add to wardrobe'} onPress={save} />
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  sourceHead: { paddingHorizontal: space.lg },
  sourceBody: { flex: 1, paddingHorizontal: space.xl, paddingTop: space.xl },
  source: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  sourceIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(233,217,191,0.1)', alignItems: 'center', justifyContent: 'center' },
  link: { alignSelf: 'center', paddingVertical: 14, marginTop: space.md },
  linkText: { fontFamily: fonts.medium, fontSize: 14, color: colors.textDim },
  busy: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(10,10,13,0.8)', alignItems: 'center', justifyContent: 'center' },
  stage: { height: '44%' },
  top: { position: 'absolute', left: space.lg, right: space.lg, flexDirection: 'row', justifyContent: 'space-between' },
  sheet: { flex: 1, backgroundColor: colors.bgElevated, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, marginTop: -radius.xl, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.lineStrong },
  nameRow: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  thumb: { width: 54, height: 54, borderRadius: radius.md },
  input: { flex: 1, fontFamily: fonts.display, fontSize: 26, color: colors.text, paddingVertical: 6 },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
});

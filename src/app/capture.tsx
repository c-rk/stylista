import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { DeviceMotion } from 'expo-sensors';
import * as Speech from 'expo-speech';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Ellipse, Path } from 'react-native-svg';

import { Button, IconButton, IconName, Press, Slider, StageBackdrop } from '@/components/ui';
import { bodyFromHeight } from '@/lib/catalog';
import { persistImage } from '@/lib/images';
import { formatLength } from '@/lib/units';
import { analyzeBody } from '@/ml';
import { useStore } from '@/store';
import { colors, fonts, radius, space, type } from '@/theme';

const POSES = [
  { id: 'front', title: 'Face the camera', say: 'Step back until your whole body fits inside the outline. Face the camera, arms slightly away from your sides.' },
  { id: 'left', title: 'Turn to your left', say: 'Now turn a quarter turn to your left.' },
  { id: 'back', title: 'Face away', say: 'Turn again so your back faces the camera.' },
  { id: 'right', title: 'One more quarter turn', say: 'One more quarter turn.' },
] as const;

const TIPS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'phone-portrait-outline', title: 'Prop your phone upright', body: 'Waist height, against a shelf or wall, about 2.5 m away.' },
  { icon: 'shirt-outline', title: 'Wear fitted clothes', body: 'Close-fitting clothing gives the most accurate shape.' },
  { icon: 'scan-outline', title: 'Fill the outline', body: 'Step back until you fit head to toe between the two guide lines.' },
];

const STAGES = ['Separating you from the background', 'Measuring your silhouette', 'Sculpting your model'];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Silhouette() {
  return (
    <Svg viewBox="0 0 200 480" style={StyleSheet.absoluteFill} preserveAspectRatio="xMidYMid meet">
      <Ellipse cx={100} cy={52} rx={26} ry={32} stroke="#fff" strokeOpacity={0.75} strokeWidth={2} strokeDasharray="6 7" fill="none" />
      <Path
        d="M84 86 Q60 92 50 108 L26 236 Q24 250 34 250 Q42 250 44 238 L64 150 L66 250 L62 440 Q62 456 78 456 Q92 456 92 440 L100 270 L108 440 Q108 456 122 456 Q138 456 138 440 L134 250 L136 150 L156 238 Q158 250 166 250 Q176 250 174 236 L150 108 Q140 92 116 86 Z"
        stroke="#fff"
        strokeOpacity={0.75}
        strokeWidth={2}
        strokeDasharray="6 7"
        fill="rgba(255,255,255,0.04)"
      />
    </Svg>
  );
}

export default function Capture() {
  const insets = useSafeAreaInsets();
  const body = useStore((s) => s.body);
  const settings = useStore((s) => s.settings);
  const [phase, setPhase] = useState<'intro' | 'camera' | 'processing'>('intro');
  const [height, setHeight] = useState(body.height);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [pose, setPose] = useState(0);
  const [count, setCount] = useState<number | null>(null);
  const [level, setLevel] = useState(true);
  const [stage, setStage] = useState(0);
  const camera = useRef<CameraView>(null);
  const flash = useSharedValue(0);
  const progress = useSharedValue(0);

  const say = (text: string) => {
    if (settings.voiceGuidance) Speech.speak(text, { rate: 0.98 });
  };

  // Upright check: beta is ~90 degrees when the phone stands vertically.
  useEffect(() => {
    if (phase !== 'camera' || Platform.OS === 'web') return;
    let sub: { remove(): void } | undefined;
    DeviceMotion.isAvailableAsync()
      .then((ok) => {
        if (!ok) return;
        DeviceMotion.setUpdateInterval(250);
        sub = DeviceMotion.addListener((m) => {
          if (m.rotation) setLevel(Math.abs(m.rotation.beta - Math.PI / 2) < 0.2);
        });
      })
      .catch(() => {});
    return () => sub?.remove();
  }, [phase]);

  const finish = async (captures: string[]) => {
    setPhase('processing');
    say('All done. Building your model.');
    progress.value = withTiming(0.9, { duration: 6000 });
    setStage(0);
    const store = useStore.getState();
    const ticker = setInterval(() => setStage((n) => Math.min(STAGES.length - 1, n + 1)), 1500);
    const result = await analyzeBody(captures, height, store.body);
    clearInterval(ticker);
    progress.value = withTiming(1, { duration: 250 });
    store.setCaptures(captures);
    store.setBody({ ...result.body, face: result.face });
    await wait(300);
    router.replace({ pathname: '/body', params: { onboarding: '1', scanned: result.measured ? '1' : '0' } });
  };

  // Hands-free sequence: voice prompt, countdown, shutter, repeat for each pose.
  useEffect(() => {
    if (phase !== 'camera' || !cameraReady) return;
    let cancelled = false;
    (async () => {
      const captures: string[] = [];
      for (let i = 0; i < POSES.length && !cancelled; i++) {
        setPose(i);
        say(POSES[i].say);
        await wait(i === 0 ? 5500 : 2800);
        for (let c = 3; c >= 1 && !cancelled; c--) {
          setCount(c);
          if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
          await wait(1000);
        }
        if (cancelled) return;
        setCount(null);
        flash.value = 1;
        flash.value = withTiming(0, { duration: 380 });
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        try {
          const shot = await camera.current?.takePictureAsync({ quality: 0.85, skipProcessing: false });
          if (shot?.uri) captures.push(await persistImage(shot.uri, 'captures', i === 0 ? 2048 : 1280));
        } catch {
          // A failed frame does not abort the session.
        }
      }
      if (!cancelled) finish(captures);
    })();
    return () => {
      cancelled = true;
      Speech.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, cameraReady]);

  const start = async () => {
    const p = permission?.granted ? permission : await requestPermission();
    if (p.granted) setPhase('camera');
  };

  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));
  const barStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  const denied = permission && !permission.granted && !permission.canAskAgain;

  if (phase === 'processing') {
    return (
      <View style={[styles.root, styles.center]}>
        <StageBackdrop />
        <Animated.View entering={FadeIn} style={{ width: '72%', alignItems: 'center' }}>
          <Text style={[type.title, { textAlign: 'center' }]}>Building your model</Text>
          <Animated.Text key={stage} entering={FadeIn} style={[type.body, { marginTop: space.md }]}>
            {STAGES[stage]}…
          </Animated.Text>
          <View style={styles.bar}>
            <Animated.View style={[styles.barFill, barStyle]} />
          </View>
          <Text style={[type.body, { fontSize: 12, marginTop: space.lg, textAlign: 'center' }]}>Processed on this device.</Text>
        </Animated.View>
      </View>
    );
  }

  if (phase === 'camera') {
    return (
      <View style={[styles.root, { backgroundColor: '#000' }]}>
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="front" mirror onCameraReady={() => setCameraReady(true)} />
        <View pointerEvents="none" style={[styles.outline, { top: insets.top + 84, bottom: insets.bottom + 96 }]}>
          <Silhouette />
          {/* Boundary: the whole body has to sit between these two lines to be measured. */}
          <View style={[styles.limit, { top: 0 }]}>
            <Text style={styles.limitText}>Head below this line</Text>
          </View>
          <View style={[styles.limit, { bottom: 0 }]}>
            <Text style={styles.limitText}>Feet above this line</Text>
          </View>
        </View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff' }, flashStyle]} />
        <View style={[styles.camTop, { top: insets.top + 10 }]}>
          <IconButton icon="close" label="Cancel capture" onPress={() => setPhase('intro')} />
          <Animated.View key={pose} entering={FadeIn} exiting={FadeOut} style={styles.prompt}>
            <Text style={styles.promptText}>{POSES[pose].title}</Text>
          </Animated.View>
          <View style={{ width: 44 }} />
        </View>
        {count !== null && (
          <Animated.Text key={count} entering={ZoomIn.duration(220)} style={styles.count}>
            {count}
          </Animated.Text>
        )}
        <View style={[styles.camBottom, { bottom: insets.bottom + 24 }]}>
          {!level && (
            <View style={styles.warn}>
              <Ionicons name="warning-outline" size={14} color={colors.accentInk} />
              <Text style={styles.warnText}>Stand the phone upright</Text>
            </View>
          )}
          <View style={styles.poseDots}>
            {POSES.map((p, i) => (
              <View key={p.id} style={[styles.poseDot, i < pose && { backgroundColor: colors.success }, i === pose && { backgroundColor: colors.accent, width: 26 }]} />
            ))}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StageBackdrop />
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <IconButton icon="chevron-back" label="Back" onPress={() => router.back()} />
      </View>
      <View style={styles.intro}>
        <Text style={type.caption}>Body capture · about 1 minute</Text>
        <Text style={[type.title, { marginTop: space.sm }]}>Four poses, hands-free.</Text>
        <Text style={[type.body, { marginTop: space.sm }]}>A voice guide tells you when to turn. The shutter fires on its own.</Text>
        <View style={styles.tips}>
          {TIPS.map((t) => (
            <View key={t.title} style={styles.tip}>
              <View style={styles.tipIcon}>
                <Ionicons name={t.icon} size={20} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={type.heading}>{t.title}</Text>
                <Text style={[type.body, { fontSize: 13, lineHeight: 18 }]}>{t.body}</Text>
              </View>
            </View>
          ))}
        </View>
        <View style={styles.card}>
          <Slider label="Your height" value={height} min={140} max={210} step={1} onChange={setHeight} format={(v) => formatLength(v, settings.units, true)} />
        </View>
      </View>
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.lg }]}>
        {denied && <Text style={[type.body, { color: colors.danger, textAlign: 'center', fontSize: 13 }]}>Camera access is off. Enable it in system settings, or enter measurements.</Text>}
        <Button label="Start capture" icon="camera-outline" onPress={start} />
        <Press
          onPress={() => {
            const { chest, waist, hips, shoulders, inseam } = bodyFromHeight(height);
            useStore.getState().setBody({ height, chest, waist, hips, shoulders, inseam });
            router.replace({ pathname: '/body', params: { onboarding: '1' } });
          }}
          style={styles.link}>
          <Text style={styles.linkText}>Skip, enter measurements</Text>
        </Press>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: space.lg },
  intro: { flex: 1, paddingHorizontal: space.xl, paddingTop: space.lg },
  tips: { marginTop: space.xl, gap: space.lg },
  tip: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  tipIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(233,217,191,0.1)', alignItems: 'center', justifyContent: 'center' },
  card: { marginTop: space.xl, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  footer: { paddingHorizontal: space.xl, gap: space.sm },
  link: { alignSelf: 'center', paddingVertical: 10 },
  linkText: { fontFamily: fonts.medium, fontSize: 14, color: colors.textDim },
  outline: { position: 'absolute', left: 30, right: 30 },
  limit: { position: 'absolute', left: -18, right: -18, borderTopWidth: 2, borderColor: colors.accent, alignItems: 'center' },
  limitText: { fontFamily: fonts.medium, fontSize: 11, color: colors.accentInk, backgroundColor: colors.accent, paddingHorizontal: 8, paddingVertical: 2, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, overflow: 'hidden' },
  camTop: { position: 'absolute', left: space.lg, right: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  prompt: { backgroundColor: 'rgba(10,10,13,0.72)', paddingHorizontal: 18, paddingVertical: 10, borderRadius: radius.pill },
  promptText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  count: { position: 'absolute', alignSelf: 'center', top: '36%', fontFamily: fonts.display, fontSize: 150, color: '#fff', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 24 },
  camBottom: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: space.md },
  warn: { flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: colors.accent, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill },
  warnText: { fontFamily: fonts.medium, fontSize: 13, color: colors.accentInk },
  poseDots: { flexDirection: 'row', gap: 6 },
  poseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.35)' },
  bar: { width: '100%', height: 4, borderRadius: 2, backgroundColor: colors.surfaceHi, marginTop: space.xl, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: colors.accent },
});

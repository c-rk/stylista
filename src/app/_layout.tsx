import { InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic } from '@expo-google-fonts/instrument-serif';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Toast } from '@/components/Toast';
import { useStore } from '@/store';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic, Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  const hydrated = useStore((s) => s.hydrated);
  const ready = fontsLoaded && hydrated;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade' }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="capture" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="body" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="home" />
          <Stack.Screen name="dev" />
          <Stack.Screen name="garment/new" options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
          <Stack.Screen name="garment/[id]" options={{ animation: 'slide_from_right' }} />
        </Stack>
        <Toast />
      </View>
    </SafeAreaProvider>
  );
}

import { Redirect, useLocalSearchParams } from 'expo-router';

import { GarmentEditor } from '@/screens/GarmentEditor';
import { useStore } from '@/store';

export default function EditGarment() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const garment = useStore((s) => s.garments.find((g) => g.id === id));
  if (!garment) return <Redirect href="/home" />;
  return <GarmentEditor existing={garment} />;
}

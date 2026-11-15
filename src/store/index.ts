import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { bodyFromHeight, KINDS, STARTER_GARMENTS } from '@/lib/catalog';
import type { BodyParams, Garment, Outfit, Settings, Slot, Worn } from '@/types';

interface State {
  hydrated: boolean;
  onboarded: boolean;
  body: BodyParams;
  /** Local URIs of self-capture photos, kept on device for the shape estimator. */
  captures: string[];
  garments: Garment[];
  worn: Worn;
  outfits: Outfit[];
  settings: Settings;

  setBody: (b: Partial<BodyParams>) => void;
  setCaptures: (uris: string[]) => void;
  completeOnboarding: () => void;
  addGarment: (g: Garment) => void;
  updateGarment: (id: string, patch: Partial<Garment>) => void;
  removeGarment: (id: string) => void;
  toggleWear: (id: string) => void;
  clearWorn: () => void;
  saveOutfit: (name: string) => void;
  applyOutfit: (id: string) => void;
  removeOutfit: (id: string) => void;
  setSettings: (s: Partial<Settings>) => void;
  reset: () => void;
}

const initial = {
  onboarded: false,
  body: bodyFromHeight(170),
  captures: [] as string[],
  garments: STARTER_GARMENTS,
  worn: { top: 'st-tee', bottom: 'st-denim', shoes: 'st-sneaker' } as Worn,
  outfits: [] as Outfit[],
  settings: { units: 'cm', voiceGuidance: true, hdCloud: false } as Settings,
};

/** Wearing a dress removes top/bottom and vice versa. */
function wear(worn: Worn, g: Garment): Worn {
  const slot = KINDS[g.kind].slot;
  const next: Worn = { ...worn };
  if (next[slot] === g.id) {
    delete next[slot];
    return next;
  }
  next[slot] = g.id;
  if (slot === 'dress') {
    delete next.top;
    delete next.bottom;
  } else if (slot === 'top' || slot === 'bottom') {
    delete next.dress;
  }
  return next;
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      hydrated: false,
      ...initial,
      setBody: (b) => set({ body: { ...get().body, ...b } }),
      setCaptures: (captures) => set({ captures }),
      completeOnboarding: () => set({ onboarded: true }),
      addGarment: (g) => set({ garments: [g, ...get().garments] }),
      updateGarment: (id, patch) => set({ garments: get().garments.map((g) => (g.id === id ? { ...g, ...patch } : g)) }),
      removeGarment: (id) => {
        const worn = Object.fromEntries(Object.entries(get().worn).filter(([, v]) => v !== id)) as Worn;
        set({
          garments: get().garments.filter((g) => g.id !== id),
          worn,
          outfits: get().outfits.map((o) => ({ ...o, garmentIds: o.garmentIds.filter((x) => x !== id) })),
        });
      },
      toggleWear: (id) => {
        const g = get().garments.find((x) => x.id === id);
        if (g) set({ worn: wear(get().worn, g) });
      },
      clearWorn: () => set({ worn: {} }),
      saveOutfit: (name) => {
        const garmentIds = Object.values(get().worn).filter(Boolean) as string[];
        if (!garmentIds.length) return;
        set({ outfits: [{ id: `o-${Date.now()}`, name, garmentIds, createdAt: Date.now() }, ...get().outfits] });
      },
      applyOutfit: (id) => {
        const o = get().outfits.find((x) => x.id === id);
        if (!o) return;
        const worn: Worn = {};
        for (const gid of o.garmentIds) {
          const g = get().garments.find((x) => x.id === gid);
          if (g) worn[KINDS[g.kind].slot as Slot] = g.id;
        }
        set({ worn });
      },
      removeOutfit: (id) => set({ outfits: get().outfits.filter((o) => o.id !== id) }),
      setSettings: (s) => set({ settings: { ...get().settings, ...s } }),
      reset: () => set({ ...initial }),
    }),
    {
      name: 'stylista-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _h, ...rest }) =>
        Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== 'function')) as unknown as State,
      onRehydrateStorage: () => () => useStore.setState({ hydrated: true }),
    },
  ),
);

export const useWornGarments = () => {
  const garments = useStore((s) => s.garments);
  const worn = useStore((s) => s.worn);
  const ids = Object.values(worn);
  return garments.filter((g) => ids.includes(g.id));
};

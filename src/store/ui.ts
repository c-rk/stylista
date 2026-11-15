import { create } from 'zustand';

export type Tab = 'studio' | 'wardrobe' | 'profile';
export const useUi = create<{ tab: Tab; setTab: (t: Tab) => void }>((set) => ({ tab: 'studio', setTab: (tab) => set({ tab }) }));

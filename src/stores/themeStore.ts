import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeId =
  | 'dark-midnight'
  | 'dark-cyan'
  | 'dark-bronze'
  | 'dark-frost'
  | 'dark-purple'
  | 'dark-pink'
  | 'dark-red'
  | 'light';

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
  primaryColor: string;
  backgroundSample: string;
  isLight: boolean;
}

export const THEMES: ThemeDefinition[] = [
  { id: 'dark-midnight', label: 'Midnight', primaryColor: '#3b82f6', backgroundSample: '#0a0a12', isLight: false },
  { id: 'dark-cyan', label: 'Cyan', primaryColor: '#06b6d4', backgroundSample: '#0a1214', isLight: false },
  { id: 'dark-bronze', label: 'Bronze', primaryColor: '#d97706', backgroundSample: '#121008', isLight: false },
  { id: 'dark-frost', label: 'Frost', primaryColor: '#e2e8f0', backgroundSample: '#0f1115', isLight: false },
  { id: 'dark-purple', label: 'Purple', primaryColor: '#a855f7', backgroundSample: '#0e0a14', isLight: false },
  { id: 'dark-pink', label: 'Pink', primaryColor: '#ec4899', backgroundSample: '#140a10', isLight: false },
  { id: 'dark-red', label: 'Red', primaryColor: '#ef4444', backgroundSample: '#140a0a', isLight: false },
  { id: 'light', label: 'Light', primaryColor: '#2554b0', backgroundSample: '#f0ede6', isLight: true },
];

function applyTheme(id: ThemeId) {
  if (id === 'dark-midnight') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', id);
  }
}

interface ThemeState {
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      themeId: 'dark-midnight' as ThemeId,
      setTheme: (id: ThemeId) => {
        applyTheme(id);
        set({ themeId: id });
      },
    }),
    {
      name: 'persona-theme',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.themeId);
      },
    }
  )
);

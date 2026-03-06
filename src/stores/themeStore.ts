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
  accentColor: string;
  backgroundSample: string;
  foregroundSample: string;
  isLight: boolean;
}

export const THEMES: ThemeDefinition[] = [
  { id: 'dark-midnight', label: 'Midnight', primaryColor: '#3b82f6', accentColor: '#8b5cf6', backgroundSample: '#0a0a12', foregroundSample: '#f0f0f5', isLight: false },
  { id: 'dark-cyan', label: 'Cyan', primaryColor: '#06b6d4', accentColor: '#22d3ee', backgroundSample: '#0a1214', foregroundSample: '#e0f2fe', isLight: false },
  { id: 'dark-bronze', label: 'Bronze', primaryColor: '#d97706', accentColor: '#f59e0b', backgroundSample: '#121008', foregroundSample: '#fef3c7', isLight: false },
  { id: 'dark-frost', label: 'Frost', primaryColor: '#e2e8f0', accentColor: '#f8fafc', backgroundSample: '#0f1115', foregroundSample: '#f1f5f9', isLight: false },
  { id: 'dark-purple', label: 'Purple', primaryColor: '#a855f7', accentColor: '#c084fc', backgroundSample: '#0e0a14', foregroundSample: '#f3e8ff', isLight: false },
  { id: 'dark-pink', label: 'Pink', primaryColor: '#ec4899', accentColor: '#f472b6', backgroundSample: '#140a10', foregroundSample: '#fce7f3', isLight: false },
  { id: 'dark-red', label: 'Red', primaryColor: '#ef4444', accentColor: '#f87171', backgroundSample: '#140a0a', foregroundSample: '#fee2e2', isLight: false },
  { id: 'light', label: 'Light', primaryColor: '#2554b0', accentColor: '#3568c7', backgroundSample: '#f0ede6', foregroundSample: '#1c1c28', isLight: true },
];

let transitionTimer: ReturnType<typeof setTimeout> | undefined;

function applyTheme(id: ThemeId) {
  const el = document.documentElement;

  // Add transition class for cross-fade, then remove after animation completes
  clearTimeout(transitionTimer);
  el.classList.add('theme-transitioning');
  transitionTimer = setTimeout(() => el.classList.remove('theme-transitioning'), 250);

  if (id === 'dark-midnight') {
    el.removeAttribute('data-theme');
  } else {
    el.setAttribute('data-theme', id);
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

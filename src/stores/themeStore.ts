import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CustomThemeConfig } from '@/lib/theme/deriveCustomTheme';
import { deriveCustomThemeVars, injectCustomThemeStyle, removeCustomThemeStyle } from '@/lib/theme/deriveCustomTheme';

export type { CustomThemeConfig } from '@/lib/theme/deriveCustomTheme';

export type ThemeId =
  | 'dark-midnight'
  | 'dark-cyan'
  | 'dark-bronze'
  | 'dark-frost'
  | 'dark-purple'
  | 'dark-pink'
  | 'dark-red'
  | 'dark-matrix'
  | 'light'
  | 'light-ice'
  | 'light-news'
  | 'custom';

export type TextScale = 'large' | 'larger';

export type TimezoneMode = 'local' | 'utc' | string; // string for IANA like 'America/New_York'

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
  { id: 'dark-red', label: 'Red', primaryColor: '#cc0000', accentColor: '#e60000', backgroundSample: '#080808', foregroundSample: '#ededed', isLight: false },
  { id: 'dark-matrix', label: 'Matrix', primaryColor: '#00ff41', accentColor: '#20c20e', backgroundSample: '#050505', foregroundSample: '#d4d4d4', isLight: false },
  { id: 'light', label: 'Light', primaryColor: '#2554b0', accentColor: '#3568c7', backgroundSample: '#e9e6df', foregroundSample: '#1c1c28', isLight: true },
  { id: 'light-ice', label: 'Ice', primaryColor: '#2563eb', accentColor: '#38bdf8', backgroundSample: '#e8eff6', foregroundSample: '#0f172a', isLight: true },
  { id: 'light-news', label: 'News', primaryColor: '#1a1a1a', accentColor: '#555555', backgroundSample: '#e0ded9', foregroundSample: '#111111', isLight: true },
];

export const TEXT_SCALES: { id: TextScale; label: string; description: string }[] = [
  { id: 'large', label: 'Standard', description: 'Default text size' },
  { id: 'larger', label: 'Larger', description: 'Maximum readability' },
];

/** Build a ThemeDefinition from a custom theme config (for rendering a swatch). */
export function customThemeDef(config: CustomThemeConfig): ThemeDefinition {
  const vars = deriveCustomThemeVars(config);
  return {
    id: 'custom',
    label: config.label || 'Custom',
    primaryColor: config.primaryColor,
    accentColor: config.accentColor ?? vars['--accent'] ?? config.primaryColor,
    backgroundSample: vars['--background'] ?? '#0a0e14',
    foregroundSample: vars['--foreground'] ?? '#e2e8f0',
    isLight: config.baseMode === 'light',
  };
}

let transitionTimer: ReturnType<typeof setTimeout> | undefined;

function applyThemeToDOM(id: ThemeId, customConfig?: CustomThemeConfig | null) {
  const el = document.documentElement;

  // Add transition class for cross-fade, then remove after animation completes
  clearTimeout(transitionTimer);
  el.classList.add('theme-transitioning');
  transitionTimer = setTimeout(() => el.classList.remove('theme-transitioning'), 250);

  // Inject or remove the custom theme stylesheet
  if (id === 'custom' && customConfig) {
    injectCustomThemeStyle(deriveCustomThemeVars(customConfig));
  }

  if (id === 'dark-midnight') {
    el.removeAttribute('data-theme');
  } else {
    el.setAttribute('data-theme', id);
  }

  // Toggle dark class for Tailwind compatibility
  const isLight = id === 'custom'
    ? customConfig?.baseMode === 'light'
    : id.startsWith('light');

  if (isLight) {
    el.classList.remove('dark');
  } else {
    el.classList.add('dark');
  }
}

function applyTextScale(scale: TextScale) {
  document.documentElement.setAttribute('data-text-scale', scale);
}

interface ThemeState {
  themeId: ThemeId;
  textScale: TextScale;
  timezone: TimezoneMode;
  customTheme: CustomThemeConfig | null;
  setTheme: (id: ThemeId) => void;
  setTextScale: (scale: TextScale) => void;
  setTimezone: (tz: TimezoneMode) => void;
  setCustomTheme: (config: CustomThemeConfig) => void;
  clearCustomTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      themeId: 'dark-midnight' as ThemeId,
      textScale: 'large' as TextScale,
      timezone: 'local' as TimezoneMode,
      customTheme: null as CustomThemeConfig | null,
      setTheme: (id: ThemeId) => {
        applyThemeToDOM(id, get().customTheme);
        set({ themeId: id });
      },
      setTextScale: (scale: TextScale) => {
        applyTextScale(scale);
        set({ textScale: scale });
      },
      setTimezone: (tz: TimezoneMode) => set({ timezone: tz }),
      setCustomTheme: (config: CustomThemeConfig) => {
        set({ customTheme: config });
        // Inject styles and activate
        applyThemeToDOM('custom', config);
        set({ themeId: 'custom' });
      },
      clearCustomTheme: () => {
        removeCustomThemeStyle();
        const fallback: ThemeId = 'dark-midnight';
        applyThemeToDOM(fallback, null);
        set({ customTheme: null, themeId: fallback });
      },
    }),
    {
      name: 'persona-theme',
      onRehydrateStorage: () => (state) => {
        if (state) {
          if (state.themeId === 'custom' && state.customTheme) {
            injectCustomThemeStyle(deriveCustomThemeVars(state.customTheme));
          }
          applyThemeToDOM(state.themeId, state.customTheme);
          applyTextScale(state.textScale ?? 'large');
        }
      },
    }
  )
);

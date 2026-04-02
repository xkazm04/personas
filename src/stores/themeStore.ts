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

export type TextScale = 'compact' | 'default' | 'large' | 'larger';

export type BrightnessLevel = 'low' | 'mid' | 'high';

interface BrightnessDef { id: BrightnessLevel; label: string; description: string; value: number }

/** Dark themes: old default was too dark → 1.25 is the new baseline, two brighter above. */
export const DARK_BRIGHTNESS_LEVELS: BrightnessDef[] = [
  { id: 'low',  label: 'Standard',  description: 'Default depth',          value: 1.25 },
  { id: 'mid',  label: 'Bright',    description: 'Lifted for dim displays', value: 1.38 },
  { id: 'high', label: 'Brighter',  description: 'Maximum clarity',        value: 1.50 },
];

/** Light themes: full brightness is the standard, two darker variants below. */
export const LIGHT_BRIGHTNESS_LEVELS: BrightnessDef[] = [
  { id: 'low',  label: 'Dimmer',    description: 'Reduced glare',   value: 0.82 },
  { id: 'mid',  label: 'Soft',      description: 'Gentle on eyes',  value: 0.91 },
  { id: 'high', label: 'Standard',  description: 'Full brightness', value: 1.0 },
];

/** Resolve the numeric filter value for a given level + theme mode. */
export function brightnessValue(level: BrightnessLevel, isLight: boolean): number {
  const levels = isLight ? LIGHT_BRIGHTNESS_LEVELS : DARK_BRIGHTNESS_LEVELS;
  return levels.find((l) => l.id === level)?.value ?? 1.0;
}

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
  { id: 'dark-matrix', label: 'Matrix', primaryColor: '#00ff41', accentColor: '#20c20e', backgroundSample: '#050505', foregroundSample: '#e8e8e8', isLight: false },
  { id: 'light', label: 'Light', primaryColor: '#2554b0', accentColor: '#3568c7', backgroundSample: '#e9e6df', foregroundSample: '#1c1c28', isLight: true },
  { id: 'light-ice', label: 'Ice', primaryColor: '#2563eb', accentColor: '#38bdf8', backgroundSample: '#e8eff6', foregroundSample: '#0f172a', isLight: true },
  { id: 'light-news', label: 'News', primaryColor: '#1a1a1a', accentColor: '#555555', backgroundSample: '#e0ded9', foregroundSample: '#111111', isLight: true },
];

export const TEXT_SCALES: { id: TextScale; label: string; description: string }[] = [
  { id: 'compact', label: 'Compact', description: 'Dense data views' },
  { id: 'default', label: 'Default', description: 'Balanced readability' },
  { id: 'large', label: 'Large', description: 'Comfortable reading' },
  { id: 'larger', label: 'Larger', description: 'Maximum readability' },
];

const TEXT_SCALE_MULTIPLIERS: Record<TextScale, number> = {
  compact: 13 / 14,
  default: 1,
  large: 15 / 14,
  larger: 16.5 / 14,
};

/**
 * Returns a function that scales a base px value according to the active text-scale.
 * Use in contexts where CSS class scaling doesn't apply (Recharts props, SVG attributes).
 *
 * @example
 * const sf = useScaledFontSize();
 * <XAxis tick={{ fontSize: sf(10) }} />
 */
export function useScaledFontSize(): (basePx: number) => number {
  const scale = useThemeStore((s) => s.textScale);
  const m = TEXT_SCALE_MULTIPLIERS[scale];
  return (basePx: number) => Math.round(basePx * m * 10) / 10;
}

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

function isLightTheme(id: ThemeId, customConfig?: CustomThemeConfig | null): boolean {
  if (id === 'custom') return customConfig?.baseMode === 'light';
  return id.startsWith('light');
}

/** Tokens that should be visually immune to the brightness filter. */
const BRIGHTNESS_EXEMPT_TOKENS = [
  'status-success', 'status-warning', 'status-error', 'status-info',
  'status-pending', 'status-processing', 'status-neutral',
  'brand-cyan', 'brand-purple', 'brand-emerald', 'brand-amber', 'brand-rose',
] as const;

function applyBrightness(level: BrightnessLevel, themeId: ThemeId, customConfig?: CustomThemeConfig | null) {
  const light = isLightTheme(themeId, customConfig);
  const val = brightnessValue(level, light);
  const el = document.documentElement;
  el.style.setProperty('--app-brightness', String(val));

  // Temporarily remove data-brightness so getComputedStyle reads the theme's
  // unmodified status/brand values (not values already counteracted by a previous level).
  el.removeAttribute('data-brightness');
  void el.offsetHeight; // force style recalc

  const computed = getComputedStyle(el);
  for (const token of BRIGHTNESS_EXEMPT_TOKENS) {
    const current = computed.getPropertyValue(`--${token}`).trim();
    if (current) el.style.setProperty(`--${token}-raw`, current);
  }

  // Set data-brightness="dark-low" / "light-mid" etc. for CSS counteraction
  el.setAttribute('data-brightness', `${light ? 'light' : 'dark'}-${level}`);
}

interface ThemeState {
  themeId: ThemeId;
  textScale: TextScale;
  timezone: TimezoneMode;
  brightness: BrightnessLevel;
  customTheme: CustomThemeConfig | null;
  setTheme: (id: ThemeId) => void;
  setTextScale: (scale: TextScale) => void;
  setTimezone: (tz: TimezoneMode) => void;
  setBrightness: (level: BrightnessLevel) => void;
  setCustomTheme: (config: CustomThemeConfig) => void;
  clearCustomTheme: () => void;
}

/** Derived selector: true when the active theme is dark. */
export function useIsDarkTheme(): boolean {
  const themeId = useThemeStore((s) => s.themeId);
  if (themeId === 'custom') {
    return useThemeStore.getState().customTheme?.baseMode !== 'light';
  }
  return !themeId.startsWith('light');
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      themeId: 'dark-midnight' as ThemeId,
      textScale: 'default' as TextScale,
      timezone: 'local' as TimezoneMode,
      brightness: 'low' as BrightnessLevel,
      customTheme: null as CustomThemeConfig | null,
      setTheme: (id: ThemeId) => {
        applyThemeToDOM(id, get().customTheme);
        applyBrightness(get().brightness, id, get().customTheme);
        set({ themeId: id });
      },
      setTextScale: (scale: TextScale) => {
        applyTextScale(scale);
        set({ textScale: scale });
      },
      setTimezone: (tz: TimezoneMode) => set({ timezone: tz }),
      setBrightness: (level: BrightnessLevel) => {
        applyBrightness(level, get().themeId, get().customTheme);
        set({ brightness: level });
      },
      setCustomTheme: (config: CustomThemeConfig) => {
        set({ customTheme: config });
        // Inject styles and activate
        applyThemeToDOM('custom', config);
        applyBrightness(get().brightness, 'custom', config);
        set({ themeId: 'custom' });
      },
      clearCustomTheme: () => {
        removeCustomThemeStyle();
        const fallback: ThemeId = 'dark-midnight';
        applyThemeToDOM(fallback, null);
        applyBrightness(get().brightness, fallback, null);
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
          applyTextScale(state.textScale ?? 'default');
          applyBrightness(state.brightness ?? 'low', state.themeId, state.customTheme);
        }
      },
    }
  )
);

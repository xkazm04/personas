import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CustomThemeConfig } from '@/lib/theme/deriveCustomTheme';
import { deriveCustomThemeVars, injectCustomThemeStyle, removeCustomThemeStyle } from '@/lib/theme/deriveCustomTheme';
import { storeBus } from '@/lib/storeBus';
import { DEFAULT_DENSITY, isDensity, type Density } from '@/lib/density';
import { createDedupedJSONStorage } from './util/dedupedStorage';

export type { Density } from '@/lib/density';

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
  | 'light-sage'
  | 'light-sand'
  | 'custom';

export type TextScale = 'large' | 'larger' | 'xl';

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

/** Tailwind opacity utilities for brightness-level icon glyphs, indexed alongside *_BRIGHTNESS_LEVELS. */
export const BRIGHTNESS_ICON_OPACITY_BY_INDEX = ['opacity-40', 'opacity-70', 'opacity-100'] as const;

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
  { id: 'light', label: 'Light', primaryColor: '#2563eb', accentColor: '#3b82f6', backgroundSample: '#f7f8fa', foregroundSample: '#0f172a', isLight: true },
  { id: 'light-ice', label: 'Ice', primaryColor: '#2563eb', accentColor: '#38bdf8', backgroundSample: '#e8eff6', foregroundSample: '#0f172a', isLight: true },
  { id: 'light-news', label: 'News', primaryColor: '#1a1a1a', accentColor: '#555555', backgroundSample: '#e0ded9', foregroundSample: '#111111', isLight: true },
  { id: 'light-sage', label: 'Sage', primaryColor: '#047857', accentColor: '#10b981', backgroundSample: '#f1f4f1', foregroundSample: '#142119', isLight: true },
  { id: 'light-sand', label: 'Sand', primaryColor: '#92400e', accentColor: '#d97706', backgroundSample: '#f5f2eb', foregroundSample: '#2a2418', isLight: true },
];

export const TEXT_SCALES: { id: TextScale; label: string; description: string }[] = [
  { id: 'large', label: 'Small', description: 'Compact readability' },
  { id: 'larger', label: 'Standard', description: 'Default — comfortable reading' },
  { id: 'xl', label: 'Large', description: 'Maximum readability' },
];

const TEXT_SCALE_MULTIPLIERS: Record<TextScale, number> = {
  large: 15 / 14,
  larger: 16.5 / 14,
  xl: 18 / 14,
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
  } else {
    removeCustomThemeStyle();
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

function applyDim(dim: boolean) {
  const el = document.documentElement;
  if (dim) {
    el.setAttribute('data-saturation', 'dim');
  } else {
    el.removeAttribute('data-saturation');
  }
}

function applyCvdSafe(cvdSafe: boolean) {
  const el = document.documentElement;
  if (cvdSafe) {
    el.setAttribute('data-cvd', 'safe');
  } else {
    el.removeAttribute('data-cvd');
  }
}

function applyHighContrast(highContrast: boolean) {
  const el = document.documentElement;
  if (highContrast) {
    el.setAttribute('data-contrast', 'high');
  } else {
    el.removeAttribute('data-contrast');
  }
}

function applyReduceMotion(reduceMotion: boolean) {
  const el = document.documentElement;
  if (reduceMotion) {
    el.setAttribute('data-motion', 'reduce');
  } else {
    el.removeAttribute('data-motion');
  }
}

/** Drive the app-wide density CSS variables (--density-pad/-gap/…) via the
 *  data-density attribute on <html>. See the [data-density=…] blocks in
 *  globals.css. `comfortable` is the :root default, so the attribute is still
 *  set for it (inspectable + future-proof) but matches no override block. */
function applyDensity(density: Density) {
  document.documentElement.setAttribute('data-density', density);
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

  // Synchronous: remove data-brightness, read computed styles, then re-set.
  // The previous rAF+microtask version caused post-render freeze by triggering
  // two full CSS recalculations on 500+ DOM nodes after first paint.
  el.removeAttribute('data-brightness');
  void el.offsetHeight; // force style recalc

  const computed = getComputedStyle(el);
  for (const token of BRIGHTNESS_EXEMPT_TOKENS) {
    const current = computed.getPropertyValue(`--${token}`).trim();
    if (current) el.style.setProperty(`--${token}-raw`, current);
  }

  el.setAttribute('data-brightness', `${light ? 'light' : 'dark'}-${level}`);
}

interface ThemeState {
  themeId: ThemeId;
  textScale: TextScale;
  timezone: TimezoneMode;
  brightness: BrightnessLevel;
  customTheme: CustomThemeConfig | null;
  ambientTimeOfDay: boolean;
  dim: boolean;
  cvdSafe: boolean;
  highContrast: boolean;
  reduceMotion: boolean;
  density: Density;
  setTheme: (id: ThemeId) => void;
  setTextScale: (scale: TextScale) => void;
  setTimezone: (tz: TimezoneMode) => void;
  setBrightness: (level: BrightnessLevel) => void;
  setCustomTheme: (config: CustomThemeConfig) => void;
  clearCustomTheme: () => void;
  setAmbientTimeOfDay: (enabled: boolean) => void;
  setDim: (enabled: boolean) => void;
  setCvdSafe: (enabled: boolean) => void;
  setHighContrast: (enabled: boolean) => void;
  setReduceMotion: (enabled: boolean) => void;
  setDensity: (density: Density) => void;
}

/** Derived selector: true when the active theme is dark. */
export function useIsDarkTheme(): boolean {
  return useThemeStore((s) => {
    if (s.themeId === 'custom') {
      return s.customTheme?.baseMode !== 'light';
    }
    return !s.themeId.startsWith('light');
  });
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      themeId: 'dark-midnight' as ThemeId,
      textScale: 'larger' as TextScale,
      timezone: 'local' as TimezoneMode,
      brightness: 'low' as BrightnessLevel,
      customTheme: null as CustomThemeConfig | null,
      ambientTimeOfDay: true,
      dim: false,
      cvdSafe: false,
      highContrast: false,
      reduceMotion: false,
      density: DEFAULT_DENSITY,
      setTheme: (id: ThemeId) => {
        applyThemeToDOM(id, get().customTheme);
        applyBrightness(get().brightness, id, get().customTheme);
        set({ themeId: id });
        storeBus.emit('appearance:changed', { field: 'themeId', value: id });
      },
      setTextScale: (scale: TextScale) => {
        applyTextScale(scale);
        set({ textScale: scale });
        storeBus.emit('appearance:changed', { field: 'textScale', value: scale });
      },
      setTimezone: (tz: TimezoneMode) => set({ timezone: tz }),
      setBrightness: (level: BrightnessLevel) => {
        applyBrightness(level, get().themeId, get().customTheme);
        set({ brightness: level });
        storeBus.emit('appearance:changed', { field: 'brightness', value: level });
      },
      setCustomTheme: (config: CustomThemeConfig) => {
        // Inject styles and activate
        applyThemeToDOM('custom', config);
        applyBrightness(get().brightness, 'custom', config);
        // Single set() to avoid intermediate state where customTheme and themeId disagree
        set({ customTheme: config, themeId: 'custom' });
      },
      clearCustomTheme: () => {
        removeCustomThemeStyle();
        const fallback: ThemeId = 'dark-midnight';
        applyThemeToDOM(fallback, null);
        applyBrightness(get().brightness, fallback, null);
        set({ customTheme: null, themeId: fallback });
      },
      setAmbientTimeOfDay: (enabled: boolean) => {
        set({ ambientTimeOfDay: enabled });
        storeBus.emit('appearance:changed', { field: 'ambientTimeOfDay', value: enabled ? 'on' : 'off' });
      },
      setDim: (enabled: boolean) => {
        applyDim(enabled);
        set({ dim: enabled });
        storeBus.emit('appearance:changed', { field: 'dim', value: enabled ? 'on' : 'off' });
      },
      setCvdSafe: (enabled: boolean) => {
        applyCvdSafe(enabled);
        set({ cvdSafe: enabled });
        storeBus.emit('appearance:changed', { field: 'cvdSafe', value: enabled ? 'on' : 'off' });
      },
      setHighContrast: (enabled: boolean) => {
        applyHighContrast(enabled);
        set({ highContrast: enabled });
        storeBus.emit('appearance:changed', { field: 'highContrast', value: enabled ? 'on' : 'off' });
      },
      setReduceMotion: (enabled: boolean) => {
        applyReduceMotion(enabled);
        set({ reduceMotion: enabled });
        storeBus.emit('appearance:changed', { field: 'reduceMotion', value: enabled ? 'on' : 'off' });
      },
      setDensity: (density: Density) => {
        applyDensity(density);
        set({ density });
        storeBus.emit('appearance:changed', { field: 'density', value: density });
      },
    }),
    {
      name: 'persona-theme',
      storage: createDedupedJSONStorage(),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Migrate removed 'default' scale to 'large' (new "Small")
          if ((state.textScale as string) === 'default') {
            state.textScale = 'large';
          }
          if (state.themeId === 'custom' && state.customTheme) {
            injectCustomThemeStyle(deriveCustomThemeVars(state.customTheme));
          }
          applyThemeToDOM(state.themeId, state.customTheme);
          applyTextScale(state.textScale ?? 'larger');
          applyBrightness(state.brightness ?? 'low', state.themeId, state.customTheme);
          applyDim(state.dim ?? false);
          applyCvdSafe(state.cvdSafe ?? false);
          applyHighContrast(state.highContrast ?? false);
          applyReduceMotion(state.reduceMotion ?? false);
          applyDensity(isDensity(state.density) ? state.density : DEFAULT_DENSITY);
        }
      },
    }
  )
);

import { useMemo } from 'react';
import {
  Wind, SunDim, Contrast, Eye, Sunrise,
  Palette, Type, Sun, LayoutGrid, Clock,
  type LucideIcon,
} from 'lucide-react';
import { useThemeStore } from '@/stores/themeStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useSidebarLabels } from '@/i18n/useSidebarTranslation';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { getSettingsItems } from '@/features/shared/chrome/sidebar/sidebarData';
import { settingEntry, type PaletteItem } from '@/features/shared/chrome/commandPaletteUtils';
import type { SettingsTab } from '@/lib/types/types';

/**
 * Result of {@link useSettingsSearchEntries}.
 * - `all` is every searchable settings entry (toggles, deep links, tab nav).
 * - `recommended` is the curated subset shown when the palette opens focused on
 *   settings with an empty query (the "Recommended" group).
 */
export interface SettingsSearchEntries {
  all: PaletteItem[];
  recommended: PaletteItem[];
}

const ICON = 'w-4 h-4';

/** Tabs without an entry in the shared sidebar label map fall back to here. */
const TAB_FALLBACK_KEYS: Partial<Record<SettingsTab, 'limits' | 'api_keys' | 'history'>> = {
  limits: 'limits',
  'api-keys': 'api_keys',
  history: 'history',
};

/**
 * Contributes the Settings domain's searchable "setup" entries to the global
 * command palette.
 *
 * This is the reference implementation of the search-entry provider pattern: a
 * `use<Domain>SearchEntries()` hook that returns {@link PaletteItem}s built with
 * {@link settingEntry}. To surface another area's setup in search, add a sibling
 * hook (e.g. `useAgentSearchEntries`) and merge it in `CommandPalette`. Boolean
 * settings get a `toggle` binding (flips inline, palette stays open); everything
 * else gets `onNavigate` (deep-links to the relevant settings tab).
 */
export function useSettingsSearchEntries(): SettingsSearchEntries {
  const { t } = useTranslation();
  const labels = useSidebarLabels();
  const tier = useTier();

  // Appearance toggles (theme store) — flip directly from search results.
  const reduceMotion = useThemeStore((s) => s.reduceMotion);
  const dim = useThemeStore((s) => s.dim);
  const highContrast = useThemeStore((s) => s.highContrast);
  const cvdSafe = useThemeStore((s) => s.cvdSafe);
  const ambient = useThemeStore((s) => s.ambientTimeOfDay);
  const setReduceMotion = useThemeStore((s) => s.setReduceMotion);
  const setDim = useThemeStore((s) => s.setDim);
  const setHighContrast = useThemeStore((s) => s.setHighContrast);
  const setCvdSafe = useThemeStore((s) => s.setCvdSafe);
  const setAmbient = useThemeStore((s) => s.setAmbientTimeOfDay);

  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setSettingsTab = useSystemStore((s) => s.setSettingsTab);

  const s = t.settings.search;
  // useTier() returns a fresh object each render; depend on the primitive so
  // the memo below is actually stable across renders.
  const currentTier = tier.current;

  return useMemo<SettingsSearchEntries>(() => {
    const goto = (tab: SettingsTab) => () => {
      setSidebarSection('settings');
      setSettingsTab(tab);
    };
    const appearance = labels('appearance');
    const icon = (Icon: LucideIcon) => <Icon className={ICON} />;

    // -- Inline toggles (Appearance) — flip directly in the results -----
    const reduceMotionEntry = settingEntry({
      id: 'reduce-motion', label: s.reduce_motion, description: appearance, icon: icon(Wind),
      keywords: ['animation', 'transitions', 'accessibility', 'motion'],
      toggle: { isOn: reduceMotion, onToggle: setReduceMotion },
    });
    const dimEntry = settingEntry({
      id: 'dim', label: s.dim, description: appearance, icon: icon(SunDim),
      keywords: ['saturation', 'muted', 'colors', 'intensity'],
      toggle: { isOn: dim, onToggle: setDim },
    });
    const highContrastEntry = settingEntry({
      id: 'high-contrast', label: s.high_contrast, description: appearance, icon: icon(Contrast),
      keywords: ['accessibility', 'legibility', 'contrast'],
      toggle: { isOn: highContrast, onToggle: setHighContrast },
    });
    const cvdSafeEntry = settingEntry({
      id: 'cvd-safe', label: s.cvd_safe, description: appearance, icon: icon(Eye),
      keywords: ['colorblind', 'color blind', 'accessibility', 'deuteranopia', 'protanopia'],
      toggle: { isOn: cvdSafe, onToggle: setCvdSafe },
    });
    const ambientEntry = settingEntry({
      id: 'ambient', label: s.ambient, description: appearance, icon: icon(Sunrise),
      keywords: ['ambient', 'illustration', 'title bar', 'day', 'night', 'header'],
      toggle: { isOn: ambient, onToggle: setAmbient },
    });
    const toggles = [reduceMotionEntry, dimEntry, highContrastEntry, cvdSafeEntry, ambientEntry];

    // -- Deep links into Appearance sections ----------------------------
    const themeEntry = settingEntry({ id: 'theme', label: s.theme, description: appearance, icon: icon(Palette), keywords: ['dark', 'light', 'color', 'accent'], onNavigate: goto('appearance') });
    const densityEntry = settingEntry({ id: 'density', label: s.density, description: appearance, icon: icon(LayoutGrid), keywords: ['compact', 'comfortable', 'spacing', 'layout'], onNavigate: goto('appearance') });
    const sections = [
      themeEntry,
      settingEntry({ id: 'text-size', label: s.text_size, description: appearance, icon: icon(Type), keywords: ['font', 'scale', 'larger', 'readability'], onNavigate: goto('appearance') }),
      settingEntry({ id: 'brightness', label: s.brightness, description: appearance, icon: icon(Sun), keywords: ['bright', 'dim', 'screen'], onNavigate: goto('appearance') }),
      densityEntry,
      settingEntry({ id: 'timezone', label: s.timezone, description: appearance, icon: icon(Clock), keywords: ['time', 'zone', 'utc', 'local'], onNavigate: goto('appearance') }),
    ];

    // -- One entry per visible settings tab (tier / dev aware) ----------
    const tabs = getSettingsItems(import.meta.env.DEV, currentTier).map((item) => {
      const tabId = item.id as SettingsTab;
      const fallbackKey = TAB_FALLBACK_KEYS[tabId];
      const label = labels(item.id, fallbackKey ? s.tabs[fallbackKey] : item.label);
      const Icon = item.icon as LucideIcon;
      return settingEntry({
        id: `tab-${tabId}`, label, icon: icon(Icon),
        keywords: [item.label.toLowerCase(), 'settings'],
        onNavigate: goto(tabId),
      });
    });

    const recommended = [reduceMotionEntry, dimEntry, highContrastEntry, ambientEntry, themeEntry, densityEntry];
    const all = [...toggles, ...sections, ...tabs];
    return { all, recommended };
  }, [
    s, labels, currentTier, reduceMotion, dim, highContrast, cvdSafe, ambient,
    setReduceMotion, setDim, setHighContrast, setCvdSafe, setAmbient,
    setSidebarSection, setSettingsTab,
  ]);
}

import { Palette, Type, Rows2, Sun, Languages } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { SettingsScaffold, type SettingsSection } from '@/features/shared/components/layout/settings/SettingsScaffold';
import { useTranslation } from '@/i18n/useTranslation';
import { UI_LANGUAGE_PICKER_ENABLED } from '@/i18n/locales.manifest';
import AppearanceLanguageSettings from './AppearanceLanguageSettings';
import AppearanceTextSizeSettings from './AppearanceTextSizeSettings';
import AppearanceDensitySettings from './AppearanceDensitySettings';
import AppearanceBrightnessSettings from './AppearanceBrightnessSettings';
import AppearanceThemingSection from './AppearanceThemingSection';

/**
 * Appearance settings — thin orchestrator. Each section is a self-contained
 * component that subscribes to only the themeStore slices it needs (kept
 * under ~200 LOC each per the section split); they're laid out by the shared
 * SettingsScaffold (left quick-nav rail + SectionCard sections).
 */
export default function AppearanceSettings() {
  const { t } = useTranslation();
  const s = t.settings.appearance;

  const sections: SettingsSection[] = [
    // Only when there is a language to choose (SHIPPED_UI_LOCALES; English-only since 2026-10-25).
    ...(UI_LANGUAGE_PICKER_ENABLED
      ? [{ id: 'language', label: s.language, icon: <Languages className="w-4 h-4 text-emerald-400" />, content: <AppearanceLanguageSettings /> }]
      : []),
    { id: 'text-size', label: s.text_size, icon: <Type className="w-4 h-4 text-violet-400" />, content: <AppearanceTextSizeSettings /> },
    { id: 'density', label: s.density, icon: <Rows2 className="w-4 h-4 text-blue-400" />, content: <AppearanceDensitySettings /> },
    // Timezone picker hidden (operator choice 2026-10-31): themeStore.timezone has no reader. Store field + persistence kept.
    { id: 'brightness', label: s.brightness, icon: <Sun className="w-4 h-4 text-amber-400" />, content: <AppearanceBrightnessSettings /> },
    // Theming brings its own SectionCard (its header carries the default/custom tab switch).
    { id: 'theming', label: s.theming, icon: <Palette className="w-4 h-4 text-violet-400" />, card: false, content: <AppearanceThemingSection /> },
  ];

  return (
    <ContentBox data-testid="settings-appearance-panel">
      <ContentHeader
        icon={<Palette className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={s.title}
        subtitle={s.subtitle}
      />

      <ContentBody centered>
        <SettingsScaffold sections={sections} navAriaLabel={s.title} />
      </ContentBody>
    </ContentBox>
  );
}

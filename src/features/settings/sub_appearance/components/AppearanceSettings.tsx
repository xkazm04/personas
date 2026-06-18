import { Palette, Type, Rows2, Globe, Sun } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { SettingsScaffold, type SettingsSection } from '@/features/shared/components/layout/settings/SettingsScaffold';
import { useTranslation } from '@/i18n/useTranslation';
import AppearanceTextSizeSettings from './AppearanceTextSizeSettings';
import AppearanceDensitySettings from './AppearanceDensitySettings';
import AppearanceTimezoneSettings from './AppearanceTimezoneSettings';
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
    { id: 'text-size', label: s.text_size, icon: <Type className="w-4 h-4 text-violet-400" />, content: <AppearanceTextSizeSettings /> },
    { id: 'density', label: s.density, icon: <Rows2 className="w-4 h-4 text-blue-400" />, content: <AppearanceDensitySettings /> },
    { id: 'timezone', label: s.timezone, icon: <Globe className="w-4 h-4 text-cyan-400" />, content: <AppearanceTimezoneSettings /> },
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

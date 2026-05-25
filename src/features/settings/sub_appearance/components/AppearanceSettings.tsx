import { Palette } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';
import AppearanceTextSizeSettings from './AppearanceTextSizeSettings';
import AppearanceDensitySettings from './AppearanceDensitySettings';
import AppearanceTimezoneSettings from './AppearanceTimezoneSettings';
import AppearanceBrightnessSettings from './AppearanceBrightnessSettings';
import AppearanceThemingSection from './AppearanceThemingSection';

/**
 * Appearance settings — thin orchestrator. Each section is a self-contained
 * component that subscribes to only the themeStore slices it needs (kept
 * under ~200 LOC each per the section split).
 */
export default function AppearanceSettings() {
  const { t } = useTranslation();
  const s = t.settings.appearance;

  return (
    <ContentBox data-testid="settings-appearance-panel">
      <ContentHeader
        icon={<Palette className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={s.title}
        subtitle={s.subtitle}
      />

      <ContentBody centered>
        <div className="space-y-6">
          <AppearanceTextSizeSettings />
          <AppearanceDensitySettings />
          <AppearanceTimezoneSettings />
          <AppearanceBrightnessSettings />
          <AppearanceThemingSection />
        </div>
      </ContentBody>
    </ContentBox>
  );
}

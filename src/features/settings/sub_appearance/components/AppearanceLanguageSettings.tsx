import { LanguageCardGrid } from '@/features/home/sub_welcome/LanguageSwitcher';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Language selector in Settings → Appearance (UAT P10 — F-SETTINGS-NO-LANGUAGE).
 * The language picker previously lived only on Home + onboarding, so users who
 * looked for it where every other preference lives — Settings → Appearance —
 * couldn't find it. This mounts the same `LanguageCardGrid` here; it drives the
 * shared `useI18nStore`, so the choice is identical wherever it's changed.
 */
export default function AppearanceLanguageSettings() {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <p className="typo-body text-foreground">{t.settings.appearance.language_hint}</p>
      <LanguageCardGrid />
    </div>
  );
}

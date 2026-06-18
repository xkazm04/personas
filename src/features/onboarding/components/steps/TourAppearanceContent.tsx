import { Sun, Type } from 'lucide-react';
import { useThemeStore, THEMES, DARK_BRIGHTNESS_LEVELS, LIGHT_BRIGHTNESS_LEVELS, useIsDarkTheme } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';
import {
  TextScalePicker,
  BrightnessPicker,
  SimpleThemePicker,
} from '@/features/settings/components/AppearancePickers';

export default function TourAppearanceContent() {
  const { t } = useTranslation();
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const textScale = useThemeStore((s) => s.textScale);
  const setTextScale = useThemeStore((s) => s.setTextScale);
  const brightness = useThemeStore((s) => s.brightness);
  const setBrightness = useThemeStore((s) => s.setBrightness);
  const isDark = useIsDarkTheme();
  const brightnessLevels = isDark ? DARK_BRIGHTNESS_LEVELS : LIGHT_BRIGHTNESS_LEVELS;

  const darkThemes = THEMES.filter((t) => !t.isLight);
  const lightThemes = THEMES.filter((t) => t.isLight);

  return (
    <div className="space-y-4" data-testid="tour-appearance-root">
      {/* Text size */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Type className="w-3.5 h-3.5 text-foreground" />
          <span className="typo-body font-medium text-foreground">{t.onboarding.text_size_label}</span>
        </div>
        <TextScalePicker
          textScale={textScale}
          setTextScale={setTextScale}
          density="compact"
          testIdPrefix="tour-appearance"
        />
      </div>

      {/* Brightness */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Sun className="w-3.5 h-3.5 text-foreground" />
          <span className="typo-body font-medium text-foreground">{t.onboarding.brightness_label}</span>
        </div>
        <BrightnessPicker
          levels={brightnessLevels}
          brightness={brightness}
          setBrightness={setBrightness}
          density="compact"
          testIdPrefix="tour-appearance"
          showDescription={false}
        />
      </div>

      {/* Dark themes */}
      <div className="space-y-1.5">
        <span className="text-[11px] text-foreground uppercase tracking-wider">{t.onboarding.dark_themes}</span>
        <SimpleThemePicker
          themes={darkThemes}
          themeId={themeId}
          setTheme={setTheme}
          density="compact"
          testIdPrefix="tour-appearance"
        />
      </div>

      {/* Light themes */}
      <div className="space-y-1.5">
        <span className="text-[11px] text-foreground uppercase tracking-wider">{t.onboarding.light_themes}</span>
        <SimpleThemePicker
          themes={lightThemes}
          themeId={themeId}
          setTheme={setTheme}
          density="compact"
          testIdPrefix="tour-appearance"
        />
      </div>
    </div>
  );
}

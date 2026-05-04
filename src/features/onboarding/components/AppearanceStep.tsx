import { Check, Type, Languages } from 'lucide-react';
import { useThemeStore, THEMES, DARK_BRIGHTNESS_LEVELS, LIGHT_BRIGHTNESS_LEVELS, useIsDarkTheme } from '@/stores/themeStore';
import { useI18nStore, type Language } from '@/stores/i18nStore';
import { useTranslation } from '@/i18n/useTranslation';
import {
  TextScalePicker,
  BrightnessPicker,
  SimpleThemePicker,
} from '@/features/shared/components/picker/AppearancePickers';

const ONBOARDING_LANGUAGES: { code: Language; label: string; flag: string }[] = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'cs', label: 'Čeština', flag: '🇨🇿' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
  { code: 'hi', label: 'हिन्दी', flag: '🇮🇳' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
];

export function AppearanceStep() {
  const { t } = useTranslation();
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const textScale = useThemeStore((s) => s.textScale);
  const setTextScale = useThemeStore((s) => s.setTextScale);
  const brightness = useThemeStore((s) => s.brightness);
  const setBrightness = useThemeStore((s) => s.setBrightness);
  const isDark = useIsDarkTheme();
  const brightnessLevels = isDark ? DARK_BRIGHTNESS_LEVELS : LIGHT_BRIGHTNESS_LEVELS;
  const { language, setLanguage } = useI18nStore();

  const darkThemes = THEMES.filter((t) => !t.isLight);
  const lightThemes = THEMES.filter((t) => t.isLight);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="typo-heading text-foreground/90 mb-1">{t.onboarding.appearance_heading}</h3>
        <p className="typo-body text-foreground">
          {t.onboarding.appearance_description}
        </p>
      </div>

      {/* Language */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Languages className="w-4 h-4 text-foreground" />
          <span className="typo-body font-medium text-foreground">{t.onboarding.language_label}</span>
        </div>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))' }}>
          {ONBOARDING_LANGUAGES.map((lang) => {
            const isActive = language === lang.code;
            return (
              <button
                key={lang.code}
                onClick={() => setLanguage(lang.code)}
                className={`flex items-center gap-2 px-3 py-2 rounded-modal border transition-colors typo-body ${
                  isActive
                    ? 'border-primary/30 bg-primary/5 text-foreground/90 font-medium'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5 text-foreground'
                }`}
              >
                <span>{lang.flag}</span>
                <span className="truncate">{lang.label}</span>
                {isActive && <Check className="w-3 h-3 text-primary ml-auto shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Text size */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Type className="w-4 h-4 text-foreground" />
          <span className="typo-body font-medium text-foreground">{t.onboarding.text_size_label}</span>
        </div>
        <TextScalePicker textScale={textScale} setTextScale={setTextScale} />
      </div>

      {/* Dark themes */}
      <div className="space-y-2">
        <span className="typo-body text-foreground">{t.onboarding.dark_label}</span>
        <SimpleThemePicker themes={darkThemes} themeId={themeId} setTheme={setTheme} />
      </div>

      {/* Light themes */}
      <div className="space-y-2">
        <span className="typo-body text-foreground">{t.onboarding.light_label}</span>
        <SimpleThemePicker themes={lightThemes} themeId={themeId} setTheme={setTheme} />
      </div>

      {/* Brightness */}
      <div className="space-y-2">
        <span className="typo-body text-foreground">{t.onboarding.brightness_label}</span>
        <p className="typo-body text-foreground">{t.onboarding.brightness_hint}</p>
        <BrightnessPicker
          levels={brightnessLevels}
          brightness={brightness}
          setBrightness={setBrightness}
        />
      </div>
    </div>
  );
}

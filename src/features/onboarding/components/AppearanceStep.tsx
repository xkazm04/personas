import { Check, Sun, Type, Languages } from 'lucide-react';
import { useThemeStore, THEMES, TEXT_SCALES, DARK_BRIGHTNESS_LEVELS, LIGHT_BRIGHTNESS_LEVELS, useIsDarkTheme } from '@/stores/themeStore';
import type { ThemeId, TextScale, BrightnessLevel } from '@/stores/themeStore';
import { useI18nStore, type Language } from '@/stores/i18nStore';
import { useTranslation } from '@/i18n/useTranslation';

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
        <div className="grid grid-cols-3 gap-2">
          {TEXT_SCALES.map((scale) => {
            const isActive = textScale === scale.id;
            const sizeClass = scale.id === 'large' ? 'typo-body-lg' : scale.id === 'larger' ? 'typo-heading-lg' : 'typo-heading-lg';
            return (
              <button
                key={scale.id}
                onClick={() => setTextScale(scale.id as TextScale)}
                className={`relative flex flex-col items-center gap-1.5 p-3 rounded-modal border transition-colors ${
                  isActive
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                }`}
              >
                <span className={`font-semibold ${sizeClass} ${isActive ? 'text-foreground/90' : 'text-foreground'}`}>Aa</span>
                <span className={`typo-body ${isActive ? 'text-foreground font-medium' : 'text-foreground'}`}>{scale.label}</span>
                {isActive && <div className="absolute top-1.5 right-1.5"><Check className="w-3 h-3 text-primary" /></div>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Dark themes */}
      <div className="space-y-2">
        <span className="typo-body text-foreground">{t.onboarding.dark_label}</span>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))' }}>
          {darkThemes.map((t) => {
            const isActive = themeId === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id as ThemeId)}
                className={`flex flex-col items-center gap-1.5 p-2.5 rounded-modal border transition-colors ${
                  isActive
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                }`}
              >
                <div
                  className="w-7 h-7 rounded-full border border-black/10 flex items-center justify-center"
                  style={{ backgroundColor: t.primaryColor }}
                >
                  {isActive && <Check className="w-3 h-3 text-white drop-shadow-elevation-1" />}
                </div>
                <span className={`typo-body ${isActive ? 'text-foreground/90 font-medium' : 'text-foreground'}`}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Light themes */}
      <div className="space-y-2">
        <span className="typo-body text-foreground">{t.onboarding.light_label}</span>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))' }}>
          {lightThemes.map((t) => {
            const isActive = themeId === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id as ThemeId)}
                className={`flex flex-col items-center gap-1.5 p-2.5 rounded-modal border transition-colors ${
                  isActive
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                }`}
              >
                <div
                  className="w-7 h-7 rounded-full border border-black/10 flex items-center justify-center"
                  style={{ backgroundColor: t.primaryColor }}
                >
                  {isActive && <Check className="w-3 h-3 text-white drop-shadow-elevation-1" />}
                </div>
                <span className={`typo-body ${isActive ? 'text-foreground/90 font-medium' : 'text-foreground'}`}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Brightness */}
      <div className="space-y-2">
        <span className="typo-body text-foreground">{t.onboarding.brightness_label}</span>
        <p className="typo-body text-foreground">
          {t.onboarding.brightness_hint}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {brightnessLevels.map((level, i) => {
            const isActive = brightness === level.id;
            const iconOpacity = i === 0 ? 'opacity-40' : i === 1 ? 'opacity-70' : 'opacity-100';
            return (
              <button
                key={level.id}
                onClick={() => setBrightness(level.id as BrightnessLevel)}
                className={`relative flex flex-col items-center gap-1.5 p-3 rounded-modal border transition-colors ${
                  isActive
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                }`}
              >
                <Sun className={`w-4 h-4 ${iconOpacity} ${isActive ? 'text-amber-400' : 'text-foreground'}`} />
                <span className={`typo-caption ${isActive ? 'text-foreground/90 font-medium' : 'text-foreground'}`}>
                  {level.label}
                </span>
                <span className="typo-body text-foreground">{level.description}</span>
                {isActive && (
                  <div className="absolute top-1.5 right-1.5">
                    <Check className="w-3 h-3 text-primary" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

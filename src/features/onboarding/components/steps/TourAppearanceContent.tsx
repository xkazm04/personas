import { Check, Sun, Type } from 'lucide-react';
import { useThemeStore, THEMES, TEXT_SCALES, DARK_BRIGHTNESS_LEVELS, LIGHT_BRIGHTNESS_LEVELS, useIsDarkTheme } from '@/stores/themeStore';
import type { ThemeId, TextScale, BrightnessLevel } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';

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
          <span className="text-sm font-medium text-foreground">{t.onboarding.text_size_label}</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {TEXT_SCALES.map((scale) => {
            const isActive = textScale === scale.id;
            const sizeClass = scale.id === 'large' ? 'text-base' : scale.id === 'larger' ? 'text-lg' : 'text-xl';
            return (
              <button
                key={scale.id}
                onClick={() => setTextScale(scale.id as TextScale)}
                data-testid={`tour-appearance-textscale-${scale.id}`}
                className={`relative flex flex-col items-center gap-1 p-2 rounded-modal border transition-colors ${
                  isActive
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                }`}
              >
                <span className={`font-semibold ${sizeClass} ${isActive ? 'text-foreground/90' : 'text-foreground'}`}>Aa</span>
                <span className={`text-[11px] ${isActive ? 'text-foreground font-medium' : 'text-foreground'}`}>{scale.label}</span>
                {isActive && <div className="absolute top-1 right-1"><Check className="w-2.5 h-2.5 text-primary" /></div>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Brightness */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Sun className="w-3.5 h-3.5 text-foreground" />
          <span className="text-sm font-medium text-foreground">{t.onboarding.brightness_label}</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {brightnessLevels.map((level, i) => {
            const isActive = brightness === level.id;
            const iconOpacity = i === 0 ? 'opacity-40' : i === 1 ? 'opacity-70' : 'opacity-100';
            return (
              <button
                key={level.id}
                onClick={() => setBrightness(level.id as BrightnessLevel)}
                data-testid={`tour-appearance-brightness-${level.id}`}
                className={`relative flex flex-col items-center gap-1 p-2 rounded-modal border transition-colors ${
                  isActive
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                }`}
              >
                <Sun className={`w-3.5 h-3.5 ${iconOpacity} ${isActive ? 'text-amber-400' : 'text-foreground'}`} />
                <span className={`text-[11px] ${isActive ? 'text-foreground/90 font-medium' : 'text-foreground'}`}>
                  {level.label}
                </span>
                {isActive && <div className="absolute top-1 right-1"><Check className="w-2.5 h-2.5 text-primary" /></div>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Dark themes */}
      <div className="space-y-1.5">
        <span className="text-[11px] text-foreground uppercase tracking-wider">{t.onboarding.dark_themes}</span>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))' }}>
          {darkThemes.map((t) => {
            const isActive = themeId === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id as ThemeId)}
                data-testid={`tour-appearance-theme-${t.id}`}
                className={`flex flex-col items-center gap-1 p-2 rounded-modal border transition-colors ${
                  isActive
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                }`}
              >
                <div
                  className="w-6 h-6 rounded-full border border-black/10 flex items-center justify-center"
                  style={{ backgroundColor: t.primaryColor }}
                >
                  {isActive && <Check className="w-2.5 h-2.5 text-white drop-shadow-elevation-1" />}
                </div>
                <span className={`text-[11px] ${isActive ? 'text-foreground/90 font-medium' : 'text-foreground'}`}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Light themes */}
      <div className="space-y-1.5">
        <span className="text-[11px] text-foreground uppercase tracking-wider">{t.onboarding.light_themes}</span>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))' }}>
          {lightThemes.map((t) => {
            const isActive = themeId === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id as ThemeId)}
                data-testid={`tour-appearance-theme-${t.id}`}
                className={`flex flex-col items-center gap-1 p-2 rounded-modal border transition-colors ${
                  isActive
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                }`}
              >
                <div
                  className="w-6 h-6 rounded-full border border-black/10 flex items-center justify-center"
                  style={{ backgroundColor: t.primaryColor }}
                >
                  {isActive && <Check className="w-2.5 h-2.5 text-white drop-shadow-elevation-1" />}
                </div>
                <span className={`text-[11px] ${isActive ? 'text-foreground/90 font-medium' : 'text-foreground'}`}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

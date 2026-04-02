import { Check, Sun } from 'lucide-react';
import { useThemeStore, THEMES, DARK_BRIGHTNESS_LEVELS, LIGHT_BRIGHTNESS_LEVELS, useIsDarkTheme } from '@/stores/themeStore';
import type { ThemeId, BrightnessLevel } from '@/stores/themeStore';

export function AppearanceStep() {
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const brightness = useThemeStore((s) => s.brightness);
  const setBrightness = useThemeStore((s) => s.setBrightness);
  const isDark = useIsDarkTheme();
  const brightnessLevels = isDark ? DARK_BRIGHTNESS_LEVELS : LIGHT_BRIGHTNESS_LEVELS;

  const darkThemes = THEMES.filter((t) => !t.isLight);
  const lightThemes = THEMES.filter((t) => t.isLight);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="typo-heading text-foreground/90 mb-1">Choose your theme</h3>
        <p className="typo-body text-muted-foreground/60">
          Pick a color scheme that feels comfortable on your screen. You can change this anytime in Settings.
        </p>
      </div>

      {/* Dark themes */}
      <div className="space-y-2">
        <span className="typo-caption text-muted-foreground/50">Dark</span>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))' }}>
          {darkThemes.map((t) => {
            const isActive = themeId === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id as ThemeId)}
                className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-colors ${
                  isActive
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                }`}
              >
                <div
                  className="w-7 h-7 rounded-full border border-black/10 flex items-center justify-center"
                  style={{ backgroundColor: t.primaryColor }}
                >
                  {isActive && <Check className="w-3 h-3 text-white drop-shadow-sm" />}
                </div>
                <span className={`text-[11px] ${isActive ? 'text-foreground/90 font-medium' : 'text-muted-foreground/60'}`}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Light themes */}
      <div className="space-y-2">
        <span className="typo-caption text-muted-foreground/50">Light</span>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))' }}>
          {lightThemes.map((t) => {
            const isActive = themeId === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id as ThemeId)}
                className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-colors ${
                  isActive
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                }`}
              >
                <div
                  className="w-7 h-7 rounded-full border border-black/10 flex items-center justify-center"
                  style={{ backgroundColor: t.primaryColor }}
                >
                  {isActive && <Check className="w-3 h-3 text-white drop-shadow-sm" />}
                </div>
                <span className={`text-[11px] ${isActive ? 'text-foreground/90 font-medium' : 'text-muted-foreground/60'}`}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Brightness */}
      <div className="space-y-2">
        <span className="typo-caption text-muted-foreground/50">Brightness</span>
        <p className="text-xs text-muted-foreground/50">
          If the app feels too dark on your monitor, increase brightness.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {brightnessLevels.map((level, i) => {
            const isActive = brightness === level.id;
            const iconOpacity = i === 0 ? 'opacity-40' : i === 1 ? 'opacity-70' : 'opacity-100';
            return (
              <button
                key={level.id}
                onClick={() => setBrightness(level.id as BrightnessLevel)}
                className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-colors ${
                  isActive
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                }`}
              >
                <Sun className={`w-4 h-4 ${iconOpacity} ${isActive ? 'text-amber-400' : 'text-muted-foreground/70'}`} />
                <span className={`text-xs ${isActive ? 'text-foreground/90 font-medium' : 'text-muted-foreground/70'}`}>
                  {level.label}
                </span>
                <span className="text-[10px] text-muted-foreground/50">{level.description}</span>
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

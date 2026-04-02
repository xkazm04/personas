import { useState, useRef, useCallback } from 'react';
import { Check, Globe, Palette, Sun, Type } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { useThemeStore, THEMES, TEXT_SCALES, DARK_BRIGHTNESS_LEVELS, LIGHT_BRIGHTNESS_LEVELS, customThemeDef, useIsDarkTheme } from '@/stores/themeStore';
import type { ThemeId, ThemeDefinition, TextScale, TimezoneMode, BrightnessLevel } from '@/stores/themeStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import CustomThemeCreator from './CustomThemeCreator';
import TranslationContributor from './TranslationContributor';

function ThemePreviewTooltip({ theme }: { theme: ThemeDefinition }) {
  const { backgroundSample, foregroundSample, primaryColor, accentColor } = theme;
  const borderColor = theme.isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.12)';
  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 animate-expand-in pointer-events-none" style={{ zIndex: 99999 }}>
      <div
        className="w-[140px] rounded-lg overflow-hidden flex flex-col"
        style={{ backgroundColor: backgroundSample, border: `1px solid ${borderColor}`, boxShadow: '0 8px 30px rgba(0,0,0,0.25)' }}
      >
        {/* Mini UI preview */}
        <div className="h-[70px] flex flex-col justify-center px-3 gap-2">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: primaryColor }} />
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: accentColor }} />
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: foregroundSample, opacity: 0.2 }} />
          </div>
          <div className="flex gap-1">
            <div className="h-1 flex-1 rounded-full" style={{ backgroundColor: foregroundSample, opacity: 0.12 }} />
            <div className="h-1 w-5 rounded-full" style={{ backgroundColor: primaryColor, opacity: 0.5 }} />
          </div>
          <div className="flex gap-1">
            <div className="h-1 w-8 rounded-full" style={{ backgroundColor: foregroundSample, opacity: 0.08 }} />
            <div className="h-1 flex-1 rounded-full" style={{ backgroundColor: foregroundSample, opacity: 0.08 }} />
          </div>
        </div>
        {/* Label -- rendered ON the theme's own background for proper contrast */}
        <div
          className="text-[10px] text-center py-1.5 font-semibold tracking-wide"
          style={{ color: foregroundSample, borderTop: `1px solid ${borderColor}` }}
        >
          {theme.label}
        </div>
      </div>
    </div>
  );
}

function ThemeSwatch({ theme, active, onSelect }: { theme: ThemeDefinition; active: boolean; onSelect: () => void }) {
  const [showPreview, setShowPreview] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setShowPreview(true);
  }, []);

  const handleLeave = useCallback(() => {
    leaveTimer.current = setTimeout(() => setShowPreview(false), 300);
  }, []);

  return (
    <Button
      variant="ghost"
      onClick={onSelect}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className={`group relative flex flex-col items-center gap-2 p-3 rounded-xl border ${
        active
          ? 'border-primary/30 bg-primary/5'
          : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
      }`}
    >
      {showPreview && !active && <ThemePreviewTooltip theme={theme} />}
      <div
        className="w-10 h-10 rounded-full border-2 border-black/10 flex items-center justify-center"
        style={{ backgroundColor: theme.primaryColor }}
      >
        {active && <Check className="w-4 h-4 text-white drop-shadow-sm" />}
      </div>
      <span className={`text-sm ${active ? 'text-foreground/90 font-medium' : 'text-muted-foreground/80'}`}>
        {theme.label}
      </span>
    </Button>
  );
}

const TIMEZONE_OPTIONS: Array<{ value: string; label: string; description: string }> = [
  { value: 'local', label: 'Local', description: 'Browser timezone' },
  { value: 'utc', label: 'UTC', description: 'Coordinated Universal Time' },
  { value: 'America/New_York', label: 'US Eastern', description: 'ET (UTC-5/-4)' },
  { value: 'America/Chicago', label: 'US Central', description: 'CT (UTC-6/-5)' },
  { value: 'America/Los_Angeles', label: 'US Pacific', description: 'PT (UTC-8/-7)' },
  { value: 'Europe/London', label: 'London', description: 'GMT/BST (UTC+0/+1)' },
  { value: 'Europe/Prague', label: 'Prague', description: 'CET (UTC+1/+2)' },
  { value: 'Asia/Tokyo', label: 'Tokyo', description: 'JST (UTC+9)' },
];

export default function AppearanceSettings() {
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const textScale = useThemeStore((s) => s.textScale);
  const setTextScale = useThemeStore((s) => s.setTextScale);
  const timezone = useThemeStore((s) => s.timezone);
  const setTimezone = useThemeStore((s) => s.setTimezone);

  const brightness = useThemeStore((s) => s.brightness);
  const setBrightness = useThemeStore((s) => s.setBrightness);
  const isDark = useIsDarkTheme();
  const brightnessLevels = isDark ? DARK_BRIGHTNESS_LEVELS : LIGHT_BRIGHTNESS_LEVELS;
  const customTheme = useThemeStore((s) => s.customTheme);

  const customDef = customTheme ? customThemeDef(customTheme) : null;
  const darkThemes = THEMES.filter((t) => !t.isLight);
  const lightThemes = THEMES.filter((t) => t.isLight);
  // Append custom theme swatch to the appropriate group
  const darkWithCustom = customDef && !customDef.isLight ? [...darkThemes, customDef] : darkThemes;
  const lightWithCustom = customDef && customDef.isLight ? [...lightThemes, customDef] : lightThemes;

  return (
    <ContentBox>
      <ContentHeader
        icon={<Palette className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Appearance"
        subtitle="Customize how the app looks"
      />

      <ContentBody centered>
        <div className="space-y-6">
          {/* Dark themes */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <SectionHeading title="Dark" />
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
              {darkWithCustom.map((t) => (
                <ThemeSwatch
                  key={t.id}
                  theme={t}
                  active={themeId === t.id}
                  onSelect={() => setTheme(t.id as ThemeId)}
                />
              ))}
            </div>
          </div>

          {/* Light themes */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <SectionHeading title="Light" />
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
              {lightWithCustom.map((t) => (
                <ThemeSwatch
                  key={t.id}
                  theme={t}
                  active={themeId === t.id}
                  onSelect={() => setTheme(t.id as ThemeId)}
                />
              ))}
            </div>
          </div>

          {/* Custom theme creator */}
          <CustomThemeCreator />

          {/* Brightness */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <SectionHeading title="Brightness" icon={<Sun />} />
            <p className="text-xs text-muted-foreground/60">
              Adjust screen brightness if the app feels too dark on your display.
            </p>
            <div className="grid grid-cols-3 gap-3">
              {brightnessLevels.map((level, i) => {
                const isActive = brightness === level.id;
                const iconOpacity = i === 0 ? 'opacity-40' : i === 1 ? 'opacity-70' : 'opacity-100';
                return (
                  <Button
                    variant="ghost"
                    key={level.id}
                    onClick={() => setBrightness(level.id as BrightnessLevel)}
                    className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border ${
                      isActive
                        ? 'border-primary/30 bg-primary/5'
                        : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                    }`}
                  >
                    <Sun className={`w-5 h-5 ${iconOpacity} ${isActive ? 'text-amber-400' : 'text-muted-foreground/70'}`} />
                    <span className={`text-sm ${isActive ? 'text-foreground/90 font-medium' : 'text-muted-foreground/70'}`}>
                      {level.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground/50">
                      {level.description}
                    </span>
                    {isActive && (
                      <div className="absolute top-2 right-2">
                        <Check className="w-3.5 h-3.5 text-primary" />
                      </div>
                    )}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Text sizing */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <SectionHeading title="Text Size" icon={<Type />} />
            <div className="grid grid-cols-2 2xl:grid-cols-4 gap-3">
              {TEXT_SCALES.map((scale) => {
                const isActive = textScale === scale.id;
                const sizeClass =
                  scale.id === 'compact' ? 'text-xs' :
                  scale.id === 'default' ? 'text-sm' :
                  scale.id === 'large' ? 'text-base' : 'text-lg';
                return (
                  <Button
                    variant="ghost"
                    key={scale.id}
                    onClick={() => setTextScale(scale.id as TextScale)}
                    className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border ${
                      isActive
                        ? 'border-primary/30 bg-primary/5'
                        : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                    }`}
                  >
                    <span
                      className={`font-semibold ${sizeClass} ${isActive ? 'text-foreground/90' : 'text-muted-foreground/70'}`}
                    >
                      Aa
                    </span>
                    <span className={`text-xs ${isActive ? 'text-foreground/80 font-medium' : 'text-muted-foreground/60'}`}>
                      {scale.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground/50">
                      {scale.description}
                    </span>
                    {isActive && (
                      <div className="absolute top-2 right-2">
                        <Check className="w-3.5 h-3.5 text-primary" />
                      </div>
                    )}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Timezone */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <SectionHeading title="Timezone" icon={<Globe />} />
            <p className="text-xs text-muted-foreground/60">
              Controls how schedule times and cron expressions are displayed throughout the app.
            </p>
            <div className="grid grid-cols-2 2xl:grid-cols-3 gap-3">
              {TIMEZONE_OPTIONS.map((tz) => {
                const isActive = timezone === tz.value;
                return (
                  <Button
                    variant="ghost"
                    key={tz.value}
                    onClick={() => setTimezone(tz.value as TimezoneMode)}
                    className={`relative flex flex-col items-center gap-1.5 p-4 rounded-xl border ${
                      isActive
                        ? 'border-primary/30 bg-primary/5'
                        : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                    }`}
                  >
                    <span className={`text-sm font-medium ${isActive ? 'text-foreground/90' : 'text-muted-foreground/70'}`}>
                      {tz.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground/50">
                      {tz.description}
                    </span>
                    {isActive && (
                      <div className="absolute top-2 right-2">
                        <Check className="w-3.5 h-3.5 text-primary" />
                      </div>
                    )}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Language & Translation Contributions */}
          <TranslationContributor />
        </div>
      </ContentBody>
    </ContentBox>
  );
}

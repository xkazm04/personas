import { useState, useRef, useCallback, memo, useMemo } from 'react';
import { Check, Globe, Palette, Sun, Type } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { useThemeStore, THEMES, TEXT_SCALES, DARK_BRIGHTNESS_LEVELS, LIGHT_BRIGHTNESS_LEVELS, BRIGHTNESS_ICON_OPACITY_BY_INDEX, customThemeDef, useIsDarkTheme } from '@/stores/themeStore';
import type { ThemeId, ThemeDefinition, TextScale, TimezoneMode, BrightnessLevel } from '@/stores/themeStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import CustomThemeCreator from './CustomThemeCreator';
import TranslationContributor from './TranslationContributor';
import PseudoLocaleToggle from './PseudoLocaleToggle';

const ThemePreviewTooltip = memo(function ThemePreviewTooltip({ theme }: { theme: ThemeDefinition }) {
  const { backgroundSample, foregroundSample, primaryColor, accentColor } = theme;
  const borderColor = theme.isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.12)';
  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 animate-expand-in pointer-events-none" style={{ zIndex: 99999 }}>
      <div
        className="w-[140px] rounded-card overflow-hidden flex flex-col"
        style={{ backgroundColor: backgroundSample, border: `1px solid ${borderColor}`, boxShadow: '0 8px 30px rgba(0,0,0,0.25)' }}
      >
        {/* Mini UI preview */}
        <div className="h-[70px] flex flex-col justify-center px-3 gap-2">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: primaryColor }} />
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: accentColor }} />
            <div className="w-3 h-3 rounded-interactive" style={{ backgroundColor: foregroundSample, opacity: 0.2 }} />
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
});

const ThemeSwatch = memo(function ThemeSwatch({ theme, active, onSelect }: { theme: ThemeDefinition; active: boolean; onSelect: () => void }) {
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
      className={`group relative flex flex-col items-center gap-2 p-3 rounded-modal border ${
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
        {active && <Check className="w-4 h-4 text-white drop-shadow-elevation-1" />}
      </div>
      <span className={`text-sm ${active ? 'text-foreground/90 font-medium' : 'text-foreground'}`}>
        {theme.label}
      </span>
    </Button>
  );
});

// IANA timezone values are technical identifiers (passed verbatim to date
// formatters); only the display label and description translate. Keys live
// under t.settings.appearance.tz_{label,description}_*.
type TimezoneLabelKey =
  | 'tz_label_local' | 'tz_label_utc' | 'tz_label_us_eastern'
  | 'tz_label_us_central' | 'tz_label_us_pacific' | 'tz_label_london'
  | 'tz_label_prague' | 'tz_label_tokyo';
type TimezoneDescriptionKey =
  | 'tz_description_local' | 'tz_description_utc' | 'tz_description_us_eastern'
  | 'tz_description_us_central' | 'tz_description_us_pacific' | 'tz_description_london'
  | 'tz_description_prague' | 'tz_description_tokyo';

const TIMEZONE_OPTIONS: Array<{ value: string; labelKey: TimezoneLabelKey; descriptionKey: TimezoneDescriptionKey }> = [
  { value: 'local', labelKey: 'tz_label_local', descriptionKey: 'tz_description_local' },
  { value: 'utc', labelKey: 'tz_label_utc', descriptionKey: 'tz_description_utc' },
  { value: 'America/New_York', labelKey: 'tz_label_us_eastern', descriptionKey: 'tz_description_us_eastern' },
  { value: 'America/Chicago', labelKey: 'tz_label_us_central', descriptionKey: 'tz_description_us_central' },
  { value: 'America/Los_Angeles', labelKey: 'tz_label_us_pacific', descriptionKey: 'tz_description_us_pacific' },
  { value: 'Europe/London', labelKey: 'tz_label_london', descriptionKey: 'tz_description_london' },
  { value: 'Europe/Prague', labelKey: 'tz_label_prague', descriptionKey: 'tz_description_prague' },
  { value: 'Asia/Tokyo', labelKey: 'tz_label_tokyo', descriptionKey: 'tz_description_tokyo' },
];

type AppearanceLabels = ReturnType<typeof useTranslation>['t']['settings']['appearance'];

function ThemingSection({ themeId, setTheme, darkThemes, lightThemes, labels }: {
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;
  darkThemes: ThemeDefinition[];
  lightThemes: ThemeDefinition[];
  labels: Pick<AppearanceLabels, 'theming' | 'default_tab' | 'custom_tab' | 'dark' | 'light'>;
}) {
  const [themeTab, setThemeTab] = useState<'default' | 'custom'>('default');
  return (
    <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeading title={labels.theming} icon={<Palette />} />
        <SegmentedTabs<'default' | 'custom'>
          variant="segment"
          ariaLabel={labels.theming}
          activeTab={themeTab}
          onTabChange={setThemeTab}
          tabs={[
            { id: 'default', label: labels.default_tab },
            { id: 'custom', label: labels.custom_tab },
          ]}
        />
      </div>
      {themeTab === 'default' ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <span className="text-sm text-foreground">{labels.dark}</span>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
              {darkThemes.map((t) => (
                <ThemeSwatch key={t.id} theme={t} active={themeId === t.id} onSelect={() => setTheme(t.id as ThemeId)} />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <span className="text-sm text-foreground">{labels.light}</span>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
              {lightThemes.map((t) => (
                <ThemeSwatch key={t.id} theme={t} active={themeId === t.id} onSelect={() => setTheme(t.id as ThemeId)} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <CustomThemeCreator />
      )}
    </div>
  );
}

export default function AppearanceSettings() {
  const { t } = useTranslation();

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

  const s = t.settings.appearance;

  const customDef = useMemo(() => customTheme ? customThemeDef(customTheme) : null, [customTheme]);
  const { darkWithCustom, lightWithCustom } = useMemo(() => {
    const dark = THEMES.filter((t) => !t.isLight);
    const light = THEMES.filter((t) => t.isLight);
    return {
      darkWithCustom: customDef && !customDef.isLight ? [...dark, customDef] : dark,
      lightWithCustom: customDef && customDef.isLight ? [...light, customDef] : light,
    };
  }, [customDef]);

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
          {/* Text sizing */}
          <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-4">
            <SectionHeading title={s.text_size} icon={<Type />} />
            <div className="grid grid-cols-3 gap-3">
              {TEXT_SCALES.map((scale) => {
                const isActive = textScale === scale.id;
                const sizeClass =
                  scale.id === 'large' ? 'text-base' :
                  scale.id === 'larger' ? 'text-lg' : 'text-xl';
                return (
                  <Button
                    variant="ghost"
                    key={scale.id}
                    onClick={() => setTextScale(scale.id as TextScale)}
                    className={`relative flex flex-col items-center gap-2 p-4 rounded-modal border ${
                      isActive
                        ? 'border-primary/30 bg-primary/5'
                        : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                    }`}
                  >
                    <span
                      className={`font-semibold ${sizeClass} ${isActive ? 'text-foreground/90' : 'text-foreground'}`}
                    >
                      Aa
                    </span>
                    <span className={`text-xs ${isActive ? 'text-foreground font-medium' : 'text-foreground'}`}>
                      {scale.label}
                    </span>
                    <span className="text-[11px] text-foreground">
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
          <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-4">
            <SectionHeading title={s.timezone} icon={<Globe />} />
            <p className="text-xs text-foreground">
              {s.timezone_hint}
            </p>
            <div className="grid grid-cols-2 2xl:grid-cols-3 gap-3">
              {TIMEZONE_OPTIONS.map((tz) => {
                const isActive = timezone === tz.value;
                return (
                  <Button
                    variant="ghost"
                    key={tz.value}
                    onClick={() => setTimezone(tz.value as TimezoneMode)}
                    className={`relative flex flex-col items-center gap-1.5 p-4 rounded-modal border ${
                      isActive
                        ? 'border-primary/30 bg-primary/5'
                        : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                    }`}
                  >
                    <span className={`text-sm font-medium ${isActive ? 'text-foreground/90' : 'text-foreground'}`}>
                      {s[tz.labelKey]}
                    </span>
                    <span className="text-[11px] text-foreground">
                      {s[tz.descriptionKey]}
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

          {/* Language & Translation Contributions — dev only */}
          {import.meta.env.DEV && (
            <div className="rounded-modal border-2 border-amber-500/50 ring-1 ring-amber-500/20">
              <TranslationContributor />
              <PseudoLocaleToggle />
            </div>
          )}

          {/* Brightness */}
          <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-4">
            <SectionHeading title={s.brightness} icon={<Sun />} />
            <p className="text-sm text-foreground">
              {s.brightness_hint}
            </p>
            <div className="grid grid-cols-3 gap-3">
              {brightnessLevels.map((level, i) => {
                const isActive = brightness === level.id;
                const iconOpacity = BRIGHTNESS_ICON_OPACITY_BY_INDEX[i] ?? 'opacity-100';
                return (
                  <Button
                    variant="ghost"
                    key={level.id}
                    onClick={() => setBrightness(level.id as BrightnessLevel)}
                    className={`relative flex flex-col items-center gap-2 p-4 rounded-modal border ${
                      isActive
                        ? 'border-primary/30 bg-primary/5'
                        : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                    }`}
                  >
                    <Sun className={`w-5 h-5 ${iconOpacity} ${isActive ? 'text-amber-400' : 'text-foreground'}`} />
                    <span className={`text-sm ${isActive ? 'text-foreground/90 font-medium' : 'text-foreground'}`}>
                      {level.label}
                    </span>
                    <span className="typo-body text-foreground">
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

          {/* Theming (moved to last) */}
          <ThemingSection
            themeId={themeId}
            setTheme={setTheme}
            darkThemes={darkWithCustom}
            lightThemes={lightWithCustom}
            labels={s}
          />
        </div>
      </ContentBody>
    </ContentBox>
  );
}

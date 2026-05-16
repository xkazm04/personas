import { useState, memo, useMemo } from 'react';
import { Check, Globe, Palette, Sun, Type } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { useThemeStore, THEMES, TEXT_SCALES, DARK_BRIGHTNESS_LEVELS, LIGHT_BRIGHTNESS_LEVELS, BRIGHTNESS_ICON_OPACITY_BY_INDEX, customThemeDef, useIsDarkTheme } from '@/stores/themeStore';
import type { ThemeId, ThemeDefinition, TextScale, TimezoneMode, BrightnessLevel } from '@/stores/themeStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { getContrastRatio, getContrastLevel } from '@/lib/theme/contrastRatio';
import CustomThemeCreator from './CustomThemeCreator';
import TranslationContributor from './TranslationContributor';
import PseudoLocaleToggle from './PseudoLocaleToggle';

/* Mini UI preview rendered inside the swatch.
   Wrapping it in [data-theme="<id>"] re-scopes every CSS variable to that
   theme's palette — so `bg-primary` / `bg-status-success` / `text-foreground`
   inside this subtree paint with the previewed theme, not the active one.
   Result: each tile is a live, real-token preview, not a static swatch. */
const ThemeSwatch = memo(function ThemeSwatch({ theme, active, onSelect }: { theme: ThemeDefinition; active: boolean; onSelect: () => void }) {
  const { tx, t } = useTranslation();
  const previewAriaLabel = tx(t.settings.appearance.theme_preview_aria, { name: theme.label });

  // WCAG contrast badge: computed from the theme's *advertised* fg/bg pair
  // (matches what users will see for body text on the canvas).
  const contrastRatio = useMemo(
    () => getContrastRatio(theme.foregroundSample, theme.backgroundSample),
    [theme.foregroundSample, theme.backgroundSample],
  );
  const contrastLevel = useMemo(
    () => getContrastLevel(theme.foregroundSample, theme.backgroundSample),
    [theme.foregroundSample, theme.backgroundSample],
  );
  const a = t.settings.appearance;
  const badgeLabel =
    contrastLevel === 'AAA' ? a.contrast_badge_aaa
    : contrastLevel === 'AA' ? a.contrast_badge_aa
    : a.contrast_badge_low;
  const badgeAriaLabel = tx(a.contrast_badge_aria, { level: badgeLabel, ratio: contrastRatio.toFixed(1) });
  const badgeClass =
    contrastLevel === 'AAA' ? 'bg-status-success/20 text-status-success'
    : contrastLevel === 'AA' ? 'bg-status-info/20 text-status-info'
    : 'bg-status-warning/25 text-status-warning';

  // Midnight has no [data-theme=...] rule — it lives at :root. Setting the
  // attribute to its id on the wrapper inherits root vars unchanged, so we
  // can scope every tile uniformly without special-casing.
  return (
    <Button
      variant="ghost"
      onClick={onSelect}
      className={`group relative flex flex-col p-0 rounded-modal border overflow-hidden ${
        active
          ? 'border-primary/40 ring-2 ring-primary/20'
          : 'border-primary/10 hover:border-primary/30'
      }`}
    >
      <div
        data-theme={theme.id}
        aria-label={previewAriaLabel}
        className="relative w-full bg-background text-foreground flex flex-col gap-2 px-3 py-3 pointer-events-none"
        style={{ minHeight: '110px' }}
      >
        {/* Contrast badge — anchored top-right inside the data-theme'd region
            so its semantic colors also reflect the previewed theme's palette */}
        <span
          aria-label={badgeAriaLabel}
          title={badgeAriaLabel}
          className={`absolute top-2 right-2 px-1.5 py-0.5 rounded-pill text-[9px] font-semibold tracking-wide ${badgeClass}`}
        >
          {badgeLabel}
        </span>

        {/* Top row: primary disc with active check + accent + neutral chip */}
        <div className="flex items-center justify-between pr-12">
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shadow-elevation-1">
            {active && <Check className="w-3.5 h-3.5 text-btn-primary-fg" />}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent" />
            <span className="w-2 h-2 rounded-full bg-brand-purple" />
            <span className="w-2 h-2 rounded-full bg-brand-emerald" />
          </div>
        </div>

        {/* Status dot row -- real semantic tokens, showing how the theme
            differentiates success/warning/error/info */}
        <div className="flex items-center gap-1 mt-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-status-success" />
          <span className="w-1.5 h-1.5 rounded-full bg-status-warning" />
          <span className="w-1.5 h-1.5 rounded-full bg-status-error" />
          <span className="w-1.5 h-1.5 rounded-full bg-status-info" />
          <span className="h-1 flex-1 rounded-full bg-foreground/10 ml-1" />
        </div>

        {/* Mini "card" -- shows how surfaces sit on the background */}
        <div className="rounded-card bg-card-bg border border-card-border px-2 py-1.5 flex items-center gap-2">
          <div className="h-1 flex-1 rounded-full bg-foreground/15" />
          <div className="h-1 w-4 rounded-full bg-primary/60" />
        </div>

        {/* Label rendered in the theme's foreground for true contrast preview */}
        <span className="text-sm font-medium text-foreground mt-auto">
          {theme.label}
        </span>
      </div>
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
  const dim = useThemeStore((s) => s.dim);
  const setDim = useThemeStore((s) => s.setDim);
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
            {/* Dim mode toggle — independent of brightness levels; reduces
                color saturation across the entire app for late-night use */}
            <div className="flex items-start justify-between gap-4 pt-3 mt-1 border-t border-primary/10">
              <div className="flex-1">
                <div className="text-sm text-foreground font-medium">{s.dim_mode_label}</div>
                <div className="typo-body text-foreground/80">{s.dim_mode_hint}</div>
              </div>
              <Button
                variant="ghost"
                onClick={() => setDim(!dim)}
                aria-pressed={dim}
                className={`shrink-0 px-4 py-2 rounded-interactive border min-w-[64px] ${
                  dim
                    ? 'border-primary/40 bg-primary/10 text-primary font-medium'
                    : 'border-primary/10 hover:border-primary/30 text-foreground'
                }`}
              >
                {dim ? s.dim_mode_on : s.dim_mode_off}
              </Button>
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

import { useState, useRef, useCallback, memo, useMemo, useId } from 'react';
import { Check } from 'lucide-react';
import type { ThemeDefinition, ThemeId } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';
import { getContrastRatio, getContrastLevel } from '@/lib/theme/contrastRatio';
import { AppearanceThemeHoverPreview } from './AppearanceThemeHoverPreview';

/* Mini UI preview rendered inside the swatch.
   Wrapping the hover preview in [data-theme="<id>"] re-scopes every CSS
   variable to that theme's palette. The tile itself paints with inline
   styles derived from the theme's palette (primaryColor / accentColor /
   backgroundSample / foregroundSample), sidestepping CSS-variable cascade
   timing so every tile visibly previews ITS OWN theme. */
export const AppearanceThemeSwatch = memo(function AppearanceThemeSwatch({
  theme, active, onSelect,
}: {
  theme: ThemeDefinition;
  active: boolean;
  /** A stable callback (the store's setTheme): an inline closure here would defeat memo(). */
  onSelect: (id: ThemeId) => void;
}) {
  const { tx, t } = useTranslation();
  const badgeId = useId();
  const previewAriaLabel = tx(t.settings.appearance.theme_preview_aria, { name: theme.label });

  const [showHover, setShowHover] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleEnter = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setShowHover(true);
  }, []);
  const handleLeave = useCallback(() => {
    leaveTimer.current = setTimeout(() => setShowHover(false), 180);
  }, []);

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
  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      {showHover && !active && <AppearanceThemeHoverPreview theme={theme} />}
      <button
        type="button"
        onClick={() => onSelect(theme.id)}
        onFocus={handleEnter}
        onBlur={handleLeave}
        aria-label={previewAriaLabel}
        aria-describedby={badgeId}
        aria-pressed={active}
        className={`group relative flex flex-col w-full p-0 overflow-hidden rounded-modal border transition-all ${
          active
            ? 'border-primary/40 ring-2 ring-primary/20'
            : 'border-primary/10 hover:border-primary/30'
        }`}
      >
        <div
          className="relative w-full flex flex-col gap-2.5 px-3 py-3 pointer-events-none"
          style={{ minHeight: '110px', backgroundColor: theme.backgroundSample, color: theme.foregroundSample }}
        >
          {/* Contrast badge — the previewed theme's own fg-on-bg pair (the ratio it reports), so it is legible on every tile whatever the app theme */}
          <span
            id={badgeId}
            aria-label={badgeAriaLabel}
            className="absolute top-2 right-2 px-1.5 py-0.5 rounded-pill border text-[9px] font-semibold tracking-wide"
            style={{
              backgroundColor: theme.backgroundSample,
              color: theme.foregroundSample,
              borderColor: `color-mix(in srgb, ${theme.foregroundSample} 35%, transparent)`,
            }}
          >
            {badgeLabel}
          </span>

          {/* Top row: primary disc + accent disc */}
          <div className="flex items-center gap-2 pr-12">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center shadow-elevation-1"
              style={{ backgroundColor: theme.primaryColor }}
            >
              {active && <Check className="w-3.5 h-3.5" style={{ color: theme.backgroundSample }} />}
            </div>
            <div className="w-5 h-5 rounded-full" style={{ backgroundColor: theme.accentColor }} />
          </div>

          {/* Color strip — primary / accent / fg in one row */}
          <div className="flex items-center gap-1">
            <span className="h-2 flex-1 rounded-full" style={{ backgroundColor: theme.primaryColor }} />
            <span className="h-2 flex-1 rounded-full" style={{ backgroundColor: theme.accentColor }} />
            <span className="h-2 flex-1 rounded-full" style={{ backgroundColor: theme.foregroundSample, opacity: 0.3 }} />
          </div>

          {/* Theme label in the theme's foreground for true contrast preview */}
          <span className="typo-heading mt-auto" style={{ color: theme.foregroundSample }}>
            {theme.label}
          </span>
        </div>
      </button>
    </div>
  );
});

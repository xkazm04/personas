/**
 * Canonical appearance picker controls — shared between onboarding step,
 * tour overlay, and settings panel. Wave-8 finding #3 (onboarding-home.md):
 * three nearly-identical copies were drifting on icon size, gap, opacity
 * source-of-truth, and test-id coverage. These components fold them into
 * one definition with two density variants ("default" for full-page,
 * "compact" for tour overlay).
 *
 * BRIGHTNESS_ICON_OPACITY_BY_INDEX is re-exported via themeStore — both
 * `AppearanceStep` and `TourAppearanceContent` previously inlined the same
 * `i === 0 ? 'opacity-40' : i === 1 ? 'opacity-70' : 'opacity-100'` ladder.
 */

import { Check, Sun } from 'lucide-react';
import {
  TEXT_SCALES,
  BRIGHTNESS_ICON_OPACITY_BY_INDEX,
  type TextScale,
  type BrightnessLevel,
  type ThemeDefinition,
  type ThemeId,
} from '@/stores/themeStore';

// ── Density variant ────────────────────────────────────────────────────

export type AppearancePickerDensity = 'default' | 'compact';

interface DensityTokens {
  cardPadding: string;
  cardGap: string;
  outerGap: string;
  swatchSize: string;
  swatchInner: string;
  brightnessIconSize: string;
  textScaleLabelSize: string;
  themeLabelSize: string;
  checkSize: string;
  checkPosition: string;
  brightnessSwatchIconSize: string;
}

const DENSITY: Record<AppearancePickerDensity, DensityTokens> = {
  default: {
    cardPadding: 'p-3',
    cardGap: 'gap-1.5',
    outerGap: 'gap-2',
    swatchSize: 'w-7 h-7',
    swatchInner: 'p-2.5',
    brightnessIconSize: 'w-4 h-4',
    textScaleLabelSize: 'typo-body',
    themeLabelSize: 'typo-body',
    checkSize: 'w-3 h-3',
    checkPosition: 'top-1.5 right-1.5',
    brightnessSwatchIconSize: 'w-4 h-4',
  },
  compact: {
    cardPadding: 'p-2',
    cardGap: 'gap-1',
    outerGap: 'gap-1.5',
    swatchSize: 'w-6 h-6',
    swatchInner: 'p-2',
    brightnessIconSize: 'w-3.5 h-3.5',
    textScaleLabelSize: 'text-[11px]',
    themeLabelSize: 'text-[11px]',
    checkSize: 'w-2.5 h-2.5',
    checkPosition: 'top-1 right-1',
    brightnessSwatchIconSize: 'w-3.5 h-3.5',
  },
};

// ── Text scale picker ──────────────────────────────────────────────────

export function TextScalePicker({
  textScale,
  setTextScale,
  density = 'default',
  testIdPrefix,
}: {
  textScale: TextScale;
  setTextScale: (s: TextScale) => void;
  density?: AppearancePickerDensity;
  testIdPrefix?: string;
}) {
  const d = DENSITY[density];
  return (
    <div className={`grid grid-cols-3 ${d.outerGap}`}>
      {TEXT_SCALES.map((scale) => {
        const isActive = textScale === scale.id;
        const sizeClass = scale.id === 'large' ? 'typo-body-lg' : 'typo-heading-lg';
        return (
          <button
            key={scale.id}
            onClick={() => setTextScale(scale.id)}
            aria-pressed={isActive}
            data-testid={testIdPrefix ? `${testIdPrefix}-textscale-${scale.id}` : undefined}
            className={`relative flex flex-col items-center ${d.cardGap} ${d.cardPadding} rounded-modal border transition-colors ${
              isActive
                ? 'border-primary/30 bg-primary/5'
                : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
            }`}
          >
            <span className={`font-semibold ${sizeClass} ${isActive ? 'text-foreground/90' : 'text-foreground'}`}>
              Aa
            </span>
            <span className={`${d.textScaleLabelSize} ${isActive ? 'text-foreground font-medium' : 'text-foreground'}`}>
              {scale.label}
            </span>
            {isActive && (
              <div className={`absolute ${d.checkPosition}`}>
                <Check className={`${d.checkSize} text-primary`} />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Brightness picker ──────────────────────────────────────────────────

interface BrightnessLevelDef {
  id: BrightnessLevel;
  label: string;
  description: string;
}

export function BrightnessPicker({
  levels,
  brightness,
  setBrightness,
  density = 'default',
  testIdPrefix,
  showDescription = true,
}: {
  levels: BrightnessLevelDef[];
  brightness: BrightnessLevel;
  setBrightness: (b: BrightnessLevel) => void;
  density?: AppearancePickerDensity;
  testIdPrefix?: string;
  showDescription?: boolean;
}) {
  const d = DENSITY[density];
  return (
    <div className={`grid grid-cols-3 ${d.outerGap}`}>
      {levels.map((level, i) => {
        const isActive = brightness === level.id;
        const iconOpacity = BRIGHTNESS_ICON_OPACITY_BY_INDEX[i] ?? 'opacity-100';
        return (
          <button
            key={level.id}
            onClick={() => setBrightness(level.id)}
            aria-pressed={isActive}
            data-testid={testIdPrefix ? `${testIdPrefix}-brightness-${level.id}` : undefined}
            className={`relative flex flex-col items-center ${d.cardGap} ${d.cardPadding} rounded-modal border transition-colors ${
              isActive
                ? 'border-primary/30 bg-primary/5'
                : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
            }`}
          >
            <Sun className={`${d.brightnessSwatchIconSize} ${iconOpacity} ${isActive ? 'text-amber-400' : 'text-foreground'}`} />
            <span className={`${density === 'compact' ? 'text-[11px]' : 'typo-caption'} ${isActive ? 'text-foreground/90 font-medium' : 'text-foreground'}`}>
              {level.label}
            </span>
            {showDescription && (
              <span className="typo-body text-foreground">{level.description}</span>
            )}
            {isActive && (
              <div className={`absolute ${d.checkPosition}`}>
                <Check className={`${d.checkSize} text-primary`} />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Simple theme swatch picker (no hover preview) ──────────────────────
// AppearanceSettings uses its own ThemeSwatch with hover preview tooltip;
// this is the simpler variant used by onboarding and tour.

export function SimpleThemePicker({
  themes,
  themeId,
  setTheme,
  density = 'default',
  testIdPrefix,
}: {
  themes: ThemeDefinition[];
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;
  density?: AppearancePickerDensity;
  testIdPrefix?: string;
}) {
  const d = DENSITY[density];
  const minColumnPx = density === 'compact' ? 70 : 90;
  return (
    <div
      className={`grid ${d.outerGap}`}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minColumnPx}px, 1fr))` }}
    >
      {themes.map((theme) => {
        const isActive = themeId === theme.id;
        return (
          <button
            key={theme.id}
            onClick={() => setTheme(theme.id)}
            aria-pressed={isActive}
            data-testid={testIdPrefix ? `${testIdPrefix}-theme-${theme.id}` : undefined}
            className={`flex flex-col items-center ${d.cardGap} ${d.swatchInner} rounded-modal border transition-colors ${
              isActive
                ? 'border-primary/30 bg-primary/5'
                : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
            }`}
          >
            <div
              className={`${d.swatchSize} rounded-full border border-black/10 flex items-center justify-center`}
              style={{ backgroundColor: theme.primaryColor }}
            >
              {isActive && <Check className={`${d.checkSize} text-foreground drop-shadow-elevation-1`} />}
            </div>
            <span className={`${d.themeLabelSize} ${isActive ? 'text-foreground/90 font-medium' : 'text-foreground'}`}>
              {theme.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

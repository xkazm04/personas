import { Check, Sun } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import {
  useThemeStore, DARK_BRIGHTNESS_LEVELS, LIGHT_BRIGHTNESS_LEVELS,
  BRIGHTNESS_ICON_OPACITY_BY_INDEX, useIsDarkTheme,
} from '@/stores/themeStore';
import type { BrightnessLevel } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';
import { AppearanceToggleRow } from './AppearanceToggleRow';

/**
 * Brightness ramp + the four a11y axes that stack on top of it:
 * dim (saturation), CVD-safe (hue), high-contrast (luminance), reduce-motion.
 */
export default function AppearanceBrightnessSettings() {
  const { t } = useTranslation();
  const s = t.settings.appearance;

  const brightness = useThemeStore((st) => st.brightness);
  const setBrightness = useThemeStore((st) => st.setBrightness);
  const dim = useThemeStore((st) => st.dim);
  const setDim = useThemeStore((st) => st.setDim);
  const cvdSafe = useThemeStore((st) => st.cvdSafe);
  const setCvdSafe = useThemeStore((st) => st.setCvdSafe);
  const highContrast = useThemeStore((st) => st.highContrast);
  const setHighContrast = useThemeStore((st) => st.setHighContrast);
  const reduceMotion = useThemeStore((st) => st.reduceMotion);
  const setReduceMotion = useThemeStore((st) => st.setReduceMotion);
  const isDark = useIsDarkTheme();
  const brightnessLevels = isDark ? DARK_BRIGHTNESS_LEVELS : LIGHT_BRIGHTNESS_LEVELS;

  return (
    <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-4">
      <SectionHeading title={s.brightness} icon={<Sun />} />
      <p className="typo-body text-foreground">{s.brightness_hint}</p>
      <div className="grid grid-cols-3 gap-3">
        {brightnessLevels.map((level, i) => {
          const isActive = brightness === level.id;
          const iconOpacity = BRIGHTNESS_ICON_OPACITY_BY_INDEX[i] ?? 'opacity-100';
          return (
            <button
              type="button"
              key={level.id}
              onClick={() => setBrightness(level.id as BrightnessLevel)}
              className={`relative flex flex-col items-center gap-2 p-4 rounded-modal border transition-colors text-center ${
                isActive
                  ? 'border-primary/30 bg-primary/5'
                  : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
              }`}
            >
              <Sun className={`w-5 h-5 ${iconOpacity} ${isActive ? 'text-amber-400' : 'text-foreground'}`} />
              <span className={`typo-heading ${isActive ? 'text-foreground/90 font-medium' : 'text-foreground'}`}>
                {level.label}
              </span>
              <span className="typo-caption text-foreground leading-snug">{level.description}</span>
              {isActive && (
                <div className="absolute top-2 right-2">
                  <Check className="w-3.5 h-3.5 text-primary" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      <AppearanceToggleRow
        label={s.dim_mode_label} hint={s.dim_mode_hint}
        active={dim} onToggle={() => setDim(!dim)}
        onText={s.dim_mode_on} offText={s.dim_mode_off}
      />
      <AppearanceToggleRow
        label={s.cvd_safe_label} hint={s.cvd_safe_hint}
        active={cvdSafe} onToggle={() => setCvdSafe(!cvdSafe)}
        onText={s.cvd_safe_on} offText={s.cvd_safe_off}
      />
      <AppearanceToggleRow
        label={s.high_contrast_label} hint={s.high_contrast_hint}
        active={highContrast} onToggle={() => setHighContrast(!highContrast)}
        onText={s.high_contrast_on} offText={s.high_contrast_off}
      />
      <AppearanceToggleRow
        label={s.reduce_motion_label} hint={s.reduce_motion_hint}
        active={reduceMotion} onToggle={() => setReduceMotion(!reduceMotion)}
        onText={s.reduce_motion_on} offText={s.reduce_motion_off}
      />
    </div>
  );
}

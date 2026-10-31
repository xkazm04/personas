import { Sun } from 'lucide-react';
import {
  useThemeStore, DARK_BRIGHTNESS_LEVELS, LIGHT_BRIGHTNESS_LEVELS,
  BRIGHTNESS_ICON_OPACITY_BY_INDEX, useIsDarkTheme,
} from '@/stores/themeStore';
import type { BrightnessLevel } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';
import { AppearanceToggleRow } from './AppearanceToggleRow';
import { AppearanceOptionTile } from './AppearanceOptionTile';

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
    <div className="space-y-4">
      <p className="typo-body text-foreground">{s.brightness_hint}</p>
      <div className="grid grid-cols-3 gap-3">
        {brightnessLevels.map((level, i) => {
          const isActive = brightness === level.id;
          const iconOpacity = BRIGHTNESS_ICON_OPACITY_BY_INDEX[i] ?? 'opacity-100';
          return (
            <AppearanceOptionTile
              key={level.id}
              active={isActive}
              onSelect={() => setBrightness(level.id as BrightnessLevel)}
              icon={<Sun className={`w-5 h-5 ${iconOpacity} ${isActive ? 'text-amber-400' : 'text-foreground'}`} />}
              label={s[level.labelKey]}
              description={s[level.descriptionKey]}
            />
          );
        })}
      </div>

      <AppearanceToggleRow
        label={s.dim_mode_label} hint={s.dim_mode_hint}
        active={dim} onToggle={() => setDim(!dim)}
      />
      <AppearanceToggleRow
        label={s.cvd_safe_label} hint={s.cvd_safe_hint}
        active={cvdSafe} onToggle={() => setCvdSafe(!cvdSafe)}
      />
      <AppearanceToggleRow
        label={s.high_contrast_label} hint={s.high_contrast_hint}
        active={highContrast} onToggle={() => setHighContrast(!highContrast)}
      />
      <AppearanceToggleRow
        label={s.reduce_motion_label} hint={s.reduce_motion_hint}
        active={reduceMotion} onToggle={() => setReduceMotion(!reduceMotion)}
      />
    </div>
  );
}

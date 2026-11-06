import { AlignJustify, Rows2 } from 'lucide-react';
import { useThemeStore, normalizeAppDensity } from '@/stores/themeStore';
import type { Density } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';
import { AppearanceOptionTile } from './AppearanceOptionTile';

/** Density selector: two choices, Console (default geometry) and Comfortable (more air). */
export default function AppearanceDensitySettings() {
  const { t } = useTranslation();
  const density = normalizeAppDensity(useThemeStore((s) => s.density));
  const setDensity = useThemeStore((s) => s.setDensity);
  const s = t.settings.appearance;

  // Stored 'compact' = Console, 'comfortable' = air (see themeStore.applyDensity).
  const options: Array<{ value: Density; Icon: typeof Rows2; label: string; description: string }> = [
    { value: 'compact', Icon: AlignJustify, label: s.density_console_label, description: s.density_console_desc },
    { value: 'comfortable', Icon: Rows2, label: s.density_comfortable_label, description: s.density_comfortable_desc },
  ];

  return (
    <div className="space-y-4">
      <p className="typo-caption">{s.density_hint}</p>
      <div className="grid grid-cols-2 gap-3">
        {options.map(({ value, Icon, label, description }) => {
          const isActive = density === value;
          return (
            <AppearanceOptionTile
              key={value}
              active={isActive}
              onSelect={() => setDensity(value)}
              icon={<Icon className={`w-5 h-5 ${isActive ? 'text-primary' : 'text-ink-1'}`} />}
              label={label}
              description={description}
            />
          );
        })}
      </div>
    </div>
  );
}

import { AlignJustify, Rows2, Rows3 } from 'lucide-react';
import { useThemeStore } from '@/stores/themeStore';
import type { Density } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';
import { AppearanceOptionTile } from './AppearanceOptionTile';

/** Density selector — scales spacing tokens app-wide via `--density-*` vars. */
export default function AppearanceDensitySettings() {
  const { t } = useTranslation();
  const density = useThemeStore((s) => s.density);
  const setDensity = useThemeStore((s) => s.setDensity);
  const s = t.settings.appearance;

  const options: Array<{ value: Density; Icon: typeof Rows2; label: string; description: string }> = [
    { value: 'compact', Icon: AlignJustify, label: t.shared.density_compact, description: s.density_compact_desc },
    { value: 'comfortable', Icon: Rows2, label: t.shared.density_comfortable, description: s.density_comfortable_desc },
    { value: 'cozy', Icon: Rows3, label: t.shared.density_cozy, description: s.density_cozy_desc },
  ];

  return (
    <div className="space-y-4">
      <p className="typo-caption">{s.density_hint}</p>
      <div className="grid grid-cols-3 gap-3">
        {options.map(({ value, Icon, label, description }) => {
          const isActive = density === value;
          return (
            <AppearanceOptionTile
              key={value}
              active={isActive}
              onSelect={() => setDensity(value)}
              icon={<Icon className={`w-5 h-5 ${isActive ? 'text-primary' : 'text-foreground'}`} />}
              label={label}
              description={description}
            />
          );
        })}
      </div>
    </div>
  );
}

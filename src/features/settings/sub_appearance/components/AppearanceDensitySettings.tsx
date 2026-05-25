import { AlignJustify, Check, Rows2, Rows3 } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { useThemeStore } from '@/stores/themeStore';
import type { Density } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';

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
    <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-4">
      <SectionHeading title={s.density} icon={<Rows2 />} />
      <p className="typo-caption text-foreground">{s.density_hint}</p>
      <div className="grid grid-cols-3 gap-3">
        {options.map(({ value, Icon, label, description }) => {
          const isActive = density === value;
          return (
            <button
              type="button"
              key={value}
              onClick={() => setDensity(value)}
              aria-pressed={isActive}
              className={`relative flex flex-col items-center gap-2 p-4 rounded-modal border transition-colors text-center ${
                isActive
                  ? 'border-primary/30 bg-primary/5'
                  : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-primary' : 'text-foreground'}`} />
              <span className={`typo-heading ${isActive ? 'text-foreground/90 font-medium' : 'text-foreground'}`}>
                {label}
              </span>
              <span className="typo-caption text-foreground leading-snug">{description}</span>
              {isActive && (
                <div className="absolute top-2 right-2">
                  <Check className="w-3.5 h-3.5 text-primary" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

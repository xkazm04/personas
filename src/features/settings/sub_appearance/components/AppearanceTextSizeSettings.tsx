import { Check, Type } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { useThemeStore, TEXT_SCALES } from '@/stores/themeStore';
import type { TextScale } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';

/** Text-size selector — drives the app-wide `data-text-scale` typography ramp. */
export default function AppearanceTextSizeSettings() {
  const { t } = useTranslation();
  const textScale = useThemeStore((s) => s.textScale);
  const setTextScale = useThemeStore((s) => s.setTextScale);
  const s = t.settings.appearance;

  return (
    <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-4">
      <SectionHeading title={s.text_size} icon={<Type />} />
      <div className="grid grid-cols-3 gap-3">
        {TEXT_SCALES.map((scale) => {
          const isActive = textScale === scale.id;
          return (
            <button
              type="button"
              key={scale.id}
              onClick={() => setTextScale(scale.id as TextScale)}
              className={`relative flex flex-col items-center gap-2 p-4 rounded-modal border transition-colors text-center ${
                isActive
                  ? 'border-primary/30 bg-primary/5'
                  : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
              }`}
            >
              <span className={`font-semibold typo-body-lg ${isActive ? 'text-foreground/90' : 'text-foreground'}`}>
                Aa
              </span>
              <span className={`typo-heading ${isActive ? 'text-foreground font-medium' : 'text-foreground'}`}>
                {scale.label}
              </span>
              <span className="typo-caption text-foreground leading-snug">
                {scale.description}
              </span>
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

import { Check } from 'lucide-react';
import { useThemeStore, TEXT_SCALES } from '@/stores/themeStore';
import type { TextScale } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';

/** Text-size selector — drives the app-wide `data-text-scale` typography ramp. */
export default function AppearanceTextSizeSettings() {
  const { t } = useTranslation();
  const s = t.settings.appearance;
  const textScale = useThemeStore((st) => st.textScale);
  const setTextScale = useThemeStore((st) => st.setTextScale);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {TEXT_SCALES.map((scale) => {
          const isActive = textScale === scale.id;
          return (
            <button
              type="button"
              key={scale.id}
              onClick={() => setTextScale(scale.id as TextScale)}
              aria-pressed={isActive}
              className={`relative flex flex-col items-center gap-2 p-4 rounded-modal border transition-colors text-center ${
                isActive
                  ? 'border-primary/30 bg-primary/5'
                  : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
              }`}
            >
              <span className={`typo-body-lg ${isActive ? 'text-foreground/90' : 'text-foreground'}`}>
                Aa
              </span>
              <span className={`typo-heading ${isActive ? 'text-foreground' : 'text-foreground'}`}>
                {s[scale.labelKey]}
              </span>
              <span className="typo-caption text-foreground">
                {s[scale.descriptionKey]}
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

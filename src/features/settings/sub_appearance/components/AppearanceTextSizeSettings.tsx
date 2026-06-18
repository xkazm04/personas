import { Check } from 'lucide-react';
import { useThemeStore, TEXT_SCALES } from '@/stores/themeStore';
import type { TextScale } from '@/stores/themeStore';

/** Text-size selector — drives the app-wide `data-text-scale` typography ramp. */
export default function AppearanceTextSizeSettings() {
  const textScale = useThemeStore((s) => s.textScale);
  const setTextScale = useThemeStore((s) => s.setTextScale);

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

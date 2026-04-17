import { Scissors, Blend, Moon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TransitionType } from './types';

interface TransitionPickerProps {
  value: TransitionType;
  duration: number;
  onChange: (transition: TransitionType, duration: number) => void;
}

const TRANSITIONS: { id: TransitionType; icon: typeof Scissors; color: string }[] = [
  { id: 'cut', icon: Scissors, color: 'text-foreground' },
  { id: 'crossfade', icon: Blend, color: 'text-violet-400' },
  { id: 'fade_to_black', icon: Moon, color: 'text-amber-400' },
];

const TRANSITION_LABELS: Record<TransitionType, 'transition_cut' | 'transition_crossfade' | 'transition_fade_to_black'> = {
  cut: 'transition_cut',
  crossfade: 'transition_crossfade',
  fade_to_black: 'transition_fade_to_black',
};

export default function TransitionPicker({
  value,
  duration,
  onChange,
}: TransitionPickerProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      <label className="typo-label text-foreground">
        {t.media_studio.transition}
      </label>

      {/* Transition type selector */}
      <div className="grid grid-cols-3 gap-1.5">
        {TRANSITIONS.map((tr) => {
          const Icon = tr.icon;
          const isActive = value === tr.id;
          return (
            <button
              key={tr.id}
              onClick={() => onChange(tr.id, tr.id === 'cut' ? 0 : Math.max(duration, 0.5))}
              className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg border transition-all text-center ${
                isActive
                  ? 'bg-primary/10 border-primary/30 text-foreground'
                  : 'bg-secondary/20 border-primary/10 text-foreground hover:bg-secondary/30'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? tr.color : ''}`} />
              <span className="text-md font-medium leading-tight">
                {t.media_studio[TRANSITION_LABELS[tr.id]]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Duration slider (only for non-cut transitions) */}
      {value !== 'cut' && (
        <div className="flex items-center gap-2">
          <label className="text-md text-foreground shrink-0">
            {t.media_studio.transition_duration}
          </label>
          <input
            type="range"
            min={0.1}
            max={3}
            step={0.1}
            value={duration}
            onChange={(e) => onChange(value, parseFloat(e.target.value))}
            className="flex-1 h-1 accent-primary"
          />
          <span className="text-md text-foreground w-7 text-right tabular-nums">
            {duration.toFixed(1)}s
          </span>
        </div>
      )}
    </div>
  );
}

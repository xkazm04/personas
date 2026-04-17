import { useState } from 'react';
import { ThumbsUp, ThumbsDown, Minus, Send } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface UserRatingProps {
  currentRating?: number;          // -1, 0, or 1
  currentFeedback?: string;
  onRate: (rating: number, feedback?: string) => void;
  compact?: boolean;               // smaller variant for table rows
}

export function UserRating({ currentRating, currentFeedback, onRate, compact }: UserRatingProps) {
  const { t } = useTranslation();

  const RATING_OPTIONS = [
    { value: -1, icon: ThumbsDown, label: t.agents.lab.thumbs_down, activeColor: 'text-red-400', activeBg: 'bg-red-500/15 border-red-500/30' },
    { value: 0, icon: Minus, label: t.agents.lab.neutral_rating, activeColor: 'text-foreground', activeBg: 'bg-secondary/50 border-primary/20' },
    { value: 1, icon: ThumbsUp, label: t.agents.lab.thumbs_up, activeColor: 'text-emerald-400', activeBg: 'bg-emerald-500/15 border-emerald-500/30' },
  ] as const;
  const [selected, setSelected] = useState<number | undefined>(currentRating);
  const [feedback, setFeedback] = useState(currentFeedback ?? '');
  const [saved, setSaved] = useState(currentRating !== undefined);

  const iconSize = compact ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const btnPad = compact ? 'p-1.5' : 'p-2';

  function handleSelect(value: number) {
    setSelected(value);
    setSaved(false);
    if (value !== -1) {
      setFeedback('');
    }
  }

  function handleSave() {
    if (selected === undefined) return;
    onRate(selected, selected === -1 && feedback.trim() ? feedback.trim() : undefined);
    setSaved(true);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className={`text-xs font-semibold text-foreground uppercase tracking-wider ${compact ? 'mr-1' : 'mr-2'}`}>
          Rate
        </span>
        {RATING_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isActive = selected === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => handleSelect(opt.value)}
              title={opt.label}
              className={`${btnPad} rounded-card border transition-colors ${
                isActive
                  ? `${opt.activeBg} ${opt.activeColor}`
                  : 'border-transparent text-foreground hover:text-muted-foreground/70 hover:bg-secondary/30'
              }`}
            >
              <Icon className={iconSize} />
            </button>
          );
        })}

        {selected !== undefined && !saved && (
          <button
            onClick={handleSave}
            className="ml-1 flex items-center gap-1 px-2 py-1 rounded-card text-xs font-medium bg-primary/15 text-primary border border-primary/20 hover:bg-primary/25 transition-colors"
          >
            <Send className="w-3 h-3" />
            Save
          </button>
        )}

        {saved && (
          <span className="ml-1 text-xs text-foreground">{t.agents.lab.saved_label}</span>
        )}
      </div>

      {selected === -1 && (
        <input
          type="text"
          value={feedback}
          onChange={(e) => { setFeedback(e.target.value); setSaved(false); }}
          placeholder={t.agents.lab.what_went_wrong}
          className={`w-full rounded-card border border-primary/10 bg-secondary/20 text-sm text-foreground placeholder:text-foreground px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/30 ${compact ? 'text-xs' : ''}`}
        />
      )}
    </div>
  );
}

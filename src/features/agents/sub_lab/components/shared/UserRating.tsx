import { useState } from 'react';
import { ThumbsUp, ThumbsDown, Minus, Send } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

/**
 * Thumb positions are a display vocabulary; `lab_user_ratings` stores a 1..5
 * score and `upsert_rating` rejects anything outside that range at the trust
 * boundary. This primitive is the one place the two vocabularies meet: it
 * emits and accepts the 1..5 contract, and keeps the three-thumb affordance.
 */
const THUMB_SCORE = { down: 1, neutral: 3, up: 5 } as const;

/** Map a stored 1..5 score back to the thumb that produced it. */
export function scoreToThumb(score: number | undefined): number | undefined {
  if (score === undefined || !Number.isFinite(score)) return undefined;
  if (score <= 2) return -1;
  if (score >= 4) return 1;
  return 0;
}

/** Map a thumb position to the stored 1..5 score. */
export function thumbToScore(thumb: number): number {
  if (thumb < 0) return THUMB_SCORE.down;
  if (thumb > 0) return THUMB_SCORE.up;
  return THUMB_SCORE.neutral;
}

interface UserRatingProps {
  /** Persisted score on the 1..5 `lab_user_ratings` contract. */
  currentRating?: number;
  currentFeedback?: string;
  /** Emits the 1..5 score, never the thumb position. */
  /** Resolve (or return) `false` when the write did not land; the widget then stays unsaved. */
  onRate: (rating: number, feedback?: string) => void | boolean | Promise<void | boolean>;
  compact?: boolean;               // smaller variant for table rows
}

export function UserRating({ currentRating, currentFeedback, onRate, compact }: UserRatingProps) {
  const { t } = useTranslation();

  const RATING_OPTIONS = [
    { value: -1, icon: ThumbsDown, label: t.agents.lab.thumbs_down, activeColor: 'text-status-error', activeBg: 'bg-status-error/15 border-status-error/30' },
    { value: 0, icon: Minus, label: t.agents.lab.neutral_rating, activeColor: 'text-ink-1', activeBg: 'bg-surface-2 border-hair' },
    { value: 1, icon: ThumbsUp, label: t.agents.lab.thumbs_up, activeColor: 'text-status-success', activeBg: 'bg-status-success/15 border-status-success/30' },
  ] as const;
  const [selected, setSelected] = useState<number | undefined>(scoreToThumb(currentRating));
  const [feedback, setFeedback] = useState(currentFeedback ?? '');
  const [saved, setSaved] = useState(currentRating !== undefined);

  const iconSize = compact ? 'w-3.5 h-3.5' : 'w-4 h-4';

  function handleSelect(value: number) {
    setSelected(value);
    setSaved(false);
    if (value !== -1) {
      setFeedback('');
    }
  }

  async function handleSave() {
    if (selected === undefined) return;
    const written = await onRate(thumbToScore(selected), selected === -1 && feedback.trim() ? feedback.trim() : undefined);
    // "Saved" means persisted: a failed write leaves Save on offer.
    if (written !== false) setSaved(true);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className={`typo-label text-ink-1 ${compact ? 'mr-1' : 'mr-2'}`}>
          Rate
        </span>
        {RATING_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isActive = selected === opt.value;
          return (
            <Tooltip content={opt.label}><Button
              key={opt.value}
              variant="ghost"
              size="icon-sm"
              onClick={() => handleSelect(opt.value)}
              aria-label={opt.label}
              pressed={isActive}
              className={isActive ? `${opt.activeBg} ${opt.activeColor}` : ''}>
              <Icon className={iconSize} />
            </Button></Tooltip>
          );
        })}

        {selected !== undefined && !saved && (
          <Button
            type="button"
            onClick={() => { void handleSave(); }}
            variant="secondary"
            size="xs"
            className="ml-1"
            icon={<Send className="w-3 h-3" />}
          >Save</Button>
        )}

        {saved && (
          <span className="ml-1 typo-caption text-ink-2">{t.agents.lab.saved_label}</span>
        )}
      </div>

      {selected === -1 && (
        <input
          type="text"
          value={feedback}
          onChange={(e) => { setFeedback(e.target.value); setSaved(false); }}
          placeholder={t.agents.lab.what_went_wrong}
          className={`w-full rounded-card border border-hair bg-surface-1 typo-body text-ink-1 placeholder:text-ink-3 px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/30 ${compact ? 'typo-caption' : ''}`}
        />
      )}
    </div>
  );
}

// The per-member annotation strip: the operator's 1..5 rating and a free-text
// note, sitting UNDER the row whose right edge already carries the automation's
// derived state. The two readings are deliberately rendered as two labelled
// things ("Automation" on the row, "Yours" here) rather than merged into one
// score, because merging them would destroy the only signal worth looking at:
// where they disagree.
//
// Both editors persist through `setMilestoneItem`'s annotations PATCH and send
// ONLY the key that changed, so rating a member never rewrites its note and
// vice versa. Unrated renders as five hollow stars plus the word, never a zero.
import { useEffect, useState } from 'react';
import { Star, TriangleAlert } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { INK } from '../../passport/passportInk';
import { itemVerdict } from './shipDuality';

const STARS = [1, 2, 3, 4, 5] as const;

function StarRating({ name, testid, rating, onRate, disabled }: {
  name: string;
  testid: string;
  rating: number | null;
  onRate: (value: number | null) => void;
  disabled?: boolean;
}) {
  const { t, tx } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 shrink-0" data-testid={testid}>
      <span className="typo-caption">{t.ship.duality_yours}</span>
      <span className="inline-flex items-center">
        {STARS.map((v) => {
          const filled = rating !== null && v <= rating;
          return (
            <button
              key={v}
              type="button"
              disabled={disabled}
              onClick={() => onRate(rating === v ? null : v)}
              className="p-0.5 rounded-interactive transition-colors hover:bg-foreground/[0.08] focus-ring disabled:pointer-events-none disabled:opacity-50"
              aria-label={tx(t.ship.rating_aria, { name, value: v })}
              aria-pressed={filled}
            >
              <Star
                className="w-3 h-3"
                style={{ color: filled ? INK.amber : 'rgba(148,163,184,.45)' }}
                fill={filled ? INK.amber : 'none'}
                aria-hidden
              />
            </button>
          );
        })}
      </span>
      {/* Unrated is a state, not a zero: it says so in words. */}
      <span className="typo-caption tabular-nums" style={{ color: rating === null ? 'var(--muted-foreground)' : INK.amber }}>
        {rating === null ? t.ship.rating_unrated : tx(t.ship.rating_value, { value: rating })}
      </span>
    </span>
  );
}

function NoteEditor({ name, testid, description, onSave, disabled }: {
  name: string;
  testid: string;
  description: string | null;
  onSave: (value: string | null) => void;
  disabled?: boolean;
}) {
  const { t, tx } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description ?? '');
  useEffect(() => { setDraft(description ?? ''); }, [description]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim() === '' ? null : draft.trim();
    if (next !== (description ?? null)) onSave(next);
  };

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        className={`min-w-0 flex-1 text-left typo-caption truncate rounded-interactive px-1 py-0.5 transition-colors hover:bg-foreground/[0.05] focus-ring disabled:pointer-events-none ${description ? 'text-foreground/70' : 'text-foreground/35'}`}
        aria-label={tx(t.ship.note_aria, { name })}
        data-testid={testid}
      >
        {description ?? t.ship.note_add}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { setDraft(description ?? ''); setEditing(false); }
      }}
      placeholder={t.ship.note_placeholder}
      aria-label={tx(t.ship.note_aria, { name })}
      className="min-w-0 flex-1 rounded-input border border-foreground/[0.12] bg-transparent px-2 py-0.5 typo-caption text-foreground/90 placeholder:text-foreground/35 focus-ring"
      data-testid={testid}
    />
  );
}

/**
 * One member's annotation strip. `onPatch` receives ONLY the changed key, which
 * the caller forwards straight into `setItem`'s annotations patch.
 */
export function ShipItemAnnotations({ kind, id, name, ready, description, rating, editable, onPatch }: {
  /** The membership's `item_kind` — only used to key the testids apart. */
  kind: 'use_case' | 'goal';
  id: string;
  name: string;
  /**
   * The AUTOMATION's reading, when there is one. `null` means this kind has no
   * automated readiness to disagree with — which is the honest state for a
   * goal: readiness is derived from KPI coverage and context health, and a goal
   * has neither. With no automation reading there is no duality, so the
   * conflict chip is not merely hidden, it is undefined; `shipDuality` folds
   * over features alone for the same reason and is deliberately unchanged.
   */
  ready: boolean | null;
  description: string | null;
  rating: number | null;
  editable: boolean;
  onPatch: (patch: { description?: string | null; rating?: number | null }) => void;
}) {
  const { t } = useTranslation();
  const conflict = ready !== null && itemVerdict(ready, rating) === 'disagree';

  return (
    <span className="flex items-center gap-2 mt-1.5 pl-[15px] min-w-0">
      <NoteEditor
        name={name}
        testid={`ship-item-description-${kind}-${id}`}
        description={description}
        onSave={(description) => onPatch({ description })}
        disabled={!editable}
      />
      {conflict && (
        <Tooltip content={t.ship.duality_conflict} placement="top">
          <span className="inline-flex items-center gap-1 shrink-0 typo-caption cursor-help" style={{ color: INK.violet }}>
            <TriangleAlert className="w-3 h-3" aria-hidden />
            {t.ship.duality_disagree_short}
          </span>
        </Tooltip>
      )}
      <StarRating
        name={name}
        testid={`ship-item-rating-${kind}-${id}`}
        rating={rating}
        onRate={(rating) => onPatch({ rating })}
        disabled={!editable}
      />
    </span>
  );
}

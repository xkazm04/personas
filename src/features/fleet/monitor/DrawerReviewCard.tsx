// DrawerReviewCard — one pending review inside the Monitor drawer.
//
// Extracted from `MonitorDrawer` when the card grew a third control (dispatch
// a suggested action) and the drawer would otherwise have crossed ~400 LOC.
//
// THE POINT OF THIS FILE: the controls are keyed to the PER-REVIEW in-flight
// ledger, never to the drawer-wide `isProcessing`. The hook's contract
// (`useMonitorData.ts`, "Presentational only — the write guard is per-review")
// was already written that way; this card was still early-returning on the
// global flag and disabling every row's buttons on it, so approving one review
// greyed out the whole stack until the round-trip landed — the exact case
// (a reviewer clearing a stack at one card per second) the keyed ledger exists
// to unblock. `isReviewInFlight(id, intent)` narrows to the one control that
// was actually pressed; two DIFFERENT verdicts on one row still both reach the
// backend, where the compare-and-swap decides the winner.
//
// Controls are `shared/components/buttons/Button` with `loading` — the flag is
// externally owned (the ledger owns it), which is exactly the case Button's
// `loading` prop is for, and it renders the real spinner + `aria-busy` +
// `disabled` in one place. NOTE: `AsyncButton` was the first choice and cannot
// be used here — it passes `aria-busy` down to `Button`, which then OVERWRITES
// it with `aria-busy={loading || undefined}` after the spread (`Button.tsx:220`
// vs `:226`), and `AsyncButton` omits `loading` from its props, so an
// AsyncButton never emits `aria-busy` at all.

import { useState, useCallback, useMemo } from 'react';
import { X, Check, MessageSquare, Clock, Play } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { stripPersonaPrefix } from '@/features/overview/sub_manual-review/libs/reviewHelpers';
import { ContextDataPreview } from '@/features/overview/sub_manual-review/components/ReviewListItem';
import { parseSuggestedActions } from '@/lib/reviews/suggestedActions';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import { SEVERITY_META, severityBucket, severityLabel, type SeverityBucket } from './monitorModel';

export interface DrawerReviewCardProps {
  review: ManualReviewItem;
  personaName: string;
  /**
   * Narrow query onto the hook's keyed ledger. `intent` is the verdict
   * (`'approved'` / `'rejected'`) or `action:<label>` for a dispatch; omitting
   * it asks "is anything in flight for this row".
   */
  isReviewInFlight: (id: string, intent?: string) => boolean;
  onAction: (id: string, status: ManualReviewStatus, notes?: string) => void | Promise<void>;
  /** Phase 4 — resolve by choosing a suggested action, which dispatches a run. */
  onDispatchAction?: (id: string, action: string) => void | Promise<void>;
}

export function DrawerReviewCard({
  review, personaName, isReviewInFlight, onAction, onDispatchAction,
}: DrawerReviewCardProps) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const sev: SeverityBucket = severityBucket(review.severity);
  const M = SEVERITY_META[sev];
  const Icon = M.icon;

  const actions = useMemo(() => parseSuggestedActions(review.suggested_actions), [review.suggested_actions]);

  // No `if (isProcessing) return` guard: the ledger joins a repeat call for the
  // same intent and lets a different one through, which is strictly better than
  // dropping the second click on the floor.
  const act = useCallback(
    (status: ManualReviewStatus) => Promise.resolve(onAction(review.id, status, notes || undefined)),
    [notes, onAction, review.id],
  );

  // Mirrors the Quick Answer deck (`QuickAnswerReviewStepper.chooseAction`):
  // the typed note augments the chosen action rather than replacing it. The
  // combined string is ALSO what the ledger key is built from, so the busy
  // query has to combine identically — hence one helper for both.
  const combine = useCallback(
    (action: string) => {
      const trimmed = notes.trim();
      return trimmed ? `${action} — ${trimmed}` : action;
    },
    [notes],
  );

  const chooseAction = useCallback(
    (action: string) => {
      const combined = combine(action);
      if (onDispatchAction) return Promise.resolve(onDispatchAction(review.id, combined));
      // No dispatch port wired — record the branch as an approval, same
      // fallback the deck uses.
      return Promise.resolve(onAction(review.id, 'approved' as ManualReviewStatus, combined));
    },
    [combine, onAction, onDispatchAction, review.id],
  );

  return (
    <div className="rounded-card border border-primary/10 bg-secondary/20 overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className={`w-8 h-8 rounded-modal border flex items-center justify-center flex-shrink-0 ${M.chip}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`typo-caption font-medium uppercase ${M.text}`}>{severityLabel(t, sev)}</span>
            {review.source === 'cloud' && (
              <>
                <span className="typo-caption text-foreground">·</span>
                <span className="typo-caption text-cyan-400">{t.monitor.cloud}</span>
              </>
            )}
            <span className="typo-caption text-foreground">·</span>
            <Clock className="w-3 h-3 text-foreground" />
            <span className="typo-caption text-foreground">{formatRelativeTime(review.created_at)}</span>
          </div>
          <h5 className="typo-body font-semibold text-foreground leading-snug">
            {stripPersonaPrefix(review.title, personaName) || t.monitor.untitled}
          </h5>
          {review.content && (
            <p className="typo-body text-foreground/85 whitespace-pre-wrap leading-relaxed mt-1">{review.content}</p>
          )}
          {review.context_data && (
            <div className="rounded-card border border-primary/10 bg-secondary/30 px-3 py-2 mt-2">
              <div className="typo-caption font-mono uppercase text-foreground mb-1.5">{t.monitor.context}</div>
              <ContextDataPreview raw={review.context_data} />
            </div>
          )}
          {showNotes && (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t.monitor.notes_placeholder}
              rows={3}
              autoFocus
              className="w-full mt-2 px-3 py-2 rounded-card border border-primary/15 bg-secondary/25 typo-body text-foreground placeholder:text-foreground/40 resize-none outline-none focus-visible:border-primary/40"
            />
          )}
        </div>
      </div>

      {actions.length > 0 && (
        <div className="border-t border-primary/10 px-3 py-2.5 bg-secondary/10 flex flex-col gap-1.5">
          <p className="typo-caption text-foreground">
            {onDispatchAction ? t.monitor.quick_choose_carry_out : t.monitor.quick_choose_action}
          </p>
          {actions.map((action, i) => (
            <Button
              key={`${action}-${i}`}
              variant="accent"
              accentColor="emerald"
              size="sm"
              block
              loading={isReviewInFlight(review.id, `action:${combine(action)}`)}
              icon={<Play className="w-4 h-4 flex-shrink-0" />}
              onClick={() => void chooseAction(action)}
              data-testid={`monitor-drawer-action-${review.id}-${i}`}
              className="justify-start text-left"
            >
              <span className="typo-body leading-snug">{action}</span>
            </Button>
          ))}
        </div>
      )}

      <div className="border-t border-primary/10 px-3 py-2 grid grid-cols-3 gap-2 bg-secondary/10">
        <Button
          variant="accent"
          accentColor="rose"
          size="sm"
          block
          loading={isReviewInFlight(review.id, 'rejected')}
          icon={<X className="w-4 h-4" />}
          onClick={() => void act('rejected' as ManualReviewStatus)}
          data-testid={`monitor-drawer-reject-${review.id}`}
        >
          <span className="typo-heading font-medium">{t.monitor.reject}</span>
        </Button>
        <button
          type="button"
          onClick={() => setShowNotes((s) => !s)}
          aria-pressed={showNotes}
          aria-label={t.monitor.toggle_notes}
          className={`flex items-center justify-center gap-1.5 py-2 rounded-modal border transition-colors ${
            showNotes ? 'border-primary/30 bg-primary/15 text-primary' : 'border-primary/15 bg-secondary/20 text-foreground hover:text-foreground'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span className="typo-heading font-medium">{t.monitor.notes}</span>
        </button>
        <Button
          variant="accent"
          accentColor="emerald"
          size="sm"
          block
          loading={isReviewInFlight(review.id, 'approved')}
          icon={<Check className="w-4 h-4" />}
          onClick={() => void act('approved' as ManualReviewStatus)}
          data-testid={`monitor-drawer-approve-${review.id}`}
        >
          <span className="typo-heading font-medium">{t.monitor.approve}</span>
        </Button>
      </div>
    </div>
  );
}

export default DrawerReviewCard;

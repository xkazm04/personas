import { useEffect, useMemo, useState } from 'react';
import { Check, X, MessageSquarePlus, ChevronLeft, ChevronRight, CornerDownRight, Play, Users } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { severityBucket, SEVERITY_META, severityLabel } from '@/features/fleet/monitor/monitorModel';
import { parseSuggestedActions } from '@/lib/reviews/suggestedActions';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';

/**
 * ONE decision at a time, with its full context.
 *
 * Reviews carry MULTIPLE `suggested_actions` (e.g. "Approve PATCH bump" /
 * "Override to MINOR" / "Defer the tag") — distinct triage branches, not a
 * binary yes/no. Those are now the primary affordance: each suggested action
 * is a button that resolves the review WITH that decision recorded. A plain
 * Approve/Reject is the fallback when a review carries no suggestions. The
 * description renders full and untruncated so the user knows what they pick.
 */

export function QuickAnswerReviewStepper({
  reviews,
  busy,
  onAction,
  onDispatchAction,
}: {
  reviews: ManualReviewItem[];
  busy: boolean;
  onAction: (id: string, status: ManualReviewStatus, notes?: string) => Promise<void>;
  /** Phase 4 — choosing a suggested action resolves AND dispatches a follow-up
   *  run to carry it out. Falls back to a plain approve-with-note if absent. */
  onDispatchAction?: (id: string, action: string) => Promise<void>;
}) {
  const { t, tx } = useTranslation();
  const [idx, setIdx] = useState(0);
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);

  const safeIdx = Math.min(idx, Math.max(0, reviews.length - 1));
  useEffect(() => {
    if (idx !== safeIdx) setIdx(safeIdx);
  }, [idx, safeIdx]);
  const review = reviews[safeIdx];
  useEffect(() => {
    setNote('');
    setShowNote(false);
  }, [review?.id]);

  // Resolve the source persona's team (home_team_id → team name) so the source
  // bar can show "who, and which team" behind the review.
  const personas = useAgentStore((s) => s.personas);
  const teams = usePipelineStore((s) => s.teams);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  useEffect(() => { void fetchTeams(); }, [fetchTeams]);
  const teamName = useMemo(() => {
    const teamId = personas.find((p) => p.id === review?.persona_id)?.home_team_id;
    if (!teamId) return null;
    return teams.find((tm) => tm.id === teamId)?.name ?? null;
  }, [personas, teams, review?.persona_id]);
  // Prefer the joined persona_name; fall back to resolving by id from the store
  // (the join is sometimes empty), then to the generic label.
  const personaName = useMemo(
    () => review?.persona_name || personas.find((p) => p.id === review?.persona_id)?.name || null,
    [personas, review?.persona_name, review?.persona_id],
  );

  if (reviews.length === 0 || !review) return null;
  const bucket = severityBucket(review.severity);
  const sev = SEVERITY_META[bucket];
  const actions = parseSuggestedActions(review.suggested_actions);

  // Resolve with an optional chosen action; the typed note augments it.
  const act = async (status: ManualReviewStatus, chosen?: string) => {
    const parts = [chosen, note.trim()].filter(Boolean);
    await onAction(review.id, status, parts.length ? parts.join(' — ') : undefined);
  };

  // Phase 4 — choosing a suggested action resolves the review AND dispatches a
  // follow-up run to carry it out (records the branch + re-runs the persona).
  // Falls back to a plain approve-with-note when dispatch isn't wired.
  const chooseAction = async (action: string) => {
    if (onDispatchAction) {
      useToastStore.getState().addToast(tx(t.monitor.quick_carrying_out, { action }), 'success', 4000);
      const combined = note.trim() ? `${action} — ${note.trim()}` : action;
      await onDispatchAction(review.id, combined);
    } else {
      await act('approved', action);
    }
  };

  return (
    <div className="rounded-card border border-card-border bg-card-bg/70 flex flex-col overflow-hidden" data-testid="quick-answer-review-stepper">
      {/* Queue position + severity + prev/next */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-card-border bg-secondary/15">
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${sev.chip}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} aria-hidden />
          <span className="typo-caption font-medium">{severityLabel(t, bucket)}</span>
        </span>
        <span className="typo-body text-foreground tabular-nums">
          {tx(t.monitor.quick_decision_position, { current: safeIdx + 1, total: reviews.length })}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            disabled={safeIdx === 0}
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            className="p-1.5 rounded-interactive text-foreground hover:text-foreground hover:bg-secondary/50 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            aria-label={t.monitor.quick_prev_decision}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={safeIdx >= reviews.length - 1}
            onClick={() => setIdx((i) => Math.min(reviews.length - 1, i + 1))}
            className="p-1.5 rounded-interactive text-foreground hover:text-foreground hover:bg-secondary/50 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            aria-label={t.monitor.quick_next_decision}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Source bar — who raised this, and which team they belong to */}
      <div className="flex items-center gap-2.5 px-4 py-2 border-b border-card-border bg-secondary/15">
        <PersonaIcon icon={review.persona_icon ?? null} color={review.persona_color ?? null} display="framed" frameSize="sm" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="typo-body font-semibold text-foreground truncate">{personaName ?? t.monitor.quick_source_unknown}</div>
          {teamName && (
            <div className="inline-flex items-center gap-1 typo-caption text-foreground/55 truncate">
              <Users className="w-3 h-3 flex-shrink-0" /> {teamName}
            </div>
          )}
        </div>
      </div>

      {/* The decision — title + full description */}
      <div className="px-4 py-3.5 flex flex-col gap-3 max-h-[44vh] overflow-y-auto">
        <h3 className="typo-body-lg font-semibold text-foreground leading-snug">{review.title}</h3>

        {review.content && (
          <MarkdownRenderer content={review.content} className="typo-body text-foreground/90 leading-relaxed" />
        )}
      </div>

      {/* Triage — suggested actions are the decision branches */}
      <div className="px-4 py-3 border-t border-card-border bg-secondary/10 flex flex-col gap-2">
        {actions.length > 0 && (
          <>
            <p className="typo-label uppercase tracking-wider text-foreground">
              {onDispatchAction ? t.monitor.quick_choose_carry_out : t.monitor.quick_choose_action}
            </p>
            <div className="flex flex-col gap-1.5">
              {actions.map((a, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={busy}
                  onClick={() => void chooseAction(a)}
                  title={onDispatchAction ? t.monitor.quick_carry_out_hint : undefined}
                  data-testid={`quick-answer-action-${review.id}-${i}`}
                  className="group flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-interactive border border-card-border bg-card-bg/60 hover:border-emerald-500/45 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
                >
                  {onDispatchAction ? (
                    <Play className="w-4 h-4 flex-shrink-0 text-foreground group-hover:text-emerald-400 transition-colors" />
                  ) : (
                    <CornerDownRight className="w-4 h-4 flex-shrink-0 text-foreground group-hover:text-emerald-400 transition-colors" />
                  )}
                  <span className="typo-body text-foreground leading-snug">{a}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {showNote && (
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.monitor.quick_answer_placeholder}
            className="mt-0.5 px-3 py-2 rounded-input bg-primary/5 border border-card-border typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/45"
          />
        )}

        {/* Footer controls — note toggle + reject (+ plain approve when no actions) */}
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => setShowNote((v) => !v)}
            aria-pressed={showNote}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive border whitespace-nowrap typo-caption transition-colors ${
              showNote ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-card-border text-foreground/60 hover:text-foreground hover:bg-secondary/40'
            }`}
          >
            <MessageSquarePlus className="w-3.5 h-3.5 flex-shrink-0" />
            {t.monitor.quick_note}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void act('rejected')}
              data-testid={`quick-answer-reject-${review.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive border border-status-error/35 bg-status-error/10 whitespace-nowrap typo-body font-medium text-status-error hover:bg-status-error/20 disabled:opacity-50 transition-colors"
            >
              <X className="w-4 h-4 flex-shrink-0" />
              {actions.length > 0 ? t.monitor.quick_dismiss : t.monitor.quick_reject}
            </button>
            {actions.length === 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act('approved')}
                data-testid={`quick-answer-approve-${review.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive border border-status-success/35 bg-status-success/15 whitespace-nowrap typo-body font-medium text-status-success hover:bg-status-success/25 disabled:opacity-50 transition-colors"
              >
                <Check className="w-4 h-4 flex-shrink-0" />
                {t.monitor.quick_approve}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default QuickAnswerReviewStepper;

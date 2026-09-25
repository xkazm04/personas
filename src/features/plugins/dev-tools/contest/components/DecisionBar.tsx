// The owner's verdict: declare the winner, or refine the shortlist into a
// new round. Both confirm first; refine names every variant folder the
// failure tray will delete. The review is flushed before deciding, because
// the backend reads REVIEW.md (refine's feedback) and the owner's note.
// Only what the backend can honour in the contest's phase is offered
// (`canDecide`); outside it the bar reads-only with a one-line reason.
import { useState } from 'react';
import { GitBranch, Trophy } from 'lucide-react';

import { decideContest } from '@/api/contest';
import { Button } from '@/features/shared/components/buttons';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';

import { focusContest } from '../focus';
import { primeSummary } from '../hooks/contestStore';
import type { ReviewDraft } from '../hooks/useReviewDraft';
import type { ContestStrings } from '../model/labels';
import {
  canDecide,
  decisionLock,
  decisionReadiness,
  refineDeletions,
  winnerNote,
  type DecisionLock,
} from '../model/reviewModel';

export interface DecisionBarProps {
  detail: ContestDetail;
  draft: ReviewDraft;
  /** After a refine: the child (next-round) contest, already focused. */
  onRefined?: (child: ContestSummary) => void;
  /** After a winner is recorded. */
  onDecided?: (summary: ContestSummary) => void;
  className?: string;
}

type Confirming = 'winner' | 'refine' | null;

function lockReason(s: ContestStrings, lock: DecisionLock, winner: string | null, tx: (t: string, v: Record<string, string>) => string): string {
  switch (lock) {
    case 'decided': return winner ? tx(s.decide_locked_decided, { key: winner }) : s.phase_decided;
    case 'shortlisted': return s.decide_locked_shortlisted;
    case 'judging': return s.decide_locked_judging;
    case 'collecting': return s.decide_locked_collecting;
    case 'racing': return s.decide_locked_racing;
    case 'failed': return s.decide_locked_failed;
  }
}

export function DecisionBar({ detail, draft, onRefined, onDecided, className = '' }: DecisionBarProps) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [runnerUp, setRunnerUp] = useState<string>('');
  const review = draft.review;
  const { projectId, contestId, phase, winner } = detail.summary;
  const lock = decisionLock(phase);
  const winnerOpen = canDecide(phase, 'winner');
  const refineOpen = canDecide(phase, 'refine');
  const lockLine = lock ? (
    <p className="typo-caption text-foreground w-full" data-testid="contest-decision-locked">
      {lockReason(s, lock, winner, tx)}
    </p>
  ) : null;
  if (!winnerOpen && !refineOpen) {
    return lockLine ? <div className={className} data-testid="contest-decision-bar">{lockLine}</div> : null;
  }
  if (!review) return null;

  const ready = decisionReadiness(review);
  const runnerUpOptions = [
    { value: '', label: s.runner_up_none },
    ...ready.shortlist.map((k) => ({ value: k, label: k })),
  ];
  const deletions = refineDeletions(detail, review);
  // The pick is kept as typed, but only a key still in the shortlist counts:
  // one promoted to Winner or sorted away since is never shown or sent.
  const effectiveRunnerUp = ready.shortlist.includes(runnerUp) ? runnerUp : '';

  const declare = async () => {
    if (!ready.winner) return;
    try {
      await draft.flush();
      const summary = await decideContest(projectId, contestId, {
        kind: 'winner',
        winner: ready.winner,
        runnerUp: effectiveRunnerUp || null,
        note: winnerNote(review, ready.winner),
      });
      primeSummary(summary);
      useToastStore.getState().addToast(s.decided_winner, 'success');
      setConfirming(null);
      onDecided?.(summary);
    } catch (err) {
      toastCatch('contest:decide-winner')(err);
    }
  };

  const refine = async () => {
    try {
      await draft.flush();
      const child = await decideContest(projectId, contestId, {
        kind: 'shortlist',
        keys: ready.shortlist,
        note: review.field,
      });
      primeSummary(child);
      useToastStore.getState().addToast(s.decided_refine, 'success');
      setConfirming(null);
      focusContest({ projectId: child.projectId, contestId: child.contestId });
      onRefined?.(child);
    } catch (err) {
      toastCatch('contest:decide-refine')(err);
    }
  };

  const winnerBody = [
    s.confirm_winner_body,
    effectiveRunnerUp ? tx(s.confirm_winner_runner_up, { key: effectiveRunnerUp }) : '',
  ]
    .filter(Boolean)
    .join(' ');
  const refineBody = [
    s.confirm_refine_body,
    deletions.length > 0 ? tx(s.confirm_refine_deletes, { dirs: deletions.join(', ') }) : s.confirm_refine_keeps,
  ].join(' ');

  return (
    <div className={`flex flex-wrap items-end gap-3 ${className}`} data-testid="contest-decision-bar">
      {lockLine}
      {winnerOpen && ready.shortlist.length > 0 && (
        <label className="space-y-1">
          <span className="typo-label text-foreground block">{s.runner_up_label}</span>
          <ThemedSelect
            filterable
            hideSearch
            aria-label={s.runner_up_label}
            options={runnerUpOptions}
            value={effectiveRunnerUp}
            onValueChange={setRunnerUp}
            wrapperClassName="w-44"
          />
        </label>
      )}
      <div className="flex flex-wrap gap-2 ml-auto">
        {refineOpen && <Button
          variant="secondary"
          icon={<GitBranch className="w-3.5 h-3.5" />}
          disabled={!ready.canRefine}
          disabledReason={ready.canRefine ? undefined : s.decide_refine_needs}
          onClick={() => setConfirming('refine')}
          data-testid="contest-decide-refine"
        >
          {s.decide_refine}
        </Button>}
        {winnerOpen && <Button
          variant="primary"
          icon={<Trophy className="w-3.5 h-3.5" />}
          disabled={!ready.canDeclare}
          disabledReason={ready.canDeclare ? undefined : s.decide_winner_needs}
          onClick={() => setConfirming('winner')}
          data-testid="contest-decide-winner"
        >
          {s.decide_winner}
        </Button>}
      </div>

      {confirming === 'winner' && ready.winner && (
        <ConfirmDialog
          title={tx(s.confirm_winner_title, { key: ready.winner })}
          body={winnerBody}
          confirmLabel={s.decide_winner}
          onCancel={() => setConfirming(null)}
          onConfirm={declare}
        />
      )}
      {confirming === 'refine' && (
        <ConfirmDialog
          danger={deletions.length > 0}
          title={tx(s.confirm_refine_title, { count: ready.shortlist.length })}
          body={refineBody}
          confirmLabel={s.decide_refine}
          onCancel={() => setConfirming(null)}
          onConfirm={refine}
        />
      )}
    </div>
  );
}

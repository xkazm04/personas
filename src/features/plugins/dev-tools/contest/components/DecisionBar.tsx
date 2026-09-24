// The owner's verdict: declare the winner, or refine the shortlist into a
// new round. Both confirm first; refine names every variant folder the
// failure tray will delete. The review is flushed before deciding, because
// the backend reads REVIEW.md (refine's feedback) and the owner's note.
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
import { decisionReadiness, refineDeletions, winnerNote } from '../model/reviewModel';

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

export function DecisionBar({ detail, draft, onRefined, onDecided, className = '' }: DecisionBarProps) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [runnerUp, setRunnerUp] = useState<string>('');
  const review = draft.review;
  if (!review) return null;

  const { projectId, contestId } = detail.summary;
  const ready = decisionReadiness(review);
  const runnerUpOptions = [
    { value: '', label: s.runner_up_none },
    ...ready.shortlist.map((k) => ({ value: k, label: k })),
  ];
  const deletions = refineDeletions(detail, review);

  const declare = async () => {
    if (!ready.winner) return;
    try {
      await draft.flush();
      const summary = await decideContest(projectId, contestId, {
        kind: 'winner',
        winner: ready.winner,
        runnerUp: runnerUp || null,
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
    runnerUp ? tx(s.confirm_winner_runner_up, { key: runnerUp }) : '',
  ]
    .filter(Boolean)
    .join(' ');
  const refineBody = [
    s.confirm_refine_body,
    deletions.length > 0 ? tx(s.confirm_refine_deletes, { dirs: deletions.join(', ') }) : s.confirm_refine_keeps,
  ].join(' ');

  return (
    <div className={`flex flex-wrap items-end gap-3 ${className}`} data-testid="contest-decision-bar">
      {ready.shortlist.length > 0 && (
        <label className="space-y-1">
          <span className="typo-label text-foreground block">{s.runner_up_label}</span>
          <ThemedSelect
            filterable
            hideSearch
            options={runnerUpOptions}
            value={runnerUp}
            onValueChange={setRunnerUp}
            wrapperClassName="w-44"
          />
        </label>
      )}
      <div className="flex flex-wrap gap-2 ml-auto">
        <Button
          variant="secondary"
          icon={<GitBranch className="w-3.5 h-3.5" />}
          disabled={!ready.canRefine}
          disabledReason={ready.canRefine ? undefined : s.decide_refine_needs}
          onClick={() => setConfirming('refine')}
          data-testid="contest-decide-refine"
        >
          {s.decide_refine}
        </Button>
        <Button
          variant="primary"
          icon={<Trophy className="w-3.5 h-3.5" />}
          disabled={!ready.canDeclare}
          disabledReason={ready.canDeclare ? undefined : s.decide_winner_needs}
          onClick={() => setConfirming('winner')}
          data-testid="contest-decide-winner"
        >
          {s.decide_winner}
        </Button>
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

import { useState, useEffect, useCallback } from 'react';
import { Swords, RefreshCw, Ban, Lightbulb, Trash2, FileDiff } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useOverviewStore } from '@/stores/overviewStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { getCompetition, pickCompetitionWinner, cancelCompetition, deleteCompetition, type CompetitionDetail } from '@/api/devTools/devTools';
import { CompetitionSlotRow } from './CompetitionSlotRow';
import { WinnerInsightDialog } from './WinnerInsightDialog';
import { RacingProgress } from './RacingProgress';
import { PromptDiffModal, summarizePromptDiff } from './PromptDiffModal';
import type { DevCompetition } from '@/lib/bindings/DevCompetition';

const STATUS_BADGES: Record<string, { color: string; label: string }> = {
  running: { color: 'bg-blue-500/15 text-blue-400 border-blue-500/25', label: 'Running' },
  awaiting_review: { color: 'bg-amber-500/15 text-amber-400 border-amber-500/25', label: 'Awaiting review' },
  resolved: { color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25', label: 'Resolved' },
  cancelled: { color: 'bg-red-500/15 text-red-400 border-red-500/25', label: 'Cancelled' },
};

function statusBadge(status: string) {
  return STATUS_BADGES[status] ?? { color: 'bg-primary/10 text-foreground border-primary/15', label: status };
}

function BaselineHealth({ json }: { json: string }) {
  const { t } = useTranslation();
  try {
    const bl = JSON.parse(json) as {
      tsc_errors?: number | null; cargo_errors?: number | null;
      has_test_runner?: boolean; git_clean?: boolean;
    };
    return (
      <div className="flex items-center gap-3 flex-wrap typo-caption text-foreground">
        <span className="uppercase tracking-wider text-primary">{t.plugins.dev_lifecycle.baseline_label}</span>
        {bl.tsc_errors != null && (
          <span className={bl.tsc_errors === 0 ? 'text-emerald-400' : 'text-amber-400'}>{t.plugins.dev_lifecycle.ts_errors_label} {bl.tsc_errors}</span>
        )}
        {bl.cargo_errors != null && (
          <span className={bl.cargo_errors === 0 ? 'text-emerald-400' : 'text-amber-400'}>{t.plugins.dev_lifecycle.cargo_errors_label} {bl.cargo_errors}</span>
        )}
        <span className={bl.has_test_runner ? 'text-emerald-400' : 'text-amber-400'}>
          {t.plugins.dev_lifecycle.tests_label} {bl.has_test_runner ? 'runner found' : 'no runner'}
        </span>
        <span className={bl.git_clean ? 'text-emerald-400' : 'text-amber-400'}>
          {t.plugins.dev_lifecycle.git_label} {bl.git_clean ? 'clean' : 'dirty'}
        </span>
      </div>
    );
  } catch { return null; }
}

export function CompetitionCard({ competition, onRefresh }: { competition: DevCompetition; onRefresh: () => void }) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const addToast = useToastStore((s) => s.addToast);
  const [detail, setDetail] = useState<CompetitionDetail | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [pendingWinnerTaskId, setPendingWinnerTaskId] = useState<string | null>(null);
  const [winnerInsightText, setWinnerInsightText] = useState('');
  // Side-by-side prompt diff — user multi-selects exactly 2 slots, then
  // opens the modal to see the line-level delta between their prompts.
  const [compareSelected, setCompareSelected] = useState<Set<string>>(new Set());
  const [showDiffModal, setShowDiffModal] = useState(false);
  const toggleCompare = useCallback((slotId: string) => {
    setCompareSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) next.delete(slotId);
      else if (next.size < 2) next.add(slotId);
      return next;
    });
  }, []);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try { setDetail(await getCompetition(competition.id)); }
    catch { setDetail(null); }
    finally { setLoading(false); }
  }, [competition.id]);

  // Load detail on expand, auto-poll every 8s while competition is running
  useEffect(() => {
    if (!expanded) return;
    loadDetail();
    if (competition.status !== 'running') return;
    const interval = setInterval(loadDetail, 8000);
    return () => clearInterval(interval);
  }, [expanded, competition.status, loadDetail]);

  const handleOpenPickWinner = useCallback((taskId: string) => {
    setPendingWinnerTaskId(taskId);
    // Pre-fill the insight textarea with a plain-text summary of how the
    // winner's prompt differs from each other variant. The user can edit
    // freely — this just gives them the actual delta as a starting point
    // rather than a blank box. (Connects cycle 15's prompt diff to the
    // insight-capture step.)
    const winnerSlot = detail?.slots.find((s) => s.slot.task_id === taskId)?.slot;
    if (winnerSlot?.strategy_prompt && detail) {
      const others = detail.slots
        .filter((s) => s.slot.id !== winnerSlot.id && s.slot.strategy_prompt)
        .map((s) => ({ label: s.slot.strategy_label, prompt: s.slot.strategy_prompt! }));
      if (others.length > 0) {
        setWinnerInsightText(
          summarizePromptDiff(winnerSlot.strategy_label, winnerSlot.strategy_prompt, others)
        );
        return;
      }
    }
    setWinnerInsightText('');
  }, [detail]);

  const handleConfirmPickWinner = useCallback(async () => {
    if (!pendingWinnerTaskId) return;
    setPicking(pendingWinnerTaskId);
    try {
      await pickCompetitionWinner(competition.id, pendingWinnerTaskId, null, winnerInsightText.trim() || null);
      addToast(
        winnerInsightText.trim()
          ? dl.winner_insight_saved
          : dl.winner_merge_when_ready,
        'success',
      );
      useOverviewStore.getState().processEnded('competition', 'completed', competition.id);
      setPendingWinnerTaskId(null);
      setWinnerInsightText('');
      onRefresh();
    } catch (err) {
      addToast(err instanceof Error ? err.message : dl.failed_to_pick_winner, 'error');
    } finally { setPicking(null); }
  }, [competition.id, pendingWinnerTaskId, winnerInsightText, addToast, onRefresh, dl]);

  const [optimisticCancelled, setOptimisticCancelled] = useState(false);

  const handleCancel = useCallback(async () => {
    // Optimistic: update UI immediately, run cleanup in background
    setOptimisticCancelled(true);
    setExpanded(false);
    useOverviewStore.getState().processEnded('competition', 'cancelled', competition.id);
    addToast(dl.competition_cancelled_cleaning, 'success');
    onRefresh();

    // Background cleanup (worktree removal, task cancellation)
    cancelCompetition(competition.id).catch((err) => {
      addToast(tx(dl.background_cleanup_issue, { error: err instanceof Error ? err.message : dl.unknown_error }), 'error');
    });
  }, [competition.id, addToast, onRefresh, dl, tx]);

  const handleDelete = useCallback(async () => {
    try {
      await deleteCompetition(competition.id);
      addToast(dl.competition_deleted, 'success');
      onRefresh();
    } catch (err) {
      addToast(err instanceof Error ? err.message : dl.competition_delete_failed, 'error');
    }
  }, [competition.id, addToast, onRefresh, dl]);

  const effectiveStatus = optimisticCancelled ? 'cancelled' : competition.status;
  const badge = statusBadge(effectiveStatus);
  const isFinished = effectiveStatus === 'resolved' || effectiveStatus === 'cancelled';

  return (
    <div className="border border-primary/15 rounded-card bg-card/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-primary/5 transition-colors text-left"
      >
        <div className="w-8 h-8 rounded-interactive bg-violet-500/15 border border-violet-500/25 flex items-center justify-center shrink-0">
          <Swords className="w-4 h-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="typo-card-label truncate">
            {competition.task_title}
          </p>
          <p className="typo-body text-foreground truncate">
            {competition.slot_count} {t.plugins.dev_tools.competitors_dot} {new Date(competition.created_at).toLocaleString()}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 typo-caption font-medium border shrink-0 ${badge.color}`}>
          {badge.label}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-primary/10 p-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-foreground">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" />
              <span className="typo-body">{t.plugins.dev_tools.loading_competitors}</span>
            </div>
          ) : !detail ? (
            <p className="typo-body text-foreground">{t.plugins.dev_tools.failed_to_load_detail}</p>
          ) : (
            <>
              {detail.competition.task_description && (
                <div className="rounded-interactive bg-background/40 border border-primary/10 p-3">
                  <p className="typo-caption text-primary uppercase tracking-wider mb-1">{t.plugins.dev_tools.task}</p>
                  <p className="typo-body text-foreground whitespace-pre-wrap">{detail.competition.task_description}</p>
                </div>
              )}
              {detail.competition.baseline_json && <BaselineHealth json={detail.competition.baseline_json} />}

              {/* Racing progress visualization — shown for active competitions */}
              {!isFinished && (
                <RacingProgress
                  slots={detail.slots}
                  competitionStartedAt={detail.competition.created_at}
                />
              )}

              {detail.slots.length >= 2 && (
                <div className="flex items-center gap-2 typo-caption text-foreground">
                  <span>{dl.prompt_diff_picker_label}</span>
                  <span className="tabular-nums">{tx(dl.prompt_diff_picker_count, { selected: compareSelected.size })}</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<FileDiff className="w-3 h-3" />}
                    disabled={compareSelected.size !== 2}
                    onClick={() => setShowDiffModal(true)}
                  >
                    {dl.prompt_diff_open_btn}
                  </Button>
                  {compareSelected.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setCompareSelected(new Set())}
                      className="typo-caption text-foreground hover:text-foreground underline"
                    >
                      {t.common.clear}
                    </button>
                  )}
                </div>
              )}
              <div className="space-y-2">
                {detail.slots.map(({ slot, task }) => (
                  <CompetitionSlotRow
                    key={slot.id}
                    slot={slot}
                    task={task}
                    isWinner={detail.competition.winner_task_id === slot.task_id}
                    isFinished={isFinished}
                    onPickWinner={handleOpenPickWinner}
                    picking={picking}
                    compareChecked={compareSelected.has(slot.id)}
                    compareDisabled={compareSelected.size >= 2 && !compareSelected.has(slot.id)}
                    onToggleCompare={detail.slots.length >= 2 ? toggleCompare : undefined}
                  />
                ))}
              </div>
              {showDiffModal && compareSelected.size === 2 && (() => {
                const [leftId, rightId] = Array.from(compareSelected);
                const leftSlot = detail.slots.find((s) => s.slot.id === leftId);
                const rightSlot = detail.slots.find((s) => s.slot.id === rightId);
                if (!leftSlot || !rightSlot) return null;
                return (
                  <PromptDiffModal
                    open
                    onClose={() => setShowDiffModal(false)}
                    left={{ slot: leftSlot.slot, isWinner: detail.competition.winner_task_id === leftSlot.slot.task_id }}
                    right={{ slot: rightSlot.slot, isWinner: detail.competition.winner_task_id === rightSlot.slot.task_id }}
                  />
                );
              })()}
              {pendingWinnerTaskId && (
                <WinnerInsightDialog
                  pendingTaskId={pendingWinnerTaskId}
                  insightText={winnerInsightText}
                  setInsightText={setWinnerInsightText}
                  onConfirm={handleConfirmPickWinner}
                  onCancel={() => { setPendingWinnerTaskId(null); setWinnerInsightText(''); }}
                  loading={picking === pendingWinnerTaskId}
                />
              )}
              {isFinished && detail.competition.winner_insight && (
                <div className="rounded-interactive border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Lightbulb className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="typo-caption text-primary uppercase tracking-wider">{t.plugins.dev_tools.winning_insight}</span>
                  </div>
                  <p className="typo-body text-foreground whitespace-pre-wrap">{detail.competition.winner_insight}</p>
                </div>
              )}
              <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={loadDetail}>
                  {t.common.refresh}
                </Button>
                <div className="flex items-center gap-2">
                  {isFinished && (
                    <Button variant="ghost" size="sm" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={handleDelete}>
                      {t.common.delete}
                    </Button>
                  )}
                  {!isFinished && (
                    <Button variant="danger" size="sm" icon={<Ban className="w-3.5 h-3.5" />} onClick={handleCancel}>
                      {t.common.cancel}
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

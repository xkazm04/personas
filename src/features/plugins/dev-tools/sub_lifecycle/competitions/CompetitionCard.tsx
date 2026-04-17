import { useState, useEffect, useCallback } from 'react';
import { Swords, RefreshCw, Ban, Lightbulb, Trash2 } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useOverviewStore } from '@/stores/overviewStore';
import { useToastStore } from '@/stores/toastStore';
import { getCompetition, pickCompetitionWinner, cancelCompetition, deleteCompetition, type CompetitionDetail } from '@/api/devTools/devTools';
import { CompetitionSlotRow } from './CompetitionSlotRow';
import { WinnerInsightDialog } from './WinnerInsightDialog';
import { RacingProgress } from './RacingProgress';
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
  try {
    const bl = JSON.parse(json) as {
      tsc_errors?: number | null; cargo_errors?: number | null;
      has_test_runner?: boolean; git_clean?: boolean;
    };
    return (
      <div className="flex items-center gap-3 flex-wrap typo-caption text-foreground">
        <span className="uppercase tracking-wider text-primary">Baseline:</span>
        {bl.tsc_errors != null && (
          <span className={bl.tsc_errors === 0 ? 'text-emerald-400' : 'text-amber-400'}>TS errors: {bl.tsc_errors}</span>
        )}
        {bl.cargo_errors != null && (
          <span className={bl.cargo_errors === 0 ? 'text-emerald-400' : 'text-amber-400'}>Cargo errors: {bl.cargo_errors}</span>
        )}
        <span className={bl.has_test_runner ? 'text-emerald-400' : 'text-amber-400'}>
          Tests: {bl.has_test_runner ? 'runner found' : 'no runner'}
        </span>
        <span className={bl.git_clean ? 'text-emerald-400' : 'text-amber-400'}>
          Git: {bl.git_clean ? 'clean' : 'dirty'}
        </span>
      </div>
    );
  } catch { return null; }
}

export function CompetitionCard({ competition, onRefresh }: { competition: DevCompetition; onRefresh: () => void }) {
  const addToast = useToastStore((s) => s.addToast);
  const [detail, setDetail] = useState<CompetitionDetail | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [pendingWinnerTaskId, setPendingWinnerTaskId] = useState<string | null>(null);
  const [winnerInsightText, setWinnerInsightText] = useState('');

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
    setWinnerInsightText('');
  }, []);

  const handleConfirmPickWinner = useCallback(async () => {
    if (!pendingWinnerTaskId) return;
    setPicking(pendingWinnerTaskId);
    try {
      await pickCompetitionWinner(competition.id, pendingWinnerTaskId, null, winnerInsightText.trim() || null);
      addToast(
        winnerInsightText.trim()
          ? 'Winner selected. Insight saved to Dev Clone memory.'
          : 'Winner selected. Merge the winning branch when ready.',
        'success',
      );
      useOverviewStore.getState().processEnded('competition', 'completed', competition.id);
      setPendingWinnerTaskId(null);
      setWinnerInsightText('');
      onRefresh();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to pick winner', 'error');
    } finally { setPicking(null); }
  }, [competition.id, pendingWinnerTaskId, winnerInsightText, addToast, onRefresh]);

  const [optimisticCancelled, setOptimisticCancelled] = useState(false);

  const handleCancel = useCallback(async () => {
    // Optimistic: update UI immediately, run cleanup in background
    setOptimisticCancelled(true);
    setExpanded(false);
    useOverviewStore.getState().processEnded('competition', 'cancelled', competition.id);
    addToast('Competition cancelled — cleaning up worktrees in background.', 'success');
    onRefresh();

    // Background cleanup (worktree removal, task cancellation)
    cancelCompetition(competition.id).catch((err) => {
      addToast(`Background cleanup issue: ${err instanceof Error ? err.message : 'unknown'}`, 'error');
    });
  }, [competition.id, addToast, onRefresh]);

  const handleDelete = useCallback(async () => {
    try {
      await deleteCompetition(competition.id);
      addToast('Competition deleted', 'success');
      onRefresh();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  }, [competition.id, addToast, onRefresh]);

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
            {competition.slot_count} competitors · {new Date(competition.created_at).toLocaleString()}
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
              <span className="typo-body">Loading competitors...</span>
            </div>
          ) : !detail ? (
            <p className="typo-body text-foreground">Failed to load detail.</p>
          ) : (
            <>
              {detail.competition.task_description && (
                <div className="rounded-interactive bg-background/40 border border-primary/10 p-3">
                  <p className="typo-caption text-primary uppercase tracking-wider mb-1">Task</p>
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
                  />
                ))}
              </div>
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
                    <span className="typo-caption text-primary uppercase tracking-wider">Winning insight</span>
                  </div>
                  <p className="typo-body text-foreground whitespace-pre-wrap">{detail.competition.winner_insight}</p>
                </div>
              )}
              <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={loadDetail}>
                  Refresh
                </Button>
                <div className="flex items-center gap-2">
                  {isFinished && (
                    <Button variant="ghost" size="sm" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={handleDelete}>
                      Delete
                    </Button>
                  )}
                  {!isFinished && (
                    <Button variant="danger" size="sm" icon={<Ban className="w-3.5 h-3.5" />} onClick={handleCancel}>
                      Cancel
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

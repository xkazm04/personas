import { useState, useEffect, useCallback, useRef } from 'react';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { Swords, RefreshCw, Ban, Lightbulb, Trash2, FileDiff, Trophy } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useOverviewStore } from '@/stores/overviewStore';
import { useToastStore } from '@/stores/toastStore';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { getCompetition, pickCompetitionWinner, cancelCompetition, deleteCompetition, type CompetitionDetail } from '@/api/devTools/devTools';
import { createLatestWins } from '@/stores/util/latestWins';
import { CompetitionSlotRow } from './CompetitionSlotRow';
import { WinnerInsightDialog } from './WinnerInsightDialog';
import { RacingProgress } from './RacingProgress';
import { PromptDiffModal, summarizePromptDiff } from './PromptDiffModal';
import { parseGenesFromPrompt, type StrategyGenes } from './strategyPresets';
import type { DevCompetition } from '@/lib/bindings/DevCompetition';

// Colour only. The LABEL is not this map's business: a backend status is a
// language-agnostic machine token and must resolve through
// `tokenLabel(t, 'competition', status)` (src/i18n/tokenMaps.ts), which also
// DEV-warns on an unmapped token. This map used to carry English labels
// beside the colours and fall back to rendering the raw token, so every
// non-English user read "Awaiting review" — and the warning that exists for
// exactly this miss could never fire, because nothing called the resolver.
const STATUS_BADGE_COLORS: Record<string, string> = {
  running: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  awaiting_review: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  resolved: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  cancelled: 'bg-red-500/15 text-red-400 border-red-500/25',
};

function statusBadgeColor(status: string): string {
  return STATUS_BADGE_COLORS[status] ?? 'bg-primary/10 text-foreground border-primary/15';
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

export function CompetitionCard({ competition, onRefresh, onRematch }: { competition: DevCompetition; onRefresh: () => void; onRematch?: (genes: StrategyGenes) => void }) {
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

  // Latest-wins guard for the detail slot. `loadDetail` is dispatched from the
  // expand effect, the 8s poll, AND the Refresh button, so two flights are
  // routinely open at once and without a token the SLOWER one wins simply by
  // landing last. A monotonic counter (never a timestamp — it collides under
  // rapid dispatch, exactly when the guard matters) is minted synchronously
  // before the request leaves, and both the success and the failure path check
  // it. A stale completion is inert, not an error.
  const detailGuard = useRef(createLatestWins()).current;

  const loadDetail = useCallback(async () => {
    const token = detailGuard.next();
    setLoading(true);
    try {
      const next = await getCompetition(competition.id);
      if (!detailGuard.isCurrent(token)) return;
      setDetail(next);
    } catch (err) {
      // Do NOT blank `detail`. `setDetail(null)` here turned one transient IPC
      // failure on the 8s poll into the "Failed to load detail." branch,
      // replacing an expanded card that had been fully painted moments earlier
      // (docs/design/overview-loading.md law 1: data on screen is sacred) — and
      // the bare `catch {}` routed the real error to no door at all. A COLD
      // failure needs no clear: `detail` is still the initial null, so the
      // failure branch renders exactly as before.
      silentCatch('CompetitionCard:loadDetail')(err);
    } finally {
      if (detailGuard.isCurrent(token)) setLoading(false);
    }
  }, [competition.id, detailGuard]);

  // The AUTHORITATIVE status while a card is open. `competition.status` is the
  // value from the LIST fetch, and that list only refreshes on a user action
  // (Refresh, or a mutation calling `onRefresh`) — so it goes stale in both
  // directions the moment a race changes state on its own:
  //
  //   * gating the poll on it kept `setInterval(loadDetail, 8000)` alive
  //     FOREVER after the tasks finished — an IPC round-trip every 8s per
  //     expanded card, for the life of the view, because the prop never
  //     learned the race had ended;
  //   * and a stale list in the other direction meant the poll never started
  //     at all on a race that had since begun running.
  //
  // `detail.competition.status` is re-fetched every tick and was sitting right
  // here unread. Before the first fetch lands it is null, and the prop is then
  // the only thing we know — which is exactly what the old code used.
  const liveStatus = detail?.competition.status ?? competition.status;

  // Fetch once on expand (and whenever the card is pointed at a different
  // competition).
  useEffect(() => {
    if (!expanded) return;
    loadDetail();
  }, [expanded, loadDetail]);

  // Poll while the race is actually live. Kept as its OWN effect, keyed on a
  // string rather than on `detail`: folding it back into the fetch effect
  // above would re-run that effect on every poll response, and its `loadDetail()`
  // call would then re-trigger itself in a loop.
  useEffect(() => {
    if (!expanded || liveStatus !== 'running') return;
    const interval = setInterval(loadDetail, 8000);
    return () => clearInterval(interval);
  }, [expanded, liveStatus, loadDetail]);

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
        // This text is PERSISTED as `winner_insight` once the user confirms, so
        // it has to be written in the user's language — not English scaffold
        // with their own words appended underneath.
        setWinnerInsightText(
          summarizePromptDiff(winnerSlot.strategy_label, winnerSlot.strategy_prompt, others, {
            headline: (label) => tx(dl.prompt_diff_summary_headline, { label }),
            variant: (label, added, removed) => tx(dl.prompt_diff_summary_variant, { label, added, removed }),
            takeaway: dl.prompt_diff_summary_takeaway,
          })
        );
        return;
      }
    }
    setWinnerInsightText('');
  }, [detail, dl, tx]);

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
  // Both footer actions are irreversible and both used to fire straight off a
  // single click: Delete destroys the slots, prompts, diffs AND the winner
  // insight (the only record of what a race taught you), and Cancel paints
  // success optimistically before dispatching git-worktree removal. They now
  // route through one confirm gate; nothing is dispatched until it is answered.
  const [pendingDestructive, setPendingDestructive] = useState<'cancel' | 'delete' | null>(null);

  const handleCancel = useCallback(async () => {
    // Optimistic: update UI immediately, run cleanup in background
    setOptimisticCancelled(true);
    setExpanded(false);
    useOverviewStore.getState().processEnded('competition', 'cancelled', competition.id);
    addToast(dl.competition_cancelled_cleaning, 'success');
    onRefresh();

    // Background cleanup (worktree removal, task cancellation).
    // The optimistic paint above is a promise made on the backend's behalf, so
    // it has to be WITHDRAWN when the backend disagrees. Without the rollback
    // this latch was one-way: a failed cancel toasted an error and then left
    // the card badged "Cancelled" for the rest of the session, over a
    // competition that is still running — and because `effectiveStatus`
    // overrides the fetched status, even a refresh could not correct it.
    cancelCompetition(competition.id).catch((err) => {
      silentCatch('CompetitionCard:handleCancel:cleanup')(err);
      setOptimisticCancelled(false);
      addToast(tx(dl.background_cleanup_issue, { error: err instanceof Error ? err.message : dl.unknown_error }), 'error');
      onRefresh();
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

  // Same authority question for the badge and the footer actions: an open
  // card that showed "Running" over a finished race was the visible half of
  // the polling bug above.
  const effectiveStatus = optimisticCancelled ? 'cancelled' : liveStatus;
  const badgeColor = statusBadgeColor(effectiveStatus);
  const badgeLabel = tokenLabel(t, 'competition', effectiveStatus);
  const isFinished = effectiveStatus === 'resolved' || effectiveStatus === 'cancelled';

  // Loading choreography (docs/design/overview-loading.md): slot rows ripple
  // in once per competition — id-guarded so the 8s auto-poll (loadDetail
  // above) never replays the cascade on rows already on screen.
  const revealEnter = useRevealTracker(competition.id);

  // For a resolved competition, recover the winning slot + the genes embedded
  // in its strategy prompt so we can spotlight it and seed a rematch.
  const winnerSlot = detail?.slots.find((s) => s.slot.task_id === detail.competition.winner_task_id)?.slot ?? null;
  const winnerGenes = winnerSlot?.strategy_prompt ? parseGenesFromPrompt(winnerSlot.strategy_prompt) : null;

  return (
    <div className="border border-primary/15 rounded-card bg-card/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
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
            {competition.slot_count} {t.plugins.dev_tools.competitors_dot} {<AbsoluteTime timestamp={competition.created_at} />}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 typo-caption border shrink-0 ${badgeColor}`}>
          {badgeLabel}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-primary/10 p-4 space-y-3">
          {/* Loading choreography (docs/design/overview-loading.md): `loading`
              is only ever "empty" cover — the 8s auto-poll re-sets it while
              `detail` is already on screen, and that data is sacred (law 1).
              A ghost only renders on the very first load of this card. */}
          {loading && !detail ? (
            <CompetitionSlotGhostRows />
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

              {/* Winner spotlight — surfaces the winning strategy + a one-click
                  rematch that seeds a fresh competition from its genes. */}
              {isFinished && winnerSlot && (
                <div className="rounded-interactive border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="typo-caption text-primary uppercase tracking-wider shrink-0">{dl.winner_label}</span>
                      <span className="typo-card-label truncate">{winnerSlot.strategy_label}</span>
                    </div>
                    {winnerGenes && onRematch && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Swords className="w-3.5 h-3.5" />}
                        title={dl.rematch_hint}
                        onClick={() => onRematch(winnerGenes)}
                      >
                        {dl.rematch_with_winner}
                      </Button>
                    )}
                  </div>
                  {winnerGenes && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {Object.entries(winnerGenes).map(([key, val]) => (
                        <span key={key} className={`rounded px-1.5 py-0.5 typo-caption border ${
                          (val as number) >= 7 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                          : (val as number) <= 3 ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                          : 'bg-primary/10 text-foreground border-primary/15'
                        }`}>
                          {key.replace(/([A-Z])/g, ' $1').trim()}: {val as number}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Racing progress visualization — shown for active competitions */}
              {!isFinished && (
                <RacingProgress slots={detail.slots} />
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
                {detail.slots.map(({ slot, task }, index) => (
                  <RevealItem
                    key={slot.id}
                    revealId={slot.id}
                    order={index}
                    hasEntered={revealEnter.hasEntered}
                    markEntered={revealEnter.markEntered}
                  >
                    <CompetitionSlotRow
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
                  </RevealItem>
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
                    <Button variant="ghost" size="sm" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => setPendingDestructive('delete')}>
                      {t.common.delete}
                    </Button>
                  )}
                  {!isFinished && (
                    <Button variant="danger" size="sm" icon={<Ban className="w-3.5 h-3.5" />} onClick={() => setPendingDestructive('cancel')}>
                      {t.common.cancel}
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {pendingDestructive && (
        <ConfirmDialog
          danger
          title={pendingDestructive === 'delete' ? dl.delete_confirm_title : dl.cancel_confirm_title}
          body={pendingDestructive === 'delete' ? dl.delete_confirm_body : dl.cancel_confirm_body}
          confirmLabel={pendingDestructive === 'delete' ? t.common.delete : dl.cancel_confirm_action}
          cancelLabel={t.common.go_back}
          onConfirm={async () => {
            const action = pendingDestructive;
            setPendingDestructive(null);
            if (action === 'delete') await handleDelete();
            else await handleCancel();
          }}
          onCancel={() => setPendingDestructive(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompetitionSlotGhostRows — calm ghost for the ONLY moment the card's detail
// region has nothing to show (the card's very first expand; the 8s auto-poll
// re-fetch never gets here because `detail` is already on screen by then).
// `animate-fade-in` behind a staggered `animationDelay` starting at 120ms —
// invisible until then, so a fast fetch never paints it. No `animate-pulse`.
// Geometry mirrors CompetitionSlotRow: rank icon + name bar + score badge.
// ---------------------------------------------------------------------------
const SLOT_GHOST_BAR = 'rounded bg-primary/[0.06]';
const SLOT_GHOST_NAME_WIDTHS = ['w-28', 'w-36', 'w-24'];

function CompetitionSlotGhostRows() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {SLOT_GHOST_NAME_WIDTHS.map((nameW, i) => (
        <div
          key={i}
          className="rounded-interactive border border-primary/15 bg-background/30 overflow-hidden animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}
        >
          <div className="flex items-center gap-3 px-3 py-2.5">
            <span className="w-4 h-4 rounded-full bg-primary/[0.06] shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <span className={`block h-3.5 ${nameW} max-w-full ${SLOT_GHOST_BAR}`} />
              <span className="block h-2.5 w-20 rounded bg-primary/[0.04]" />
            </div>
            <span className="h-5 w-16 rounded-full bg-primary/[0.06] shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
}

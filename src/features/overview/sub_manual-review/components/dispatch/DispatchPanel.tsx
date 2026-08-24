// The dispatch panel — a right-docked OVERLAY over whatever route is open,
// answering: what have I approved, did it actually get sent, and is it going
// stale? One click hands the selection to the Dev runner or to Fleet.
//
// Two shapes are deliberate.
//
// It OVERLAYS rather than docking in flow: `ContentBox` carries a responsive
// `min-width` floor that rises to 1180px at 2xl (`ContentLayout.tsx`), so an
// in-flow right column would push the page into a horizontal scroll instead of
// letting content shrink. The scrim + fixed panel shape is copied from
// `NotificationCenter`. It is WIDER than that tray (which is 380px) because it
// hosts the shared `FacetedDecisionTable`, whose group rail is a fixed 240px —
// at 380px the grid itself would get ~120px and the table would be unreadable.
//
// It is NOT a fifth list. Rows come from `useBacklogQueue` (the one `dev_ideas`
// data path) and the undispatched signal from `dev_tools_undispatched_ideas`;
// this file adds no query of its own.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Rocket, Send, ServerCog, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import * as devApi from '@/api/devTools/devTools';
import Button from '@/features/shared/components/buttons/Button';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';

import { useBacklogQueue } from '../backlog/useBacklogQueue';
import { DispatchResultReport, type DispatchReport } from './DispatchResultReport';
import { DispatchTable } from './DispatchTable';
import {
  buildDispatchRows,
  fleetBlockedRows,
  summarizeDispatch,
  type DispatchRow,
} from './dispatchModel';

/**
 * Module-scoped warm cache (precedent: `sub_patterns/useHierarchyScorecard.ts`,
 * `docs/design/overview-loading.md` law-4 remount rule). Closing the panel
 * deliberately hands the shared `triageItems` back to the Backlog's `pending`
 * query, so on reopen the store no longer holds the accepted rows and every
 * open would re-ghost. The last settled row build is kept here instead, so a
 * reopen paints warm while the refetch runs underneath. Un-keyed on purpose:
 * this panel always asks the same question (cross-project, `accepted`).
 */
let warmRows: DispatchRow[] | null = null;

export function DispatchPanel({ onClose }: { onClose: () => void }) {
  const { t, tx } = useTranslation();
  const c = t.chrome;

  const queue = useBacklogQueue('accepted');
  const {
    projects, undispatchedIdeas, dispatchThresholds,
    fetchTriageIdeas, refreshUndispatchedIdeas, refreshDispatchThresholds, lastTriageQuery,
  } = useSystemStore(useShallow((s) => ({
    projects: s.projects,
    undispatchedIdeas: s.undispatchedIdeas,
    dispatchThresholds: s.dispatchThresholds,
    fetchTriageIdeas: s.fetchTriageIdeas,
    refreshUndispatchedIdeas: s.refreshUndispatchedIdeas,
    refreshDispatchThresholds: s.refreshDispatchThresholds,
    lastTriageQuery: s.lastTriageQuery,
  })));

  // `triageItems` is ONE shared list and this panel narrows it to `accepted`.
  // Whatever surface was reading it before (the Backlog, on `pending`) would
  // otherwise be left filtering the wrong bucket and render empty after the
  // panel closes — so the query it was using is captured on the first render
  // and re-issued on unmount.
  const [priorQuery] = useState(lastTriageQuery);
  useEffect(() => () => {
    if (priorQuery) void fetchTriageIdeas(priorQuery.projectId, priorQuery.query);
  }, [priorQuery, fetchTriageIdeas]);

  useEffect(() => {
    void refreshUndispatchedIdeas();
    void refreshDispatchThresholds();
  }, [refreshUndispatchedIdeas, refreshDispatchThresholds]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rootPathOf = useCallback(
    (projectId: string) => projects.find((p) => p.id === projectId)?.root_path ?? null,
    [projects],
  );

  // On the panel's very first frame the shared `triageLoading` is still false
  // (the reload effect has not fired yet), so forwarding it raw would flash
  // the settled empty state before the ghost. This mount counts as loading
  // until its OWN reload has started and come back.
  const loadStartedRef = useRef(false);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (queue.loading) loadStartedRef.current = true;
    else if (loadStartedRef.current) setSettled(true);
  }, [queue.loading]);
  const isLoading = !settled;

  const liveRows = useMemo(
    () => buildDispatchRows(queue.rows, undispatchedIdeas, rootPathOf),
    [queue.rows, undispatchedIdeas, rootPathOf],
  );

  // While this mount's fetch is in flight and the live build is empty, paint
  // the last settled build instead of a ghost (law 1: a fetch never hides
  // rendered rows — and a reopen is the same panel asking the same question).
  const rows = isLoading && liveRows.length === 0 && warmRows ? warmRows : liveRows;

  useEffect(() => {
    if (settled) warmRows = liveRows;
  }, [settled, liveRows]);

  const summary = useMemo(
    () => summarizeDispatch(rows, dispatchThresholds),
    [rows, dispatchThresholds],
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'runner' | 'fleet' | null>(null);
  const [report, setReport] = useState<DispatchReport | null>(null);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === rows.length && rows.length > 0 ? new Set() : new Set(rows.map((r) => r.id)),
    );
  }, [rows]);

  const blocked = useMemo(() => fleetBlockedRows(rows, selectedIds), [rows, selectedIds]);
  const fleetEligible = selectedIds.size - blocked.length;

  const dispatch = useCallback(async (target: 'runner' | 'fleet') => {
    const ids = rows.filter((r) => selectedIds.has(r.id)).map((r) => r.id);
    if (ids.length === 0) return;
    setBusy(target);
    setReport(null);
    try {
      const result = await devApi.dispatchIdeas(ids, target);
      // `skipped` is reported alongside `dispatched`, never folded into a
      // success message: a dispatch that half-worked must not read as one.
      setReport({
        target,
        dispatched: result.dispatched.length,
        skipped: result.skipped,
        error: null,
      });
      setSelectedIds(new Set());
      queue.reload();
      void refreshUndispatchedIdeas();
    } catch (err) {
      silentCatch('DispatchPanel:dispatch')(err);
      setReport({
        target,
        dispatched: 0,
        skipped: [],
        error: resolveErrorTranslated(t, err instanceof Error ? err.message : String(err)).message,
      });
    } finally {
      setBusy(null);
    }
  }, [rows, selectedIds, queue, refreshUndispatchedIdeas, t]);

  const titleById = useMemo(
    () => new Map(rows.map((r: DispatchRow) => [r.id, r.title])),
    [rows],
  );

  return (
    <>
      <div
        className="animate-fade-slide-in fixed inset-x-0 bottom-0 top-[var(--titlebar-height,40px)] z-[90] bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />
      {/* An `aside`, not a `role="dialog"`: this is the NotificationCenter's
          docked-drawer shape (scrim + Esc to dismiss), and it does not trap
          focus — claiming dialog semantics it does not implement would be a
          worse lie than the missing role. */}
      <aside
        data-testid="dispatch-panel"
        aria-label={c.dispatch_title}
        className="animate-fade-in fixed top-[var(--titlebar-height,40px)] right-0 bottom-0 z-[91] flex w-[720px] max-w-[95vw] flex-col border-l border-primary/15 bg-background shadow-elevation-4"
      >
        <div className="flex items-start justify-between gap-3 border-b border-primary/10 px-4 py-3">
          <div className="min-w-0">
            <h2 className="typo-body font-semibold text-foreground flex items-center gap-2">
              <Rocket className="w-4 h-4 text-primary" aria-hidden />
              {c.dispatch_title}
            </h2>
            <p data-testid="dispatch-summary" className="typo-caption text-foreground mt-0.5">
              {/* No confident "0 of 0" while the first fetch is in flight —
                  counts render once there is data (warm or live) or the fetch
                  has settled. The header chrome above stays either way. */}
              {(rows.length > 0 || !isLoading) && (
                <>
                  {tx(c.dispatch_summary, { undispatched: summary.undispatched, total: summary.total })}
                  {/* Staleness is the BACKEND's rule, echoed back by the attention
                      queue. With no thresholds in hand the panel says nothing about
                      it rather than printing a cutoff of its own invention. */}
                  {dispatchThresholds && summary.stale > 0 && (
                    <span className="text-status-warning">
                      {' · '}
                      {tx(c.dispatch_summary_stale, {
                        count: summary.stale,
                        days: dispatchThresholds.ideaDispatchDays,
                      })}
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-card text-foreground transition-colors hover:bg-secondary/50"
            aria-label={c.dispatch_close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 px-4 py-3">
          <DispatchTable
            rows={rows}
            isLoading={isLoading}
            thresholds={dispatchThresholds}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
          />
        </div>

        <div className="border-t border-primary/10 px-4 py-3 space-y-2">
          {report && <DispatchResultReport report={report} titleById={titleById} />}

          {/* Said BEFORE the click: Fleet spawns a headless session inside a
              project's directory, so an idea with no folder on disk can only
              ever come back as a skip reason. */}
          {blocked.length > 0 && (
            <p data-testid="dispatch-fleet-blocked" className="typo-caption text-status-warning">
              {tx(c.dispatch_fleet_blocked, { count: blocked.length })}
            </p>
          )}

          <div className="flex items-center gap-2">
            <span className="typo-caption text-foreground">
              {tx(c.dispatch_selected, { count: selectedIds.size })}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<Send className="w-3.5 h-3.5" />}
                disabled={selectedIds.size === 0 || busy !== null}
                loading={busy === 'runner'}
                loadingLabel={c.dispatch_running}
                disabledReason={selectedIds.size === 0 ? c.dispatch_pick_first : undefined}
                onClick={() => void dispatch('runner')}
                data-testid="dispatch-to-runner"
              >
                {c.dispatch_to_runner}
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={<ServerCog className="w-3.5 h-3.5" />}
                disabled={fleetEligible <= 0 || busy !== null}
                loading={busy === 'fleet'}
                loadingLabel={c.dispatch_running}
                disabledReason={
                  selectedIds.size === 0
                    ? c.dispatch_pick_first
                    : fleetEligible <= 0
                      ? tx(c.dispatch_fleet_blocked, { count: blocked.length })
                      : undefined
                }
                onClick={() => void dispatch('fleet')}
                data-testid="dispatch-to-fleet"
              >
                {c.dispatch_to_fleet}
              </Button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

export default DispatchPanel;

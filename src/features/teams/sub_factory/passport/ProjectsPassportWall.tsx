// The project-readiness wall — the row-aligned dimension matrix (design adopted
// from the Dev Tools cockpit prototype R7–R9, docs/plans/dev-tools-cx-redesign.md).
//
// It used to be TWO views of the same passports behind a switcher: an Overview
// grid of covers, and this Compare matrix. The grid was removed (2026-08-27)
// and Compare is the baseline — the grid showed nothing the matrix's own cover
// header does not, and a switcher between "the covers" and "the covers plus
// every dimension under them" is a toggle whose off position is a strict subset
// of its on position.
//
// This host owns the sort state, the toolbar, the column ordering, and the R19
// unified-row modals (setup + fleet terminal); the table, the cover, and the
// cell renderer live in their own modules (wallConfig / CoverBody /
// InkWallCell / WallCompareTable).
import { useMemo, useRef, useState } from 'react';
import { LayoutGroup, useReducedMotion } from 'framer-motion';
import { ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';

import { sortByNameAsc, type AppPassport } from './passportModel';
import { InkTabs } from './passportInk';
import type { CoverBodyProps } from './CoverBody';
import type { CoverRoadmapVM } from './CoverRoadmap';
import type { WarningItem } from './WarningBadge';
import { onboardDispatchKey } from './onboardDispatch';
import { ImprovePlanPanel } from './improve/ImprovePlanPanel';
import { PassportActionsCell } from './PassportActionsRow';
import { PassportTerminalModal, usePassportFleetSessions } from './passportFleet';
import { RowSetupModal } from './RowSetupModal';
import { WallCompareTable, type WallSetupTarget } from './WallCompareTable';
import { COPY, SORT_TABS, type WallSort } from './wallConfig';

// Back-compat surface: these were authored in this file before the split and
// are imported from here by the Mastermind project sidebar.
export { CoverBody } from './CoverBody';
export { InkWallCell } from './InkWallCell';
export { IMPROVABLE_ROWS } from './wallConfig';

export function ProjectsPassportWall({
  passports,
  openSlugs,
  onOpen,
  attentionByProject,
  onJumpKpi,
  headerStats,
  faviconBySlug,
  roadmapBySlug,
  onOpenShip,
  rescanningProject,
  onRescanProject,
}: {
  passports: AppPassport[];
  openSlugs?: Set<string>;
  onOpen?: (slug: string) => void;
  /** Minimized roadmap per slug (dev_milestones) — the cover's Ship strip. */
  roadmapBySlug?: Map<string, CoverRoadmapVM>;
  /** Opens the project's L2 directly on its Ship tab (the roadmap strip). */
  onOpenShip?: (slug: string) => void;
  /** Off-track KPIs per project id — surfaced as a warning badge on the cover. */
  attentionByProject?: Map<string, WarningItem[]>;
  /** Deep-link from a warning into that KPI's console. */
  onJumpKpi?: (projectId: string, groupId: string, kpiId: string) => void;
  /** R18 — per-slug header stats (contexts count, KPI pass rate) computed by
   *  the host; the cover renders 0/dim placeholders when absent. */
  headerStats?: Map<string, { contexts: number; kpiPassed: number; kpiTotal: number }>;
  /** R21 — per-slug favicon data URLs; covers fall back to the status dot. */
  faviconBySlug?: Map<string, string>;
  /** Project id currently in a scoped rescan (spins that row's button). */
  rescanningProject?: string | null;
  /** Scoped per-project rescan — the actions row's Rescan. */
  onRescanProject?: (slug: string) => void;
}) {
  const reduce = useReducedMotion();
  const [sort, setSort] = useState<WallSort>('name');
  // R19 — unified-row machinery: live fleet sessions per dispatch key + modals.
  const fleetSessions = usePassportFleetSessions();
  const [setupModal, setSetupModal] = useState<WallSetupTarget | null>(null);
  const [terminalKey, setTerminalKey] = useState<string | null>(null);
  // Project-scoped Improve plan (opened from the actions row).
  const [planSlug, setPlanSlug] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Horizontal scroll from the header so the user never hunts for the bottom
  // scrollbar — nudge by ~80% of the visible width (≈ 3–4 columns).
  const nudge = (dir: -1 | 1) => {
    const el = scrollRef.current;
    if (el) el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  const columns = useMemo(() => {
    const base = [...passports];
    switch (sort) {
      case 'automation': // weakest automation first — surfaces the agents-can't-help-here projects
        return base.sort((a, b) => a.automationReadiness.score - b.automationReadiness.score);
      case 'production':
        return base.sort((a, b) => a.productionReadiness.score - b.productionReadiness.score);
      case 'gap': // biggest axis divergence first — the passport's headline view
        return base.sort(
          (a, b) =>
            Math.abs(b.automationReadiness.score - b.productionReadiness.score) -
            Math.abs(a.automationReadiness.score - a.productionReadiness.score),
        );
      default:
        return sortByNameAsc(base);
    }
  }, [passports, sort]);

  const coverProps = (p: AppPassport): CoverBodyProps => ({
    p,
    openable: Boolean(openSlugs?.has(p.identity.slug) && onOpen),
    onOpen,
    attention: attentionByProject?.get(p.identity.slug) ?? [],
    onJumpKpi,
    stats: headerStats?.get(p.identity.slug) ?? null,
    favicon: faviconBySlug?.get(p.identity.slug) ?? null,
    roadmap: roadmapBySlug?.get(p.identity.slug) ?? null,
    onOpenShip: openSlugs?.has(p.identity.slug) ? onOpenShip : undefined,
  });

  // The per-project actions row (Compare view, "Stack" group header line) —
  // every action opens a consent popover before running.
  const renderActions = (p: AppPassport) => {
    const onboardKey = onboardDispatchKey(p.identity.slug);
    return (
      <PassportActionsCell
        p={p}
        onboardSession={fleetSessions.get(onboardKey) ?? null}
        onOpenOnboardTerminal={() => setTerminalKey(onboardKey)}
        rescanning={rescanningProject === p.identity.slug}
        onRescanProject={() => onRescanProject?.(p.identity.slug)}
        onOpenPlan={() => setPlanSlug(p.identity.slug)}
      />
    );
  };

  return (
    <div>
      {/* toolbar — column scroll + column sort. The view toggle is gone: the
          matrix is the only view now. */}
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div className="inline-flex items-center gap-1.5">
          <button type="button" onClick={() => nudge(-1)} aria-label="Scroll columns left" className="inline-flex items-center justify-center w-7 h-7 rounded-interactive border border-primary/12 text-foreground/70 hover:text-foreground hover:bg-primary/5 transition-colors focus-ring">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => nudge(1)} aria-label="Scroll columns right" className="inline-flex items-center justify-center w-7 h-7 rounded-interactive border border-primary/12 text-foreground/70 hover:text-foreground hover:bg-primary/5 transition-colors focus-ring">
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="typo-body-lg text-foreground/45 ml-1">{COPY.scrollHint}</span>
        </div>
        <InkTabs tabs={SORT_TABS} active={sort} onChange={setSort} label={COPY.sort} icon={ArrowUpDown} />
      </div>

      {/* Still a LayoutGroup, and the covers still carry layoutIds — they used
          to morph between the grid tile and the table column, and they now
          animate the REORDER when the sort changes, which is the same
          machinery pointed at the one view that is left. */}
      <LayoutGroup>
        <WallCompareTable
          columns={columns}
          reduce={reduce}
          coverProps={coverProps}
          scrollRef={scrollRef}
          fleetSessions={fleetSessions}
          onOpenSetup={setSetupModal}
          onOpenTerminal={setTerminalKey}
          renderActions={renderActions}
        />
      </LayoutGroup>

      {planSlug && (
        <ImprovePlanPanel open onClose={() => setPlanSlug(null)} slug={planSlug} />
      )}

      {setupModal && (
        <RowSetupModal
          rowKey={setupModal.rowKey}
          rowLabel={setupModal.rowLabel}
          passport={setupModal.passport}
          currentLabel={setupModal.currentLabel}
          onDispatched={() => { /* R20: no auto-open — the cell's fleet icon is the door; it appears via the store's fleet events */ }}
          onClose={() => setSetupModal(null)}
        />
      )}
      {terminalKey && (
        <PassportTerminalModal
          sessionId={fleetSessions.get(terminalKey)?.id ?? ''}
          session={fleetSessions.get(terminalKey) ?? null}
          onClose={() => setTerminalKey(null)}
        />
      )}
    </div>
  );
}

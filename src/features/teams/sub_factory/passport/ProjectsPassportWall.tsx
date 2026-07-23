// The project-readiness wall — TWO VIEWS of the same passports (design adopted
// from the Dev Tools cockpit prototype R7–R9, docs/plans/dev-tools-cx-redesign.md):
//
//   • Overview (DEFAULT) — passport covers as a grid with a blockers digest
//     (WallOverviewGrid).
//   • Compare — the row-aligned dimension matrix with the improve machinery
//     (WallCompareTable).
//
// This host owns the view/sort state, the toolbar, the column ordering, and
// the R19 unified-row modals (setup + fleet terminal); the views, the cover,
// and the cell renderer live in their own modules (wallConfig / CoverBody /
// InkWallCell / WallOverviewGrid / WallCompareTable). Covers carry
// framer-motion layoutIds, so switching views RECOMPOSES the wall: each cover
// morphs between its grid tile and its table column.
import { useMemo, useRef, useState } from 'react';
import { LayoutGroup, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { sortByNameAsc, type AppPassport } from './passportModel';
import { InkTabs } from './passportInk';
import type { CoverBodyProps } from './CoverBody';
import type { WarningItem } from './WarningBadge';
import { onboardDispatchKey } from './onboardDispatch';
import { PassportTerminalModal, usePassportFleetSessions } from './passportFleet';
import { RowSetupModal } from './RowSetupModal';
import { WallOverviewGrid } from './WallOverviewGrid';
import { WallCompareTable, type WallSetupTarget } from './WallCompareTable';
import { COPY, SORT_TABS, VIEW_TABS, type WallSort, type WallView } from './wallConfig';

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
}: {
  passports: AppPassport[];
  openSlugs?: Set<string>;
  onOpen?: (slug: string) => void;
  /** Off-track KPIs per project id — surfaced as a warning badge on the cover. */
  attentionByProject?: Map<string, WarningItem[]>;
  /** Deep-link from a warning into that KPI's console. */
  onJumpKpi?: (projectId: string, groupId: string, kpiId: string) => void;
  /** R18 — per-slug header stats (contexts count, KPI pass rate) computed by
   *  the host; the cover renders 0/dim placeholders when absent. */
  headerStats?: Map<string, { contexts: number; kpiPassed: number; kpiTotal: number }>;
  /** R21 — per-slug favicon data URLs; covers fall back to the status dot. */
  faviconBySlug?: Map<string, string>;
}) {
  const reduce = useReducedMotion();
  const [view, setView] = useState<WallView>('overview');
  const [sort, setSort] = useState<WallSort>('name');
  // R19 — unified-row machinery: live fleet sessions per dispatch key + modals.
  const fleetSessions = usePassportFleetSessions();
  const [setupModal, setSetupModal] = useState<WallSetupTarget | null>(null);
  const [terminalKey, setTerminalKey] = useState<string | null>(null);
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

  const coverProps = (p: AppPassport): CoverBodyProps => {
    const onboardKey = onboardDispatchKey(p.identity.slug);
    return {
      p,
      openable: Boolean(openSlugs?.has(p.identity.slug) && onOpen),
      onOpen,
      attention: attentionByProject?.get(p.identity.slug) ?? [],
      onJumpKpi,
      stats: headerStats?.get(p.identity.slug) ?? null,
      favicon: faviconBySlug?.get(p.identity.slug) ?? null,
      onboard: {
        session: fleetSessions.get(onboardKey) ?? null,
        onOpenTerminal: () => setTerminalKey(onboardKey),
      },
    };
  };

  return (
    <div>
      {/* toolbar — view toggle + (compare-only) scroll arrows + column sort */}
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div className="inline-flex items-center gap-4">
          <InkTabs tabs={VIEW_TABS} active={view} onChange={setView} label={COPY.view} />
          {view === 'compare' && (
            <div className="inline-flex items-center gap-1.5">
              <button type="button" onClick={() => nudge(-1)} aria-label="Scroll columns left" className="inline-flex items-center justify-center w-7 h-7 rounded-interactive border border-primary/12 text-foreground/70 hover:text-foreground hover:bg-primary/5 transition-colors focus-ring">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => nudge(1)} aria-label="Scroll columns right" className="inline-flex items-center justify-center w-7 h-7 rounded-interactive border border-primary/12 text-foreground/70 hover:text-foreground hover:bg-primary/5 transition-colors focus-ring">
                <ChevronRight className="w-4 h-4" />
              </button>
              <span className="typo-caption text-foreground/45 ml-1">{COPY.scrollHint}</span>
            </div>
          )}
        </div>
        <InkTabs tabs={SORT_TABS} active={sort} onChange={setSort} label={COPY.sort} />
      </div>

      <LayoutGroup>
        {view === 'overview' ? (
          <WallOverviewGrid columns={columns} reduce={reduce} coverProps={coverProps} />
        ) : (
          <WallCompareTable
            columns={columns}
            reduce={reduce}
            coverProps={coverProps}
            scrollRef={scrollRef}
            fleetSessions={fleetSessions}
            onOpenSetup={setSetupModal}
            onOpenTerminal={setTerminalKey}
          />
        )}
      </LayoutGroup>

      {setupModal && (
        <RowSetupModal
          rowKey={setupModal.rowKey}
          rowLabel={setupModal.rowLabel}
          passport={setupModal.passport}
          currentLabel={setupModal.currentLabel}
          onDispatched={() => { /* R20: no auto-open — the cell's fleet icon is the door; it appears via the 5s poll */ }}
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

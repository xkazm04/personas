// Perf mechanics shared by the Context Map's two board surfaces (the Cross-tab
// ContextLedger and the Roster+ ContextGroupRowsStats).
//
// Both surfaces render EVERY context at once — at 600-800 contexts that is a
// big-bang mount plus a full re-render on every search keystroke, and the tab
// stalls. Three mechanics fix that without changing a pixel:
//
//  1. `useFilteredGroups` runs the filter off a `useDeferredValue` copy of the
//     query, so typing paints the input immediately and the expensive re-filter
//     happens in a lower-priority render React can interrupt.
//  2. The row/tile bodies below are `memo`-ized and take pre-resolved scalars
//     (counts, flags) rather than the coverage maps, so selecting a context or
//     starting a scan re-renders one row instead of all 800.
//  3. `skipStyle` puts `content-visibility: auto` + a `contain-intrinsic-size`
//     estimate on each GROUP section, so the browser skips layout and paint for
//     every group scrolled out of view. `auto` in the intrinsic size means the
//     browser remembers each group's real measured height once seen, so the
//     scrollbar stays honest. Windowing is invisible: nothing is unmounted and
//     everything stays reachable by scroll.
import { memo, useDeferredValue, useMemo, type CSSProperties, type ReactNode } from 'react';
import { Gauge, Layers, Sparkles, Target } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { DevUseCase } from '@/lib/bindings/DevUseCase';

import { ContextCoverage, type GoalCoverage, type TDevTools } from './contextLedgerShared';
import { KIND_DOT, kindMeta } from './useCaseKind';
import {
  KPI_STATUS_DOT,
  KPI_STATUS_LABEL_KEY,
  KPI_STATUS_SURFACE,
  type ContextKpiStatus,
} from './contextKpiStatus';
import type { ContextGroup, ContextItem } from './contextMapTypes';

/** One active use case plus an O(1) membership set over its contexts. */
export interface MemberSet {
  uc: DevUseCase;
  set: Set<string>;
}

// -- filtering ---------------------------------------------------------------

/** Filter contexts by name / keyword against a DEFERRED copy of the query, and
 *  drop groups that end up empty. An empty query is the identity, so the common
 *  case allocates nothing. Returns the deferred query too — callers use it for
 *  the "no results" copy so the message never disagrees with the rows. */
export function useFilteredGroups(groups: ContextGroup[], query: string) {
  const deferredQuery = useDeferredValue(query);
  const filteredGroups = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        contexts: g.contexts.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.keywords.some((k) => k.toLowerCase().includes(q)),
        ),
      }))
      .filter((g) => g.contexts.length > 0);
  }, [groups, deferredQuery]);

  return { filteredGroups, deferredQuery };
}

/** contextId → number of active use cases touching it. Computed once per
 *  use-case change instead of scanning every column for every row. */
export function useMemberCounts(memberSets: MemberSet[]): Map<string, number> {
  return useMemo(() => {
    const m = new Map<string, number>();
    for (const { set } of memberSets) {
      for (const id of set) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [memberSets]);
}

// -- CSS windowing -----------------------------------------------------------

/** `content-visibility: auto` with a first-paint height estimate. Applied to a
 *  group SECTION (never to the sticky column header, which must stay painted). */
export function skipStyle(estimatedPx: number): CSSProperties {
  return { contentVisibility: 'auto', containIntrinsicSize: `auto ${estimatedPx}px` };
}

/** Ledger band: a ~30px group header plus ~27px per context row. */
export const ledgerGroupHeight = (contextCount: number) => 30 + contextCount * 27;

/** Roster+ row: two-storey tiles wrap at roughly four per line, ~60px tall. */
export const rosterRowHeight = (contextCount: number) =>
  20 + Math.ceil(Math.max(contextCount, 1) / 4) * 60;

// -- the per-context scan action (identical on both surfaces) -----------------

function ScanContextButton({
  ctxId,
  scanning,
  scanBusy,
  onScanContext,
  t,
  size,
}: {
  ctxId: string;
  scanning: boolean;
  scanBusy: boolean;
  onScanContext: (id: string) => void;
  t: TDevTools;
  size: 'sm' | 'md';
}) {
  return (
    <Tooltip content={t.context_scan_ideas_tooltip}>
      <button
        type="button"
        onClick={() => {
          if (!scanBusy) onScanContext(ctxId);
        }}
        disabled={scanBusy}
        aria-label={t.context_scan_ideas_tooltip}
        className={`shrink-0 grid place-items-center rounded-full border border-primary/15 bg-primary/5 text-foreground hover:bg-primary/10 hover:border-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          size === 'sm' ? 'ml-auto w-5 h-5' : 'w-6 h-6'
        }`}
      >
        {scanning ? <LoadingSpinner size="xs" /> : <Sparkles className="w-3 h-3" />}
      </button>
    </Tooltip>
  );
}

// -- Cross-tab: one grid row per context --------------------------------------

export interface LedgerRowProps {
  ctx: ContextItem;
  selected: boolean;
  gridTemplate: string;
  memberSets: MemberSet[];
  selectedUseCaseId: string | null;
  useCaseCount: number;
  goal?: GoalCoverage;
  ideaCount: number;
  kpiCount: number;
  costUsd?: number;
  errorCount?: number;
  scanning: boolean;
  scanBusy: boolean;
  onSelectCtx: (id: string | null) => void;
  onScanContext: (id: string) => void;
  t: TDevTools;
}

/** One ledger row: the context record in the gutter, then a membership cell per
 *  active use case. Memoized on pre-resolved scalars — a selection change or a
 *  scan starting re-renders the rows it actually touches. */
export const LedgerRow = memo(function LedgerRow({
  ctx,
  selected,
  gridTemplate,
  memberSets,
  selectedUseCaseId,
  useCaseCount,
  goal,
  ideaCount,
  kpiCount,
  costUsd,
  errorCount,
  scanning,
  scanBusy,
  onSelectCtx,
  onScanContext,
  t,
}: LedgerRowProps) {
  return (
    <div
      className={`grid items-center gap-0 px-3 py-1 transition-colors ${
        selected ? 'bg-primary/10' : 'hover:bg-secondary/10'
      }`}
      style={{ gridTemplateColumns: gridTemplate }}
    >
      {/* the context record */}
      <div className="flex items-center gap-2.5 min-w-0 pr-3">
        {ctx.pinned && (
          <span className="w-1 h-3.5 rounded-full bg-amber-400/70 shrink-0" title={t.context_pinned} />
        )}
        <button
          type="button"
          onClick={() => onSelectCtx(selected ? null : ctx.id)}
          className="typo-body font-medium text-foreground truncate text-left hover:text-primary"
        >
          {ctx.name}
        </button>
        <span className="ml-auto shrink-0">
          <ContextCoverage
            fileCount={ctx.filePaths.length}
            useCaseCount={useCaseCount}
            goalCount={goal?.count ?? 0}
            firstGoalId={goal?.firstGoalId}
            ideaCount={ideaCount}
            kpiCount={kpiCount}
            costUsd={costUsd}
            errorCount={errorCount}
            t={t}
          />
        </span>
        <ScanContextButton
          ctxId={ctx.id}
          scanning={scanning}
          scanBusy={scanBusy}
          onScanContext={onScanContext}
          t={t}
          size="md"
        />
      </div>

      {/* membership cells */}
      {memberSets.map(({ uc, set }) => {
        const isMember = set.has(ctx.id);
        const isPrimary = uc.primary_context_id === ctx.id;
        const meta = kindMeta(uc.kind);
        const colSelected = uc.id === selectedUseCaseId;
        return (
          <span
            key={uc.id}
            className={`flex items-center justify-center h-full ${colSelected ? 'bg-primary/[0.07]' : ''}`}
          >
            {isMember ? (
              <span
                className={`rounded-full ${KIND_DOT[meta.stem]} ${
                  isPrimary
                    ? 'w-2.5 h-2.5 ring-2 ring-offset-1 ring-offset-transparent ring-primary/40'
                    : 'w-2 h-2 opacity-80'
                }`}
              />
            ) : (
              <span className="w-1 h-1 rounded-full bg-foreground/10" />
            )}
          </span>
        );
      })}
    </div>
  );
});

// -- Roster+: one two-storey tile per context ---------------------------------

/** One indicator — icon + count, muted to nothing at zero so a tile's colour
 *  comes from what it actually has. */
function Indicator({
  icon,
  n,
  stem,
  label,
}: {
  icon: ReactNode;
  n: number;
  stem: string;
  label: string;
}) {
  return (
    <Tooltip content={`${n} ${label}`}>
      <span
        className={`inline-flex items-center gap-0.5 typo-caption tabular-nums ${
          n > 0 ? stem : 'text-foreground/25'
        }`}
      >
        {icon}
        {n}
      </span>
    </Tooltip>
  );
}

export interface RosterTileProps {
  ctx: ContextItem;
  status: ContextKpiStatus;
  selected: boolean;
  dimmed: boolean;
  featureCount: number;
  goalCount: number;
  kpiCount: number;
  scanning: boolean;
  scanBusy: boolean;
  onSelectCtx: (id: string | null) => void;
  onScanContext: (id: string) => void;
  t: TDevTools;
}

export const RosterTile = memo(function RosterTile({
  ctx,
  status,
  selected,
  dimmed,
  featureCount,
  goalCount,
  kpiCount,
  scanning,
  scanBusy,
  onSelectCtx,
  onScanContext,
  t,
}: RosterTileProps) {
  return (
    // A div, not a button — the tile hosts its own scan button and nested
    // buttons are invalid HTML.
    <div
      className={`w-[12.5rem] rounded-card border transition-colors ${KPI_STATUS_SURFACE[status]} ${
        selected ? 'ring-1 ring-primary/60' : ''
      } ${dimmed ? 'opacity-35' : ''}`}
    >
      {/* label */}
      <button
        type="button"
        onClick={() => onSelectCtx(selected ? null : ctx.id)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left min-w-0"
      >
        <Tooltip content={t[KPI_STATUS_LABEL_KEY[status]]}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${KPI_STATUS_DOT[status]}`} />
        </Tooltip>
        <span className="typo-body font-medium text-foreground truncate">{ctx.name}</span>
      </button>

      {/* the divider, then the indicators */}
      <div className="border-t border-foreground/10 flex items-center gap-2.5 px-2 py-1">
        <Indicator icon={<Layers className="w-3 h-3" />} n={featureCount} stem="text-sky-300" label={t.uc_title} />
        <Indicator
          icon={<Target className="w-3 h-3" />}
          n={goalCount}
          stem="text-violet-300"
          label={t.context_detail_goals_heading}
        />
        <Indicator
          icon={<Gauge className="w-3 h-3" />}
          n={kpiCount}
          stem="text-rose-300"
          label={t.ctx_indicator_kpis}
        />
        <ScanContextButton
          ctxId={ctx.id}
          scanning={scanning}
          scanBusy={scanBusy}
          onScanContext={onScanContext}
          t={t}
          size="sm"
        />
      </div>
    </div>
  );
});

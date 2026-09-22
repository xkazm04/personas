// Shared building blocks for the Context Ledger (see ContextLedger.tsx).
//
// The ledger fuses the context map and the use-case slice layer into one
// surface. These are its reusable parts — the props contract, the per-kind
// visual language, the per-context coverage cluster and the use-case actions —
// kept out of the view so each is testable and extractable on its own.
import { type ReactNode } from 'react';
import { AlertTriangle, DollarSign, FileCode2, Layers, Lightbulb, Gauge, Target } from 'lucide-react';
import { Numeric } from '@/features/shared/components/display/Numeric';

import { Button } from '@/features/shared/components/buttons';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { openGoalsBoard } from '@/features/companions/athena/guidance/appActions';
import type { Translations } from '@/i18n/en';

import type { DevUseCase } from '@/lib/bindings/DevUseCase';

import type { ContextKpiStatus } from './contextKpiStatus';
import type { ContextGroup } from './contextMapTypes';
import type { FeatureChipContext } from './featureChipContext';
import { FeatureChip } from './FeatureChip';
import type { UseCasesState } from './useUseCases';

export interface GoalCoverage {
  count: number;
  firstGoalId: string;
}

/** Everything a ledger variant needs — the same data ContextMapPage already
 *  computes for the ledger, handed over verbatim. */
export interface ContextLedgerProps {
  groups: ContextGroup[];
  useCaseState: UseCasesState;
  selectedUseCaseId: string | null;
  onSelectUseCase: (id: string | null) => void;
  selectedCtxId: string | null;
  onSelectCtx: (id: string | null) => void;
  goalCoverageByContext: Map<string, GoalCoverage>;
  ideaCoverageByContext: Map<string, number>;
  kpiCoverageByContext: Map<string, number>;
  /** Runtime joins (findings loop 1A) — empty maps when no tracer / Sentry wired. */
  costByContext: Map<string, number>;
  errorsByContext: Map<string, number>;
  /** contextId → worst-wins KPI health; absent = no KPIs (neutral). Drives the
   *  group-row variants' tinting. */
  kpiStatusByContext: Map<string, ContextKpiStatus>;
  hasMap: boolean;
  /** A `fetchContextGroups`/`fetchContexts` request is in flight
   *  (`systemStore.contextMapLoading`). Gates the zero-groups empty state so a
   *  cold visit doesn't flash "no context groups" before the fetch resolves
   *  (docs/design/overview-loading.md — empty state only renders once settled). */
  mapLoading: boolean;
  /** Run the idea scanner scoped to one context (the per-row ✨ action). */
  onScanContext: (contextId: string) => void;
  /** The context whose per-row scan is currently running, if any. */
  scanningContextId: string | null;
  /** A scan (context or codebase) is in flight — disables per-row scan. */
  scanBusy: boolean;
  /** Group authoring — the inline "new group" form the ActionRow's + Group
   *  button opens (the ledger hosts the form; the button lives in the page). */
  showNewGroup: boolean;
  onShowNewGroup: (v: boolean) => void;
  onCreateGroup: (name: string, color: string) => void;
  /** Kick a full codebase scan — offered from the zero-groups empty state. */
  onScan: () => void;
  /** contextId → the active features slicing it. Stable arrays from ONE
   *  memoised Map, so the memoised ledger rows keep their identity. */
  useCasesByContext: Map<string, DevUseCase[]>;
  /** Board-wide feature-chip inputs; null when no project is active. */
  featureChip: FeatureChipContext | null;
}

// -- per-context coverage chips ------------------------------------------------

interface CoverageChipProps {
  icon: ReactNode;
  count: number;
  label: string;
  stem: 'sky' | 'violet' | 'amber' | 'rose';
  /** When set AND count > 0, the chip becomes a button that jumps to the
   *  attached work (the goal spotlight / the idea triage queue). */
  onJump?: () => void;
  jumpTitle?: string;
}

const COVERAGE_STEM: Record<string, string> = {
  sky: 'text-sky-300',
  violet: 'text-violet-300',
  amber: 'text-amber-300',
  rose: 'text-rose-300',
};

/** One compact metric — an icon + a count, muted to zero when there is none.
 *  The whole row of these is how a context declares "what's attached to me".
 *  A metric with attached work is clickable and hands off to that surface. */
export function CoverageChip({ icon, count, label, stem, onJump, jumpTitle }: CoverageChipProps) {
  const active = count > 0;
  const cls = `inline-flex items-center gap-1 tabular-nums typo-caption ${
    active ? COVERAGE_STEM[stem] : 'text-foreground/25'
  }`;

  if (active && onJump) {
    return (
      <button
        type="button"
        title={jumpTitle}
        onClick={(e) => {
          // The row itself is clickable (opens the context) — don't do both.
          e.stopPropagation();
          onJump();
        }}
        className={`${cls} hover:underline underline-offset-2`}
      >
        {icon}
        {count}
      </button>
    );
  }

  return (
    <Tooltip content={`${count} ${label}`}>
      <span className={cls}>
        {icon}
        {count}
      </span>
    </Tooltip>
  );
}

/** The standard five-metric coverage cluster for one context. Goals and ideas
 *  are click-through: they hand off to the Goals board (seeding the spotlight)
 *  and the unified Backlog respectively — the shortcuts the old ContextCard
 *  badges carried, preserved on the ledger row. */
export function ContextCoverage({
  fileCount,
  useCaseCount,
  goalCount,
  firstGoalId,
  ideaCount,
  kpiCount,
  costUsd,
  errorCount,
  contextId,
  contextName,
  contextUseCases,
  chip,
  t,
}: {
  fileCount: number;
  useCaseCount: number;
  goalCount: number;
  firstGoalId?: string;
  ideaCount: number;
  kpiCount: number;
  /** 30d LLM spend flowing through this context. Undefined = no tracer wired. */
  costUsd?: number;
  /** Unresolved Sentry events landing on this context's files. */
  errorCount?: number;
  /** Identity of the row, so the cost chip can hand its own predicate to the
   *  destination. Optional: a caller with no context identity gets the old
   *  display-only chip rather than a control that would navigate nowhere. */
  contextId?: string;
  contextName?: string;
  /** The features slicing THIS context. Present turns the feature chip into
   *  the council review popover's trigger; absent keeps the old count chip. */
  contextUseCases?: DevUseCase[];
  /** Board-wide chip inputs (project, group spans, link-layer state). */
  chip?: FeatureChipContext | null;
  t: TDevTools;
}) {
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const setPendingGoalSpotlightId = useSystemStore((s) => s.setPendingGoalSpotlightId);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setPendingApprovalsMode = useSystemStore((s) => s.setPendingApprovalsMode);
  const setOverviewTab = useOverviewStore((s) => s.setOverviewTab);
  const setPendingLlmContextFilter = useSystemStore((s) => s.setPendingLlmContextFilter);

  const jumpToGoals = () => {
    if (firstGoalId) setPendingGoalSpotlightId(firstGoalId);
    openGoalsBoard();
  };
  // Idea Triage is gone — the ideas raised against a context are triaged in
  // Approvals › Backlog now. Seed the pending mode BEFORE navigating so
  // ManualReviewList reads it on the mount this click causes.
  const jumpToIdeas = () => {
    setPendingApprovalsMode('backlog');
    setSidebarSection('overview');
    setOverviewTab('manual-review');
  };
  const jumpToErrors = () => setDevToolsTab('overview');
  /* The chip and its destination must share a predicate (count-carries-predicate):
     the number came from the use cases slicing THIS context, so the table it
     opens is filtered to exactly those. Seed the filter BEFORE navigating, as
     `jumpToIdeas` does, so the destination reads it on the mount this causes. */
  const jumpToCost = () => {
    if (!contextId) return;
    setPendingLlmContextFilter({ contextId, contextName: contextName ?? contextId });
    setDevToolsTab('llm-overview');
  };

  return (
    <span className="inline-flex items-center gap-2.5">
      <CoverageChip icon={<FileCode2 className="w-3 h-3" />} count={fileCount} label={t.files} stem="rose" />
      {contextUseCases && chip?.project && (contextUseCases.length > 0 || chip.featuresUnlinked) ? (
        <FeatureChip
          contextName={contextName ?? ''}
          useCases={contextUseCases}
          chip={chip}
          t={t}
        />
      ) : (
        <CoverageChip icon={<Layers className="w-3 h-3" />} count={useCaseCount} label={t.uc_title} stem="sky" />
      )}
      <CoverageChip
        icon={<Target className="w-3 h-3" />}
        count={goalCount}
        label="goals"
        stem="violet"
        onJump={jumpToGoals}
        jumpTitle={t.context_goal_coverage_tooltip}
      />
      <CoverageChip
        icon={<Lightbulb className="w-3 h-3" />}
        count={ideaCount}
        label="ideas"
        stem="amber"
        onJump={jumpToIdeas}
        jumpTitle={t.context_idea_coverage_tooltip}
      />
      <CoverageChip icon={<Gauge className="w-3 h-3" />} count={kpiCount} label="KPIs" stem="rose" />

      {/* Runtime (only when the sensor is actually wired — an unwired project
          shows exactly the chips it always did). */}
      {costUsd !== undefined && costUsd > 0 && (
        <Tooltip content={contextId ? t.ctx_cost_jump_tooltip : t.ctx_cost_tooltip}>
          {contextId ? (
            <button
              type="button"
              onClick={jumpToCost}
              data-testid="context-cost-jump"
              aria-label={t.ctx_cost_jump_tooltip}
              className="inline-flex items-center gap-1 tabular-nums typo-caption text-amber-300/90 rounded-interactive hover:text-amber-200 hover:underline focus-ring"
            >
              <DollarSign className="w-3 h-3" />
              <Numeric value={costUsd} precision={costUsd >= 1 ? 2 : 3} />
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 tabular-nums typo-caption text-amber-300/90">
              <DollarSign className="w-3 h-3" />
              <Numeric value={costUsd} precision={costUsd >= 1 ? 2 : 3} />
            </span>
          )}
        </Tooltip>
      )}
      {errorCount !== undefined && errorCount > 0 && (
        <CoverageChip
          icon={<AlertTriangle className="w-3 h-3" />}
          count={errorCount}
          label={t.ctx_errors_label}
          stem="rose"
          onJump={jumpToErrors}
          jumpTitle={t.ctx_errors_tooltip}
        />
      )}
    </span>
  );
}

/** The dev_tools translation slice, straight off the generated tree — so a typo
 *  in a key is a compile error rather than an `undefined` at runtime. */
export type TDevTools = Translations['plugins']['dev_tools'];

// -- shared header actions (scan / cancel) -------------------------------------

export function LedgerActions({
  state,
  hasMap,
  t,
}: {
  state: UseCasesState;
  hasMap: boolean;
  t: TDevTools;
}) {
  if (state.scanning) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void state.cancelScan()}
        icon={<LoadingSpinner size="xs" />}
      >
        {t.uc_cancel_scan}
      </Button>
    );
  }
  return (
    <Button
      variant="accent"
      accentColor="amber"
      size="sm"
      onClick={() => void state.scan()}
      disabled={!hasMap}
      title={t.uc_scan_tooltip}
      icon={<Layers className="w-3 h-3" />}
    >
      {t.uc_scan}
    </Button>
  );
}

// Re-exported so the ledger keeps a single import site for its vocabulary.
export { kindMeta, KIND_META, KIND_TEXT, KIND_DOT, type KindMeta } from './useCaseKind';

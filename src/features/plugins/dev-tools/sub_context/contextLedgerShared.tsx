// Shared building blocks for the Context Ledger (see ContextLedger.tsx).
//
// The ledger fuses the context map and the use-case slice layer into one
// surface. These are its reusable parts — the props contract, the per-kind
// visual language, the per-context coverage cluster, the use-case actions, and
// the pending-proposal triage strip — kept out of the view so each is testable
// and extractable on its own.
import type { ReactNode } from 'react';
import { Check, FileCode2, Layers, Lightbulb, Route, Boxes, Plug, Wrench, Gauge, Target, X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSystemStore } from '@/stores/systemStore';
import { openGoalsBoard } from '@/features/plugins/companion/guidance/appActions';
import type { DevUseCase } from '@/lib/bindings/DevUseCase';
import type { Translations } from '@/i18n/en';

import type { ContextGroup } from './contextMapTypes';
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
  hasMap: boolean;
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
}

// -- per-kind visual language --------------------------------------------------

export interface KindMeta {
  icon: typeof Route;
  /** Tailwind stem, used for dot / chip / border tints. */
  stem: string;
  labelKey: 'uc_kind_user_flow' | 'uc_kind_capability' | 'uc_kind_integration' | 'uc_kind_ops';
}

export const KIND_META: Record<string, KindMeta> = {
  user_flow: { icon: Route, stem: 'violet', labelKey: 'uc_kind_user_flow' },
  capability: { icon: Boxes, stem: 'sky', labelKey: 'uc_kind_capability' },
  integration: { icon: Plug, stem: 'emerald', labelKey: 'uc_kind_integration' },
  ops: { icon: Wrench, stem: 'amber', labelKey: 'uc_kind_ops' },
};

export function kindMeta(kind: string): KindMeta {
  return KIND_META[kind] ?? KIND_META.capability!;
}

/** Static class maps — Tailwind's JIT can't see interpolated stems, so the
 *  variants read these instead of building `text-${stem}-300` at runtime. */
export const KIND_TEXT: Record<string, string> = {
  violet: 'text-violet-300',
  sky: 'text-sky-300',
  emerald: 'text-emerald-300',
  amber: 'text-amber-300',
};
export const KIND_DOT: Record<string, string> = {
  violet: 'bg-violet-400',
  sky: 'bg-sky-400',
  emerald: 'bg-emerald-400',
  amber: 'bg-amber-400',
};

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
 *  and the idea-triage queue respectively — the shortcuts the old ContextCard
 *  badges carried, preserved on the ledger row. */
export function ContextCoverage({
  fileCount,
  useCaseCount,
  goalCount,
  firstGoalId,
  ideaCount,
  kpiCount,
  t,
}: {
  fileCount: number;
  useCaseCount: number;
  goalCount: number;
  firstGoalId?: string;
  ideaCount: number;
  kpiCount: number;
  t: TDevTools;
}) {
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const setPendingGoalSpotlightId = useSystemStore((s) => s.setPendingGoalSpotlightId);

  const jumpToGoals = () => {
    if (firstGoalId) setPendingGoalSpotlightId(firstGoalId);
    openGoalsBoard();
  };
  const jumpToIdeas = () => setDevToolsTab('idea-triage');

  return (
    <span className="inline-flex items-center gap-2.5">
      <CoverageChip icon={<FileCode2 className="w-3 h-3" />} count={fileCount} label={t.files} stem="rose" />
      <CoverageChip icon={<Layers className="w-3 h-3" />} count={useCaseCount} label={t.uc_title} stem="sky" />
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
    </span>
  );
}

/** The dev_tools translation slice, straight off the generated tree — so a typo
 *  in a key is a compile error rather than an `undefined` at runtime. */
export type TDevTools = Translations['plugins']['dev_tools'];

// -- shared header actions (scan / from-features / cancel) ---------------------

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
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void state.backfill()}
        disabled={!hasMap || state.loading}
        title={t.uc_backfill_tooltip}
        icon={<Wrench className="w-3 h-3" />}
      >
        {t.uc_backfill}
      </Button>
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
    </>
  );
}

// -- pending-proposal triage strip (shared by both variants) -------------------

export function ProposalStrip({
  proposals,
  onAccept,
  onReject,
  t,
  tx,
}: {
  proposals: DevUseCase[];
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  t: TDevTools;
  tx: (template: string, vars: Record<string, string | number>) => string;
}) {
  if (proposals.length === 0) return null;
  return (
    <div className="mb-2 rounded-modal border border-amber-500/20 bg-amber-500/[0.04] p-2">
      <p className="typo-label text-amber-300/80 mb-1.5 px-1">
        {tx(t.uc_proposals_heading, { count: proposals.length })}
      </p>
      <div className="flex flex-col gap-1">
        {proposals.map((uc) => {
          const meta = kindMeta(uc.kind);
          const Icon = meta.icon;
          return (
            <div
              key={uc.id}
              className="flex items-center gap-2 rounded-input border border-primary/10 bg-card/40 px-2 py-1.5"
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${KIND_TEXT[meta.stem]}`} />
              <span className="typo-body font-medium text-foreground truncate">{uc.name}</span>
              <span className="typo-caption text-foreground/60 tabular-nums shrink-0">
                {tx(t.uc_span_count, { count: uc.context_ids.length })}
              </span>
              {uc.rationale && (
                <span className="typo-caption text-foreground/60 truncate hidden sm:block flex-1">
                  {uc.rationale}
                </span>
              )}
              <span className="flex items-center gap-0.5 shrink-0 ml-auto">
                <Button variant="ghost" size="icon-sm" onClick={() => onAccept(uc.id)} aria-label={t.uc_accept} title={t.uc_accept}>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => onReject(uc.id)} aria-label={t.uc_reject} title={t.uc_reject}>
                  <X className="w-3.5 h-3.5 text-red-400" />
                </Button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

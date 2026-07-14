// Shared building blocks for the Context Ledger (see ContextLedger.tsx).
//
// The ledger fuses the context map and the use-case slice layer into one
// surface. These are its reusable parts — the props contract, the per-kind
// visual language, the per-context coverage cluster, the use-case actions, and
// the pending-proposal triage strip — kept out of the view so each is testable
// and extractable on its own.
import { useState, type ReactNode } from 'react';
import { Check, FileCode2, Info, Layers, Lightbulb, Wrench, Gauge, Target, X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSystemStore } from '@/stores/systemStore';
import { openGoalsBoard } from '@/features/plugins/companion/guidance/appActions';
import type { DevUseCase } from '@/lib/bindings/DevUseCase';
import type { Translations } from '@/i18n/en';

import UseCaseDetailModal from './UseCaseDetailModal';
import { kindMeta, KIND_TEXT } from './useCaseKind';
import type { ContextKpiStatus } from './contextKpiStatus';
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
  /** contextId → worst-wins KPI health; absent = no KPIs (neutral). Drives the
   *  group-row variants' tinting. */
  kpiStatusByContext: Map<string, ContextKpiStatus>;
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
  contextNames,
  t,
  tx,
}: {
  proposals: DevUseCase[];
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  /** contextId → display name, for the detail modal's spanned-context list. */
  contextNames: Map<string, string>;
  t: TDevTools;
  tx: (template: string, vars: Record<string, string | number>) => string;
}) {
  const [detailId, setDetailId] = useState<string | null>(null);

  if (proposals.length === 0) return null;

  const detail = proposals.find((p) => p.id === detailId) ?? null;

  return (
    <div className="mb-2 rounded-modal border border-amber-500/25 p-2">
      <p className="typo-label text-amber-300 mb-1.5 px-1">
        {tx(t.uc_proposals_heading, { count: proposals.length })}
      </p>

      {/* Titles only — everything else (description, rationale, the slice) lives
          one click away in the detail modal, so the queue stays scannable. */}
      <div className="flex flex-col">
        {proposals.map((uc) => {
          const meta = kindMeta(uc.kind);
          const Icon = meta.icon;
          return (
            <div key={uc.id} className="flex items-center gap-2 px-1 py-1 rounded-input hover:bg-secondary/20 transition-colors">
              <Icon className={`w-3.5 h-3.5 shrink-0 ${KIND_TEXT[meta.stem]}`} />
              <button
                type="button"
                onClick={() => setDetailId(uc.id)}
                title={t.uc_view_details}
                className="typo-body font-medium text-foreground truncate text-left hover:text-primary hover:underline underline-offset-2 min-w-0 flex-1"
              >
                {uc.name}
              </button>
              <span className="flex items-center gap-0.5 shrink-0">
                <Button variant="ghost" size="icon-sm" onClick={() => setDetailId(uc.id)} aria-label={t.uc_view_details} title={t.uc_view_details}>
                  <Info className="w-3.5 h-3.5 text-foreground/60" />
                </Button>
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

      <UseCaseDetailModal
        useCase={detail}
        contextNames={contextNames}
        onClose={() => setDetailId(null)}
        onAccept={onAccept}
        onReject={onReject}
      />
    </div>
  );
}

// Re-exported so the ledger keeps a single import site for its vocabulary.
export { kindMeta, KIND_META, KIND_TEXT, KIND_DOT, type KindMeta } from './useCaseKind';

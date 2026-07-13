// Shared scaffolding for the two Context Ledger prototype variants.
//
// Both variants fuse the context map and the use-case slice layer into one
// compact surface. The pieces here are what they have in common — the props
// contract, the per-kind visual language, the per-context coverage chips, and
// the pending-proposal triage strip — so a tweak lands once, not twice.
import type { ReactNode } from 'react';
import { Check, FileCode2, Layers, Lightbulb, Route, Boxes, Plug, Wrench, Gauge, Target, X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { DevUseCase } from '@/lib/bindings/DevUseCase';

import type { ContextGroup } from './contextMapTypes';
import type { UseCasesState } from './useUseCases';

export interface GoalCoverage {
  count: number;
  firstGoalId: string;
}

/** Everything a ledger variant needs — the same data ContextMapPage already
 *  computes for GroupList + UseCasePanel, handed over verbatim. */
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
export const KIND_CHIP: Record<string, string> = {
  violet: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  sky: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
};

// -- per-context coverage chips ------------------------------------------------

interface CoverageChipProps {
  icon: ReactNode;
  count: number;
  label: string;
  stem: 'sky' | 'violet' | 'amber' | 'rose';
}

const COVERAGE_STEM: Record<string, string> = {
  sky: 'text-sky-300',
  violet: 'text-violet-300',
  amber: 'text-amber-300',
  rose: 'text-rose-300',
};

/** One compact metric — an icon + a count, muted to zero when there is none.
 *  The whole row of these is how a context declares "what's attached to me". */
export function CoverageChip({ icon, count, label, stem }: CoverageChipProps) {
  const active = count > 0;
  return (
    <Tooltip content={`${count} ${label}`}>
      <span
        className={`inline-flex items-center gap-1 tabular-nums typo-caption ${
          active ? COVERAGE_STEM[stem] : 'text-foreground/25'
        }`}
      >
        {icon}
        {count}
      </span>
    </Tooltip>
  );
}

/** The standard four-metric coverage cluster for one context. */
export function ContextCoverage({
  fileCount,
  useCaseCount,
  goalCount,
  ideaCount,
  kpiCount,
  t,
}: {
  fileCount: number;
  useCaseCount: number;
  goalCount: number;
  ideaCount: number;
  kpiCount: number;
  t: TDevTools;
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <CoverageChip icon={<FileCode2 className="w-3 h-3" />} count={fileCount} label={t.files} stem="rose" />
      <CoverageChip icon={<Layers className="w-3 h-3" />} count={useCaseCount} label={t.uc_title} stem="sky" />
      <CoverageChip icon={<Target className="w-3 h-3" />} count={goalCount} label="goals" stem="violet" />
      <CoverageChip icon={<Lightbulb className="w-3 h-3" />} count={ideaCount} label="ideas" stem="amber" />
      <CoverageChip icon={<Gauge className="w-3 h-3" />} count={kpiCount} label="KPIs" stem="rose" />
    </span>
  );
}

// The subset of the dev_tools translation object the shared pieces reach for.
// Kept structural (not the full generated type) so the variants can pass
// `t.plugins.dev_tools` straight through.
export interface TDevTools {
  files: string;
  uc_title: string;
  uc_scan: string;
  uc_backfill: string;
  uc_cancel_scan: string;
  uc_scan_tooltip: string;
  uc_backfill_tooltip: string;
  uc_accept: string;
  uc_reject: string;
  uc_proposals_heading: string;
  uc_span_count: string;
  uc_kind_user_flow: string;
  uc_kind_capability: string;
  uc_kind_integration: string;
  uc_kind_ops: string;
  uc_empty_no_map: string;
  [key: string]: string;
}

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

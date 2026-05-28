import { useTranslation } from '@/i18n/useTranslation';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { VerdictBadge } from './VerdictBadge';
import { DimensionBars } from './DimensionBars';
import { GateBreakdown } from './GateBreakdown';
import { GroundingTable } from './GroundingTable';
import { TrajectoryChart } from './TrajectoryChart';
import { JudgePanel } from './JudgePanel';
import type { EvalRunDetail } from '@/lib/bindings/EvalRunDetail';

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col px-3 py-1.5 rounded-card bg-secondary/30 border border-primary/10 min-w-[5rem]">
      <span className="typo-caption text-foreground/55">{label}</span>
      <span className="typo-body text-foreground/90">{children}</span>
    </div>
  );
}

interface RunDetailViewProps {
  detail: EvalRunDetail;
  onBack: () => void;
}

/** Full single-run drill-down. */
export function RunDetailView({ detail, onBack }: RunDetailViewProps) {
  const { t } = useTranslation();
  const c = t.overview.certification;
  const f = detail.facts;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" /> {c.back}
        </Button>
        <RelativeTime timestamp={detail.startedAt} className="typo-caption text-foreground/55" />
      </div>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center flex-wrap gap-3">
          <h2 className="typo-heading-lg text-foreground/90">{detail.team ?? detail.runId}</h2>
          <VerdictBadge verdict={detail.verdict} provisional={detail.provisional} />
          {detail.teamScore != null && (
            <span className="typo-caption text-foreground/60">
              {c.team_score}: <Numeric value={detail.teamScore} unit="plain" className="text-foreground/90" />
            </span>
          )}
        </div>
        {detail.seed && <p className="font-data typo-caption text-foreground/60">{detail.seed}</p>}
        {detail.goal && <p className="typo-body text-foreground/70">{detail.goal}</p>}
      </div>

      {/* Facts */}
      {f && (
        <div className="flex flex-wrap gap-2">
          <Stat label={c.fact_executions}>
            {f.completed ?? 0}/{f.executions ?? 0}
          </Stat>
          {(f.failed ?? 0) > 0 && (
            <Stat label={c.fact_failed}>
              <span className="text-rose-400">{f.failed}</span>
            </Stat>
          )}
          <Stat label={c.fact_members}>{f.memberCount ?? 0}</Stat>
          <Stat label={c.fact_reviews}>{f.reviews ?? 0}</Stat>
          <Stat label={c.fact_memories}>{f.learnedMemories ?? 0}</Stat>
          {detail.costUsd != null && (
            <Stat label={c.fact_cost}>
              <Numeric value={detail.costUsd} unit="usd" precision={2} className="text-foreground/90" />
            </Stat>
          )}
          {detail.windowMin != null && (
            <Stat label={c.fact_window}>{detail.windowMin}m</Stat>
          )}
        </div>
      )}

      {/* Self-veto */}
      {detail.selfVeto && (
        <div className="flex items-center gap-2 rounded-card border border-rose-500/20 bg-rose-500/5 px-3 py-2 typo-caption text-rose-300/90">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>
            {c.self_veto_capped} <strong>{detail.selfVeto.capped ?? '—'}</strong>
            {detail.selfVeto.executions.length > 0 && ` · ${detail.selfVeto.executions.length}`}
          </span>
        </div>
      )}

      {/* Deterministic dimensions */}
      <SectionCard title={c.dims_title} size="md">
        <DimensionBars dims={detail.deterministicDims} />
      </SectionCard>

      {/* Code-track gates + delivered increment */}
      {(detail.codeTrack || detail.deliveredIncrement?.delivered) && (
        <SectionCard title={c.gates_title} size="md">
          <GateBreakdown codeTrack={detail.codeTrack} increment={detail.deliveredIncrement} />
        </SectionCard>
      )}

      {/* Grounding */}
      {detail.grounding.length > 0 && (
        <SectionCard title={c.grounding_title} size="md">
          <GroundingTable grounding={detail.grounding} />
        </SectionCard>
      )}

      {/* Trajectory */}
      {detail.trajectory.length > 1 && (
        <SectionCard title={c.trajectory_title} size="md">
          <TrajectoryChart points={detail.trajectory} />
        </SectionCard>
      )}

      {/* Judge panel */}
      {detail.judge && <JudgePanel judge={detail.judge} />}

      {detail.note && (
        <p className="typo-caption text-foreground/50 italic border-t border-primary/10 pt-3">{detail.note}</p>
      )}
    </div>
  );
}

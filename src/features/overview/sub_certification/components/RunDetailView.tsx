import { useTranslation } from '@/i18n/useTranslation';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { VerdictBadge } from './VerdictBadge';
import { DimensionBars } from './DimensionBars';
import { GateBreakdown } from './GateBreakdown';
import { StandardsCard } from './StandardsCard';
import { GroundingTable } from './GroundingTable';
import { TrajectoryChart } from './TrajectoryChart';
import { JudgePanel } from './JudgePanel';
import type { EvalRunDetail } from '@/lib/bindings/EvalRunDetail';

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col px-3 py-1.5 rounded-card bg-secondary/30 border border-primary/10 min-w-[5rem]">
      <span className="typo-caption text-foreground">{label}</span>
      <span className="typo-body text-foreground/90">{children}</span>
    </div>
  );
}

interface RunDetailViewProps {
  detail: EvalRunDetail;
  onBack: () => void;
  /**
   * One-shot per-section entrance tracker owned by `CertificationCommandCenter`
   * (docs/design/overview-loading.md), keyed by run id — opening a different
   * run replays the ripple, re-rendering the same run does not.
   */
  hasEntered: (id: string) => boolean;
  markEntered: (id: string) => void;
}

/** Full single-run drill-down. */
export function RunDetailView({ detail, onBack, hasEntered, markEntered }: RunDetailViewProps) {
  const { t } = useTranslation();
  const c = t.overview.certification;
  const f = detail.facts;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" /> {c.back}
        </Button>
        <RelativeTime timestamp={detail.startedAt} className="typo-caption text-foreground" />
      </div>

      {/* Header */}
      <RevealItem revealId="header" order={0} hasEntered={hasEntered} markEntered={markEntered} className="space-y-2">
        <div className="flex items-center flex-wrap gap-3">
          <h2 className="typo-heading-lg text-foreground/90">{detail.team ?? detail.runId}</h2>
          <VerdictBadge verdict={detail.verdict} provisional={detail.provisional} />
          {detail.teamScore != null && (
            <span className="typo-caption text-foreground">
              {c.team_score}: <Numeric value={detail.teamScore} unit="plain" className="text-foreground/90" />
            </span>
          )}
        </div>
        {detail.seed && <p className="font-data typo-caption text-foreground">{detail.seed}</p>}
        {detail.goal && <p className="typo-body text-foreground">{detail.goal}</p>}
      </RevealItem>

      {/* Facts */}
      {f && (
        <RevealItem revealId="facts" order={1} hasEntered={hasEntered} markEntered={markEntered} className="flex flex-wrap gap-2">
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
        </RevealItem>
      )}

      {/* Self-veto */}
      {detail.selfVeto && (
        <RevealItem
          revealId="self-veto"
          order={2}
          hasEntered={hasEntered}
          markEntered={markEntered}
          className="flex items-center gap-2 rounded-card border border-rose-500/20 bg-rose-500/5 px-3 py-2 typo-caption text-rose-300/90"
        >
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>
            {c.self_veto_capped} <strong>{detail.selfVeto.capped ?? '—'}</strong>
            {detail.selfVeto.executions.length > 0 && ` · ${detail.selfVeto.executions.length}`}
          </span>
        </RevealItem>
      )}

      {/* Deterministic dimensions */}
      <RevealItem revealId="dims" order={3} hasEntered={hasEntered} markEntered={markEntered}>
        <SectionCard title={c.dims_title} size="md">
          <DimensionBars dims={detail.deterministicDims} />
        </SectionCard>
      </RevealItem>

      {/* Code-track gates + delivered increment */}
      {(detail.codeTrack || detail.deliveredIncrement?.delivered) && (
        <RevealItem revealId="gates" order={4} hasEntered={hasEntered} markEntered={markEntered}>
          <SectionCard title={c.gates_title} size="md">
            <GateBreakdown codeTrack={detail.codeTrack} increment={detail.deliveredIncrement} />
          </SectionCard>
        </RevealItem>
      )}

      {/* Standards & branching compliance (§7) — code-track runs with a policy */}
      {detail.standardsCompliance != null && (
        <RevealItem revealId="standards" order={5} hasEntered={hasEntered} markEntered={markEntered}>
          <SectionCard title={c.standards_title} size="md">
            <StandardsCard compliance={detail.standardsCompliance} />
          </SectionCard>
        </RevealItem>
      )}

      {/* Grounding */}
      {detail.grounding.length > 0 && (
        <RevealItem revealId="grounding" order={6} hasEntered={hasEntered} markEntered={markEntered}>
          <SectionCard title={c.grounding_title} size="md">
            <GroundingTable grounding={detail.grounding} />
          </SectionCard>
        </RevealItem>
      )}

      {/* Trajectory */}
      {detail.trajectory.length > 1 && (
        <RevealItem revealId="trajectory" order={7} hasEntered={hasEntered} markEntered={markEntered}>
          <SectionCard title={c.trajectory_title} size="md">
            <TrajectoryChart points={detail.trajectory} />
          </SectionCard>
        </RevealItem>
      )}

      {/* Judge panel */}
      {detail.judge && (
        <RevealItem revealId="judge" order={8} hasEntered={hasEntered} markEntered={markEntered}>
          <JudgePanel judge={detail.judge} />
        </RevealItem>
      )}

      {detail.note && (
        <RevealItem
          revealId="note"
          order={8}
          hasEntered={hasEntered}
          markEntered={markEntered}
          className="typo-caption text-foreground italic border-t border-primary/10 pt-3"
        >
          {detail.note}
        </RevealItem>
      )}
    </div>
  );
}

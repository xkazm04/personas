// VARIANT A — "Dimension board".
//
// Metaphor: a mission-control board. The project is broken into DIMENSION BANDS
// (Business ← features from the context map · Technical ← platform/LLM/readiness),
// each band a grid of measurable tiles. You read a band left-to-right like a
// status wall: number → trend → verdict → act. Findings live INSIDE the tile of
// the thing they claim to improve — the loop is visible where its number lives,
// not on a separate dashboard.
//
// Distinct from variant B (Strategy ledger) by leading with the MEASUREMENT GRID:
// goals are context chips on tiles here, not the organizing spine.
import { Cpu, Gauge, Layers } from 'lucide-react';

import {
  CockpitHeader, DimensionBand, DispatchStub, EstablishChecklist, FindingLine,
  KpiValue, RatingStars, WiringCta,
} from './cockpitShared';
import { kpiTone, type MockFeature, type MockKpi, type MockProject } from './cockpitMock';

const TONE_EDGE: Record<string, string> = {
  success: 'border-l-emerald-400/50',
  warning: 'border-l-amber-400/60',
  error: 'border-l-red-400/70',
  neutral: 'border-l-primary/15',
};

export default function CockpitDimensionBoard({ project }: { project: MockProject }) {
  if (project.tier === 'bare') {
    return (
      <div className="flex-1 min-h-0 flex flex-col" data-testid="cockpit-board">
        <CockpitHeader project={project} />
        <EstablishChecklist project={project} />
      </div>
    );
  }

  const goalName = (id: string | null) => project.goals.find((g) => g.id === id)?.name ?? null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-6" data-testid="cockpit-board">
      <CockpitHeader project={project} />

      {/* ==================== Business dimension ==================== */}
      <section className="mx-4 mt-4">
        <DimensionBand
          icon={<Layers className="w-3.5 h-3.5" />}
          title="Business"
          hint="features · what users get, measured"
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {project.features.map((f) => (
            <FeatureTile key={f.id} feature={f} goalName={goalName(f.goalId)} />
          ))}
        </div>
      </section>

      {/* ==================== Technical dimension ==================== */}
      <section className="mx-4 mt-5">
        <DimensionBand
          icon={<Cpu className="w-3.5 h-3.5" />}
          title="Technical"
          hint="platform health · cost · readiness"
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {project.technicalKpis.map((k) => (
            <TechTile key={k.id} kpi={k} />
          ))}
        </div>
        {project.technicalFindings.length > 0 && (
          <div className="mt-2 rounded-card border border-primary/10 bg-card/30 px-3 py-1 divide-y divide-primary/5">
            {project.technicalFindings.map((fd) => (
              <FindingLine key={fd.id} finding={fd} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** One feature as a measurable card: KPIs up top, receipts (findings) below. */
function FeatureTile({ feature, goalName }: { feature: MockFeature; goalName: string | null }) {
  // The tile's edge takes the WORST tone among its KPIs — glanceability first.
  const tones = feature.kpis.map(kpiTone);
  const edge = tones.includes('error') ? 'error' : tones.includes('warning') ? 'warning' : tones.includes('success') ? 'success' : 'neutral';

  return (
    <div className={`rounded-card border border-primary/10 border-l-2 ${TONE_EDGE[edge]} bg-card/30 px-3.5 py-3 hover:border-primary/25 transition-colors`}>
      <div className="flex items-center gap-2 min-w-0">
        <span className="typo-body font-medium text-foreground truncate">{feature.name}</span>
        {goalName && (
          <span className="typo-label text-violet-300/80 bg-violet-500/10 border border-violet-500/20 rounded-pill px-1.5 py-0.5 truncate max-w-[150px]" title={`Goal: ${goalName}`}>
            {goalName}
          </span>
        )}
        <span className="ml-auto shrink-0 inline-flex items-center gap-2">
          <RatingStars value={feature.rating} />
          <DispatchStub subtle />
        </span>
      </div>

      {/* the measurable states */}
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {feature.kpis.map((k) => (
          <div key={k.id} className="min-w-0">
            <div className="typo-label text-foreground/45 truncate">{k.name}</div>
            {k.needsWiring ? <WiringCta wiringKey={k.needsWiring} compact /> : <KpiValue kpi={k} />}
          </div>
        ))}
        <div className="min-w-0">
          <div className="typo-label text-foreground/45">LLM cost / 30d</div>
          {feature.costUsd === null
            ? <WiringCta wiringKey="llm" compact />
            : <span className="typo-body font-semibold tabular-nums text-foreground/80">${feature.costUsd}</span>}
        </div>
      </div>

      {/* the receipts */}
      {feature.findings.length > 0 && (
        <div className="mt-2 pt-1 border-t border-primary/5">
          {feature.findings.map((fd) => (
            <FindingLine key={fd.id} finding={fd} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One platform KPI as a vital tile — big numeral, tone-tinted. */
function TechTile({ kpi }: { kpi: MockKpi }) {
  const tone = kpiTone(kpi);
  const bg = tone === 'error' ? 'bg-status-error/10 border-status-error/25'
    : tone === 'warning' ? 'bg-status-warning/10 border-status-warning/25'
      : tone === 'success' ? 'bg-status-success/10 border-status-success/25'
        : 'bg-card/40 border-primary/10';
  return (
    <div className={`rounded-card border ${bg} px-3 py-2.5`}>
      <div className="flex items-center justify-between gap-1 mb-1">
        <Gauge className="w-3.5 h-3.5 text-foreground/40" aria-hidden />
      </div>
      {kpi.needsWiring ? (
        <div className="h-[1.9rem] flex items-center"><WiringCta wiringKey={kpi.needsWiring} compact /></div>
      ) : (
        <KpiValue kpi={kpi} size="lg" />
      )}
      <p className="typo-caption text-foreground/60 truncate mt-1">{kpi.name}</p>
    </div>
  );
}

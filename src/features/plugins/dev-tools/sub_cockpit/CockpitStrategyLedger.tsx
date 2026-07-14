// VARIANT B — "Strategy ledger".
//
// Metaphor: the strategy, with its receipts. One indented, scannable hierarchy —
//   GOAL  →  KPI (the measurable promise)  →  feature  →  finding (the receipt)
// — read top-to-bottom like a ledger. Every row ends in a NUMBER on the right
// rail (measurement before opinion), and the loop's verdicts sit directly under
// the goal they serve, so "did the number move?" is answered in the same breath
// as "what are we trying to achieve?".
//
// Distinct from variant A (Dimension board) by making GOALS the organizing spine:
// dimensions are implicit (a goal owns business and technical rows alike), and the
// grammar leans on the Context Ledger's indented cross-tab the app already knows.
import { ChevronRight, Cpu, Layers, Target } from 'lucide-react';

import {
  CockpitHeader, DispatchStub, EstablishChecklist, FindingLine, KpiValue,
  RatingStars, WiringCta,
} from './cockpitShared';
import type { MockFeature, MockKpi, MockProject } from './cockpitMock';

export default function CockpitStrategyLedger({ project }: { project: MockProject }) {
  if (project.tier === 'bare') {
    return (
      <div className="flex-1 min-h-0 flex flex-col" data-testid="cockpit-ledger">
        <CockpitHeader project={project} />
        <EstablishChecklist project={project} />
      </div>
    );
  }

  // Group the world under its goals; whatever no goal claims lands in a
  // deliberately-uncomfortable "Unassigned" band (a gap the user should feel).
  const featuresByGoal = new Map<string, MockFeature[]>();
  const orphans: MockFeature[] = [];
  for (const f of project.features) {
    if (f.goalId && project.goals.some((g) => g.id === f.goalId)) {
      const list = featuresByGoal.get(f.goalId) ?? [];
      list.push(f);
      featuresByGoal.set(f.goalId, list);
    } else {
      orphans.push(f);
    }
  }
  // Technical rows serve the "Platform health" goal when one exists.
  const platformGoal = project.goals.find((g) => /platform|health/i.test(g.name)) ?? null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-6" data-testid="cockpit-ledger">
      <CockpitHeader project={project} />

      <div className="mx-4 mt-4 rounded-card border border-primary/10 bg-card/20 overflow-hidden">
        {project.goals.map((g) => {
          const isPlatform = platformGoal?.id === g.id;
          const feats = featuresByGoal.get(g.id) ?? [];
          return (
            <section key={g.id} className="border-b border-primary/10 last:border-b-0">
              {/* GOAL row — the strategic promise + its progress */}
              <div className="flex items-center gap-2.5 px-3.5 py-2 bg-secondary/15">
                <Target className="w-3.5 h-3.5 text-violet-300 shrink-0" aria-hidden />
                <span className="typo-body font-medium text-foreground truncate">{g.name}</span>
                <div className="ml-auto shrink-0 inline-flex items-center gap-2">
                  <div className="w-24 h-1.5 rounded-full bg-primary/10 overflow-hidden">
                    <div className="h-full rounded-full bg-violet-400/70" style={{ width: `${g.progressPct}%` }} />
                  </div>
                  <span className="typo-label text-foreground/50 tabular-nums">{g.progressPct}%</span>
                </div>
              </div>

              {/* business children */}
              {feats.map((f) => (
                <FeatureRows key={f.id} feature={f} />
              ))}

              {/* technical children under the platform goal */}
              {isPlatform && (
                <>
                  {project.technicalKpis.map((k) => (
                    <KpiRow key={k.id} kpi={k} icon={<Cpu className="w-3 h-3 text-foreground/35" aria-hidden />} depth={1} />
                  ))}
                  {project.technicalFindings.map((fd) => (
                    <div key={fd.id} className="px-3.5 border-t border-primary/5 bg-primary/[0.015]">
                      <FindingLine finding={fd} indent />
                    </div>
                  ))}
                </>
              )}
            </section>
          );
        })}

        {/* what no strategy claims — a felt gap, not a hidden one */}
        {orphans.length > 0 && (
          <section>
            <div className="flex items-center gap-2.5 px-3.5 py-2 bg-secondary/10">
              <Target className="w-3.5 h-3.5 text-foreground/25 shrink-0" aria-hidden />
              <span className="typo-caption text-foreground/50 italic">No goal claims these — should one?</span>
            </div>
            {orphans.map((f) => (
              <FeatureRows key={f.id} feature={f} />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

/** A feature row + its KPI children + its finding receipts. */
function FeatureRows({ feature }: { feature: MockFeature }) {
  return (
    <>
      <div className="flex items-center gap-2 px-3.5 py-1.5 border-t border-primary/5 hover:bg-secondary/10 transition-colors">
        <ChevronRight className="w-3 h-3 text-foreground/25 shrink-0" aria-hidden />
        <Layers className="w-3 h-3 text-sky-300/70 shrink-0" aria-hidden />
        <span className="typo-caption font-medium text-foreground truncate">{feature.name}</span>
        <RatingStars value={feature.rating} />
        <span className="ml-auto shrink-0 inline-flex items-center gap-2.5">
          {feature.costUsd === null
            ? <WiringCta wiringKey="llm" compact />
            : <span className="typo-label text-foreground/50 tabular-nums" title="LLM cost / 30d">${feature.costUsd}/30d</span>}
          <DispatchStub subtle />
        </span>
      </div>
      {feature.kpis.map((k) => (
        <KpiRow key={k.id} kpi={k} depth={2} />
      ))}
      {feature.findings.map((fd) => (
        <div key={fd.id} className="px-3.5 border-t border-primary/5 bg-primary/[0.015]">
          <FindingLine finding={fd} indent />
        </div>
      ))}
    </>
  );
}

/** One measurable promise: name on the left, THE NUMBER on the right rail. */
function KpiRow({ kpi, depth = 1, icon }: { kpi: MockKpi; depth?: number; icon?: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-2 px-3.5 py-1 border-t border-primary/5"
      style={{ paddingLeft: `${14 + depth * 18}px` }}
    >
      {icon}
      <span className="typo-caption text-foreground/65 truncate">{kpi.name}</span>
      <span className="ml-auto shrink-0">
        {kpi.needsWiring ? <WiringCta wiringKey={kpi.needsWiring} compact /> : <KpiValue kpi={kpi} />}
      </span>
    </div>
  );
}

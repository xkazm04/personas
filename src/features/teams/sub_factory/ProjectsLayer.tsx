// Shared L1 for all variants — the projects overview, derived from Flow's
// cards. Per round-3 feedback: score-led stats per project, NO specific KPI
// names (there are too many per project to surface here). The hero is the
// health score; the name + stats are secondary tiers.
import { STATUS_COLOR, rollup, projectKpis, type MockKpi } from './factoryMock';
import { HealthBar, TrafficTally } from './factoryPrimitives';
import { useFactoryData } from './factoryData';

export function ProjectsLayer({ onOpen, ed = (k) => k }: { onOpen: (id: string) => void; ed?: (k: MockKpi) => MockKpi }) {
  const { projects, loading, error } = useFactoryData();

  if (loading) return <div className="flex items-center justify-center py-16 typo-caption">Loading live KPI data…</div>;
  if (error) {
    return (
      <div className="rounded-card border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 p-4">
        <p className="typo-title mb-1">Couldn't load dev-tools data</p>
        <p className="typo-caption">{error}</p>
      </div>
    );
  }
  if (projects.length === 0) {
    return (
      <div className="rounded-card border border-primary/15 bg-secondary/10 p-8 text-center">
        <p className="typo-title-lg mb-1">No projects yet</p>
        <p className="typo-caption">Register a project in Dev-Tools and scan its context map to populate the Factory.</p>
      </div>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {projects.map((p) => {
        const all = projectKpis(p).map(ed);
        const r = rollup(all);
        const contexts = p.groups.reduce((n, g) => n + g.contexts.length, 0);
        const color = r.health >= 70 ? STATUS_COLOR.met : r.health >= 40 ? STATUS_COLOR.warn : STATUS_COLOR.crit;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onOpen(p.id)}
            className="text-left rounded-card border border-primary/15 bg-secondary/10 hover:border-primary/40 hover:bg-secondary/20 transition-colors p-4"
          >
            <div className="flex items-start justify-between gap-3 mb-1">
              <div className="min-w-0">
                <h3 className="typo-title-lg truncate">{p.name}</h3>
                <p className="typo-caption truncate">{p.stack}</p>
              </div>
              <div className="text-right leading-none">
                <span className="typo-data-lg tabular-nums" style={{ color }}>{r.health}</span>
                <span className="block typo-label text-foreground/50 mt-1">health</span>
              </div>
            </div>
            <HealthBar value={r.health} className="mt-2" />
            <div className="flex items-center justify-between mt-3">
              <TrafficTally kpis={all} />
              <div className="flex items-center gap-3">
                <Stat n={p.groups.length} label="groups" />
                <Stat n={contexts} label="contexts" />
                <Stat n={all.length} label="KPIs" />
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="typo-data text-foreground">{n}</span>
      <span className="typo-caption">{label}</span>
    </span>
  );
}

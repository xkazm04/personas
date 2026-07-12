/**
 * AssignmentMatrix — the Layer-1 projects × connectors assignment matrix,
 * generic over the binding (LLM-observability or app-monitoring). The top strip
 * answers "how much of my fleet is wired, and on which tools?" (a coverage meter
 * + per-tool tally); below, projects are brand-badged tiles with the un-wired
 * ones flagged as gaps. Wiring a project calls the caller's `assign`.
 */
import { useMemo } from 'react';
import { Gauge } from 'lucide-react';
import {
  connectorBrand,
  assignedCred,
  ConnectorChip,
  ConnectorSocket,
  type AssignmentMatrixProps,
} from './matrixShared';

export default function AssignmentMatrix({
  projects,
  creds,
  getCredId,
  assign,
  labels,
  testIdPrefix = 'assign',
  testId = 'assignment-matrix',
}: AssignmentMatrixProps) {
  const wired = projects.filter((p) => getCredId(p));
  const pct = projects.length ? Math.round((wired.length / projects.length) * 100) : 0;

  const tallies = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of wired) {
      const c = assignedCred(p, creds, getCredId);
      if (c) {
        const key = c.serviceType.toLowerCase();
        m.set(key, (m.get(key) ?? 0) + 1);
      }
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [wired, creds, getCredId]);

  return (
    <div
      className="mx-4 mt-3 rounded-card border border-primary/10 bg-secondary/40 overflow-hidden"
      data-testid={testId}
    >
      {/* Coverage strip */}
      <div className="px-4 py-3 border-b border-primary/10">
        <div className="flex items-center gap-2.5">
          <Gauge className="w-4 h-4 text-status-success" />
          <span className="typo-heading text-foreground">
            {wired.length}
            <span className="text-foreground/40">/{projects.length}</span>
          </span>
          <span className="typo-caption text-foreground/60">{labels.coverage}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {tallies.map(([svc, n]) => {
              const b = connectorBrand(svc);
              return (
                <span
                  key={svc}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-primary/10 bg-background/40 text-[11px]"
                  title={`${b.label}: ${n}`}
                >
                  {b.iconUrl ? (
                    <img src={b.iconUrl} alt="" className="w-3 h-3 rounded-[2px] object-contain" />
                  ) : null}
                  <span className="text-foreground/70">{n}</span>
                </span>
              );
            })}
          </div>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-primary/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-status-success/60 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Project tiles */}
      <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {projects.map((p) => {
          const cred = assignedCred(p, creds, getCredId);
          const brand = cred ? connectorBrand(cred.serviceType) : null;
          return (
            <div
              key={p.id}
              className="rounded-modal border border-primary/10 bg-gradient-to-br from-card/60 to-card/20 px-3 py-2 transition-[border-color,box-shadow] duration-200 hover:border-primary/25 hover:shadow-elevation-2"
              style={brand ? { boxShadow: `inset 2px 0 0 ${brand.color}` } : undefined}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="typo-caption text-foreground truncate flex-1 min-w-0">{p.name}</span>
                {cred ? (
                  <ConnectorChip
                    serviceType={cred.serviceType}
                    className="text-[11px] text-foreground/70 shrink-0 max-w-[120px]"
                  />
                ) : (
                  <span className="text-[10px] uppercase tracking-wide text-status-warning shrink-0">{labels.gap}</span>
                )}
              </div>
              <ConnectorSocket
                value={getCredId(p)}
                creds={creds}
                onChange={(id) => assign(p.id, id)}
                testId={`${testIdPrefix}-${p.id}`}
                placeholder={labels.wirePlaceholder}
                notWiredLabel={labels.notWired}
                className="mt-1.5 block w-full"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

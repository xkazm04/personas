// Context Rollup — the third KPIs view (Part 3 context-level KPIs). Organizes
// a project's KPIs by the context map: project-level → context groups →
// individual contexts. Reuses the shared pace math (kpiMath) + track colors;
// every KPI row click-throughs to the detail drawer like the chart dashboard.
// Scoped to the header's active project (the LifecycleProjectPicker).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Gauge, Layers } from 'lucide-react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevContext } from '@/lib/bindings/DevContext';
import type { DevContextGroup } from '@/lib/bindings/DevContextGroup';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { kpiTrack, sparklinePoints } from './kpiMath';
import { TRACK_COLOR } from './kpiMeta';

/** Push `v` onto the array stored at `key`, creating it on first use. */
function pushTo<T>(m: Map<string, T[]>, key: string, v: T): void {
  const arr = m.get(key);
  if (arr) arr.push(v);
  else m.set(key, [v]);
}

function trackCounts(list: DevKpi[]): { onTrack: number; total: number } {
  let onTrack = 0;
  for (const k of list) {
    const tr = kpiTrack(k);
    if (tr === 'on-track' || tr === 'met') onTrack += 1;
  }
  return { onTrack, total: list.length };
}

export function ContextKpiDashboard({ onOpen }: { onOpen: (kpiId: string) => void }) {
  const { t, tx } = useTranslation();
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const kpis = useSystemStore((s) => s.kpis);
  const contexts = useSystemStore((s) => s.contexts);
  const contextGroups = useSystemStore((s) => s.contextGroups);
  const kpiTrends = useSystemStore((s) => s.kpiTrends);
  const fetchContexts = useSystemStore((s) => s.fetchContexts);
  const fetchContextGroups = useSystemStore((s) => s.fetchContextGroups);
  const fetchKpiTrends = useSystemStore((s) => s.fetchKpiTrends);

  useEffect(() => {
    if (!activeProjectId) return;
    void fetchContextGroups(activeProjectId);
    void fetchContexts(activeProjectId);
  }, [activeProjectId, fetchContextGroups, fetchContexts]);

  const projectKpis = useMemo(
    () => kpis.filter((k) => k.project_id === activeProjectId && k.status !== 'archived'),
    [kpis, activeProjectId],
  );

  // Sparklines need the measurement series for this project's active KPIs.
  const activeIdsKey = useMemo(
    () => projectKpis.filter((k) => k.status === 'active').map((k) => k.id).join(','),
    [projectKpis],
  );
  useEffect(() => {
    if (activeIdsKey) void fetchKpiTrends(activeIdsKey.split(','));
  }, [activeIdsKey, fetchKpiTrends]);

  const { byContext, byGroup, projectLevel } = useMemo(() => {
    const byContext = new Map<string, DevKpi[]>();
    const byGroup = new Map<string, DevKpi[]>(); // group KPIs WITHOUT a context_id
    const projectLevel: DevKpi[] = [];
    for (const k of projectKpis) {
      if (k.context_id) pushTo(byContext, k.context_id, k);
      else if (k.context_group_id) pushTo(byGroup, k.context_group_id, k);
      else projectLevel.push(k);
    }
    return { byContext, byGroup, projectLevel };
  }, [projectKpis]);

  const groupsSorted = useMemo(
    () => [...contextGroups].sort((a, b) => a.position - b.position),
    [contextGroups],
  );
  const ungroupedWithKpis = useMemo(
    () => contexts.filter((c) => c.group_id == null && (byContext.get(c.id)?.length ?? 0) > 0),
    [contexts, byContext],
  );

  if (!activeProjectId) {
    return <EmptyState icon={Gauge} title={t.kpis.rollup_pick_project} />;
  }
  if (contextGroups.length === 0 && contexts.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title={t.kpis.rollup_empty_title}
        description={t.kpis.rollup_empty_hint}
      />
    );
  }

  return (
    <div className="space-y-3" data-testid="kpi-context-rollup">
      {projectLevel.length > 0 && (
        <Section
          title={t.kpis.rollup_project_level}
          icon={<Gauge className="w-3.5 h-3.5 text-muted-foreground" />}
          kpis={projectLevel}
          trends={kpiTrends}
          onOpen={onOpen}
          t={t}
          tx={tx}
        />
      )}

      {groupsSorted.map((g) => (
        <GroupSection
          key={g.id}
          group={g}
          groupKpis={byGroup.get(g.id) ?? []}
          contexts={contexts.filter((c) => c.group_id === g.id)}
          byContext={byContext}
          trends={kpiTrends}
          onOpen={onOpen}
          t={t}
          tx={tx}
        />
      ))}

      {ungroupedWithKpis.length > 0 && (
        <div className="rounded-card border border-primary/15 bg-secondary/10 p-3">
          <h3 className="typo-overline text-muted-foreground mb-2">{t.kpis.rollup_ungrouped}</h3>
          <div className="space-y-2">
            {ungroupedWithKpis.map((c) => (
              <ContextBlock
                key={c.id}
                context={c}
                kpis={byContext.get(c.id) ?? []}
                trends={kpiTrends}
                onOpen={onOpen}
                t={t}
                tx={tx}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// -- pieces ------------------------------------------------------------------

type Tx = (template: string, vars: Record<string, string | number>) => string;
type T = ReturnType<typeof useTranslation>['t'];

function KpiRow({
  kpi,
  trend,
  onOpen,
}: {
  kpi: DevKpi;
  trend: DevKpiMeasurement[];
  onOpen: (id: string) => void;
}) {
  const track = kpiTrack(kpi);
  const color = TRACK_COLOR[track];
  const pts = sparklinePoints(trend, 72, 20);
  return (
    <button
      type="button"
      onClick={() => onOpen(kpi.id)}
      className="w-full flex items-center gap-2.5 rounded-interactive border border-primary/10 bg-secondary/15 hover:bg-secondary/30 transition-colors px-2.5 py-1.5 text-left"
      data-testid={`rollup-kpi-${kpi.id}`}
    >
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
      <span className="typo-caption text-foreground font-medium truncate flex-1">{kpi.name}</span>
      {pts && (
        <svg width={72} height={20} className="flex-shrink-0" aria-hidden="true">
          <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
        </svg>
      )}
      <span className="typo-caption text-muted-foreground tabular-nums flex-shrink-0">
        {kpi.current_value ?? '—'} / {kpi.target_value ?? '—'} {kpi.unit}
      </span>
    </button>
  );
}

function CountBadge({ n, t, tx }: { n: number; t: T; tx: Tx }) {
  return (
    <span className="inline-flex items-center gap-1 typo-caption text-muted-foreground tabular-nums">
      <Gauge className="w-3 h-3" />
      {tx(t.kpis.kpi_count, { count: n })}
    </span>
  );
}

/** Flat KPI section with a header (project-level + context blocks reuse this). */
function Section({
  title,
  icon,
  kpis,
  trends,
  onOpen,
  t,
  tx,
}: {
  title: string;
  icon?: ReactNode;
  kpis: DevKpi[];
  trends: Record<string, DevKpiMeasurement[]>;
  onOpen: (id: string) => void;
  t: T;
  tx: Tx;
}) {
  const { onTrack, total } = trackCounts(kpis);
  return (
    <div className="rounded-card border border-primary/15 bg-secondary/10 p-3">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="typo-overline text-foreground flex-1">{title}</h3>
        {total > 0 && (
          <span className="typo-caption text-muted-foreground tabular-nums">
            {tx(t.kpis.section_rollup, { onTrack, total })}
          </span>
        )}
        <CountBadge n={total} t={t} tx={tx} />
      </div>
      <div className="space-y-1.5">
        {kpis.map((k) => (
          <KpiRow key={k.id} kpi={k} trend={trends[k.id] ?? []} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

/** A single context's KPIs under a group. */
function ContextBlock({
  context,
  kpis,
  trends,
  onOpen,
  t,
  tx,
}: {
  context: DevContext;
  kpis: DevKpi[];
  trends: Record<string, DevKpiMeasurement[]>;
  onOpen: (id: string) => void;
  t: T;
  tx: Tx;
}) {
  return (
    <div className="rounded-interactive border border-primary/10 bg-background/40 p-2">
      <div className="flex items-center gap-2 mb-1.5 pl-0.5">
        <span className="typo-caption text-foreground font-medium truncate flex-1">{context.name}</span>
        {context.category && (
          <span className="typo-caption text-muted-foreground rounded-full border border-primary/15 px-1.5 py-0.5">
            {context.category}
          </span>
        )}
        <CountBadge n={kpis.length} t={t} tx={tx} />
      </div>
      <div className="space-y-1.5">
        {kpis.map((k) => (
          <KpiRow key={k.id} kpi={k} trend={trends[k.id] ?? []} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

/** Collapsible group card: group-level KPIs + its contexts' KPIs. */
function GroupSection({
  group,
  groupKpis,
  contexts,
  byContext,
  trends,
  onOpen,
  t,
  tx,
}: {
  group: DevContextGroup;
  groupKpis: DevKpi[];
  contexts: DevContext[];
  byContext: Map<string, DevKpi[]>;
  trends: Record<string, DevKpiMeasurement[]>;
  onOpen: (id: string) => void;
  t: T;
  tx: Tx;
}) {
  const contextsWithKpis = contexts.filter((c) => (byContext.get(c.id)?.length ?? 0) > 0);
  const allKpis = [...groupKpis, ...contextsWithKpis.flatMap((c) => byContext.get(c.id) ?? [])];
  const { onTrack, total } = trackCounts(allKpis);
  const emptyContexts = contexts.length - contextsWithKpis.length;

  // Default open when the group has any KPIs, so the user lands on signal.
  const [open, setOpen] = useState(total > 0);

  return (
    <div className="rounded-card border border-primary/15 bg-secondary/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-secondary/20 transition-colors rounded-card"
        aria-expanded={open}
        data-testid={`rollup-group-${group.id}`}
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: group.color }} />
        <span className="typo-body-sm text-foreground font-medium truncate">{group.name}</span>
        {group.domain && (
          <span className="typo-caption text-muted-foreground rounded-full border border-primary/15 px-1.5 py-0.5">
            {group.domain}
          </span>
        )}
        <div className="flex-1" />
        {total > 0 && (
          <span className="typo-caption text-muted-foreground tabular-nums">
            {tx(t.kpis.section_rollup, { onTrack, total })}
          </span>
        )}
        <CountBadge n={total} t={t} tx={tx} />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {groupKpis.length > 0 && (
            <div className="space-y-1.5">
              {groupKpis.map((k) => (
                <KpiRow key={k.id} kpi={k} trend={trends[k.id] ?? []} onOpen={onOpen} />
              ))}
            </div>
          )}
          {contextsWithKpis.map((c) => (
            <ContextBlock
              key={c.id}
              context={c}
              kpis={byContext.get(c.id) ?? []}
              trends={trends}
              onOpen={onOpen}
              t={t}
              tx={tx}
            />
          ))}
          {total === 0 && (
            <p className="typo-caption text-muted-foreground px-1 py-2">{t.kpis.rollup_no_kpis_here}</p>
          )}
          {emptyContexts > 0 && (
            <p className="typo-caption text-muted-foreground/70 px-1">
              {tx(t.kpis.rollup_uncovered, { count: emptyContexts })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

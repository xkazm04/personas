// Real-data adapter for the Factory. Replaces the mock with live dev_tools data
// so we can develop against real projects/KPIs. Fetches projects + their context
// groups/contexts + KPIs + measurement series, and maps them into the Factory's
// view model (the same MockProject/MockKpi shape the layers already consume).
//
// Thresholds (warn/crit) and manual rating don't exist on real KPIs yet, so we
// DERIVE sensible threshold bands for display — the calibration console can
// re-tune them locally (persisting them back to the schema is a later step).
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import * as devApi from '@/api/devTools/devTools';
import * as kpiApi from '@/api/devTools/kpis';
import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';
import type { DevContextGroup } from '@/lib/bindings/DevContextGroup';
import type { DevContext } from '@/lib/bindings/DevContext';

import type {
  MockProject,
  MockGroup,
  MockContext,
  MockKpi,
  KpiCategory,
  KpiTier,
  MeasureKind,
  GroupDomain,
  ContextCategory,
} from './factoryMock';

// -- mapping ------------------------------------------------------------------

const CONTEXT_CATS: ContextCategory[] = ['ui', 'api', 'lib', 'data', 'test', 'config'];
const KPI_CATS: KpiCategory[] = ['technical', 'quality', 'traffic', 'value'];
const TIERS: KpiTier[] = ['north_star', 'primary', 'supporting'];
const KINDS: MeasureKind[] = ['codebase', 'connector', 'manual', 'derived'];
const DOMAINS: GroupDomain[] = ['feature', 'infrastructure', 'shared', 'integration', 'data'];

function rel(iso: string | null): string {
  if (!iso) return 'never';
  const t = new Date(iso.replace(' ', 'T')).getTime();
  if (!Number.isFinite(t)) return '—';
  const mins = Math.max(0, (Date.now() - t) / 60000);
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.round(hrs)}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** "agent-deployment" → "Agent deployment". */
function humanize(s: string): string {
  return s.replace(/[-_]+/g, ' ').replace(/^\s*\w/, (c) => c.toUpperCase()).trim();
}
/** Readable context name: the human business feature, else a de-kebabbed id. */
function contextDisplayName(c: DevContext): string {
  const bf = c.business_feature?.trim();
  return bf && bf.length > 0 ? bf : humanize(c.name);
}

function toKpi(k: DevKpi, series: number[]): MockKpi {
  const baseline = k.baseline_value ?? k.current_value ?? 0;
  const target = k.target_value ?? (baseline || 1);
  const spanAbs = Math.abs(target - baseline) || Math.abs(target) || 1;
  const up = k.direction !== 'down';
  // Persisted thresholds win; else derive (worse-than-baseline = red, a third
  // toward target = yellow).
  const critAt = k.crit_at ?? Math.round((up ? baseline - spanAbs * 0.1 : baseline + spanAbs * 0.1) * 100) / 100;
  const warnAt = k.warn_at ?? Math.round((up ? baseline + spanAbs * 0.35 : baseline - spanAbs * 0.35) * 100) / 100;
  return {
    id: k.id,
    name: k.name,
    category: (KPI_CATS.includes(k.category as KpiCategory) ? k.category : 'technical') as KpiCategory,
    tier: (TIERS.includes(k.tier as KpiTier) ? k.tier : 'supporting') as KpiTier,
    measureKind: (KINDS.includes(k.measure_kind as MeasureKind) ? k.measure_kind : 'manual') as MeasureKind,
    unit: k.unit ?? '',
    direction: up ? 'up' : 'down',
    baseline,
    current: k.current_value,
    target,
    warnAt,
    critAt,
    cadence: (['daily', 'weekly', 'manual'].includes(k.cadence) ? k.cadence : 'manual') as 'daily' | 'weekly' | 'manual',
    manualRating: k.manual_rating ?? null,
    pros: k.assessment_pros ?? null,
    cons: k.assessment_cons ?? null,
    measureConfig: k.measure_config,
    lastMeasuredAt: rel(k.last_measured_at),
    series,
  };
}

/** Assemble one project's full tree. KPIs are placed under their context
 *  (context_id); group-level / project-level KPIs get synthetic context rows so
 *  nothing is hidden from the matrix. */
function assembleProject(
  project: { id: string; name: string; tech_stack: string | null },
  groups: DevContextGroup[],
  contexts: DevContext[],
  kpis: DevKpi[],
  seriesByKpi: Map<string, number[]>,
): MockProject {
  const kpi = (k: DevKpi) => toKpi(k, seriesByKpi.get(k.id) ?? []);
  const byContext = new Map<string, MockKpi[]>();
  const byGroupOnly = new Map<string, MockKpi[]>();
  const projectLevel: MockKpi[] = [];
  for (const k of kpis) {
    if (k.context_id) (byContext.get(k.context_id) ?? byContext.set(k.context_id, []).get(k.context_id)!).push(kpi(k));
    else if (k.context_group_id) (byGroupOnly.get(k.context_group_id) ?? byGroupOnly.set(k.context_group_id, []).get(k.context_group_id)!).push(kpi(k));
    else projectLevel.push(kpi(k));
  }

  const mockGroups: MockGroup[] = groups.map((g) => {
    const ctxs: MockContext[] = contexts
      .filter((c) => c.group_id === g.id)
      .map((c) => ({
        id: c.id,
        name: contextDisplayName(c),
        category: (CONTEXT_CATS.includes(c.category as ContextCategory) ? c.category : 'lib') as ContextCategory,
        kpis: byContext.get(c.id) ?? [],
      }));
    const groupKpis = byGroupOnly.get(g.id) ?? [];
    if (groupKpis.length > 0) ctxs.unshift({ id: `${g.id}__group`, name: '(group-level)', category: 'lib', kpis: groupKpis });
    return {
      id: g.id,
      name: g.name,
      domain: (g.domain && DOMAINS.includes(g.domain as GroupDomain) ? g.domain : 'feature') as GroupDomain,
      color: g.color || '#6366f1',
      contexts: ctxs,
    };
  });

  // ungrouped contexts
  const ungrouped = contexts.filter((c) => c.group_id == null);
  if (ungrouped.length > 0) {
    mockGroups.push({
      id: `${project.id}__ungrouped`,
      name: '(ungrouped)',
      domain: 'shared',
      color: '#64748b',
      contexts: ungrouped.map((c) => ({
        id: c.id,
        name: contextDisplayName(c),
        category: (CONTEXT_CATS.includes(c.category as ContextCategory) ? c.category : 'lib') as ContextCategory,
        kpis: byContext.get(c.id) ?? [],
      })),
    });
  }
  // project-level KPIs
  if (projectLevel.length > 0) {
    mockGroups.unshift({
      id: `${project.id}__project`,
      name: '(project-level)',
      domain: 'shared',
      color: '#a855f7',
      contexts: [{ id: `${project.id}__project_ctx`, name: 'project KPIs', category: 'lib', kpis: projectLevel }],
    });
  }

  return { id: project.id, name: project.name, stack: project.tech_stack ?? '', groups: mockGroups };
}

// -- provider -----------------------------------------------------------------

interface FactoryData {
  projects: MockProject[];
  loading: boolean;
  error: string | null;
}

const FactoryDataContext = createContext<FactoryData>({ projects: [], loading: true, error: null });

export function useFactoryData(): FactoryData {
  return useContext(FactoryDataContext);
}

export function FactoryDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<FactoryData>({ projects: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [projects, allKpis] = await Promise.all([devApi.listProjects(), kpiApi.listAllKpis()]);
        // Measurement series for sparklines (bounded per KPI).
        const ids = allKpis.map((k) => k.id);
        const measurements: DevKpiMeasurement[] = ids.length ? await kpiApi.listKpiMeasurementsBulk(ids, 20) : [];
        const seriesByKpi = new Map<string, number[]>();
        for (const m of measurements) (seriesByKpi.get(m.kpi_id) ?? seriesByKpi.set(m.kpi_id, []).get(m.kpi_id)!).push(m.value);
        for (const [, arr] of seriesByKpi) arr.reverse(); // bulk is newest-first → oldest→newest

        const perProject = await Promise.all(
          projects.map(async (p) => {
            const [groups, contexts] = await Promise.all([devApi.listContextGroups(p.id), devApi.listContexts(p.id)]);
            const pk = allKpis.filter((k) => k.project_id === p.id);
            return assembleProject(p, groups, contexts, pk, seriesByKpi);
          }),
        );
        if (!cancelled) setData({ projects: perProject, loading: false, error: null });
      } catch (err) {
        if (!cancelled) setData({ projects: [], loading: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return <FactoryDataContext.Provider value={data}>{children}</FactoryDataContext.Provider>;
}

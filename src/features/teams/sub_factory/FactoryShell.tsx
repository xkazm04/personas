// Drill-down shell shared by every variant. Owns the navigation state and the
// three shared layers (L1 ProjectsLayer, L3 GroupKpiLayer, L4 KpiConsole) and
// the keyed fade-slide transition between layers. Variants supply ONLY the L2
// group/context overview (via renderGroups) + the L3 table look (bar/density) —
// that's the surface we're still exploring.
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { saveKpiAssessment } from '@/api/devTools/kpis';

import { projectKpis, applyEdit, type KpiEdit, type MockKpi, type MockProject } from './factoryMock';
import { Breadcrumb } from './factoryPrimitives';
import { AttentionBand } from './AttentionBand';
import { ProjectsLayer } from './ProjectsLayer';
import { GroupKpiLayer } from './GroupKpiLayer';
import { KpiConsole } from './KpiConsole';
import { useFactoryData } from './factoryData';

export interface GroupsRenderArgs {
  project: MockProject;
  ed: (k: MockKpi) => MockKpi;
  /** Drill into a context group's KPI table (L3), optionally filtered to one context. */
  openGroup: (groupId: string, contextId: string | null) => void;
  /** Jump straight to a single KPI's console (L4) from the L2 matrix. */
  openKpi: (groupId: string, kpiId: string) => void;
}

export function FactoryShell({
  renderGroups,
  bar = 'bar',
  density = 'comfortable',
  testid,
}: {
  renderGroups: (args: GroupsRenderArgs) => ReactNode;
  bar?: 'bar' | 'segments' | 'meter';
  density?: 'compact' | 'comfortable' | 'spacious';
  testid?: string;
}) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [contextFilter, setContextFilter] = useState<string | null>(null);
  const [kpiId, setKpiId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, KpiEdit>>({});
  const ed = (k: MockKpi) => applyEdit(k, edits[k.id]);

  // Persist the open KPI's calibration + assessment edits to dev_kpis (debounced).
  useEffect(() => {
    if (!kpiId) return;
    const e = edits[kpiId];
    if (!e) return;
    const t = setTimeout(() => {
      void saveKpiAssessment(kpiId, {
        warnAt: e.warnAt,
        critAt: e.critAt,
        manualRating: e.rating,
        pros: e.pros,
        cons: e.cons,
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [kpiId, edits]);

  const { projects } = useFactoryData();
  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId]);
  const group = useMemo(() => project?.groups.find((g) => g.id === groupId) ?? null, [project, groupId]);
  const kpi = useMemo(() => {
    if (!project || !group || !kpiId) return null;
    const f = projectKpis(project).find((k) => k.id === kpiId);
    return f ? ed(f) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, group, kpiId, edits]);

  const openGroup = (gid: string, cid: string | null) => { setGroupId(gid); setContextFilter(cid); setKpiId(null); };
  const openKpi = (gid: string, kid: string) => { setGroupId(gid); setContextFilter(null); setKpiId(kid); };
  // Deep-link straight to a KPI's console from the cross-project attention band
  // (sets all three nav levels at once, skipping the drill-down).
  const jumpToKpi = (pid: string, gid: string, kid: string) => {
    setProjectId(pid); setGroupId(gid); setContextFilter(null); setKpiId(kid);
  };

  let layerKey = 'projects';
  let content: ReactNode;

  if (project && group && kpi) {
    layerKey = `console:${kpi.id}`;
    content = (
      <>
        <Breadcrumb trail={[
          { label: 'Projects', onClick: () => { setProjectId(null); setGroupId(null); setKpiId(null); } },
          { label: project.name, onClick: () => { setGroupId(null); setKpiId(null); } },
          { label: group.name, onClick: () => setKpiId(null) },
          { label: kpi.name },
        ]} />
        <KpiConsole kpi={kpi} onEdit={(patch) => setEdits((p) => ({ ...p, [kpi.id]: { ...p[kpi.id], ...patch } }))} />
      </>
    );
  } else if (project && group) {
    layerKey = `table:${group.id}:${contextFilter ?? 'all'}`;
    content = (
      <GroupKpiLayer
        project={project}
        group={group}
        ed={ed}
        contextFilter={contextFilter}
        setContextFilter={setContextFilter}
        onOpenKpi={setKpiId}
        onToProjects={() => { setProjectId(null); setGroupId(null); }}
        onToGroups={() => setGroupId(null)}
        bar={bar}
        density={density}
      />
    );
  } else if (project) {
    layerKey = `groups:${project.id}`;
    content = (
      <>
        <Breadcrumb trail={[{ label: 'Projects', onClick: () => setProjectId(null) }, { label: project.name }]} />
        <p className="typo-caption mb-3">{project.stack}</p>
        {renderGroups({ project, ed, openGroup, openKpi })}
      </>
    );
  } else {
    content = (
      <>
        <AttentionBand projects={projects} ed={ed} onJump={jumpToKpi} />
        <ProjectsLayer onOpen={setProjectId} ed={ed} />
      </>
    );
  }

  return (
    <div key={layerKey} className="animate-fade-slide-in flex-1 min-h-0 overflow-y-auto" data-testid={testid}>
      {content}
    </div>
  );
}

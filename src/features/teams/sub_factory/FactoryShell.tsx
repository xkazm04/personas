// Drill-down shell shared by every variant. Owns the navigation state and the
// three shared layers (L1 ProjectsLayer, L3 GroupKpiLayer, L4 KpiConsole) and
// the keyed fade-slide transition between layers. Variants supply ONLY the L2
// group/context overview (via renderGroups). Since Gate 5 every level below the
// portfolio is one kit surface (KitHost compact > Surface dense) whose head is
// a FactoryHead: the kit Crumbs of the levels above (doors back up), the level's name.
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { saveKpiAssessment } from '@/api/devTools/kpis';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { Dot, KitHost, Meta, Surface } from '@/features/shared/components/kit';
import { projectKpis, applyEdit, collectKpiAttention, kpiStatus, CATEGORY_LABEL, TIER_LABEL, type KpiEdit, type MockKpi, type MockProject } from './factoryModel';
import { FactoryHead } from './FactoryHead';
import { FactoryProjectSwitcher } from './FactoryBreadcrumb';
import { KPI_STATUS_MARK } from './factoryTone';
import { useFactoryWords } from './useFactoryWords';
import { ProjectsLayer } from './ProjectsLayer';
import { GroupKpiLayer } from './GroupKpiLayer';
import { KpiConsole } from './KpiConsole';
import { useFactoryData } from './factoryData';
import { FactoryProjectTabs, type L2Tab } from './l2/FactoryProjectTabs';

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
  testid,
}: {
  renderGroups: (args: GroupsRenderArgs) => ReactNode;
  testid?: string;
}) {
  const w = useFactoryWords();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [contextFilter, setContextFilter] = useState<string | null>(null);
  const [kpiId, setKpiId] = useState<string | null>(null);
  // The L2 tab, owned HERE: the tabs subtree is keyed on the project id, so
  // local state would reset on every project switch. Only an explicit door sets
  // it (a plain open resets to Overview).
  const [l2Tab, setL2Tab] = useState<L2Tab>('overview');
  const [edits, setEdits] = useState<Record<string, KpiEdit>>({});
  const ed = (k: MockKpi) => applyEdit(k, edits[k.id]);

  // Cross-feature deep link (Mastermind island menu → Factory): consume the
  // pending focus once, land on the requested project + L2 tab, then clear it
  // so a later manual visit starts at the wall as usual.
  const pendingFactoryFocus = useSystemStore((s) => s.pendingFactoryFocus);
  const setPendingFactoryFocus = useSystemStore((s) => s.setPendingFactoryFocus);
  const notepadOpenForProject = useSystemStore((s) => s.notepadOpenForProject);
  useEffect(() => {
    if (!pendingFactoryFocus) return;
    setProjectId(pendingFactoryFocus.projectId);
    setL2Tab(pendingFactoryFocus.l2Tab);
    setGroupId(null);
    setContextFilter(null);
    setKpiId(null);
    setPendingFactoryFocus(null);
  }, [pendingFactoryFocus, setPendingFactoryFocus]);

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
      }).catch(silentCatch('FactoryShell:saveKpiAssessment'));
    }, 600);
    return () => clearTimeout(t);
  }, [kpiId, edits]);

  const { projects, reload } = useFactoryData();
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
    const st = kpiStatus(kpi);
    content = (
      <FactoryHead
        id="s-fac-kpi"
        trail={[
          { label: w.factory },
          { label: w.projects, onClick: () => { setProjectId(null); setGroupId(null); setKpiId(null); } },
          { label: project.name, onClick: () => { setGroupId(null); setKpiId(null); } },
          { label: group.name, onClick: () => setKpiId(null) },
        ]}
        title={kpi.name}
        meta={<Meta parts={[TIER_LABEL[kpi.tier], CATEGORY_LABEL[kpi.category], <span key="st" className="inline-flex items-center gap-2"><Dot {...KPI_STATUS_MARK[st]} />{w.status[st]}</span>]} />}
      >
        <KpiConsole kpi={kpi} w={w} onEdit={(patch) => setEdits((p) => ({ ...p, [kpi.id]: { ...p[kpi.id], ...patch } }))} />
      </FactoryHead>
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
      />
    );
  } else if (projectId) {
    // Open L2 as soon as a cover click (or deep-link) names a project — do not
    // wait for FactoryDataProvider to assemble every sibling's KPI tree.
    // Overview/Observability fetch the opened project themselves; the matrix
    // fills in once this project's groups land.
    layerKey = `groups:${projectId}`;
    const offTrack = (pj: MockProject) => collectKpiAttention(pj).length;
    const note = (pj: MockProject) => (offTrack(pj) > 0 ? `${offTrack(pj)} ${w.L.offTrack}` : w.kind.ok.toLowerCase());
    // L2 (2026-07, R15): Overview (the consolidated Focus grid) · KPI matrix
    // (keeping the L3/L4 drill) · Observability. The Dev Tools originals stay:
    // dual-run until proven.
    content = (
      <FactoryProjectTabs
        projectId={projectId}
        matrix={project ? renderGroups({ project, ed, openGroup, openKpi }) : null}
        onKpisChanged={reload}
        tab={l2Tab}
        onTabChange={setL2Tab}
        head={{
          id: 's-fac-project',
          trail: [{ label: w.factory }, { label: w.projects, onClick: () => setProjectId(null) }],
          title: project?.name ?? projectId,
          meta: project ? <span className="inline-flex items-center gap-2"><Dot tone={offTrack(project) > 0 ? 'error' : 'success'} />{note(project)}</span> : undefined,
          extra: (
            <FactoryProjectSwitcher
              current={projectId}
              label={w.L.switchProject}
              siblings={projects.map((pj) => ({ id: pj.id, label: pj.name, note: note(pj), tone: offTrack(pj) > 0 ? 'error' : 'success' }))}
              onSelect={(id) => { setProjectId(id); setGroupId(null); setKpiId(null); }}
            />
          ),
        }}
      />
    );
  } else {
    content = (
      <ProjectsLayer
        onOpen={(id) => { setL2Tab('overview'); setProjectId(id); }}
        // The cover's roadmap strip used to drill into this shell's Ship tab.
        // That tab was retired on 2026-09-15 — a milestone is now read through
        // the note that is its brief — so the strip raises the pad over the
        // wall instead of navigating inside it. The wall stays where it was,
        // which is the right thing for an overlay door: closing the pad puts
        // the operator back on the row they clicked.
        onOpenShip={(id) => notepadOpenForProject(id)}
        onJumpKpi={jumpToKpi}
      />
    );
  }

  return (
    <div key={layerKey} className="animate-fade-slide-in flex-1 min-h-0 overflow-y-auto" data-testid={testid}>
      {layerKey === 'projects' ? content : (
        <KitHost compact testId="factory-surface">
          <Surface dense>{content}</Surface>
        </KitHost>
      )}
    </div>
  );
}

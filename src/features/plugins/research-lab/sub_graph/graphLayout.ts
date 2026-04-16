import type { Node, Edge } from '@xyflow/react';
import type {
  ResearchProject, ResearchSource, ResearchHypothesis,
  ResearchExperiment, ResearchFinding, ResearchReport,
} from '@/api/researchLab/researchLab';

export type GraphNodeKind = 'project' | 'source' | 'hypothesis' | 'experiment' | 'finding' | 'report';

export interface GraphNodeData extends Record<string, unknown> {
  kind: GraphNodeKind;
  label: string;
  sublabel?: string;
  color: string;
  entityId: string;
}

interface BuildArgs {
  project: ResearchProject;
  sources: ResearchSource[];
  hypotheses: ResearchHypothesis[];
  experiments: ResearchExperiment[];
  findings: ResearchFinding[];
  reports: ResearchReport[];
  visible: Record<GraphNodeKind, boolean>;
}

const KIND_COLORS: Record<GraphNodeKind, string> = {
  project: '#8b5cf6',    // violet
  source:  '#3b82f6',    // blue
  hypothesis: '#a855f7', // purple
  experiment: '#10b981', // emerald
  finding: '#06b6d4',    // cyan
  report: '#ec4899',     // pink
};

const COLUMN_X: Record<GraphNodeKind, number> = {
  project: 0,
  source: 260,
  hypothesis: 520,
  experiment: 780,
  finding: 1040,
  report: 1300,
};

const ROW_GAP = 110;

function parseJsonIdList(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

function truncate(s: string, n = 48): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function buildGraph(args: BuildArgs): { nodes: Node<GraphNodeData>[]; edges: Edge[] } {
  const { project, sources, hypotheses, experiments, findings, reports, visible } = args;

  const nodes: Node<GraphNodeData>[] = [];
  const edges: Edge[] = [];
  const addEdge = (source: string, target: string, label?: string) => {
    edges.push({
      id: `${source}-${target}`,
      source, target,
      type: 'default',
      animated: false,
      label,
      style: { stroke: 'rgba(255,255,255,0.18)', strokeWidth: 1 },
      labelStyle: { fill: 'rgba(255,255,255,0.5)', fontSize: 10 },
    });
  };

  // Project root
  if (visible.project) {
    nodes.push({
      id: `project:${project.id}`,
      type: 'research',
      position: { x: COLUMN_X.project, y: 0 },
      data: {
        kind: 'project',
        label: truncate(project.name, 32),
        sublabel: project.domain ?? undefined,
        color: KIND_COLORS.project,
        entityId: project.id,
      },
    });
  }

  // Sources column
  if (visible.source) {
    sources.forEach((s, i) => {
      const id = `source:${s.id}`;
      nodes.push({
        id,
        type: 'research',
        position: { x: COLUMN_X.source, y: i * ROW_GAP },
        data: {
          kind: 'source',
          label: truncate(s.title, 40),
          sublabel: s.sourceType + (s.year ? ` · ${s.year}` : ''),
          color: KIND_COLORS.source,
          entityId: s.id,
        },
      });
      if (visible.project) addEdge(`project:${project.id}`, id);
    });
  }

  // Hypotheses column (link to project)
  if (visible.hypothesis) {
    hypotheses.forEach((h, i) => {
      const id = `hypothesis:${h.id}`;
      nodes.push({
        id,
        type: 'research',
        position: { x: COLUMN_X.hypothesis, y: i * ROW_GAP },
        data: {
          kind: 'hypothesis',
          label: truncate(h.statement, 50),
          sublabel: `${Math.round(h.confidence * 100)}%`,
          color: KIND_COLORS.hypothesis,
          entityId: h.id,
        },
      });
      if (visible.project) addEdge(`project:${project.id}`, id);
    });
  }

  // Experiments column (link to hypothesis if present, else project)
  if (visible.experiment) {
    experiments.forEach((e, i) => {
      const id = `experiment:${e.id}`;
      nodes.push({
        id,
        type: 'research',
        position: { x: COLUMN_X.experiment, y: i * ROW_GAP },
        data: {
          kind: 'experiment',
          label: truncate(e.name, 40),
          sublabel: e.status,
          color: KIND_COLORS.experiment,
          entityId: e.id,
        },
      });
      if (e.hypothesisId && visible.hypothesis) {
        addEdge(`hypothesis:${e.hypothesisId}`, id, 'tests');
      } else if (visible.project) {
        addEdge(`project:${project.id}`, id);
      }
    });
  }

  // Findings column (link to their sources, hypotheses, experiments)
  if (visible.finding) {
    findings.forEach((f, i) => {
      const id = `finding:${f.id}`;
      nodes.push({
        id,
        type: 'research',
        position: { x: COLUMN_X.finding, y: i * ROW_GAP },
        data: {
          kind: 'finding',
          label: truncate(f.title, 40),
          sublabel: f.category ?? undefined,
          color: KIND_COLORS.finding,
          entityId: f.id,
        },
      });
      const expIds = parseJsonIdList(f.sourceExperimentIds);
      const hypIds = parseJsonIdList(f.hypothesisIds);
      const srcIds = parseJsonIdList(f.sourceIds);
      let linked = false;
      if (visible.experiment) {
        expIds.forEach((eid) => { addEdge(`experiment:${eid}`, id, 'result'); linked = true; });
      }
      if (visible.hypothesis) {
        hypIds.forEach((hid) => { addEdge(`hypothesis:${hid}`, id); linked = true; });
      }
      if (visible.source) {
        srcIds.forEach((sid) => { addEdge(`source:${sid}`, id); linked = true; });
      }
      if (!linked && visible.project) addEdge(`project:${project.id}`, id);
    });
  }

  // Reports column (link to project)
  if (visible.report) {
    reports.forEach((r, i) => {
      const id = `report:${r.id}`;
      nodes.push({
        id,
        type: 'research',
        position: { x: COLUMN_X.report, y: i * ROW_GAP },
        data: {
          kind: 'report',
          label: truncate(r.title, 40),
          sublabel: r.reportType ?? undefined,
          color: KIND_COLORS.report,
          entityId: r.id,
        },
      });
      if (visible.finding && findings.length > 0) {
        findings.forEach((f) => addEdge(`finding:${f.id}`, id));
      } else if (visible.project) {
        addEdge(`project:${project.id}`, id);
      }
    });
  }

  return { nodes, edges };
}

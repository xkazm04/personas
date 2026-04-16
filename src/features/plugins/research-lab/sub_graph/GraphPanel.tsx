import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  type Node, type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  FolderSearch, BookOpen, Lightbulb, FlaskConical, Target, FileText,
  Waypoints,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { NoActiveProject } from '../_shared/EmptyState';
import { ResearchNode } from './ResearchNode';
import { buildGraph, type GraphNodeKind, type GraphNodeData } from './graphLayout';

const nodeTypes = { research: ResearchNode };

type Visible = Record<GraphNodeKind, boolean>;

const DEFAULT_VISIBLE: Visible = {
  project: true,
  source: true,
  hypothesis: true,
  experiment: true,
  finding: true,
  report: true,
};

export default function GraphPanel() {
  const { t } = useTranslation();
  const activeProjectId = useSystemStore((s) => s.activeResearchProjectId);
  const projects = useSystemStore((s) => s.researchProjects);
  const sources = useSystemStore((s) => s.researchSources);
  const hypotheses = useSystemStore((s) => s.researchHypotheses);
  const experiments = useSystemStore((s) => s.researchExperiments);
  const findings = useSystemStore((s) => s.researchFindings);
  const reports = useSystemStore((s) => s.researchReports);

  const fetchProjects = useSystemStore((s) => s.fetchResearchProjects);
  const fetchSources = useSystemStore((s) => s.fetchResearchSources);
  const fetchHypotheses = useSystemStore((s) => s.fetchResearchHypotheses);
  const fetchExperiments = useSystemStore((s) => s.fetchResearchExperiments);
  const fetchFindings = useSystemStore((s) => s.fetchResearchFindings);
  const fetchReports = useSystemStore((s) => s.fetchResearchReports);
  const setResearchLabTab = useSystemStore((s) => s.setResearchLabTab);
  const setActiveProject = useSystemStore((s) => s.setActiveResearchProject);

  const [visible, setVisible] = useState<Visible>(DEFAULT_VISIBLE);
  const [selected, setSelected] = useState<GraphNodeData | null>(null);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  useEffect(() => {
    if (!activeProjectId) return;
    fetchSources(activeProjectId);
    fetchHypotheses(activeProjectId);
    fetchExperiments(activeProjectId);
    fetchFindings(activeProjectId);
    fetchReports(activeProjectId);
  }, [activeProjectId, fetchSources, fetchHypotheses, fetchExperiments, fetchFindings, fetchReports]);

  const project = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const graph = useMemo<{ nodes: Node<GraphNodeData>[]; edges: Edge[] }>(() => {
    if (!project) return { nodes: [], edges: [] };
    return buildGraph({
      project,
      sources: sources.filter((s) => s.projectId === project.id),
      hypotheses: hypotheses.filter((h) => h.projectId === project.id),
      experiments: experiments.filter((e) => e.projectId === project.id),
      findings: findings.filter((f) => f.projectId === project.id),
      reports: reports.filter((r) => r.projectId === project.id),
      visible,
    });
  }, [project, sources, hypotheses, experiments, findings, reports, visible]);

  if (!activeProjectId || !project) {
    return (
      <NoActiveProject
        icon={Waypoints}
        message={t.research_lab.select_project_first}
        onGoToProjects={() => setResearchLabTab('projects')}
        goToProjectsLabel={t.research_lab.projects}
      />
    );
  }

  const toggles: Array<{ kind: GraphNodeKind; icon: LucideIcon; label: string; count: number }> = [
    { kind: 'source', icon: BookOpen, label: t.research_lab.sources, count: sources.filter(s => s.projectId === project.id).length },
    { kind: 'hypothesis', icon: Lightbulb, label: t.research_lab.hypotheses, count: hypotheses.filter(h => h.projectId === project.id).length },
    { kind: 'experiment', icon: FlaskConical, label: t.research_lab.experiments, count: experiments.filter(e => e.projectId === project.id).length },
    { kind: 'finding', icon: Target, label: t.research_lab.findings, count: findings.filter(f => f.projectId === project.id).length },
    { kind: 'report', icon: FileText, label: t.research_lab.reports, count: reports.filter(r => r.projectId === project.id).length },
  ];

  const handleEntityJump = (data: GraphNodeData) => {
    setActiveProject(project.id);
    switch (data.kind) {
      case 'source': setResearchLabTab('literature'); break;
      case 'hypothesis': setResearchLabTab('hypotheses'); break;
      case 'experiment': setResearchLabTab('experiments'); break;
      case 'finding': setResearchLabTab('findings'); break;
      case 'report': setResearchLabTab('reports'); break;
      case 'project': setResearchLabTab('projects'); break;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 p-4 border-b border-border/20">
        <div className="flex items-center gap-2 min-w-0">
          <FolderSearch className="w-4 h-4 text-primary/60 flex-shrink-0" />
          <span className="typo-body text-foreground font-medium truncate">{project.name}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {toggles.map((tg) => (
            <button
              key={tg.kind}
              onClick={() => setVisible((v) => ({ ...v, [tg.kind]: !v[tg.kind] }))}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] transition-colors border ${
                visible[tg.kind]
                  ? 'bg-primary/15 border-primary/30 text-primary'
                  : 'bg-secondary/30 border-border/20 text-foreground/50 hover:text-foreground/80'
              }`}
            >
              <tg.icon className="w-3 h-3" />
              <span>{tg.label}</span>
              <span className="opacity-60">{tg.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Canvas + details */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          <ReactFlowProvider>
            <ReactFlow
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={nodeTypes}
              onNodeClick={(_, node) => setSelected((node.data as GraphNodeData) ?? null)}
              onPaneClick={() => setSelected(null)}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.2}
              maxZoom={1.5}
              proOptions={{ hideAttribution: true }}
              className="bg-background"
              nodesDraggable={false}
              nodesConnectable={false}
              edgesFocusable={false}
            >
              <Background gap={24} size={1} className="opacity-20" />
              <Controls
                className="!bg-secondary/60 !border-primary/15 !rounded-xl !shadow-elevation-3 [&>button]:!bg-secondary/80 [&>button]:!border-primary/15 [&>button]:!text-foreground/80"
                showInteractive={false}
              />
              <MiniMap
                className="!bg-secondary/40 !border-primary/15 !rounded-xl"
                maskColor="rgba(0,0,0,0.3)"
                nodeColor={(n) => (n.data as GraphNodeData).color}
              />
            </ReactFlow>
          </ReactFlowProvider>
        </div>

        {selected && (
          <aside className="w-72 border-l border-border/20 bg-secondary/30 p-4 overflow-y-auto">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selected.color }} />
              <span className="typo-caption text-foreground/60 uppercase tracking-wide">{selected.kind}</span>
            </div>
            <h3 className="typo-body text-foreground font-semibold mb-1">{selected.label}</h3>
            {selected.sublabel && (
              <p className="typo-caption text-foreground/50 mb-4">{selected.sublabel}</p>
            )}
            {selected.kind !== 'project' && (
              <button
                onClick={() => handleEntityJump(selected)}
                className="w-full px-3 py-2 rounded-lg typo-caption bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
              >
                {t.research_lab.view_all}
              </button>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

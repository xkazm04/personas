import { useEffect, useState, lazy, Suspense, useMemo } from 'react';
import { Lightbulb, Trash2, ThumbsUp, ThumbsDown, Sparkles } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { SectionHeader } from '../_shared/SectionHeader';
import { EmptyState, NoActiveProject } from '../_shared/EmptyState';
import type { ResearchHypothesis } from '@/api/researchLab/researchLab';

const AddHypothesisForm = lazy(() => import('./AddHypothesisForm'));
const GenerateHypothesesModal = lazy(() => import('./GenerateHypothesesModal'));

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  const color =
    pct >= 0.7 ? 'bg-emerald-500/80' :
    pct >= 0.4 ? 'bg-amber-500/80' :
    'bg-red-500/60';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-20 rounded-full bg-foreground/10 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct * 100}%` }} />
      </div>
      <span className="typo-micro text-foreground/50">{Math.round(pct * 100)}%</span>
    </div>
  );
}

export default function HypothesesPanel() {
  const { t } = useTranslation();
  const activeProjectId = useSystemStore((s) => s.activeResearchProjectId);
  const hypotheses = useSystemStore((s) => s.researchHypotheses);
  const loading = useSystemStore((s) => s.researchHypothesesLoading);
  const fetchHypotheses = useSystemStore((s) => s.fetchResearchHypotheses);
  const deleteHypothesis = useSystemStore((s) => s.deleteResearchHypothesis);
  const setResearchLabTab = useSystemStore((s) => s.setResearchLabTab);
  const projects = useSystemStore((s) => s.researchProjects);
  const sources = useSystemStore((s) => s.researchSources);
  const fetchSources = useSystemStore((s) => s.fetchResearchSources);
  const personas = useAgentStore((s) => s.personas);
  const fetchPersonas = useAgentStore((s) => s.fetchPersonas);

  const [showForm, setShowForm] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);

  useEffect(() => {
    if (activeProjectId) {
      fetchHypotheses(activeProjectId);
      // sources are used as context for the generator
      if (sources.length === 0) fetchSources(activeProjectId);
    }
  }, [activeProjectId, fetchHypotheses, fetchSources, sources.length]);

  useEffect(() => {
    if (personas.length === 0) fetchPersonas();
  }, [personas.length, fetchPersonas]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const projectHypotheses = useMemo(
    () => hypotheses.filter((h) => h.projectId === activeProjectId),
    [hypotheses, activeProjectId],
  );

  if (!activeProjectId) {
    return (
      <NoActiveProject
        icon={Lightbulb}
        message={t.research_lab.select_project_first}
        onGoToProjects={() => setResearchLabTab('projects')}
        goToProjectsLabel={t.research_lab.projects}
      />
    );
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try { await deleteHypothesis(id); } catch (err) { toastCatch("HypothesesPanel:delete")(err); }
  };

  const parseCount = (json: string | null): number => {
    if (!json) return 0;
    try {
      const v = JSON.parse(json);
      return Array.isArray(v) ? v.length : 0;
    } catch { return 0; }
  };

  return (
    <div className="p-6 space-y-4 overflow-y-auto">
      <SectionHeader
        title={t.research_lab.hypotheses}
        actionLabel={t.research_lab.add_hypothesis}
        onAction={() => setShowForm(true)}
        extra={
          <>
            <span className="typo-caption text-foreground/40">{projectHypotheses.length}</span>
            {activeProject && personas.length > 0 && (
              <button
                onClick={() => setShowGenerate(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg typo-caption bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 transition-colors"
                title={t.research_lab.generate_hypotheses}
              >
                <Sparkles className="w-3.5 h-3.5" />
                {t.research_lab.generate_hypotheses}
              </button>
            )}
          </>
        }
      />

      {loading && projectHypotheses.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <p className="typo-body text-foreground/50">{t.common.loading}</p>
        </div>
      ) : projectHypotheses.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title={t.research_lab.no_hypotheses}
          hint={t.research_lab.no_hypotheses_hint}
          actionLabel={t.research_lab.add_hypothesis}
          onAction={() => setShowForm(true)}
        />
      ) : (
        <div className="space-y-3">
          {projectHypotheses.map((h: ResearchHypothesis) => {
            const supporting = parseCount(h.supportingEvidence);
            const counter = parseCount(h.counterEvidence);
            return (
              <div
                key={h.id}
                className="rounded-card bg-secondary/50 border border-border/30 p-4 hover:border-primary/30 transition-colors group"
              >
                <div className="flex items-start gap-3">
                  <Lightbulb className="w-4 h-4 text-violet-400/80 mt-1 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="typo-body text-foreground font-medium leading-snug">{h.statement}</p>
                    {h.rationale && (
                      <p className="typo-caption text-foreground/50 mt-1.5 line-clamp-2">{h.rationale}</p>
                    )}
                    <div className="flex items-center gap-4 mt-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="typo-micro text-foreground/40">{t.research_lab.confidence}</span>
                        <ConfidenceBar value={h.confidence} />
                      </div>
                      {supporting > 0 && (
                        <span className="flex items-center gap-1 typo-micro text-emerald-400/80">
                          <ThumbsUp className="w-3 h-3" /> {supporting} {t.research_lab.supporting.toLowerCase()}
                        </span>
                      )}
                      {counter > 0 && (
                        <span className="flex items-center gap-1 typo-micro text-red-400/80">
                          <ThumbsDown className="w-3 h-3" /> {counter} {t.research_lab.counter.toLowerCase()}
                        </span>
                      )}
                      {h.generatedBy && (
                        <span className="typo-micro text-foreground/30">· {h.generatedBy}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(e, h.id)}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-red-400/60 hover:text-red-400 transition-all flex-shrink-0"
                    title={t.common.delete}
                    aria-label={t.common.delete}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <Suspense fallback={null}>
          <AddHypothesisForm projectId={activeProjectId} onClose={() => setShowForm(false)} />
        </Suspense>
      )}

      {showGenerate && activeProject && (
        <Suspense fallback={null}>
          <GenerateHypothesesModal project={activeProject} onClose={() => setShowGenerate(false)} />
        </Suspense>
      )}
    </div>
  );
}

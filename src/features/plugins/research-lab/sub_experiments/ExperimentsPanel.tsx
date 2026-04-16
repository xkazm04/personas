import { useEffect, useState, lazy, Suspense, useMemo } from 'react';
import { FlaskConical, Trash2, Target, ClipboardList } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { SectionHeader } from '../_shared/SectionHeader';
import { EmptyState, NoActiveProject } from '../_shared/EmptyState';
import type { ResearchExperiment } from '@/api/researchLab/researchLab';

const AddExperimentForm = lazy(() => import('./AddExperimentForm'));

export default function ExperimentsPanel() {
  const { t } = useTranslation();
  const activeProjectId = useSystemStore((s) => s.activeResearchProjectId);
  const experiments = useSystemStore((s) => s.researchExperiments);
  const loading = useSystemStore((s) => s.researchExperimentsLoading);
  const fetchExperiments = useSystemStore((s) => s.fetchResearchExperiments);
  const deleteExperiment = useSystemStore((s) => s.deleteResearchExperiment);
  const hypotheses = useSystemStore((s) => s.researchHypotheses);
  const fetchHypotheses = useSystemStore((s) => s.fetchResearchHypotheses);
  const setResearchLabTab = useSystemStore((s) => s.setResearchLabTab);

  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (activeProjectId) {
      fetchExperiments(activeProjectId);
      fetchHypotheses(activeProjectId);
    }
  }, [activeProjectId, fetchExperiments, fetchHypotheses]);

  const projectExperiments = useMemo(
    () => experiments.filter((e) => e.projectId === activeProjectId),
    [experiments, activeProjectId],
  );

  const hypothesisMap = useMemo(
    () => Object.fromEntries(hypotheses.map((h) => [h.id, h])),
    [hypotheses],
  );

  if (!activeProjectId) {
    return (
      <NoActiveProject
        icon={FlaskConical}
        message={t.research_lab.select_project_first}
        onGoToProjects={() => setResearchLabTab('projects')}
        goToProjectsLabel={t.research_lab.projects}
      />
    );
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try { await deleteExperiment(id); } catch (err) { toastCatch("ExperimentsPanel:delete")(err); }
  };

  return (
    <div className="p-6 space-y-4 overflow-y-auto">
      <SectionHeader
        title={t.research_lab.experiments}
        actionLabel={t.research_lab.create_experiment}
        onAction={() => setShowForm(true)}
        extra={<span className="typo-caption text-foreground/40">{projectExperiments.length}</span>}
      />

      {loading && projectExperiments.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <p className="typo-body text-foreground/50">{t.common.loading}</p>
        </div>
      ) : projectExperiments.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title={t.research_lab.no_experiments}
          hint={t.research_lab.no_experiments_hint}
          actionLabel={t.research_lab.create_experiment}
          onAction={() => setShowForm(true)}
        />
      ) : (
        <div className="space-y-3">
          {projectExperiments.map((exp: ResearchExperiment) => {
            const linked = exp.hypothesisId ? hypothesisMap[exp.hypothesisId] : null;
            return (
              <div
                key={exp.id}
                className="rounded-card bg-secondary/50 border border-border/30 p-4 hover:border-primary/30 transition-colors group"
              >
                <div className="flex items-start gap-3">
                  <FlaskConical className="w-4 h-4 text-emerald-400/80 mt-1 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <h3 className="typo-body text-foreground font-semibold">{exp.name}</h3>

                    {linked && (
                      <p className="flex items-center gap-1.5 typo-caption text-violet-300/80 mt-1.5">
                        <Target className="w-3 h-3" />
                        <span className="truncate">{linked.statement}</span>
                      </p>
                    )}

                    {exp.methodology && (
                      <div className="mt-2">
                        <p className="typo-micro text-foreground/40 uppercase tracking-wide">{t.research_lab.methodology}</p>
                        <p className="typo-caption text-foreground/60 mt-0.5 line-clamp-2">{exp.methodology}</p>
                      </div>
                    )}

                    {exp.successCriteria && (
                      <div className="mt-2 flex items-start gap-1.5">
                        <ClipboardList className="w-3 h-3 text-foreground/40 mt-0.5 flex-shrink-0" />
                        <p className="typo-caption text-foreground/60 line-clamp-2">{exp.successCriteria}</p>
                      </div>
                    )}

                    <div className="flex items-center gap-2 mt-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary/60">
                        {exp.status.replace(/_/g, ' ')}
                      </span>
                      {!linked && (
                        <span className="typo-micro text-foreground/30">{t.research_lab.no_linked_hypothesis}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(e, exp.id)}
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
          <AddExperimentForm projectId={activeProjectId} onClose={() => setShowForm(false)} />
        </Suspense>
      )}
    </div>
  );
}

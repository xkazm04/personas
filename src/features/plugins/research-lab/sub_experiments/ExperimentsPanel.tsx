import { useEffect, useState, lazy, Suspense, useMemo, useCallback } from 'react';
import { FlaskConical, Trash2, Target, ClipboardList, Play, History, Loader2, Bot } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { SectionHeader } from '../_shared/SectionHeader';
import { EmptyState, NoActiveProject } from '../_shared/EmptyState';
import { parseExperimentConfig, evaluatePass } from '../_shared/experimentConfig';
import { runPersonaAndWait } from '../_shared/runPersona';
import { createExperimentRun } from '@/api/researchLab/researchLab';
import type { ResearchExperiment } from '@/api/researchLab/researchLab';

const AddExperimentForm = lazy(() => import('./AddExperimentForm'));
const ExperimentRunsDrawer = lazy(() => import('./ExperimentRunsDrawer'));

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
  const personas = useAgentStore((s) => s.personas);
  const fetchPersonas = useAgentStore((s) => s.fetchPersonas);
  const addToast = useToastStore((s) => s.addToast);

  const [showForm, setShowForm] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runsDrawer, setRunsDrawer] = useState<ResearchExperiment | null>(null);
  const [runsRefresh, setRunsRefresh] = useState(0);

  useEffect(() => {
    if (activeProjectId) {
      fetchExperiments(activeProjectId);
      fetchHypotheses(activeProjectId);
    }
  }, [activeProjectId, fetchExperiments, fetchHypotheses]);

  useEffect(() => {
    if (personas.length === 0) fetchPersonas();
  }, [personas.length, fetchPersonas]);

  const projectExperiments = useMemo(
    () => experiments.filter((e) => e.projectId === activeProjectId),
    [experiments, activeProjectId],
  );

  const hypothesisMap = useMemo(
    () => Object.fromEntries(hypotheses.map((h) => [h.id, h])),
    [hypotheses],
  );

  const personaMap = useMemo(
    () => Object.fromEntries(personas.map((p) => [p.id, p])),
    [personas],
  );

  const handleRun = useCallback(async (e: React.MouseEvent, exp: ResearchExperiment) => {
    e.stopPropagation();
    const config = parseExperimentConfig(exp.inputSchema);
    if (!config.linkedPersonaId) return;

    setRunningId(exp.id);
    try {
      const { execution, output, passed: statusPassed } = await runPersonaAndWait({
        personaId: config.linkedPersonaId,
        input: config.inputDataTemplate ?? '',
      });

      const passed = evaluatePass(output, config.passPattern, statusPassed);

      const metrics = JSON.stringify({
        status: execution.status,
        inputTokens: execution.input_tokens,
        outputTokens: execution.output_tokens,
        passBy: config.passPattern ? 'pattern' : 'status',
      });

      await createExperimentRun(exp.id, output ?? undefined, metrics, passed);
      addToast(passed ? t.research_lab.run_passed : t.research_lab.run_failed, passed ? 'success' : 'error');
      setRunsRefresh((n) => n + 1);
    } catch (err) {
      toastCatch("ExperimentsPanel:run")(err);
    } finally {
      setRunningId(null);
    }
  }, [t, addToast]);

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
        extra={<span className="typo-caption text-foreground">{projectExperiments.length}</span>}
      />

      {loading && projectExperiments.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <p className="typo-body text-foreground">{t.common.loading}</p>
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
            const config = parseExperimentConfig(exp.inputSchema);
            const persona = config.linkedPersonaId ? personaMap[config.linkedPersonaId] : null;
            const isRunning = runningId === exp.id;
            return (
              <div
                key={exp.id}
                className="rounded-card bg-secondary/50 border border-border/30 p-4 hover:border-primary/30 transition-colors group"
              >
                <div className="flex items-start gap-3">
                  <FlaskConical className="w-4 h-4 text-emerald-400/80 mt-1 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <h3 className="typo-card-label">{exp.name}</h3>

                    {linked && (
                      <p className="flex items-center gap-1.5 typo-caption text-violet-300/80 mt-1.5">
                        <Target className="w-3 h-3" />
                        <span className="truncate">{linked.statement}</span>
                      </p>
                    )}

                    {persona && (
                      <p className="flex items-center gap-1.5 typo-caption text-emerald-300/80 mt-1.5">
                        <Bot className="w-3 h-3" />
                        <span className="truncate">{persona.name}</span>
                      </p>
                    )}

                    {exp.methodology && (
                      <div className="mt-2">
                        <p className="typo-label text-foreground">{t.research_lab.methodology}</p>
                        <p className="typo-body text-foreground mt-0.5 line-clamp-2">{exp.methodology}</p>
                      </div>
                    )}

                    {exp.successCriteria && (
                      <div className="mt-2 flex items-start gap-1.5">
                        <ClipboardList className="w-3 h-3 text-foreground mt-0.5 flex-shrink-0" />
                        <p className="typo-body text-foreground line-clamp-2">{exp.successCriteria}</p>
                      </div>
                    )}

                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary">
                        {exp.status.replace(/_/g, ' ')}
                      </span>
                      {!linked && (
                        <span className="typo-caption text-foreground">{t.research_lab.no_linked_hypothesis}</span>
                      )}
                      {persona && (
                        <button
                          onClick={(e) => handleRun(e, exp)}
                          disabled={isRunning}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-60"
                        >
                          {isRunning
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <Play className="w-3 h-3" />}
                          {isRunning ? t.research_lab.running_experiment : t.research_lab.run_experiment}
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setRunsDrawer(exp); }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-foreground/5 text-foreground hover:bg-foreground/10 hover:text-foreground transition-colors"
                      >
                        <History className="w-3 h-3" />
                        {t.research_lab.view_runs}
                      </button>
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

      {runsDrawer && (
        <Suspense fallback={null}>
          <ExperimentRunsDrawer
            experiment={runsDrawer}
            onClose={() => setRunsDrawer(null)}
            refreshToken={runsRefresh}
          />
        </Suspense>
      )}
    </div>
  );
}

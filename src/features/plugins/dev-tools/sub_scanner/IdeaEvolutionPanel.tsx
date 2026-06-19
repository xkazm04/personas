import { useMemo } from 'react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Dna, AlertTriangle, Sparkles, Link2, CheckCircle2, Circle, Loader2, XCircle, ArrowRight, Workflow } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import {
  computeIdeaFitness,
  generateSynthesisSuggestions,
  findSimilarPairs,
} from './ideaEvolution';
import { fitnessColor, fitnessBar } from '../constants/ideaColors';

export function IdeaEvolutionPanel() {
  const { t } = useTranslation();
  const ideas = useSystemStore((s) => s.ideas);
  const tasks = useSystemStore((s) => s.tasks);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const setPendingTaskFocusId = useSystemStore((s) => s.setPendingTaskFocusId);

  const fitness = useMemo(() => computeIdeaFitness(ideas), [ideas]);
  const syntheses = useMemo(() => generateSynthesisSuggestions(ideas), [ideas]);
  const similarPairs = useMemo(() => findSimilarPairs(ideas, 0.5).slice(0, 5), [ideas]);

  // Per-accepted-idea lifecycle: idea → task → shipped, derived from
  // DevTask.source_idea_id. Surfaces the story of how each accepted idea
  // became code in one strip — today that story is scattered across the
  // Scanner, Triage, and Task Runner tabs.
  const lifecycle = useMemo(() => {
    const tasksByIdea = new Map<string, typeof tasks>();
    for (const task of tasks) {
      if (!task.source_idea_id) continue;
      const list = tasksByIdea.get(task.source_idea_id) ?? [];
      list.push(task);
      tasksByIdea.set(task.source_idea_id, list);
    }
    return ideas
      .filter((i) => i.status === 'accepted')
      .map((i) => {
        const linkedTasks = tasksByIdea.get(i.id) ?? [];
        // Prefer a completed task; else the most recently updated one.
        const shipped = linkedTasks.find((task) => task.status === 'complete' || task.status === 'completed') ?? null;
        const newest = [...linkedTasks].sort((a, b) =>
          (b.completed_at ?? b.started_at ?? b.created_at).localeCompare(a.completed_at ?? a.started_at ?? a.created_at)
        )[0] ?? null;
        const representative = shipped ?? newest;
        return { idea: i, task: representative, totalTasks: linkedTasks.length, shipped: Boolean(shipped) };
      })
      // Most recent accepted ideas first; cap to 6 so the panel stays scannable.
      .sort((a, b) => b.idea.id.localeCompare(a.idea.id))
      .slice(0, 6);
  }, [ideas, tasks]);

  const penalizedCount = fitness.filter((f) => f.rejectionPenalty > 0.2).length;
  const highFitness = fitness.filter((f) => f.finalFitness > 0.3);

  if (ideas.length < 2) return null;

  const handleTaskJump = (taskId: string) => {
    setPendingTaskFocusId(taskId);
    setDevToolsTab('task-runner');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Dna className="w-4 h-4 text-violet-400" />
        <h3 className="text-md font-semibold uppercase tracking-wider text-primary">
          {t.plugins.dev_scanner.idea_evolution}
        </h3>
      </div>

      {/* Idea Lifecycle — accepted ideas as 3-step strips (Accepted → Tasked → Shipped) */}
      {lifecycle.length > 0 && (
        <div className="rounded-modal border border-primary/10 overflow-hidden">
          <div className="px-4 py-2.5 bg-primary/5 border-b border-primary/10 flex items-center gap-2">
            <Workflow className="w-3.5 h-3.5 text-primary" />
            <span className="text-md font-medium text-foreground">{t.plugins.dev_scanner.lifecycle_heading}</span>
            <span className="text-md text-foreground ml-auto">{lifecycle.length}</span>
          </div>
          <ul className="divide-y divide-primary/5">
            {lifecycle.map(({ idea, task, totalTasks, shipped }) => (
              <li key={idea.id} className="px-4 py-2.5">
                <p className="text-md text-foreground truncate font-medium mb-1.5">{idea.title}</p>
                <div className="flex items-center gap-1.5">
                  <LifecycleStep icon={CheckCircle2} label={t.plugins.dev_scanner.lifecycle_stage_accepted} state="done" />
                  <ArrowRight className="w-3 h-3 text-foreground shrink-0" />
                  {task ? (
                    <button
                      type="button"
                      onClick={() => handleTaskJump(task.id)}
                      title={t.plugins.dev_scanner.lifecycle_jump_to_task}
                      className="contents"
                    >
                      <LifecycleStep
                        icon={
                          task.status === 'failed' ? XCircle
                          : task.status === 'complete' || task.status === 'completed' ? CheckCircle2
                          : task.status === 'pending' ? Circle
                          : Loader2
                        }
                        label={`${t.plugins.dev_scanner.lifecycle_stage_tasked}${totalTasks > 1 ? ` (${totalTasks})` : ''}`}
                        state={task.status === 'failed' ? 'failed' : (task.status === 'complete' || task.status === 'completed') ? 'done' : task.status === 'pending' ? 'pending' : 'running'}
                        clickable
                      />
                    </button>
                  ) : (
                    <LifecycleStep icon={Circle} label={t.plugins.dev_scanner.lifecycle_stage_tasked} state="pending" />
                  )}
                  <ArrowRight className="w-3 h-3 text-foreground shrink-0" />
                  <LifecycleStep
                    icon={shipped ? CheckCircle2 : Circle}
                    label={t.plugins.dev_scanner.lifecycle_stage_shipped}
                    state={shipped ? 'done' : 'pending'}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Fitness ranking */}
      {fitness.length > 0 && (
        <div className="rounded-modal border border-primary/10 overflow-hidden">
          <div className="px-4 py-2.5 bg-primary/5 border-b border-primary/10 flex items-center justify-between">
            <span className="text-md font-medium text-foreground">{t.plugins.dev_scanner.fitness_ranking}</span>
            <div className="flex items-center gap-3 text-md text-foreground">
              <span className="text-emerald-400">{highFitness.length} high</span>
              {penalizedCount > 0 && (
                <span className="text-red-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {penalizedCount} penalized
                </span>
              )}
            </div>
          </div>
          <div className="divide-y divide-primary/5">
            {fitness.slice(0, 8).map((f) => (
              <div key={f.idea.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-md text-foreground truncate">{f.idea.title}</p>
                  {f.similarRejections.length > 0 && (
                    <p className="text-md text-red-400/60 truncate">
                      {t.plugins.dev_scanner.similar_to_rejected} {f.similarRejections[0]}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {f.rejectionPenalty > 0.2 && (
                    <span className="text-md text-red-400">-{Math.round(f.rejectionPenalty * 100)}%</span>
                  )}
                  <div className="w-16 h-1.5 bg-primary/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${fitnessBar(f.finalFitness)}`}
                      style={{ width: `${Math.max(5, (f.finalFitness + 1) * 50)}%` }}
                    />
                  </div>
                  <span className={`text-md font-medium w-10 text-right ${fitnessColor(f.finalFitness)}`}>
                    <Numeric value={f.finalFitness} precision={2} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Synthesis suggestions */}
      {syntheses.length > 0 && (
        <div className="rounded-modal border border-violet-500/15 bg-violet-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-400" />
            <span className="text-md font-medium text-foreground">{t.plugins.dev_scanner.synthesis_suggestions}</span>
          </div>
          {syntheses.map((s, i) => (
            <div key={i} className="rounded-card border border-violet-500/10 bg-background/30 p-3">
              <p className="text-md font-medium text-foreground">{s.suggestedTitle}</p>
              <p className="text-md text-foreground mt-1">{s.reasoning}</p>
              <div className="flex items-center gap-2 mt-2 text-md text-violet-400/60">
                <Link2 className="w-3 h-3" />
                {s.parentA.title.slice(0, 30)} + {s.parentB.title.slice(0, 30)}
                <span className="text-foreground ml-auto">{Math.round(s.similarity * 100)}{t.plugins.dev_scanner.percent_similar}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Duplicate detection */}
      {similarPairs.length > 0 && (
        <div className="rounded-modal border border-amber-500/15 bg-amber-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span className="text-md font-medium text-foreground">{t.plugins.dev_scanner.potential_duplicates}</span>
          </div>
          {similarPairs.map((pair, i) => (
            <div key={i} className="flex items-center gap-2 text-md text-foreground">
              <span className="truncate flex-1">{pair.ideaA.title}</span>
              <span className="text-amber-400 flex-shrink-0">{Math.round(pair.similarity * 100)}%</span>
              <span className="truncate flex-1">{pair.ideaB.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LifecycleStep — single step in the accepted-idea timeline strip
// ---------------------------------------------------------------------------

type LifecycleStepState = 'pending' | 'running' | 'done' | 'failed';
const STEP_TINT: Record<LifecycleStepState, string> = {
  pending: 'text-foreground border-foreground/15 bg-background/30',
  running: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  done:    'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  failed:  'text-red-400 border-red-500/30 bg-red-500/10',
};

function LifecycleStep({
  icon: Icon, label, state, clickable,
}: {
  icon: typeof CheckCircle2;
  label: string;
  state: LifecycleStepState;
  clickable?: boolean;
}) {
  const tint = STEP_TINT[state];
  const isSpinning = state === 'running';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 typo-caption font-medium ${tint} ${
        clickable ? 'hover:brightness-110 cursor-pointer' : ''
      }`}
    >
      <Icon className={`w-2.5 h-2.5 shrink-0 ${isSpinning ? 'animate-spin' : ''}`} />
      <span className="truncate">{label}</span>
    </span>
  );
}

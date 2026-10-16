import { useState, useEffect, useMemo } from 'react';
import { Target, Plus, Sparkles } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { IconGoals } from '@/features/shared/chrome/sidebar/SidebarIcons';
import { useAthenaStore } from '@/features/companions/athena/athenaStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { obsidianBrainPushGoals } from '@/api/obsidianBrain';
import { LifecycleProjectPicker } from '@/features/plugins/dev-tools/sub_lifecycle/LifecycleProjectPicker';
import { usePickerScope, inPickerScope } from '@/features/plugins/dev-tools/sub_workspaces/usePickerScope';
import { GoalEditorModal } from './GoalEditorModal';
import { GoalsProgress } from './GoalsProgress';
import { GoalViewExplainer } from './GoalViewExplainer';

/**
 * Goals — high-level direction surface.
 *
 * One surface (the Board was retired in the Goals consolidation): the header
 * carries the title, the shared LifecycleProjectPicker (whose workspace /
 * project selection is the scope), the Obsidian sync and the "+ New goal"
 * button that opens GoalEditorModal; the body is GoalsProgress, whose
 * Notes | Ledger switch picks the layout. With no goals at all it shows the
 * settled-empty hero and starters instead.
 */
export default function GoalsPage() {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const storeGoals = useSystemStore((s) => s.goals);
  const goalsLoading = useSystemStore((s) => s.goalsLoading);
  const fetchGoals = useSystemStore((s) => s.fetchGoals);
  const fetchAllGoals = useSystemStore((s) => s.fetchAllGoals);
  const createGoal = useSystemStore((s) => s.createGoal);
  const addToast = useToastStore((s) => s.addToast);

  const [editorOpen, setEditorOpen] = useState(false);
  // The header picker IS the scope: a project, a workspace's projects, or all.
  const scope = usePickerScope();

  const goals = useMemo(() => storeGoals.filter((g) => inPickerScope(scope, g.project_id)), [storeGoals, scope]);

  // Load goals at the page level so the settled-empty hero below knows whether
  // there is anything to show. In cross-project scope we pull every project's
  // goals (done ones too, so a finished-only portfolio is not called empty)
  // into the same store array; otherwise the scoped project's.
  useEffect(() => {
    if (scope.projectId) {
      void fetchGoals(scope.projectId);
    } else {
      void fetchAllGoals({ includeCompleted: true });
    }
  }, [scope.projectId, fetchGoals, fetchAllGoals]);

  const handleSyncToObsidian = async () => {
    if (!activeProjectId) return;
    try {
      const result = await obsidianBrainPushGoals(activeProjectId);
      addToast(`Goals synced to Obsidian: ${result.created} created, ${result.updated} updated`, 'success');
    } catch {
      addToast('Obsidian sync failed — configure vault in Obsidian Brain plugin first', 'error');
    }
  };

  // Open Athena with a preset question to help the user set up project goals.
  const handleAskAthena = () => {
    useAthenaStore.getState().setPendingPrompt({ text: dl.goal_ask_athena_prompt, autoSend: true });
    useAthenaStore.getState().setState('open');
  };

  // Starter goals — one-click seeds for the empty state, so a non-technical
  // user gets a concrete first goal instead of a blank form.
  const [starterBusy, setStarterBusy] = useState(false);
  const starters = [
    { title: dl.goal_starter_release_title, desc: dl.goal_starter_release_desc },
    { title: dl.goal_starter_bugs_title, desc: dl.goal_starter_bugs_desc },
    { title: dl.goal_starter_docs_title, desc: dl.goal_starter_docs_desc },
    { title: dl.goal_starter_quality_title, desc: dl.goal_starter_quality_desc },
  ];
  const addStarter = async (title: string, desc: string) => {
    if (!activeProjectId || starterBusy) return;
    setStarterBusy(true);
    try {
      await createGoal(activeProjectId, title, desc);
      addToast(tx(dl.goal_starter_created, { title }), 'success');
    } catch (err) {
      // createGoal already reports to the store's error channel.
      silentCatch('GoalsPage.addStarter')(err);
    } finally {
      setStarterBusy(false);
    }
  };

  return (
    <ContentBox data-testid="goals-page">
      <ContentHeader
        icon={<Target className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.plugins.dev_lifecycle.tab_goals}
        fitWidth
        actions={
          <>
            <LifecycleProjectPicker allowNone />
            <Button variant="secondary" size="sm" onClick={handleSyncToObsidian}>
              {t.plugins.dev_tools.sync_to_obsidian}
            </Button>
            <Button
              variant="accent"
              tone="agent"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              disabled={!activeProjectId}
              onClick={() => setEditorOpen(true)}
            >
              {dl.goal_new_title}
            </Button>
          </>
        }
      />

      <ContentBody>
        {/* One surface (the Board and Timeline are gone). While the first fetch
            is in flight GoalsProgress paints its own delayed ghost, so the
            settled-empty hero below is never flashed on a cold visit. */}
        {goals.length > 0 || goalsLoading ? (
          <div className="space-y-3">
            <GoalViewExplainer text={dl.goal_explainer_progress} />
            <GoalsProgress projectScope={scope} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            {/* Haloed animated-bullseye hero (mirrors the overview illustration look) */}
            <div className="relative flex items-center justify-center mb-5" style={{ width: 168, height: 168 }}>
              <div
                className="pointer-events-none absolute inset-0"
                style={{ background: 'radial-gradient(circle at 50% 50%, rgba(139,92,246,0.18), transparent 70%)' }}
              />
              <div className="relative w-[120px] h-[120px] text-violet-400">
                <IconGoals active className="w-full h-full" />
              </div>
            </div>
            <h3 className="typo-section-title">
              {t.plugins.dev_tools.goals_tab_no_goals}
            </h3>
            <p className="typo-body text-foreground mt-1 mb-5 max-w-md">
              {dl.goal_empty_subtitle}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="accent"
                tone="agent"
                size="sm"
                icon={<Plus className="w-3.5 h-3.5" />}
                disabled={!activeProjectId}
                onClick={() => setEditorOpen(true)}
              >
                {dl.goal_new_title}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Sparkles className="w-3.5 h-3.5" />}
                onClick={handleAskAthena}
              >
                {dl.goal_ask_athena}
              </Button>
            </div>
            {/* One-click starter goals — concrete first steps beat a blank form */}
            {activeProjectId && (
              <div className="mt-6 flex flex-col items-center gap-2">
                <p className="typo-caption text-foreground">{dl.goal_starters_label}</p>
                <div className="flex flex-wrap justify-center gap-1.5 max-w-lg">
                  {starters.map((s) => (
                    <button
                      key={s.title}
                      type="button"
                      disabled={starterBusy}
                      onClick={() => void addStarter(s.title, s.desc)}
                      className="px-2.5 py-1 rounded-full border border-violet-500/25 bg-violet-500/5 typo-caption text-foreground hover:bg-violet-500/15 hover:text-violet-200 transition-colors disabled:opacity-50"
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </ContentBody>

      {activeProjectId && (
        <GoalEditorModal
          isOpen={editorOpen}
          onClose={() => setEditorOpen(false)}
          projectId={activeProjectId}
        />
      )}
    </ContentBox>
  );
}

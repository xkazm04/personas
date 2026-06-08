import { useState, useEffect } from 'react';
import { Target, Plus, Sparkles, CheckCircle2 } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { IconGoals } from '@/features/shared/components/layout/sidebar/SidebarIcons';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { obsidianBrainPushGoals } from '@/api/obsidianBrain';
import { LifecycleProjectPicker } from '@/features/plugins/dev-tools/sub_lifecycle/LifecycleProjectPicker';
import GoalConstellation from './GoalConstellation';
import { GoalEditorModal } from './GoalEditorModal';
import { GoalsTimeline } from './GoalsTimeline';
import { isComplete } from './goalStatus';

/** Board preference: whether the Done lane is visible. Hidden by default so
 *  "Your turn" / "Agent's turn" split the full content width. */
const SHOW_DONE_KEY = 'personas.goals.board.showDone';

function readShowDone(): boolean {
  try {
    return localStorage.getItem(SHOW_DONE_KEY) === '1';
  } catch (err) {
    silentCatch('GoalsPage.readShowDone')(err);
    return false;
  }
}

/**
 * Goals — high-level direction surface.
 *
 * Reachable both as a top-level sidebar section and as a Dev Tools L3 tab;
 * both render this same project-scoped view. Layout follows the project-header
 * philosophy: title + project root path + shared LifecycleProjectPicker, plus
 * an authoring entry point (the "+ New goal" button) that opens GoalEditorModal.
 */
export default function GoalsPage() {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const activeProject = useSystemStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId),
  );
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const goals = useSystemStore((s) => s.goals);
  const goalsTab = useSystemStore((s) => s.goalsTab);
  const fetchGoals = useSystemStore((s) => s.fetchGoals);
  const addToast = useToastStore((s) => s.addToast);

  const [editorOpen, setEditorOpen] = useState(false);
  // Board-only: the Done lane is hidden by default (persisted preference).
  const [showDone, setShowDone] = useState(readShowDone);

  const toggleShowDone = () => {
    const next = !showDone;
    setShowDone(next);
    try {
      localStorage.setItem(SHOW_DONE_KEY, next ? '1' : '0');
    } catch (err) {
      silentCatch('GoalsPage.persistShowDone')(err);
    }
  };

  const doneCount = goals.filter((g) => isComplete(g.status)).length;

  // Load goals for the active project at the page level — NOT inside
  // GoalConstellation, which only mounts once goals exist. Fetching here means
  // an empty board still loads goals on refresh (fixes goals vanishing until a
  // manual add re-triggered the fetch).
  useEffect(() => {
    if (activeProjectId) fetchGoals(activeProjectId);
  }, [activeProjectId, fetchGoals]);

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
    useCompanionStore.getState().setPendingPrompt({ text: dl.goal_ask_athena_prompt, autoSend: true });
    useCompanionStore.getState().setState('open');
  };

  return (
    <ContentBox>
      <ContentHeader
        icon={<Target className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.plugins.dev_lifecycle.tab_goals}
        subtitle={activeProject?.root_path ?? '—'}
        actions={
          <div className="flex items-center gap-2">
<Button
              variant="accent"
              accentColor="violet"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              disabled={!activeProjectId}
              onClick={() => setEditorOpen(true)}
            >
              {dl.goal_new_title}
            </Button>
            <LifecycleProjectPicker />
          </div>
        }
      />

      <ContentBody>
        {goalsTab === 'timeline' ? (
          <GoalsTimeline />
        ) : goals.length === 0 ? (
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
            <h3 className="typo-section-title text-foreground">
              {t.plugins.dev_tools.goals_tab_no_goals}
            </h3>
            <p className="typo-body text-foreground mt-1 mb-5 max-w-md">
              {dl.goal_empty_subtitle}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="accent"
                accentColor="violet"
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
          </div>
        ) : (
          <div className="space-y-4 pb-6">
            <div className="flex items-center justify-between">
              <h3 className="typo-caption text-primary uppercase tracking-wider">
                {t.plugins.dev_lifecycle.goal_constellation}({goals.length})
              </h3>
              <div className="flex items-center gap-2">
                {goalsTab === 'board' && (
                  <Tooltip content={showDone ? dl.goal_board_hide_done : tx(dl.goal_board_show_done, { count: doneCount })}>
                    <Button
                      variant="secondary"
                      size="icon-sm"
                      aria-pressed={showDone}
                      aria-label={showDone ? dl.goal_board_hide_done : tx(dl.goal_board_show_done, { count: doneCount })}
                      onClick={toggleShowDone}
                      className={showDone ? 'text-emerald-400' : ''}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </Button>
                  </Tooltip>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSyncToObsidian}
                >
                  {t.plugins.dev_tools.sync_to_obsidian}
                </Button>
              </div>
            </div>
            <GoalConstellation variant={goalsTab as 'board' | 'map'} showDoneLane={showDone} />
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

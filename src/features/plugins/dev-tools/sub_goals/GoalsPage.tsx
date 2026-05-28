import { useState } from 'react';
import { Target, Plus } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { obsidianBrainPushGoals } from '@/api/obsidianBrain';
import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import GoalConstellation from './GoalConstellation';
import { GoalEditorModal } from './GoalEditorModal';

/**
 * Goals — high-level direction surface.
 *
 * Reachable both as a top-level sidebar section and as a Dev Tools L3 tab;
 * both render this same project-scoped view. Layout follows the project-header
 * philosophy: title + project root path + shared LifecycleProjectPicker, plus
 * an authoring entry point (the "+ New goal" button) that opens GoalEditorModal.
 */
export default function GoalsPage() {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const activeProject = useSystemStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId),
  );
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const goals = useSystemStore((s) => s.goals);
  const addToast = useToastStore((s) => s.addToast);

  const [editorOpen, setEditorOpen] = useState(false);

  const handleSyncToObsidian = async () => {
    if (!activeProjectId) return;
    try {
      const result = await obsidianBrainPushGoals(activeProjectId);
      addToast(`Goals synced to Obsidian: ${result.created} created, ${result.updated} updated`, 'success');
    } catch {
      addToast('Obsidian sync failed — configure vault in Obsidian Brain plugin first', 'error');
    }
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
        {goals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Target className="w-10 h-10 text-foreground mb-3" />
            <p className="typo-body text-foreground mb-4">
              {t.plugins.dev_tools.goals_tab_no_goals}
            </p>
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
          </div>
        ) : (
          <div className="space-y-4 pb-6">
            <div className="flex items-center justify-between">
              <h3 className="typo-caption text-primary uppercase tracking-wider">
                {t.plugins.dev_lifecycle.goal_constellation}({goals.length})
              </h3>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSyncToObsidian}
              >
                {t.plugins.dev_tools.sync_to_obsidian}
              </Button>
            </div>
            <GoalConstellation />
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

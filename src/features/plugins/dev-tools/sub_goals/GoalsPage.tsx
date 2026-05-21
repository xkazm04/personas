import { Target } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { obsidianBrainPushGoals } from '@/api/obsidianBrain';
import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import GoalConstellation from './GoalConstellation';

/**
 * Goals — standalone Dev Tools module.
 *
 * Split out of `sub_lifecycle/tabs/GoalsTab` so goal-tracking has its
 * own L3 sidebar entry instead of hiding behind a Lifecycle sub-tab.
 * Layout follows the project-header philosophy used elsewhere in the
 * plugin: title + project root path + shared LifecycleProjectPicker in
 * the actions slot.
 */
export default function GoalsPage() {
  const { t } = useTranslation();
  const activeProject = useSystemStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId),
  );
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const goals = useSystemStore((s) => s.goals);
  const addToast = useToastStore((s) => s.addToast);

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
        actions={<LifecycleProjectPicker />}
      />

      <ContentBody>
        {goals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Target className="w-10 h-10 text-foreground mb-3" />
            <p className="typo-body text-foreground">
              {t.plugins.dev_tools.goals_tab_no_goals}
            </p>
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
    </ContentBox>
  );
}

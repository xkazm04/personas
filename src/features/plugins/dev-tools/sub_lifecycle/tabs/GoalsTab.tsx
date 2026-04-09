import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { obsidianBrainPushGoals } from '@/api/obsidianBrain';
import GoalConstellation from '../GoalConstellation';
import { Target } from 'lucide-react';

export function GoalsTab() {
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const goals = useSystemStore((s) => s.goals);
  const addToast = useToastStore((s) => s.addToast);

  if (goals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Target className="w-10 h-10 text-foreground/20 mb-3" />
        <p className="typo-body text-foreground">
          No goals yet. Create goals in the Projects tab.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-center justify-between">
        <h3 className="typo-caption text-foreground uppercase tracking-wider">
          Goal Constellation ({goals.length})
        </h3>
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            if (!activeProjectId) return;
            try {
              const result = await obsidianBrainPushGoals(activeProjectId);
              addToast(`Goals synced to Obsidian: ${result.created} created, ${result.updated} updated`, 'success');
            } catch {
              addToast('Obsidian sync failed — configure vault in Obsidian Brain plugin first', 'error');
            }
          }}
        >
          Sync to Obsidian
        </Button>
      </div>
      <GoalConstellation />
    </div>
  );
}

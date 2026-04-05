import { Rocket, Plus, BookOpen } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { CARD_CONTAINER } from '@/features/overview/utils/dashboardGrid';

/**
 * Shown to new users when there are no agents and no executions,
 * replacing the data-heavy dashboard grid that would otherwise
 * display blank charts and misleading zero metrics.
 */
export function DashboardEmptyState() {
  return (
    <div className="py-2">
      <div className={`${CARD_CONTAINER} p-8 relative overflow-hidden`}>
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-violet-500/5 pointer-events-none" />
        <div className="relative z-10">
          <EmptyState
            icon={Rocket}
            title="Welcome to Personas"
            subtitle="Create your first agent to start seeing execution metrics, traffic charts, and activity here."
            iconColor="text-indigo-400"
            iconContainerClassName="bg-indigo-500/10 border-indigo-500/20"
            action={{ label: 'Create Persona', onClick: () => useSystemStore.getState().setSidebarSection('personas'), icon: Plus }}
            secondaryAction={{ label: 'From Templates', onClick: () => useSystemStore.getState().setSidebarSection('design-reviews'), icon: BookOpen }}
          />
        </div>
      </div>
    </div>
  );
}

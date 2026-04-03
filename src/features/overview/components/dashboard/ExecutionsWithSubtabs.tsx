import { Suspense, useState, startTransition } from 'react';
import { Activity, Workflow } from 'lucide-react';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import GlobalExecutionList from '@/features/overview/sub_activity/components/GlobalExecutionList';
import { lazyRetry } from '@/lib/lazyRetry';

const WorkflowsDashboard = lazyRetry(() => import('@/features/overview/sub_workflows/components/WorkflowsDashboard'));

type ExecutionSubtab = 'history' | 'workflows';

const SUBTABS: Array<{ id: ExecutionSubtab; label: string; icon: typeof Activity }> = [
  { id: 'history', label: 'History', icon: Activity },
  { id: 'workflows', label: 'Workflows', icon: Workflow },
];

export default function ExecutionsWithSubtabs() {
  const [subtab, setSubtab] = useState<ExecutionSubtab>('history');

  const handleTabSwitch = (id: ExecutionSubtab) => {
    startTransition(() => setSubtab(id));
  };

  const toggleButtons = (
    <>
      {SUBTABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = subtab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => handleTabSwitch(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-colors ${
              isActive
                ? 'bg-primary/10 text-foreground border border-primary/20'
                : 'text-muted-foreground/80 hover:text-muted-foreground bg-secondary/30 hover:bg-secondary/50 border border-primary/15'
            }`}
          >
            <Icon className="w-5 h-5" />
            <span className="text-sm font-medium">{tab.label}</span>
          </button>
        );
      })}
    </>
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      <div
        key={subtab}
        className="animate-fade-slide-in flex-1 min-h-0 flex flex-col"
      >
        {subtab === 'history' ? (
          <GlobalExecutionList headerActions={toggleButtons} />
        ) : (
          <Suspense fallback={<SuspenseFallback />}>
            <WorkflowsDashboard />
          </Suspense>
        )}
      </div>
    </div>
  );
}

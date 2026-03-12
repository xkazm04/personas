import { lazy, Suspense, useState, startTransition } from 'react';
import { Activity, Workflow } from 'lucide-react';
import GlobalExecutionList from '@/features/overview/sub_executions/components/GlobalExecutionList';

// History is the default -- keep eager. Workflows is heavy and lazy-loaded.
const WorkflowsDashboard = lazy(() => import('@/features/overview/sub_workflows/components/WorkflowsDashboard'));

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

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      {/* Subtab bar */}
      <div className="flex items-center gap-1 px-4 md:px-6 py-2 border-b border-primary/10 bg-secondary/10 flex-shrink-0">
        {SUBTABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = subtab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabSwitch(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-primary/10 text-foreground border border-primary/20 shadow-sm'
                  : 'text-muted-foreground/70 hover:text-muted-foreground hover:bg-secondary/40'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {subtab === 'history' ? (
        <GlobalExecutionList />
      ) : (
        <Suspense fallback={null}>
          <WorkflowsDashboard />
        </Suspense>
      )}
    </div>
  );
}

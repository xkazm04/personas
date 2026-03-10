import { useState } from 'react';
import { Activity, Workflow } from 'lucide-react';
<<<<<<< HEAD
import GlobalExecutionList from '@/features/overview/sub_executions/components/GlobalExecutionList';
import WorkflowsDashboard from '@/features/overview/sub_workflows/components/WorkflowsDashboard';
=======
import GlobalExecutionList from '@/features/overview/sub_executions/GlobalExecutionList';
import WorkflowsDashboard from '@/features/overview/sub_workflows/WorkflowsDashboard';
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

type ExecutionSubtab = 'history' | 'workflows';

const SUBTABS: Array<{ id: ExecutionSubtab; label: string; icon: typeof Activity }> = [
  { id: 'history', label: 'History', icon: Activity },
  { id: 'workflows', label: 'Workflows', icon: Workflow },
];

export default function ExecutionsWithSubtabs() {
  const [subtab, setSubtab] = useState<ExecutionSubtab>('history');

  return (
<<<<<<< HEAD
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
=======
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
      {/* Subtab bar */}
      <div className="flex items-center gap-1 px-4 md:px-6 py-2 border-b border-primary/10 bg-secondary/10 flex-shrink-0">
        {SUBTABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = subtab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSubtab(tab.id)}
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
      {subtab === 'history' ? <GlobalExecutionList /> : <WorkflowsDashboard />}
    </div>
  );
}

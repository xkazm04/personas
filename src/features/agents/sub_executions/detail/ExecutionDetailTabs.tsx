import { ListTree, Search, Activity, Zap, Play } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { isTerminalState } from '@/lib/execution/executionState';

export type DetailTab = 'detail' | 'inspector' | 'trace' | 'pipeline' | 'replay';

interface ExecutionDetailTabsProps {
  activeTab: DetailTab;
  setActiveTab: (tab: DetailTab) => void;
  hasToolSteps: boolean;
  executionStatus: string;
}

export function ExecutionDetailTabs({ activeTab, setActiveTab, hasToolSteps, executionStatus }: ExecutionDetailTabsProps) {
  const { t } = useTranslation();
  const tabClass = (tab: DetailTab, special?: boolean) =>
    `flex items-center gap-2 px-3 py-1.5 rounded-modal typo-heading transition-all ${
      activeTab === tab
        ? special
          ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25'
          : 'bg-primary/15 text-foreground/90 border border-primary/30'
        : 'text-foreground hover:text-foreground/95 border border-transparent'
    }`;

  return (
    <div className="flex gap-1 p-1 rounded-modal bg-secondary/40 border border-primary/10 w-fit">
      <button onClick={() => setActiveTab('detail')} className={tabClass('detail')}>
        <ListTree className="w-3.5 h-3.5" />
        {t.agents.executions.tab_detail}
      </button>
      {hasToolSteps && (
        <button onClick={() => setActiveTab('inspector')} className={tabClass('inspector')}>
          <Search className="w-3.5 h-3.5" />
          {t.agents.executions.tab_inspector}
        </button>
      )}
      <button onClick={() => setActiveTab('trace')} className={tabClass('trace')}>
        <Activity className="w-3.5 h-3.5" />
        {t.agents.executions.tab_trace}
      </button>
      <button onClick={() => setActiveTab('pipeline')} className={tabClass('pipeline')}>
        <Zap className="w-3.5 h-3.5" />
        {t.agents.executions.tab_pipeline}
      </button>
      {isTerminalState(executionStatus) && (
        <button onClick={() => setActiveTab('replay')} className={tabClass('replay', true)}>
          <Play className="w-3.5 h-3.5" />
          {t.agents.executions.tab_replay}
        </button>
      )}
    </div>
  );
}

import { Activity, RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ActiveChainsBadge } from '../sub_executions/components/ActiveChainsBadge';

interface ActivityHeaderProps {
  personaId: string;
  itemCount: number;
  isLoading: boolean;
  onRefresh: () => void;
}

export function ActivityHeader({ itemCount, isLoading, onRefresh }: ActivityHeaderProps) {
  const { t, tx } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-400" />
          <h3 className="typo-heading text-foreground/90">{t.agents.activity.title}</h3>
          <span className="typo-body text-foreground">{tx(t.agents.activity.items, { count: itemCount })}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            aria-label={t.common.refresh}
            aria-busy={isLoading || undefined}
            className="p-1.5 rounded-card text-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            title={t.common.refresh}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      {/* Chains in flight. Lives on the tab's permanent chrome rather than
          inside the runs region, so a chain running right now is visible from
          every Activity tab — not only from the one that lists runs. Renders
          NOTHING when nothing is in flight, so it costs no pixels when idle;
          `ExecutionList` is told not to mount its own copy (see ActivityTab). */}
      <ActiveChainsBadge />
    </div>
  );
}

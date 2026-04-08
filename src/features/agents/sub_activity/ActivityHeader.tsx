import { Activity, RefreshCw } from 'lucide-react';

interface ActivityHeaderProps {
  personaId: string;
  itemCount: number;
  isLoading: boolean;
  onRefresh: () => void;
}

export function ActivityHeader({ itemCount, isLoading, onRefresh }: ActivityHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-blue-400" />
        <h3 className="typo-heading text-foreground/90">Activity</h3>
        <span className="text-sm text-muted-foreground/60">{itemCount} items</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onRefresh}
          className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-secondary/50 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  );
}

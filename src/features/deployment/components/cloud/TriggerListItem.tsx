import {
  ChevronDown,
  ChevronRight,
  Play,
  Pause,
  Trash2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { CloudTrigger, CloudTriggerFiring } from '@/api/system/cloud';
import {
  triggerTypeLabel,
  triggerTypeIcon,
  healthBadge,
  timeAgo,
  formatCost,
  parseConfig,
} from './cloudSchedulesHelpers';

interface TriggerListItemProps {
  trigger: CloudTrigger;
  isExpanded: boolean;
  firings: CloudTriggerFiring[];
  isLoadingFirings: boolean;
  personaName: string;
  onToggleExpand: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
}

export function TriggerListItem({
  trigger,
  isExpanded,
  firings,
  isLoadingFirings,
  personaName,
  onToggleExpand,
  onToggleEnabled,
  onDelete,
}: TriggerListItemProps) {
  const config = parseConfig(trigger.config) as Record<string, string>;

  return (
    <div className="rounded-lg bg-secondary/30 border border-primary/10 overflow-hidden">
      {/* Row */}
      <button
        type="button"
        onClick={onToggleExpand}
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-secondary/50 transition-colors cursor-pointer"
      >
        {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/60" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" />}
        <span className={`${trigger.enabled ? 'text-indigo-400' : 'text-muted-foreground/50'}`}>
          {triggerTypeIcon(trigger.trigger_type)}
        </span>
        <span className="text-sm text-foreground/80 truncate flex-1">
          {personaName}
          <span className="text-muted-foreground/50 ml-2">{triggerTypeLabel(trigger.trigger_type)}</span>
        </span>
        {config.cron && (
          <span className="text-xs font-mono text-muted-foreground/60 bg-secondary/50 px-1.5 py-0.5 rounded">
            {`${config.cron}`}
          </span>
        )}
        {healthBadge(trigger.health_status)}
        <span className={`w-2 h-2 rounded-full ${trigger.enabled ? 'bg-emerald-400' : 'bg-muted-foreground/30'}`} title={trigger.enabled ? 'Enabled' : 'Disabled'} />
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-primary/10 space-y-3">
          {/* Trigger info */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-muted-foreground/60">Type:</span> <span className="text-foreground/80">{triggerTypeLabel(trigger.trigger_type)}</span></div>
            <div><span className="text-muted-foreground/60">Status:</span> <span className="text-foreground/80">{trigger.enabled ? 'Enabled' : 'Disabled'}</span></div>
            <div><span className="text-muted-foreground/60">Last triggered:</span> <span className="text-foreground/80">{timeAgo(trigger.last_triggered_at)}</span></div>
            <div><span className="text-muted-foreground/60">Next trigger:</span> <span className="text-foreground/80">{trigger.next_trigger_at ? new Date(trigger.next_trigger_at).toLocaleString() : '-'}</span></div>
            {config.cron && <div className="col-span-2"><span className="text-muted-foreground/60">Cron:</span> <span className="text-foreground/80 font-mono">{`${config.cron}`}</span></div>}
            {trigger.health_message && (
              <div className="col-span-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/10 text-xs text-amber-400">
                {trigger.health_message}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleEnabled}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${
                trigger.enabled
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/15'
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15'
              }`}
            >
              {trigger.enabled ? <><Pause className="w-3 h-3" /> Pause</> : <><Play className="w-3 h-3" /> Enable</>}
            </button>
            <button
              onClick={onDelete}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/15 transition-colors"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>

          {/* Recent firings */}
          <div>
            <h4 className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider mb-2">
              Recent Firings
            </h4>
            {isLoadingFirings ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground/50 py-2">
                <LoadingSpinner size="xs" /> Loading...
              </div>
            ) : firings.length === 0 ? (
              <p className="text-xs text-muted-foreground/50">No firings recorded yet.</p>
            ) : (
              <div className="space-y-1">
                {firings.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg bg-secondary/20 border border-primary/5">
                    {f.status === 'completed' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> :
                     f.status === 'failed' ? <XCircle className="w-3 h-3 text-red-400" /> :
                     <LoadingSpinner size="xs" className="text-blue-400" />}
                    <span className="text-muted-foreground/70">{f.status}</span>
                    <span className="text-muted-foreground/50 flex-1">{timeAgo(f.fired_at)}</span>
                    {f.duration_ms != null && <span className="text-muted-foreground/50">{f.duration_ms < 1000 ? `${f.duration_ms}ms` : `${(f.duration_ms / 1000).toFixed(1)}s`}</span>}
                    <span className="text-muted-foreground/50">{formatCost(f.cost_usd)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

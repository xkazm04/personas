import { useTranslation } from '@/i18n/useTranslation';
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
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
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
  const { t } = useTranslation();
  const dt = t.deployment.schedules;
  const config = parseConfig(trigger.config) as Record<string, string>;

  return (
    <div className="rounded-card bg-secondary/30 border border-primary/10 overflow-hidden">
      {/* Row */}
      <button
        type="button"
        onClick={onToggleExpand}
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-secondary/50 transition-colors cursor-pointer"
      >
        {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-foreground" />}
        <span className={`${trigger.enabled ? 'text-indigo-400' : 'text-foreground'}`}>
          {triggerTypeIcon(trigger.trigger_type)}
        </span>
        <span className="typo-body text-foreground truncate flex-1">
          {personaName}
          <span className="text-foreground ml-2">{triggerTypeLabel(trigger.trigger_type)}</span>
        </span>
        {config.cron && (
          <span className="typo-code font-mono text-foreground bg-secondary/50 px-1.5 py-0.5 rounded">
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
          <div className="grid grid-cols-2 gap-2 typo-caption">
            <div><span className="text-foreground">{dt.label_type}</span> <span className="text-foreground">{triggerTypeLabel(trigger.trigger_type)}</span></div>
            <div><span className="text-foreground">{dt.label_status}</span> <span className="text-foreground">{trigger.enabled ? 'Enabled' : 'Disabled'}</span></div>
            <div><span className="text-foreground">{dt.label_last_triggered}</span> <span className="text-foreground">{timeAgo(trigger.last_triggered_at)}</span></div>
            <div><span className="text-foreground">{dt.label_next_trigger}</span> <span className="text-foreground">{trigger.next_trigger_at ? new Date(trigger.next_trigger_at).toLocaleString() : '-'}</span></div>
            {config.cron && <div className="col-span-2"><span className="text-foreground">{dt.label_cron}</span> <span className="text-foreground font-mono">{`${config.cron}`}</span></div>}
            {trigger.health_message && (
              <div className="col-span-2 p-2 rounded-card bg-amber-500/5 border border-amber-500/10 typo-caption text-amber-400">
                {trigger.health_message}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleEnabled}
              className={`flex items-center gap-1.5 px-2.5 py-1 typo-caption font-medium rounded-card border transition-colors ${
                trigger.enabled
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/15'
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15'
              }`}
            >
              {trigger.enabled ? <><Pause className="w-3 h-3" /> Pause</> : <><Play className="w-3 h-3" /> Enable</>}
            </button>
            <button
              onClick={onDelete}
              className="flex items-center gap-1.5 px-2.5 py-1 typo-caption font-medium rounded-card bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/15 transition-colors"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>

          {/* Recent firings */}
          <div>
            <SectionHeading as="h4" className="typo-caption text-foreground mb-2">{dt.recent_firings}</SectionHeading>
            {isLoadingFirings ? (
              <div className="flex items-center gap-2 typo-caption text-foreground py-2">
                <LoadingSpinner size="xs" /> {dt.loading_firings}
              </div>
            ) : firings.length === 0 ? (
              <p className="typo-caption text-foreground">{dt.no_firings}</p>
            ) : (
              <div className="space-y-1">
                {firings.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 typo-caption px-2 py-1.5 rounded-card bg-secondary/20 border border-primary/5">
                    {f.status === 'completed' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> :
                     f.status === 'failed' ? <XCircle className="w-3 h-3 text-red-400" /> :
                     <LoadingSpinner size="xs" className="text-blue-400" />}
                    <span className="text-foreground">{f.status}</span>
                    <span className="text-foreground flex-1">{timeAgo(f.fired_at)}</span>
                    {f.duration_ms != null && <span className="text-foreground">{f.duration_ms < 1000 ? `${f.duration_ms}ms` : `${(f.duration_ms / 1000).toFixed(1)}s`}</span>}
                    <span className="text-foreground">{formatCost(f.cost_usd)}</span>
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

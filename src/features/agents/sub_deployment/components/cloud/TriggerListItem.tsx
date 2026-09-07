import { useTranslation } from '@/i18n/useTranslation';
import {
  ChevronDown,
  ChevronRight,
  Play,
  Pause,
  Trash2,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { AsyncButton } from '@/features/shared/components/buttons';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { statusIcon } from './CloudHistoryHelpers';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { Numeric } from '@/features/shared/components/display/Numeric';
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
  /** Return the request's promise: the control stays disarmed until it settles. */
  onToggleEnabled: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
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
          {triggerTypeIcon(trigger.triggerType)}
        </span>
        <span className="typo-body text-foreground truncate flex-1">
          {personaName}
          <span className="text-foreground ml-2">{triggerTypeLabel(t, trigger.triggerType)}</span>
        </span>
        {config.cron && (
          <span className="typo-code font-mono text-foreground bg-secondary/50 px-1.5 py-0.5 rounded">
            {`${config.cron}`}
          </span>
        )}
        {healthBadge(t, trigger.healthStatus)}
        <span className={`w-2 h-2 rounded-full ${trigger.enabled ? 'bg-emerald-400' : 'bg-muted-foreground/30'}`} title={trigger.enabled ? t.common.enabled : t.common.disabled} />
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-primary/10 space-y-3">
          {/* Trigger info */}
          <div className="grid grid-cols-2 gap-2 typo-caption">
            <div><span className="text-foreground">{dt.label_type}</span> <span className="text-foreground">{triggerTypeLabel(t, trigger.triggerType)}</span></div>
            <div><span className="text-foreground">{dt.label_status}</span> <span className="text-foreground">{trigger.enabled ? t.common.enabled : t.common.disabled}</span></div>
            <div><span className="text-foreground">{dt.label_last_triggered}</span> <span className="text-foreground">{timeAgo(trigger.lastTriggeredAt)}</span></div>
            <div><span className="text-foreground">{dt.label_next_trigger}</span> <span className="text-foreground"><AbsoluteTime timestamp={trigger.nextTriggerAt} /></span></div>
            {config.cron && <div className="col-span-2"><span className="text-foreground">{dt.label_cron}</span> <span className="text-foreground font-mono">{`${config.cron}`}</span></div>}
            {trigger.healthMessage && (
              <div className="col-span-2 p-2 rounded-card bg-amber-500/5 border border-amber-500/10 typo-caption text-amber-400">
                {trigger.healthMessage}
              </div>
            )}
          </div>

          {/* Actions - remote writes against the orchestrator. AsyncButton
              disarms from click to acknowledgment (the promise the handler
              returns), so an impatient second click cannot fire a second
              delete or flip the trigger back. Until 2026-09-07 these were
              plain buttons with no in-flight state at all. Registry
              technique: remote-action-consent (in-flight disarm). */}
          <div className="flex items-center gap-2">
            <AsyncButton
              variant="secondary"
              size="xs"
              icon={trigger.enabled ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              onClick={onToggleEnabled}
              data-testid={`cloud-trigger-toggle-${trigger.id}`}
            >
              {trigger.enabled ? t.deployment.dashboard.action_pause : t.deployment.dashboard.action_resume}
            </AsyncButton>
            <AsyncButton
              variant="danger"
              size="xs"
              icon={<Trash2 className="w-3 h-3" />}
              onClick={onDelete}
              data-testid={`cloud-trigger-delete-${trigger.id}`}
            >
              {t.common.delete}
            </AsyncButton>
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
                    {/* Same status table as the execution rows: a firing the
                        orchestrator reports as `error` or `cancelled` was
                        painted here as still in flight. */}
                    {statusIcon(f.status)}
                    <span className="text-foreground">{f.status}</span>
                    <span className="text-foreground flex-1">{timeAgo(f.firedAt)}</span>
                    {f.durationMs != null && <Numeric value={Number(f.durationMs)} unit="ms" className="text-foreground" />}
                    <span className="text-foreground">{formatCost(f.costUsd)}</span>
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

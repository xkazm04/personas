import { useState } from 'react';
import {
  Play, Clock, Settings2, Pause, ToggleLeft, ToggleRight,
  CheckCircle2, AlertTriangle, XCircle,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { ScheduleEntry } from '../libs/scheduleHelpers';
import { formatRelative } from '../libs/scheduleHelpers';
import FrequencyEditor from './FrequencyEditor';
import { useThemeStore } from '@/stores/themeStore';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';

interface ScheduleRowProps {
  entry: ScheduleEntry;
  existingEntries?: ScheduleEntry[];
  isExecuting: boolean;
  isEditing: boolean;
  onManualExecute: () => void;
  onToggleEnabled: () => void;
  onUpdateFrequency: (cron: string | null, intervalSeconds: number | null) => void;
  onPreviewCron: (expression: string) => Promise<import('@/api/pipeline/triggers').CronPreview | null>;
}

const HEALTH_CONFIG = {
  healthy: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10', accent: 'border-l-emerald-500/60', label: 'Healthy' },
  degraded: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10', accent: 'border-l-amber-500/60', label: 'Degraded' },
  failing: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', accent: 'border-l-red-500/60', label: 'Failing' },
  paused: { icon: Pause, color: 'text-muted-foreground/50', bg: 'bg-primary/5', accent: 'border-l-primary/20', label: 'Paused' },
  idle: { icon: Clock, color: 'text-muted-foreground/50', bg: 'bg-primary/5', accent: 'border-l-primary/20', label: 'Idle' },
} as const;

export default function ScheduleRow({
  entry,
  existingEntries,
  isExecuting,
  isEditing,
  onManualExecute,
  onToggleEnabled,
  onUpdateFrequency,
  onPreviewCron,
}: ScheduleRowProps) {
  const [showFreqEditor, setShowFreqEditor] = useState(false);
  const timezone = useThemeStore((s) => s.timezone);
  const tzLabel = timezone === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone.split('/').pop()?.replace(/_/g, ' ') || 'Local'
    : timezone === 'utc' ? 'UTC'
      : timezone.split('/').pop()?.replace(/_/g, ' ') || timezone;
  const { agent, schedule, health, nextRun, lastRun } = entry;
  const disabled = health === 'paused';

  const { icon: HealthIcon, color: healthColor, accent: healthAccent, label: healthLabel } = HEALTH_CONFIG[health];

  return (
    <>
      <div className={`group flex items-center gap-3 px-4 py-3 rounded-xl border border-l-[3px] transition-all ${healthAccent} ${disabled
          ? 'border-primary/5 bg-primary/[0.02] opacity-60'
          : 'border-primary/10 bg-primary/[0.03] hover:bg-primary/[0.05] hover:border-primary/20'
        }`}>
        {/* Agent icon */}
        <PersonaIcon icon={agent.persona_icon} color={agent.persona_color} display="framed" frameSize={"lg"} />

        {/* Name + schedule */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="typo-heading text-foreground/90 truncate">
              {agent.persona_name}
            </span>
            {agent.headless && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
                headless
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-foreground/70 mt-0.5">
            <Clock className="w-3 h-3 shrink-0" />
            <span className="font-mono text-xs text-foreground/80">{schedule}</span>
            {agent.cron_expression && (
              <span className="text-amber-400/50 text-[10px] font-medium">{tzLabel}</span>
            )}
            {agent.description && (
              <>
                <span className="text-muted-foreground/30">·</span>
                <span className="truncate max-w-[200px]">{agent.description}</span>
              </>
            )}
          </div>
        </div>

        {/* Next / last run */}
        <div className="text-right shrink-0 min-w-[90px]">
          {nextRun ? (
            <div className="text-xs text-foreground/70">
              <span className="text-foreground/50">next </span>
              {formatRelative(nextRun.toISOString())}
            </div>
          ) : (
            <div className="text-xs text-foreground/40">--</div>
          )}
          {lastRun && (
            <div className="text-[10px] text-foreground/50 mt-0.5">
              last {formatRelative(lastRun.toISOString())}
            </div>
          )}
        </div>

        {/* Health indicator */}
        <div className="flex items-center gap-1.5 shrink-0" title={healthLabel}>
          <HealthIcon className={`w-4 h-4 ${healthColor}`} />
          <div className="flex flex-col items-end">
            {agent.recent_executions > 0 && (
              <span className={`text-xs font-mono ${healthColor}`}>
                {agent.recent_executions - agent.recent_failures}/{agent.recent_executions}
              </span>
            )}
            <span className={`text-[9px] tracking-wide uppercase ${healthColor} opacity-70`}>
              {healthLabel}
            </span>
          </div>
        </div>

        {/* Action panel */}
        <div className="flex items-center gap-0.5 shrink-0 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Manual execute */}
          <button
            onClick={onManualExecute}
            disabled={isExecuting || disabled}
            className="p-2 rounded-lg hover:bg-emerald-500/15 text-muted-foreground/70 hover:text-emerald-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Run now"
          >
            {isExecuting ? (
              <LoadingSpinner size="sm" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </button>

          {/* Change frequency */}
          <button
            onClick={() => setShowFreqEditor(true)}
            disabled={isEditing}
            className="p-2 rounded-lg hover:bg-blue-500/15 text-muted-foreground/70 hover:text-blue-400 transition-colors disabled:opacity-40"
            title="Change frequency"
          >
            <Settings2 className="w-4 h-4" />
          </button>

          {/* Toggle enabled */}
          <button
            onClick={onToggleEnabled}
            className="p-2 rounded-lg hover:bg-secondary/60 transition-colors"
            title={agent.trigger_enabled ? 'Pause schedule' : 'Resume schedule'}
          >
            {agent.trigger_enabled ? (
              <ToggleRight className="w-5 h-5 text-emerald-400" />
            ) : (
              <ToggleLeft className="w-5 h-5 text-muted-foreground/60" />
            )}
          </button>
        </div>
      </div>

      {/* Frequency editor modal */}
      {showFreqEditor && (
        <FrequencyEditor
          agent={agent}
          currentSchedule={schedule}
          existingEntries={existingEntries}
          onSave={(cron, interval) => {
            onUpdateFrequency(cron, interval);
            setShowFreqEditor(false);
          }}
          onCancel={() => setShowFreqEditor(false)}
          onPreviewCron={onPreviewCron}
        />
      )}
    </>
  );
}

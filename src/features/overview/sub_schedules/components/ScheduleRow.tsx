import { useState } from 'react';
import {
  Play, Clock, Settings2, Pause, ToggleLeft, ToggleRight,
  Bot, CheckCircle2, AlertTriangle, XCircle, Loader2,
} from 'lucide-react';
import type { ScheduleEntry } from '../libs/scheduleHelpers';
import { formatRelative } from '../libs/scheduleHelpers';
import FrequencyEditor from './FrequencyEditor';

interface ScheduleRowProps {
  entry: ScheduleEntry;
  isExecuting: boolean;
  isEditing: boolean;
  onManualExecute: () => void;
  onToggleEnabled: () => void;
  onUpdateFrequency: (cron: string | null, intervalSeconds: number | null) => void;
  onPreviewCron: (expression: string) => Promise<import('@/api/pipeline/triggers').CronPreview | null>;
}

const HEALTH_CONFIG = {
  healthy:  { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  degraded: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  failing:  { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
  paused:   { icon: Pause, color: 'text-muted-foreground/50', bg: 'bg-primary/5' },
  idle:     { icon: Clock, color: 'text-muted-foreground/50', bg: 'bg-primary/5' },
} as const;

export default function ScheduleRow({
  entry,
  isExecuting,
  isEditing,
  onManualExecute,
  onToggleEnabled,
  onUpdateFrequency,
  onPreviewCron,
}: ScheduleRowProps) {
  const [showFreqEditor, setShowFreqEditor] = useState(false);
  const { agent, schedule, health, nextRun, lastRun } = entry;
  const disabled = health === 'paused';

  const { icon: HealthIcon, color: healthColor } = HEALTH_CONFIG[health];

  return (
    <>
      <div className={`group flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
        disabled
          ? 'border-primary/5 bg-primary/[0.02] opacity-60'
          : 'border-primary/10 bg-primary/[0.03] hover:bg-primary/[0.05] hover:border-primary/20'
      }`}>
        {/* Agent icon */}
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center text-sm shrink-0 border"
          style={{
            backgroundColor: agent.persona_color ? `${agent.persona_color}15` : 'var(--color-primary-5)',
            borderColor: agent.persona_color ? `${agent.persona_color}30` : 'var(--color-primary-10)',
            color: agent.persona_color || 'var(--color-muted-foreground)',
          }}
        >
          {agent.persona_icon || <Bot className="w-4 h-4" />}
        </div>

        {/* Name + schedule */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground/90 truncate">
              {agent.persona_name}
            </span>
            {agent.headless && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
                headless
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground/70 mt-0.5">
            <Clock className="w-3 h-3 shrink-0" />
            <span className="font-mono text-xs">{schedule}</span>
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
            <div className="text-xs text-muted-foreground/70">
              <span className="text-muted-foreground/40">next </span>
              {formatRelative(nextRun.toISOString())}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground/40">--</div>
          )}
          {lastRun && (
            <div className="text-[10px] text-muted-foreground/40 mt-0.5">
              last {formatRelative(lastRun.toISOString())}
            </div>
          )}
        </div>

        {/* Health indicator */}
        <div className="flex items-center gap-1.5 shrink-0">
          <HealthIcon className={`w-4 h-4 ${healthColor}`} />
          {agent.recent_executions > 0 && (
            <span className={`text-xs font-mono ${healthColor}`}>
              {agent.recent_executions - agent.recent_failures}/{agent.recent_executions}
            </span>
          )}
        </div>

        {/* Action panel */}
        <div className="flex items-center gap-1 shrink-0 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Manual execute */}
          <button
            onClick={onManualExecute}
            disabled={isExecuting || disabled}
            className="p-1.5 rounded-lg hover:bg-emerald-500/15 text-muted-foreground/70 hover:text-emerald-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Run now"
          >
            {isExecuting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Change frequency */}
          <button
            onClick={() => setShowFreqEditor(true)}
            disabled={isEditing}
            className="p-1.5 rounded-lg hover:bg-blue-500/15 text-muted-foreground/70 hover:text-blue-400 transition-colors disabled:opacity-40"
            title="Change frequency"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>

          {/* Toggle enabled */}
          <button
            onClick={onToggleEnabled}
            className="p-1.5 rounded-lg hover:bg-secondary/60 transition-colors"
            title={agent.trigger_enabled ? 'Pause schedule' : 'Resume schedule'}
          >
            {agent.trigger_enabled ? (
              <ToggleRight className="w-4 h-4 text-emerald-400" />
            ) : (
              <ToggleLeft className="w-4 h-4 text-muted-foreground/60" />
            )}
          </button>
        </div>
      </div>

      {/* Frequency editor modal */}
      {showFreqEditor && (
        <FrequencyEditor
          agent={agent}
          currentSchedule={schedule}
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

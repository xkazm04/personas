import { useEffect, useRef, useState } from 'react';
import {
  Play, Clock, Settings2, Pause, ToggleLeft, ToggleRight,
  CheckCircle2, AlertTriangle, XCircle, History, ChevronDown, SkipForward, Timer,
  ChevronRight,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { ScheduleEntry } from '../libs/scheduleHelpers';
import { formatRelative } from '../libs/scheduleHelpers';
import FrequencyEditor from './FrequencyEditor';
import BackfillModal from './BackfillModal';
import { ScheduleRowHistoryPanel } from './ScheduleRowHistoryPanel';
import type { BackfillResult } from '@/api/pipeline/scheduler';
import { useThemeStore } from '@/stores/themeStore';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { useTranslation } from '@/i18n/useTranslation';

interface ScheduleRowProps {
  entry: ScheduleEntry;
  existingEntries?: ScheduleEntry[];
  isExecuting: boolean;
  isEditing: boolean;
  isBackfilling: boolean;
  lastBackfill: BackfillResult | null;
  onManualExecute: () => void;
  onToggleEnabled: () => void;
  onUpdateFrequency: (cron: string | null, intervalSeconds: number | null, timezone?: string) => void;
  onBackfill: (startIso: string, endIso: string) => Promise<void>;
  onPreviewCron: (expression: string, timezone?: string) => Promise<import('@/api/pipeline/triggers').CronPreview | null>;
  onSkipNextFire: () => void;
  onRunIn: (delayMs: number) => void;
}

export default function ScheduleRow({
  entry,
  existingEntries,
  isExecuting,
  isEditing,
  isBackfilling,
  lastBackfill,
  onManualExecute,
  onToggleEnabled,
  onUpdateFrequency,
  onBackfill,
  onPreviewCron,
  onSkipNextFire,
  onRunIn,
}: ScheduleRowProps) {
  const { t } = useTranslation();

  const HEALTH_CONFIG = {
    healthy: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10', accent: 'border-l-emerald-500/60', label: t.schedules.healthy },
    degraded: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10', accent: 'border-l-amber-500/60', label: t.schedules.degraded },
    failing: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', accent: 'border-l-red-500/60', label: t.schedules.failing },
    paused: { icon: Pause, color: 'text-foreground', bg: 'bg-primary/5', accent: 'border-l-primary/20', label: t.schedules.paused },
    idle: { icon: Clock, color: 'text-foreground', bg: 'bg-primary/5', accent: 'border-l-primary/20', label: t.schedules.idle },
  } as const;

  const [showFreqEditor, setShowFreqEditor] = useState(false);
  const [showBackfill, setShowBackfill] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const advancedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showAdvanced) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (advancedRef.current && !advancedRef.current.contains(e.target as Node)) {
        setShowAdvanced(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowAdvanced(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showAdvanced]);
  const timezone = useThemeStore((s) => s.timezone);
  const tzLabel = timezone === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone.split('/').pop()?.replace(/_/g, ' ') || 'Local'
    : timezone === 'utc' ? 'UTC'
      : timezone.split('/').pop()?.replace(/_/g, ' ') || timezone;
  const { agent, schedule, health, nextRun, lastRun } = entry;
  const canBackfill = !!agent.cron_expression || !!agent.interval_seconds;
  const disabled = health === 'paused';

  const { icon: HealthIcon, color: healthColor, accent: healthAccent, label: healthLabel } = HEALTH_CONFIG[health];

  return (
    <>
      {/* content-visibility:auto lets the browser skip layout+paint of rows
          scrolled out of view — the schedules list is unvirtualized and grows
          with cron-agent count (5000+ DOM nodes at scale). contain-intrinsic-size
          'auto 64px' gives a placeholder height (remembered once measured) so the
          scrollbar stays correct. Architect perf follow-up (2026-05-30 perf-walk:
          L1/schedules DOM ~10×). */}
      <div className={`group border border-l-[3px] [content-visibility:auto] [contain-intrinsic-size:auto_64px] transition-all ${healthAccent} ${
        showHistory ? 'rounded-modal' : 'rounded-modal'
      } ${
        disabled
          ? 'border-primary/5 bg-primary/[0.02] opacity-60'
          : 'border-primary/10 bg-primary/[0.03] hover:bg-primary/[0.05] hover:border-primary/20'
      }`}>
      <div className="flex items-center gap-3 px-4 py-3">
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
          <div className="flex items-center gap-2 typo-caption text-foreground mt-0.5">
            <Clock className="w-3 h-3 shrink-0" />
            <span className="font-mono typo-code text-foreground">{schedule}</span>
            {agent.cron_expression && (
              <span className="text-amber-400/50 text-[10px] font-medium">{tzLabel}</span>
            )}
            {agent.description && (
              <>
                <span className="text-foreground">·</span>
                <span className="truncate max-w-[200px]">{agent.description}</span>
              </>
            )}
            {lastBackfill && lastBackfill.slotsEnqueued > 0 && (
              <>
                <span className="text-foreground">·</span>
                <span
                  className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                    lastBackfill.capped
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  }`}
                  title={t.schedules.backfill_inline_tooltip}
                >
                  <History className="w-2.5 h-2.5 inline mr-0.5" />
                  +{lastBackfill.slotsEnqueued}
                  {lastBackfill.capped ? '*' : ''}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Next / last run */}
        <div className="text-right shrink-0 min-w-[90px]">
          {nextRun ? (
            <div className="typo-caption text-foreground">
              <span className="text-foreground">next </span>
              {formatRelative(nextRun.toISOString())}
            </div>
          ) : (
            <div className="typo-caption text-foreground">--</div>
          )}
          {lastRun && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowHistory((v) => !v); }}
              aria-expanded={showHistory}
              aria-label={showHistory ? t.schedules.recent_runs_hide_aria : t.schedules.recent_runs_aria}
              className="inline-flex items-center gap-1 text-[10px] text-foreground mt-0.5 hover:text-foreground/80 transition-colors group/peek"
            >
              <ChevronRight className={`w-2.5 h-2.5 transition-transform ${showHistory ? 'rotate-90' : ''} text-foreground group-hover/peek:text-foreground/80`} />
              <span>last {formatRelative(lastRun.toISOString())}</span>
            </button>
          )}
        </div>

        {/* Health indicator */}
        <div className="flex items-center gap-1.5 shrink-0" title={healthLabel}>
          <HealthIcon className={`w-4 h-4 ${healthColor}`} />
          <div className="flex flex-col items-end">
            {agent.recent_executions > 0 && (
              <span className={`typo-code font-mono ${healthColor}`}>
                {agent.recent_executions - agent.recent_failures}/{agent.recent_executions}
              </span>
            )}
            <span className={`text-[9px] tracking-wide uppercase ${healthColor} opacity-70`}>
              {healthLabel}
            </span>
          </div>
        </div>

        {/* Action panel */}
        <div className="flex items-center gap-0.5 shrink-0 ml-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {/* Manual execute + advanced-actions caret (segmented) */}
          <div className="relative inline-flex" ref={advancedRef}>
            <button
              onClick={onManualExecute}
              disabled={isExecuting || disabled}
              className="p-2 rounded-l-card hover:bg-emerald-500/15 text-foreground hover:text-emerald-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={t.schedules.run_now}
            >
              {isExecuting ? (
                <LoadingSpinner size="sm" />
              ) : (
                <Play className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              disabled={disabled}
              aria-haspopup="menu"
              aria-expanded={showAdvanced}
              aria-label={t.schedules.advanced_actions_aria}
              className={`px-1 py-2 rounded-r-card border-l border-primary/10 text-foreground hover:bg-emerald-500/15 hover:text-emerald-400 transition-colors disabled:opacity-40 ${
                showAdvanced ? 'bg-emerald-500/10 text-emerald-400' : ''
              }`}
              title={t.schedules.more_actions}
            >
              <ChevronDown className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            </button>
            {showAdvanced && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 w-[224px] rounded-card border border-primary/15 bg-background shadow-elevation-3 z-20 overflow-hidden"
              >
                <button
                  role="menuitem"
                  onClick={() => { setShowAdvanced(false); onSkipNextFire(); }}
                  disabled={!entry.nextRun || disabled}
                  className="w-full flex items-start gap-2 px-3 py-2 text-left typo-caption hover:bg-secondary/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <SkipForward className="w-3.5 h-3.5 mt-0.5 shrink-0 text-foreground" />
                  <span className="flex-1">
                    <span className="block text-foreground/90 font-medium">{t.schedules.skip_next_fire}</span>
                    <span className="block text-[10px] text-foreground mt-0.5 leading-snug">
                      {t.schedules.skip_next_fire_hint}
                    </span>
                  </span>
                </button>
                <div className="border-t border-primary/10" />
                <div className="px-3 pt-2 pb-1 flex items-center gap-1.5">
                  <Timer className="w-3 h-3 text-foreground" />
                  <span className="text-[10px] uppercase tracking-wider text-foreground">
                    {t.schedules.delayed_run_heading}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 px-2 pb-1">
                  {[
                    { label: t.schedules.run_in_5min, ms: 5 * 60_000 },
                    { label: t.schedules.run_in_15min, ms: 15 * 60_000 },
                    { label: t.schedules.run_in_30min, ms: 30 * 60_000 },
                    { label: t.schedules.run_in_1h, ms: 60 * 60_000 },
                  ].map((opt) => (
                    <button
                      key={opt.ms}
                      role="menuitem"
                      onClick={() => { setShowAdvanced(false); onRunIn(opt.ms); }}
                      disabled={disabled}
                      className="px-2 py-1.5 typo-caption rounded-card bg-secondary/40 hover:bg-emerald-500/15 hover:text-emerald-400 text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="px-3 pb-2 text-[10px] text-foreground leading-snug">
                  {t.schedules.delayed_run_hint}
                </p>
              </div>
            )}
          </div>

          {/* Backfill missed runs */}
          {canBackfill && (
            <button
              onClick={() => setShowBackfill(true)}
              disabled={isBackfilling || disabled}
              className="p-2 rounded-card hover:bg-amber-500/15 text-foreground hover:text-amber-400 transition-colors disabled:opacity-40"
              title={t.schedules.backfill_tooltip}
            >
              {isBackfilling ? (
                <LoadingSpinner size="sm" />
              ) : (
                <History className="w-4 h-4" />
              )}
            </button>
          )}

          {/* Change frequency */}
          <button
            onClick={() => setShowFreqEditor(true)}
            disabled={isEditing}
            className="p-2 rounded-card hover:bg-blue-500/15 text-foreground hover:text-blue-400 transition-colors disabled:opacity-40"
            title={t.schedules.change_frequency}
          >
            <Settings2 className="w-4 h-4" />
          </button>

          {/* Toggle enabled */}
          <button
            onClick={onToggleEnabled}
            className="p-2 rounded-card hover:bg-secondary/60 transition-colors"
            title={agent.trigger_enabled ? t.schedules.pause_schedule : t.schedules.resume_schedule}
          >
            {agent.trigger_enabled ? (
              <ToggleRight className="w-5 h-5 text-emerald-400" />
            ) : (
              <ToggleLeft className="w-5 h-5 text-foreground" />
            )}
          </button>
        </div>
      </div>

      {/* Inline run-history peek (Stage 1) */}
      {showHistory && (
        <div role="region" aria-label={t.schedules.recent_runs} className="border-t border-primary/10 bg-primary/[0.015]">
          <div className="px-4 pt-2 flex items-center gap-1.5">
            <History className="w-3 h-3 text-foreground" />
            <span className="text-[10px] uppercase tracking-wider text-foreground">
              {t.schedules.recent_runs}
            </span>
          </div>
          <ScheduleRowHistoryPanel triggerId={agent.trigger_id} />
        </div>
      )}
      </div>

      {/* Frequency editor modal */}
      {showFreqEditor && (
        <FrequencyEditor
          agent={agent}
          currentSchedule={schedule}
          existingEntries={existingEntries}
          onSave={(cron, interval, tz) => {
            onUpdateFrequency(cron, interval, tz);
            setShowFreqEditor(false);
          }}
          onCancel={() => setShowFreqEditor(false)}
          onPreviewCron={onPreviewCron}
        />
      )}

      {/* Backfill modal */}
      {showBackfill && (
        <BackfillModal
          agent={agent}
          currentSchedule={schedule}
          isRunning={isBackfilling}
          lastResult={lastBackfill}
          onBackfill={onBackfill}
          onCancel={() => setShowBackfill(false)}
        />
      )}
    </>
  );
}

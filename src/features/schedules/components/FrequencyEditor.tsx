import { useState, useEffect } from 'react';
import { X, Clock, Check, AlertTriangle } from 'lucide-react';
import type { CronAgent } from '@/lib/bindings/CronAgent';
import type { CronPreview } from '@/api/pipeline/triggers';
import { CRON_PRESETS, type ScheduleEntry } from '../libs/scheduleHelpers';
import { useConflictPreview } from '../libs/useCronPreview';
import { TimezoneSelect, getDetectedTimezone } from '@/features/schedules/components/TimezoneSelect';
import { useThemeStore } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';

interface FrequencyEditorProps {
  agent: CronAgent;
  currentSchedule: string;
  existingEntries?: ScheduleEntry[];
  onSave: (cron: string | null, intervalSeconds: number | null, timezone?: string) => void;
  onCancel: () => void;
  onPreviewCron: (expression: string, timezone?: string) => Promise<CronPreview | null>;
}

export default function FrequencyEditor({
  agent,
  currentSchedule,
  existingEntries,
  onSave,
  onCancel,
  onPreviewCron,
}: FrequencyEditorProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'preset' | 'custom'>(
    agent.cron_expression ? 'custom' : 'preset',
  );
  const [cronInput, setCronInput] = useState(agent.cron_expression || '');
  const [intervalInput, setIntervalInput] = useState(
    agent.interval_seconds ? String(agent.interval_seconds) : '',
  );
  const [preview, setPreview] = useState<CronPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Initialize from the trigger's persisted zone if any; otherwise default to
  // the user's detected zone so a save persists a tz instead of leaving the
  // field None and inheriting the system-local fallback.
  const [scheduleTz, setScheduleTz] = useState<string | undefined>(
    agent.timezone ?? getDetectedTimezone(),
  );
  const themeTimezone = useThemeStore((s) => s.timezone);
  // Display label for the cron preview's "next runs" column. We render in the
  // schedule's own zone (scheduleTz) when set, otherwise the user's app-theme
  // pref, otherwise system local.
  const previewDisplayTz = scheduleTz ?? (themeTimezone === 'local' ? undefined : themeTimezone === 'utc' ? 'UTC' : themeTimezone);
  const tzLabel = previewDisplayTz ? previewDisplayTz.split('/').pop()?.replace(/_/g, ' ') || previewDisplayTz : 'Local';

  // Overlap detection: how many times in the next 7 days does this schedule
  // conflict with existing schedules? Backend-driven so the count matches
  // what the engine actually fires (tz/DST/step parsing all honored).
  const candidateInterval = mode === 'preset' ? parseInt(intervalInput, 10) : NaN;
  const { count: overlapCount } = useConflictPreview(
    existingEntries,
    mode === 'custom' ? cronInput.trim() : null,
    !isNaN(candidateInterval) && candidateInterval > 0 ? candidateInterval : null,
    scheduleTz,
    agent.trigger_id,
  );

  // Live preview for custom cron
  useEffect(() => {
    if (mode !== 'custom' || !cronInput.trim()) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      const result = await onPreviewCron(cronInput.trim(), scheduleTz);
      setPreview(result);
      setPreviewLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [cronInput, mode, scheduleTz, onPreviewCron]);

  const handlePresetSelect = (cron: string) => {
    setCronInput(cron);
    setMode('custom');
  };

  const handleSave = () => {
    if (mode === 'custom' && cronInput.trim()) {
      // Always pass the picker value (even if undefined for "system local")
      // so the saved config is explicit about its zone choice.
      onSave(cronInput.trim(), null, scheduleTz);
    } else if (intervalInput) {
      // Interval mode is zone-agnostic; pass undefined and let the merge clear
      // any stale tz field from a prior cron-mode config.
      onSave(null, parseInt(intervalInput, 10), undefined);
    }
  };

  const isValid = mode === 'custom'
    ? !!cronInput.trim() && (!preview || preview.valid)
    : !!intervalInput && !isNaN(parseInt(intervalInput, 10));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 surface-blur-modal">
      <div className="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 w-[520px] max-w-[calc(100%-2rem)] mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 bg-primary/5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-card bg-blue-500/15 border border-blue-500/25 flex items-center justify-center">
              <Clock className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h3 className="typo-heading text-foreground/90">{t.schedules.change_frequency_title}</h3>
              <p className="typo-caption text-foreground">{agent.persona_name}</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-card hover:bg-secondary/60 text-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Current schedule */}
          <div className="typo-caption text-foreground">
            {t.schedules.current_prefix}<span className="font-mono text-foreground">{currentSchedule}</span>
          </div>

          {/* Quick presets */}
          <div>
            <p className="typo-caption text-foreground mb-2">{t.schedules.quick_presets}</p>
            <div className="grid grid-cols-3 gap-1.5">
              {CRON_PRESETS.map((preset) => (
                <button
                  key={preset.cron}
                  onClick={() => handlePresetSelect(preset.cron)}
                  className={`px-2.5 py-2 typo-caption rounded-card border transition-all text-center ${
                    cronInput === preset.cron
                      ? 'bg-blue-500/15 border-blue-500/30 text-blue-400 shadow-elevation-1'
                      : 'bg-secondary/40 border-primary/10 text-foreground hover:bg-secondary/60 hover:text-foreground/80 hover:border-primary/20'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode('custom')}
              className={`flex-1 px-3 py-2 typo-caption rounded-card border transition-colors ${
                mode === 'custom'
                  ? 'bg-primary/10 border-primary/25 text-foreground/90'
                  : 'bg-secondary/30 border-primary/10 text-foreground hover:bg-secondary/50'
              }`}
            >
              {t.schedules.cron_expression} <span className="text-amber-400/60 font-medium">({tzLabel})</span>
            </button>
            <button
              onClick={() => setMode('preset')}
              className={`flex-1 px-3 py-2 typo-caption rounded-card border transition-colors ${
                mode === 'preset'
                  ? 'bg-primary/10 border-primary/25 text-foreground/90'
                  : 'bg-secondary/30 border-primary/10 text-foreground hover:bg-secondary/50'
              }`}
            >
              {t.schedules.interval_seconds}
            </button>
          </div>

          {/* Input */}
          {mode === 'custom' ? (
            <div className="space-y-2">
              <input
                type="text"
                value={cronInput}
                onChange={(e) => setCronInput(e.target.value)}
                placeholder="*/15 * * * *"
                className="w-full px-3 py-2 typo-code font-mono bg-secondary/40 border border-primary/15 rounded-card text-foreground/90 placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/30 focus-visible:ring-1 focus-visible:ring-primary/20"
              />
              <div className="flex items-center gap-2">
                <label className="typo-caption text-foreground shrink-0">Timezone</label>
                <TimezoneSelect
                  value={scheduleTz}
                  onChange={setScheduleTz}
                  className="flex-1 px-2 py-1 typo-code bg-secondary/40 border border-primary/15 rounded-card text-foreground/90 focus-visible:outline-none focus-visible:border-primary/30"
                />
              </div>
              {/* Preview */}
              {previewLoading && (
                <p className="typo-caption text-foreground">{t.schedules.previewing}</p>
              )}
              {preview && !previewLoading && (
                <div className={`typo-caption space-y-1 p-2.5 rounded-card border ${
                  preview.valid
                    ? 'bg-emerald-500/5 border-emerald-500/15 text-emerald-400/90'
                    : 'bg-red-500/5 border-red-500/15 text-red-400/90'
                }`}>
                  {preview.valid ? (
                    <>
                      <p className="font-medium">{preview.description}</p>
                      {preview.next_runs.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          <p className="text-foreground text-[10px] uppercase tracking-wider">{t.schedules.next_runs} ({tzLabel})</p>
                          {preview.next_runs.slice(0, 3).map((run, i) => (
                            <p key={i} className="font-mono text-[11px] text-foreground">
                              {previewDisplayTz
                                ? new Date(run).toLocaleString(undefined, { timeZone: previewDisplayTz })
                                : new Date(run).toLocaleString()
                              }
                            </p>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p>{preview.error || 'Invalid cron expression'}</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <input
              type="number"
              value={intervalInput}
              onChange={(e) => setIntervalInput(e.target.value)}
              placeholder="300"
              min={10}
              className="w-full px-3 py-2 typo-code font-mono bg-secondary/40 border border-primary/15 rounded-card text-foreground/90 placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/30 focus-visible:ring-1 focus-visible:ring-primary/20"
            />
          )}
        </div>

        {/* Overlap warning */}
        {overlapCount > 0 && (
          <div className="mx-6 mb-1 flex items-start gap-2 p-2.5 rounded-card border border-amber-500/20 bg-amber-500/5 typo-caption text-amber-400/90">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              {t.schedules.overlap_warning.replace('{count}', String(overlapCount))}
            </span>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-primary/10 bg-primary/[0.03]">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 typo-caption rounded-card border border-primary/10 bg-secondary/30 text-foreground hover:bg-secondary/50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!isValid}
            className="flex items-center gap-1.5 px-3 py-1.5 typo-caption rounded-card border border-blue-500/30 bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check className="w-3 h-3" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

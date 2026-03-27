import { useState, useEffect, useCallback, useRef } from 'react';
import { Clock, Zap, ChevronDown, Sparkles, Code2, CalendarClock } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { previewCronSchedule, type CronPreview } from '@/api/pipeline/triggers';
import {
  DAYS, TIMEZONES,
  buildCronFromVisual, parseCronToVisual,
  type ScheduleBuilderProps, type BuilderMode,
} from '../../libs/scheduleHelpers';
import { PresetPanel, VisualPanel, CronPanel } from './ScheduleModePanels';
import { NextRunsPreview } from './SchedulePreview';

export function ScheduleBuilder({ suggestedTrigger, useCaseId, onActivate, isActivating }: ScheduleBuilderProps) {
  const initialCron = suggestedTrigger.cron || '0 9 * * *';
  const [mode, setMode] = useState<BuilderMode>(() => parseCronToVisual(initialCron) ? 'presets' : 'cron');
  const [cronExpression, setCronExpression] = useState(initialCron);
  const [cronPreview, setCronPreview] = useState<CronPreview | null>(null);
  const [cronLoading, setCronLoading] = useState(false);
  const [timezone, setTimezone] = useState('local');
  const [showTimezone, setShowTimezone] = useState(false);

  const initialVisual = parseCronToVisual(initialCron);
  const [selectedDays, setSelectedDays] = useState<Set<string>>(() => initialVisual?.days ?? new Set(DAYS.map((d) => d.key)));
  const [hour, setHour] = useState(() => initialVisual?.hour ?? 9);
  const [minute, setMinute] = useState(() => initialVisual?.minute ?? 0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchPreview = useCallback(async (expr: string) => {
    if (!expr.trim()) { setCronPreview(null); return; }
    setCronLoading(true);
    try { setCronPreview(await previewCronSchedule(expr, 5)); }
    catch { setCronPreview(null); }
    finally { setCronLoading(false); }
  }, []);

  const debouncedFetch = useCallback((expr: string) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPreview(expr), 400);
  }, [fetchPreview]);

  useEffect(() => { if (mode === 'cron') debouncedFetch(cronExpression); return () => clearTimeout(debounceRef.current); }, [cronExpression, mode, debouncedFetch]);
  useEffect(() => { if (mode === 'visual') { const expr = buildCronFromVisual(selectedDays, hour, minute); setCronExpression(expr); fetchPreview(expr); } }, [mode, selectedDays, hour, minute, fetchPreview]);
  useEffect(() => { fetchPreview(cronExpression); }, []);

  const handlePresetSelect = useCallback((cron: string) => {
    setCronExpression(cron);
    const parsed = parseCronToVisual(cron);
    if (parsed) { setSelectedDays(parsed.days); setHour(parsed.hour); setMinute(parsed.minute); }
    fetchPreview(cron);
  }, [fetchPreview]);

  const handleToggleDay = useCallback((day: string) => {
    setSelectedDays((prev) => { const next = new Set(prev); if (next.has(day)) next.delete(day); else next.add(day); return next; });
  }, []);

  const handleActivate = useCallback(() => {
    const config: Record<string, unknown> = { cron: cronExpression };
    if (timezone !== 'local') config.timezone = timezone;
    onActivate(useCaseId, 'schedule', config);
  }, [cronExpression, timezone, useCaseId, onActivate]);

  const isValid = cronPreview?.valid ?? false;
  const MODE_TABS = [
    { key: 'presets' as const, icon: Sparkles, label: 'Quick Pick' },
    { key: 'visual' as const, icon: CalendarClock, label: 'Visual' },
    { key: 'cron' as const, icon: Code2, label: 'Cron' },
  ];

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1 p-0.5 rounded-lg bg-secondary/30 border border-primary/10">
        {MODE_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.key} type="button" onClick={() => setMode(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-medium transition-all ${mode === tab.key ? 'bg-amber-500/12 text-amber-300 shadow-elevation-1' : 'text-muted-foreground/60 hover:text-foreground/80 hover:bg-secondary/40'}`}>
              <Icon className="w-3 h-3" />{tab.label}
            </button>
          );
        })}
      </div>

      {mode === 'presets' && <PresetPanel cronExpression={cronExpression} onSelect={handlePresetSelect} />}
        {mode === 'visual' && <VisualPanel selectedDays={selectedDays} hour={hour} minute={minute} onToggleDay={handleToggleDay} onHourChange={setHour} onMinuteChange={setMinute} />}
        {mode === 'cron' && <CronPanel cronExpression={cronExpression} onCronChange={setCronExpression} cronPreview={cronPreview} cronLoading={cronLoading} />}

      {mode !== 'cron' && cronExpression && (
        <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-secondary/20 border border-primary/10">
          <Code2 className="w-3 h-3 text-muted-foreground/60 flex-shrink-0" />
          <span className="text-sm font-mono text-muted-foreground/50 flex-1 truncate">{cronExpression}</span>
          {cronPreview?.valid && <span className="text-sm text-amber-400/70 truncate">{cronPreview.description}</span>}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setShowTimezone(!showTimezone)} className="flex items-center gap-1 text-sm text-muted-foreground/50 hover:text-foreground/70 transition-colors">
          <Clock className="w-3 h-3" />{TIMEZONES.find((t) => t.value === timezone)?.label ?? 'Local time'}
          <ChevronDown className={`w-3 h-3 transition-transform ${showTimezone ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {showTimezone && (
          <div className="animate-fade-slide-in overflow-hidden">
            <div className="flex flex-wrap gap-1 pb-1">
              {TIMEZONES.map((tz) => (
                <button key={tz.value} type="button" onClick={() => { setTimezone(tz.value); setShowTimezone(false); }}
                  className={`px-2 py-1 rounded text-sm transition-all border ${timezone === tz.value ? 'bg-amber-500/12 text-amber-300 border-amber-500/25' : 'bg-secondary/20 text-muted-foreground/50 border-primary/10 hover:text-foreground/70'}`}>
                  {tz.label}
                </button>
              ))}
            </div>
          </div>
        )}

      {cronPreview?.valid && cronPreview.next_runs.length > 0 && <NextRunsPreview preview={cronPreview} />}

      <button onClick={handleActivate} disabled={isActivating || !isValid}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all border disabled:opacity-40 disabled:cursor-not-allowed bg-amber-500/12 text-amber-300 border-amber-500/25 hover:bg-amber-500/20">
        {isActivating ? <LoadingSpinner size="sm" /> : <Zap className="w-3.5 h-3.5" />}
        {isActivating ? 'Activating...' : 'Activate Schedule Trigger'}
      </button>

      {suggestedTrigger.description && (
        <p className="text-sm text-muted-foreground/60 px-0.5 leading-relaxed">AI suggestion: {suggestedTrigger.description}</p>
      )}
    </div>
  );
}

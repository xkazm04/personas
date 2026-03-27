import { useState, useRef, useEffect, useCallback } from 'react';
import { Clock, CalendarClock } from 'lucide-react';
import {
  TRIGGER_TEMPLATES, getTriggerCategory,
  type CompositeCondition, type TriggerCategory,
} from '@/lib/utils/platform/triggerConstants';
import { previewCronSchedule, type CronPreview } from '@/api/pipeline/triggers';
import { IntervalConfig, CronConfig } from './TriggerScheduleConfig';
import { TriggerQuickTemplates } from './TriggerQuickTemplates';
import { TriggerCategorySelector } from './TriggerCategorySelector';
import { TriggerTypeSelector } from './TriggerTypeSelector';
import { NlTriggerInput } from './NlTriggerInput';
import type { NlParseResult } from './nlTriggerParser';
import { WebhookConfig } from './configs/WebhookConfig';
import { FileWatcherConfig } from './configs/FileWatcherConfig';
import { ClipboardConfig } from './configs/ClipboardConfig';
import { AppFocusConfig } from './configs/AppFocusConfig';
import { CompositeConfig } from './configs/CompositeConfig';
import { EventListenerConfig } from './configs/EventListenerConfig';
import { PollingConfig } from './configs/PollingConfig';
import { buildTriggerConfig } from './configs/buildTriggerConfig';

export interface TriggerAddFormProps {
  credentialEventsList: { id: string; name: string }[];
  onCreateTrigger: (triggerType: string, config: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

export function TriggerAddForm({ credentialEventsList, onCreateTrigger, onCancel }: TriggerAddFormProps) {
  const [selectedCategory, setSelectedCategory] = useState<TriggerCategory | null>(null);
  const [triggerType, setTriggerType] = useState<string>('manual');
  const [scheduleMode, setScheduleMode] = useState<'interval' | 'cron'>('interval');
  const [interval, setInterval] = useState('3600');
  const [customInterval, setCustomInterval] = useState(false);
  const [cronExpression, setCronExpression] = useState('');
  const [cronPreview, setCronPreview] = useState<CronPreview | null>(null);
  const [cronLoading, setCronLoading] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [hmacSecret, setHmacSecret] = useState('');
  const [listenEventType, setListenEventType] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [watchPaths, setWatchPaths] = useState<string[]>(['']);
  const [watchEvents, setWatchEvents] = useState<string[]>(['modify']);
  const [watchRecursive, setWatchRecursive] = useState(true);
  const [globFilter, setGlobFilter] = useState('');
  const [clipboardContentType, setClipboardContentType] = useState('text');
  const [clipboardPattern, setClipboardPattern] = useState('');
  const [clipboardInterval, setClipboardInterval] = useState('5');
  const [appNames, setAppNames] = useState<string[]>(['']);
  const [titlePattern, setTitlePattern] = useState('');
  const [appFocusInterval, setAppFocusInterval] = useState('3');
  const [compositeConditions, setCompositeConditions] = useState<CompositeCondition[]>([{ event_type: '' }]);
  const [compositeOperator, setCompositeOperator] = useState('all');
  const [windowSeconds, setWindowSeconds] = useState('300');
  const [validationError, setValidationError] = useState<string | null>(null);
  const cronDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCronPreview = useCallback(async (expr: string) => {
    if (!expr.trim()) { setCronPreview(null); return; }
    setCronLoading(true);
    try { setCronPreview(await previewCronSchedule(expr.trim(), 5)); }
    catch { setCronPreview(null); }
    finally { setCronLoading(false); }
  }, []);

  useEffect(() => {
    if (scheduleMode !== 'cron' || triggerType !== 'schedule') return;
    if (cronDebounceRef.current) clearTimeout(cronDebounceRef.current);
    cronDebounceRef.current = setTimeout(() => { fetchCronPreview(cronExpression); }, 400);
    return () => { if (cronDebounceRef.current) clearTimeout(cronDebounceRef.current); };
  }, [cronExpression, scheduleMode, triggerType, fetchCronPreview]);

  const handleCronPreset = (expr: string) => {
    setCronExpression(expr);
    setValidationError(null);
    fetchCronPreview(expr);
  };

  const applyTemplate = (templateId: string) => {
    const tpl = TRIGGER_TEMPLATES.find((t: { id: string }) => t.id === templateId);
    if (!tpl) return;
    setValidationError(null);
    setSelectedCategory(getTriggerCategory(tpl.triggerType));
    setTriggerType(tpl.triggerType);
    const cfg = tpl.config;
    if (tpl.triggerType === 'file_watcher') {
      setWatchPaths((cfg.watch_paths as string[] | undefined) ?? ['']);
      setWatchEvents((cfg.events as string[] | undefined) ?? ['modify']);
      setWatchRecursive((cfg.recursive as boolean | undefined) ?? true);
      setGlobFilter((cfg.glob_filter as string | undefined) ?? '');
    } else if (tpl.triggerType === 'clipboard') {
      setClipboardContentType((cfg.content_type as string | undefined) ?? 'text');
      setClipboardPattern((cfg.pattern as string | undefined) ?? '');
      setClipboardInterval(String((cfg.interval_seconds as number | undefined) ?? 5));
    }
  };

  const applyNlResult = (result: NlParseResult) => {
    setValidationError(null);
    const o = result.formOverrides;
    if (o.triggerType) {
      setSelectedCategory(getTriggerCategory(o.triggerType));
      setTriggerType(o.triggerType);
    }
    if (o.scheduleMode !== undefined) setScheduleMode(o.scheduleMode);
    if (o.interval !== undefined) setInterval(o.interval);
    if (o.cronExpression !== undefined) {
      setCronExpression(o.cronExpression);
      fetchCronPreview(o.cronExpression);
    }
    if (o.endpoint !== undefined) setEndpoint(o.endpoint);
    if (o.hmacSecret !== undefined) setHmacSecret(o.hmacSecret);
    if (o.listenEventType !== undefined) setListenEventType(o.listenEventType);
    if (o.sourceFilter !== undefined) setSourceFilter(o.sourceFilter);
    if (o.watchPaths !== undefined) setWatchPaths(o.watchPaths);
    if (o.watchEvents !== undefined) setWatchEvents(o.watchEvents);
    if (o.watchRecursive !== undefined) setWatchRecursive(o.watchRecursive);
    if (o.globFilter !== undefined) setGlobFilter(o.globFilter);
    if (o.clipboardContentType !== undefined) setClipboardContentType(o.clipboardContentType);
    if (o.clipboardPattern !== undefined) setClipboardPattern(o.clipboardPattern);
    if (o.clipboardInterval !== undefined) setClipboardInterval(o.clipboardInterval);
    if (o.appNames !== undefined) setAppNames(o.appNames);
    if (o.titlePattern !== undefined) setTitlePattern(o.titlePattern);
    if (o.appFocusInterval !== undefined) setAppFocusInterval(o.appFocusInterval);
    if (o.compositeConditions !== undefined) setCompositeConditions(o.compositeConditions);
    if (o.compositeOperator !== undefined) setCompositeOperator(o.compositeOperator);
    if (o.windowSeconds !== undefined) setWindowSeconds(o.windowSeconds);
  };

  const handleAddTrigger = async () => {
    const result = buildTriggerConfig({
      triggerType, scheduleMode, interval, cronExpression, cronPreview,
      endpoint, selectedEventId, hmacSecret, listenEventType, sourceFilter,
      watchPaths, watchEvents, watchRecursive, globFilter,
      clipboardContentType, clipboardPattern, clipboardInterval,
      appNames, titlePattern, appFocusInterval,
      compositeConditions, compositeOperator, windowSeconds,
    });
    if (!result.ok) { setValidationError(result.error); return; }
    setValidationError(null);
    await onCreateTrigger(triggerType, result.config);
  };

  return (
    <div
      className="animate-fade-slide-in bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-4 space-y-4"
    >
      <NlTriggerInput onApplyResult={applyNlResult} />

      <div className="relative flex items-center gap-3 py-0.5">
        <div className="flex-1 border-t border-border/20" />
        <span className="text-xs text-muted-foreground/40 shrink-0">or use templates</span>
        <div className="flex-1 border-t border-border/20" />
      </div>

      <TriggerQuickTemplates onApplyTemplate={applyTemplate} />
      <TriggerCategorySelector selectedCategory={selectedCategory} onSelectCategory={setSelectedCategory} onSelectTriggerType={setTriggerType} />
      <TriggerTypeSelector selectedCategory={selectedCategory} triggerType={triggerType} setTriggerType={setTriggerType} />

      {triggerType === 'schedule' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1.5">Schedule Mode</label>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => { setScheduleMode('interval'); setValidationError(null); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all border ${scheduleMode === 'interval' ? 'bg-primary/15 text-primary border-primary/30' : 'bg-secondary/30 text-muted-foreground/80 border-border/30 hover:text-muted-foreground hover:bg-secondary/50'}`}>
                <Clock className="w-3.5 h-3.5" /> Interval
              </button>
              <button type="button" onClick={() => { setScheduleMode('cron'); setValidationError(null); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all border ${scheduleMode === 'cron' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' : 'bg-secondary/30 text-muted-foreground/80 border-border/30 hover:text-muted-foreground hover:bg-secondary/50'}`}>
                <CalendarClock className="w-3.5 h-3.5" /> Cron Expression
              </button>
            </div>
          </div>
          {scheduleMode === 'interval' && <IntervalConfig interval={interval} setInterval={setInterval} customInterval={customInterval} setCustomInterval={setCustomInterval} validationError={validationError} setValidationError={setValidationError} triggerType={triggerType} />}
          {scheduleMode === 'cron' && <CronConfig cronExpression={cronExpression} setCronExpression={(v: string) => { setCronExpression(v); if (validationError) setValidationError(null); }} cronPreview={cronPreview} cronLoading={cronLoading} validationError={validationError} onPresetSelect={handleCronPreset} />}
        </div>
      )}

      {triggerType === 'polling' && <div><IntervalConfig interval={interval} setInterval={setInterval} customInterval={customInterval} setCustomInterval={setCustomInterval} validationError={validationError} setValidationError={setValidationError} triggerType={triggerType} /></div>}
      {triggerType === 'polling' && <PollingConfig credentialEventsList={credentialEventsList} selectedEventId={selectedEventId} setSelectedEventId={setSelectedEventId} endpoint={endpoint} setEndpoint={setEndpoint} />}
      {triggerType === 'webhook' && <WebhookConfig hmacSecret={hmacSecret} setHmacSecret={setHmacSecret} />}
      {triggerType === 'event_listener' && <EventListenerConfig listenEventType={listenEventType} setListenEventType={setListenEventType} sourceFilter={sourceFilter} setSourceFilter={setSourceFilter} validationError={validationError} setValidationError={setValidationError} />}
      {triggerType === 'file_watcher' && <FileWatcherConfig watchPaths={watchPaths} setWatchPaths={setWatchPaths} watchEvents={watchEvents} setWatchEvents={setWatchEvents} watchRecursive={watchRecursive} setWatchRecursive={setWatchRecursive} globFilter={globFilter} setGlobFilter={setGlobFilter} validationError={validationError} setValidationError={setValidationError} />}
      {triggerType === 'clipboard' && <ClipboardConfig clipboardContentType={clipboardContentType} setClipboardContentType={setClipboardContentType} clipboardPattern={clipboardPattern} setClipboardPattern={setClipboardPattern} clipboardInterval={clipboardInterval} setClipboardInterval={setClipboardInterval} />}
      {triggerType === 'app_focus' && <AppFocusConfig appNames={appNames} setAppNames={setAppNames} titlePattern={titlePattern} setTitlePattern={setTitlePattern} appFocusInterval={appFocusInterval} setAppFocusInterval={setAppFocusInterval} />}
      {triggerType === 'composite' && <CompositeConfig compositeConditions={compositeConditions} setCompositeConditions={setCompositeConditions} compositeOperator={compositeOperator} setCompositeOperator={setCompositeOperator} windowSeconds={windowSeconds} setWindowSeconds={setWindowSeconds} validationError={validationError} setValidationError={setValidationError} />}

      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onCancel} className="px-3 py-1.5 bg-secondary/60 hover:bg-secondary text-foreground/90 rounded-xl text-sm transition-colors">Cancel</button>
        <button onClick={handleAddTrigger} className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-foreground rounded-xl text-sm font-medium transition-all shadow-elevation-3 shadow-primary/20">Create Trigger</button>
      </div>
    </div>
  );
}

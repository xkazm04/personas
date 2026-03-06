import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock,
  CalendarClock,
  Zap,
  ChevronDown,
  Loader2,
  Sparkles,
  Code2,
} from 'lucide-react';
import { previewCronSchedule, type CronPreview } from '@/api/triggers';

// ── Types ──────────────────────────────────────────────────────────────

interface SuggestedTrigger {
  type: string;
  cron?: string;
  description?: string;
}

interface ScheduleBuilderProps {
  suggestedTrigger: SuggestedTrigger;
  useCaseId: string;
  onActivate: (useCaseId: string, triggerType: string, config?: Record<string, unknown>) => void;
  isActivating: boolean;
}

type BuilderMode = 'presets' | 'visual' | 'cron';

// ── Constants ──────────────────────────────────────────────────────────

const DAYS = [
  { key: '1', short: 'Mon', label: 'Monday' },
  { key: '2', short: 'Tue', label: 'Tuesday' },
  { key: '3', short: 'Wed', label: 'Wednesday' },
  { key: '4', short: 'Thu', label: 'Thursday' },
  { key: '5', short: 'Fri', label: 'Friday' },
  { key: '6', short: 'Sat', label: 'Saturday' },
  { key: '0', short: 'Sun', label: 'Sunday' },
] as const;

const HOURS = Array.from({ length: 24 }, (_, i) => i);

const SCHEDULE_PRESETS = [
  { label: 'Every hour', cron: '0 * * * *', category: 'frequent' },
  { label: 'Every 6 hours', cron: '0 */6 * * *', category: 'frequent' },
  { label: 'Daily at 9 AM', cron: '0 9 * * *', category: 'daily' },
  { label: 'Daily at midnight', cron: '0 0 * * *', category: 'daily' },
  { label: 'Daily at 6 PM', cron: '0 18 * * *', category: 'daily' },
  { label: 'Weekdays at 9 AM', cron: '0 9 * * 1-5', category: 'weekday' },
  { label: 'Weekdays at 8 AM', cron: '0 8 * * 1-5', category: 'weekday' },
  { label: 'Every Monday at 9 AM', cron: '0 9 * * 1', category: 'weekly' },
  { label: 'Every Friday at 5 PM', cron: '0 17 * * 5', category: 'weekly' },
  { label: 'Monthly on the 1st', cron: '0 0 1 * *', category: 'monthly' },
  { label: 'Every 15 minutes', cron: '*/15 * * * *', category: 'frequent' },
  { label: 'Twice daily (9 AM & 5 PM)', cron: '0 9,17 * * *', category: 'daily' },
] as const;

const TIMEZONES = [
  { label: 'Local time', value: 'local' },
  { label: 'UTC', value: 'UTC' },
  { label: 'US Eastern (ET)', value: 'America/New_York' },
  { label: 'US Central (CT)', value: 'America/Chicago' },
  { label: 'US Pacific (PT)', value: 'America/Los_Angeles' },
  { label: 'London (GMT/BST)', value: 'Europe/London' },
  { label: 'Berlin (CET)', value: 'Europe/Berlin' },
  { label: 'Tokyo (JST)', value: 'Asia/Tokyo' },
  { label: 'Sydney (AEST)', value: 'Australia/Sydney' },
] as const;

// ── Helpers ────────────────────────────────────────────────────────────

function formatRunTime(date: Date): string {
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (isToday) return time;
  if (isTomorrow) return `Tomorrow ${time}`;
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ` ${time}`;
}

function formatHour(h: number): string {
  if (h === 0) return '12a';
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
}

/** Build a cron expression from selected days and hour. */
function buildCronFromVisual(selectedDays: Set<string>, hour: number, minute: number): string {
  if (selectedDays.size === 0) return `${minute} ${hour} * * *`;
  if (selectedDays.size === 7) return `${minute} ${hour} * * *`;

  // Check for weekdays pattern
  const weekdays = new Set(['1', '2', '3', '4', '5']);
  const isWeekdays = selectedDays.size === 5 && [...selectedDays].every((d) => weekdays.has(d));
  if (isWeekdays) return `${minute} ${hour} * * 1-5`;

  // Check for weekends pattern
  const weekends = new Set(['0', '6']);
  const isWeekends = selectedDays.size === 2 && [...selectedDays].every((d) => weekends.has(d));
  if (isWeekends) return `${minute} ${hour} * * 0,6`;

  const sorted = [...selectedDays].sort((a, b) => Number(a) - Number(b));
  return `${minute} ${hour} * * ${sorted.join(',')}`;
}

/** Parse a cron expression into visual components (best effort). */
function parseCronToVisual(cron: string): { days: Set<string>; hour: number; minute: number } | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minPart, hourPart, , , dowPart] = parts;
  if (!minPart || !hourPart || !dowPart) return null;

  // Only parse simple hour/minute patterns
  const minute = parseInt(minPart);
  const hour = parseInt(hourPart);
  if (isNaN(minute) || isNaN(hour)) return null;

  const days = new Set<string>();
  if (dowPart === '*') {
    DAYS.forEach((d) => days.add(d.key));
  } else if (dowPart === '1-5') {
    ['1', '2', '3', '4', '5'].forEach((d) => days.add(d));
  } else if (dowPart === '0,6' || dowPart === '6,0') {
    ['0', '6'].forEach((d) => days.add(d));
  } else {
    dowPart.split(',').forEach((d) => {
      const n = d.trim();
      if (!isNaN(Number(n))) days.add(n);
    });
  }

  return { days, hour, minute };
}

// ── Sub-components ─────────────────────────────────────────────────────

function NextRunsPreview({ preview }: { preview: CronPreview }) {
  const runs = useMemo(
    () => preview.next_runs.map((r) => new Date(r)),
    [preview.next_runs],
  );
  const firstRun = runs[0];
  const lastRun = runs[runs.length - 1];
  if (!firstRun || !lastRun) return null;

  const now = Date.now();
  const totalSpan = lastRun.getTime() - now;
  if (totalSpan <= 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/10"
    >
      {/* Description */}
      <div className="flex items-center gap-2 mb-2.5">
        <CalendarClock className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0" />
        <p className="text-sm text-foreground/90">
          <span className="font-medium text-amber-400/90">{preview.description}</span>
          {' — '}next:{' '}
          <span className="font-medium text-foreground/90">{formatRunTime(firstRun)}</span>
        </p>
      </div>

      {/* Timeline */}
      <div className="relative h-6 mx-1">
        <div className="absolute top-1/2 left-0 right-0 h-px bg-amber-400/15 -translate-y-1/2" />
        <div className="absolute left-0 top-1/2 -translate-y-1/2 flex flex-col items-center">
          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
          <span className="text-sm text-muted-foreground/60 mt-1.5 absolute top-full whitespace-nowrap">now</span>
        </div>
        {runs.map((run, i) => {
          const pct = Math.min(((run.getTime() - now) / totalSpan) * 100, 100);
          return (
            <motion.div
              key={i}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: i * 0.06, type: 'spring', stiffness: 500, damping: 25 }}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center group"
              style={{ left: `${pct}%` }}
            >
              <div className={`w-2 h-2 rounded-full ${i === 0 ? 'bg-amber-400' : 'bg-amber-400/40'} ring-2 ring-amber-400/10`} />
              <span className={`text-sm mt-1.5 absolute top-full whitespace-nowrap ${
                i === 0 ? 'text-amber-400/80 font-medium' : 'text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity'
              }`}>
                {formatRunTime(run)}
              </span>
            </motion.div>
          );
        })}
      </div>

      {/* Run list */}
      <div className="mt-4 flex flex-wrap gap-x-3 gap-y-0.5">
        {runs.map((run, i) => (
          <span key={i} className={`text-sm font-mono ${i === 0 ? 'text-amber-400/80' : 'text-muted-foreground/50'}`}>
            {formatRunTime(run)}
          </span>
        ))}
      </div>
    </motion.div>
  );
}

function DayTimeGrid({
  selectedDays,
  hour,
  minute,
  onToggleDay,
  onHourChange,
  onMinuteChange,
}: {
  selectedDays: Set<string>;
  hour: number;
  minute: number;
  onToggleDay: (day: string) => void;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
}) {
  const allSelected = selectedDays.size === 7;
  const weekdaysSelected = selectedDays.size === 5 &&
    ['1', '2', '3', '4', '5'].every((d) => selectedDays.has(d));

  return (
    <div className="space-y-3">
      {/* Day selector */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm font-medium text-muted-foreground/70 uppercase tracking-wider">Days</label>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => {
                DAYS.forEach((d) => { if (!selectedDays.has(d.key)) onToggleDay(d.key); });
              }}
              className={`text-sm px-1.5 py-0.5 rounded transition-colors ${
                allSelected ? 'text-amber-400 bg-amber-500/10' : 'text-muted-foreground/50 hover:text-foreground/70'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => {
                // Set to weekdays only
                DAYS.forEach((d) => {
                  const isWeekday = ['1', '2', '3', '4', '5'].includes(d.key);
                  const has = selectedDays.has(d.key);
                  if (isWeekday && !has) onToggleDay(d.key);
                  if (!isWeekday && has) onToggleDay(d.key);
                });
              }}
              className={`text-sm px-1.5 py-0.5 rounded transition-colors ${
                weekdaysSelected ? 'text-amber-400 bg-amber-500/10' : 'text-muted-foreground/50 hover:text-foreground/70'
              }`}
            >
              Weekdays
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {DAYS.map((day) => {
            const active = selectedDays.has(day.key);
            return (
              <button
                key={day.key}
                type="button"
                onClick={() => onToggleDay(day.key)}
                className={`py-1.5 rounded-lg text-sm font-medium transition-all border ${
                  active
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                    : 'bg-secondary/20 text-muted-foreground/50 border-primary/10 hover:border-primary/20 hover:text-foreground/70'
                }`}
                title={day.label}
              >
                {day.short}
              </button>
            );
          })}
        </div>
      </div>

      {/* Time selector */}
      <div>
        <label className="text-sm font-medium text-muted-foreground/70 uppercase tracking-wider block mb-1.5">Time</label>
        <div className="flex items-center gap-2">
          {/* Hour picker */}
          <div className="relative flex-1">
            <select
              value={hour}
              onChange={(e) => onHourChange(parseInt(e.target.value))}
              className="w-full appearance-none pl-3 pr-8 py-2 rounded-lg border border-primary/15 bg-secondary/25 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/30 cursor-pointer"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h.toString().padStart(2, '0')}:00 ({formatHour(h)})
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
          </div>

          <span className="text-muted-foreground/40 text-lg font-light">:</span>

          {/* Minute picker */}
          <div className="relative w-24">
            <select
              value={minute}
              onChange={(e) => onMinuteChange(parseInt(e.target.value))}
              className="w-full appearance-none pl-3 pr-8 py-2 rounded-lg border border-primary/15 bg-secondary/25 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/30 cursor-pointer"
            >
              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                <option key={m} value={m}>
                  :{m.toString().padStart(2, '0')}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Visual hour bar */}
      <div>
        <label className="text-sm font-medium text-muted-foreground/70 uppercase tracking-wider block mb-1.5">
          Hour (click to set)
        </label>
        <div className="flex gap-px">
          {HOURS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => onHourChange(h)}
              className={`flex-1 h-5 rounded-sm transition-all ${
                h === hour
                  ? 'bg-amber-400 shadow-sm shadow-amber-400/30'
                  : h >= 9 && h <= 17
                    ? 'bg-amber-500/10 hover:bg-amber-500/20'
                    : 'bg-secondary/30 hover:bg-secondary/50'
              }`}
              title={`${h.toString().padStart(2, '0')}:00 (${formatHour(h)})`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-0.5 text-sm text-muted-foreground/40 font-mono px-0.5">
          <span>12a</span>
          <span>6a</span>
          <span>12p</span>
          <span>6p</span>
          <span>12a</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

export function ScheduleBuilder({
  suggestedTrigger,
  useCaseId,
  onActivate,
  isActivating,
}: ScheduleBuilderProps) {
  const initialCron = suggestedTrigger.cron || '0 9 * * *';
  const [mode, setMode] = useState<BuilderMode>(() => {
    // If cron can be parsed visually, start in visual mode
    const parsed = parseCronToVisual(initialCron);
    return parsed ? 'presets' : 'cron';
  });

  const [cronExpression, setCronExpression] = useState(initialCron);
  const [cronPreview, setCronPreview] = useState<CronPreview | null>(null);
  const [cronLoading, setCronLoading] = useState(false);
  const [timezone, setTimezone] = useState('local');
  const [showTimezone, setShowTimezone] = useState(false);

  // Visual mode state
  const initialVisual = parseCronToVisual(initialCron);
  const [selectedDays, setSelectedDays] = useState<Set<string>>(
    () => initialVisual?.days ?? new Set(DAYS.map((d) => d.key)),
  );
  const [hour, setHour] = useState(() => initialVisual?.hour ?? 9);
  const [minute, setMinute] = useState(() => initialVisual?.minute ?? 0);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Fetch cron preview
  const fetchPreview = useCallback(async (expr: string) => {
    if (!expr.trim()) {
      setCronPreview(null);
      return;
    }
    setCronLoading(true);
    try {
      const result = await previewCronSchedule(expr, 5);
      setCronPreview(result);
    } catch {
      // intentional: non-critical — cron preview fetch failure
      setCronPreview(null);
    } finally {
      setCronLoading(false);
    }
  }, []);

  // Debounced fetch for manual cron input
  const debouncedFetch = useCallback(
    (expr: string) => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchPreview(expr), 400);
    },
    [fetchPreview],
  );

  // Fetch preview on cron change
  useEffect(() => {
    if (mode === 'cron') {
      debouncedFetch(cronExpression);
    }
    return () => clearTimeout(debounceRef.current);
  }, [cronExpression, mode, debouncedFetch]);

  // Sync visual → cron and fetch preview
  useEffect(() => {
    if (mode === 'visual') {
      const expr = buildCronFromVisual(selectedDays, hour, minute);
      setCronExpression(expr);
      fetchPreview(expr);
    }
  }, [mode, selectedDays, hour, minute, fetchPreview]);

  // Fetch preview for initial cron / preset selection
  useEffect(() => {
    fetchPreview(cronExpression);
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePresetSelect = useCallback(
    (cron: string) => {
      setCronExpression(cron);
      const parsed = parseCronToVisual(cron);
      if (parsed) {
        setSelectedDays(parsed.days);
        setHour(parsed.hour);
        setMinute(parsed.minute);
      }
      fetchPreview(cron);
    },
    [fetchPreview],
  );

  const handleToggleDay = useCallback((day: string) => {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }, []);

  const handleActivate = useCallback(() => {
    const config: Record<string, unknown> = { cron: cronExpression };
    if (timezone !== 'local') config.timezone = timezone;
    onActivate(useCaseId, 'schedule', config);
  }, [cronExpression, timezone, useCaseId, onActivate]);

  const isValid = cronPreview?.valid ?? false;

  return (
    <div className="space-y-2.5">
      {/* Mode tabs */}
      <div className="flex items-center gap-1 p-0.5 rounded-lg bg-secondary/30 border border-primary/10">
        {([
          { key: 'presets' as const, icon: Sparkles, label: 'Quick Pick' },
          { key: 'visual' as const, icon: CalendarClock, label: 'Visual' },
          { key: 'cron' as const, icon: Code2, label: 'Cron' },
        ]).map((tab) => {
          const Icon = tab.icon;
          const active = mode === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMode(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-medium transition-all ${
                active
                  ? 'bg-amber-500/12 text-amber-300 shadow-sm'
                  : 'text-muted-foreground/60 hover:text-foreground/80 hover:bg-secondary/40'
              }`}
            >
              <Icon className="w-3 h-3" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Preset mode */}
      <AnimatePresence mode="wait">
        {mode === 'presets' && (
          <motion.div
            key="presets"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="space-y-2"
          >
            <div className="grid grid-cols-2 gap-1.5">
              {SCHEDULE_PRESETS.map((preset) => {
                const active = cronExpression === preset.cron;
                return (
                  <button
                    key={preset.cron}
                    type="button"
                    onClick={() => handlePresetSelect(preset.cron)}
                    className={`text-left px-2.5 py-2 rounded-xl text-sm transition-all border ${
                      active
                        ? 'bg-amber-500/12 text-amber-300 border-amber-500/25 font-medium'
                        : 'bg-secondary/20 text-muted-foreground/70 border-primary/10 hover:border-primary/20 hover:text-foreground/80'
                    }`}
                  >
                    <span className="block">{preset.label}</span>
                    <span className={`text-sm font-mono mt-0.5 block ${
                      active ? 'text-amber-400/60' : 'text-muted-foreground/40'
                    }`}>
                      {preset.cron}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Visual mode */}
        {mode === 'visual' && (
          <motion.div
            key="visual"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            <DayTimeGrid
              selectedDays={selectedDays}
              hour={hour}
              minute={minute}
              onToggleDay={handleToggleDay}
              onHourChange={setHour}
              onMinuteChange={setMinute}
            />
          </motion.div>
        )}

        {/* Cron mode */}
        {mode === 'cron' && (
          <motion.div
            key="cron"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="space-y-2"
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={cronExpression}
                onChange={(e) => setCronExpression(e.target.value)}
                placeholder="* * * * *  (min hour dom mon dow)"
                className={`flex-1 px-3 py-2 bg-background/50 border rounded-xl text-foreground font-mono text-sm placeholder-muted-foreground/30 focus:outline-none focus:ring-2 transition-all ${
                  cronPreview && !cronPreview.valid
                    ? 'border-red-500/30 ring-1 ring-red-500/20 focus:ring-red-500/30'
                    : 'border-primary/15 focus:ring-amber-500/30'
                }`}
              />
              {cronLoading && (
                <Loader2 className="w-4 h-4 text-amber-400/60 animate-spin flex-shrink-0" />
              )}
            </div>

            {/* Field legend */}
            <div className="flex gap-3 text-sm text-muted-foreground/40 font-mono px-0.5">
              <span>min</span>
              <span>hour</span>
              <span>day</span>
              <span>month</span>
              <span>weekday</span>
            </div>

            {/* Error */}
            {cronPreview && !cronPreview.valid && (
              <p className="text-sm text-red-400/80">{cronPreview.error}</p>
            )}

            {/* Description */}
            {cronPreview?.valid && (
              <p className="text-sm text-amber-400/80 font-medium">{cronPreview.description}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Current cron display (for non-cron modes) */}
      {mode !== 'cron' && cronExpression && (
        <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-secondary/20 border border-primary/8">
          <Code2 className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
          <span className="text-sm font-mono text-muted-foreground/50 flex-1 truncate">{cronExpression}</span>
          {cronPreview?.valid && (
            <span className="text-sm text-amber-400/70 truncate">{cronPreview.description}</span>
          )}
        </div>
      )}

      {/* Timezone picker */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowTimezone(!showTimezone)}
          className="flex items-center gap-1 text-sm text-muted-foreground/50 hover:text-foreground/70 transition-colors"
        >
          <Clock className="w-3 h-3" />
          {TIMEZONES.find((t) => t.value === timezone)?.label ?? 'Local time'}
          <ChevronDown className={`w-3 h-3 transition-transform ${showTimezone ? 'rotate-180' : ''}`} />
        </button>
      </div>
      <AnimatePresence>
        {showTimezone && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap gap-1 pb-1">
              {TIMEZONES.map((tz) => (
                <button
                  key={tz.value}
                  type="button"
                  onClick={() => { setTimezone(tz.value); setShowTimezone(false); }}
                  className={`px-2 py-1 rounded text-sm transition-all border ${
                    timezone === tz.value
                      ? 'bg-amber-500/12 text-amber-300 border-amber-500/25'
                      : 'bg-secondary/20 text-muted-foreground/50 border-primary/8 hover:text-foreground/70'
                  }`}
                >
                  {tz.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Next runs preview */}
      <AnimatePresence>
        {cronPreview?.valid && cronPreview.next_runs.length > 0 && (
          <NextRunsPreview preview={cronPreview} />
        )}
      </AnimatePresence>

      {/* Activate button */}
      <button
        onClick={handleActivate}
        disabled={isActivating || !isValid}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all border disabled:opacity-40 disabled:cursor-not-allowed bg-amber-500/12 text-amber-300 border-amber-500/25 hover:bg-amber-500/20"
      >
        {isActivating ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Zap className="w-3.5 h-3.5" />
        )}
        {isActivating ? 'Activating...' : 'Activate Schedule Trigger'}
      </button>

      {/* Description from AI if available */}
      {suggestedTrigger.description && (
        <p className="text-sm text-muted-foreground/40 px-0.5 leading-relaxed">
          AI suggestion: {suggestedTrigger.description}
        </p>
      )}
    </div>
  );
}

import { useMemo } from 'react';
import { Clock, CalendarClock } from 'lucide-react';
import { formatInterval } from '@/lib/utils/formatters';
import { type CronPreview } from '@/api/pipeline/triggers';

/** Compute the next N scheduled run times starting from now */
export function computeNextRuns(intervalSeconds: number, count: number): Date[] {
  const now = new Date();
  const runs: Date[] = [];
  for (let i = 1; i <= count; i++) {
    runs.push(new Date(now.getTime() + intervalSeconds * 1000 * i));
  }
  return runs;
}

/** Format a date as a short wall-clock time like "3:45 PM" or "Tomorrow 9:00 AM" (local time) */
export function formatRunTime(date: Date): string {
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

/** Format a date as UTC short time like "3:45 PM UTC" */
export function formatRunTimeUTC(date: Date): string {
  const h = date.getUTCHours();
  const m = date.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const time = m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  return `${time} UTC`;
}

export function SchedulePreview({ intervalSeconds, triggerType }: { intervalSeconds: number; triggerType: string }) {
  const runs = useMemo(() => computeNextRuns(intervalSeconds, 5), [intervalSeconds]);
  const firstRun = runs[0];
  const lastRun = runs[runs.length - 1];
  if (!firstRun || !lastRun) return null;

  // Timeline spans from now to last run
  const now = Date.now();
  const totalSpan = lastRun.getTime() - now;

  return (
    <div
      className="animate-fade-slide-in mt-3 p-3 rounded-modal bg-primary/5 border border-primary/10"
    >
      {/* Human-readable summary */}
      <div className="flex items-center gap-2 mb-2.5">
        <Clock className="w-3.5 h-3.5 text-primary/50 flex-shrink-0" />
        <p className="text-sm text-foreground/90">
          First {triggerType === 'polling' ? 'poll' : 'run'}:{' '}
          <span className="font-medium text-foreground/90">{formatRunTime(firstRun)}</span>
          , then every{' '}
          <span className="font-medium text-foreground/90">{formatInterval(intervalSeconds)}</span>
        </p>
      </div>

      {/* Mini timeline */}
      <div className="relative h-6 mx-1">
        {/* Track */}
        <div className="absolute top-1/2 left-0 right-0 h-px bg-primary/15 -translate-y-1/2" />

        {/* "Now" marker */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 flex flex-col items-center">
          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
          <span className="text-sm text-muted-foreground/80 mt-1.5 absolute top-full whitespace-nowrap">now</span>
        </div>

        {/* Run dots */}
        {runs.map((run, i) => {
          const pct = ((run.getTime() - now) / totalSpan) * 100;
          return (
            <div
              key={i}
              className="animate-fade-slide-in absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center group"
              style={{ left: `${pct}%` }}
            >
              <div className={`w-2 h-2 rounded-full ${i === 0 ? 'bg-primary' : 'bg-primary/40'} ring-2 ring-primary/10`} />
              <span className={`text-sm mt-1.5 absolute top-full whitespace-nowrap ${
                i === 0 ? 'text-primary/70 font-medium' : 'text-muted-foreground/80 opacity-0 group-hover:opacity-100 transition-opacity'
              }`}>
                {formatRunTime(run)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CronSchedulePreview({ cronPreview }: { cronPreview: CronPreview }) {
  const runs = useMemo(
    () => cronPreview.next_runs.map((r) => new Date(r)),
    [cronPreview.next_runs],
  );
  const firstRun = runs[0];
  const lastRun = runs[runs.length - 1];
  if (!firstRun || !lastRun) return null;

  const now = Date.now();
  const totalSpan = lastRun.getTime() - now;
  if (totalSpan <= 0) return null;

  return (
    <div
      className="animate-fade-slide-in mt-3 p-3 rounded-modal bg-amber-500/5 border border-amber-500/10"
    >
      {/* Human-readable summary */}
      <div className="flex items-center gap-2 mb-2.5">
        <CalendarClock className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0" />
        <p className="text-sm text-foreground/90">
          <span className="font-medium text-amber-400/90">{cronPreview.description}</span>
          {' -- '}next run:{' '}
          <span className="font-medium text-foreground/90">{formatRunTime(firstRun)}</span>
          <span className="text-muted-foreground/50 ml-1 text-xs">(local)</span>
        </p>
      </div>

      {/* Mini timeline */}
      <div className="relative h-6 mx-1">
        <div className="absolute top-1/2 left-0 right-0 h-px bg-amber-400/15 -translate-y-1/2" />

        {/* "Now" marker */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 flex flex-col items-center">
          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
          <span className="text-sm text-muted-foreground/80 mt-1.5 absolute top-full whitespace-nowrap">now</span>
        </div>

        {/* Run dots */}
        {runs.map((run, i) => {
          const pct = Math.min(((run.getTime() - now) / totalSpan) * 100, 100);
          return (
            <div
              key={i}
              className="animate-fade-slide-in absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center group"
              style={{ left: `${pct}%` }}
            >
              <div className={`w-2 h-2 rounded-full ${i === 0 ? 'bg-amber-400' : 'bg-amber-400/40'} ring-2 ring-amber-400/10`} />
              <span className={`text-sm mt-1.5 absolute top-full whitespace-nowrap ${
                i === 0 ? 'text-amber-400/80 font-medium' : 'text-muted-foreground/80 opacity-0 group-hover:opacity-100 transition-opacity'
              }`}>
                {formatRunTime(run)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

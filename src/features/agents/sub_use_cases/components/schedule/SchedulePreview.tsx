import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { CalendarClock } from 'lucide-react';
import type { CronPreview } from '@/api/pipeline/triggers';
import { formatRunTime } from '../../libs/scheduleHelpers';

export function NextRunsPreview({ preview }: { preview: CronPreview }) {
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

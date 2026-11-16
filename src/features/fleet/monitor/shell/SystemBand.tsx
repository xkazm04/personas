// System band — app-level activity with no persona. It belongs above the
// Activity board (the fleet read); the other surfaces own their full height and
// carry no persona-less work.

import { Activity } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { processStatusMeta, processStatusLabel, elapsedStr, type ProcessEntry } from '../monitorModel';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

export function SystemBand({ processes, now }: { processes: ProcessEntry[]; now: number }) {
  const { t } = useTranslation();
  if (processes.length === 0) return null;
  return (
    <div className="relative z-10 flex-shrink-0 flex items-center gap-2 px-5 py-2 border-b border-hair bg-surface-1 overflow-x-auto">
      <span className="flex-shrink-0 flex items-center gap-1.5 typo-eyebrow text-ink-3">
        <Activity className="w-3 h-3" /> {t.monitor.system}
      </span>
      {processes.map(({ key, proc }) => {
        const M = processStatusMeta(proc.status);
        return (
          <Tooltip content={proc.lastEvent ?? proc.domain} key={key}><span
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-interactive border border-hair bg-background/60 typo-caption"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${M.dot} ${M.pulse ? 'animate-pulse' : ''}`} />
            <span className="text-foreground max-w-[160px] truncate">{proc.label ?? proc.domain}</span>
            <span className={M.text}>
              {proc.status === 'running' ? elapsedStr(proc.startedAt, now) : processStatusLabel(t, proc.status)}
            </span>
          </span></Tooltip>
        );
      })}
    </div>
  );
}

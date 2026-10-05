// BottomStrip — the Board's bottom edge, one line: app-level work no persona
// owns (the System band's rows: what, status, how long), then how many
// personas are working right now.

import { memo, type CSSProperties } from 'react';
import { Cpu } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { elapsedStr, processStatusLabel, type ProcessEntry } from '../monitorModel';
import { PILE_VISUAL } from './piles';

/** A process's dot: live work in the working colour, a failure red, the rest quiet. */
function processTone(status: string): string {
  if (status === 'running') return PILE_VISUAL.working.tone;
  if (status === 'failed') return PILE_VISUAL.critical.tone;
  if (status === 'input_required' || status === 'draft_ready') return PILE_VISUAL.warning.tone;
  return PILE_VISUAL.resting.tone;
}

export const BottomStrip = memo(function BottomStrip({ processes, now, working }: {
  processes: ProcessEntry[];
  now: number;
  working: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="fb-bottom">
      <span className="flex flex-shrink-0 items-center gap-1.5 typo-eyebrow text-foreground">
        <Cpu className="h-4 w-4" aria-hidden /> {t.monitor.system}
      </span>
      <ul className="flex min-w-0 flex-1 items-center gap-5 overflow-hidden" aria-label={t.monitor.system}>
        {processes.length === 0 && <li className="typo-caption">{t.monitor.board_system_idle}</li>}
        {processes.map(({ key, proc }) => {
          const status = proc.status === 'running' ? elapsedStr(proc.startedAt, now) : processStatusLabel(t, proc.status);
          return (
            <li key={key} className="min-w-0 flex-shrink">
              <Tooltip content={proc.lastEvent ?? proc.domain}>
                <span className="flex min-w-0 items-center gap-2" style={{ '--fb-tone': processTone(proc.status) } as CSSProperties}>
                  <i className="fb-dot" aria-hidden />
                  <span className="truncate typo-label text-foreground">{proc.label ?? proc.domain}</span>
                  <span className="flex-shrink-0 typo-caption fb-ink">{status}</span>
                </span>
              </Tooltip>
            </li>
          );
        })}
      </ul>
      <span className="flex flex-shrink-0 items-center gap-2" style={{ '--fb-tone': PILE_VISUAL.working.tone } as CSSProperties}>
        <i className="fb-dot" aria-hidden />
        <Numeric value={working} unit="count" className="typo-data text-foreground" />
        <span className="typo-caption">{t.monitor.board_pile_working}</span>
      </span>
    </div>
  );
});

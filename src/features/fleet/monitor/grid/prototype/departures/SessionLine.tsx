// Departures · SessionLine — a live Claude session as one ledger line.
// PROTOTYPE (variant C).
//
//   • Session title …………………………   ✦ Athena    4m   [recap]
//
// The dot is the canonical fleet palette (`sessionStateMeta.dot`), so a session
// wears the same colour here as on the Fleet page. The origin is a word, not a
// bare glyph. The line opens the terminal; recap is a hover affordance.

import { memo, type ReactNode } from 'react';
import { ScanEye } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { shortElapsed, useSessionFacts } from '../shared';

export const SessionLine = memo(function SessionLine({
  session, item = null, now, flash = false, onOpen, onRecap, compact = false, lead, flag, testId = 'fleet-grid-session',
}: {
  session: FleetSession;
  item?: QueueItem | null;
  now: number;
  flash?: boolean;
  onOpen?: (s: FleetSession) => void;
  onRecap?: (s: FleetSession) => void;
  /** Narrow lane: origin folds to its glyph (named in a Tooltip), project drops. */
  compact?: boolean;
  /** Leading tabular cell (a gate number on the runway). */
  lead?: ReactNode;
  /** Trailing warning word (OVERBOOKED). */
  flag?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  const f = useSessionFacts()(session, item);
  const live = session.state === 'running' || session.state === 'spawning';
  const OriginIcon = f.OriginIcon;
  const aria = [f.label, f.stateLabel, f.project, f.originLabel, flag].filter(Boolean).join(' · ');

  const body = (
    <>
      {lead}
      <Tooltip content={f.stateLabel}>
        <span aria-hidden className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${f.stateDot} ${live ? 'motion-safe:animate-pulse' : ''}`} />
      </Tooltip>
      <span className="min-w-0 flex-1 truncate typo-body text-foreground">{f.label}</span>
      {!compact && f.project && (
        <span className="hidden w-36 flex-shrink-0 truncate typo-caption text-foreground opacity-60 xl:block">{f.project}</span>
      )}
      {compact ? (
        <Tooltip content={f.originLabel}>
          <OriginIcon className="h-3.5 w-3.5 flex-shrink-0 text-foreground opacity-60" aria-hidden />
        </Tooltip>
      ) : (
        <span className="inline-flex w-28 flex-shrink-0 items-center gap-1.5 typo-caption text-foreground opacity-70">
          <OriginIcon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          <span className="truncate">{f.originLabel}</span>
        </span>
      )}
      {flag && <span className="flex-shrink-0 typo-label uppercase tracking-wide text-status-warning">{flag}</span>}
      <span className="w-14 flex-shrink-0 text-right typo-data tabular-nums text-foreground opacity-80">
        {live || session.state === 'awaiting_input' ? shortElapsed(f.startedAt, now) : f.stateLabel}
      </span>
    </>
  );

  return (
    <div
      className={`group relative flex w-full items-center gap-2.5 border-b border-border/30 px-2 py-1 transition-colors hover:bg-secondary/30 ${
        flash ? 'ring-1 ring-inset ring-primary' : ''
      }`}
      data-testid={testId}
      data-state={session.state}
    >
      {onOpen ? (
        <button type="button" onClick={() => onOpen(session)} aria-label={aria} className="focus-ring flex min-w-0 flex-1 items-center gap-2.5 text-left">
          {body}
        </button>
      ) : (
        <span role="group" aria-label={aria} className="flex min-w-0 flex-1 items-center gap-2.5">{body}</span>
      )}
      {onRecap && (
        <Tooltip content={t.monitor.grid_session_recap_open}>
          <button
            type="button"
            onClick={() => onRecap(session)}
            aria-label={t.monitor.grid_session_recap_open}
            data-testid="fleet-grid-session-recap"
            className="focus-ring inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-interactive text-foreground opacity-0 transition-opacity hover:bg-secondary/50 focus-visible:opacity-100 group-hover:opacity-70"
          >
            <ScanEye className="h-3.5 w-3.5" aria-hidden />
          </button>
        </Tooltip>
      )}
    </div>
  );
});

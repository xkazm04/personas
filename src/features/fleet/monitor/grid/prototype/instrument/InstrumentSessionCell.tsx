// InstrumentSessionCell — one Claude session, subordinate to the personas: a
// DOTTED spine in the canonical fleet-state hue, the title, and a mono line of
// state · elapsed · origin (· project where the column does not imply it).
// Recap and "over the cap" ride the right edge.

import { memo, type ReactNode } from 'react';
import { ScanEye } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { useSessionFacts, shortElapsed } from '../shared';
import { MonoTag, Spine } from './parts';

const LIVE = new Set(['running', 'spawning', 'awaiting_input']);

export const InstrumentSessionCell = memo(function InstrumentSessionCell({
  session, item, now, flash = false, showProject = false, overAdmitted = false, onOpen, onRecap, trailing,
}: {
  session: FleetSession;
  item?: QueueItem | null;
  now: number;
  flash?: boolean;
  showProject?: boolean;
  overAdmitted?: boolean;
  onOpen?: (s: FleetSession) => void;
  onRecap?: (s: FleetSession) => void;
  /** Extra right-edge controls (queue verbs). */
  trailing?: ReactNode;
}) {
  const { t } = useTranslation();
  const f = useSessionFacts()(session, item);
  const live = LIVE.has(session.state);
  const Origin = f.OriginIcon;
  const data = [
    f.stateLabel,
    live ? shortElapsed(f.startedAt, now) : null,
    showProject ? f.project : null,
  ].filter(Boolean).join(' · ');

  const body = (
    <>
      <span className="line-clamp-2 typo-body text-foreground">{f.label}</span>
      <span className="flex min-w-0 items-center gap-1.5 typo-code text-foreground">
        <span className="min-w-0 truncate opacity-80">{data}</span>
        <Tooltip content={f.originLabel}>
          <span className="inline-flex flex-shrink-0 items-center gap-1 opacity-60">
            <Origin className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">{f.originLabel}</span>
          </span>
        </Tooltip>
        {overAdmitted && (
          <MonoTag tone="border-status-warning/40 text-status-warning">{t.monitor.queue_over_admitted}</MonoTag>
        )}
      </span>
    </>
  );

  return (
    <div
      className={`group relative flex w-full items-start gap-1 rounded-interactive transition-colors hover:bg-foreground/[0.04] ${
        flash ? 'ring-2 ring-primary' : ''
      }`}
      data-state={session.state}
    >
      <Spine state="idle" dotted className={f.stateDot} />
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(session)}
          aria-label={`${f.label} · ${f.stateLabel} · ${f.originLabel}`}
          data-testid="fleet-grid-session"
          className="focus-ring flex min-w-0 flex-1 flex-col gap-0.5 rounded-interactive py-1.5 pl-3 text-left"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5 pl-3" data-testid="fleet-grid-session">{body}</div>
      )}
      <span className="flex flex-shrink-0 items-center gap-0.5 self-center pr-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {onRecap && (
          <Tooltip content={t.monitor.grid_session_recap_open}>
            <button
              type="button"
              onClick={() => onRecap(session)}
              aria-label={t.monitor.grid_session_recap_open}
              data-testid="fleet-grid-session-recap"
              className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded-interactive text-foreground hover:bg-secondary/40 hover:text-primary"
            >
              <ScanEye className="h-3.5 w-3.5" aria-hidden />
            </button>
          </Tooltip>
        )}
        {trailing}
      </span>
    </div>
  );
});

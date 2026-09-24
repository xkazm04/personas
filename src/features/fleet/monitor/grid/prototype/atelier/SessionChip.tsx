// Atelier session chip — a slim, quiet line under a project: state dot, the
// session's own title (two lines allowed), and one meta line in words —
// "Working · 4m · Athena". Click opens the terminal; the recap sits on the
// right and surfaces on hover / focus.

import { memo } from 'react';
import { ScanEye } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { shortElapsed, useSessionFacts } from '../shared';

export const SessionChip = memo(function SessionChip({
  session, item = null, now, flash, overAdmitted = false, showProject = false, reducedMotion, onOpen, onRecap,
}: {
  session: FleetSession;
  item?: QueueItem | null;
  now: number;
  flash: boolean;
  overAdmitted?: boolean;
  /** Board-wide lists (runway, lanes) name the project; a project card does not. */
  showProject?: boolean;
  reducedMotion: boolean;
  onOpen?: (s: FleetSession) => void;
  onRecap?: (s: FleetSession) => void;
}) {
  const { t } = useTranslation();
  const f = useSessionFacts()(session, item);
  const live = f.state === 'running' || f.state === 'spawning';
  const meta = [
    live ? `${f.stateLabel} · ${shortElapsed(f.startedAt, now)}` : f.stateLabel,
    f.originLabel,
    showProject ? f.project : null,
  ].filter(Boolean).join(' · ');
  const OriginIcon = f.OriginIcon;

  return (
    <div
      className={`group/chip relative flex items-start gap-2.5 rounded-input px-2 py-1.5 transition-colors ${
        overAdmitted ? 'bg-status-warning/10' : 'bg-foreground/[0.03] hover:bg-secondary/40'
      } ${flash ? 'ring-2 ring-primary' : ''}`}
      data-state={f.state}
    >
      <button
        type="button"
        onClick={onOpen ? () => onOpen(session) : undefined}
        disabled={!onOpen}
        aria-label={`${f.label}, ${meta}`}
        data-testid="fleet-grid-session"
        className="focus-ring flex min-w-0 flex-1 items-start gap-2.5 rounded-interactive text-left disabled:cursor-default"
      >
        <span
          aria-hidden
          className={`mt-2 h-2 w-2 flex-shrink-0 rounded-full ${f.stateDot} ${live && !reducedMotion ? 'animate-pulse' : ''}`}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="line-clamp-2 typo-body text-foreground">{f.label}</span>
          <span className="flex min-w-0 items-center gap-1.5 typo-caption text-foreground opacity-65">
            <OriginIcon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
            <span className="truncate">{meta}</span>
          </span>
        </span>
      </button>
      {onRecap && (
        <Tooltip content={t.monitor.grid_session_recap_open}>
          <button
            type="button"
            onClick={() => onRecap(session)}
            aria-label={t.monitor.grid_session_recap_open}
            data-testid="fleet-grid-session-recap"
            className="focus-ring mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-interactive text-foreground opacity-0 transition-opacity hover:bg-secondary/50 focus-visible:opacity-100 group-hover/chip:opacity-80"
          >
            <ScanEye className="h-4 w-4" aria-hidden />
          </button>
        </Tooltip>
      )}
    </div>
  );
});

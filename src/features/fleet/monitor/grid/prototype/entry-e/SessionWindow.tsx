// A session as a LEAN window (the Runway socket card). The body is the lamp and
// the title, nothing else; the age sits in the bottom-right corner beside its
// ladder. Every other fact rides an icon column hugging the right border - the
// recap on top, the state under it (its tooltip carries state, origin and
// project), then whatever else applies (over the cap). Right-click, Shift+F10
// or the Menu key opens the card's verbs (see `SessionMenu`).

import { memo } from 'react';
import { AlertTriangle, ScanEye } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Button } from '@/features/shared/components/buttons';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { useSessionFacts } from '../shared';
import { AGE_RUNG_COUNT, ageRungs, compactAge, sessionLamp, toneClass } from './tone';
import { Lamp, Segments } from './parts';
import { useSessionMenu } from './SessionMenu';
import { sessionStateIcon, useSessionSummary } from './sessionBits';

const STANDING_MS = 6 * 60 * 60 * 1000;
const ICON_BTN = 'ae-focus flex h-7 w-7 items-center justify-center rounded-interactive text-foreground transition-colors hover:bg-secondary/40';

export const SessionWindow = memo(function SessionWindow({
  session, item = null, onOpen, onRecap, flash = false, over = false, now,
}: {
  session: FleetSession;
  item?: QueueItem | null;
  /** Absent for an exited session: its terminal is gone. */
  onOpen?: (s: FleetSession) => void;
  onRecap: (s: FleetSession) => void;
  flash?: boolean;
  /** A live session past the cap after Start now. */
  over?: boolean;
  now: number;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  const f = useSessionFacts()(session, item);
  const summary = useSessionSummary(f, now, over);
  const menu = useSessionMenu(session);
  const lamp = sessionLamp(session.state);
  const fresh = now - f.lastActivity < STANDING_MS;
  const age = Math.max(0, now - f.startedAt);
  const StateIcon = sessionStateIcon(session.state);

  const title = (
    <span className="flex min-w-0 items-start gap-2">
      <Lamp lamp={lamp} className="mt-[7px]" />
      <span className="ae-clamp2 min-w-0 flex-1 typo-body text-foreground">{f.label}</span>
    </span>
  );

  return (
    <div
      className={`ae-win group relative flex w-full min-w-0 rounded-input ${toneClass(lamp.tone)} ${lamp.lit && fresh ? 'is-lit' : ''} ${
        over ? 'is-over ae-hatch' : ''} ${flash ? 'is-flash' : ''}`}
      data-testid="fleet-grid-session"
      data-state={session.state}
      onContextMenu={menu.onContextMenu}
      onKeyDown={menu.onKeyDown}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5 py-1.5 pl-2.5">
        {onOpen ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => onOpen(session)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(session); } }}
            aria-label={summary.replace(/\n/g, ', ')}
            className="ae-focus min-w-0 cursor-pointer rounded-input text-left"
          >
            {title}
          </div>
        ) : (
          <span role="img" aria-label={summary.replace(/\n/g, ', ')} className="min-w-0">{title}</span>
        )}
        <span className="flex items-center gap-2 pl-[18px]">
          <Segments count={AGE_RUNG_COUNT} lit={ageRungs(age)} tone={lamp.lit ? lamp.tone : 'off'} thin className="min-w-0 flex-1 opacity-80" />
          <span className="flex-shrink-0 typo-caption tabular-nums text-foreground">{compactAge(age)}</span>
        </span>
      </div>
      <div className="flex flex-shrink-0 flex-col items-center gap-0.5 border-l border-border px-0.5 py-1" data-testid="entry-e-session-icons">
        <Tooltip content={m.grid_session_recap_open} placement="left">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onRecap(session)}
            aria-label={m.grid_session_recap_open}
            data-testid="fleet-grid-session-recap"
            icon={<ScanEye className="h-3.5 w-3.5" aria-hidden />}
          />
        </Tooltip>
        <Tooltip content={<span className="whitespace-pre-line">{summary}</span>} placement="left">
          <span role="img" aria-label={f.stateLabel} tabIndex={0} className={`${ICON_BTN} ${toneClass(lamp.tone)} ae-tone-text`} data-testid="entry-e-session-state">
            <StateIcon className="h-3.5 w-3.5" aria-hidden />
          </span>
        </Tooltip>
        {over && (
          <Tooltip content={m.queue_over_admitted} placement="left">
            <span role="img" aria-label={m.queue_over_admitted} className={`${ICON_BTN} text-status-warning`}>
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            </span>
          </Tooltip>
        )}
      </div>
    </div>
  );
});

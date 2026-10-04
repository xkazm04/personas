// A session as a COMPACT LINE (Lanes, Classic, the tray): two rows inside the
// plate, hairlines between lines instead of a box around each. Row one is the
// lamp and the title. A lit line spills its tone from the left. The recap sits
// at the right of row one, shown on hover or focus.
//
// ROW TWO IS DRAWN, NOT WRITTEN (2026-10-04). It used to read
// "Awaiting input · Curator · personas-web" — three strings competing with the
// title for the same width, in a line 50px tall. Each fact is now the mark it
// already has elsewhere on the panel: the STATE is its glyph in the line's own
// lamp tone (`sessionStateIcon` + `ae-tone-text`, the same pairing the bays
// use), the SOURCE is the origin glyph every node on the board is stamped
// with (`ORIGIN_GLYPH`, via `useSessionFacts`), and the age stays a bar with
// its figure. Only the project — which no glyph can stand for — is still text,
// and only where the list is board-wide. The words are not lost: the line's
// tooltip and its `aria-label` are the same full reading as before.

import { memo, type KeyboardEvent } from 'react';
import { ScanEye } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Button } from '@/features/shared/components/buttons';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { useSessionFacts } from '../shared';
import { AGE_RUNG_COUNT, ageRungs, compactAge, sessionLamp, toneClass } from './tone';
import { Lamp } from './parts';
import { useSessionMenu } from './SessionMenu';
import { sessionStateIcon, useSessionSummary } from './sessionBits';

export const SESSION_LINE_H = 50;

export const SessionLine = memo(function SessionLine({
  session, item = null, onOpen, onRecap, flash = false, over = false, now, showProject = false,
}: {
  session: FleetSession;
  item?: QueueItem | null;
  /** Absent for an exited session: its terminal is gone. */
  onOpen?: (s: FleetSession) => void;
  onRecap: (s: FleetSession) => void;
  flash?: boolean;
  over?: boolean;
  now: number;
  /** Board-wide lists (Lanes) name the project; a project bay already does. */
  showProject?: boolean;
}) {
  const { t } = useTranslation();
  const f = useSessionFacts()(session, item);
  const summary = useSessionSummary(f, now, over);
  const menu = useSessionMenu(session);
  const lamp = sessionLamp(session.state);
  const age = Math.max(0, now - f.startedAt);
  const Origin = f.OriginIcon;
  const State = sessionStateIcon(session.state);
  const open = () => onOpen?.(session);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    menu.onKeyDown(e);
    if (e.defaultPrevented || e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  };

  return (
    <Tooltip content={<span className="whitespace-pre-line">{summary}</span>} placement="right" delay={450}>
      <div
        role={onOpen ? 'button' : 'img'}
        tabIndex={0}
        onClick={onOpen ? open : undefined}
        onKeyDown={onKey}
        onContextMenu={menu.onContextMenu}
        aria-label={summary.replace(/\n/g, ', ')}
        data-testid="fleet-grid-session"
        data-state={session.state}
        className={`ae-line ae-row ae-focus flex w-full min-w-0 flex-col justify-center gap-0.5 px-2.5 ${onOpen ? 'cursor-pointer' : ''} ${
          toneClass(lamp.tone)} ${lamp.lit ? 'is-lit' : ''} ${over ? 'is-over' : ''} ${flash ? 'is-flash' : ''}`}
        style={{ height: SESSION_LINE_H }}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Lamp lamp={lamp} />
          <span className="min-w-0 flex-1 truncate typo-body text-foreground">{f.label}</span>
          <span className="ae-reveal -my-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onRecap(session)}
              aria-label={t.monitor.grid_session_recap_open}
              data-testid="fleet-grid-session-recap"
              icon={<ScanEye className="h-3.5 w-3.5" aria-hidden />}
            />
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-2 pl-[18px] typo-caption">
          <State className="ae-tone-text h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          <Origin className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          {showProject && f.project && <span className="min-w-0 flex-1 truncate">{f.project}</span>}
          <span className={`ae-bar w-10 flex-shrink-0 ${showProject && f.project ? '' : 'ml-auto'}`} aria-hidden>
            <span style={{ width: `${(ageRungs(age) / AGE_RUNG_COUNT) * 100}%`, opacity: lamp.lit ? 1 : 0.45 }} />
          </span>
          <span className="w-8 flex-shrink-0 text-right tabular-nums text-foreground">{compactAge(age)}</span>
        </span>
      </div>
    </Tooltip>
  );
});

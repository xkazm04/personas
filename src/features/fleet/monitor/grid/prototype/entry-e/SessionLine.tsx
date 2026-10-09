// A session as a COMPACT CARD (Lanes, Classic, the tray), worn as a Board
// tile: its pile is the card's whole background (`sessionPileKey` - awaiting
// input, stale or a failed exit is a solid tone fill, running is lit theme
// colour with the sweep, alive and idle is glass, ended is hatched), so a lane
// sorts itself before a title is read.
//
// The face is the ORIGIN glyph every node on the board is stamped with
// (`ORIGIN_GLYPH`, via `useSessionFacts`), framed on the Board's puck. Row one
// is the title, with the recap at its right on hover or focus. Row two is the
// state glyph and - unless the card is working, when the lit fill already says
// it - the state in words, the project where the list is board-wide, and the
// age as its figure. The age is also DRAWN along the foot (the Board's run-age
// bar: a log scale full at four hours), so a forgotten session is the long
// bar. The tooltip and the `aria-label` are the full reading.

import { memo, type KeyboardEvent } from 'react';
import { ScanEye } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Button } from '@/features/shared/components/buttons';
import { runAgeFraction } from '../../skin/tileState';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { useSessionFacts } from '../shared';
import { compactAge } from './tone';
import { pileSkin, sessionPileKey } from './pileSkin';
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
  const skin = pileSkin(sessionPileKey(session), session.id);
  const age = Math.max(0, now - f.startedAt);
  const Origin = f.OriginIcon;
  const State = sessionStateIcon(session.state);
  const open = () => onOpen?.(session);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    menu.onKeyDown(e);
    if (e.defaultPrevented || e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  };
  const project = showProject ? f.project : null;

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
        data-pile={skin.pile}
        className={`${skin.className} ae-row flex min-w-0 items-center gap-2 pl-1.5 pr-1 ${onOpen ? '' : 'is-inert'} ${
          over ? 'is-over' : ''} ${flash ? 'is-flash' : ''}`}
        style={{ ...skin.style, height: SESSION_LINE_H }}
      >
        <span className="fb-face fb-ink ae-puck" aria-hidden><Origin className="h-4 w-4" /></span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 truncate typo-heading">{f.label}</span>
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
          <span className="flex min-w-0 items-center gap-1.5 pr-1.5 typo-label">
            <State className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
            {skin.pile !== 'working' && <span className="min-w-0 flex-shrink truncate">{f.stateLabel}</span>}
            {project && <span className={`min-w-0 flex-1 truncate ${skin.pile !== 'working' ? 'ae-sep' : ''}`}>{project}</span>}
            <span className="ml-auto flex-shrink-0 tabular-nums">{compactAge(age)}</span>
          </span>
        </span>
        <i className="fb-age" aria-hidden style={{ width: `${runAgeFraction(f.startedAt, Math.floor(now / 60_000)) * 100}%` }} />
      </div>
    </Tooltip>
  );
});

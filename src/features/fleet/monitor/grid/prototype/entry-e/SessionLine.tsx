// A session as ONE LINE of its bay or lane (WP11 C): the persona line's anatomy
// (`PersonaLine`, V1 "Tail") applied to a session, so a bay of personas and
// sessions reads as one list. A flat 36px hairline row (`.ae-line`): the origin
// glyph every node on the board is stamped with (`ORIGIN_GLYPH`, via
// `useSessionFacts`) in the same 24px frame a persona's face wears, the bold
// title, then the state as a glyph token and, unless it runs, the state in
// words (and the project where the list is board-wide); at the right edge the
// resource glyph, the session's age as its figure, and the lamp, exactly where
// a persona line puts its elapsed and lamp. State is the lamp plus a tone edge
// (`sessionTailModel.ts`), never a fill. The recap floats over the right edge on
// hover or focus. A running line keeps the ambient sweep while motion is
// allowed (`ae-sweep`, gated by the panel's `ae-moving`).
//
// One line is enough: every fact the old two-row card printed is a token here
// (state, project, age) or in the tooltip (origin), so nothing earns a second row.

import { memo, type CSSProperties, type KeyboardEvent } from 'react';
import { ScanEye, type LucideIcon } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Button } from '@/features/shared/components/buttons';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { useSessionFacts } from '../shared';
import { pileOfKey, sweepDelay } from './pileSkin';
import { useSessionMenu } from './SessionMenu';
import { sessionStateIcon } from './sessionBits';
import { SessionResource } from './devices/DeviceGlyph';
import { Lamp } from './parts';
import { toneClass } from './tone';
import { GlyphFace, LineHead, lineEdgeClass, Tok, TOK_ICON, TOK_TYPE } from './LineParts';
import { sessionSentence, sessionTail, type SessionTail } from './sessionTailModel';

export const SESSION_LINE_H = 36;

/** The tokens after a session's title: the state glyph, then its word and the project, which leave first. */
export function SessionHead({
  label, State, tail, stateLabel, project,
}: { label: string; State: LucideIcon; tail: SessionTail; stateLabel: string | null; project: string | null }) {
  const word = tail.word && stateLabel ? stateLabel : null;
  return (
    <LineHead
      name={label}
      lead={<Tok><State className={`${TOK_ICON} ${tail.kind === 'resting' || tail.kind === 'off' ? '' : 'ae-tone-text'}`} aria-hidden /></Tok>}
      leadTestId="session-line-state"
      after={word || project ? (
        <>
          {word && <span data-testid="session-line-word" className={`flex-shrink-0 whitespace-nowrap ${TOK_TYPE}`}>{word}</span>}
          {project && <span className={`flex-shrink-0 whitespace-nowrap ${TOK_TYPE} ${word ? 'ae-sep ml-1.5' : ''}`}>{project}</span>}
        </>
      ) : null}
    />
  );
}

/** The line's classes: tone, edge, sweep while it runs. */
export function sessionLineClass(tail: SessionTail): string {
  return `ae-line ae-row ${toneClass(tail.tone)} ${lineEdgeClass(tail.kind)} ${tail.kind === 'working' ? 'ae-sweep' : ''}`;
}

export const lineStyle = (seed: string): CSSProperties => ({ height: SESSION_LINE_H, '--ae-sd': sweepDelay(seed) } as CSSProperties);

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
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const f = useSessionFacts()(session, item);
  const menu = useSessionMenu(session);
  const tail = sessionTail({ state: session.state, exitCode: session.exitCode, startedAt: f.startedAt, now });
  const project = showProject ? f.project : null;
  const sentence = sessionSentence({ label: f.label, stateLabel: f.stateLabel, originLabel: f.originLabel, project: f.project, age: tail.age }, m, tx);
  const lines = [sentence, ...(over ? [m.queue_over_admitted] : [])];
  const open = () => onOpen?.(session);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    menu.onKeyDown(e);
    if (e.defaultPrevented || e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  };

  return (
    <Tooltip content={<span className="whitespace-pre-line">{lines.join('\n')}</span>} placement="right" delay={450}>
      <div
        role={onOpen ? 'button' : 'img'}
        tabIndex={0}
        onClick={onOpen ? open : undefined}
        onKeyDown={onKey}
        onContextMenu={menu.onContextMenu}
        aria-label={lines.join(', ')}
        data-testid="fleet-grid-session"
        data-state={session.state}
        data-pile={pileOfKey(tail.kind)}
        data-kind={tail.kind}
        className={`${sessionLineClass(tail)} flex min-w-0 items-center gap-1.5 pl-2 pr-2.5 ${onOpen ? 'cursor-pointer' : 'is-inert'} ${
          over ? 'is-over' : ''} ${flash ? 'is-flash' : ''}`}
        style={lineStyle(session.id)}
      >
        <GlyphFace Icon={f.OriginIcon} />
        <SessionHead label={f.label} State={sessionStateIcon(session.state)} tail={tail} stateLabel={f.stateLabel} project={project} />
        <span className="ml-auto flex flex-shrink-0 items-center gap-2 pl-1">
          <SessionResource sessionId={session.id} />
          <span data-testid="session-line-age" className={`flex-shrink-0 typo-data tabular-nums ${tail.kind === 'working' ? 'ae-tone-text' : 'text-foreground'}`}>{tail.age}</span>
          <Lamp lamp={tail.lamp} />
        </span>
        <span className="ae-reveal ae-float" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onRecap(session)}
            aria-label={m.grid_session_recap_open}
            data-testid="fleet-grid-session-recap"
            icon={<ScanEye className="h-3.5 w-3.5" aria-hidden />}
          />
        </span>
      </div>
    </Tooltip>
  );
});

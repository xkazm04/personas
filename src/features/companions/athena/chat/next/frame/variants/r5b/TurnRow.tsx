/**
 * One turn of the conversation on the instrument's reading grid: a mono
 * gutter says who and when, the body carries the words. Your ask is the same
 * reading size as her reply, set in the quieter ink; her steps sit between as
 * a folded readout; her reply is the full-ink prose on a 68ch measure.
 *
 * A message you just sent arrives here by FLIGHT: it starts where the composer
 * was and glides into its row, so the words you typed are the same object the
 * transcript shows (`flight` is set by the command line on submit).
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { useLayoutEffect, useRef, type MutableRefObject } from 'react';
import { animate } from 'framer-motion';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { stripModelDirectives } from '../../../../../athenaLabels';
import { AthenaChatTurnActions } from '../../../../AthenaChatTurnActions';
import { AssistantProse } from '../../../../refs/AssistantProse';
import type { Turn } from '../../../exchange';
import { NEXT_COPY as N } from '../../../nextCopy';
import { R5B_COPY as C } from './copy';
import { StepReadout } from './StepReadout';

export interface Flight { text: string; rect: DOMRect }

const TRIGGER: Record<Turn['trigger'], string> = {
  user: C.you,
  autonomous: N.autonomousTurn,
  proactive: N.proactiveTurn,
  fleet: N.fleetTurn,
};

function Gutter({ who, tone, at }: { who: string; tone: string; at?: string }) {
  return (
    <div className="pt-1 flex flex-col gap-0.5 min-w-0">
      <p className={`typo-code uppercase ${tone}`}>{who}</p>
      {at && <RelativeTime timestamp={at} className="typo-code text-muted tabular-nums" />}
    </div>
  );
}

function Ask({ text, id, flight, animateFlight }: { text: string; id: string; flight: MutableRefObject<Flight | null>; animateFlight: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const f = flight.current;
    const el = ref.current;
    if (!f || !el || f.text !== text || !id.startsWith('optim_')) return;
    flight.current = null;
    if (!animateFlight) return;
    const r = el.getBoundingClientRect();
    void animate(el, { x: [f.rect.left - r.left, 0], y: [f.rect.top - r.top, 0], opacity: [0.75, 1] }, { duration: 0.42, ease: [0.22, 1, 0.36, 1] });
  }, [flight, text, id, animateFlight]);
  return (
    <p ref={ref} className="typo-body-lg text-foreground whitespace-pre-wrap [overflow-wrap:anywhere] max-w-[68ch] pl-3 border-l-2 border-role-human/50" data-testid="companion-r5b-ask">
      {text}
    </p>
  );
}

export function TurnRow({
  turn,
  isLast,
  streaming,
  interactive,
  flight,
  animateFlight,
  onSend,
}: {
  turn: Turn;
  isLast: boolean;
  streaming: boolean;
  interactive: boolean;
  flight: MutableRefObject<Flight | null>;
  animateFlight: boolean;
  onSend: (text: string) => void;
}) {
  const lastReply = turn.replies[turn.replies.length - 1];
  if (!turn.ask && !turn.replies.length && !turn.asides.length && !turn.machine.length) return null;
  const herLabel = turn.trigger === 'user' ? C.athena : TRIGGER[turn.trigger];
  const steps = turn.asides.length > 0 || turn.machine.length > 0;
  // Her label sits once per turn, on her first row; it carries the time only when she opened the turn.
  const herGutter = <Gutter who={herLabel} tone="text-primary" at={turn.ask ? undefined : turn.createdAt} />;
  return (
    <section className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-5 gap-y-3" data-testid="companion-r5b-turn">
      {turn.ask && (
        <>
          <Gutter who={C.you} tone="text-role-human" at={turn.ask.createdAt} />
          <Ask text={turn.ask.content} id={turn.ask.id} flight={flight} animateFlight={animateFlight} />
        </>
      )}
      {steps && (
        <>
          {turn.ask ? <span /> : herGutter}
          <StepReadout turn={turn} />
        </>
      )}
      {turn.replies.map((r, i) => (
        <div key={r.id} className="contents">
          {i === 0 && (turn.ask || !steps) ? herGutter : <span />}
          <div className="typo-body-lg text-foreground min-w-0 max-w-[68ch]">
            <AssistantProse content={stripModelDirectives(r.content)} codeBlockActions />
          </div>
        </div>
      ))}
      {isLast && lastReply && !streaming && (
        <>
          <span />
          <AthenaChatTurnActions content={lastReply.content} priorUserMessage={turn.ask?.content ?? ''} onSend={onSend} disabled={!interactive} />
        </>
      )}
    </section>
  );
}

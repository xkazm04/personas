// The persona line's tail (WP11 V1): the activity as caption tokens after the
// name, and the one figure at the right edge. The model is `personaTailModel.ts`;
// this file only draws it.
//
// NARROW COLUMNS. The give-way order is the shared token row's
// (`LineParts.tsx`, which sessions and queue rungs use too): the next start
// leaves whole first, then the name truncates to its floor, then the lead
// leaves whole. The figure and the lamp at the right edge never move. The full
// sentence (reason in words, activity, next start) is always in the tooltip.

import { Activity, CalendarClock, CheckCircle2, CircleSlash, History, Hourglass, PowerOff, XCircle, type LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaCardModel } from '../../../monitorModel';
import { NeedGlyph } from '../../skin/NeedGlyph';
import { clockText, type LeadToken, type Outcome, type Tail } from './personaTailModel';
import { LineHead, nameFlex, Tok, TOK_ICON, TOK_TYPE } from './LineParts';

const OUTCOME: Record<Outcome, { Icon: LucideIcon; ink: string }> = {
  completed: { Icon: CheckCircle2, ink: 'text-status-success' },
  failed: { Icon: XCircle, ink: 'text-status-error' },
  cancelled: { Icon: CircleSlash, ink: 'text-foreground' },
  unknown: { Icon: History, ink: 'text-foreground' },
};

const ICON = TOK_ICON;

function Lead({ lead }: { lead: LeadToken }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  if (!lead) return null;
  switch (lead.kind) {
    case 'run':
      return (
        <>
          {lead.elapsed && <Tok><Activity className={`${ICON} ae-t-run ae-tone-text`} aria-hidden />{lead.elapsed}</Tok>}
          {lead.queued > 0 && (
            <Tok label={tx(m.caption_queued_many, { count: lead.queued })}><Hourglass className={ICON} aria-hidden />{lead.queued}</Tok>
          )}
        </>
      );
    case 'last': {
      const { Icon, ink } = OUTCOME[lead.outcome];
      return <Tok><Icon className={`${ICON} ${ink}`} aria-hidden />{lead.age}</Tok>;
    }
    case 'never':
      return <span>{m.board_no_runs}</span>;
    case 'peer':
      return <span>{lead.state === 'running' ? m.grid_state_running : lead.state === 'off' ? m.board_pile_off : m.board_pile_resting}</span>;
  }
}

/** Re-exported: the name's flex is the shared token row's (`LineParts.tsx`). */
export { nameFlex };

/**
 * The name and the tokens after it (`LineHead`): the next start leaves first,
 * then the name truncates to its floor, then the lead leaves whole.
 */
export function TailHead({ name, tail, now }: { name: string; tail: Tail; now: number }) {
  const { t, tx, language } = useTranslation();
  const clock = tail.next !== null ? clockText(tail.next, language, now) : null;
  return (
    <LineHead
      name={name}
      lead={tail.lead ? <Lead lead={tail.lead} /> : null}
      leadTestId="persona-line-lead"
      after={clock !== null ? (
        <span
          data-testid="persona-line-next"
          aria-label={tx(t.monitor.schedule_next, { when: clock })}
          className={`inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap ${TOK_TYPE} ${tail.lead ? 'ae-sep' : ''}`}
        >
          <CalendarClock className={ICON} aria-hidden />{clock}
        </span>
      ) : null}
    />
  );
}

/** The right edge's one figure: why it needs you, the run's elapsed, or the off glyph. */
export function TailFigure({ tail, card, more }: { tail: Tail; card: PersonaCardModel; more: number }) {
  const f = tail.figure;
  if (!f) return null;
  if (f.kind === 'need') {
    return (
      <span className="inline-flex flex-shrink-0 items-center gap-1 ae-tone-text">
        <NeedGlyph card={card} size="md" />
        {more > 0 && <span className="ae-pmore typo-label tabular-nums">+{more}</span>}
      </span>
    );
  }
  if (f.kind === 'elapsed') return <span className="flex-shrink-0 typo-data tabular-nums ae-tone-text">{f.text}</span>;
  return <PowerOff className="h-3.5 w-3.5 flex-shrink-0 text-foreground" aria-hidden />;
}

// The persona line's tail (WP11 V1): the activity as caption tokens after the
// name, and the one figure at the right edge. The model is `personaTailModel.ts`;
// this file only draws it.
//
// NARROW COLUMNS. A bay column runs 250 to 320 px, where the name, the lead and
// the next start cannot all fit. They give way in a fixed order and none is
// ever cut mid-token: the next start leaves whole first, then the name
// truncates down to its floor (`nameFlex`), then the lead leaves whole (it
// wraps out of the one-line head, `TailHead`). The figure and the lamp at the
// right edge never move. The full sentence (reason in words, activity, next
// start) is always in the line's tooltip.

import type { CSSProperties, ReactNode } from 'react';
import { Activity, CalendarClock, CheckCircle2, CircleSlash, History, Hourglass, PowerOff, XCircle, type LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaCardModel } from '../../../monitorModel';
import { NeedGlyph } from '../../skin/NeedGlyph';
import { clockText, type LeadToken, type Outcome, type Tail } from './personaTailModel';

const OUTCOME: Record<Outcome, { Icon: LucideIcon; ink: string }> = {
  completed: { Icon: CheckCircle2, ink: 'text-status-success' },
  failed: { Icon: XCircle, ink: 'text-status-error' },
  cancelled: { Icon: CircleSlash, ink: 'text-foreground' },
  unknown: { Icon: History, ink: 'text-foreground' },
};

const ICON = 'h-3 w-3 flex-shrink-0';

function Tok({ children, label }: { children: ReactNode; label?: string }) {
  return <span className="inline-flex flex-shrink-0 items-center gap-1" aria-label={label}>{children}</span>;
}

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

/**
 * A one-line slot whose content leaves WHOLE when it does not fit: the slot
 * wraps, its first line holds a zero-width spacer, and a token wider than the
 * room falls to the clipped second line instead of being cut.
 */
function DropSlot({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={`flex h-5 flex-wrap items-center overflow-hidden ${className}`}>
      <span aria-hidden className="h-5 w-0" />
      {children}
    </span>
  );
}

/**
 * The name's flex: it ASKS for its floor (six and a half rems, or its own
 * length in `ch` when shorter, so a short name is never padded) when the line
 * decides what fits beside it, then grows to its full width with whatever room
 * is left. So the lead token stays beside a name truncated to its floor, and
 * leaves whole only below it.
 */
export function nameFlex(name: string): CSSProperties {
  return { flex: `1 1 min(6.5rem, ${Math.ceil(name.length * 0.9)}ch)`, maxWidth: 'max-content', minWidth: 0 };
}

/**
 * The name and the tokens after it, in the order they leave a narrow line:
 * the next start first (its slot only ever gets the room left over after the
 * full name and the lead), then the name truncates to its floor, then the lead
 * wraps out of the one-line head and leaves whole. A time is never cut.
 */
export function TailHead({ name, tail, now }: { name: string; tail: Tail; now: number }) {
  const { t, tx, language } = useTranslation();
  const clock = tail.next !== null ? clockText(tail.next, language, now) : null;
  const caption = 'typo-caption tabular-nums text-foreground';
  return (
    <>
      <span className="flex h-6 min-w-0 flex-wrap items-center gap-x-1.5 overflow-hidden" style={{ flex: '0 1 auto' }}>
        <span className="truncate typo-heading text-foreground" style={nameFlex(name)}>{name}</span>
        {tail.lead && (
          <span data-testid="persona-line-lead" className={`inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap ${caption}`}>
            <Lead lead={tail.lead} />
          </span>
        )}
      </span>
      {/* Only drawn when there is a start: an empty slot would still cost the row a gap. */}
      {clock !== null && (
        <DropSlot className="min-w-0 flex-1">
          <span
            data-testid="persona-line-next"
            aria-label={tx(t.monitor.schedule_next, { when: clock })}
            className={`inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap ${caption} ${tail.lead ? 'ae-sep' : ''}`}
          >
            <CalendarClock className={ICON} aria-hidden />{clock}
          </span>
        </DropSlot>
      )}
    </>
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

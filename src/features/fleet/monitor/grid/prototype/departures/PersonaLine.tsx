// Departures · PersonaLine — one persona as one ledger line. PROTOTYPE (variant C).
//
//   ■ Name of the persona ………………… [⚑2] [✉1]   Running 4m
//
// The marker and the status word carry the state; the name gets every pixel the
// section has left (`flex-1`), so it is read, not guessed. Pending work trails as
// tabular tags — icon + count — each with its full phrase in a Tooltip. A live
// channel line, while its bubble is up, reads as a quiet second line.

import { memo } from 'react';
import { MessagesSquare } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { primaryDrawerSection, type DrawerSection, type PersonaCardModel } from '../../../monitorModel';
import type { ChatBubble } from '../../channelBubbleModel';
import { shortElapsed, usePersonaFacts } from '../shared';
import { Marker, PENDING_TEXT, STATE_FILL, STATE_TEXT } from './parts';

export const PersonaLine = memo(function PersonaLine({
  card, now, selected, flash, unseen, bubble, onSelect,
}: {
  card: PersonaCardModel;
  now: number;
  selected: boolean;
  flash: boolean;
  unseen: number;
  bubble: ChatBubble | null;
  onSelect: (personaId: string, section: DrawerSection) => void;
}) {
  const { t, tx } = useTranslation();
  const facts = usePersonaFacts()(card);
  const status = facts.off
    ? t.common.off
    : facts.state === 'running' && facts.runningSince
      ? `${facts.stateLabel} ${shortElapsed(facts.runningSince, now)}`
      : facts.stateLabel;
  const aria = [card.personaName, status, ...facts.pending.map((p) => p.label)].join(', ');

  return (
    <button
      type="button"
      onClick={() => onSelect(card.personaId, primaryDrawerSection(card))}
      aria-label={aria}
      aria-pressed={selected}
      data-testid="fleet-grid-square"
      data-state={facts.state}
      data-persona-id={card.personaId}
      className={`focus-ring group relative flex w-full flex-col border-b border-border/30 px-2 py-1 text-left transition-colors ${
        selected ? 'bg-primary/10' : 'hover:bg-secondary/30'
      } ${flash ? 'ring-1 ring-inset ring-primary' : ''} ${facts.off ? 'opacity-55' : ''}`}
    >
      {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
      <span className="flex min-w-0 items-center gap-2.5">
        <Marker className={STATE_FILL[facts.state]} pulse={facts.state === 'running'} />
        <span className="min-w-0 flex-1 truncate typo-body text-foreground">{facts.name}</span>
        {facts.pending.map((p) => {
          const Icon = p.icon;
          return (
            <Tooltip key={p.key} content={p.label}>
              <span className={`inline-flex flex-shrink-0 items-center gap-1 typo-data tabular-nums ${PENDING_TEXT[p.tone]}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {p.count > 0 && p.count}
              </span>
            </Tooltip>
          );
        })}
        {unseen > 0 && (
          <Tooltip content={tx(t.monitor.grid_chat_unseen, { count: unseen })}>
            <span className="inline-flex flex-shrink-0 items-center gap-1 typo-data tabular-nums text-primary">
              <MessagesSquare className="h-3.5 w-3.5" aria-hidden />
              {unseen}
            </span>
          </Tooltip>
        )}
        <span className={`w-24 flex-shrink-0 text-right typo-caption tabular-nums ${facts.off ? 'text-foreground opacity-60' : STATE_TEXT[facts.state]}`}>
          {status}
        </span>
      </span>
      {bubble && (
        <span className="truncate pl-4 typo-caption italic text-foreground opacity-60">“{bubble.text}”</span>
      )}
    </button>
  );
});

// Atelier persona row — avatar first, words over glyphs. The avatar carries
// the state as a ring; under the name sits the state in a word ("Working · 4m",
// "Needs you"); pending work rides on the right as soft number chips whose
// full phrase lives in a Tooltip. A channel line, when one is up, replaces the
// status line for its TTL, quoted.

import { memo } from 'react';
import { MessageCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { primaryDrawerSection, type DrawerSection, type PersonaCardModel } from '../../../monitorModel';
import type { ChatBubble } from '../../channelBubbleModel';
import { shortElapsed, usePersonaFacts } from '../shared';
import { PENDING_TONE, STATE_RING, STATE_TEXT } from './parts';

export const PersonaRow = memo(function PersonaRow({
  card, selected, flash, bubble, unseenChat, now, onSelect,
}: {
  card: PersonaCardModel;
  selected: boolean;
  flash: boolean;
  bubble: ChatBubble | null;
  unseenChat: number;
  now: number;
  onSelect: (personaId: string, section: DrawerSection) => void;
}) {
  const { t, tx } = useTranslation();
  const facts = usePersonaFacts()(card);
  const status = facts.state === 'running' && facts.runningSince
    ? `${facts.stateLabel} · ${shortElapsed(facts.runningSince, now)}`
    : facts.stateLabel;
  const ariaLabel = [facts.name, status, ...facts.pending.map((p) => p.label)].join(', ');

  return (
    <button
      type="button"
      onClick={() => onSelect(card.personaId, primaryDrawerSection(card))}
      aria-label={ariaLabel}
      aria-pressed={selected}
      data-testid="fleet-grid-square"
      data-state={facts.state}
      data-persona-id={card.personaId}
      className={`focus-ring group/row flex w-full items-start gap-3 rounded-input px-2 py-2 text-left transition-colors ${
        selected ? 'bg-primary/12' : 'hover:bg-secondary/40'
      } ${flash ? 'ring-2 ring-primary' : ''} ${facts.off ? 'opacity-50' : ''}`}
    >
      <span className={`mt-0.5 flex-shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-background ${STATE_RING[facts.state]}`}>
        <PersonaIcon icon={card.personaIcon} color={card.personaColor} name={facts.name} display="framed" frameSize="xs" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="line-clamp-2 typo-body text-foreground">{facts.name}</span>
        {bubble ? (
          <span className="line-clamp-1 typo-caption italic text-foreground opacity-80">“{bubble.text}”</span>
        ) : (
          <span className={`typo-caption ${STATE_TEXT[facts.state]}`}>
            {facts.off ? t.monitor.grid_persona_disabled : status}
          </span>
        )}
      </span>
      {(facts.pending.length > 0 || unseenChat > 0) && (
        <span className="mt-0.5 flex flex-shrink-0 flex-wrap items-center justify-end gap-1">
          {facts.pending.map((p) => {
            const Icon = p.icon;
            return (
              <Tooltip key={p.key} content={p.label}>
                <span className={`inline-flex items-center gap-1 rounded-pill px-1.5 py-0.5 typo-label tabular-nums ${PENDING_TONE[p.tone]}`}>
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {p.count > 0 && p.count}
                </span>
              </Tooltip>
            );
          })}
          {unseenChat > 0 && (
            <Tooltip content={tx(t.monitor.grid_chat_unseen, { count: unseenChat })}>
              <span className="inline-flex items-center gap-1 rounded-pill bg-primary/12 px-1.5 py-0.5 typo-label tabular-nums text-primary">
                <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                {unseenChat}
              </span>
            </Tooltip>
          )}
        </span>
      )}
    </button>
  );
});

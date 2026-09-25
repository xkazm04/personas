// InstrumentPersonaCell — one persona as an instrument cell: no fill box, a
// luminous spine in its state hue, the full name (two lines before it
// truncates), and one mono data line that SAYS what the baseline's glyph row
// only hinted at — `Running · 4m · 92%`, then pending work as worded tags.

import { memo } from 'react';
import { MessageSquare, PowerOff } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Button } from '@/features/shared/components/buttons';
import { formatPercent } from '@/lib/utils/formatters';
import { primaryDrawerSection, type DrawerSection, type PersonaCardModel } from '../../../monitorModel';
import type { ChatBubble } from '../../channelBubbleModel';
import { usePersonaFacts, shortElapsed } from '../shared';
import { MonoTag, PENDING_TONE, Spine, STATE_TEXT } from './parts';

export const InstrumentPersonaCell = memo(function InstrumentPersonaCell({
  card, now, selected, flash, bubble, unseenChat, onSelect,
}: {
  card: PersonaCardModel;
  now: number;
  selected: boolean;
  flash: boolean;
  bubble: ChatBubble | null;
  unseenChat: number;
  onSelect: (personaId: string, section: DrawerSection) => void;
}) {
  const { t, tx } = useTranslation();
  const facts = usePersonaFacts()(card);
  const data = [
    facts.stateLabel,
    facts.state === 'running' && facts.runningSince ? shortElapsed(facts.runningSince, now) : null,
    facts.successRate !== null ? formatPercent(facts.successRate, { fromRatio: true, precision: 0 }) : null,
  ].filter(Boolean).join(' · ');
  const aria = [card.personaName, facts.stateLabel, ...facts.pending.map((p) => p.label)].join(', ');

  return (
    <Button
      variant="ghost"
      onClick={() => onSelect(card.personaId, primaryDrawerSection(card))}
      aria-label={aria}
      aria-pressed={selected}
      data-testid="fleet-grid-square"
      data-state={facts.state}
      data-persona-id={card.personaId}
      className={`group relative w-full py-1.5 pl-3 pr-2 text-left [&>span]:flex [&>span]:w-full [&>span]:min-w-0 [&>span]:flex-col [&>span]:gap-1 ${
        selected ? 'bg-primary/10 ring-1 ring-primary/50' : ''
      } ${flash ? 'ring-2 ring-primary' : ''} ${facts.off ? 'opacity-50' : ''}`}
    >
      <Spine state={facts.state} />
      <span className="line-clamp-2 typo-body text-foreground">{facts.name}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className={`typo-code ${STATE_TEXT[facts.state]}`}>{data}</span>
        {facts.off && (
          <MonoTag tone="border-border text-foreground">
            <PowerOff className="h-3.5 w-3.5" aria-hidden />
            {t.plugins.dev_projects.project_state_off}
          </MonoTag>
        )}
        {facts.pending.map((p) => (
          <Tooltip key={p.key} content={p.label}>
            <MonoTag tone={PENDING_TONE[p.tone]}>
              <p.icon className="h-3.5 w-3.5" aria-hidden />
              {p.count > 0 ? p.count : null}
            </MonoTag>
          </Tooltip>
        ))}
        {unseenChat > 0 && (
          <Tooltip content={tx(t.monitor.grid_chat_unseen, { count: unseenChat })}>
            <MonoTag tone="border-primary/30 text-primary">
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              {unseenChat}
            </MonoTag>
          </Tooltip>
        )}
      </span>
      {bubble && (
        <span className="line-clamp-1 border-l border-primary/30 pl-1.5 typo-caption text-primary">
          {bubble.text}
        </span>
      )}
    </Button>
  );
});

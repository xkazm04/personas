// A persona is a window in the panel. Dark glass while idle - the name still
// reads at body size - and lit from behind the moment it runs, needs the
// operator or failed. What is waiting is SAID in words on the second line
// ("2 awaiting review"), never decoded from a strip of glyphs, and only when
// something is waiting: an idle roster is one calm line per agent.

import { memo, useCallback } from 'react';
import { MessageSquare } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useOffProjectForPersona } from '@/features/plugins/dev-tools/sub_projects/projectSwitch/useProjectSwitch';
import { primaryDrawerSection, type DrawerSection, type PersonaCardModel } from '../../../monitorModel';
import type { ChatBubble } from '../../channelBubbleModel';
import { usePersonaFacts, type PendingFact } from '../shared';
import { PERSONA_LAMP, toneClass, type Tone } from './tone';
import { Lamp } from './parts';

const FACT_TONE: Record<PendingFact['tone'], Tone> = {
  error: 'err', warning: 'warn', info: 'info', processing: 'run',
};
const FACT_TEXT: Record<PendingFact['tone'], string> = {
  error: 'text-status-error', warning: 'text-status-warning', info: 'text-status-info', processing: 'text-primary',
};

export const PersonaWindow = memo(function PersonaWindow({
  card, selected, onSelect, flash, bubble, unseenChat,
}: {
  card: PersonaCardModel;
  selected: boolean;
  onSelect: (personaId: string, section: DrawerSection) => void;
  flash: boolean;
  bubble: ChatBubble | null;
  unseenChat: number;
}) {
  const { t, tx } = useTranslation();
  const facts = usePersonaFacts()(card);
  const offProject = useOffProjectForPersona(card.personaId);
  const off = facts.off || offProject !== null;
  const lamp = PERSONA_LAMP[facts.state];
  const open = useCallback(() => onSelect(card.personaId, primaryDrawerSection(card)), [onSelect, card]);

  const lines = [
    facts.stateLabel,
    ...(offProject ? [tx(t.plugins.dev_projects.project_off_hint, { project: offProject.name })]
      : facts.off ? [t.monitor.grid_persona_disabled] : []),
    ...facts.pending.map((p) => p.label),
    ...(unseenChat > 0 ? [tx(t.monitor.grid_chat_unseen, { count: unseenChat })] : []),
  ];
  const aria = `${facts.name}, ${lines.join(', ')}`;
  const lead = facts.pending[0] ?? null;

  return (
    <Tooltip content={<span className="whitespace-pre-line">{[facts.name, ...lines].join('\n')}</span>} placement="right">
      <button
        type="button"
        onClick={open}
        aria-label={aria}
        aria-pressed={selected}
        data-testid="fleet-grid-square"
        data-persona-id={card.personaId}
        data-state={facts.state}
        data-action={lead?.key ?? 'none'}
        className={`ae-win ae-focus flex w-full min-w-0 flex-col gap-0.5 rounded-input px-2.5 py-1.5 text-left ${toneClass(lamp.tone)} ${
          lamp.lit && !off ? 'is-lit' : ''} ${selected ? 'is-selected' : ''} ${off ? 'is-off' : ''} ${flash ? 'is-flash' : ''}`}
      >
        <span className="flex min-w-0 items-start gap-2">
          <Lamp lamp={off ? { tone: 'off', lit: false } : lamp} className="mt-[7px]" />
          <span className={`ae-clamp2 min-w-0 flex-1 typo-body text-foreground`}>
            {facts.name}
          </span>
          {unseenChat > 0 && (
            <span className="mt-0.5 inline-flex flex-shrink-0 items-center gap-1 rounded-pill bg-status-info/15 px-1.5 typo-caption tabular-nums text-status-info">
              <MessageSquare className="h-3 w-3" aria-hidden />
              {unseenChat}
            </span>
          )}
        </span>
        {facts.pending.length > 0 && (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 pl-[18px] typo-caption">
            {facts.pending.slice(0, 2).map((p) => (
              <span key={p.key} className={`inline-flex min-w-0 items-center gap-1 ${FACT_TEXT[p.tone]} ${toneClass(FACT_TONE[p.tone])}`}>
                <p.icon className="h-3 w-3 flex-shrink-0" aria-hidden />
                <span className="truncate">{p.label}</span>
              </span>
            ))}
            {facts.pending.length > 2 && <span className="text-foreground">+{facts.pending.length - 2}</span>}
          </span>
        )}
        {bubble && (
          <span className="flex min-w-0 items-center gap-1.5 pl-[18px] typo-caption text-status-info">
            <MessageSquare className="h-3 w-3 flex-shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{bubble.text}</span>
          </span>
        )}
      </button>
    </Tooltip>
  );
});

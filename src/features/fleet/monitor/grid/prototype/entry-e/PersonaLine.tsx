// An agent as ONE LINE of its bay: the lamp, the name, and at the right edge
// the one fact worth a glance - the run time while it works, otherwise the
// most urgent pending item (icon + count, "+n" for the rest). Everything else
// is in the tooltip. An idle roster is a calm column of names, one line each.

import { memo, useCallback } from 'react';
import { MessageCircle, MessageSquareText } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useOffProjectForPersona } from '@/features/plugins/dev-tools/sub_projects/projectSwitch/useProjectSwitch';
import { primaryDrawerSection, type DrawerSection, type PersonaCardModel } from '../../../monitorModel';
import type { ChatBubble } from '../../channelBubbleModel';
import { shortElapsed, usePersonaFacts, type PendingFact } from '../shared';
import { PERSONA_LAMP, toneClass } from './tone';
import { Lamp } from './parts';

export const PERSONA_LINE_H = 36;

const FACT_TEXT: Record<PendingFact['tone'], string> = {
  error: 'text-status-error', warning: 'text-status-warning', info: 'text-status-info', processing: 'text-primary',
};

export const PersonaLine = memo(function PersonaLine({
  card, selected, onSelect, flash, bubble, unseenChat, now,
}: {
  card: PersonaCardModel;
  selected: boolean;
  onSelect: (personaId: string, section: DrawerSection) => void;
  flash: boolean;
  bubble: ChatBubble | null;
  unseenChat: number;
  now: number;
}) {
  const { t, tx } = useTranslation();
  const facts = usePersonaFacts()(card);
  const offProject = useOffProjectForPersona(card.personaId);
  const off = facts.off || offProject !== null;
  const lamp = PERSONA_LAMP[facts.state];
  const lead = facts.pending[0] ?? null;
  const open = useCallback(() => onSelect(card.personaId, primaryDrawerSection(card)), [onSelect, card]);

  const lines = [
    `${facts.name} · ${facts.stateLabel}`,
    ...(offProject ? [tx(t.plugins.dev_projects.project_off_hint, { project: offProject.name })]
      : facts.off ? [t.monitor.grid_persona_disabled] : []),
    ...facts.pending.map((p) => p.label),
    ...(unseenChat > 0 ? [tx(t.monitor.grid_chat_unseen, { count: unseenChat })] : []),
    ...(bubble ? [tx(t.monitor.grid_chat_bubble_aria, { name: facts.name, text: bubble.text })] : []),
  ];
  const Lead = lead?.icon;

  return (
    <Tooltip content={<span className="whitespace-pre-line">{lines.join('\n')}</span>} placement="right" delay={450}>
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
        aria-label={lines.join(', ')}
        aria-pressed={selected}
        data-testid="fleet-grid-square"
        data-persona-id={card.personaId}
        data-state={facts.state}
        data-action={lead?.key ?? 'none'}
        className={`ae-line ae-focus flex w-full min-w-0 cursor-pointer items-center gap-2 px-2.5 ${toneClass(lamp.tone)} ${
          lamp.lit && !off ? 'is-lit' : ''} ${selected ? 'is-selected' : ''} ${off ? 'is-off' : ''} ${flash ? 'is-flash' : ''}`}
        style={{ height: PERSONA_LINE_H }}
      >
        <Lamp lamp={off ? { tone: 'off', lit: false } : lamp} />
        <span className="min-w-0 flex-1 truncate typo-body text-foreground">{facts.name}</span>
        {bubble && <MessageSquareText className="h-3.5 w-3.5 flex-shrink-0 text-status-info" aria-hidden />}
        {unseenChat > 0 && (
          <span className="inline-flex flex-shrink-0 items-center gap-0.5 typo-caption tabular-nums text-status-info">
            <MessageCircle className="h-3.5 w-3.5" aria-hidden />{unseenChat}
          </span>
        )}
        {facts.state === 'running' && facts.runningSince !== null ? (
          <span className="flex-shrink-0 typo-caption tabular-nums text-primary">{shortElapsed(facts.runningSince, now)}</span>
        ) : lead && Lead ? (
          <span className={`inline-flex flex-shrink-0 items-center gap-1 typo-caption tabular-nums ${FACT_TEXT[lead.tone]}`}>
            <Lead className="h-3.5 w-3.5" aria-hidden />
            {lead.count > 0 ? lead.count : null}
            {facts.pending.length > 1 && <span className="text-foreground">+{facts.pending.length - 1}</span>}
          </span>
        ) : null}
      </div>
    </Tooltip>
  );
});

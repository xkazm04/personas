// A persona is a module in its project's chassis: one lamp, its whole name,
// and one readout on the right. The lamp is the state; a lit module spills
// its light across the row, so the room reads as "where is the light" before
// a word is read. Idle modules stay dark glass, which is most of the fleet
// most of the day, and is why the lit ones find the eye.

import { memo, useCallback } from 'react';
import { MessageCircle, MessageSquareText } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Button } from '@/features/shared/components/buttons';
import { useOffProjectForPersona } from '@/features/plugins/dev-tools/sub_projects/projectSwitch/useProjectSwitch';
import { primaryDrawerSection, type DrawerSection, type PersonaCardModel } from '../../../monitorModel';
import type { ChatBubble } from '../../channelBubbleModel';
import { usePersonaFacts, shortElapsed, type PendingFact } from '../shared';
import { useRoom } from './rackModel';

export const MODULE_H = 38;

const TONE_TEXT: Record<PendingFact['tone'], string> = {
  error: 'text-status-error',
  warning: 'text-status-warning',
  info: 'text-status-info',
  processing: 'text-status-processing',
};

export const ModuleRow = memo(function ModuleRow({
  card, selected, onSelect, bubble, unseen, now,
}: {
  card: PersonaCardModel;
  selected: boolean;
  onSelect: (personaId: string, section: DrawerSection) => void;
  bubble: ChatBubble | null;
  unseen: number;
  now: number;
}) {
  const { t, tx } = useTranslation();
  const facts = usePersonaFacts()(card);
  const { focusKey } = useRoom();
  const offProject = useOffProjectForPersona(card.personaId);
  const off = facts.off || offProject !== null;
  const lead = facts.pending[0] ?? null;
  const activate = useCallback(() => onSelect(card.personaId, primaryDrawerSection(card)), [onSelect, card]);

  const lines = [
    `${facts.name} · ${facts.stateLabel}`,
    ...(offProject ? [tx(t.plugins.dev_projects.project_off_hint, { project: offProject.name })]
      : facts.off ? [t.monitor.grid_persona_disabled] : []),
    ...facts.pending.map((p) => p.label),
    ...(unseen > 0 ? [tx(t.monitor.grid_chat_unseen, { count: unseen })] : []),
    ...(bubble ? [tx(t.monitor.grid_chat_bubble_aria, { name: facts.name, text: bubble.text })] : []),
  ];

  const LeadIcon = lead?.icon;
  return (
    <Tooltip content={<span className="whitespace-pre-line">{lines.join('\n')}</span>} placement="right" delay={450}>
      <Button
        variant="ghost"
        onClick={activate}
        aria-label={lines.join(', ')}
        aria-pressed={selected}
        data-testid="fleet-grid-square"
        data-state={facts.state}
        data-persona-id={card.personaId}
        data-lamp={facts.state}
        data-selected={selected || undefined}
        data-off={off || undefined}
        className={`ed-row ed-spill w-full rounded-none px-3 py-0 text-left [&>span]:flex [&>span]:w-full [&>span]:min-w-0 [&>span]:items-center [&>span]:gap-2.5 ${
          focusKey === `p:${card.personaId}` ? 'ed-flash' : ''
        }`}
        style={{ height: MODULE_H }}
      >
        <span
          aria-hidden
          data-lamp={facts.state}
          className={`ed-lamp ${facts.state === 'running' ? 'animate-pulse' : ''}`}
        />
        <span className="min-w-0 flex-1 truncate typo-body text-foreground">{facts.name}</span>
        {bubble && (
          <MessageSquareText className="h-3.5 w-3.5 flex-shrink-0 text-role-agent" aria-hidden />
        )}
        {unseen > 0 && (
          <span className="inline-flex flex-shrink-0 items-center gap-0.5 typo-caption tabular-nums text-role-agent">
            <MessageCircle className="h-3.5 w-3.5" aria-hidden />
            {unseen}
          </span>
        )}
        {facts.state === 'running' && facts.runningSince !== null ? (
          <span className="flex-shrink-0 typo-caption tabular-nums text-primary">
            {shortElapsed(facts.runningSince, now)}
          </span>
        ) : lead && LeadIcon ? (
          <span className={`inline-flex flex-shrink-0 items-center gap-1 typo-caption tabular-nums ${TONE_TEXT[lead.tone]}`}>
            <LeadIcon className="h-3.5 w-3.5" aria-hidden />
            {lead.count > 0 ? lead.count : null}
            {facts.pending.length > 1 && <span className="text-foreground">+{facts.pending.length - 1}</span>}
          </span>
        ) : null}
      </Button>
    </Tooltip>
  );
});

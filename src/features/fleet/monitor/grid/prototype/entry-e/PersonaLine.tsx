// An agent as ONE LINE of its bay: the lamp, the name, and at the right edge
// the one fact worth a glance - the run time while it works, otherwise the
// most urgent pending item (icon + count, "+n" for the rest). Everything else
// is in the tooltip. An idle roster is a calm column of names, one line each.

import { memo, useCallback, type KeyboardEvent } from 'react';
import { Hourglass, MessageCircle, MessageSquareText } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useOffProjectForPersona } from '@/features/plugins/dev-tools/sub_projects/projectSwitch/useProjectSwitch';
import { primaryDrawerSection, type DrawerSection, type PersonaCardModel } from '../../../monitorModel';
import type { ChatBubble } from '../../channelBubbleModel';
import { shortElapsed, usePersonaFacts, type PendingFact } from '../shared';
import { PERSONA_LAMP, toneClass } from './tone';
import { Lamp } from './parts';
import { usePersonaMenu } from './PersonaMenu';

export const PERSONA_LINE_H = 36;

const FACT_TEXT: Record<PendingFact['tone'], string> = {
  error: 'text-status-error', warning: 'text-status-warning', info: 'text-status-info', processing: 'text-primary',
};

/**
 * The reply, READABLE, under the name - not an icon whose text dies with the
 * tooltip. Two states and no third: a quiet persistent Hourglass while the
 * persona is thinking (a quick-chat answer can be half an hour away, and a
 * spinner running that long on a board of fifty lines is noise, not progress),
 * and the sentence itself once it lands. Clamped to two lines: the model caps
 * the text at 160 characters and the full exchange is one click away.
 */
function BubbleLine({ bubble, label }: { bubble: ChatBubble; label: string }) {
  return (
    <span className={`flex w-full min-w-0 items-start gap-1.5 pb-1 pl-[18px] typo-caption ${
      bubble.pending ? '' : 'text-status-info'}`}
    >
      {bubble.pending
        ? <Hourglass className="mt-px h-3 w-3 flex-shrink-0" aria-hidden />
        : <MessageSquareText className="mt-px h-3 w-3 flex-shrink-0" aria-hidden />}
      <span className="min-w-0 flex-1 line-clamp-2">{bubble.pending ? label : bubble.text}</span>
    </span>
  );
}

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
  const menu = usePersonaMenu(card);
  // Menu first: it owns ContextMenu / Shift+F10 and marks the event handled.
  // Then bail unless the row itself is the target, exactly as `SessionLine` does.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    menu.onKeyDown(e);
    if (e.defaultPrevented || e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  };

  const lines = [
    `${facts.name} · ${facts.stateLabel}`,
    ...(offProject ? [tx(t.plugins.dev_projects.project_off_hint, { project: offProject.name })]
      : facts.off ? [t.monitor.grid_persona_disabled] : []),
    ...facts.pending.map((p) => p.label),
    ...(unseenChat > 0 ? [tx(t.monitor.grid_chat_unseen, { count: unseenChat })] : []),
    ...(bubble ? [bubble.pending
      ? tx(t.monitor.grid_chat_pending_aria, { name: facts.name, text: bubble.text })
      : tx(t.monitor.grid_chat_bubble_aria, { name: facts.name, text: bubble.text })] : []),
  ];
  const Lead = lead?.icon;

  return (
    <Tooltip content={<span className="whitespace-pre-line">{lines.join('\n')}</span>} placement="right" delay={450}>
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={onKey}
        onContextMenu={menu.onContextMenu}
        aria-label={lines.join(', ')}
        aria-pressed={selected}
        data-testid="fleet-grid-square"
        data-persona-id={card.personaId}
        data-state={facts.state}
        data-action={lead?.key ?? 'none'}
        className={`ae-line ae-focus flex w-full min-w-0 cursor-pointer flex-col justify-center px-2.5 ${toneClass(lamp.tone)} ${
          lamp.lit && !off ? 'is-lit' : ''} ${selected ? 'is-selected' : ''} ${off ? 'is-off' : ''} ${flash ? 'is-flash' : ''}`}
        style={{ minHeight: PERSONA_LINE_H }}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
        <Lamp lamp={off ? { tone: 'off', lit: false } : lamp} />
        <span className="min-w-0 flex-1 truncate typo-body text-foreground">{facts.name}</span>
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
        </span>
        {bubble && <BubbleLine bubble={bubble} label={t.monitor.quick_chat_awaiting} />}
      </div>
    </Tooltip>
  );
});

// An agent as ONE LINE of its bay, worn as a Board tile: the line's whole
// background is its pile (a solid tone fill when it needs you, lit theme
// colour while it works, glass at rest, hatched when off), so a bay of forty
// sorts itself before a name is read. Inside: the persona's framed face, its
// name, and at the right edge the one fact worth a glance - the run time
// while it works (its age also drawn along the foot), otherwise why it needs
// you (the Board's reason glyph and count, the reason in words where the line
// has the width, "+n" for the rest). Everything else is in the tooltip.

import { memo, useCallback, type KeyboardEvent } from 'react';
import { Hourglass, MessageCircle, MessageSquareText } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { useOffProjectForPersona } from '@/features/plugins/dev-tools/sub_projects/projectSwitch/useProjectSwitch';
import { primaryDrawerSection, type DrawerSection, type PersonaCardModel } from '../../../monitorModel';
import { PILE_VISUAL } from '../../../fleetboard/piles';
import { NeedGlyph } from '../../../fleetboard/TileParts';
import { runAgeFraction, useTileState } from '../../../fleetboard/Tile';
import type { ChatBubble } from '../../channelBubbleModel';
import { shortElapsed, usePersonaFacts } from '../shared';
import { personaLinePileKey, pileSkin } from './pileSkin';
import { usePersonaMenu } from './PersonaMenu';

export const PERSONA_LINE_H = 36;

/**
 * The reply, READABLE, under the name - not an icon whose text dies with the
 * tooltip. Two states and no third: a quiet persistent Hourglass while the
 * persona is thinking (a quick-chat answer can be half an hour away, and a
 * spinner running that long on a board of fifty lines is noise, not progress),
 * and the sentence itself once it lands. Clamped to two lines: the model caps
 * the text at 160 characters and the full exchange is one click away. On a
 * needs fill it is ink like the rest of the line.
 */
function BubbleLine({ bubble, label, onFill }: { bubble: ChatBubble; label: string; onFill: boolean }) {
  return (
    <span className={`flex w-full min-w-0 items-start gap-1.5 pb-1 pl-8 typo-caption ${
      bubble.pending || onFill ? 'text-current' : 'text-status-info'}`}
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
  const state = useTileState(card);
  const offProject = useOffProjectForPersona(card.personaId);
  const key = personaLinePileKey(card, offProject !== null);
  const skin = pileSkin(key, card.personaId);
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
    `${facts.name} · ${state}`,
    ...(offProject ? [tx(t.plugins.dev_projects.project_off_hint, { project: offProject.name })]
      : facts.off ? [t.monitor.grid_persona_disabled] : []),
    ...facts.pending.map((p) => p.label),
    ...(unseenChat > 0 ? [tx(t.monitor.grid_chat_unseen, { count: unseenChat })] : []),
    ...(bubble ? [bubble.pending
      ? tx(t.monitor.grid_chat_pending_aria, { name: facts.name, text: bubble.text })
      : tx(t.monitor.grid_chat_bubble_aria, { name: facts.name, text: bubble.text })] : []),
  ];
  const runningSince = skin.pile === 'working' ? card.runningSince : null;
  const Off = PILE_VISUAL.off.glyph;

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
        data-pile={skin.pile}
        data-action={lead?.key ?? 'none'}
        className={`${skin.className} flex min-w-0 flex-col justify-center px-1.5 ${selected ? 'is-selected' : ''} ${flash ? 'is-flash' : ''}`}
        style={{ ...skin.style, minHeight: PERSONA_LINE_H }}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <PersonaIcon icon={card.personaIcon} color={card.personaColor} name={card.personaName} display="framed" frameSize="sm" frameClass="fb-face" />
          <span className="min-w-0 flex-1 truncate typo-heading">{facts.name}</span>
          {unseenChat > 0 && (
            <span className="inline-flex flex-shrink-0 items-center gap-0.5 typo-label tabular-nums">
              <MessageCircle className="h-3.5 w-3.5" aria-hidden />{unseenChat}
            </span>
          )}
          {runningSince !== null ? (
            <span className="flex-shrink-0 typo-label tabular-nums">{shortElapsed(runningSince, now)}</span>
          ) : skin.pile === 'needs' ? (
            <span className="inline-flex min-w-0 flex-shrink-0 items-center gap-1.5 typo-label">
              <span className="ae-word truncate">{state}</span>
              <NeedGlyph card={card} size="md" />
              {facts.pending.length > 1 && <span className="tabular-nums">+{facts.pending.length - 1}</span>}
            </span>
          ) : skin.pile === 'off' ? (
            <Off className="h-4 w-4 flex-shrink-0" aria-hidden />
          ) : null}
        </span>
        {bubble && <BubbleLine bubble={bubble} label={t.monitor.quick_chat_awaiting} onFill={skin.pile === 'needs'} />}
        {runningSince !== null && (
          <i className="fb-age" aria-hidden style={{ width: `${runAgeFraction(runningSince, Math.floor(now / 60_000)) * 100}%` }} />
        )}
      </div>
    </Tooltip>
  );
});

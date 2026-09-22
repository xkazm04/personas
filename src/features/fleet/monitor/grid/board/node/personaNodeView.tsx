// personaNodeView — what a PERSONA node paints: its title, hue, frame, the
// symbol ids `nodeSymbols` orders for it, and one renderer per symbol. Plain
// function, no hooks: `FleetNode` resolves the translations and the motion
// posture and hands them in.

import { Layers, PowerOff } from 'lucide-react';
import type { useTranslation } from '@/i18n/useTranslation';
import { actionBadges, cleanName, squareState } from '../../fleetGridModel';
import { ChatMark, GLYPH, NUMERAL, StateGlyph, Swatch, Sym } from './NodeSymbolParts';
import { frameClass, PERSONA_STATE_MARK, personaHue, personaSymbols, symbolClass } from './nodeSymbols';
import type { NodeView, PersonaNodeProps } from './nodeTypes';

export type NodeI18n = Pick<ReturnType<typeof useTranslation>, 't' | 'tx'>;

export function personaNodeView(
  props: PersonaNodeProps,
  { t, tx }: NodeI18n,
  reducedMotion: boolean,
): NodeView {
  const s = t.monitor;
  const { card, teamName, unseenChat = 0, off = false } = props;
  const st = squareState(card);
  const hue = personaHue(st);
  const stateLabel = {
    running: s.grid_state_running,
    attention: s.grid_state_attention,
    failed: s.grid_state_failed,
    idle: s.grid_state_idle,
  }[st];
  const dominant = actionBadges(card)[0] ?? null;
  const renderers: NodeView['renderers'] = {};

  renderers.state = () => (
    <Sym id="state" label={stateLabel} testId="fleet-node-state" data={{ 'data-state': st }} className={symbolClass(hue)}>
      <StateGlyph mark={PERSONA_STATE_MARK[st]} reducedMotion={reducedMotion} />
    </Sym>
  );
  renderers.off = () => (
    <Sym id="off" label={s.grid_persona_disabled} testId="fleet-grid-disabled" className={symbolClass(hue)}>
      <PowerOff aria-hidden className={GLYPH} />
    </Sym>
  );
  renderers.team = () => (
    <Sym id="team" label={tx(s.node_symbol_team, { name: teamName ?? '' })} testId="fleet-node-team" className="">
      <Swatch name={teamName ?? ''} />
    </Sym>
  );
  renderers.operation = () => {
    const Icon = dominant!.icon;
    const line = {
      failed: s.grid_badge_failed,
      review: tx(s.grid_badge_review, { count: dominant!.count }),
      input: tx(s.grid_badge_input, { count: dominant!.count }),
      draft: tx(s.grid_badge_draft, { count: dominant!.count }),
      message: tx(s.grid_badge_message, { count: dominant!.count }),
    }[dominant!.key];
    return (
      <Sym id="operation" label={line} testId="fleet-grid-badge" data={{ 'data-action': dominant!.key }} className={symbolClass(hue)}>
        <Icon aria-hidden className={GLYPH} />
      </Sym>
    );
  };
  renderers.unseen = () => (
    <Sym id="unseen" label={tx(s.grid_chat_unseen, { count: unseenChat })} testId="fleet-grid-chat-unseen" data={{ 'data-count': String(unseenChat) }} className={`${symbolClass(hue)} w-auto gap-px px-0.5`}>
      <ChatMark count={unseenChat} />
    </Sym>
  );
  renderers.queued = () => (
    <Sym id="queued" label={tx(s.node_queued_count, { count: card.queued })} testId="fleet-node-queued" data={{ 'data-count': String(card.queued) }} className={`${symbolClass(hue)} w-auto gap-px px-0.5`}>
      <Layers aria-hidden className={GLYPH} />
      <span aria-hidden className={NUMERAL}>{card.queued > 9 ? '9+' : card.queued}</span>
    </Sym>
  );

  return {
    title: cleanName(card.personaName),
    hue,
    frame: frameClass(hue),
    titleTone: off ? 'opacity-45' : st === 'idle' ? 'opacity-60' : '',
    ids: personaSymbols({ off, teamName, unseenChat, queued: card.queued, operation: dominant !== null }),
    bubble: props.bubble ?? null,
    bubbleBorder: card.personaColor ?? undefined,
    elapsedFill: 0,
    elapsedLabel: '',
    renderers,
  };
}

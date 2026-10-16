// An agent as ONE LINE of its bay (WP11, V1 "Tail"): the bay nameplate's
// grammar applied to a persona. A flat hairline row (`.ae-line`): the framed
// face, the bold name, then what it is doing as glyph + time tokens (its last
// run's outcome and age, or its run's queue; then its next start), and at the
// right edge the one figure worth a glance (why it needs you, or the run's
// elapsed time) and the lamp, exactly where a bay's nameplate puts its count
// and lamp. State is the lamp plus a tone edge, never a fill: needs-you lights
// the edge and a soft wash, critical a stronger one, a run keeps only the edge.
// The tokens give way by priority in a narrow column (`PersonaTail.tsx`); the
// tooltip always carries the whole sentence (`personaTailModel.ts` `tailSentence`).
//
// A PEER's agent (device mesh) is the same line with `peer` set: no drawer to
// open and no local menu, the device glyph beside the name, the axis its device
// reported, its state as the lead word (the snapshot carries no last run and no
// schedule, so both are absent), and its on/off switch run on that device, with
// the answer on a row of its own under the name.

import { memo, useCallback, type KeyboardEvent } from 'react';
import type { DeviceAgent } from '@/lib/bindings/DeviceAgent';
import { agentOutcomeKey } from '@/stores/slices/network/meshSlice';
import { useAgentStore } from '@/stores/agentStore';
import { Hourglass, MessageCircle, MessageSquareText } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { useOffProjectForPersona } from '@/features/plugins/dev-tools/sub_projects/projectSwitch/useProjectSwitch';
import { primaryDrawerSection, type DrawerSection, type PersonaCardModel } from '../../../monitorModel';
import { useTileState } from '../../skin/tileState';
import type { ChatBubble } from '../../channelBubbleModel';
import { usePersonaFacts } from '../shared';
import { personaLinePileKey, pileOfKey } from './pileSkin';
import { usePersonaMenu } from './PersonaMenu';
import { Lamp } from './parts';
import { toneClass } from './tone';
import { personaTail, tailSentence } from './personaTailModel';
import { TailFigure, TailHead } from './PersonaTail';
import { useNextStartMs } from './useMonitorSchedules';
import { DeviceGlyph, PersonaResource } from './devices/DeviceGlyph';
import { ResourceGlyph } from './devices/ResourceGlyph';
import { PeerAgentToggle } from './devices/PeerAgentToggle';
import { MeshOutcomeLine } from './devices/MeshOutcomeLine';

export const PERSONA_LINE_H = 36;

/** Set when the line draws an agent of ANOTHER device in the mesh. */
export interface PeerLineInfo {
  peerId: string;
  device: string;
  agent: DeviceAgent;
  /** The device's snapshot cannot be believed now: the switch is off. */
  stale: boolean;
}

/**
 * The reply, READABLE, under the name: a quiet persistent Hourglass while the
 * persona is thinking (a quick-chat answer can be half an hour away; a spinner
 * that long on a board of fifty lines is noise), and the sentence itself once
 * it lands, clamped to two lines (the model caps it at 160 characters).
 */
function BubbleLine({ bubble, label }: { bubble: ChatBubble; label: string }) {
  return (
    <span className={`flex w-full min-w-0 items-start gap-1.5 pb-1 pl-8 typo-caption ${bubble.pending ? 'text-foreground' : 'text-status-info'}`}>
      {bubble.pending
        ? <Hourglass className="mt-px h-3 w-3 flex-shrink-0" aria-hidden />
        : <MessageSquareText className="mt-px h-3 w-3 flex-shrink-0" aria-hidden />}
      <span className="min-w-0 flex-1 line-clamp-2">{bubble.pending ? label : bubble.text}</span>
    </span>
  );
}

export const PersonaLine = memo(function PersonaLine({
  card, selected, onSelect, flash, bubble, unseenChat, now, peer = null,
}: {
  card: PersonaCardModel;
  selected: boolean;
  onSelect: (personaId: string, section: DrawerSection) => void;
  flash: boolean;
  bubble: ChatBubble | null;
  unseenChat: number;
  now: number;
  peer?: PeerLineInfo | null;
}) {
  const { t, tx, language } = useTranslation();
  const facts = usePersonaFacts()(card);
  const state = useTileState(card);
  const offProject = useOffProjectForPersona(peer ? null : card.personaId);
  const lastRunAt = useAgentStore((s) => (peer ? null : s.personaLastRun[card.personaId] ?? null));
  const nextMs = useNextStartMs(peer ? null : card.personaId, now);
  const kind = personaLinePileKey(card, offProject !== null || peer?.agent.projectEnabled === false);
  const tail = personaTail({
    kind, peer: peer !== null, runningSince: card.runningSince, queued: card.queued,
    lastStatus: card.recentStatuses[0] ?? null, lastRunAt, nextMs, now,
  });
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
    `${facts.name} · ${tailSentence(state, tail, t.monitor, tx, language, now)}`,
    ...(peer ? [tx(t.monitor.remote_on_device, { device: peer.device })] : []),
    ...(offProject ? [tx(t.plugins.dev_projects.project_off_hint, { project: offProject.name })]
      : facts.off ? [t.monitor.grid_persona_disabled] : []),
    ...facts.pending.map((p) => p.label),
    ...(unseenChat > 0 ? [tx(t.monitor.grid_chat_unseen, { count: unseenChat })] : []),
    ...(bubble ? [bubble.pending
      ? tx(t.monitor.grid_chat_pending_aria, { name: facts.name, text: bubble.text })
      : tx(t.monitor.grid_chat_bubble_aria, { name: facts.name, text: bubble.text })] : []),
  ];
  const edge = kind === 'critical' ? 'is-lit is-critical' : kind === 'warning' ? 'is-lit'
    : kind === 'working' ? 'is-working' : kind === 'off' ? 'is-off' : '';

  return (
    <Tooltip content={<span className="whitespace-pre-line">{lines.join('\n')}</span>} placement="right" delay={450}>
      <div
        role={peer ? 'group' : 'button'}
        tabIndex={peer ? undefined : 0}
        onClick={peer ? undefined : open}
        onKeyDown={peer ? undefined : onKey}
        onContextMenu={peer ? undefined : menu.onContextMenu}
        aria-label={lines.join(', ')}
        aria-pressed={peer ? undefined : selected}
        data-testid="fleet-grid-square"
        data-persona-id={card.personaId}
        data-peer-id={peer?.peerId}
        data-state={facts.state}
        data-pile={pileOfKey(kind)}
        data-kind={kind}
        data-action={lead?.key ?? 'none'}
        className={`ae-line ${toneClass(tail.tone)} ${edge} flex min-w-0 flex-col ${peer ? '' : 'cursor-pointer'} ${selected ? 'is-selected' : ''} ${flash ? 'is-flash' : ''}`}
        style={{ minHeight: PERSONA_LINE_H }}
      >
        <span className="ae-prow flex w-full min-w-0 items-center gap-1.5 pl-2 pr-2.5" style={{ height: PERSONA_LINE_H }}>
          <PersonaIcon icon={card.personaIcon} color={card.personaColor} name={card.personaName} display="framed" frameSize="sm" frameClass="fb-face" />
          <TailHead name={facts.name} tail={tail} now={now} />
          {/* The right edge, one cluster: what the bay nameplate puts there (figure, then lamp). */}
          <span className="ml-auto flex flex-shrink-0 items-center gap-2 pl-1">
            {peer && <DeviceGlyph peerId={peer.peerId} name={peer.device} />}
            {peer ? <ResourceGlyph axis={peer.agent.dominant} /> : <PersonaResource personaId={card.personaId} />}
            {unseenChat > 0 && (
              <span className="inline-flex flex-shrink-0 items-center gap-0.5 typo-label tabular-nums text-status-info">
                <MessageCircle className="h-3.5 w-3.5" aria-hidden />{unseenChat}
              </span>
            )}
            <TailFigure tail={tail} card={card} more={Math.max(0, facts.pending.length - 1)} />
            {peer && <PeerAgentToggle peerId={peer.peerId} device={peer.device} agent={peer.agent} stale={peer.stale} />}
            <Lamp lamp={tail.lamp} />
          </span>
        </span>
        {peer && <MeshOutcomeLine outcomeKey={agentOutcomeKey(peer.peerId, card.personaId)} device={peer.device} className="pb-1 pl-8" />}
        {bubble && <BubbleLine bubble={bubble} label={t.monitor.quick_chat_awaiting} />}
      </div>
    </Tooltip>
  );
});

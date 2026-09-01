// Live-mode shared model — the data contract every live-overlay variant renders
// and the small visual helpers they share, so the three directions differ in
// LAYOUT + MOTION, not in what a "needs your review" row says.
//
// A LiveMessage is a flattened, render-ready projection of a TeamChannelItem
// (see channels/MergedRow.resolveCompact for the canonical resolution). The
// prototype is fed by demo.ts; the production wiring will project the live
// useTeamChannel feed into the same shape.

import { Sparkles, Compass, User, AlertCircle, Hash, type LucideIcon } from 'lucide-react';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { resolveCompact } from '../channels/MergedRow';
import type { TaggedItem } from '../channels/types';
import type { Persona } from '@/lib/bindings/Persona';
import { avatarBgFor, AUTHOR_KIND_META, slackAuthorName } from '@/features/teams/sub_collab/collabRender';
import { cleanName } from '../grid/fleetGridModel';

/** A single channel message, projected for the corner live overlay. */
export interface LiveMessage {
  /** Channel item id — stable identity for queue/dismiss bookkeeping. */
  id: string;
  teamId: string;
  teamName: string;
  /** Team accent (hex/rgb) — the per-team colour rail. */
  teamColor: string;
  personaId: string | null;
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;
  /** Author kind, mirrors TeamChannelItem.kind. */
  kind: 'persona' | 'athena' | 'director' | 'directive' | 'step' | 'event' | 'memory' | 'slack';
  /** Compact event label (e.g. "needs your review", "handoff"). */
  event: string;
  /** Tailwind text-tone class for the event label. */
  tone: string;
  /** One-line human message. */
  message: string | null;
  /** RFC3339 timestamp. */
  at: string;
  /** Needs-attention styling (review gate / failure). */
  alert: boolean;
  /** Date.now() when the overlay first saw it — drives auto-dismiss timing. */
  receivedAt: number;
}

/** Resolve the accent colour for a message's author (team-agnostic). */
export function authorAccent(m: LiveMessage): string {
  if (m.kind === 'athena') return 'rgb(167 139 250)';
  if (m.kind === 'director') return 'rgb(56 189 248)';
  if (m.kind === 'directive') return 'rgb(52 211 153)';
  if (m.kind === 'slack') return AUTHOR_KIND_META.slack.accent;
  return m.personaColor ?? 'rgb(148 163 184)';
}

/** Soft background tint class for an author's avatar chip. Delegates to the
 *  shared `avatarBgFor` (collabRender) so the Timeline row (MergedRow) and this
 *  corner overlay never drift apart. */
export function avatarTint(m: LiveMessage): string {
  return avatarBgFor(m.kind);
}

const NON_PERSONA_ICON: Partial<Record<LiveMessage['kind'], { Icon: LucideIcon; color: string }>> = {
  athena: { Icon: Sparkles, color: 'text-violet-300' },
  director: { Icon: Compass, color: 'text-sky-300' },
  directive: { Icon: User, color: 'text-emerald-400' },
  // Being in this map is also what stops `hasPersona` from firing for a Slack
  // row — whose `personaId` is a Slack user id, not a persona.
  slack: { Icon: Hash, color: 'text-teal-300' },
};

const SIZE_CLASS = { xs: 'w-5 h-5', sm: 'w-7 h-7', md: 'w-8 h-8' } as const;
const GLYPH_CLASS = { xs: 'w-3 h-3', sm: 'w-4 h-4', md: 'w-4 h-4' } as const;

/** Avatar for any live message — persona sprite, or the author's kind icon. */
export function LiveAvatar({ m, size = 'sm' }: { m: LiveMessage; size?: keyof typeof SIZE_CLASS }) {
  const hasPersona = m.personaId !== null && !NON_PERSONA_ICON[m.kind];
  const author = NON_PERSONA_ICON[m.kind];
  return (
    <span className={`inline-flex items-center justify-center rounded-full flex-shrink-0 ${SIZE_CLASS[size]} ${avatarTint(m)}`}>
      {hasPersona ? (
        <PersonaIcon icon={m.personaIcon} color={m.personaColor} size={GLYPH_CLASS[size]} />
      ) : author ? (
        <author.Icon className={`${GLYPH_CLASS[size]} ${author.color}`} />
      ) : m.alert ? (
        <AlertCircle className={`${GLYPH_CLASS[size]} text-status-warning`} />
      ) : (
        <PersonaIcon icon={m.personaIcon} color={m.personaColor} size={GLYPH_CLASS[size]} />
      )}
    </span>
  );
}

/** Author display name for a live message. */
export function authorName(m: LiveMessage): string {
  if (m.kind === 'directive') return 'You';
  if (m.kind === 'athena') return 'Athena';
  if (m.kind === 'director') return 'Director';
  // Slack authors ride in on `personaName` (set by projectChannelItem from the
  // bridged display name) — never "You", never a persona.
  return m.personaName;
}

/** The broad TYPE a pop-up communicates — what the standalone icon row shows.
 *  `decision` = the message asks the operator to decide (review gates,
 *  failures — anything the projector marked `alert`); `directive` = the
 *  operator's own posts echoed back; `channel` = ordinary channel talk. */
export type LiveMessageType = 'directive' | 'decision' | 'channel';

export function liveMessageType(m: LiveMessage): LiveMessageType {
  if (m.alert) return 'decision';
  if (m.kind === 'directive') return 'directive';
  return 'channel';
}

/** The contract every live-overlay variant renders against. The host owns the
 *  queue (accumulation + acknowledge bookkeeping); a variant owns its own
 *  layout, grouping, and presentation. There is NO auto-timeout: a pop-up
 *  stays until the operator acknowledges it (marking it read persistently)
 *  or opens the messaging UI. */
export interface LiveVariantProps {
  /** Non-dismissed messages, newest-first. */
  messages: LiveMessage[];
  /** Acknowledge one message: dismiss it AND persist it as read, so it is
   *  never displayed again — across re-enables and app restarts. */
  onDismiss: (id: string) => void;
  /** Acknowledge everything currently shown. */
  onDismissAll: () => void;
  /** Redirect into the Channels → Timeline view (optionally team-scoped). */
  onOpenConversation: (teamId?: string) => void;
  reducedMotion: boolean;
}

/** Project a live team-channel item into a render-ready LiveMessage. Resolution
 *  (event label / tone / message / alert) is delegated to the channel's shared
 *  `resolveCompact`, so a corner pop-up always says exactly what the Timeline
 *  row says. `now` stamps the arrival for the auto-timeout. */
export function projectChannelItem(tagged: TaggedItem, persona: Persona | undefined, now: number): LiveMessage {
  const { item, team } = tagged;
  const { event, tone, message, alert } = resolveCompact(item);
  return {
    id: item.id,
    teamId: team.teamId,
    teamName: team.teamName,
    teamColor: team.teamColor,
    personaId: item.personaId,
    personaName: item.kind === 'slack' ? slackAuthorName(item) : persona ? cleanName(persona.name) : '',
    personaIcon: persona?.icon ?? null,
    personaColor: persona?.color ?? null,
    kind: item.kind as LiveMessage['kind'],
    event,
    tone,
    message,
    at: item.at,
    alert,
    receivedAt: now,
  };
}

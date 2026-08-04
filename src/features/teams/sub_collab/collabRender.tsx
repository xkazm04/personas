import type { LucideIcon } from 'lucide-react';
import { MessageSquare, Sparkles, Compass, Hash } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import { memberColor, FAMILY_TEXT } from '@/lib/channel/eventModel';

/** Re-exported for the surfaces that import event-family colour from here
 *  (the shared source of truth lives in `eventModel.ts`, alongside `eventFamily`). */
export { FAMILY_TEXT };

/**
 * Minimal member shape the channel surfaces need (presence avatars +
 * member-id filtering). `StudioMember` is structurally assignable to this, so
 * the Studio passes its full members and the monitor's channel grid can pass
 * lightweight per-team rows derived from personas.
 */
export interface ChannelMember {
  memberId: string;
  personaId: string;
  name: string;
  icon: string | null;
  color: string | null;
}

/* ----------------------------------------------------------------------------
 * Shared render metadata for the Collab channel surfaces (baseline + the C5
 * flagship variants). Keeps the per-kind vocabulary in one place so the
 * variants differ in LAYOUT, not in what a "qa requested changes" row says.
 * -------------------------------------------------------------------------- */

/** Human verb per step-layer kind. */
export const STEP_VERB: Record<string, string> = {
  created: 'created the mission',
  step_running: 'started',
  step_done: 'finished',
  step_failed: 'failed',
  step_skipped: 'skipped',
  status_awaiting_review: 'needs your review',
  status_done: 'mission complete',
  qa_changes_requested_rework: 'QA requested changes — rework round',
  paused: 'paused',
};

/** Status-token tone per step-layer kind. */
export const STEP_TONE: Record<string, string> = {
  step_running: 'text-status-info',
  step_done: 'text-status-success',
  step_failed: 'text-status-error',
  step_skipped: 'text-foreground/45',
  status_awaiting_review: 'text-status-warning',
  status_done: 'text-status-success',
  qa_changes_requested_rework: 'text-status-warning',
  paused: 'text-status-warning',
  created: 'text-foreground/60',
};

export interface AuthorMeta {
  label: string;
  Icon: LucideIcon;
  /** Accent colour (hex or token) for gutters / rings / chips. */
  accent: string;
  iconColor: string;
  bubble: string;
  tag: string;
}

/** The author kinds that have their own voice (everything that is not a plain
 *  persona post, a user directive, or a machine row). Exported so callers stop
 *  hand-writing the `as 'athena' | 'director'` cast at every render site. */
export type AuthorKind = 'persona' | 'athena' | 'director' | 'slack';

/** Is this item authored by a voice with dedicated meta in {@link AUTHOR_KIND_META}? */
export function isAuthorKind(kind: string): kind is AuthorKind {
  return kind === 'persona' || kind === 'athena' || kind === 'director' || kind === 'slack';
}

/** Per-author-kind voice for multi-author channel messages
 *  (user/persona/athena/director/slack). */
export const AUTHOR_KIND_META: Record<AuthorKind, AuthorMeta> = {
  persona: {
    label: 'channel',
    Icon: MessageSquare,
    accent: 'rgb(148 163 184)',
    iconColor: 'text-foreground/60',
    bubble: 'border-primary/15 bg-secondary/20',
    tag: 'text-foreground/45',
  },
  athena: {
    label: 'Athena',
    Icon: Sparkles,
    accent: 'rgb(167 139 250)',
    iconColor: 'text-violet-300',
    bubble: 'border-violet-500/25 bg-violet-500/5',
    tag: 'text-violet-300',
  },
  director: {
    label: 'Director',
    Icon: Compass,
    accent: 'rgb(56 189 248)',
    iconColor: 'text-sky-300',
    bubble: 'border-sky-500/25 bg-sky-500/5',
    tag: 'text-sky-300',
  },
  // An EXTERNAL human, arriving over the team's Slack bridge. Deliberately its
  // own voice: a bridged message is neither the operator ("You") nor one of the
  // team's personas, and reading as either would be a lie about who is talking.
  slack: {
    label: 'Slack',
    Icon: Hash,
    accent: 'rgb(45 212 191)',
    iconColor: 'text-teal-300',
    bubble: 'border-teal-500/25 bg-teal-500/5',
    tag: 'text-teal-300',
  },
};

/** Soft background tint class for an author's avatar chip, keyed by channel-item
 *  kind. Shared by the Timeline row (MergedRow) and the corner live overlay
 *  (liveModel) so the same author looks identical in both surfaces. */
export function avatarBgFor(kind: string): string {
  switch (kind) {
    case 'athena': return 'bg-violet-500/15';
    case 'director': return 'bg-sky-500/15';
    case 'directive': return 'bg-emerald-500/15';
    case 'slack': return 'bg-teal-500/15';
    default: return 'bg-secondary/60';
  }
}

/**
 * The display name of an external Slack author.
 *
 * The read-model has no dedicated column for an external participant, so the
 * bridge carries the resolved Slack display name in `label` — which for channel
 * messages otherwise just repeats `author_kind` and is therefore redundant with
 * `kind`. If the bridge could not resolve a name we fall back to the raw Slack
 * user id (parked in `personaId`, the read-model's `author_id` column) rather
 * than inventing one.
 */
export function slackAuthorName(item: TeamChannelItem): string {
  const label = item.label?.trim();
  if (label && label !== 'slack') return label;
  return item.personaId ?? AUTHOR_KIND_META.slack.label;
}

/** Resolve a display name for any channel item. */
export function authorName(item: TeamChannelItem, persona: Persona | undefined): string {
  // Slack first: a bridged author id can never index a persona, but guarding
  // here keeps an id collision from ever renaming an external human.
  if (item.kind === 'slack') return slackAuthorName(item);
  if (persona) return persona.name.replace(/^T: /, '');
  if (item.kind === 'directive') return 'You';
  if (item.kind === 'athena') return 'Athena';
  if (item.kind === 'director') return 'Director';
  return 'System';
}

/** Resolve the accent colour for any channel item (member colour for people). */
export function itemAccent(item: TeamChannelItem, persona: Persona | undefined): string {
  if (item.kind === 'slack') return AUTHOR_KIND_META.slack.accent;
  if (item.kind === 'athena') return AUTHOR_KIND_META.athena.accent;
  if (item.kind === 'director') return AUTHOR_KIND_META.director.accent;
  if (item.kind === 'directive') return 'rgb(52 211 153)'; // user / emerald
  return memberColor(persona, item.personaId);
}

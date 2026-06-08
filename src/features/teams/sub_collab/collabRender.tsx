import type { LucideIcon } from 'lucide-react';
import { MessageSquare, Sparkles, Compass } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import { memberColor } from '../sub_redRoom/useRedRoomFeed';

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

/** Event-family text tone (bus events). */
export const FAMILY_TEXT: Record<string, string> = {
  handoff: 'text-violet-300',
  pr: 'text-status-info',
  qa: 'text-status-warning',
  release: 'text-status-success',
  failure: 'text-status-error',
  build: 'text-sky-300',
  other: 'text-foreground/60',
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

/** Per-author-kind voice for multi-author channel messages (user/persona/athena/director). */
export const AUTHOR_KIND_META: Record<'persona' | 'athena' | 'director', AuthorMeta> = {
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
};

/** Resolve a display name for any channel item. */
export function authorName(item: TeamChannelItem, persona: Persona | undefined): string {
  if (persona) return persona.name.replace(/^T: /, '');
  if (item.kind === 'directive') return 'You';
  if (item.kind === 'athena') return 'Athena';
  if (item.kind === 'director') return 'Director';
  return 'System';
}

/** Resolve the accent colour for any channel item (member colour for people). */
export function itemAccent(item: TeamChannelItem, persona: Persona | undefined): string {
  if (item.kind === 'athena') return AUTHOR_KIND_META.athena.accent;
  if (item.kind === 'director') return AUTHOR_KIND_META.director.accent;
  if (item.kind === 'directive') return 'rgb(52 211 153)'; // user / emerald
  return memberColor(persona, item.personaId);
}

/** Day bucket key for chapter dividers. */
export function dayKey(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toDateString();
}

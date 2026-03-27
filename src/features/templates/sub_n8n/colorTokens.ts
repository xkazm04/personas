/**
 * Shared color token maps for the n8n import wizard.
 *
 * All entity-type-to-color mappings live here so that a design-system
 * palette change only requires touching one file.
 */

import type { ProtocolType } from './edit/protocolParser';
import type { SessionStatus } from '@/lib/bindings/SessionStatus';
import type { WorkflowPlatform } from '@/lib/personas/parsers/workflowDetector';

/* ------------------------------------------------------------------ */
/*  Base color triplets                                                */
/* ------------------------------------------------------------------ */

/** Semantic color names used across entity cards, tags, and badges. */
export type ColorKey =
  | 'blue'
  | 'amber'
  | 'emerald'
  | 'rose'
  | 'cyan'
  | 'orange'
  | 'violet'
  | 'zinc'
  | 'red'
  | 'purple';

/** Faint card-level colors (bg-X-500/5). Used for entity summary cards. */
export const ENTITY_CARD_COLORS: Record<ColorKey, string> = {
  blue:    'bg-blue-500/5 border-blue-500/10 text-blue-400/70',
  amber:   'bg-amber-500/5 border-amber-500/10 text-amber-400/70',
  emerald: 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400/70',
  rose:    'bg-rose-500/5 border-rose-500/10 text-rose-400/70',
  cyan:    'bg-cyan-500/5 border-cyan-500/10 text-cyan-400/70',
  orange:  'bg-orange-500/5 border-orange-500/10 text-orange-400/70',
  violet:  'bg-violet-500/5 border-violet-500/10 text-violet-400/70',
  zinc:    'bg-zinc-500/5 border-zinc-500/10 text-zinc-400/70',
  red:     'bg-red-500/5 border-red-500/10 text-red-400/70',
  purple:  'bg-purple-500/5 border-purple-500/10 text-purple-400/70',
};

/** Standard badge/tag-level colors (bg-X-500/10). Used for inline tags and badges. */
export const TAG_COLORS: Record<ColorKey, string> = {
  blue:    'bg-blue-500/10 text-blue-400/70 border-blue-500/15',
  amber:   'bg-amber-500/10 text-amber-400/70 border-amber-500/15',
  emerald: 'bg-emerald-500/10 text-emerald-400/70 border-emerald-500/15',
  rose:    'bg-rose-500/10 text-rose-400/70 border-rose-500/15',
  cyan:    'bg-cyan-500/10 text-cyan-400/70 border-cyan-500/15',
  orange:  'bg-orange-500/10 text-orange-400/70 border-orange-500/15',
  violet:  'bg-violet-500/10 text-violet-400/70 border-violet-500/15',
  zinc:    'bg-zinc-500/10 text-zinc-400/70 border-zinc-500/15',
  red:     'bg-red-500/10 text-red-400/70 border-red-500/15',
  purple:  'bg-purple-500/10 text-purple-400/70 border-purple-500/15',
};

/* ------------------------------------------------------------------ */
/*  Domain-specific maps                                               */
/* ------------------------------------------------------------------ */

/** Protocol capability badge styles (split bg/text for flexible composition). */
export const CAPABILITY_SPLIT_STYLES: Record<ProtocolType, { bg: string; text: string }> = {
  manual_review: { bg: 'bg-rose-500/10 border-rose-500/15',    text: 'text-rose-400/70' },
  user_message:  { bg: 'bg-amber-500/10 border-amber-500/15',  text: 'text-amber-400/70' },
  agent_memory:  { bg: 'bg-cyan-500/10 border-cyan-500/15',    text: 'text-cyan-400/70' },
  emit_event:    { bg: 'bg-violet-500/10 border-violet-500/15', text: 'text-violet-400/70' },
};

/** Use case category colors. */
export const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  notification:  { bg: 'bg-rose-500/10 border-rose-500/15',    text: 'text-rose-400/70' },
  'data-sync':   { bg: 'bg-cyan-500/10 border-cyan-500/15',    text: 'text-cyan-400/70' },
  monitoring:    { bg: 'bg-amber-500/10 border-amber-500/15',  text: 'text-amber-400/70' },
  automation:    { bg: 'bg-violet-500/10 border-violet-500/15', text: 'text-violet-400/70' },
  communication: { bg: 'bg-blue-500/10 border-blue-500/15',    text: 'text-blue-400/70' },
  reporting:     { bg: 'bg-emerald-500/10 border-emerald-500/15', text: 'text-emerald-400/70' },
};

/** Execution mode badge styles. */
export const MODE_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  e2e:            { label: 'E2E',  bg: 'bg-emerald-500/10 border-emerald-500/20', text: 'text-emerald-400/80' },
  mock:           { label: 'MOCK', bg: 'bg-amber-500/10 border-amber-500/20',     text: 'text-amber-400/80' },
  non_executable: { label: 'INFO', bg: 'bg-secondary/50 border-primary/15',       text: 'text-muted-foreground/70' },
};

/** n8n session status badge styles. */
export const SESSION_STATUS_STYLES: Record<SessionStatus, { bg: string; text: string; label: string }> = {
  draft:            { bg: 'bg-zinc-500/15',    text: 'text-zinc-400',    label: 'Draft' },
  analyzing:        { bg: 'bg-blue-500/15',    text: 'text-blue-400',    label: 'Analyzing' },
  transforming:     { bg: 'bg-amber-500/15',   text: 'text-amber-400',   label: 'Transforming' },
  awaiting_answers: { bg: 'bg-violet-500/15',  text: 'text-violet-400',  label: 'Needs Input' },
  editing:          { bg: 'bg-violet-500/15',  text: 'text-violet-400',  label: 'Editing' },
  confirmed:        { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Confirmed' },
  failed:           { bg: 'bg-red-500/15',     text: 'text-red-400',     label: 'Failed' },
  interrupted:      { bg: 'bg-amber-500/15',   text: 'text-amber-400',   label: 'Interrupted' },
};

/** Workflow platform badge colors. */
export const PLATFORM_COLORS: Record<WorkflowPlatform, string> = {
  'n8n':            'bg-orange-500/15 text-orange-400 border-orange-500/20',
  'zapier':         'bg-amber-500/15 text-amber-400 border-amber-500/20',
  'make':           'bg-purple-500/15 text-purple-400 border-purple-500/20',
  'github-actions': 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  'unknown':        'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
};

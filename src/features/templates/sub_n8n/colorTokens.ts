/**
 * Shared color token maps for the n8n import wizard.
 *
 * All entity-type-to-color mappings live here so that a design-system
 * palette change only requires touching one file.
 */

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

/** Catalog keys (templates.n8n) for the session status badge labels. */
export type SessionStatusLabelKey =
  | 'session_status_draft' | 'session_status_analyzing' | 'session_status_transforming'
  | 'session_status_needs_input' | 'session_status_editing' | 'session_status_confirmed'
  | 'session_status_failed' | 'session_status_interrupted';

/** n8n session status badge styles. */
export const SESSION_STATUS_STYLES: Record<SessionStatus, { bg: string; text: string; labelKey: SessionStatusLabelKey }> = {
  draft:            { bg: 'bg-zinc-500/15',    text: 'text-zinc-400',    labelKey: 'session_status_draft' },
  analyzing:        { bg: 'bg-blue-500/15',    text: 'text-blue-400',    labelKey: 'session_status_analyzing' },
  transforming:     { bg: 'bg-amber-500/15',   text: 'text-amber-400',   labelKey: 'session_status_transforming' },
  awaiting_answers: { bg: 'bg-violet-500/15',  text: 'text-violet-400',  labelKey: 'session_status_needs_input' },
  editing:          { bg: 'bg-violet-500/15',  text: 'text-violet-400',  labelKey: 'session_status_editing' },
  confirmed:        { bg: 'bg-emerald-500/15', text: 'text-emerald-400', labelKey: 'session_status_confirmed' },
  failed:           { bg: 'bg-red-500/15',     text: 'text-red-400',     labelKey: 'session_status_failed' },
  interrupted:      { bg: 'bg-amber-500/15',   text: 'text-amber-400',   labelKey: 'session_status_interrupted' },
};

/** Workflow platform badge colors. */
export const PLATFORM_COLORS: Record<WorkflowPlatform, string> = {
  'n8n':            'bg-orange-500/15 text-orange-400 border-orange-500/20',
  'zapier':         'bg-amber-500/15 text-amber-400 border-amber-500/20',
  'make':           'bg-purple-500/15 text-purple-400 border-purple-500/20',
  'github-actions': 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  'unknown':        'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
};

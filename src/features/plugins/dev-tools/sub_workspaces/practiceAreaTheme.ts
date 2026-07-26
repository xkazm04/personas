// Accent per taxonomy AREA — the workspace-library counterpart to Manual
// Review's `catBorder` (sub_manual-review/components/reviewFocusHelpers.tsx).
//
// The library's topic is always `area/cluster` over a closed set of 15 areas
// (db/repos/workspace_taxonomy.rs), which makes the area a reliable colour key:
// a reviewer walking a queue can tell "this is a security practice" before
// reading a word. `architecture` deliberately takes the app's own primary
// accent rather than a hue of its own — it is the structural default, and the
// area a practice lands in when no subsystem governs it.
export interface AreaTheme {
  /** `border-l-*` for a left accent rail. */
  rail: string;
  /** Chip background + text for the topic eyebrow. */
  chip: string;
  /** Bare text colour, for rules and inline marks. */
  text: string;
}

const THEMES: Record<string, AreaTheme> = {
  security:      { rail: 'border-l-red-500',     chip: 'bg-red-500/10 text-red-400',         text: 'text-red-400' },
  auth:          { rail: 'border-l-orange-500',  chip: 'bg-orange-500/10 text-orange-400',   text: 'text-orange-400' },
  billing:       { rail: 'border-l-amber-500',   chip: 'bg-amber-500/10 text-amber-400',     text: 'text-amber-400' },
  llm:           { rail: 'border-l-violet-500',  chip: 'bg-violet-500/10 text-violet-400',   text: 'text-violet-400' },
  testing:       { rail: 'border-l-emerald-500', chip: 'bg-emerald-500/10 text-emerald-400', text: 'text-emerald-400' },
  observability: { rail: 'border-l-sky-500',     chip: 'bg-sky-500/10 text-sky-400',         text: 'text-sky-400' },
  performance:   { rail: 'border-l-lime-500',    chip: 'bg-lime-500/10 text-lime-400',       text: 'text-lime-400' },
  errors:        { rail: 'border-l-rose-500',    chip: 'bg-rose-500/10 text-rose-400',       text: 'text-rose-400' },
  concurrency:   { rail: 'border-l-cyan-500',    chip: 'bg-cyan-500/10 text-cyan-400',       text: 'text-cyan-400' },
  data:          { rail: 'border-l-purple-500',  chip: 'bg-purple-500/10 text-purple-400',   text: 'text-purple-400' },
  api:           { rail: 'border-l-blue-500',    chip: 'bg-blue-500/10 text-blue-400',       text: 'text-blue-400' },
  frontend:      { rail: 'border-l-teal-500',    chip: 'bg-teal-500/10 text-teal-400',       text: 'text-teal-400' },
  integration:   { rail: 'border-l-indigo-500',  chip: 'bg-indigo-500/10 text-indigo-400',   text: 'text-indigo-400' },
  architecture:  { rail: 'border-l-primary',     chip: 'bg-primary/10 text-primary',         text: 'text-primary' },
  process:       { rail: 'border-l-foreground/40', chip: 'bg-secondary/60 text-foreground/80', text: 'text-foreground/70' },
};

const FALLBACK: AreaTheme = {
  rail: 'border-l-primary/30',
  chip: 'bg-secondary/60 text-muted-foreground',
  text: 'text-muted-foreground',
};

/** Area segment of a `area/cluster` topic, or '' when there isn't one. */
export function topicArea(topic: string | null | undefined): string {
  return (topic ?? '').split('/')[0] ?? '';
}

export function areaTheme(topic: string | null | undefined): AreaTheme {
  return THEMES[topicArea(topic)] ?? FALLBACK;
}

/**
 * The tone table behind the execution-detail content grammar — extracted
 * verbatim from `ExecutionDetailContent` / `OutputSections`, which is the
 * surface in this app whose content presentation the operator points at when
 * asked what "good" looks like here.
 *
 * WHY RAW PALETTE FAMILIES AND NOT `status-*`: every card in that surface is
 * tinted from a Tailwind palette family (`amber-500/5` fill, `amber-500/15`
 * border, `amber-400` ink). The first manifest port re-expressed the same idea
 * with `status-*` washes and came out colourless next to it — that is a large
 * part of how it read as a regression. These are standard palette classes, not
 * the `brand-*` custom tokens Design.md §3 warns are unreliable under Tailwind
 * v4, and the source surface ships them today.
 *
 * Every string below is spelled out in full so Tailwind's scanner sees it; a
 * class assembled from `${family}-500/5` at runtime is never generated.
 */
export type ContentTone = 'primary' | 'blue' | 'amber' | 'violet' | 'emerald' | 'red' | 'neutral';

export interface ContentToneClasses {
  /** Card border. */
  border: string;
  /** Card fill. */
  fill: string;
  /** Icon and accent ink. */
  ink: string;
  /** A pill on this tone: fill + ink + border together. */
  pill: string;
}

export const CONTENT_TONES: Record<ContentTone, ContentToneClasses> = {
  primary: {
    border: 'border-primary/10',
    fill: 'bg-secondary/10',
    ink: 'text-primary/60',
    pill: 'bg-primary/10 text-primary border border-primary/20',
  },
  blue: {
    border: 'border-blue-500/15',
    fill: 'bg-blue-500/5',
    ink: 'text-blue-400',
    pill: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  },
  amber: {
    border: 'border-amber-500/15',
    fill: 'bg-amber-500/5',
    ink: 'text-amber-400',
    pill: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  },
  violet: {
    border: 'border-violet-500/15',
    fill: 'bg-violet-500/5',
    ink: 'text-violet-400',
    pill: 'bg-violet-500/10 text-violet-400 border border-violet-500/20',
  },
  emerald: {
    border: 'border-emerald-500/15',
    fill: 'bg-emerald-500/5',
    ink: 'text-emerald-400',
    pill: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  },
  red: {
    border: 'border-red-500/15',
    fill: 'bg-red-500/5',
    ink: 'text-red-400',
    pill: 'bg-red-500/10 text-red-400 border border-red-500/20',
  },
  neutral: {
    border: 'border-primary/10',
    fill: 'bg-secondary/10',
    ink: 'text-foreground',
    pill: 'bg-secondary/40 text-foreground border border-primary/15',
  },
};

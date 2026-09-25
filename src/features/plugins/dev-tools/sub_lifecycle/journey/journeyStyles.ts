// Static class bundles for the journey (Tailwind's JIT must see every class
// literally). A binding state is encoded twice, by border SHAPE and by status
// token COLOUR, so it survives colour-blindness and a monochrome theme:
//   live = solid, detected = double, pending/missing = dashed, advisory = dotted hairline.
// Colour is by meaning (`status-*` tokens), never by palette hue.
import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

export const STATE_SHAPE: Record<LifecycleBindingState, string> = {
  live: 'border-2 border-solid border-status-success/80 bg-status-success/10',
  detected: 'border-[3px] border-double border-status-info/80 bg-status-info/10',
  pending: 'border-2 border-dashed border-status-warning/80 bg-status-warning/10',
  missing: 'border-2 border-dashed border-status-error/80 bg-status-error/10',
  advisory: 'border border-dotted border-foreground/50 bg-transparent',
};

export const STATE_TEXT: Record<LifecycleBindingState, string> = {
  live: 'text-status-success',
  detected: 'text-status-info',
  pending: 'text-status-warning',
  missing: 'text-status-error',
  advisory: 'text-foreground',
};

/** The small state chip in the detail layer and the legend: same shape + colour, compact. */
export const STATE_CHIP: Record<LifecycleBindingState, string> = {
  live: 'border-2 border-solid border-status-success/80',
  detected: 'border-[3px] border-double border-status-info/80',
  pending: 'border-2 border-dashed border-status-warning/80',
  missing: 'border-2 border-dashed border-status-error/80',
  advisory: 'border border-dotted border-foreground/50',
};

/** Evidence dots: filled = done, hollow = skipped, dashed ring = unknown, error token = failed. */
export const OUTCOME_DOT: Record<LifecycleOutcome, string> = {
  done: 'bg-status-success border border-status-success',
  skipped: 'bg-transparent border border-foreground/70',
  unknown: 'bg-transparent border border-dashed border-foreground/40',
  failed: 'bg-status-error border border-status-error',
};

export const OUTCOME_TEXT: Record<LifecycleOutcome, string> = {
  done: 'text-status-success',
  skipped: 'text-foreground',
  unknown: 'text-foreground',
  failed: 'text-status-error',
};

export const LEGEND_STATES: LifecycleBindingState[] = ['live', 'detected', 'pending', 'missing', 'advisory'];

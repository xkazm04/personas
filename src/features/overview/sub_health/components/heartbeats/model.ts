import type { HealthGrade } from '@/stores/slices/overview/personaHealthSlice';

// ---------------------------------------------------------------------------
// Shared model + design tokens for the Vitals Ledger heartbeats view.
// ---------------------------------------------------------------------------

/** Single source of truth for grade → semantic-token styling. */
export const GRADE_THEME: Record<HealthGrade, {
  text: string; bar: string; track: string; soft: string;
  border: string; ring: string; dot: string; chip: string;
}> = {
  critical: {
    text: 'text-status-error', bar: 'bg-status-error', track: 'bg-status-error/10', soft: 'bg-status-error/[0.06]',
    border: 'border-status-error/20', ring: 'ring-status-error/30', dot: 'bg-status-error',
    chip: 'bg-status-error/15 text-status-error border-status-error/25',
  },
  degraded: {
    text: 'text-status-warning', bar: 'bg-status-warning', track: 'bg-status-warning/10', soft: 'bg-status-warning/[0.06]',
    border: 'border-status-warning/20', ring: 'ring-status-warning/30', dot: 'bg-status-warning',
    chip: 'bg-status-warning/15 text-status-warning border-status-warning/25',
  },
  unknown: {
    text: 'text-zinc-400', bar: 'bg-zinc-500', track: 'bg-zinc-500/10', soft: 'bg-zinc-500/[0.06]',
    border: 'border-zinc-500/20', ring: 'ring-zinc-500/30', dot: 'bg-zinc-500',
    chip: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25',
  },
  healthy: {
    text: 'text-status-success', bar: 'bg-status-success', track: 'bg-status-success/10', soft: 'bg-status-success/[0.06]',
    border: 'border-status-success/20', ring: 'ring-status-success/30', dot: 'bg-status-success',
    chip: 'bg-status-success/15 text-status-success border-status-success/25',
  },
};

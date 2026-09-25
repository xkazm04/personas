/**
 * Colour vocabulary shared by the two-layer prototypes. One tone per process
 * state and per waiting-item kind, expressed as CSS variables so the same
 * value drives a Tailwind class, an inline gradient stop and the frame glow.
 */

import type { ProcessTone, WorkItemKind, Workforce } from './useWorkforce';

export const TONE_VAR: Record<ProcessTone, string> = {
  needs_you: 'var(--status-warning)',
  stale: 'var(--status-error)',
  working: 'var(--status-info)',
  queued: 'var(--status-neutral)',
  idle: 'var(--muted-dark)',
};

export const TONE_DOT: Record<ProcessTone, string> = {
  needs_you: 'bg-status-warning',
  stale: 'bg-status-error',
  working: 'bg-status-info',
  queued: 'bg-status-neutral',
  idle: 'bg-muted-dark',
};

export const KIND_VAR: Record<WorkItemKind, string> = {
  session_request: 'var(--status-warning)',
  decision: 'var(--status-warning)',
  approval: 'var(--primary)',
  plan: 'var(--primary)',
  failure: 'var(--status-error)',
  warning: 'var(--status-warning)',
  nudge: 'var(--brand-purple)',
  assignment: 'var(--status-info)',
};

/**
 * The frame's conic gradient: one arc per active project, sized by how much is
 * happening there (processes + waiting items), plus Athena's own ops and the
 * project-less waiting items. Uneven weights are the point: the border reads
 * as "where the work is", not as decoration.
 */
export function frameGradient(w: Workforce): string | undefined {
  const arcs: { weight: number; color: string }[] = [];
  for (const lane of w.lanes) {
    arcs.push({ weight: lane.bullets.length + lane.items.length * 2, color: TONE_VAR[lane.tone] });
  }
  if (w.ops.length) arcs.push({ weight: w.ops.length, color: 'var(--primary)' });
  for (const it of w.looseItems) arcs.push({ weight: 1.5, color: KIND_VAR[it.kind] });
  const total = arcs.reduce((s, a) => s + a.weight, 0);
  if (total === 0) return undefined;
  const gap = 1.2;
  const base = 'color-mix(in srgb, var(--foreground) 10%, transparent)';
  const stops: string[] = [];
  let at = 0;
  for (const a of arcs) {
    const span = (a.weight / total) * 360;
    const from = at + gap / 2;
    const to = Math.max(from, at + span - gap / 2);
    stops.push(`${base} ${at}deg ${from}deg`, `${a.color} ${from}deg ${to}deg`, `${base} ${to}deg ${at + span}deg`);
    at += span;
  }
  return `conic-gradient(from 200deg, ${stops.join(', ')})`;
}

/**
 * The two closed vocabularies a row wears: where an item stands, and which
 * registry skill answers it. Both are typed enums from the bindings, so a
 * value the registry adds arrives as a missing glyph rather than a wrong one.
 */
import type { CuratorEngine } from '@/lib/bindings/CuratorEngine';
import type { CuratorPlanItemState } from '@/lib/bindings/CuratorPlanItemState';

export const STATE_GLYPH: Record<CuratorPlanItemState, string> = {
  landed: '✓',
  dispatched: '●',
  planned: '○',
  declined: '✕',
  idled: '◌',
  blocked: '⊘',
};

export const ENGINE_GLYPH: Record<CuratorEngine, string> = {
  conform: '⟲',
  deepen: '↓',
  apply: '⊕',
  reconcile: '⇄',
  intake: '⇣',
  forge: '⚒',
  none: '·',
};

export function stateColour(state: CuratorPlanItemState): string {
  switch (state) {
    case 'landed':
      return 'var(--status-success)';
    case 'dispatched':
      return 'var(--status-info)';
    case 'declined':
      return 'var(--status-error)';
    case 'blocked':
      return 'var(--status-warning)';
    default:
      return 'var(--muted-dark)';
  }
}

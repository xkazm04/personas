// Drift → token maps, hoisted so every Trace surface (baseline tree, orbit,
// blueprint, ledger) colours version drift identically.
import type { DriftState } from './traceTypes';

/** SVG stroke classes (rings around project nodes). */
export const DRIFT_RING: Record<DriftState, string> = {
  in_sync: 'stroke-status-success',
  behind: 'stroke-status-warning',
  ahead: 'stroke-primary',
  customized: 'stroke-status-info',
  unversioned: 'stroke-foreground/50',
};

/** Text classes (ledger/blueprint verdict words). */
export const DRIFT_TEXT: Record<DriftState, string> = {
  in_sync: 'text-status-success',
  behind: 'text-status-warning',
  ahead: 'text-primary',
  customized: 'text-status-info',
  unversioned: 'text-foreground',
};

/** Left-border accent classes (blueprint module cards). */
export const DRIFT_BORDER: Record<DriftState, string> = {
  in_sync: 'border-l-status-success',
  behind: 'border-l-status-warning',
  ahead: 'border-l-primary',
  customized: 'border-l-status-info',
  unversioned: 'border-l-border',
};

export const DRIFT_ORDER: DriftState[] = ['in_sync', 'behind', 'ahead', 'customized', 'unversioned'];

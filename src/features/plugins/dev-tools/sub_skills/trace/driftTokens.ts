// Drift → token maps, shared so every Trace surface colours version drift
// identically (chip edges, legend swatches).
import type { DriftState } from './traceTypes';

/** SVG fill classes (chip drift edges + legend swatches). */
export const DRIFT_FILL: Record<DriftState, string> = {
  in_sync: 'fill-status-success',
  behind: 'fill-status-warning',
  ahead: 'fill-primary',
  customized: 'fill-status-info',
  unversioned: 'fill-border',
};

export const DRIFT_ORDER: DriftState[] = ['in_sync', 'behind', 'ahead', 'customized', 'unversioned'];

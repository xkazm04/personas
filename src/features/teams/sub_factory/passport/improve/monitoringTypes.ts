// Props every Monitoring variant receives — identical shape, so the prototype
// switcher can swap them without the host knowing which is rendered.
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';

import type { MonitoringItemDef, MonitoringState } from './monitoringModel';

/** One capability, fully resolved: its definition, both halves of its state,
 *  and the credentials that could back it. */
export interface MonitoringRow {
  def: MonitoringItemDef;
  state: MonitoringState;
  /** What the codebase shows for this capability; null = nothing detected. */
  detected: string | null;
  /** The credential the operator bound, if any. */
  bound: PersonaCredential | undefined;
  candidates: PersonaCredential[];
  health: Record<string, boolean | null>;
}

export interface MonitoringVariantProps {
  rows: MonitoringRow[];
  /** Item key whose binding is being written. */
  busyKey: string | null;
  /** Item key whose integration deployment is in flight. */
  deploying: string | null;
  onAssign: (itemKey: string, credentialId: string | null) => void;
  onDeploy: (row: MonitoringRow) => void;
}

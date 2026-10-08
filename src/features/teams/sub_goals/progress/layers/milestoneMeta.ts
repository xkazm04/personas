/**
 * The milestone vocabulary as the layered views present it: ONE table keyed by
 * the cut's stored status, carrying the label and the tone together (registry
 * status-vocabulary: a parallel colour map and label map drift the day the
 * vocabulary grows). The tone is `laneTone`, the canvas chips' own, so a
 * milestone wears the same colour on every layer.
 */
import type { StatusToken } from '@/lib/design/statusTokens';

import type { DevLifecycleT } from '../../progressShared';
import { laneTone } from '../rowCanvas';

export type MilestoneStatus = 'planned' | 'active' | 'shipped';

export function normalizeMilestoneStatus(raw: string): MilestoneStatus {
  return raw === 'active' || raw === 'shipped' ? raw : 'planned';
}

export interface MilestoneMeta {
  status: MilestoneStatus;
  label: string;
  tone: StatusToken;
}

export function milestoneMeta(dl: DevLifecycleT, raw: string): MilestoneMeta {
  const status = normalizeMilestoneStatus(raw);
  const label =
    status === 'shipped' ? dl.layers_ms_shipped : status === 'active' ? dl.layers_ms_active : dl.layers_ms_planned;
  return { status, label, tone: laneTone(status) };
}

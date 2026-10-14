import type { CuratorProcess } from '@/lib/bindings/CuratorProcess';
import type { DevInstance, DevMode } from '../engine/devAdapter';
import type { SpineModel } from '../engine/spine';

/** The ways the Process page can draw one reading. Every view answers the same two questions. */
export type ProcessViewId = 'spine' | 'dial' | 'watershed';

/**
 * What every view receives. The page owns the read, the mode and the repository filter; a view
 * only draws. `model` is the spine of what is shown, `base` the spine of the whole mode, so a view
 * can measure a picked repository against its mode.
 */
export interface ProcessViewProps {
  reading: CuratorProcess;
  mode: DevMode;
  /** The picked repository, or null for the whole mode. */
  repo: string | null;
  /** Every session of the mode. */
  cohort: DevInstance[];
  /** The sessions on screen: the cohort, or the picked repository's share of it. */
  view: DevInstance[];
  model: SpineModel;
  base: SpineModel;
}
